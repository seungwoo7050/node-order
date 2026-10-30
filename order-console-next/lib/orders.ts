// 주문 상태·배송 표시. 상태 전이 규칙은 API(order-api-nest/src/fulfillment/order-state.ts)에만 있고,
// 화면은 API가 실어 주는 상태와 할 수 있는 동작(actions, canReturn, canConfirm)만 보고 그린다

export type OrderStatusCode = "pending_payment" | "paid" | "preparing" | "shipped" | "delivered" | "confirmed" | "canceled";

export const ORDER_STATUS_LABEL: Record<OrderStatusCode, string> = {
  pending_payment: "결제 대기",
  paid: "결제 완료",
  preparing: "배송 준비 중",
  shipped: "배송 중",
  delivered: "배송 완료",
  confirmed: "구매 확정",
  canceled: "취소됨",
};

export const ORDER_STATUS_CODES = Object.keys(ORDER_STATUS_LABEL) as OrderStatusCode[];

export const RETURN_STATUS_LABEL = { requested: "요청됨", approved: "승인됨", rejected: "거절됨", completed: "완료" } as const;
export const RETURN_KIND_LABEL = { refund: "반품(환불)", exchange: "교환" } as const;
export const RETURN_REASON_LABEL = { change_of_mind: "단순변심", defective: "상품 하자", wrong_item: "오배송" } as const;
export const REFUND_STATUS_LABEL = { requested: "환불 처리 중", succeeded: "환불 완료", failed: "환불 실패" } as const;

export const CARRIER_OPTIONS = [
  { code: "cj", name: "CJ대한통운" },
  { code: "epost", name: "우체국택배" },
  { code: "hanjin", name: "한진택배" },
  { code: "lotte", name: "롯데택배" },
  { code: "logen", name: "로젠택배" },
] as const;

// 배송비 표시용. 값은 상점 설정(GET /store)에서 온다. 서버가 같은 규칙으로 다시 계산하고, 결제 금액은 서버 값이 정한다
export type ShippingPolicy = { shippingFee: number; freeShippingThreshold: number };
export const shippingFeeFor = (subtotal: number, policy: ShippingPolicy) => (subtotal >= policy.freeShippingThreshold ? 0 : policy.shippingFee);

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export const dateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
