import pg from "pg";

const SECONDS = Number(process.argv[2] ?? 20);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: cols } = await db.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('price', 'total_amount')",
);
const names = cols.map((c) => c.column_name);
const insert = `INSERT INTO orders (user_id, paid, ${names.join(", ")}) VALUES ('loadtest', true, ${names.map(() => 1000).join(", ")})`;
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  const start = performance.now();
  await db.query(insert);
  samples.push({ at: (Date.now() - t0) / 1000, ms: performance.now() - start });
  await new Promise((r) => setTimeout(r, 20));
}
await db.end();
const slow = samples.filter((s) => s.ms > 100);
const worst = samples.reduce((a, b) => (b.ms > a.ms ? b : a));
console.log(`넣은 주문 ${samples.length}개, 100ms 넘게 걸린 것 ${slow.length}개, 가장 오래 걸린 것 ${worst.ms.toFixed(0)}ms (시작 후 ${worst.at.toFixed(1)}초)`);
