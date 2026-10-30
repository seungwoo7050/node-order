import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { reconciliationFailures } from "../metrics/metrics.js";
import type { ProviderId } from "../payments/payment-gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { kstDate, periodOf, ReconciliationService } from "../reconciliation/reconciliation.service.js";
import { LeaderElection } from "./leader-election.js";

const RUN_AT_KST_HOUR = 4; // 매일 04:00(Asia/Seoul) 뒤 첫 확인 때 전날 분을 대사한다
const KST_OFFSET_MS = 9 * 3600_000;
const retryIntervalMs = () => Number(process.env.RECONCILE_RETRY_INTERVAL_MS ?? 60 * 60_000); // 같은 provider를 다시 돌기 전 최소 간격
const maxAttempts = () => Number(process.env.RECONCILE_MAX_ATTEMPTS ?? 5); // 하루치에 provider마다 몇 번까지 돌까

type RunRow = { provider: string; startedAt: Date; finishedAt: Date | null; error: string | null };
const succeeded = (r: RunRow) => r.finishedAt !== null && r.error === null;

// PG 대사 정기 작업. 리더 한 곳에서만 돈다.
// 정각 타이머 대신 주기적으로 확인한다: 04:00 전후로 재시작하거나 리더가 바뀌어도 그때 돈다.
// provider마다 전날 기간에 "성공한 run"이 있는지 본다. 없으면(그 provider가 실패했거나, 도중에 끝나 끝 시각이 없거나,
// 손으로 돌렸다 실패한 날) 그 provider만 다시 돈다. 직전 시도에서 RECONCILE_RETRY_INTERVAL_MS(기본 1시간)가 지나야 하고,
// 하루치에 RECONCILE_MAX_ATTEMPTS(기본 5)번까지만. 상한에 닿으면 로그 오류를 남기고 손으로 돌린다
// (npm run payments:reconcile -- --date=YYYY-MM-DD, 결과는 upsert라 같은 날을 여러 번 돌려도 된다).
// 연속 실패 수는 지표 reconciliation_consecutive_failures{provider}로 드러낸다
@Injectable()
export class ReconciliationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly gaveUp = new Set<string>(); // 상한 경고를 하루치·provider마다 한 번만

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.RECONCILE_CHECK_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<boolean> {
    if (!this.leaderElection.isLeader || this.running) return false;
    if (new Date(now.getTime() + KST_OFFSET_MS).getUTCHours() < RUN_AT_KST_HOUR) return false;
    const date = kstDate(now, 1);
    this.running = true;
    try {
      const providers = this.reconciliation.configuredProviders();
      const due = await this.dueProviders(providers, date, now);
      if (due.length === 0) return false;
      const result = await this.reconciliation.run(date, { providers: due, startedAt: now });
      const failed = result.runs.filter((r) => r.error).map((r) => r.provider);
      if (failed.length) this.logger.warn(`정기 대사 ${date}: 실패한 PG가 있다(${failed.join(", ")}) - 간격을 두고 다시 돈다`);
      return true;
    } catch (err) {
      this.logger.error(`정기 대사 실패 - 다음 확인 때 다시 시도합니다: ${(err as Error).message}`);
      return false;
    } finally {
      await this.updateFailureGauge(this.reconciliation.configuredProviders()).catch(() => {});
      this.running = false;
    }
  }

  private async dueProviders(providers: ProviderId[], date: string, now: Date): Promise<ProviderId[]> {
    const runs: RunRow[] = await this.prisma.reconciliationRun.findMany({
      where: { periodStart: periodOf(date).from, provider: { in: providers } },
      select: { provider: true, startedAt: true, finishedAt: true, error: true },
      orderBy: { id: "desc" },
    });
    const due: ProviderId[] = [];
    for (const provider of providers) {
      const mine = runs.filter((r) => r.provider === provider);
      if (mine.some(succeeded)) continue;
      if (mine.length >= maxAttempts()) {
        const key = `${provider}:${date}`;
        if (!this.gaveUp.has(key)) {
          this.gaveUp.add(key);
          this.logger.error(`정기 대사 ${date} ${provider}: ${mine.length}번 모두 성공하지 못해 더 돌지 않는다. 원인을 고친 뒤 npm run payments:reconcile -- --date=${date}`);
        }
        continue;
      }
      const last = mine[0];
      if (last && now.getTime() - last.startedAt.getTime() < retryIntervalMs()) continue;
      due.push(provider);
    }
    return due;
  }

  // provider마다 마지막 성공 뒤 연속으로 실패한(성공하지 못한) run 수
  private async updateFailureGauge(providers: ProviderId[]) {
    for (const provider of providers) {
      const recent: RunRow[] = await this.prisma.reconciliationRun.findMany({
        where: { provider }, select: { provider: true, startedAt: true, finishedAt: true, error: true }, orderBy: { id: "desc" }, take: 50,
      });
      const streak = recent.findIndex(succeeded);
      reconciliationFailures.set({ provider }, streak === -1 ? recent.length : streak);
    }
  }
}
