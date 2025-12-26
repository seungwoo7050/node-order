import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { LeaderElection } from "./leader-election.js";

@Injectable()
export class TokenCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TokenCleanupJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.CLEANUP_INTERVAL_MS ?? 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader) return;
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM refresh_tokens WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE expires_at < now() - interval '1 day'
        LIMIT 1000)`;
    if (deleted > 0) this.logger.log(`토큰 정리: ${deleted}건 삭제`);
  }
}