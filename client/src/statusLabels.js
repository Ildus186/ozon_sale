export const STATUS_LABELS = {
  acceptance_in_progress: "Идёт приёмка",
  awaiting_approve: "Ожидает подтверждения",
  awaiting_packaging: "Ожидает упаковки",
  awaiting_registration: "Ожидает регистрации",
  awaiting_deliver: "Ожидает отгрузки",
  arbitration: "Арбитраж",
  client_arbitration: "Арбитраж клиента",
  delivering: "Доставляется",
  driver_pickup: "У водителя",
  delivered: "Доставлен",
  cancelled: "Отменён",
  not_accepted: "Не принят",
  sent_by_seller: "Отправлен продавцом",
};

export function statusLabel(code) {
  if (!code) return "—";
  return STATUS_LABELS[code] || code;
}