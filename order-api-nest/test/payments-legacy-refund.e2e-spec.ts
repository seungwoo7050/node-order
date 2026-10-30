import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { client, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 0030 백필로 옮긴 옛 Stripe 결제는 결제 키(PaymentIntent)가 비어 있다.
// 환불할 때 저장된 세션 id로 PG에 물어 결제 키를 채우고(한 번만), 그다음 환불한다
const migration = new URL("../prisma/migrations/0030_payments_refunds/migration.sql", import.meta.url);

describe("백필한 옛 결제의 환불", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };
  let backfill: string;

  beforeAll(async () => {
    const sql = await readFile(migration, "utf8");
    backfill = sql.slice(sql.indexOf("-- backfill"));
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("stripe", baseUrl);
    process.env.STRIPE_SIMULATOR_URL = sim.url;
  });

  beforeEach(async () => {
    await sim.reset();
    tokens = await seedPaymentData(baseUrl);
  });

  afterAll(async () => {
    delete process.env.STRIPE_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  const refund = (orderId: number, amount: number, key: string) =>
    client(baseUrl, tokens.admin).post(`/admin/orders/${orderId}/refunds`, { amount, reason: "반품" }, { "Idempotency-Key": key });

  // 27 이전에 Stripe로 결제를 끝낸 주문: orders에 세션 id와 paid만 있다. 그 위에서 0030 백필을 돌린다
  const legacyStripeOrder = async (opts: { pay: boolean }) => {
    const session = await app.get(StripeGateway).createCheckoutSession({ id: 900, price: 10_000 });
    if (opts.pay) await fetch(`${sim.url}/c/pay/${session.id}/complete`, { method: "POST", redirect: "manual" });
    const order = await adminDb.order.create({ data: { userId: "kim", totalAmount: 10_000, paid: true, stripeSessionId: session.id } });
    await adminDb.$executeRawUnsafe(backfill);
    expect(await paymentOf(order.id)).toMatchObject({ provider: "stripe", status: "paid", providerOrderId: session.id, providerPaymentKey: null });
    return order.id;
  };

  it("세션 id로 결제 키를 한 번 채워 저장하고 환불한다(두 번째 환불은 다시 묻지 않는다)", async () => {
    const orderId = await legacyStripeOrder({ pay: true });
    const first = await refund(orderId, 3_000, "legacy-1");
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: "succeeded", payment: { status: "partial_refunded", remaining: 7_000 } });
    const key = (await paymentOf(orderId)).providerPaymentKey;
    expect(key).toMatch(/^pi_sim_/);
    expect((await sim.calls()).session).toBe(1);

    expect((await refund(orderId, 7_000, "legacy-2")).body.payment).toMatchObject({ status: "refunded", remaining: 0 });
    expect((await sim.calls()).session).toBe(1);
    expect((await sim.calls()).refund).toBe(2);
    expect((await paymentOf(orderId)).providerPaymentKey).toBe(key);
  });

  it("PG에서 결제를 찾지 못하면(세션이 결제되지 않음) 409, 결제 키는 비어 있는 채로 둔다", async () => {
    const orderId = await legacyStripeOrder({ pay: false });
    const res = await refund(orderId, 3_000, "legacy-x");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/결제 키를 찾지 못해/);
    expect((await paymentOf(orderId)).providerPaymentKey).toBeNull();
    expect(await adminDb.refund.count()).toBe(0);
  });

  it("manual 결제(관리자가 결제 완료로 만든 주문)는 PG 환불 대상이 아니라 409, 사유를 밝힌다", async () => {
    const created = await client(baseUrl, tokens.admin).post("/orders", { user: "kim", price: 10_000, paid: true });
    expect(created.status).toBe(201);
    expect(await paymentOf(created.body.id)).toMatchObject({ provider: "manual", status: "paid" });
    const res = await refund(created.body.id, 1_000, "manual-1");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("관리자·seed·데모가 결제 완료로 만든 주문(manual)은 PG를 거치지 않아 PG 환불 대상이 아닙니다");
    expect((await sim.calls()).session).toBe(0);
  });
});
