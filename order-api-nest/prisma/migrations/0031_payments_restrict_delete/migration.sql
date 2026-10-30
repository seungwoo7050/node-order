-- 대금결제 기록(payments·refunds)은 주문을 지울 때 같이 사라지면 안 된다: ON DELETE CASCADE → RESTRICT.
-- 주문을 지우는 코드(데모 사용자 정리, seed)는 지워도 되는 결제 행(manual, 데모 사용자의 결제)만 먼저 명시적으로 지운다.
-- stripe·toss 결제가 남은 주문을 지우려 하면 외래 키 위반으로 실패한다(src/orders/delete-orders.ts)
ALTER TABLE "payments" DROP CONSTRAINT "payments_order_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds" DROP CONSTRAINT "refunds_payment_id_fkey";
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
