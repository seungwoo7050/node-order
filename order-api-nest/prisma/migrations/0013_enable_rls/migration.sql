ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_owner ON "orders"
  USING ("user_id" = current_setting('app.user_id', true) OR current_setting('app.role', true) = 'admin')
  WITH CHECK ("user_id" = current_setting('app.user_id', true) OR current_setting('app.role', true) = 'admin');

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_via_order ON "order_items"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));