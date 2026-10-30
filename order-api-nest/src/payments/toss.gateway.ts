import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PAYMENT_TIMEOUT_MS, PgError, type CheckoutOrder, type PaymentGateway, type PgPayment, type PgPaymentStatus, type PgRefund, type StartedCheckout } from "./payment-gateway.js";

// 토스페이먼츠 코어 API(https://docs.tosspayments.com/reference)
//   승인 POST /v1/payments/confirm, 조회 GET /v1/payments/{paymentKey}, 취소 POST /v1/payments/{paymentKey}/cancel
//   인증: Authorization: Basic base64("{시크릿 키}:")   멱등: Idempotency-Key 헤더(POST만, 15일 유효)
// 결제 화면은 브라우저의 결제위젯 SDK(js.tosspayments.com/v2/standard)가 띄운다. 서버는 승인부터 맡는다

export const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";
const TOSS_API_URL = "https://api.tosspayments.com";
const SIMULATOR_CLIENT_KEY = "test_ck_simulator";
const SIMULATOR_SECRET_KEY = "test_sk_simulator";

type TossCancel = { transactionKey: string; cancelAmount: number; canceledAt: string };
export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: "READY" | "IN_PROGRESS" | "WAITING_FOR_DEPOSIT" | "DONE" | "CANCELED" | "PARTIAL_CANCELED" | "ABORTED" | "EXPIRED";
  totalAmount: number;
  balanceAmount: number;
  approvedAt: string | null;
  cancels: TossCancel[] | null;
};

function simulatorUrl(): string | undefined {
  const url = process.env.TOSS_SIMULATOR_URL;
  return url && process.env.NODE_ENV !== "production" ? url.replace(/\/$/, "") : undefined;
}

function toStatus(p: TossPayment): PgPaymentStatus {
  switch (p.status) {
    case "DONE": return "paid";
    case "PARTIAL_CANCELED": return "partial_refunded";
    case "CANCELED": return p.approvedAt ? "refunded" : "canceled";
    case "ABORTED":
    case "EXPIRED": return "canceled";
    default: return "ready";
  }
}

export function toPgPayment(p: TossPayment): PgPayment {
  const cancels = p.cancels ?? [];
  return {
    paymentKey: p.paymentKey,
    providerOrderId: p.orderId,
    status: toStatus(p),
    totalAmount: p.totalAmount,
    refundedAmount: p.totalAmount - p.balanceAmount,
    approvedAt: p.approvedAt ? new Date(p.approvedAt) : null,
    refunds: cancels.map((c) => ({ key: c.transactionKey, amount: c.cancelAmount })),
  };
}

@Injectable()
export class TossGateway implements PaymentGateway {
  readonly id = "toss" as const;

  isConfigured(): boolean {
    return Boolean(simulatorUrl() || (process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY));
  }

  // 브라우저에 줄 값. 클라이언트 키는 공개해도 되는 키다(시크릿 키는 서버에만 둔다)
  widgetConfig(): { clientKey: string; sdkUrl: string } {
    const sim = simulatorUrl();
    if (sim) return { clientKey: SIMULATOR_CLIENT_KEY, sdkUrl: `${sim}/v2/standard` };
    return { clientKey: process.env.TOSS_CLIENT_KEY ?? "", sdkUrl: TOSS_SDK_URL };
  }

  // 토스는 서버에서 만들 세션이 없다. 주문번호(6~64자, 영문·숫자·-_=)를 주문 id에서 만들고 콘솔의 위젯 페이지로 보낸다
  // 뒤의 임의 값: 개발 DB를 초기화해 주문 id가 다시 쓰여도 토스 테스트 상점에서 주문번호가 겹치지 않게
  async startCheckout(order: CheckoutOrder): Promise<StartedCheckout> {
    const providerOrderId = `order-${order.id}-${randomBytes(4).toString("hex")}`;
    return { providerOrderId, checkoutUrl: `${process.env.FRONTEND_URL}/checkout/toss/${order.id}` };
  }

  async confirm(input: { providerOrderId: string; amount: number; paymentKey?: string }, idempotencyKey: string): Promise<PgPayment> {
    if (!input.paymentKey) throw new PgError("rejected", "paymentKey가 없습니다", "INVALID_REQUEST");
    const body = { paymentKey: input.paymentKey, orderId: input.providerOrderId, amount: input.amount };
    return toPgPayment(await this.request<TossPayment>("POST", "/v1/payments/confirm", body, idempotencyKey));
  }

  async findPaymentKey(providerOrderId: string): Promise<string | null> {
    try {
      const p = await this.request<TossPayment>("GET", `/v1/payments/orders/${encodeURIComponent(providerOrderId)}`);
      return p.approvedAt ? p.paymentKey : null;
    } catch (err) {
      if (err instanceof PgError && err.status === 404) return null;
      throw err;
    }
  }

  async fetchPayment(paymentKey: string): Promise<PgPayment> {
    return toPgPayment(await this.request<TossPayment>("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`));
  }

  async refund(paymentKey: string, input: { amount: number; reason: string }, idempotencyKey: string): Promise<PgRefund> {
    const body = { cancelReason: input.reason, cancelAmount: input.amount };
    const payment = await this.request<TossPayment>("POST", `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, body, `refund-${idempotencyKey}`);
    // 응답은 취소가 반영된 Payment 객체다. 이번 취소는 cancels의 마지막 항목
    const last = payment.cancels?.at(-1);
    if (!last) throw new PgError("rejected", "취소 응답에 cancels가 없습니다", "INVALID_RESPONSE");
    return { key: last.transactionKey, amount: last.cancelAmount };
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const sim = simulatorUrl();
    const secret = sim ? SIMULATOR_SECRET_KEY : process.env.TOSS_SECRET_KEY;
    if (!secret) throw new Error("TOSS_SECRET_KEY 환경변수가 없습니다");
    const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}` };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS()) };
    if (body) init.body = JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(`${sim ?? TOSS_API_URL}${path}`, init);
    } catch (err) {
      const timeout = err instanceof DOMException && err.name === "TimeoutError";
      throw new PgError(timeout ? "timeout" : "network", `토스 ${method} ${path}: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (res.ok) return json as T;
    // 5xx와 409 IDEMPOTENT_REQUEST_PROCESSING(같은 멱등 키 요청이 처리 중)은 결과를 아직 모른다
    const unknown = res.status >= 500 || json.code === "IDEMPOTENT_REQUEST_PROCESSING";
    throw new PgError(unknown ? "network" : "rejected", json.message ?? `토스 ${res.status}`, json.code, res.status);
  }
}
