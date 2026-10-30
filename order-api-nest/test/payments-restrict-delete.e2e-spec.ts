import { deleteUsers } from "../src/auth/demo-user.js";
import { deleteDemoUserOrders, deleteOrdersKeepingPgPayments } from "../src/orders/delete-orders.js";
import { adminDb } from "./admin-db.js";

// 0031: 대금결제 기록은 주문을 지워도 사라지지 않는다(FK RESTRICT). 지워도 되는 결제 행만 코드가 명시적으로 지운다
describe("결제 기록 보존 - 주문 삭제", () => {
  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김" } });
    await adminDb.user.create({ data: { id: "demo-1", name: "데모 방문자", expiresAt: new Date(Date.now() - 1000) } });
    await adminDb.product.create({ data: { name: "마우스", price: 10_000, stock: 10 } });
  });

  type Kind = "toss" | "stripe" | "manual" | "none";
  const order = async (userId: string, kind: Kind, opts: { refunded?: boolean } = {}) => {
    const o = await adminDb.order.create({
      data: { userId, totalAmount: 10_000, paid: kind !== "none", items: { create: [{ productId: 1, quantity: 1, unitPrice: 10_000 }] } },
    });
    if (kind === "none") return o.id;
    const payment = await adminDb.payment.create({
      data: { orderId: o.id, provider: kind, providerOrderId: `po-${o.id}`, providerPaymentKey: kind === "manual" ? null : `pk-${o.id}`, amount: 10_000, status: "paid" },
    });
    if (opts.refunded) await adminDb.refund.create({ data: { paymentId: payment.id, amount: 3_000, reason: "반품", idempotencyKey: `rf-${o.id}`, status: "succeeded" } });
    return o.id;
  };

  it("stripe·toss 결제가 있는 주문을 직접 지우면 외래 키 위반으로 실패하고, 결제 기록은 남는다", async () => {
    const toss = await order("kim", "toss", { refunded: true });
    const stripe = await order("kim", "stripe");
    await adminDb.orderItem.deleteMany({});
    await expect(adminDb.order.delete({ where: { id: toss } })).rejects.toThrow();
    await expect(adminDb.order.delete({ where: { id: stripe } })).rejects.toThrow();
    await expect(adminDb.payment.deleteMany({ where: { orderId: toss } })).rejects.toThrow(); // 환불 기록이 결제를 붙잡는다
    expect(await adminDb.payment.count()).toBe(2);
    expect(await adminDb.refund.count()).toBe(1);
  });

  it("seed 정리: manual 결제·결제 없는 주문만 지우고 stripe·toss 결제가 있는 주문은 남긴다", async () => {
    const manual = await order("kim", "manual");
    const none = await order("kim", "none");
    const toss = await order("kim", "toss", { refunded: true });
    const stripe = await order("kim", "stripe");
    expect(await adminDb.$transaction((tx) => deleteOrdersKeepingPgPayments(tx, ["kim"]))).toEqual({ deleted: 2, kept: 2 });
    expect((await adminDb.order.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((o) => o.id)).toEqual([toss, stripe]);
    expect(await adminDb.payment.findMany({ where: { orderId: { in: [manual, none] } } })).toEqual([]);
    expect(await adminDb.payment.count()).toBe(2);
    expect(await adminDb.refund.count()).toBe(1);
  });

  it("데모 사용자 정리: 그 사용자의 결제·환불 기록(토스 포함)을 명시적으로 지우고 사용자를 지운다", async () => {
    await order("demo-1", "toss", { refunded: true });
    await order("demo-1", "manual");
    const kept = await order("kim", "toss");
    expect(await adminDb.$transaction((tx) => deleteUsers(tx, ["demo-1"]))).toBe(1);
    expect(await adminDb.order.findMany({ select: { id: true } })).toEqual([{ id: kept }]);
    expect(await adminDb.payment.count()).toBe(1);
    expect(await adminDb.refund.count()).toBe(0);
  });

  it("데모가 아닌 사용자의 결제 기록은 데모 정리 경로로 지울 수 없다", async () => {
    await order("kim", "toss");
    await expect(adminDb.$transaction((tx) => deleteDemoUserOrders(tx, ["kim"]))).rejects.toThrow(/데모 사용자/);
    expect(await adminDb.payment.count()).toBe(1);
  });
});
