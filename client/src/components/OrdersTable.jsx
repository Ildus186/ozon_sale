import { statusLabel } from "../statusLabels";

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(value, currency) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency || "RUB",
  }).format(value);
}

/**
 * Номер заказа: 4 цифры ПЕРЕД первым дефисом — жирным чёрным.
 * "64580211-0543-1" → "6458" обычным, "0211" жирным, "-0543-1" обычным.
 */
function OrderNumber({ value }) {
  if (!value) return <span className="order-number">—</span>;

  const dashIndex = value.indexOf("-");

  if (dashIndex < 4) {
    return <span className="order-number">{value}</span>;
  }

  const before = value.slice(0, dashIndex);
  const after = value.slice(dashIndex);

  const head = before.slice(0, -4);
  const highlight = before.slice(-4);

  return (
    <span className="order-number">
      {head}
      <span className="order-number-head">{highlight}</span>
      {after}
    </span>
  );
}

export default function OrdersTable({ orders, paid, onTogglePaid }) {
  if (!orders.length) {
    return <p className="empty">Заказы не найдены за выбранный период.</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="orders-table">
        <thead>
          <tr>
            <th>Номер заказа</th>
            <th>Стоимость товара</th>
            <th>Дата принятия заказа</th>
            <th>Статус заказа</th>
            <th className="col-paid">Оплачен</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const isPaid = paid.has(o.postingNumber);
            return (
              <tr key={o.postingNumber} className={isPaid ? "row-paid" : ""}>
                <td>
                  <OrderNumber value={o.orderNumber} />
                </td>
                <td>{formatPrice(o.totalPrice, o.currency)}</td>
                <td>{formatDate(o.acceptedAt)}</td>
                <td>
                  <span className={`badge status-${o.status}`}>
                    {statusLabel(o.status)}
                  </span>
                </td>
                <td className="col-paid">
                  <label className="paid-checkbox">
                    <input
                      type="checkbox"
                      checked={isPaid}
                      onChange={(e) =>
                        onTogglePaid(o.postingNumber, e.target.checked)
                      }
                    />
                    <span className="paid-checkmark">
                      {isPaid && (
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 12.5l4.5 4.5L19 7"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}