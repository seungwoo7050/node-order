import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ReconciliationIssue, ReconciliationRun } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PgError, type PgPaymentStatus, type ProviderId } from "../payments/payment-gateway.js";
import { PaymentGateways } from "../payments/payment-gateways.js";
import { withPgRetry } from "../payments/pg-retry.js";
import { resolveStaleRefunds, type ResolveResult } from "../payments/refund-resolver.js";
import { RefundsService } from "../payments/refunds.service.js";
import { comparePayment, missingInPg, naturalKey, reconcile, sameValue, type Issue, type IssueKind, type OurPayment } from "./compare.js";

const KST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 24 * 3600_000;
export const AUTO_RESOLVED_NOTE = "자동: 다음 대사에서 일치";

// 대사 기준일(YYYY-MM-DD, Asia/Seoul)의 [자정, 다음 자정)
export function periodOf(date: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+09:00`))) {
    throw new BadRequestException(`날짜는 YYYY-MM-DD 꼴입니다: ${date}`);
  }
  const from = new Date(`${date}T00:00:00+09:00`);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

// 한국 날짜 문자열. daysAgo=1이면 어제
export function kstDate(now = new Date(), daysAgo = 0): string {
  return new Date(now.getTime() + KST_OFFSET_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

export type ProviderRun = { provider: ProviderId; runId: number; pgCount: number; dbCount: number; issueCount: number; error: string | null };
export type ReconcileResult = { date: string; refunds: ResolveResult | null; runs: ProviderRun[]; failed: boolean };

// PG 대사: 기간 안의 PG 거래와 우리 payments·refunds를 양쪽에서 맞춰 보고 불일치를 자연 키로 upsert한다.
//   1. 27의 결과 미상 환불 확정을 먼저 돌린다(확정 전 환불이 refund_mismatch로 보이지 않게)
//   2. provider마다 따로: 하나가 실패해도 나머지는 진행하고, 실패는 그 provider의 run에 남는다
// 다시 돌려도 같은 결과다: (provider, 종류, 결제 키)가 같으면 같은 행을 고친다.
// 해결 표시한 행은 값이 그대로면 해결 상태를 유지하고, 값이 바뀌면 다시 연다.
// 열린 불일치의 결제를 이번 실행에서 다시 봤는데 일치하면(PG나 우리 쪽이 정정됐다) 자동 해결로 표시하고, 다시 어긋나면 다시 연다
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGateways,
    private readonly refunds: RefundsService,
  ) {}

  async run(date: string, options: { refundsOlderThanMs?: number } = {}): Promise<ReconcileResult> {
    const period = periodOf(date);
    let refunds: ResolveResult | null = null;
    try {
      refunds = await resolveStaleRefunds({ prisma: this.prisma, gateways: this.gateways, refunds: this.refunds, logger: this.logger }, { olderThanMs: options.refundsOlderThanMs ?? 5 * 60_000 });
    } catch (err) {
      this.logger.warn(`환불 확정을 돌리지 못했다(대사는 계속한다): ${(err as Error).message}`);
    }
    const runs: ProviderRun[] = [];
    for (const provider of this.gateways.configured()) runs.push(await this.runProvider(provider, date, period));
    const failed = runs.some((r) => r.error);
    this.logger.log(`대사 ${date}: ${runs.map((r) => `${r.provider} ${r.error ? `실패(${r.error})` : `PG ${r.pgCount}건 · 우리 ${r.dbCount}건 · 불일치 ${r.issueCount}건`}`).join(", ") || "켜진 PG 없음"}`);
    return { date, refunds, runs, failed };
  }

  private async runProvider(provider: ProviderId, date: string, period: { from: Date; to: Date }): Promise<ProviderRun> {
    const run = await this.prisma.reconciliationRun.create({ data: { provider, periodStart: period.from, periodEnd: period.to } });
    try {
      const gateway = this.gateways.get(provider);
      const pgPayments = await gateway.listTransactions(period);
      const ours = await this.ourPayments(provider, period, pgPayments.map((p) => p.paymentKey), pgPayments.flatMap((p) => (p.providerOrderId ? [p.providerOrderId] : [])));
      const inPeriod = (o: OurPayment) => !!o.approvedAt && o.approvedAt >= period.from && o.approvedAt < period.to;
      const { issues, unmatched } = reconcile(pgPayments, ours, inPeriod);
      // 기간 밖에 승인되고 기간 안에 환불만 있었는데 PG 목록에 없는 결제: PG에 하나씩 다시 묻는다
      for (const o of unmatched) {
        if (!o.paymentKey) {
          issues.push(missingInPg(o));
          continue;
        }
        try {
          issues.push(...comparePayment(o, await withPgRetry(() => gateway.fetchPayment(o.paymentKey!))));
        } catch (err) {
          if (err instanceof PgError && err.status === 404) issues.push(missingInPg(o));
          else throw err;
        }
      }
      await this.upsertIssues(provider, date, issues);
      const checked = new Set([...pgPayments.map((p) => p.paymentKey), ...ours.map((o) => naturalKey(o))]);
      await this.resolveHealed(provider, checked, issues);
      const finished = { pgCount: pgPayments.length, dbCount: ours.length, issueCount: issues.length };
      await this.prisma.reconciliationRun.update({ where: { id: run.id }, data: { ...finished, finishedAt: new Date() } });
      return { provider, runId: run.id, ...finished, error: null };
    } catch (err) {
      const error = err instanceof PgError ? `${err.code ?? err.kind}${err.status ? ` ${err.status}` : ""}: ${err.message}` : (err as Error).message;
      await this.prisma.reconciliationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error } });
      this.logger.error(`대사 실패(${provider} ${date}): ${error}`);
      return { provider, runId: run.id, pgCount: 0, dbCount: 0, issueCount: 0, error };
    }
  }

  // 우리 쪽: 기간 안에 승인된 결제, 기간 안에 환불이 있었던 결제, PG 목록에 나온 키·주문번호의 결제
  private async ourPayments(provider: ProviderId, period: { from: Date; to: Date }, pgKeys: string[], pgOrderIds: string[]): Promise<OurPayment[]> {
    const rows = await this.prisma.asAdmin((tx) => tx.payment.findMany({
      where: {
        provider,
        status: { not: "ready" },
        OR: [
          { approvedAt: { gte: period.from, lt: period.to } },
          { refunds: { some: { createdAt: { gte: period.from, lt: period.to } } } },
          { providerPaymentKey: { in: pgKeys } },
          { providerOrderId: { in: pgOrderIds } },
        ],
      },
      select: { orderId: true, providerPaymentKey: true, providerOrderId: true, amount: true, status: true, approvedAt: true, refunds: { where: { status: "succeeded" }, select: { amount: true } } },
    }));
    return rows
      .filter((r) => r.approvedAt) // 승인된 적 없는 결제(결제 대기 중 취소)는 PG에도 거래가 없다
      .map((r) => ({
        orderId: r.orderId, paymentKey: r.providerPaymentKey, providerOrderId: r.providerOrderId, amount: r.amount,
        status: r.status as PgPaymentStatus, approvedAt: r.approvedAt, refunded: r.refunds.reduce((s, x) => s + x.amount, 0),
      }));
  }

  private async upsertIssues(provider: ProviderId, date: string, issues: Issue[]) {
    const now = new Date();
    for (const issue of issues) {
      const where = { provider_kind_paymentKey: { provider, kind: issue.kind, paymentKey: issue.paymentKey } };
      const existing = await this.prisma.reconciliationIssue.findUnique({ where });
      const values = { ourValue: issue.ourValue ?? undefined, pgValue: issue.pgValue ?? undefined, orderId: issue.orderId };
      if (!existing) {
        await this.prisma.reconciliationIssue.create({
          data: { provider, kind: issue.kind, paymentKey: issue.paymentKey, businessDate: new Date(`${date}T00:00:00Z`), firstSeenAt: now, lastSeenAt: now, ...values },
        });
        continue;
      }
      // 사람이 해결한 행은 값이 바뀌어야 다시 열고, 자동 해결한 행은 다시 어긋나기만 해도 연다
      const changed = !sameValue(existing.ourValue, issue.ourValue) || !sameValue(existing.pgValue, issue.pgValue);
      const reopen = !!existing.resolvedAt && (changed || existing.resolutionNote === AUTO_RESOLVED_NOTE);
      await this.prisma.reconciliationIssue.update({
        where: { id: existing.id },
        data: { ...values, lastSeenAt: now, ...(reopen ? { resolvedAt: null, resolutionNote: existing.resolutionNote === AUTO_RESOLVED_NOTE ? null : existing.resolutionNote } : {}) },
      });
      if (reopen) this.logger.warn(`해결했던 불일치가 다시 어긋나 다시 열림: #${existing.id} ${issue.kind} ${issue.paymentKey}`);
    }
  }

  // 이번 실행에서 다시 본 결제(checked)에 열려 있던 불일치가 이번에는 나오지 않았으면 자동 해결. 보지 않은 결제의 행은 건드리지 않는다
  private async resolveHealed(provider: ProviderId, checked: Set<string>, issues: Issue[]) {
    if (checked.size === 0) return;
    const still = new Set(issues.map((i) => `${i.kind}:${i.paymentKey}`));
    const open = await this.prisma.reconciliationIssue.findMany({ where: { provider, resolvedAt: null, paymentKey: { in: [...checked] } }, select: { id: true, kind: true, paymentKey: true } });
    const healed = open.filter((i) => !still.has(`${i.kind}:${i.paymentKey}`));
    if (healed.length === 0) return;
    await this.prisma.reconciliationIssue.updateMany({ where: { id: { in: healed.map((i) => i.id) }, resolvedAt: null }, data: { resolvedAt: new Date(), resolutionNote: AUTO_RESOLVED_NOTE } });
    this.logger.log(`대사 ${provider}: 다시 맞춰 보니 일치해 자동 해결 ${healed.length}건(${healed.map((i) => `#${i.id} ${i.kind}`).join(", ")})`);
  }

  // ── 관리자 화면 ─────────────────────────────────────

  async issues(query: { kind?: IssueKind; state?: "open" | "resolved" | "all"; limit?: number }): Promise<{ items: ReconciliationIssue[]; counts: Record<IssueKind, number> & { open: number } }> {
    const state = query.state ?? "open";
    const items = await this.prisma.reconciliationIssue.findMany({
      where: { kind: query.kind, ...(state === "open" ? { resolvedAt: null } : state === "resolved" ? { resolvedAt: { not: null } } : {}) },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: Math.min(query.limit ?? 100, 200),
    });
    const grouped = await this.prisma.reconciliationIssue.groupBy({ by: ["kind"], where: { resolvedAt: null }, _count: { _all: true } });
    const counts = { amount_mismatch: 0, status_mismatch: 0, missing_in_db: 0, missing_in_pg: 0, refund_mismatch: 0, open: 0 };
    for (const g of grouped) {
      counts[g.kind] = g._count._all;
      counts.open += g._count._all;
    }
    return { items, counts };
  }

  async runs(limit = 20): Promise<ReconciliationRun[]> {
    return this.prisma.reconciliationRun.findMany({ orderBy: { id: "desc" }, take: limit });
  }

  // 해결 표시(메모 필수) 또는 다시 열기
  async resolve(id: number, input: { resolved: boolean; note?: string }): Promise<ReconciliationIssue> {
    const existing = await this.prisma.reconciliationIssue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`불일치 #${id}가 없습니다`);
    return this.prisma.reconciliationIssue.update({
      where: { id },
      data: input.resolved ? { resolvedAt: existing.resolvedAt ?? new Date(), resolutionNote: input.note ?? existing.resolutionNote } : { resolvedAt: null, ...(input.note !== undefined ? { resolutionNote: input.note } : {}) },
    });
  }
}
