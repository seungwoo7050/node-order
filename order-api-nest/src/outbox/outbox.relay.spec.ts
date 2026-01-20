import { orderIdOf } from "./outbox.relay.js";

describe("orderIdOf", () => {
  it("order.created는 주문 자체의 id", () => {
    expect(orderIdOf({ type: "order.created", payload: { id: 6, price: 450000 } })).toBe(6);
  });
  it("order.paid는 orderId", () => {
    expect(orderIdOf({ type: "order.paid", payload: { orderId: 6 } })).toBe(6);
  });
});
