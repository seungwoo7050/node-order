-- 색인 작업의 가져가기(claim)와 반영을 나눈다: 행 잠금은 가져가는 문장 하나 동안만 잡는다.
--   version: 기록할 때마다 새 값. 색인 작업은 가져갈 때 읽은 version 그대로인 행만 지우므로,
--            색인하는 동안 들어온 변경은 남아 다음 회차에 반영된다
--   claimed_at: 가져간 시각(임대). 반영이 끝나지 못하고 죽어도 임대가 지나면 다시 가져간다
CREATE SEQUENCE "search_dirty_version_seq";

ALTER TABLE "search_dirty"
  ADD COLUMN "version" BIGINT NOT NULL DEFAULT nextval('search_dirty_version_seq'),
  ADD COLUMN "claimed_at" TIMESTAMP(3);

ALTER SEQUENCE "search_dirty_version_seq" OWNED BY "search_dirty"."version";

-- 다시 기록되면 새 version을 받고 임대를 푼다(색인 작업이 쥔 잠금이 없으니 기다리지 않는다)
CREATE OR REPLACE FUNCTION "search_mark_product"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "search_dirty" ("product_id")
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END)
  ON CONFLICT ("product_id") DO UPDATE
    SET "marked_at" = EXCLUDED."marked_at", "version" = EXCLUDED."version", "claimed_at" = NULL;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "search_mark_category"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "search_dirty" ("product_id")
  WITH RECURSIVE "subtree" AS (
    SELECT NEW."id" AS "id"
    UNION
    SELECT c."id" FROM "categories" c JOIN "subtree" s ON c."parent_id" = s."id"
  )
  SELECT p."id" FROM "products" p WHERE p."category_id" IN (SELECT "id" FROM "subtree")
  ON CONFLICT ("product_id") DO UPDATE
    SET "marked_at" = EXCLUDED."marked_at", "version" = EXCLUDED."version", "claimed_at" = NULL;
  RETURN NULL;
END $$;
