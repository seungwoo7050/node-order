process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 20);
const DEPTHS = [0, 1_000, 10_000, 100_000, 250_000];

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

async function time(query) {
  const start = performance.now();
  const res = await fetch(`${API}/orders?${new URLSearchParams({ limit: "20", ...query })}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  return { ms: performance.now() - start, body };
}
const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];

await time({});
const table = [];
for (const depth of DEPTHS) {
  const cursor = depth === 0 ? undefined : (await time({ offset: String(depth - 20) })).body.nextCursor;
  const offsetMs = [];
  const cursorMs = [];
  for (let i = 0; i < N; i++) {
    offsetMs.push((await time({ offset: String(depth) })).ms);
    cursorMs.push((await time(cursor ? { cursor } : {})).ms);
  }
  table.push({ "깊이(건너뛴 행)": depth, "offset 중앙값(ms)": +median(offsetMs).toFixed(1), "cursor 중앙값(ms)": +median(cursorMs).toFixed(1) });
}
console.table(table);
