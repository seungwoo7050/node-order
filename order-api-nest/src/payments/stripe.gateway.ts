import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { PAYMENT_TIMEOUT_MS, PgError, type CheckoutOrder, type PaymentGateway, type PgPayment, type PgRefund, type StartedCheckout } from "./payment-gateway.js";

export type CheckoutSession = { id: string; url: string };

export const SIMULATOR_WEBHOOK_SECRET = "whsec_simulator";

function simulatorUrl(): URL | undefined {
  const url = process.env.STRIPE_SIMULATOR_URL;
  return url && process.env.NODE_ENV !== "production" ? new URL(url) : undefined;
}

// Stripe SDK 오류를 PG 계약의 PgError로 바꾼다. 연결 오류(시간 초과 포함)와 5xx는 결과를 모르는 실패다
function toPgError(err: unknown): unknown {
  if (!(err instanceof Stripe.errors.StripeError)) return err;
  if (err instanceof Stripe.errors.StripeConnectionError) {
    return new PgError(/timeout/i.test(err.message) ? "timeout" : "network", err.message, err.code);
  }
  if ((err.statusCode ?? 500) >= 500) return new PgError("network", err.message, err.code, err.statusCode);
  return new PgError("rejected", err.message, err.code, err.statusCode);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toPgError(err);
  }
}

@Injectable()
export class StripeGateway implements PaymentGateway {
  readonly id = "stripe" as const;
  private client?: Stripe;

  private get stripe(): Stripe {
    // 시간 초과는 우리가 정한다(PAYMENT_TIMEOUT_MS). SDK가 몰래 다시 보내지 않게 재시도는 끈다
    const options = { timeout: PAYMENT_TIMEOUT_MS(), maxNetworkRetries: 0 };
    const sim = simulatorUrl();
    if (sim) return (this.client ??= new Stripe("sk_test_simulator", { ...options, protocol: "http", host: sim.hostname, port: sim.port }));
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY 환경변수가 없습니다");
    return (this.client ??= new Stripe(key, options));
  }

  isConfigured(): boolean {
    return Boolean(simulatorUrl() || process.env.STRIPE_SECRET_KEY);
  }

  async startCheckout(order: CheckoutOrder, attemptKey?: string): Promise<StartedCheckout> {
    const session = await this.createCheckoutSession(order, attemptKey);
    return { providerOrderId: session.id, checkoutUrl: session.url };
  }

  async createCheckoutSession(order: { id: number; price: number }, attemptKey?: string): Promise<CheckoutSession> {
    const frontend = process.env.FRONTEND_URL!;
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: "krw", unit_amount: order.price, product_data: { name: `주문 #${order.id}` } } }],
        client_reference_id: String(order.id),
        metadata: { orderId: String(order.id) },
        success_url: `${frontend}/me/orders/${order.id}?checkout=success`,
        cancel_url: `${frontend}/shop?checkout=canceled&order=${order.id}`,
      },
      attemptKey ? { idempotencyKey: `checkout-${attemptKey}` } : undefined,
    );
    return { id: session.id, url: session.url! };
  }

  // Checkout은 Stripe가 결제를 끝내므로 승인 API가 없다. 세션을 다시 읽어 결제됐는지와 금액을 확인한다
  async confirm(input: { providerOrderId: string; amount: number }): Promise<PgPayment> {
    const session = await call(() => this.stripe.checkout.sessions.retrieve(input.providerOrderId));
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (session.payment_status !== "paid" || !intent) throw new PgError("rejected", `결제가 끝나지 않은 세션: ${session.id}`, "NOT_PAID");
    if (session.amount_total !== input.amount) throw new PgError("rejected", `금액 불일치: ${session.amount_total} ≠ ${input.amount}`, "AMOUNT_MISMATCH");
    return { ...(await this.fetchPayment(intent)), providerOrderId: session.id };
  }

  // 0030 백필은 Stripe 세션 id만 옮겼다. 세션의 payment_intent가 결제 키다
  async findPaymentKey(sessionId: string): Promise<string | null> {
    let session: Stripe.Checkout.Session;
    try {
      session = await call(() => this.stripe.checkout.sessions.retrieve(sessionId));
    } catch (err) {
      if (err instanceof PgError && err.status === 404) return null;
      throw err;
    }
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    return session.payment_status === "paid" && intent ? intent : null;
  }

  async fetchPayment(paymentKey: string): Promise<PgPayment> {
    const [intent, refunds] = await call(() =>
      Promise.all([this.stripe.paymentIntents.retrieve(paymentKey), this.stripe.refunds.list({ payment_intent: paymentKey, limit: 100 })]),
    );
    const done = refunds.data.filter((r) => r.status === "succeeded" || r.status === "pending");
    const refundedAmount = done.reduce((sum, r) => sum + r.amount, 0);
    const paid = intent.status === "succeeded";
    return {
      paymentKey: intent.id,
      status: !paid ? (intent.status === "canceled" ? "canceled" : "ready")
        : refundedAmount === 0 ? "paid" : refundedAmount >= intent.amount ? "refunded" : "partial_refunded",
      totalAmount: intent.amount,
      refundedAmount,
      approvedAt: paid ? new Date(intent.created * 1000) : null,
      refunds: done.map((r) => ({ key: r.id, amount: r.amount, ref: r.metadata?.refund_id })),
    };
  }

  // 기간 안에 만들어진 PaymentIntent(GET /v1/payment_intents?created[gte]&created[lt])와 환불(GET /v1/refunds?created[...])을
  // starting_after로 끝까지 읽고, 그 결제들을 fetchPayment로 다시 읽는다(환불 합계가 결제마다 필요하다)
  async listTransactions(period: { from: Date; to: Date }): Promise<PgPayment[]> {
    const created = { gte: Math.floor(period.from.getTime() / 1000), lt: Math.floor(period.to.getTime() / 1000) };
    const ids = new Set<string>();
    let after: string | undefined;
    do {
      const page = await call(() => this.stripe.paymentIntents.list({ created, limit: 100, ...(after ? { starting_after: after } : {}) }));
      for (const pi of page.data) if (pi.status === "succeeded" || pi.status === "canceled") ids.add(pi.id);
      after = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (after);
    do {
      const page = await call(() => this.stripe.refunds.list({ created, limit: 100, ...(after ? { starting_after: after } : {}) }));
      for (const r of page.data) {
        const pi = typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id;
        if (pi) ids.add(pi);
      }
      after = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (after);
    const payments: PgPayment[] = [];
    for (const id of ids) payments.push(await this.fetchPayment(id));
    return payments.filter((p) => p.approvedAt); // 결제되지 않고 취소된 PaymentIntent는 빼고
  }

  async refund(paymentKey: string, input: { amount: number; reason: string; refundId: number }, idempotencyKey: string): Promise<PgRefund> {
    const refund = await call(() =>
      this.stripe.refunds.create(
        { payment_intent: paymentKey, amount: input.amount, metadata: { refund_id: String(input.refundId), reason: input.reason } },
        { idempotencyKey: `refund-${idempotencyKey}` },
      ),
    );
    if (refund.status === "failed" || refund.status === "canceled") throw new PgError("rejected", `Stripe 환불 실패: ${refund.failure_reason ?? refund.status}`, refund.status);
    return { key: refund.id, amount: refund.amount, ref: refund.metadata?.refund_id };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const secret = simulatorUrl() ? SIMULATOR_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET 환경변수가 없습니다");
    return Stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
  }
}
