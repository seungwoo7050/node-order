-- 0037_member_and_guest_checkout/migration.sql
ALTER TABLE "users"
  ADD COLUMN "is_guest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "recipient_name" TEXT,
  ADD COLUMN "recipient_phone" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "address1" TEXT,
  ADD COLUMN "address2" TEXT,
  ADD COLUMN "delivery_memo" TEXT;

ALTER TABLE "orders"
  ADD COLUMN "is_guest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guest_password_hash" TEXT,
  ADD COLUMN "return_shipping_fee" INTEGER NOT NULL DEFAULT 6000;

CREATE INDEX "orders_is_guest_created_at_id_idx" ON "orders"("is_guest", "created_at" DESC, "id" DESC);
