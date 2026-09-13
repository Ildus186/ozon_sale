import { useEffect, useState, useCallback, useMemo } from "react";
import {
  fetchUsers,
  fetchOrders,
  fetchPaid,
  setPaidOnServer,
} from "./api";
import OrdersTable from "./components/OrdersTable";
import { statusLabel } from "./statusLabels";

const FEE_PER_ORDER = 110;
const PROFIT_COEFF = 0.47;
const MIN_DATE = "2026-09-03";

function defaultRange() {
  const to = new Date();
  const rawSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toLocal = (d) => d.toISOString().slice(0, 10);

  let since = toLocal(rawSince);
  if (since < MIN_DATE) since = MIN_DATE;

  return { since, to: toLocal(to) };
}

export default function App() {
  const [{ since, to }, setRange] = useState(defaultRange());
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState("ildus");
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paid, setPaidState] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Загружаем список пользователей один раз
  useEffect(() => {
    fetchUsers()
      .then((data) => setUsers(data.users || []))
      .catch((e) =>
        console.error("Не удалось получить список пользователей:", e)
      );
  }, []);

  const currentUserObj = useMemo(
    () => users.find((u) => u.id === currentUser),
    [users, currentUser]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const safeSince = since < MIN_DATE ? MIN_DATE : since;
      const safeTo = to < MIN_DATE ? MIN_DATE : to;

      const [ordersData, paidSet] = await Promise.all([
        fetchOrders({
          userId: currentUser,
          since: new Date(`${safeSince}T00:00:00`).toISOString(),
          to: new Date(`${safeTo}T23:59:59`).toISOString(),
        }),
        fetchPaid(currentUser),
      ]);
      setOrders(ordersData.orders || []);
      setPaidState(paidSet);
    } catch (e) {
      setError(e.message);
      setOrders([]);
      setPaidState(new Set());
    } finally {
      setLoading(false);
    }
  }, [since, to, currentUser]);

  // Перезагрузка при смене пользователя
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const handleTogglePaid = useCallback(
    async (postingNumber, isPaid) => {
      setPaidState((prev) => {
        const next = new Set(prev);
        if (isPaid) next.add(postingNumber);
        else next.delete(postingNumber);
        return next;
      });

      try {
        const updated = await setPaidOnServer(
          currentUser,
          postingNumber,
          isPaid
        );
        setPaidState(updated);
      } catch (e) {
        console.error("Не удалось сохранить оплату:", e);
        setError(`Не удалось сохранить оплату: ${e.message}`);
        try {
          const fresh = await fetchPaid(currentUser);
          setPaidState(fresh);
        } catch {}
      }
    },
    [currentUser]
  );

  const statuses = useMemo(() => {
    const set = new Set(orders.map((o) => o.status).filter(Boolean));
    return Array.from(set).sort();
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const { revenue, profit } = useMemo(() => {
    const total = filteredOrders.reduce(
      (sum, o) => sum + (o.totalPrice || 0),
      0
    );
    const rev = total - filteredOrders.length * FEE_PER_ORDER;
    return { revenue: rev, profit: rev * PROFIT_COEFF };
  }, [filteredOrders]);

  const formatMoney = (v) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
    }).format(v);

  return (
    <div className={`app theme-${currentUser}`}>
      <header className="app-header">
        <div className="user-switch">
          {users.length === 0 && (
            <span className="user-switch-loading">Загрузка…</span>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              className={`user-tab ${
                currentUser === u.id ? "active" : ""
              } ${!u.configured ? "not-configured" : ""}`}
              onClick={() => setCurrentUser(u.id)}
              title={!u.configured ? "Ключи ещё не заданы" : ""}
            >
              {u.name}
              {!u.configured && <span className="user-tab-warn"> ⚠</span>}
            </button>
          ))}
        </div>
        <h1>
          Заказы Ozon Seller
          {currentUserObj ? ` — ${currentUserObj.name}` : ""}
        </h1>
        <p className="subtitle">
          Полный список заказов FBS за выбранный период
        </p>
      </header>

      <section className="filters">
        <label>
          С даты
          <input
            type="date"
            value={since}
            min={MIN_DATE}
            onChange={(e) =>
              setRange((r) => ({ ...r, since: e.target.value }))
            }
          />
        </label>
        <label>
          По дату
          <input
            type="date"
            value={to}
            min={MIN_DATE}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </label>

        <label>
          Статус
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Все статусы</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <button onClick={load} disabled={loading}>
          {loading ? "Загрузка…" : "Обновить"}
        </button>

        <div className="metrics">
          <div className="metric">
            <span className="metric-label">Выручка</span>
            <span className="metric-value">{formatMoney(revenue)}</span>
          </div>
          <div className="metric metric-profit">
            <span className="metric-label">Прибыль</span>
            <span className="metric-value">{formatMoney(profit)}</span>
          </div>
        </div>
      </section>

      {error && <div className="error">Ошибка: {error}</div>}

      {loading ? (
        <div className="loader">Загрузка заказов…</div>
      ) : (
        <OrdersTable
          orders={filteredOrders}
          paid={paid}
          onTogglePaid={handleTogglePaid}
        />
      )}

      <footer className="app-footer">
        Показано: <strong>{filteredOrders.length}</strong> из {orders.length} ·
        Оплачено:{" "}
        <strong>
          {filteredOrders.filter((o) => paid.has(o.postingNumber)).length}
        </strong>{" "}
        · Ozon Seller API v4
      </footer>
    </div>
  );
}