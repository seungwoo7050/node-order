import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { LeaderElection } from "./leader-election.js";

@Injectable()
export class OrphanImageCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrphanImageCleanupJob.name);
  private timer?: NodeJS.Timeout;
  private readonly minAgeMs = Number(process.env.ORPHAN_MIN_AGE_SECONDS ?? 3600) * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.ORPHAN_CLEANUP_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader) return;
    const objects = await this.storage.list("products/");
    const rows = await this.prisma.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } });
    const used = new Set(rows.map((r) => r.imageKey));
    const cutoff = Date.now() - this.minAgeMs;
    const orphans = objects.filter((o) => !used.has(o.key) && o.lastModified.getTime() < cutoff);
    for (const o of orphans) await this.storage.delete(o.key);
    if (orphans.length > 0) this.logger.log(`고아 이미지 ${orphans.length}개 삭제`);
  }
}