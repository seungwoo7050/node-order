import { Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cancelUnpaidOrder } from "./cancel-unpaid-order.js";
import { markPaid } from "./payment-state.js";
import { webhookEvents } from "../metrics/metrics.js";

export type WebhookResult = "processed" | "duplicate" | "ignored";

const paymentSelect = { id: true, orderId: true, amount: true } as const;

// 세션의 결제 행. 없으면 orders.stripe_session_id로 주문을 찾아 결제 행을 만든다(멱등).
// blue/green 전환 사이: 0030 백필 뒤에도 옛 API는 세션을 orders.stripe_session_id에만 적어서, 그 웹훅을 버리면 결제가 반영되지 않는다.
// 만드는 모양은 0030 백필과 같다(ON CONFLICT DO NOTHING: 같은 세션의 웹훅이 동시에 와도 행은 하나)
async function findOrAdoptPayment(tx: Prisma.TransactionClient, sessionId: string) {
  const where = { provider_providerOrderId: { provider: "stripe" as const, providerOrderId: sessionId } };
  const payment = await tx.payment.findUnique({ where, select: paymentSelect });
  if (payment) return payment;
  const adopted = await tx.$executeRaw`
    INSERT INTO "payments" ("order_id", "provider", "provider_order_id", "amount", "status", "approved_at", "created_at", "updated_at")
    SELECT o."id", 'stripe', o."stripe_session_id", o."total_amount",
           (CASE WHEN o."paid" THEN 'paid' WHEN o."canceled_at" IS NOT NULL THEN 'canceled' ELSE 'ready' END)::"PaymentStatus",
           CASE WHEN o."paid" THEN o."created_at" END, o."created_at", CURRENT_TIMESTAMP
    FROM "orders" o WHERE o."stripe_session_id" = ${sessionId}
    ON CONFLICT DO NOTHING`;
  if (adopted > 0) new Logger(PaymentsService.name).warn(`결제 행 없는 Stripe 세션(옛 API가 만든 주문) → 결제 행을 만들었다: ${sessionId}`);
  return tx.payment.findUnique({ where, select: paymentSelect });
}

// Stripe 웹훅. 서명을 검증한 본문(컨트롤러)을 믿는다. 토스 웹훅은 서명 대신 PG 재조회를 한다(toss-payments.service.ts)
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(event: Stripe.Event): Promise<WebhookResult> {
    const result = await this.process(event);
    webhookEvents.inc({ type: event.type, result });
    return result;
  }

  private async process(event: Stripe.Event): Promise<WebhookResult> {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return "ignored";
    const session = event.data.object;

    try {
      const result = await this.prisma.asAdmin(async (tx): Promise<WebhookResult> => {
        const payment = await findOrAdoptPayment(tx, session.id);
        if (!payment) return "ignored";

        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });

        if (event.type === "checkout.session.completed") {
          if (session.payment_status !== "paid") return "ignored";
          if (session.amount_total != null && session.amount_total !== payment.amount) {
            this.logger.error(`Stripe 결제 금액 불일치: 세션 ${session.id} ${session.amount_total}원 ≠ 주문 #${payment.orderId} ${payment.amount}원`);
            return "ignored";
          }
          const intent = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
          await markPaid(tx, payment.id, { paymentKey: intent, approvedAt: event.created ? new Date(event.created * 1000) : null });
        } else {
          await cancelUnpaidOrder(tx, payment.orderId);
        }
        this.logger.log(`웹훅 처리: ${event.id} ${event.type} → 주문 #${payment.orderId}`);
        return "processed";
      });
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.log(`이미 처리한 웹훅: ${event.id} (${event.type})`);
        return "duplicate";
      }
      throw err;
    }
  }
}
