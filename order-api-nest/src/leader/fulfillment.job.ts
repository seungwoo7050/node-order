import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { FulfillmentService } from "../fulfillment/fulfillment.service.js";
import { LeaderElection } from "./leader-election.js";

// 자동 전이(배송 완료·구매확정·반품 완료). 리더 한 곳에서만 돈다. 조건부 update라 두 번 돌아도 결과가 같다
@Injectable()
export class FulfillmentJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FulfillmentJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.FULFILLMENT_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run(now = new Date()) {
    if (!this.leaderElection.isLeader || this.running) return;
    this.running = true;
    try {
      await this.fulfillment.autoAdvance(now);
    } catch (err) {
      this.logger.error(`자동 전이 실패 - 다음 회차에 다시 시도합니다: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
