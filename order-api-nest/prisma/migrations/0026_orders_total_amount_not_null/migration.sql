ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_total_amount_not_null";
ALTER TABLE "orders" ALTER COLUMN "total_amount" SET NOT NULL;
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_total_amount_not_null";
