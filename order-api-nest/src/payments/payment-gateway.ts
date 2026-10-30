// 결제 대행사(PG) 경계. Stripe와 토스페이먼츠가 같은 계약을 따른다(test/payment-gateway.contract.ts)
// 우리 DB의 상태(payments.status)와 PG의 상태를 같은 이름으로 맞춰 둔다: PG 응답을 그대로 반영할 수 있게

export type ProviderId = "stripe" | "toss";
export const PROVIDERS: readonly ProviderId[] = ["toss", "stripe"];

export type PgPaymentStatus = "ready" | "paid" | "partial_refunded" | "refunded" | "canceled";

export type PgRefund = {
  key: string; // PG의 환불 키(토스 transactionKey, Stripe Refund id)
  amount: number;
  ref?: string; // 우리 refunds.id를 PG에 실어 보낼 수 있으면(Stripe metadata) 그 값
};

export type PgPayment = {
  paymentKey: string; // 토스 paymentKey, Stripe PaymentIntent id
  providerOrderId?: string; // 토스는 늘 싣는다. Stripe PaymentIntent에는 세션 id가 없다
  status: PgPaymentStatus;
  totalAmount: number;
  refundedAmount: number;
  approvedAt: Date | null;
  refunds: PgRefund[];
};

export type CheckoutOrder = { id: number; price: number; name: string };
export type StartedCheckout = { providerOrderId: string; checkoutUrl: string };

export interface PaymentGateway {
  readonly id: ProviderId;
  // 키(또는 개발용 시뮬레이터)가 있어 쓸 수 있는가. GET /features가 이것으로 결제 수단을 고른다
  isConfigured(): boolean;
  // 결제를 시작한다. 구매자를 보낼 주소와 PG 쪽 주문번호를 돌려준다
  startCheckout(order: CheckoutOrder, attemptKey?: string): Promise<StartedCheckout>;
  // 구매자 인증이 끝난 결제를 승인(또는 확인)한다. 금액은 호출하는 쪽이 DB의 주문 금액과 먼저 비교한다
  confirm(input: { providerOrderId: string; amount: number; paymentKey?: string }, idempotencyKey: string): Promise<PgPayment>;
  // PG 주문번호(Stripe 세션 id, 토스 orderId)로 결제 키를 찾는다. 결제 키 없이 옮겨 온 옛 결제(0030 백필)의 지연 채움에 쓴다
  // 결제가 끝나지 않았거나 PG에 없으면 null
  findPaymentKey(providerOrderId: string): Promise<string | null>;
  // PG에 다시 묻는다. 웹훅 본문이나 리다이렉트 쿼리 대신 이 결과를 믿는다
  fetchPayment(paymentKey: string): Promise<PgPayment>;
  // 기간 [from, to) 안에 거래(승인·취소)가 있었던 결제를 PG 쪽 지금 상태로 돌려준다. PG 대사(29)가 우리 payments·refunds와 맞춰 본다
  // (PG에만 있는 결제를 찾으려면 우리 DB의 키로 하나씩 묻는 것으로는 모자라 PG의 목록이 필요하다)
  listTransactions(period: { from: Date; to: Date }): Promise<PgPayment[]>;
  // 환불(부분 환불 포함). 같은 멱등 키로 다시 부르면 PG가 첫 결과를 돌려준다
  refund(paymentKey: string, input: { amount: number; reason: string; refundId: number }, idempotencyKey: string): Promise<PgRefund>;
}

// PG 호출 실패. kind로 나눠 처리한다
//   timeout·network: 결과를 모른다(돈이 나갔을 수도 있다) → 환불은 requested로 남기고 나중에 재조회한다
//   rejected: PG가 거절했다(결과를 안다) → 환불은 failed, 승인은 4xx로 돌려준다
export class PgError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "rejected",
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PgError";
  }

  get unknownOutcome() {
    return this.kind !== "rejected";
  }
}

export const PAYMENT_TIMEOUT_MS = () => Number(process.env.PAYMENT_TIMEOUT_MS ?? 10_000);
