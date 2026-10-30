import type { NextFunction, Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP 요청 처리 시간(초)",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const webhookEvents = new Counter({
  name: "stripe_webhook_events_total",
  help: "처리한 Stripe 웹훅 이벤트 수",
  labelNames: ["type", "result"] as const,
  registers: [registry],
});

export const tossEvents = new Counter({
  name: "toss_payment_events_total",
  help: "토스 승인 요청·웹훅 처리 결과 수",
  labelNames: ["kind", "result"] as const,
  registers: [registry],
});

export const refundRequests = new Counter({
  name: "payment_refunds_total",
  help: "환불 요청 결과 수(succeeded, failed, requested=결과 모름)",
  labelNames: ["provider", "result"] as const,
  registers: [registry],
});

export const rateLimited = new Counter({
  name: "http_rate_limited_total",
  help: "요청 수 제한으로 거절한 요청 수",
  labelNames: ["bucket"] as const,
  registers: [registry],
});

export const catalogCacheRequests = new Counter({
  name: "catalog_cache_requests_total",
  help: "카탈로그 캐시 조회 수",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const catalogLoads = new Counter({
  name: "catalog_loads_total",
  help: "카탈로그를 DB에서 읽은 횟수",
  registers: [registry],
});

// 정기 대사가 provider별로 마지막 성공 뒤 연속으로 실패한 run 수(31에서 경보를 건다)
export const reconciliationFailures = new Gauge({
  name: "reconciliation_consecutive_failures",
  help: "PG 대사 run이 마지막 성공 뒤 연속으로 실패한 수(provider별)",
  labelNames: ["provider"] as const,
  registers: [registry],
});

export const llmTokens = new Counter({
  name: "llm_tokens_total",
  help: "LLM 공급자가 알려 준 입력·출력 토큰 수",
  labelNames: ["provider", "model", "direction"] as const,
  registers: [registry],
});

export const llmRequests = new Counter({
  name: "llm_requests_total",
  help: "LLM 생성 요청 결과 수(ok, error, aborted=손님이 끊음, rate_limited)",
  labelNames: ["feature", "result"] as const,
  registers: [registry],
});

function routeOf(req: Request): string {
  const path = req.route?.path as string | undefined;
  if (!path || path === "{/*splat}") return "unmatched";
  return `${req.baseUrl}${path}`;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.split("?")[0] === "/metrics") return next();
  const end = httpDuration.startTimer();
  res.on("finish", () => end({ method: req.method, route: routeOf(req), status_code: String(res.statusCode) }));
  next();
}
