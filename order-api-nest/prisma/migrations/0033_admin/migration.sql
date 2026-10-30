-- 관리자 대시보드·PG 대사·상점 설정·법적 고지(29)
--   store_settings: 한 행짜리 타입 있는 설정(배포 없이 바꾼다). 비밀값은 두지 않는다(환경변수에만)
--   legal_documents: 약관·개인정보처리방침·청약철회 안내의 버전 행(고치면 새 버전, 지난 버전 공개)
--   reconciliation_runs·issues: PG 대사 실행과 불일치(자연 키 upsert라 다시 돌려도 집합이 같다)
--   orders.privacy_consent_*: 결제할 때 동의한 개인정보처리방침 버전과 시각
-- CreateEnum
CREATE TYPE "LegalKind" AS ENUM ('terms', 'privacy', 'refund');

-- CreateEnum
CREATE TYPE "ReconciliationIssueKind" AS ENUM ('amount_mismatch', 'status_mismatch', 'missing_in_db', 'missing_in_pg', 'refund_mismatch');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "privacy_consent_version" INTEGER,
ADD COLUMN     "privacy_consented_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "store_name" TEXT NOT NULL,
    "representative" TEXT NOT NULL,
    "business_number" TEXT NOT NULL,
    "mail_order_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "privacy_officer" TEXT NOT NULL,
    "shipping_fee" INTEGER NOT NULL,
    "free_shipping_threshold" INTEGER NOT NULL,
    "return_shipping_fee" INTEGER NOT NULL,
    "low_stock_threshold" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "store_settings_business_number_check" CHECK ("business_number" ~ '^[0-9]{10}$'),
    CONSTRAINT "store_settings_amounts_check" CHECK ("shipping_fee" >= 0 AND "free_shipping_threshold" >= 0 AND "return_shipping_fee" >= 0 AND "low_stock_threshold" >= 0)
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" SERIAL NOT NULL,
    "kind" "LegalKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_documents_version_check" CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" SERIAL NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "pg_count" INTEGER NOT NULL DEFAULT 0,
    "db_count" INTEGER NOT NULL DEFAULT 0,
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" SERIAL NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "business_date" DATE NOT NULL,
    "kind" "ReconciliationIssueKind" NOT NULL,
    "payment_key" TEXT NOT NULL,
    "order_id" INTEGER,
    "our_value" JSONB,
    "pg_value" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");

-- CreateIndex
CREATE INDEX "reconciliation_runs_period_start_provider_idx" ON "reconciliation_runs"("period_start", "provider");

-- CreateIndex
CREATE INDEX "reconciliation_issues_resolved_at_idx" ON "reconciliation_issues"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_issues_provider_kind_payment_key_key" ON "reconciliation_issues"("provider", "kind", "payment_key");



-- 처음 값: 28의 배송비 상수(3,000원, 5만 원 이상 무료, 반품 왕복 6,000원)와 같다. 사업자 정보는 자리표시자(설정 화면에서 바꾼다)
INSERT INTO "store_settings" ("id", "store_name", "representative", "business_number", "mail_order_number", "address", "phone", "email", "privacy_officer",
                              "shipping_fee", "free_shipping_threshold", "return_shipping_fee", "low_stock_threshold")
VALUES (1, 'Brown Store', '대표자', '1234567891', '제0000-서울강남-00000호', '서울특별시 강남구 테헤란로 123', '02-000-0000', 'help@example.com', '개인정보 보호책임자',
        3000, 50000, 6000, 5)
ON CONFLICT DO NOTHING;

-- 첫 버전(시행일 = 마이그레이션 시각). 본문은 관리자 화면(/admin/legal)에서 고친다
INSERT INTO "legal_documents" ("kind", "version", "title", "body", "effective_at") VALUES
  ('terms', 1, '이용약관', E'제1조(목적) 이 약관은 상점이 제공하는 온라인 판매 서비스의 이용 조건을 정합니다.\n제2조(주문과 결제) 손님은 상품을 장바구니에 담아 결제하고, 결제가 승인되면 주문이 성립합니다.', CURRENT_TIMESTAMP),
  ('privacy', 1, '개인정보처리방침', E'1. 수집 항목: 받는 분 이름, 연락처, 배송지 주소, 배송 메모\n2. 이용 목적: 주문 상품 배송과 반품·교환 처리\n3. 보유 기간: 전자상거래법에 따라 계약·청약철회 기록 5년, 대금결제 기록 5년, 소비자 불만·분쟁 처리 기록 3년', CURRENT_TIMESTAMP),
  ('refund', 1, '청약철회·환불 안내', E'배송 완료 뒤 7일 안, 구매확정 전에 반품·교환을 신청할 수 있습니다.\n단순변심 반품은 왕복 배송비를 환불액에서 뺍니다. 상품 하자·오배송은 빼지 않습니다.', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
