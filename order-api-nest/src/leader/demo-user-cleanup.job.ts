import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { deleteUsers } from "../auth/demo-user.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LeaderElection } from "./leader-election.js";

@Injectable()
export class DemoUserCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DemoUserCleanupJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.DEMO_CLEANUP_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader) return;
    const deleted = await this.prisma.asAdmin(async (tx) => {
      const expired = await tx.user.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true }, take: 100 });
      return deleteUsers(tx, expired.map((u) => u.id));
    });
    if (deleted > 0) this.logger.log(`임시 사용자 정리: ${deleted}명 삭제`);
  }
}
