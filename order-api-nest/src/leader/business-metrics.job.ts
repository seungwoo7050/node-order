import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { describeError } from "../logger/describe-error.js";
import { businessGauges } from "../metrics/metrics.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LeaderElection } from "./leader-election.js";

const DAY_MS = 86_400_000;
const overdueDays = () => Number(process.env.FULFILLMENT_OVERDUE_DAYS ?? 3);
const ageSeconds = (oldest: Date | null | undefined, now: Date) => (oldest ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000) : 0);

// 업무 지표 게이지를 BUSINESS_METRICS_INTERVAL_MS(기본 30초)마다 DB에서 계산한다. 리더 한 곳에서만 돈다
// (/metrics를 긁을 때마다 묻지 않는다: 스크레이프가 늘어도 DB에 가는 쿼리 수가 같고, 느린 쿼리가 /metrics를 붙잡지 않는다).
// 리더가 아니면 0으로 돌린다(라벨 없는 게이지는 reset하면 0으로 보인다. 옛 리더의 낡은 값이 남지 않게).
// 경보 규칙은 max()로 인스턴스를 합친다.
// 라벨이 없다: 손님 정보나 주문 id를 라벨에 넣지 않는다
@Injectable()
export class BusinessMetricsJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BusinessMetricsJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private failing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.BUSINESS_METRICS_INTERVAL_MS ?? 30_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<boolean> {
    if (!this.leaderElection.isLeader) {
      for (const g of Object.values(businessGauges)) g.reset();
      return false;
    }
    if (this.running) return false;
    this.running = true;
    try {
      await this.collect(now);
      if (this.failing) this.logger.log("업무 지표 계산이 다시 된다");
      this.failing = false;
      return true;
    } catch (err) {
      if (!this.failing) this.logger.warn(`업무 지표 계산 실패(다음 회차에 다시): ${describeError(err)}`);
      this.failing = true;
      for (const g of Object.values(businessGauges)) g.set(Number.NaN);
      return false;
    } finally {
      this.running = false;
    }
  }

  async collect(now: Date): Promise<void> {
    const overdueBefore = new Date(now.getTime() - overdueDays() * DAY_MS);
    const [openIssues, refund, dirty, outbox, overdue] = await this.prisma.asAdmin((tx) => Promise.all([
      tx.reconciliationIssue.count({ where: { resolvedAt: null } }),
      tx.refund.aggregate({ where: { status: "requested" }, _min: { createdAt: true } }),
      tx.searchDirty.aggregate({ _min: { markedAt: true } }),
      tx.outboxEvent.aggregate({ where: { publishedAt: null }, _min: { createdAt: true } }),
      tx.order.count({ where: { status: "paid", statusChangedAt: { lt: overdueBefore } } }),
    ]));
    businessGauges.reconciliationOpenIssues.set(openIssues);
    businessGauges.refundsUnresolvedOldest.set(ageSeconds(refund._min.createdAt, now));
    businessGauges.searchIndexLag.set(ageSeconds(dirty._min.markedAt, now));
    businessGauges.outboxOldestUnpublished.set(ageSeconds(outbox._min.createdAt, now));
    businessGauges.fulfillmentOverdue.set(overdue);
  }
}
