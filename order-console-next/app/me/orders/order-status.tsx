import { ORDER_STATUS_LABEL, type OrderStatusCode } from "@/lib/orders";

type OrderLike = { paid: boolean; canceledAt: string | null; status?: OrderStatusCode };

// status가 없는 응답(옛 캐시)은 옛 두 칸으로 정한다
const codeOf = (o: OrderLike): OrderStatusCode => o.status ?? (o.paid ? "paid" : o.canceledAt ? "canceled" : "pending_payment");

export function orderStatus(o: OrderLike) {
  const code = codeOf(o);
  if (code === "canceled" && !o.paid) return "취소됨 · 결제 기한 지남";
  return ORDER_STATUS_LABEL[code];
}

// 색: 결제 대기(기다림), 취소, 그 밖의 결제된 상태(정상)
export function orderState(o: OrderLike) {
  const code = codeOf(o);
  if (code === "pending_payment") return "pending";
  if (code === "canceled") return "canceled";
  return "paid";
}

export function OrderStatus({ order, testId }: { order: OrderLike; testId?: string }) {
  return <span className="status" data-state={orderState(order)} data-code={codeOf(order)} data-testid={testId}>{orderStatus(order)}</span>;
}

export const orderDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");
