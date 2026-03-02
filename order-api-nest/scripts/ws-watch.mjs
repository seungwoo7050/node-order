import { io } from "socket.io-client";

const SECONDS = Number(process.argv[2] ?? 90);
const API = process.argv[3] ?? "http://localhost:8081";
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
if (!process.env.LOADTEST_PASSWORD) throw new Error("LOADTEST_PASSWORD가 없다. 1장 작업 1의 블록을 이 터미널에서 친다");

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "loadtest", password: process.env.LOADTEST_PASSWORD }),
});
if (!login.ok) throw new Error(`loadtest로 로그인하지 못했다(${login.status})`);
const { accessToken } = await login.json();

const socket = io(API, { auth: { token: accessToken } });
let downSince = null;
socket.on("connect", () => {
  console.log(`${at()} 연결${downSince ? ` (끊긴 지 ${((Date.now() - downSince) / 1000).toFixed(1)}초 만에 다시)` : ""}`);
  downSince = null;
});
socket.on("disconnect", (reason) => {
  downSince = Date.now();
  console.log(`${at()} 끊김: ${reason}`);
});

const created = new Set();
const received = new Set();
socket.on("order.created", (o) => received.add(o.id));

const timer = setInterval(async () => {
  try {
    const res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ user: "loadtest", price: 1000, paid: true }),
    });
    if (res.ok) created.add((await res.json()).id);
  } catch {
  }
}, 1000);

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(timer);
await new Promise((r) => setTimeout(r, 2000));
const missed = [...created].filter((id) => !received.has(id));
console.log(`만든 주문 ${created.size}개, 받은 알림 ${created.size - missed.length}개, 못 받은 알림 ${missed.length}개${missed.length ? ` (#${missed.join(", #")})` : ""}`);
socket.off("disconnect");
socket.close();
