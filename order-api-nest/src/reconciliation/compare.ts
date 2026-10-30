import type { PgPayment, PgPaymentStatus } from "../payments/payment-gateway.js";

// PG 대사의 비교 규칙(순수 함수). 서비스가 기간 안의 PG 결제와 우리 결제를 모아 넘긴다.
//   amount_mismatch  결제 금액이 다름
//   status_mismatch  상태가 다름(우리는 paid, PG는 취소 등)
//   refund_mismatch  우리의 성공 환불 합계와 PG의 취소 금액이 다름
//   missing_in_db    PG에만 있음(웹훅 누락 등으로 우리가 모르는 결제)
//   missing_in_pg    우리에만 있음(기간 안에 승인됐다고 적었는데 PG 목록에 없다)
// 한 결제에서 여러 종류가 같이 나올 수 있고, 종류마다 한 행이다

export type IssueKind = "amount_mismatch" | "status_mismatch" | "missing_in_db" | "missing_in_pg" | "refund_mismatch";
export const ISSUE_KINDS: readonly IssueKind[] = ["amount_mismatch", "status_mismatch", "missing_in_db", "missing_in_pg", "refund_mismatch"];

export type OurPayment = {
  orderId: number;
  paymentKey: string | null;
  providerOrderId: string;
  amount: number;
  status: PgPaymentStatus;
  approvedAt: Date | null;
  refunded: number; // succeeded 환불 합계
};

// 값은 그 종류를 판정한 칸만 싣는다: 다시 돌렸을 때 "값이 그대로인가"를 이 값으로 본다
type IssueValue = Record<string, string | number | null>;
export type Issue = { kind: IssueKind; paymentKey: string; orderId: number | null; ourValue: IssueValue | null; pgValue: IssueValue | null };

// 결제 키가 없는 옛 결제(0030 백필)는 PG 주문번호로 자연 키를 만든다
export const naturalKey = (p: { paymentKey: string | null; providerOrderId: string }) => p.paymentKey ?? `order:${p.providerOrderId}`;

export function comparePayment(ours: OurPayment, pg: PgPayment): Issue[] {
  const key = pg.paymentKey;
  const issues: Issue[] = [];
  if (ours.amount !== pg.totalAmount) {
    issues.push({ kind: "amount_mismatch", paymentKey: key, orderId: ours.orderId, ourValue: { amount: ours.amount }, pgValue: { amount: pg.totalAmount } });
  }
  if (ours.status !== pg.status) {
    issues.push({ kind: "status_mismatch", paymentKey: key, orderId: ours.orderId, ourValue: { status: ours.status }, pgValue: { status: pg.status } });
  }
  if (ours.refunded !== pg.refundedAmount) {
    issues.push({ kind: "refund_mismatch", paymentKey: key, orderId: ours.orderId, ourValue: { refunded: ours.refunded }, pgValue: { refunded: pg.refundedAmount } });
  }
  return issues;
}

export function missingInDb(pg: PgPayment): Issue {
  return { kind: "missing_in_db", paymentKey: pg.paymentKey, orderId: null, ourValue: null, pgValue: { status: pg.status, amount: pg.totalAmount, refunded: pg.refundedAmount, providerOrderId: pg.providerOrderId ?? null } };
}

export function missingInPg(ours: OurPayment): Issue {
  return { kind: "missing_in_pg", paymentKey: naturalKey(ours), orderId: ours.orderId, ourValue: { status: ours.status, amount: ours.amount, refunded: ours.refunded }, pgValue: null };
}

// 기간의 PG 목록과 우리 결제를 양쪽에서 맞춘다. 결제 키로 맞추고, 키가 없는 옛 결제는 PG 주문번호로 맞춘다.
// inPeriod(ours)가 거짓인 우리 결제(기간 밖에 승인되고 기간 안에 환불만 있었던 것)는 PG 목록에 없어도 missing_in_pg로 보지 않고
// unmatched로 돌려준다: 서비스가 PG에 하나씩 다시 묻는다
export function reconcile(pgPayments: PgPayment[], ours: OurPayment[], inPeriod: (p: OurPayment) => boolean): { issues: Issue[]; unmatched: OurPayment[] } {
  const byKey = new Map(ours.filter((o) => o.paymentKey).map((o) => [o.paymentKey!, o]));
  const byOrderId = new Map(ours.map((o) => [o.providerOrderId, o]));
  const matched = new Set<OurPayment>();
  const issues: Issue[] = [];
  for (const pg of pgPayments) {
    const mine = byKey.get(pg.paymentKey) ?? (pg.providerOrderId ? byOrderId.get(pg.providerOrderId) : undefined);
    if (!mine) {
      issues.push(missingInDb(pg));
      continue;
    }
    matched.add(mine);
    issues.push(...comparePayment(mine, pg));
  }
  const unmatched: OurPayment[] = [];
  for (const o of ours) {
    if (matched.has(o)) continue;
    if (inPeriod(o)) issues.push(missingInPg(o));
    else unmatched.push(o);
  }
  return { issues, unmatched };
}

// 키 순서와 상관없이 같은 값인가(jsonb는 키 순서를 바꿔 돌려준다)
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, norm(x)]))
      : v;
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}
