import { inspect } from "node:util";

// 로그에 남길 오류 한 줄. Prisma 오류는 message가 비거나 원인이 cause(드라이버 어댑터 오류)에만 있어
// name, message, code, meta, cause를 이어 붙인다. cause는 3단계까지 따라간다.
export function describeError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return inspect(err, { depth: 2, breakLength: Infinity });
  const e = err as Error & { code?: unknown; meta?: unknown; cause?: unknown };
  const parts = [`${e.name}: ${e.message.trim() || "(메시지 없음)"}`];
  if (e.code !== undefined) parts.push(`code=${String(e.code)}`);
  if (e.meta !== undefined) parts.push(`meta=${JSON.stringify(e.meta)}`);
  if (e.cause !== undefined) parts.push(depth < 3 ? `cause=[${describeError(e.cause, depth + 1)}]` : "cause=[…]");
  return parts.join(" ");
}
