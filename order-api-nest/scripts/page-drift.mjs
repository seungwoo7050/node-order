import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();
const get = async (query) =>
  (await fetch(`${API}/orders?${new URLSearchParams({ limit: "5", ...query })}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
const ids = (page) => page.items.map((o) => o.id).join(", ");

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();

console.log("① 1쪽을 읽은 뒤 새 주문 2건이 들어온다");
const p1 = await get({});
console.log(`   1쪽              : ${ids(p1)}`);
const { rows: added } = await db.query(`INSERT INTO orders (user_id, total_amount, paid) VALUES ('lee', 1000, true), ('lee', 1000, true) RETURNING id`);
console.log(`   offset=5로 2쪽   : ${ids(await get({ offset: "5" }))}`);
console.log(`   cursor로 2쪽     : ${ids(await get({ cursor: p1.nextCursor }))}`);
await db.query(`DELETE FROM orders WHERE id = ANY($1)`, [added.map((r) => r.id)]);

console.log("② 결제 대기 1쪽을 읽은 뒤 그중 2건이 결제된다");
const u1 = await get({ paid: "false" });
console.log(`   1쪽              : ${ids(u1)}`);
const paidIds = u1.items.slice(0, 2).map((o) => o.id);
await db.query(`UPDATE orders SET paid = true WHERE id = ANY($1)`, [paidIds]);
const byOffset = await get({ paid: "false", offset: "5" });
const byCursor = await get({ paid: "false", cursor: u1.nextCursor });
console.log(`   offset=5로 2쪽   : ${ids(byOffset)}`);
console.log(`   cursor로 2쪽     : ${ids(byCursor)}`);
const skipped = byCursor.items.filter((o) => !byOffset.items.some((x) => x.id === o.id)).map((o) => o.id);
console.log(`   offset이 건너뛴 주문: ${skipped.join(", ") || "없음"}`);
await db.query(`UPDATE orders SET paid = false WHERE id = ANY($1)`, [paidIds]);

await db.end();
