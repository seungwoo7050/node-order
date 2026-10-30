import { PgError } from "./payment-gateway.js";

// PG 조회(대사의 거래 목록·결제 재조회)를 여러 건 부를 때의 동시성 상한과 재시도.
// 조회(GET)만 쓴다: 승인·환불은 결과를 모르는 실패를 멱등 키와 재조회로 다루므로(refund-resolver) 여기서 다시 보내지 않는다
export const PG_READ_CONCURRENCY = 4; // 한 번에 PG에 보내는 조회 수(PG 요청 한도에 걸리지 않게 작게)
export const PG_RETRY = { attempts: 4, baseMs: 200, maxMs: 5_000 }; // 처음 1번 + 재시도 3번, 200 → 400 → 800ms, 한 번 기다림은 5초까지

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 429(요청 한도)와 5xx만 다시 보낸다. 4xx(404 등)는 다시 보내도 같다
export function isRetryable(err: unknown): err is PgError {
  return err instanceof PgError && err.status !== undefined && (err.status === 429 || err.status >= 500);
}

// Retry-After: 초(정수) 또는 HTTP 날짜. 못 읽으면 undefined
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

// 지수 백오프. PG가 Retry-After를 주면 그보다 일찍 다시 보내지 않는다
export async function withPgRetry<T>(fn: () => Promise<T>, opts: { attempts: number; baseMs: number; maxMs: number; sleep?: (ms: number) => Promise<void> } = PG_RETRY): Promise<T> {
  const wait = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= opts.attempts - 1) throw err;
      const backoff = opts.baseMs * 2 ** attempt;
      await wait(Math.min(opts.maxMs, Math.max(backoff, err.retryAfterMs ?? 0)));
    }
  }
}

// 순서를 지키며 한 번에 limit개까지만 돌린다. 하나가 실패하면 남은 항목은 보내지 않고, 진행 중인 것에는 signal로 취소를 알린 뒤
// 그 오류로 끝난다(실패한 대사에 쓸 결과를 더 모으느라 PG 요청 한도를 쓰지 않게)
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const abort = new AbortController();
  let next = 0;
  const worker = async () => {
    while (next < items.length && !abort.signal.aborted) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, abort.signal);
      } catch (err) {
        abort.abort(err);
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
