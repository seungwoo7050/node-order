import { readFileSync } from "node:fs";

const NAMES = ["list", "detail", "myOrders", "write"];
const split = (line) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => m[1].replace(/^"|"$/g, "").replaceAll('""', '"'));

const [header, ...lines] = readFileSync(process.argv[2], "utf8").trim().split("\n");
const col = Object.fromEntries(split(header).map((name, i) => [name, i]));
const reqs = lines
  .map(split)
  .filter((c) => c[col.metric_name] === "http_reqs" && NAMES.includes(c[col.name]))
  .map((c) => ({ t: Number(c[col.timestamp]), name: c[col.name], status: c[col.status], ok: c[col.expected_response] === "true" }))
  .sort((a, b) => a.t - b.t);
if (reqs.length === 0) throw new Error("시나리오 요청이 없다. k6가 setup에서 멈췄는지 본다");

const fail = reqs.filter((r) => !r.ok);
const start = reqs[0].t;
const clock = (t) => new Date(t).toISOString().slice(11, 23);
console.log(`요청 ${reqs.length}개, 실패 ${fail.length}개 (${((fail.length / reqs.length) * 100).toFixed(2)}%)`);
if (fail.length === 0) process.exit(0);

const byKind = {};
for (const r of fail) byKind[`${r.name} ${r.status}`] = (byKind[`${r.name} ${r.status}`] ?? 0) + 1;
console.log("실패 종류:", Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", "));
console.log(`실패 구간: ${clock(fail[0].t)} ~ ${clock(fail.at(-1).t)} (시작 후 ${((fail[0].t - start) / 1000).toFixed(1)}초부터 ${((fail.at(-1).t - fail[0].t) / 1000).toFixed(1)}초)`);

let longest = { from: 0, to: 0, n: 0 };
let run = null;
for (const r of reqs) {
  if (r.ok) { run = null; continue; }
  run ??= { from: r.t, to: r.t, n: 0 };
  run.to = r.t;
  run.n++;
  if (longest.n === 0 || run.to - run.from > longest.to - longest.from) longest = { ...run };
}
console.log(`연달아 실패한 가장 긴 구간: ${((longest.to - longest.from) / 1000).toFixed(2)}초 (실패 ${longest.n}개)`);

const perSec = new Map();
for (const r of fail) {
  const s = Math.floor((r.t - start) / 1000);
  perSec.set(s, (perSec.get(s) ?? 0) + 1);
}
console.log("초별 실패(시작 후 초:개수):", [...perSec].map(([s, n]) => `${s}:${n}`).join(" "));
