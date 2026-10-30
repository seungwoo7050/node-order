import { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import { PgError, type PgRefund, type ProviderId } from "./payment-gateway.js";
import type { PaymentGateways } from "./payment-gateways.js";
import type { RefundsService } from "./refunds.service.js";

export type ResolveResult = { checked: number; succeeded: number; failed: number; pending: number };

// 결과를 모르는 환불(requested)을 PG 재조회로 확정한다: npm run payments:resolve-refunds
//   1. PG의 결제를 다시 읽어, 아직 우리 DB에 없는 환불 가운데 이 요청과 맞는 것이 있으면 succeeded
//      (Stripe는 metadata.refund_id로, 토스는 우리 id를 실을 칸이 없어 금액으로 맞춘다)
//   2. 없으면 PG가 요청을 받지 못한 것이다. 같은 멱등 키로 다시 보낸다(받았는데 응답만 잃었다면 PG가 첫 결과를 돌려준다)
//   3. 이번에도 결과를 모르면 requested로 두고 다음 회차에 다시 본다
// 29의 대사 배치가 이것을 정기 작업으로 만든다
export async function resolveStaleRefunds(
  deps: { prisma: PrismaService; gateways: PaymentGateways; refunds: RefundsService; logger?: Logger },
  options: { olderThanMs: number; limit?: number },
): Promise<ResolveResult> {
  const logger = deps.logger ?? new Logger("RefundResolver");
  const stale = await deps.prisma.asAdmin((tx) => tx.refund.findMany({
    where: { status: "requested", createdAt: { lt: new Date(Date.now() - options.olderThanMs) } },
    include: { payment: { select: { provider: true, providerPaymentKey: true } } },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
  }));
  const result: ResolveResult = { checked: stale.length, succeeded: 0, failed: 0, pending: 0 };

  for (const refund of stale) {
    const { provider, providerPaymentKey } = refund.payment;
    if (provider === "manual" || !providerPaymentKey) {
      await deps.refunds.markFailed(refund.id, "PG 결제 키가 없는 결제");
      result.failed++;
      continue;
    }
    const gateway = deps.gateways.get(provider as ProviderId);
    try {
      const pg = await gateway.fetchPayment(providerPaymentKey);
      const known = new Set((await deps.prisma.asAdmin((tx) => tx.refund.findMany({
        where: { paymentId: refund.paymentId, status: "succeeded", providerRefundKey: { not: null } },
        select: { providerRefundKey: true },
      }))).map((r) => r.providerRefundKey));
      const match = pg.refunds.find((r) => !known.has(r.key) && (r.ref !== undefined ? r.ref === String(refund.id) : r.amount === refund.amount));
      const settled: PgRefund = match ?? (await gateway.refund(providerPaymentKey, { amount: refund.amount, reason: refund.reason, refundId: refund.id }, refund.idempotencyKey));
      await deps.refunds.markSucceeded(refund.id, settled.key);
      result.succeeded++;
      logger.log(`환불 확정: #${refund.id} ${refund.amount}원 → succeeded (${match ? "PG 재조회" : "같은 멱등 키로 재요청"}, ${settled.key})`);
    } catch (err) {
      if (err instanceof PgError && !err.unknownOutcome) {
        await deps.refunds.markFailed(refund.id, `${err.code ?? "REJECTED"}: ${err.message}`);
        result.failed++;
        logger.warn(`환불 확정: #${refund.id} → failed (${err.code}: ${err.message})`);
      } else {
        result.pending++;
        logger.warn(`환불 확정 보류: #${refund.id} - ${(err as Error).message}`);
      }
    }
  }
  return result;
}
