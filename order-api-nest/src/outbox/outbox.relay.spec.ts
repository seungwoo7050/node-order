import { mailFor } from "../mail/templates.js";
import { orderIdOf } from "./outbox.relay.js";

describe("orderIdOf", () => {
  it("order.created는 주문 자체의 id", () => {
    expect(orderIdOf({ type: "order.created", payload: { id: 6, price: 450000 } })).toBe(6);
  });
  it("order.paid는 orderId", () => {
    expect(orderIdOf({ type: "order.paid", payload: { orderId: 6 } })).toBe(6);
  });
  it("상태 전이·반품 알림도 orderId", () => {
    expect(orderIdOf({ type: "order.shipped", payload: { orderId: 7, from: "preparing", to: "shipped" } })).toBe(7);
    expect(orderIdOf({ type: "return.approved", payload: { orderId: 8, returnId: 1 } })).toBe(8);
  });
});

describe("mailFor - 종류별 메일 템플릿", () => {
  it.each(["order.preparing", "order.shipped", "order.delivered", "order.canceled", "return.approved", "return.rejected"])("%s는 같은 이름의 템플릿", (type) => {
    expect(mailFor(type, 3).template).toBe(type);
    expect(mailFor(type, 3).subject).toContain("주문 #3");
  });
  it("발송 메일에 택배사와 송장번호, 반품 승인 메일에 환불액이 들어간다", () => {
    expect(mailFor("order.shipped", 3, { carrierName: "CJ대한통운", trackingNumber: "123456789012" }).subject).toBe("주문 #3 발송: CJ대한통운 123456789012");
    expect(mailFor("return.approved", 3, { kind: "refund", refundAmount: 24_000 }).subject).toBe("주문 #3 반품 승인 - 24,000원 환불");
  });
  it("모르는 종류는 generic", () => {
    expect(mailFor("something.else", 3)).toEqual({ template: "generic", subject: "주문 #3 알림" });
  });
});
