-- 0039_coupons_and_reviews/migration.sql

-- 1. Coupons table
CREATE TABLE "coupons" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discount_type" TEXT NOT NULL,
  "discount_value" INTEGER NOT NULL,
  "min_order_amount" INTEGER NOT NULL DEFAULT 0,
  "max_discount_amount" INTEGER,
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coupons_used_count_check" CHECK ("used_count" >= 0),
  CONSTRAINT "coupons_discount_type_check" CHECK ("discount_type" IN ('fixed', 'percent')),
  CONSTRAINT "coupons_discount_value_check" CHECK ("discount_value" > 0),
  CONSTRAINT "coupons_min_order_amount_check" CHECK ("min_order_amount" >= 0)
);

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- 2. Extend orders table with coupon fields
ALTER TABLE "orders"
  ADD COLUMN "coupon_id" INTEGER,
  ADD COLUMN "coupon_code" TEXT,
  ADD COLUMN "discount_amount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Reviews table
CREATE TABLE "reviews" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "author_name" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "variant_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE UNIQUE INDEX "reviews_order_id_product_id_key" ON "reviews"("order_id", "product_id");
CREATE INDEX "reviews_product_id_created_at_idx" ON "reviews"("product_id", "created_at");

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
