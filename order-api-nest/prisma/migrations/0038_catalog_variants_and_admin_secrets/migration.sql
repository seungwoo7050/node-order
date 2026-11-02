-- 0038_catalog_variants_and_admin_secrets/migration.sql

-- 1. Product extensions
ALTER TABLE "products"
  ADD COLUMN "is_visible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "material_info" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "size_guide" TEXT NOT NULL DEFAULT '';

-- 2. ProductImage model
CREATE TABLE "product_images" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "image_key" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. ProductVariant model
CREATE TABLE "product_variants" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "price_delta" INTEGER NOT NULL DEFAULT 0,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_variants_product_id_sort_order_idx" ON "product_variants"("product_id", "sort_order");
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Category sortOrder
ALTER TABLE "categories"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- 5. User isActive
ALTER TABLE "users"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- 6. OrderItem and ReturnItem variant columns & composite PK
ALTER TABLE "order_items"
  ADD COLUMN "variant_key" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "variant_id" INTEGER,
  ADD COLUMN "variant_label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_pkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_id", "product_id", "variant_key");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "return_items"
  ADD COLUMN "variant_key" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "variant_id" INTEGER,
  ADD COLUMN "variant_label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "return_items" DROP CONSTRAINT "return_items_pkey";
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_pkey" PRIMARY KEY ("return_id", "product_id", "variant_key");
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. IntegrationSecret model
CREATE TABLE "integration_secrets" (
  "key" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "auth_tag" TEXT NOT NULL,
  "masked_preview" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_secrets_pkey" PRIMARY KEY ("key")
);

-- 8. SystemControl model
CREATE TABLE "system_controls" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "pause_paid_apis" BOOLEAN NOT NULL DEFAULT false,
  "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "system_controls_single_row" CHECK ("id" = 1)
);

INSERT INTO "system_controls" ("id", "pause_paid_apis", "maintenance_mode")
VALUES (1, false, false)
ON CONFLICT ("id") DO NOTHING;
