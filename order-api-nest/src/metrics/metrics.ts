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

// MCP 도구 호출 결과(ok, error). tool 라벨은 등록된 도구 이름만(없는 이름은 unknown - 손님이 정하는 값을 라벨에 넣지 않는다)
export const mcpToolCalls = new Counter({
  name: "mcp_tool_calls_total",
  help: "MCP 도구 호출 결과 수(ok, error)",
  labelNames: ["tool", "result"] as const,
  registers: [registry],
});

// ── 업무 지표(31) ───────────────────────────────────────────────
// 라벨에 손님 정보나 주문 id를 넣지 않는다(카디널리티와 개인정보). 라벨은 provider·reason 같은 작은 고정 집합만

// 결제 승인 시도와 실패. 실패율 경보는 failed / attempts
export const paymentConfirmAttempts = new Counter({
  name: "payments_confirm_attempts_total",
  help: "결제 승인 시도 수(토스 승인 요청, Stripe 결제 완료 웹훅)",
  labelNames: ["provider"] as const,
  registers: [registry],
});

export const paymentConfirmFailed = new Counter({
  name: "payments_confirm_failed_total",
  help: "결제 승인 실패 수(reason: amount_mismatch, rejected, unknown_outcome, pg_mismatch, not_paid, canceled_meanwhile)",
  labelNames: ["provider", "reason"] as const,
  registers: [registry],
});

// 시계열을 0으로 미리 만든다(첫 실패도 경보의 increase()에 잡히게. 처음 생긴 시계열의 첫 값은 increase가 세지 않는다)
for (const provider of ["toss", "stripe"]) {
  paymentConfirmAttempts.inc({ provider }, 0);
  for (const reason of ["amount_mismatch", "rejected", "unknown_outcome", "pg_mismatch", "not_paid", "canceled_meanwhile"]) paymentConfirmFailed.inc({ provider, reason }, 0);
}

// 재시도를 다 쓰고 failed로 옮겨진 메일 job
export const mailJobsFailed = new Counter({
  name: "mail_jobs_failed_total",
  help: "재시도를 소진해 실패로 끝난 메일 job 수",
  registers: [registry],
});

// 아래 게이지는 리더 인스턴스의 BusinessMetricsJob이 주기적으로 계산한다(다른 인스턴스는 값이 없다).
// 계산이 실패하면 NaN(경보 비교가 거짓이 되고, 대시보드에 빈칸으로 보인다)
const gauge = (name: string, help: string) => new Gauge({ name, help, registers: [registry] });
export const businessGauges = {
  reconciliationOpenIssues: gauge("reconciliation_open_issues", "해결되지 않은 PG 대사 불일치 수"),
  refundsUnresolvedOldest: gauge("refunds_unresolved_oldest_seconds", "결과 미상(requested) 환불 중 가장 오래된 것의 나이(초). 없으면 0"),
  searchIndexLag: gauge("search_index_lag_seconds", "검색 색인을 기다리는 가장 오래된 search_dirty 행의 나이(초). 없으면 0"),
  outboxOldestUnpublished: gauge("outbox_oldest_unpublished_seconds", "발행되지 않은 가장 오래된 outbox 이벤트의 나이(초). 없으면 0"),
  fulfillmentOverdue: gauge("fulfillment_overdue_orders", "결제 완료(paid) 뒤 FULFILLMENT_OVERDUE_DAYS일 넘게 배송 준비를 시작하지 않은 주문 수"),
};

// 하루 LLM 토큰 상한(LLM_DAILY_TOKEN_BUDGET, 입력+출력). 경보가 sum(increase(llm_tokens_total[1d]))와 비교한다
export const llmDailyTokenBudget = new Gauge({
  name: "llm_daily_token_budget",
  help: "하루 LLM 토큰(입력+출력) 상한. 넘으면 LlmDailyTokenBudgetExceeded 경보",
  registers: [registry],
});
llmDailyTokenBudget.set(Number(process.env.LLM_DAILY_TOKEN_BUDGET ?? 200_000));

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
