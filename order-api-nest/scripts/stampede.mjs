import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 50);
const items = JSON.parse(process.argv[3] ?? '[{"productId":1,"quantity":1}]');

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

const statuses = await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ items }),
    }).then((r) => r.status),
  ),
);
const tally = statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
console.log("응답 코드별 개수:", tally);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(`
  SELECT p.id, p.name, p.stock AS "남은 재고", COALESCE(SUM(oi.quantity), 0)::int AS "팔린 수량"
  FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
  GROUP BY p.id ORDER BY p.id`);
console.table(rows);
await db.end();