type OrderLike = { paid: boolean; canceledAt: string | null };

export function orderStatus(o: OrderLike) {
  if (o.paid) return "결제 완료";
  if (o.canceledAt) return "취소됨 · 결제 기한 지남";
  return "결제 대기";
}

export function orderState(o: OrderLike) {
  if (o.paid) return "paid";
  if (o.canceledAt) return "canceled";
  return "pending";
}

export function OrderStatus({ order, testId }: { order: OrderLike; testId?: string }) {
  return <span className="status" data-state={orderState(order)} data-testid={testId}>{orderStatus(order)}</span>;
}

export const orderDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");
