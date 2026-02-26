import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";
const MODE = process.argv[2] ?? "delta";
const TOGETHER = process.argv[3] === "together";
const PRODUCT = 5;
const START = 10;
const BUYERS = 5;
const RESTOCK = 40;

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();
await db.query("UPDATE products SET stock = $1 WHERE id = $2", [START, PRODUCT]);

async function login(id) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password: process.env.DEMO_PASSWORD }),
  });
  return (await res.json()).accessToken;
}
const admin = await login("kim");
const buyer = await login("lee");
const headers = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

const { items } = await (await fetch(`${API}/products?limit=100`)).json();
const seen = items.find((p) => p.id === PRODUCT).stock;
console.log(`관리자가 본 재고: ${seen}`);

const checkout = () =>
  fetch(`${API}/orders/checkout`, { method: "POST", headers: headers(buyer), body: JSON.stringify({ items: [{ productId: PRODUCT, quantity: 1 }] }) })
    .then((r) => r.status);
const restock = () =>
  MODE === "set"
    ? fetch(`${API}/products/${PRODUCT}/stock`, { method: "PUT", headers: headers(admin), body: JSON.stringify({ stock: seen + RESTOCK }) })
    : fetch(`${API}/products/${PRODUCT}/stock-adjustments`, { method: "POST", headers: headers(admin), body: JSON.stringify({ delta: RESTOCK }) });

let statuses;
let saved;
if (TOGETHER) {
  [saved, ...statuses] = await Promise.all([restock(), ...Array.from({ length: BUYERS }, checkout)]);
} else {
  statuses = await Promise.all(Array.from({ length: BUYERS }, checkout));
  saved = await restock();
}
console.log(`결제 응답: ${statuses.join(", ")} / 관리자 저장(${MODE}): ${saved.status}`);

const sold = statuses.filter((s) => s === 201).length;
const { rows } = await db.query("SELECT stock FROM products WHERE id = $1", [PRODUCT]);
const expected = START - sold + RESTOCK;
const actual = rows[0].stock;
console.log(`맞는 재고 ${START} - ${sold} + ${RESTOCK} = ${expected}, 실제 재고 ${actual}${actual === expected ? "" : ` → ${actual - expected}개가 장부 없이 생겼다`}`);
await db.end();
