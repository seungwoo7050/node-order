const JAEGER = process.env.JAEGER_URL ?? "http://localhost:16686";
const operation = process.argv[2] ?? "POST /orders/checkout";

const now = new Date();
const params = new URLSearchParams({
  "query.service_name": "order-api",
  "query.operation_name": operation,
  "query.start_time_min": new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  "query.start_time_max": now.toISOString(),
});
const res = await fetch(`${JAEGER}/api/v3/traces?${params}`);
if (!res.ok) {
  console.error(`Jaeger 응답 ${res.status}: 최근 1시간 안에 "${operation}" 추적이 없거나 Jaeger가 떠 있지 않습니다`);
  process.exit(1);
}
const { result } = await res.json();

const spans = result.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const traces = Map.groupBy(spans, (s) => s.traceId);
const roots = spans.filter((s) => !s.parentSpanId);
const latestRoot = roots.reduce((a, b) => (BigInt(a.startTimeUnixNano) > BigInt(b.startTimeUnixNano) ? a : b));
const trace = traces.get(latestRoot.traceId);

const resource = result.resourceSpans.find((r) => r.scopeSpans.some((s) => s.spans.includes(latestRoot))).resource;
const host = resource.attributes.find((a) => a.key === "host.name")?.value.stringValue;
console.log(`host: ${host}`);

const t0 = BigInt(latestRoot.startTimeUnixNano);
const ms = (ns) => (Number(ns) / 1e6).toFixed(1);
const children = Map.groupBy(trace, (s) => s.parentSpanId ?? "");
const sqlOf = (s) => s.attributes?.find((a) => a.key === "db.statement" || a.key === "db.query.text")?.value.stringValue;

function print(span, depth) {
  const start = `+${ms(BigInt(span.startTimeUnixNano) - t0)}ms`.padStart(9);
  const dur = `(${ms(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano))}ms)`;
  const sql = sqlOf(span);
  console.log(`${start} ${"  ".repeat(depth)}${span.name}  ${dur}${sql ? `  ${sql.replace(/\s+/g, " ").slice(0, 70)}` : ""}`);
  const kids = (children.get(span.spanId) ?? []).sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1));
  for (const k of kids) print(k, depth + 1);
}
print(latestRoot, 0);
console.log(`span 수: ${trace.length}`);