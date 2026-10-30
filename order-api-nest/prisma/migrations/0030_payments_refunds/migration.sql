-- 결제와 환불을 주문에서 떼어 낸다(expand). orders.paid, orders.stripe_session_id는 이번에 지우지 않는다:
-- 앱은 payments를 쓰면서 orders.paid도 같이 맞추고, 다음 릴리스가 안정되면 contract 마이그레이션이 옛 칸을 지운다
--   payments: 주문 하나에 결제 하나. provider 주문번호(토스 orderId, Stripe 세션 id)와 provider 결제 키(토스 paymentKey, Stripe PaymentIntent id)
--   refunds:  결제 하나에 환불 여러 번(부분 환불). 멱등 키가 unique라 같은 요청은 행 하나다
CREATE TYPE "PaymentProvider" AS ENUM ('stripe', 'toss', 'manual');
CREATE TYPE "PaymentStatus" AS ENUM ('ready', 'paid', 'partial_refunded', 'refunded', 'canceled');
CREATE TYPE "RefundStatus" AS ENUM ('requested', 'succeeded', 'failed');

CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_key" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'ready',
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payments_provider_provider_order_id_key" ON "payments"("provider", "provider_order_id");
CREATE UNIQUE INDEX "payments_provider_provider_payment_key_key" ON "payments"("provider", "provider_payment_key");

-- 데모 사용자 정리와 seed가 주문을 지우므로 결제·환불도 같이 지운다
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "refunds" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_refund_key" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'requested',
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");
-- payments:resolve-refunds가 오래된 requested를 찾는다
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 주문과 같은 행 수준 보안: 그 주문을 볼 수 있는 사람만 결제·환불을 본다(0013과 같은 모양)
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_via_order ON "payments"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_via_payment ON "refunds"
  USING (EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "payment_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "payments" p WHERE p."id" = "payment_id"));

-- backfill: 기존 주문을 payments로 옮긴다. 여러 번 돌려도 같다(ON CONFLICT DO NOTHING)
-- test/payments-backfill.e2e-spec.ts가 이 표시 아래 문장만 다시 돌려 검사한다
--   결제 완료 주문 → paid (Stripe 세션이 있으면 stripe, 없으면 관리자·seed가 만든 manual)
--   세션이 있는 미결제 주문 → 취소됐으면 canceled, 아니면 ready
INSERT INTO "payments" ("order_id", "provider", "provider_order_id", "amount", "status", "approved_at", "created_at", "updated_at")
SELECT o."id",
       (CASE WHEN o."stripe_session_id" IS NULL THEN 'manual' ELSE 'stripe' END)::"PaymentProvider",
       COALESCE(o."stripe_session_id", 'order-' || o."id"),
       o."total_amount",
       (CASE WHEN o."paid" THEN 'paid' WHEN o."canceled_at" IS NOT NULL THEN 'canceled' ELSE 'ready' END)::"PaymentStatus",
       CASE WHEN o."paid" THEN o."created_at" END,
       o."created_at",
       CURRENT_TIMESTAMP
FROM "orders" o
WHERE o."paid" OR o."stripe_session_id" IS NOT NULL
ON CONFLICT DO NOTHING;
