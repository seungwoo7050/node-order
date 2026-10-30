import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { kstDate, periodOf, ReconciliationService } from "../reconciliation/reconciliation.service.js";
import { LeaderElection } from "./leader-election.js";

const RUN_AT_KST_HOUR = 4; // 매일 04:00(Asia/Seoul) 뒤 첫 확인 때 전날 분을 대사한다
const KST_OFFSET_MS = 9 * 3600_000;

// PG 대사 정기 작업. 리더 한 곳에서만 돈다.
// 정각 타이머 대신 주기적으로 확인한다: 04:00 전후로 재시작하거나 리더가 바뀌어도, 전날 분 run이 아직 없으면 그때 돈다.
// 하루 한 번만 돈다(전날 기간의 run이 하나라도 있으면 건너뛴다). 실패한 provider는 run.error에 남고, 다시 돌리는 것은
// npm run payments:reconcile -- --date=YYYY-MM-DD 로 한다(결과는 upsert라 같은 날을 여러 번 돌려도 된다)
@Injectable()
export class ReconciliationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

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
      const done = await this.prisma.reconciliationRun.count({ where: { periodStart: periodOf(date).from } });
      if (done > 0) return false;
      const result = await this.reconciliation.run(date);
      if (result.failed) this.logger.error(`정기 대사 ${date}: 실패한 PG가 있다(${result.runs.filter((r) => r.error).map((r) => r.provider).join(", ")})`);
      return true;
    } catch (err) {
      this.logger.error(`정기 대사 실패 - 다음 확인 때 다시 시도합니다: ${(err as Error).message}`);
      return false;
    } finally {
      this.running = false;
    }
  }
}
