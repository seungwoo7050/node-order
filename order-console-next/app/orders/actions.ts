"use server";

const API = process.env.API_URL ?? "http://localhost:4000";

export async function createTestOrder() {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error("로그인 실패");
  const { accessToken } = await loginRes.json();

  const orderRes = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ user: "choi", price: 9000, paid: true }),
  });
  if (!orderRes.ok) throw new Error(`주문 생성 실패: ${orderRes.status}`);
  return orderRes.json();
}
