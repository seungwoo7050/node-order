CREATE INDEX "orders_created_at_id_idx" ON "orders"("created_at", "id");
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at", "id");

DROP INDEX "orders_user_id_idx";
