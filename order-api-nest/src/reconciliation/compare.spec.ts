import type { PgPayment } from "../payments/payment-gateway.js";
import { reconcile, sameValue, type OurPayment } from "./compare.js";

const approvedAt = new Date("2026-10-29T03:00:00Z");
const pg = (over: Partial<PgPayment> = {}): PgPayment => ({
  paymentKey: "pk_1", providerOrderId: "order-1-aa", status: "paid", totalAmount: 10_000, refundedAmount: 0, approvedAt, refunds: [], ...over,
});
const ours = (over: Partial<OurPayment> = {}): OurPayment => ({
  orderId: 1, paymentKey: "pk_1", providerOrderId: "order-1-aa", amount: 10_000, status: "paid", approvedAt, refunded: 0, ...over,
});
const always = () => true;
const kinds = (r: ReturnType<typeof reconcile>) => r.issues.map((i) => i.kind);

describe("PG 대사 비교", () => {
  it("양쪽이 같으면 불일치가 없다(부분 환불까지 같아도)", () => {
    expect(reconcile([pg()], [ours()], always).issues).toEqual([]);
    expect(reconcile([pg({ status: "partial_refunded", refundedAmount: 3_000 })], [ours({ status: "partial_refunded", refunded: 3_000 })], always).issues).toEqual([]);
  });

  it("금액만 다르면 amount_mismatch 하나", () => {
    const r = reconcile([pg({ totalAmount: 12_000 })], [ours()], always);
    expect(r.issues).toEqual([{ kind: "amount_mismatch", paymentKey: "pk_1", orderId: 1, ourValue: { amount: 10_000 }, pgValue: { amount: 12_000 } }]);
  });

  it("상태만 다르면 status_mismatch 하나(우리는 paid, PG는 환불됨)", () => {
    expect(kinds(reconcile([pg({ status: "refunded" })], [ours()], always))).toEqual(["status_mismatch"]);
  });

  it("환불 합계만 다르면 refund_mismatch 하나", () => {
    const r = reconcile([pg({ status: "partial_refunded", refundedAmount: 2_000 })], [ours({ status: "partial_refunded", refunded: 3_000 })], always);
    expect(r.issues).toMatchObject([{ kind: "refund_mismatch", ourValue: { refunded: 3_000 }, pgValue: { refunded: 2_000 } }]);
  });

  it("PG에만 있으면 missing_in_db, 우리에만 있으면 missing_in_pg", () => {
    expect(kinds(reconcile([pg({ paymentKey: "pk_x", providerOrderId: "order-9-zz" })], [], always))).toEqual(["missing_in_db"]);
    expect(reconcile([], [ours()], always).issues).toMatchObject([{ kind: "missing_in_pg", paymentKey: "pk_1", orderId: 1 }]);
  });

  it("결제 키가 없는 옛 결제는 PG 주문번호로 맞추고, 없으면 주문번호로 자연 키를 만든다", () => {
    expect(reconcile([pg()], [ours({ paymentKey: null })], always).issues).toEqual([]);
    expect(reconcile([], [ours({ paymentKey: null })], always).issues[0]!.paymentKey).toBe("order:order-1-aa");
  });

  it("기간 밖에 승인된 결제는 PG 목록에 없어도 missing_in_pg가 아니라 다시 물을 대상으로 돌려준다", () => {
    const r = reconcile([], [ours()], () => false);
    expect(r.issues).toEqual([]);
    expect(r.unmatched.map((o) => o.orderId)).toEqual([1]);
  });

  it("값 비교는 jsonb 키 순서에 상관없다", () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue({ amount: 1 }, { amount: 2 })).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
  });
});
