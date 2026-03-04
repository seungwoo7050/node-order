ALTER TABLE "orders" ADD CONSTRAINT "orders_total_amount_not_null" CHECK ("total_amount" IS NOT NULL) NOT VALID;
