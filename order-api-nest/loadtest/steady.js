import http from "k6/http";
import { check } from "k6";

const API = __ENV.API ?? "http://localhost:8081";
const DURATION = __ENV.DURATION ?? "3m";
const rate = (name, perSecond) => ({
  executor: "constant-arrival-rate", exec: name, rate: perSecond, timeUnit: "1s", duration: DURATION,
  preAllocatedVUs: perSecond * 2, maxVUs: perSecond * 20,
});

export const options = {
  scenarios: {
    browse: rate("browse", Number(__ENV.BROWSE_RPS ?? 30)),
    myOrders: rate("myOrders", Number(__ENV.MY_ORDERS_RPS ?? 10)),
    write: rate("write", Number(__ENV.WRITE_RPS ?? 10)),
  },
  summaryTrendStats: ["avg", "p(95)", "p(99)", "max"],
};

const json = { "Content-Type": "application/json" };
const params = (token, name) => ({ headers: { ...json, Authorization: `Bearer ${token}` }, tags: { name }, timeout: "10s" });

export function setup() {
  if (!__ENV.LOADTEST_PASSWORD) throw new Error("LOADTEST_PASSWORD가 없다");
  const login = http.post(`${API}/auth/login`, JSON.stringify({ id: "loadtest", password: __ENV.LOADTEST_PASSWORD }), { headers: json });
  if (login.status !== 200) throw new Error(`loadtest로 로그인하지 못했다(${login.status})`);
  const token = login.json("accessToken");
  const probe = http.post(`${API}/orders`, JSON.stringify({ user: "loadtest", price: 1000, paid: true }), params(token, "setup"));
  if (probe.status !== 201) throw new Error(`주문을 쓰지 못했다(${probe.status}). loadtest가 관리자인지 본다`);
  if (probe.headers["Ratelimit-Limit"]) console.warn("요청 수 제한을 받고 있다(허용 목록 밖). 초당 4개 넘게 보내면 429가 섞인다");
  const list = http.get(`${API}/products?limit=20`).json();
  const ids = (Array.isArray(list) ? list : list.items).map((p) => p.id);
  if (ids.length === 0) throw new Error("상품이 없다. 시드를 넣었는지 본다");
  const hasDetail = http.get(`${API}/products/${ids[0]}`, { responseCallback: http.expectedStatuses(200, 404) }).status === 200;
  return { token, ids, hasDetail };
}

export function browse(data) {
  if (!data.hasDetail || Math.random() < 0.5) {
    const res = http.get(`${API}/products?limit=20`, { tags: { name: "list" }, timeout: "10s" });
    check(res, { "목록 200": (r) => r.status === 200 });
  } else {
    const id = data.ids[Math.floor(Math.random() * data.ids.length)];
    const res = http.get(`${API}/products/${id}`, { tags: { name: "detail" }, timeout: "10s" });
    check(res, { "상세 200": (r) => r.status === 200 });
  }
}

export function myOrders(data) {
  const res = http.get(`${API}/me/orders?limit=20`, params(data.token, "myOrders"));
  check(res, { "내 주문 200": (r) => r.status === 200 });
}

export function write(data) {
  const res = http.post(`${API}/orders`, JSON.stringify({ user: "loadtest", price: 1000, paid: true }), params(data.token, "write"));
  check(res, { "주문 201": (r) => r.status === 201 });
}
