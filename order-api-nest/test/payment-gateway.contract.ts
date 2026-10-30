import type { INestApplication } from "@nestjs/common";
import type { ProviderId } from "../src/payments/payment-gateway.js";
import { PaymentGateways } from "../src/payments/payment-gateways.js";
import { resolveStaleRefunds } from "../src/payments/refund-resolver.js";
import { RefundsService } from "../src/payments/refunds.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { client, paidNotices, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

// PaymentGateway 계약: 같은 흐름을 Stripe·토스 두 구현에 대해 시뮬레이터로 돌린다(검색 엔진 계약과 같은 모양)
//   driver.approve: 구매자가 결제창에서 결제를 끝내고 API가 그것을 알게 되는 PG별 경로
//     Stripe: 결제창 완료 → 서명된 웹훅   토스: 위젯 인증 → 콘솔이 POST /payments/toss/confirm
export type ContractDriver = {
  provider: ProviderId;
  simulatorEnv: "STRIPE_SIMULATOR_URL" | "TOSS_SIMULATOR_URL";
  refundOp: string; // 시뮬레이터 호출 수의 환불 항목 이름
  approve(ctx: { sim: Simulator; baseUrl: string; userToken: string; providerOrderId: string; amount: number }): Promise<void>;
};

export function paymentGatewayContract(driver: ContractDriver) {
  describe(`PaymentGateway 계약 - ${driver.provider}`, () => {
    let app: INestApplication;
    let baseUrl: string;
    let sim: Simulator;
    let tokens: { user: string; admin: string };

    beforeAll(async () => {
      process.env.PAYMENT_TIMEOUT_MS = "400";
      ({ app, baseUrl } = await startPaymentApp());
      sim = await startSimulator(driver.provider, baseUrl);
      process.env[driver.simulatorEnv] = sim.url;
    });

    beforeEach(async () => {
      await sim.reset();
      tokens = await seedPaymentData(baseUrl);
    });

    afterAll(async () => {
      delete process.env[driver.simulatorEnv];
      delete process.env.PAYMENT_TIMEOUT_MS;
      await sim.stop();
      await app.close();
    });

    const refund = (orderId: number, amount: number, key: string) =>
      client(baseUrl, tokens.admin).post(`/admin/orders/${orderId}/refunds`, { amount, reason: "고객 요청" }, { "Idempotency-Key": key });

    // 주문 → 결제 완료까지
    const paidOrder = async () => {
      const started = await client(baseUrl, tokens.user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], provider: driver.provider });
      expect(started.status).toBe(201);
      expect(started.body.provider).toBe(driver.provider);
      const ready = await paymentOf(started.body.id);
      expect(ready).toMatchObject({ provider: driver.provider, status: "ready", amount: 10_000 });
      await driver.approve({ sim, baseUrl, userToken: tokens.user, providerOrderId: ready.providerOrderId, amount: 10_000 });
      return { orderId: started.body.id as number, payment: await paymentOf(started.body.id) };
    };

    it("시작 → 승인(paid) → 조회 → 부분 환불 두 번 → 남은 금액보다 큰 환불은 409", async () => {
      const { orderId, payment } = await paidOrder();
      expect(payment.status).toBe("paid");
      expect(payment.providerPaymentKey).toBeTruthy();
      expect((await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).paid).toBe(true);
      expect(await paidNotices()).toBe(1);

      const gateway = app.get(PaymentGateways).get(driver.provider);
      expect(await gateway.fetchPayment(payment.providerPaymentKey!)).toMatchObject({ status: "paid", totalAmount: 10_000, refundedAmount: 0 });

      const first = await refund(orderId, 3_000, "r-1");
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: "succeeded", payment: { status: "partial_refunded", refunded: 3_000, remaining: 7_000 } });
      const second = await refund(orderId, 3_000, "r-2");
      expect(second.status).toBe(201);
      expect(second.body.payment).toMatchObject({ status: "partial_refunded", refunded: 6_000, remaining: 4_000 });

      const tooMuch = await refund(orderId, 5_000, "r-3");
      expect(tooMuch.status).toBe(409);
      expect(await adminDb.refund.count()).toBe(2);
      expect((await paymentOf(orderId)).status).toBe("partial_refunded");

      const pg = await gateway.fetchPayment(payment.providerPaymentKey!);
      expect(pg).toMatchObject({ status: "partial_refunded", refundedAmount: 6_000 });
      expect(pg.refunds).toHaveLength(2);
      expect((await sim.calls())[driver.refundOp]).toBe(2);
    });

    it("남은 금액을 모두 환불하면 refunded, 그 뒤 환불은 409", async () => {
      const { orderId } = await paidOrder();
      expect((await refund(orderId, 10_000, "all")).body.payment).toMatchObject({ status: "refunded", remaining: 0 });
      expect((await refund(orderId, 1, "more")).status).toBe(409);
    });

    it("같은 멱등 키로 다시 보내면(동시에 와도) 환불 행은 하나, PG 호출도 한 번", async () => {
      const { orderId } = await paidOrder();
      const [a, b] = await Promise.all([refund(orderId, 3_000, "same"), refund(orderId, 3_000, "same")]);
      // 먼저 잠근 쪽이 201, 다른 쪽은 그 행을 받는다(PG 응답 전이면 202 requested, 뒤면 200)
      const statuses = [a.status, b.status].sort();
      expect(statuses[0] === 201 ? statuses[1] : statuses[0]).toBeOneOf([200, 202]);
      expect(statuses).toContain(201);
      expect(a.body.id).toBe(b.body.id);
      const again = await refund(orderId, 3_000, "same");
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(a.body.id);
      expect(await adminDb.refund.count()).toBe(1);
      expect((await sim.calls())[driver.refundOp]).toBe(1);
      expect((await refund(orderId, 2_000, "same")).status).toBe(422); // 같은 키, 다른 내용
    });

    it("PG가 시간 초과면 requested로 남고, 다시 보내도 이중 환불이 없으며, resolve-refunds가 재조회로 succeeded를 확정한다", async () => {
      const { orderId } = await paidOrder();
      await sim.fault(driver.refundOp, "timeout", { delayMs: 1_500 });
      const timedOut = await refund(orderId, 3_000, "slow");
      expect(timedOut.status).toBe(202);
      expect(timedOut.body).toMatchObject({ status: "requested", payment: { refunded: 0, remaining: 7_000 } });

      const retried = await refund(orderId, 3_000, "slow");
      expect(retried.status).toBe(202);
      expect((await sim.calls())[driver.refundOp]).toBe(1); // 재요청은 PG를 부르지 않는다
      // 결과를 모르는 3,000원도 남은 금액에서 뺀다
      expect((await refund(orderId, 8_000, "other")).status).toBe(409);

      const deps = { prisma: app.get(PrismaService), gateways: app.get(PaymentGateways), refunds: app.get(RefundsService) };
      expect(await resolveStaleRefunds(deps, { olderThanMs: 0 })).toEqual({ checked: 1, succeeded: 1, failed: 0, pending: 0 });
      const row = await adminDb.refund.findFirstOrThrow({ where: { idempotencyKey: "slow" } });
      expect(row.status).toBe("succeeded");
      expect(row.providerRefundKey).toBeTruthy();
      expect((await paymentOf(orderId)).status).toBe("partial_refunded");
      expect((await sim.calls())[driver.refundOp]).toBe(1); // PG에 이미 있던 환불을 찾았다(다시 환불하지 않았다)
      const pg = await deps.gateways.get(driver.provider).fetchPayment((await paymentOf(orderId)).providerPaymentKey!);
      expect(pg.refundedAmount).toBe(3_000);
    });

    it("PG가 받지 못한 환불(503)은 resolve-refunds가 같은 멱등 키로 다시 보내 확정한다", async () => {
      const { orderId } = await paidOrder();
      await sim.fault(driver.refundOp, "unavailable");
      expect((await refund(orderId, 2_000, "lost")).status).toBe(202);
      const deps = { prisma: app.get(PrismaService), gateways: app.get(PaymentGateways), refunds: app.get(RefundsService) };
      expect(await resolveStaleRefunds(deps, { olderThanMs: 0 })).toMatchObject({ succeeded: 1 });
      expect((await sim.calls())[driver.refundOp]).toBe(2);
      expect((await refund(orderId, 2_000, "lost")).body).toMatchObject({ status: "succeeded", payment: { refunded: 2_000 } });
    });
  });
}
