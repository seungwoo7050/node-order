import {
  ACTORS, ORDER_EVENTS, ORDER_STATUSES, RETURN_EVENTS, RETURN_STATUSES, allowedEvents, nextReturnStatus, nextStatus,
  type Actor, type OrderEvent, type OrderStatus, type ReturnEvent, type ReturnStatus,
} from "./order-state.js";

// 기대 표를 구현과 따로 적는다: 여기 없는 (상태, 사건, 행위자)는 모두 거부돼야 한다
const ALLOWED: [OrderStatus, OrderEvent, Actor, OrderStatus][] = [
  ["pending_payment", "pay", "system", "paid"],
  ["pending_payment", "expire", "system", "canceled"],
  ["paid", "prepare", "admin", "preparing"],
  ["paid", "cancel", "admin", "canceled"],
  ["preparing", "ship", "admin", "shipped"],
  ["preparing", "cancel", "admin", "canceled"],
  ["shipped", "deliver", "admin", "delivered"],
  ["shipped", "deliver", "system", "delivered"],
  ["delivered", "confirm", "customer", "confirmed"],
  ["delivered", "confirm", "system", "confirmed"],
];

const allCases = ORDER_STATUSES.flatMap((s) => ORDER_EVENTS.flatMap((e) => ACTORS.map((a) => [s, e, a] as const)));

describe("주문 상태 기계", () => {
  it(`모든 (상태, 사건, 행위자) ${allCases.length}쌍 가운데 표에 있는 ${ALLOWED.length}쌍만 통과한다`, () => {
    for (const [status, event, actor] of allCases) {
      const expected = ALLOWED.find(([s, e, a]) => s === status && e === event && a === actor);
      const result = nextStatus(status, event, actor);
      if (expected) expect(result, `${status} --${event}(${actor})-->`).toMatchObject({ ok: true, from: status, to: expected[3] });
      else expect(result.ok, `${status} --${event}(${actor})--> 는 거부돼야 한다`).toBe(false);
    }
  });

  it("상태가 맞아도 행위자가 다르면 actor로, 상태가 틀리면 state로 거부한다", () => {
    expect(nextStatus("preparing", "ship", "customer")).toEqual({ ok: false, reason: "actor" });
    expect(nextStatus("shipped", "ship", "admin")).toEqual({ ok: false, reason: "state" });
  });

  it("끝 상태(confirmed, canceled)에서는 누구도 아무 사건도 일으킬 수 없다", () => {
    for (const s of ["confirmed", "canceled"] as const) for (const a of ACTORS) expect(allowedEvents(s, a)).toEqual([]);
  });

  it("관리자가 지금 상태에서 할 수 있는 동작", () => {
    expect(allowedEvents("paid", "admin")).toEqual(["prepare", "cancel"]);
    expect(allowedEvents("preparing", "admin")).toEqual(["ship", "cancel"]);
    expect(allowedEvents("shipped", "admin")).toEqual(["deliver"]);
    expect(allowedEvents("delivered", "admin")).toEqual([]);
  });

  it("상태가 바뀌면 알림 이름이 붙는다(구매확정·결제 기한 취소는 알림 없음)", () => {
    expect(nextStatus("preparing", "ship", "admin")).toMatchObject({ notice: "order.shipped" });
    expect(nextStatus("paid", "cancel", "admin")).toMatchObject({ notice: "order.canceled" });
    expect(nextStatus("delivered", "confirm", "customer")).not.toHaveProperty("notice", expect.anything());
    expect(nextStatus("pending_payment", "expire", "system")).not.toHaveProperty("notice", expect.anything());
  });
});

const RETURN_ALLOWED: [ReturnStatus, ReturnEvent, Actor, ReturnStatus][] = [
  ["requested", "approve", "admin", "approved"],
  ["requested", "reject", "admin", "rejected"],
  ["approved", "complete", "admin", "completed"],
  ["approved", "complete", "system", "completed"],
];

describe("반품 요청 상태 기계", () => {
  it("모든 (상태, 사건, 행위자) 쌍 가운데 표에 있는 것만 통과한다", () => {
    for (const status of RETURN_STATUSES) for (const event of RETURN_EVENTS) for (const actor of ACTORS) {
      const expected = RETURN_ALLOWED.find(([s, e, a]) => s === status && e === event && a === actor);
      const result = nextReturnStatus(status, event, actor);
      if (expected) expect(result).toMatchObject({ ok: true, to: expected[3] });
      else expect(result.ok, `${status} --${event}(${actor})-->`).toBe(false);
    }
  });
});
