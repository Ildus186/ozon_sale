import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { USERS, getUser } from "./users.mjs";

dotenv.config();

// ---------- Redis ----------
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.REDIS_URL;

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN;

const USE_REDIS = Boolean(REDIS_URL) && Boolean(REDIS_TOKEN);

let redis = null;

if (USE_REDIS) {
  const { Redis } = await import("@upstash/redis");
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  console.log("🔴 Хранилище оплаченных: Upstash Redis");
} else {
  console.log("📁 Хранилище оплаченных: локальные JSON-файлы (/tmp)");
}

// ---------- Файловое хранилище (только /tmp на Vercel) ----------
const DATA_DIR = "/tmp";

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function paidFileFor(userId) {
  return path.join(DATA_DIR, `paid_${userId}.json`);
}

function loadPaidLocal(userId) {
  try {
    ensureDataDir();
    const file = paidFileFor(userId);
    if (!fs.existsSync(file)) return [];
    const arr = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePaidLocal(userId, arr) {
  try {
    ensureDataDir();
    fs.writeFileSync(paidFileFor(userId), JSON.stringify(arr, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ Не удалось сохранить локально:", err.message);
  }
}

// ---------- Универсальные функции ----------
const paidKey = (userId) => `ozon:paid:${userId}`;

async function loadPaid(userId) {
  if (USE_REDIS) {
    const arr = await redis.get(paidKey(userId));
    return Array.isArray(arr) ? arr : [];
  }
  return loadPaidLocal(userId);
}

async function savePaid(userId, arr) {
  if (USE_REDIS) {
    await redis.set(paidKey(userId), arr);
  } else {
    savePaidLocal(userId, arr);
  }
}

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json());

const OZON_URL = "https://api-seller.ozon.ru/v4/posting/fbs/list";
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 200;

// ---------- Пользователи ----------
app.get("/api/users", (req, res) => {
  const list = Object.values(USERS).map((u) => ({
    id: u.id,
    name: u.name,
    configured: Boolean(u.clientId && u.apiKey),
  }));
  res.json({ users: list });
});

// ---------- Оплаченные ----------
app.get("/api/paid", async (req, res) => {
  try {
    const userId = req.query.userId || "ildus";
    const arr = await loadPaid(userId);
    res.json({ paid: arr });
  } catch (err) {
    console.error("❌ GET /api/paid:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/paid", async (req, res) => {
  try {
    const { userId = "ildus", postingNumber, isPaid } = req.body || {};
    if (!postingNumber || typeof isPaid !== "boolean") {
      return res.status(400).json({ error: "Нужны postingNumber и isPaid" });
    }

    let arr = await loadPaid(userId);

    if (isPaid) {
      if (!arr.includes(postingNumber)) arr.push(postingNumber);
    } else {
      arr = arr.filter((pn) => pn !== postingNumber);
    }

    await savePaid(userId, arr);
    res.json({ paid: arr });
  } catch (err) {
    console.error("❌ POST /api/paid:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Заказы Ozon ----------
async function fetchAllPostings(user, filter) {
  const all = [];
  let cursor = "";
  let page = 0;

  while (true) {
    page++;
    const payload = { filter, limit: PAGE_LIMIT, cursor, sort_dir: "DESC" };

    console.log(
      `→ [${user.id}] Ozon page ${page}, cursor="${cursor.slice(0, 20)}..."`
    );

    const response = await fetch(OZON_URL, {
      method: "POST",
      headers: {
        "Client-Id": user.clientId,
        "Api-Key": user.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(`← [${user.id}] Ozon error status:`, response.status);
      console.error(`← [${user.id}] Ozon error body:`, text.slice(0, 800));
      throw new Error(`Ozon API ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = JSON.parse(text);
    const postings = data?.postings || data?.result?.postings || [];
    const hasNext = Boolean(data?.has_next ?? data?.result?.has_next);
    const nextCursor = data?.cursor || data?.result?.cursor || "";

    console.log(
      `← [${user.id}] page ${page}: получено ${postings.length}, has_next=${hasNext}`
    );

    all.push(...postings);

    if (!hasNext || !nextCursor || page >= MAX_PAGES) break;

    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log(`✅ [${user.id}] Всего загружено заказов: ${all.length}`);
  return all;
}

app.post("/api/orders", async (req, res) => {
  try {
    const { userId = "ildus", since, to } = req.body || {};

    const user = getUser(userId);

    const filter = {
      since:
        since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: to || new Date().toISOString(),
    };

    const postings = await fetchAllPostings(user, filter);

    const orders = postings.map((p) => {
      let totalPrice = 0;
      let currency = "RUB";

      const products = (p.products || []).map((prod) => {
        const raw = prod.price;
        let amount = 0;

        if (raw && typeof raw === "object") {
          amount = parseFloat(raw.amount || 0);
          if (raw.currency) currency = raw.currency;
        } else {
          amount = parseFloat(raw || 0);
        }

        const qty = parseInt(prod.quantity || 1, 10);
        totalPrice += amount * qty;

        return {
          name: prod.name || "",
          sku: prod.sku || null,
          quantity: qty,
        };
      });

      return {
        postingNumber: p.posting_number,
        orderNumber: p.order_number || p.posting_number,
        totalPrice: Number(totalPrice.toFixed(2)),
        currency: p.currency_code || currency || "RUB",
        acceptedAt: p.in_process_at,
        status: p.status,
        products,
      };
    });

    res.json({ orders, total: orders.length });
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Экспорт для Vercel ----------
export default app;