import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { USERS, getUser } from "./users.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const OZON_URL = "https://api-seller.ozon.ru/v4/posting/fbs/list";
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 200;

// ---------- Хранилище оплаченных заказов (по пользователям) ----------

const DATA_DIR = path.join(__dirname, "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function paidFileFor(userId) {
  return path.join(DATA_DIR, `paid_${userId}.json`);
}

function loadPaidSet(userId) {
  ensureDataDir();
  try {
    const file = paidFileFor(userId);
    if (!fs.existsSync(file)) return new Set();
    const raw = fs.readFileSync(file, "utf-8");
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (err) {
    console.error(`⚠️ Не удалось прочитать ${userId} paid:`, err.message);
    return new Set();
  }
}

function savePaidSet(userId, set) {
  ensureDataDir();
  fs.writeFileSync(
    paidFileFor(userId),
    JSON.stringify(Array.from(set), null, 2),
    "utf-8"
  );
}

// ---------- Список пользователей (для фронта) ----------

app.get("/api/users", (req, res) => {
  const list = Object.values(USERS).map((u) => ({
    id: u.id,
    name: u.name,
    configured: Boolean(u.clientId && u.apiKey),
  }));
  res.json({ users: list });
});

// ---------- Эндпоинты для оплаченных ----------

app.get("/api/paid", (req, res) => {
  const userId = req.query.userId || "ildus";
  const set = loadPaidSet(userId);
  res.json({ paid: Array.from(set) });
});

app.post("/api/paid", (req, res) => {
  const { userId = "ildus", postingNumber, isPaid } = req.body || {};
  if (!postingNumber || typeof isPaid !== "boolean") {
    return res.status(400).json({ error: "Нужны postingNumber и isPaid" });
  }

  const set = loadPaidSet(userId);
  if (isPaid) set.add(postingNumber);
  else set.delete(postingNumber);
  savePaidSet(userId, set);

  res.json({ paid: Array.from(set) });
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

      (p.products || []).forEach((prod) => {
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
      });

      return {
        postingNumber: p.posting_number,
        orderNumber: p.order_number || p.posting_number,
        totalPrice: Number(totalPrice.toFixed(2)),
        currency: p.currency_code || currency || "RUB",
        acceptedAt: p.in_process_at,
        status: p.status,
      };
    });

    res.json({ orders, total: orders.length });
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Данные оплаченных: ${DATA_DIR}`);
});