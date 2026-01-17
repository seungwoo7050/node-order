import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

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
