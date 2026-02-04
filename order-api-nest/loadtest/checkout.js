import http from "k6/http";
import { check } from "k6";

const API = __ENV.API ?? "http://api:4000";
const HOT = __ENV.HOT === "1";

export const options = {
  vus: Number(__ENV.VUS ?? 20),
  duration: __ENV.DURATION ?? "20s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:checkout}": ["p(95)<200"],
  },
};

export function setup() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ id: "kim", password: "1234" }), {
    headers: { "Content-Type": "application/json" },
  });
  const loadIds = [];
  for (let cursor = null; ;) {
    const page = http.get(`${API}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`).json();
    loadIds.push(...page.items.filter((p) => p.name.startsWith("부하용 상품") && p.stock > 0).map((p) => p.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { token: res.json("accessToken"), loadIds };
}

export default function (data) {
  const productId = HOT ? 5 : data.loadIds[Math.floor(Math.random() * data.loadIds.length)];
  const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: [{ productId, quantity: 1 }] }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
    tags: { name: "checkout" },
  });
  check(res, { "201 Created": (r) => r.status === 201 });
}
