-- 상품 검색: 상품 테이블과 분리한 검색 문서(product_search)와 색인할 상품 목록(search_dirty)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 검색 문서. tokens는 이름(A)·카테고리 경로(B)·설명(C)을 2글자씩 자른 토큰(앱의 bigram 함수가 만든다)
-- products에 외래 키를 걸지 않는다: 색인 작업이 상품 행에 잠금을 걸지 않게 하고, 지워진 상품은 색인 작업이 문서를 지운다
CREATE TABLE "product_search" (
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category_names" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "tokens" TSVECTOR NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_search_pkey" PRIMARY KEY ("product_id")
);

CREATE INDEX "product_search_tokens_idx" ON "product_search" USING GIN ("tokens");
-- 오타 보충(word_similarity, <% 연산자)
CREATE INDEX "product_search_name_trgm_idx" ON "product_search" USING GIN ("name" gin_trgm_ops);
-- 1글자 검색어의 이름 접두 일치(LIKE '가%')
CREATE INDEX "product_search_name_prefix_idx" ON "product_search" ("name" text_pattern_ops);

-- 색인할 상품(outbox). 상품 id가 기본키라 같은 상품을 여러 번 고쳐도 한 행이다
CREATE TABLE "search_dirty" (
    "product_id" INTEGER NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_dirty_pkey" PRIMARY KEY ("product_id")
);

-- 상품을 고치는 트랜잭션 안에서 기록한다. DO UPDATE라서 색인 작업이 그 행을 잡고 있으면
-- 색인 작업이 끝날 때까지 기다렸다가 다시 넣는다(DO NOTHING이면 색인 작업이 옛 값을 색인하고 행을 지워 변경을 잃는다)
CREATE FUNCTION "search_mark_product"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "search_dirty" ("product_id")
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END)
  ON CONFLICT ("product_id") DO UPDATE SET "marked_at" = EXCLUDED."marked_at";
  RETURN NULL;
END $$;

CREATE TRIGGER "products_search_mark_insert_delete"
  AFTER INSERT OR DELETE ON "products"
  FOR EACH ROW EXECUTE FUNCTION "search_mark_product"();

-- 재고만 바뀌는 수정(주문, 재고 조정)은 색인과 상관없으므로 거른다
CREATE TRIGGER "products_search_mark_update"
  AFTER UPDATE OF "name", "description", "category_id" ON "products"
  FOR EACH ROW
  WHEN (OLD."name" IS DISTINCT FROM NEW."name"
     OR OLD."description" IS DISTINCT FROM NEW."description"
     OR OLD."category_id" IS DISTINCT FROM NEW."category_id")
  EXECUTE FUNCTION "search_mark_product"();

-- 카테고리 이름이나 부모가 바뀌면 그 아래(후손 포함) 상품의 카테고리 경로가 바뀐다
-- UNION(ALL이 아님)이라 순환이 있어도 끝난다
CREATE FUNCTION "search_mark_category"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "search_dirty" ("product_id")
  WITH RECURSIVE "subtree" AS (
    SELECT NEW."id" AS "id"
    UNION
    SELECT c."id" FROM "categories" c JOIN "subtree" s ON c."parent_id" = s."id"
  )
  SELECT p."id" FROM "products" p WHERE p."category_id" IN (SELECT "id" FROM "subtree")
  ON CONFLICT ("product_id") DO UPDATE SET "marked_at" = EXCLUDED."marked_at";
  RETURN NULL;
END $$;

CREATE TRIGGER "categories_search_mark_update"
  AFTER UPDATE OF "name", "parent_id" ON "categories"
  FOR EACH ROW
  WHEN (OLD."name" IS DISTINCT FROM NEW."name" OR OLD."parent_id" IS DISTINCT FROM NEW."parent_id")
  EXECUTE FUNCTION "search_mark_category"();

-- 이미 있는 상품은 다음 색인 회차에 문서를 만든다
INSERT INTO "search_dirty" ("product_id") SELECT "id" FROM "products" ON CONFLICT DO NOTHING;
