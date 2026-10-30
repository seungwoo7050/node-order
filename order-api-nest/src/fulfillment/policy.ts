// 배송·반품 정책 상수(한 곳). 설정 화면은 29에서 만든다.
// 도서산간 추가 요금이나 상품별 배송비가 필요해지면 이 상수를 정책 객체로 바꾼다

export const SHIPPING_FEE = 3_000;
export const FREE_SHIPPING_THRESHOLD = 50_000; // 상품 합계가 이 금액 이상이면 무료
export const RETURN_SHIPPING_FEE = 6_000; // 단순변심 반품의 왕복 배송비(환불액에서 뺀다)
export const RETURN_WINDOW_DAYS = 7; // 청약철회 기간: 배송 완료 뒤 7일, 구매확정 전
export const AUTO_DELIVER_DAYS = 5; // shipped 뒤 5일이 지나면 delivered
export const AUTO_CONFIRM_DAYS = 7; // delivered 뒤 7일이 지나면 confirmed
export const UNPAID_ORDER_TTL_HOURS = 24; // pending_payment가 24시간을 넘으면 canceled(장바구니 안내 문구와 같다)

export const DAY_MS = 24 * 60 * 60 * 1000;

export function shippingFeeFor(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}

export type ReturnReason = "change_of_mind" | "defective" | "wrong_item";

// 반품 환불액: 항목 금액 합계. 단순변심이면 왕복 배송비를 뺀다(하자·오배송은 빼지 않는다). 0원 아래로는 내려가지 않는다
export function returnRefundAmount(items: { unitPrice: number; quantity: number }[], reason: ReturnReason): number {
  const sum = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  return Math.max(0, sum - (reason === "change_of_mind" ? RETURN_SHIPPING_FEE : 0));
}

export function returnDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
}
