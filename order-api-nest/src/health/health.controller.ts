import { Controller, Get, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${ms}ms 초과`)), ms))]);

@ApiTags("health")
@Controller("health")
export class HealthController implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.redis.on("error", () => {});
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }

  @Get()
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    const checks = {
      db: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
      storage: () => this.storage.ping(),
    };
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), 1000);
          return [name, "ok"] as const;
        } catch (err) {
          return [name, (err as Error).message || "error"] as const;
        }
      }),
    );
    const body = { status: results.every(([, r]) => r === "ok") ? "ok" : "fail", checks: Object.fromEntries(results) };
    if (body.status !== "ok") throw new ServiceUnavailableException(body);
    return body;
  }
}