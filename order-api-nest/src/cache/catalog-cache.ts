import { Global, Injectable, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { catalogCacheRequests, catalogLoads } from "../metrics/metrics.js";
import { CATALOG_KEY, CATALOG_KEYS_TO_CLEAR } from "./catalog-key.js";

const TTL_SECONDS = Number(process.env.CATALOG_TTL_SECONDS ?? 60);
const MISS = Symbol("miss");
const ERROR = Symbol("error");

@Injectable()
export class CatalogCache implements OnModuleDestroy {
  private readonly logger = new Logger(CatalogCache.name);
  private readonly redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 100 });
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor() {
    this.redis.on("error", () => {});
  }

  async getOrLoad<T>(field: string, load: () => Promise<T>): Promise<T> {
    const cached = await this.read(field);
    if (cached !== MISS && cached !== ERROR) {
      catalogCacheRequests.inc({ result: "hit" });
      return cached as T;
    }
    catalogCacheRequests.inc({ result: cached === ERROR ? "error" : "miss" });
    const running = this.inflight.get(field);
    if (running) return running as Promise<T>;
    const loading = (async () => {
      catalogLoads.inc();
      const value = await load();
      await this.write(field, value);
      return value;
    })().finally(() => this.inflight.delete(field));
    this.inflight.set(field, loading);
    return loading;
  }

  async invalidate(): Promise<void> {
    try {
      await this.redis.del(...CATALOG_KEYS_TO_CLEAR);
    } catch (err) {
    }
  }

  private async read(field: string): Promise<unknown> {
    try {
      const raw = await this.redis.hget(CATALOG_KEY, field);
      return raw === null ? MISS : JSON.parse(raw);
    } catch {
      return ERROR;
    }
  }

  private async write(field: string, value: unknown) {
    try {
      await this.redis.multi().hset(CATALOG_KEY, field, JSON.stringify(value)).expire(CATALOG_KEY, TTL_SECONDS, "NX").exec();
    } catch {
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}

@Global()
@Module({ providers: [CatalogCache], exports: [CatalogCache] })
export class CatalogCacheModule {}
