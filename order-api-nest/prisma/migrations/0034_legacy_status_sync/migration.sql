-- expand 기간(0032 ~ contract)의 옛 칸 → status 동기화.
-- blue/green 전환 사이에는 status를 모르는 옛 API(27)가 같은 DB에 쓴다: 결제 완료는 orders.paid, 취소는 orders.canceled_at만 바꾼다.
-- 그러면 status가 pending_payment로 남아 결제 기한 작업이 그 주문을 다시 취소한다(환불 없이 취소, 재고 두 번 복구).
--
-- 읽을 때 보정하지 않고 트리거로 고르는 이유:
--   - 옛 API의 쓰기 경로는 우리가 고칠 수 없다(이미 배포된 바이너리). DB만이 모든 쓰기를 본다
--   - status를 읽는 곳이 많다(결제 기한 작업, 관리자 목록 필터, 대시보드 SQL, 상태 기계의 조건부 update). 읽기마다 보정하면 하나라도 빠뜨린다
--   - 옛 칸을 쓴 같은 트랜잭션에서 맞춰지므로 결제 기한 작업이 그 사이를 볼 틈이 없다
-- 새 API는 status를 옛 칸과 같이 바꾸므로(transitions.ts) 트리거 조건(status가 아직 pending_payment)에 걸리지 않는다.
-- contract 마이그레이션이 옛 칸을 지울 때 이 트리거도 지운다
CREATE OR REPLACE FUNCTION orders_sync_legacy_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target "OrderStatus";
BEGIN
  IF NEW."status" <> 'pending_payment' THEN
    RETURN NULL;
  END IF;
  -- 0032 backfill과 같은 규칙: 결제 완료가 먼저, 아니면 취소
  IF NEW."paid" THEN
    target := 'paid';
  ELSIF NEW."canceled_at" IS NOT NULL THEN
    target := 'canceled';
  ELSE
    RETURN NULL;
  END IF;
  UPDATE "orders" SET "status" = target, "status_changed_at" = COALESCE(CASE WHEN target = 'canceled' THEN NEW."canceled_at" END, CURRENT_TIMESTAMP)
  WHERE "id" = NEW."id" AND "status" = 'pending_payment';
  IF FOUND THEN
    INSERT INTO "order_status_history" ("order_id", "from_status", "to_status", "actor_type", "reason")
    VALUES (NEW."id", 'pending_payment', target, 'system', '옛 칸(paid·canceled_at) 동기화: status를 모르는 옛 API가 쓴 주문');
  END IF;
  RETURN NULL;
END;
$$;

-- AFTER 트리거: 안에서 하는 UPDATE는 paid·canceled_at을 바꾸지 않으므로 다시 걸리지 않는다
CREATE TRIGGER orders_sync_legacy_status
AFTER INSERT OR UPDATE OF "paid", "canceled_at" ON "orders"
FOR EACH ROW EXECUTE FUNCTION orders_sync_legacy_status();

-- 0032 뒤에 옛 API가 이미 어긋나게 쓴 행을 맞춘다(여러 번 돌려도 같다). status만 바꾸므로 위 트리거는 걸리지 않는다
UPDATE "orders" o
SET "status" = (CASE WHEN o."paid" THEN 'paid' ELSE 'canceled' END)::"OrderStatus",
    "status_changed_at" = COALESCE(CASE WHEN o."paid" THEN (SELECT p."approved_at" FROM "payments" p WHERE p."order_id" = o."id") ELSE o."canceled_at" END, o."created_at")
WHERE o."status" = 'pending_payment' AND (o."paid" OR o."canceled_at" IS NOT NULL);
