-- 0040_storefront_designs/migration.sql

ALTER TABLE "store_settings"
  ADD COLUMN "store_design" TEXT NOT NULL DEFAULT 'editorial-atelier',
  ADD COLUMN "hero_title" TEXT NOT NULL DEFAULT 'CONTEMPORARY ARCHIVE COLLECTION',
  ADD COLUMN "hero_subtitle" TEXT NOT NULL DEFAULT '소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브',
  ADD COLUMN "announcement_text" TEXT NOT NULL DEFAULT '전 상품 50,000원 이상 구매 시 무료배송 · 신규 가입 웰컴 쿠폰 증정';
