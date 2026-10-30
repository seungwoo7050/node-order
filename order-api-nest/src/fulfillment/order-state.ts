// 주문 상태 기계(순수 함수). 전이 표가 이 파일 한 곳에만 있다.
// DB 반영은 transitions.ts가 조건부 update(WHERE id = ? AND status = <from>)로 해서 동시 요청 중 하나만 이긴다
// 반품·교환은 주문 상태가 아니라 반품 요청(returns)의 상태로 따로 움직인다(아래 RETURN_TRANSITIONS)

export const ORDER_STATUSES = ["pending_payment", "paid", "preparing", "shipped", "delivered", "confirmed", "canceled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTORS = ["customer", "admin", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const ORDER_EVENTS = ["pay", "expire", "prepare", "ship", "deliver", "confirm", "cancel"] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

// 상태가 바뀔 때 outbox에 남길 알림(메일 템플릿 이름과 같다). 없으면 알림 없이 이력만 남는다
export type OrderNotice = "order.paid" | "order.preparing" | "order.shipped" | "order.delivered" | "order.canceled";

type Rule = { from: readonly OrderStatus[]; to: OrderStatus; actors: readonly Actor[]; notice?: OrderNotice };

export const ORDER_TRANSITIONS: Record<OrderEvent, Rule> = {
  pay: { from: ["pending_payment"], to: "paid", actors: ["system"], notice: "order.paid" }, // PG 승인·웹훅
  expire: { from: ["pending_payment"], to: "canceled", actors: ["system"] }, // 결제 기한·결제 시작 실패·데모 정리(돈이 없어 알림 없음)
  prepare: { from: ["paid"], to: "preparing", actors: ["admin"], notice: "order.preparing" },
  ship: { from: ["preparing"], to: "shipped", actors: ["admin"], notice: "order.shipped" }, // 송장 입력
  deliver: { from: ["shipped"], to: "delivered", actors: ["admin", "system"], notice: "order.delivered" }, // 관리자가 앞당기거나 5일 뒤 자동
  confirm: { from: ["delivered"], to: "confirmed", actors: ["customer", "system"] }, // 손님이 누르거나 7일 뒤 자동
  cancel: { from: ["paid", "preparing"], to: "canceled", actors: ["admin"], notice: "order.canceled" }, // 재고 복구 + 전액 환불
};

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; notice?: OrderNotice }
  | { ok: false; reason: "state" | "actor" };

export function nextStatus(current: OrderStatus, event: OrderEvent, actor: Actor): TransitionResult {
  const rule = ORDER_TRANSITIONS[event];
  if (!rule.from.includes(current)) return { ok: false, reason: "state" };
  if (!rule.actors.includes(actor)) return { ok: false, reason: "actor" };
  return { ok: true, from: current, to: rule.to, notice: rule.notice };
}

// 지금 상태에서 이 행위자가 할 수 있는 사건(화면이 보일 버튼)
export function allowedEvents(current: OrderStatus, actor: Actor): OrderEvent[] {
  return ORDER_EVENTS.filter((e) => nextStatus(current, e, actor).ok);
}

// 반품 요청의 상태. 승인·거절은 관리자, 완료는 환불이 끝났거나(시스템) 교환품 송장을 넣었을 때(관리자)
export const RETURN_STATUSES = ["requested", "approved", "rejected", "completed"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const RETURN_EVENTS = ["approve", "reject", "complete"] as const;
export type ReturnEvent = (typeof RETURN_EVENTS)[number];
export type ReturnNotice = "return.approved" | "return.rejected";

export const RETURN_TRANSITIONS: Record<ReturnEvent, { from: readonly ReturnStatus[]; to: ReturnStatus; actors: readonly Actor[]; notice?: ReturnNotice }> = {
  approve: { from: ["requested"], to: "approved", actors: ["admin"], notice: "return.approved" },
  reject: { from: ["requested"], to: "rejected", actors: ["admin"], notice: "return.rejected" },
  complete: { from: ["approved"], to: "completed", actors: ["admin", "system"] },
};

export function nextReturnStatus(current: ReturnStatus, event: ReturnEvent, actor: Actor) {
  const rule = RETURN_TRANSITIONS[event];
  if (!rule.from.includes(current)) return { ok: false as const, reason: "state" as const };
  if (!rule.actors.includes(actor)) return { ok: false as const, reason: "actor" as const };
  return { ok: true as const, from: current, to: rule.to, notice: rule.notice };
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "결제 대기",
  paid: "결제 완료",
  preparing: "배송 준비 중",
  shipped: "배송 중",
  delivered: "배송 완료",
  confirmed: "구매 확정",
  canceled: "취소됨",
};
