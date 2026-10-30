// 배송·반품 정책. 배송비 세 값은 29부터 상점 설정(store_settings, /admin/settings)에서 읽는다.
// 주문은 생성 시점의 배송비를 orders.shipping_fee에 저장하므로 설정을 바꿔도 지난 주문은 그대로다.
// 기간 값(청약철회 7일 등)은 법·운영 규칙이라 아직 상수로 둔다
// 도서산간 추가 요금이나 상품별 배송비가 필요해지면 정책 객체에 칸을 더한다

export type ShippingPolicy = {
  shippingFee: number;
  freeShippingThreshold: number; // 상품 합계가 이 금액 이상이면 무료
  returnShippingFee: number; // 단순변심 반품의 왕복 배송비(환불액에서 뺀다)
};

// 처음 값(0033 마이그레이션이 store_settings에 넣는 값과 같다)
export const DEFAULT_SHIPPING_POLICY: ShippingPolicy = { shippingFee: 3_000, freeShippingThreshold: 50_000, returnShippingFee: 6_000 };
export const RETURN_WINDOW_DAYS = 7; // 청약철회 기간: 배송 완료 뒤 7일, 구매확정 전
export const AUTO_DELIVER_DAYS = 5; // shipped 뒤 5일이 지나면 delivered
export const AUTO_CONFIRM_DAYS = 7; // delivered 뒤 7일이 지나면 confirmed
export const UNPAID_ORDER_TTL_HOURS = 24; // pending_payment가 24시간을 넘으면 canceled(장바구니 안내 문구와 같다)

export const DAY_MS = 24 * 60 * 60 * 1000;

export function shippingFeeFor(subtotal: number, policy: Pick<ShippingPolicy, "shippingFee" | "freeShippingThreshold"> = DEFAULT_SHIPPING_POLICY): number {
  return subtotal >= policy.freeShippingThreshold ? 0 : policy.shippingFee;
}

export type ReturnReason = "change_of_mind" | "defective" | "wrong_item";

// 반품 환불액: 항목 금액 합계. 단순변심이면 왕복 배송비를 뺀다(하자·오배송은 빼지 않는다). 0원 아래로는 내려가지 않는다
export function returnRefundAmount(
  items: { unitPrice: number; quantity: number }[],
  reason: ReturnReason,
  returnShippingFee = DEFAULT_SHIPPING_POLICY.returnShippingFee,
): number {
  const sum = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  return Math.max(0, sum - (reason === "change_of_mind" ? returnShippingFee : 0));
}

export function returnDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
}
