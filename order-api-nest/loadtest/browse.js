import http from "k6/http";
import { check } from "k6";

const API = __ENV.API ?? "http://api:4000";
const DURATION = __ENV.DURATION ?? "20s";

export const options = {
  scenarios: {
    browse: { executor: "constant-vus", vus: Number(__ENV.BROWSERS ?? 20), duration: DURATION, exec: "browse" },
    buy: { executor: "constant-vus", vus: Number(__ENV.BUYERS ?? 5), duration: DURATION, exec: "buy" },
  },
  thresholds: {
    "http_req_duration{name:list}": ["p(95)<1000"],
    "http_reqs{name:list}": ["count>0"],
    "http_reqs{name:checkout}": ["count>0"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ id: "kim", password: "1234" }), { headers: { "Content-Type": "application/json" } });
  if (res.status !== 200) throw new Error(`kim으로 로그인하지 못했다(${res.status})`);
  const loadIds = [];
  for (let cursor = null; ;) {
    const page = http.get(`${API}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`).json();
    loadIds.push(...page.items.filter((p) => p.name.startsWith("부하용 상품") && p.stock > 0).map((p) => p.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  if (loadIds.length === 0) throw new Error("부하용 상품이 없다. loadtest/load-seed.sql을 넣었는지 본다");
  return { token: res.json("accessToken"), loadIds };
}

export function browse() {
  const res = http.get(`${API}/products`, { tags: { name: "list" } });
  check(res, { "목록 200": (r) => r.status === 200 });
}

export function buy(data) {
  const productId = data.loadIds[Math.floor(Math.random() * data.loadIds.length)];
  const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: [{ productId, quantity: 1 }] }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
    tags: { name: "checkout" },
  });
  check(res, { "결제 201": (r) => r.status === 201 });
}
