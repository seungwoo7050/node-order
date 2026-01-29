import { Injectable, Logger, NestMiddleware, OnModuleDestroy } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";
import { rateLimited } from "../metrics/metrics.js";

const WINDOW_SECONDS = 60;
const AUTH_PATHS = new Set(["/auth/login", "/auth/demo", "/auth/exchange", "/auth/refresh"]);
const SKIP_PREFIXES = ["/health", "/metrics", "/payments/webhook"];

const limitOf = (name: string) => Number(process.env[name] ?? 0) || 0;

@Injectable()
export class RateLimitStore implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor() {
    this.redis.on("error", () => {});
  }

  async hit(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
    return Number(results?.[0]?.[1] ?? 0);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly general = limitOf("RATE_LIMIT_PER_MINUTE");
  private readonly auth = limitOf("AUTH_RATE_LIMIT_PER_MINUTE");

  constructor(private readonly store: RateLimitStore) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split("?")[0];
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return next();
    const isAuth = req.method === "POST" && AUTH_PATHS.has(path);
    const bucket = isAuth ? "auth" : "all";
    const limit = isAuth ? this.auth : this.general;
    if (limit <= 0) return next();

    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rate:${bucket}:${req.ip}:${window}`;
    let count: number;
    try {
      count = await this.store.hit(key, WINDOW_SECONDS);
    } catch (err) {
      this.logger.warn(`요청 수를 세지 못해 통과시킨다: ${(err as Error).message}`);
      return next();
    }

    const retryAfter = (window + 1) * WINDOW_SECONDS - Math.floor(Date.now() / 1000);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", Math.max(0, limit - count));
    if (count <= limit) return next();

    rateLimited.inc({ bucket });
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ statusCode: 429, message: `요청이 너무 많습니다. ${retryAfter}초 뒤에 다시 시도하세요` });
  }
}
