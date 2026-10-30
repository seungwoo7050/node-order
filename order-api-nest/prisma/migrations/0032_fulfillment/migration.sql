-- 주문 이행(배송·반품). 주문 상태를 칸 하나(orders.status)로 모은다(expand).
-- orders.paid, orders.canceled_at은 이번에 지우지 않는다: 앱이 status와 같이 맞추고, 안정되면 contract 마이그레이션이 지운다
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'confirmed', 'canceled');
CREATE TYPE "ActorType" AS ENUM ('customer', 'admin', 'system');
CREATE TYPE "ReturnKind" AS ENUM ('refund', 'exchange');
CREATE TYPE "ReturnStatus" AS ENUM ('requested', 'approved', 'rejected', 'completed');
CREATE TYPE "ReturnReason" AS ENUM ('change_of_mind', 'defective', 'wrong_item');

-- 상태, 배송비, 배송지 사본(주문에 붙는다: 나중에 주소를 바꿔도 지난 주문의 배송지는 그대로다)
-- 배송지 칸은 옛 주문에 값이 없어 NULL을 허용한다. 새 주문은 결제 시작 전에 앱이 필수 검증을 한다
ALTER TABLE "orders"
    ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    ADD COLUMN "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "delivered_at" TIMESTAMP(3),
    ADD COLUMN "shipping_fee" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "recipient_name" TEXT,
    ADD COLUMN "recipient_phone" TEXT,
    ADD COLUMN "postal_code" TEXT,
    ADD COLUMN "address1" TEXT,
    ADD COLUMN "address2" TEXT,
    ADD COLUMN "delivery_memo" TEXT,
    ADD CONSTRAINT "orders_shipping_fee_check" CHECK ("shipping_fee" >= 0),
    ADD CONSTRAINT "orders_postal_code_check" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{5}$');

-- 관리자 주문 목록의 상태 필터, 자동 전이 작업(shipped·delivered가 며칠 지났나)
CREATE INDEX "orders_status_created_at_id_idx" ON "orders"("status", "created_at", "id");
CREATE INDEX "orders_status_status_changed_at_idx" ON "orders"("status", "status_changed_at");

-- 상태 이력: 모든 전이(from → to, 누가, 왜, 언제)
CREATE TABLE "order_status_history" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "from_status" "OrderStatus" NOT NULL,
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_status_history_order_id_id_idx" ON "order_status_history"("order_id", "id");
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 반품·교환 요청. 주문이 아니라 요청 단위로 상태를 가진다
CREATE TABLE "returns" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" "ReturnKind" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'requested',
    "reason" "ReturnReason" NOT NULL,
    "detail" TEXT,
    "refund_amount" INTEGER,
    "reject_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "returns_refund_amount_check" CHECK ("refund_amount" IS NULL OR "refund_amount" >= 0)
);
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");
CREATE INDEX "returns_status_idx" ON "returns"("status");
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "return_items" (
    "return_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("return_id", "product_id"),
    CONSTRAINT "return_items_quantity_check" CHECK ("quantity" > 0)
);
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 송장. 주문의 첫 발송은 return_id가 NULL, 교환품 발송은 그 반품 요청에 붙는다
CREATE TABLE "shipments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "return_id" INTEGER,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "shipped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");
CREATE UNIQUE INDEX "shipments_return_id_key" ON "shipments"("return_id");
-- 주문의 첫 발송은 하나뿐이다(동시에 두 번 넣어도 상태 전이가 막지만, DB도 한 번 더 막는다)
CREATE UNIQUE INDEX "shipments_order_first_key" ON "shipments"("order_id") WHERE "return_id" IS NULL;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 주문과 같은 행 수준 보안: 그 주문을 볼 수 있는 사람만 본다(0013, 0030과 같은 모양)
ALTER TABLE "order_status_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_status_history_via_order ON "order_status_history"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));

ALTER TABLE "returns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY returns_via_order ON "returns"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));

ALTER TABLE "return_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY return_items_via_return ON "return_items"
  USING (EXISTS (SELECT 1 FROM "returns" r WHERE r."id" = "return_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "returns" r WHERE r."id" = "return_id"));

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipments_via_order ON "shipments"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));

-- backfill: 옛 두 칸(paid, canceled_at)에서 status를 정한다. 여러 번 돌려도 같다(아직 기본값인 행만 바꾼다)
-- test/fulfillment-backfill.e2e-spec.ts가 이 표시 아래 문장만 다시 돌려 검사한다
--   결제 완료 → paid (결제 시각이 있으면 그때 바뀐 것으로), 취소 → canceled, 나머지는 pending_payment 그대로
UPDATE "orders" o
SET "status" = (CASE WHEN o."paid" THEN 'paid' ELSE 'canceled' END)::"OrderStatus",
    "status_changed_at" = COALESCE(
      CASE WHEN o."paid" THEN (SELECT p."approved_at" FROM "payments" p WHERE p."order_id" = o."id") ELSE o."canceled_at" END,
      o."created_at")
WHERE o."status" = 'pending_payment' AND (o."paid" OR o."canceled_at" IS NOT NULL);
