import { io } from "socket.io-client";

process.loadEnvFile();
const N = Number(process.argv[2] ?? 10);
const A = `http://localhost:${process.argv[3] ?? 4000}`;
const B = `http://localhost:${process.argv[4] ?? 4001}`;

const login = await fetch(`${A}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

const socket = io(B, { auth: { token: accessToken } });
await new Promise((resolve) => socket.on("connect", resolve));
const received = new Set();
socket.on("order.created", (o) => received.add(o.id));

const created = [];
for (let i = 0; i < N; i++) {
  const res = await fetch(`${A}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ user: "kim", price: 1000, paid: true }),
  });
  created.push((await res.json()).id);
}

await new Promise((r) => setTimeout(r, 2000));
console.log(`A(${A})로 만든 주문 ${created.length}개 중, B(${B})에 붙은 클라이언트가 받은 알림: ${received.size}개`);
socket.close();