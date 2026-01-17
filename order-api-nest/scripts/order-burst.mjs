import { io } from "socket.io-client";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 20);
const WAIT = Number(process.argv[3] ?? 5000);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

const socket = io(API, { auth: { token: accessToken } });
await new Promise((resolve) => socket.on("connect", resolve));
let total = 0;
const unique = new Set();
socket.on("order.created", (o) => {
  total++;
  unique.add(o.id);
});

await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ user: "kim", price: 1000, paid: true }),
    }),
  ),
);
await new Promise((r) => setTimeout(r, WAIT));
console.log(`주문 ${N}개 → 받은 알림 ${total}번(서로 다른 주문 ${unique.size}개)`);
socket.close();