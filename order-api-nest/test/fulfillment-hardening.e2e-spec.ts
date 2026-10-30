import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, demoAdminToken, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

const HOUR = 3600_000;

// 28 devlog가 코드에서 찾은 결함의 회귀 테스트:
//   1. 결제 기한 작업이 status만 보고, 옛 API가 옛 칸(paid, canceled_at)으로 결제·취소한 주문을 다시 취소한다
//   3. 구매확정과 반품 신청이 겹치면 둘 다 성공한다 / PG가 거절한 환불을 다시 시도할 길이 없다
// 상품 20,000원(배송비 3,000원, 1개 결제 23,000원), 재고 10
describe("주문 이행 - 옛 칸 동기화·동시성·환불 재시도", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    process.env.PAYMENT_TIMEOUT_MS = "400";
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
  });

  beforeEach(async () => {
    await sim.reset();
    tokens = await seedPaymentData(baseUrl, 20_000);
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    delete process.env.PAYMENT_TIMEOUT_MS;
    await sim.stop();
    await app.close();
  });

  const user = () => client(baseUrl, tokens.user);
  const admin = () => client(baseUrl, tokens.admin);
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;

  const paidOrder = async (quantity = 1) => {
    const started = await user().post("/orders/checkout", { items: [{ productId: 1, quantity }], shipping: SHIPPING, ...CONSENT, provider: "toss" });
    expect(started.status).toBe(201);
    const payment = await paymentOf(started.body.id);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    expect((await user().post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: payment.amount })).status).toBe(200);
    return started.body.id as number;
  };
  const deliveredOrder = async (quantity = 1) => {
    const id = await paidOrder(quantity);
    await admin().post(`/admin/orders/${id}/prepare`);
    await admin().post(`/admin/orders/${id}/shipment`, { carrier: "cj", trackingNumber: "123456789012" });
    expect((await admin().post(`/admin/orders/${id}/deliver`)).status).toBe(200);
    return id;
  };

  // 결제 대기로 하루 넘게 둔 주문(재고 2개를 잡고 있다). 옛 API가 쓴 것처럼 옛 칸만 바꾸는 것은 테스트가 SQL로 한다
  const staleOrder = async () => {
    const started = await user().post("/orders/checkout", { items: [{ productId: 1, quantity: 2 }], shipping: SHIPPING, ...CONSENT, provider: "toss" });
    expect(started.status).toBe(201);
    const id = started.body.id as number;
    await adminDb.order.update({ where: { id }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    return id;
  };
  const autoAdvance = () => app.get(FulfillmentService).autoAdvance(new Date());

  describe("결제 기한 작업과 옛 칸(expand 기간)", () => {
    it("옛 API가 옛 칸으로 결제 완료한 주문(status는 그대로)은 결제 기한으로 취소하지 않고 status를 paid로 맞춘다", async () => {
      const id = await staleOrder();
      expect(await stock()).toBe(8);
      // 옛 API(27)는 status를 모른다: orders.paid와 payments만 바꾼다
      await adminDb.$executeRaw`UPDATE payments SET status = 'paid', provider_payment_key = 'old-api-key', approved_at = now() WHERE order_id = ${id}`;
      await adminDb.$executeRaw`UPDATE orders SET paid = true WHERE id = ${id}`;

      const result = await autoAdvance();
      expect(result.expired).toBe(0);
      const order = await adminDb.order.findUniqueOrThrow({ where: { id } });
      expect(order).toMatchObject({ status: "paid", paid: true, canceledAt: null });
      expect(await stock()).toBe(8); // 재고를 돌려놓지 않는다
      expect(await adminDb.orderStatusHistory.findMany({ where: { orderId: id }, select: { fromStatus: true, toStatus: true, actorType: true } }))
        .toEqual([{ fromStatus: "pending_payment", toStatus: "paid", actorType: "system" }]);
    });

    it("옛 API가 옛 칸으로 취소(재고 복구까지)한 주문은 다시 취소하지 않아 재고가 한 번만 돌아온다", async () => {
      const id = await staleOrder();
      // 옛 API의 취소: canceled_at + 결제 행 canceled + 재고 복구
      await adminDb.$executeRaw`UPDATE payments SET status = 'canceled' WHERE order_id = ${id}`;
      await adminDb.$executeRaw`UPDATE orders SET canceled_at = now() WHERE id = ${id}`;
      await adminDb.$executeRaw`UPDATE products SET stock = stock + 2 WHERE id = 1`;
      expect(await stock()).toBe(10);

      await autoAdvance();
      expect(await stock()).toBe(10);
      expect((await adminDb.order.findUniqueOrThrow({ where: { id } })).status).toBe("canceled");
      expect(await adminDb.orderStatusHistory.count({ where: { orderId: id, toStatus: "canceled" } })).toBe(1);
    });

    it("결제 행이 이미 결제 완료면 orders 칸이 늦어도 결제 기한 취소를 하지 않는다", async () => {
      const id = await staleOrder();
      await adminDb.$executeRaw`UPDATE payments SET status = 'paid', provider_payment_key = 'pk-ahead', approved_at = now() WHERE order_id = ${id}`;
      expect((await autoAdvance()).expired).toBe(0);
      expect(await adminDb.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "pending_payment", canceledAt: null });
      expect(await stock()).toBe(8);
    });

    it("그대로 결제 대기인 주문은 전처럼 취소하고 재고를 돌려놓는다", async () => {
      const id = await staleOrder();
      expect((await autoAdvance()).expired).toBe(1);
      expect((await adminDb.order.findUniqueOrThrow({ where: { id } })).status).toBe("canceled");
      expect(await stock()).toBe(10);
    });
  });

  describe("구매확정과 반품 신청이 겹칠 때", () => {
    // 주문 행을 다른 연결로 잠가 두고 두 요청을 차례로 줄 세운 뒤 푼다(어느 쪽이 먼저 잠금을 얻는지 정해 둔다)
    const withRowLocked = async (orderId: number, fire: (waitForWaiters: (n: number) => Promise<void>) => Promise<void>) => {
      const locker = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
      await locker.connect();
      const waiters = async () => Number((await adminDb.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`)[0]!.n);
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
        await fire(async (n) => expect.poll(waiters, { timeout: 5_000, interval: 50 }).toBeGreaterThanOrEqual(n));
      } finally {
        await locker.query("COMMIT").catch(() => {});
        await locker.end();
      }
    };

    it("반품 신청이 먼저 잠금을 얻으면 구매확정은 409이고, 반품 요청이 남은 채 구매확정되지 않는다", async () => {
      const id = await deliveredOrder();
      let pending: Promise<{ status: number }>[] = [];
      await withRowLocked(id, async (waitFor) => {
        const ret = user().post(`/me/orders/${id}/returns`, { kind: "refund", reason: "defective", items: [{ productId: 1, quantity: 1 }] });
        await waitFor(1);
        const conf = user().post(`/me/orders/${id}/confirm`);
        await waitFor(2);
        pending = [ret, conf];
      });
      const results = await Promise.all(pending);
      const [ret, conf] = results;
      expect(ret!.status).toBe(201);
      expect(conf!.status).toBe(409);
      const order = await adminDb.order.findUniqueOrThrow({ where: { id } });
      expect(order.status).toBe("delivered");
      expect(await adminDb.return.count({ where: { orderId: id, status: "requested" } })).toBe(1);
    });

    it("자동 구매확정도 같은 잠금을 잡는다: 반품 신청이 먼저면 확정하지 않는다", async () => {
      const id = await deliveredOrder();
      await adminDb.order.update({ where: { id }, data: { statusChangedAt: new Date(Date.now() - 8 * 24 * HOUR) } });
      let pending: Promise<unknown>[] = [];
      await withRowLocked(id, async (waitFor) => {
        const ret = user().post(`/me/orders/${id}/returns`, { kind: "refund", reason: "defective", items: [{ productId: 1, quantity: 1 }] });
        await waitFor(1);
        const auto = autoAdvance();
        await waitFor(2);
        pending = [ret, auto];
      });
      const [ret, auto] = (await Promise.all(pending)) as [{ status: number }, { confirmed: number }];
      expect(ret.status).toBe(201);
      expect(auto.confirmed).toBe(0);
      expect((await adminDb.order.findUniqueOrThrow({ where: { id } })).status).toBe("delivered");
    });
  });

  describe("PG가 거절한 환불의 재시도", () => {
    it("반품 환불을 PG가 거절하면 failed로 남고, 관리자가 새 시도 키로 다시 요청하면 환불되고 반품이 완료된다", async () => {
      const id = await deliveredOrder();
      const requested = await user().post(`/me/orders/${id}/returns`, { kind: "refund", reason: "defective", items: [{ productId: 1, quantity: 1 }] });
      const returnId = requested.body.returns[0].id as number;
      await sim.fault("cancel", "already_processed");
      const approved = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(approved.status).toBe(502);
      const failed = await adminDb.refund.findUniqueOrThrow({ where: { idempotencyKey: `return-${returnId}` } });
      expect(failed.status).toBe("failed");
      const callsBefore = (await sim.calls()).cancel;

      // 승인을 다시 눌러도 같은 멱등 키라 PG를 다시 부르지 않는다(실패 그대로)
      const again = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(again.body).toMatchObject({ replayed: true, refund: { status: "failed" } });
      expect((await sim.calls()).cancel).toBe(callsBefore);

      // 데모 관리자는 다시 시도할 수 없다
      expect((await client(baseUrl, await demoAdminToken(baseUrl)).post(`/admin/orders/${id}/refunds/${failed.id}/retry`)).status).toBe(403);

      const retried = await admin().post(`/admin/orders/${id}/refunds/${failed.id}/retry`);
      expect(retried.status).toBe(201);
      expect(retried.body).toMatchObject({ refund: { amount: 20_000, status: "succeeded" }, order: { returns: [{ id: returnId, status: "completed", refund: { status: "succeeded" } }] } });
      expect(await adminDb.refund.findUniqueOrThrow({ where: { idempotencyKey: `return-${returnId}-r1` } })).toMatchObject({ status: "succeeded", amount: 20_000 });
      expect((await sim.calls()).cancel).toBe(callsBefore + 1);

      // 같은 실패를 다시 눌러도(동시에 두 번이어도) 시도는 하나: 이미 성공한 시도가 있으면 409
      expect((await admin().post(`/admin/orders/${id}/refunds/${failed.id}/retry`)).status).toBe(409);
      expect((await sim.calls()).cancel).toBe(callsBefore + 1);
    });

    it("실패하지 않은 환불은 다시 시도할 수 없고, 누적 한도 검사는 그대로다", async () => {
      const id = await paidOrder();
      const ok = await admin().post(`/admin/orders/${id}/refunds`, { amount: 10_000, reason: "부분 환불" }, { "Idempotency-Key": "partial-1" });
      expect(ok.status).toBe(201);
      expect((await admin().post(`/admin/orders/${id}/refunds/${ok.body.id}/retry`)).status).toBe(409);

      await sim.fault("cancel", "already_processed");
      const rejected = await admin().post(`/admin/orders/${id}/refunds`, { amount: 13_000, reason: "나머지" }, { "Idempotency-Key": "partial-2" });
      expect(rejected.status).toBe(502);
      const failedId = (await adminDb.refund.findUniqueOrThrow({ where: { idempotencyKey: "partial-2" } })).id;
      // 그 사이 다른 환불로 남은 금액이 줄었으면 재시도도 한도에 걸린다
      expect((await admin().post(`/admin/orders/${id}/refunds`, { amount: 5_000, reason: "다른 환불" }, { "Idempotency-Key": "partial-3" })).status).toBe(201);
      const over = await admin().post(`/admin/orders/${id}/refunds/${failedId}/retry`);
      expect(over.status).toBe(409);
      expect(over.body.message).toMatch(/환불할 수 있는 금액은 8,000원/);
    });
  });
});
