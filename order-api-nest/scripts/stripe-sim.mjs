import { createServer } from "node:http";
import Stripe from "stripe";

const PORT = Number(process.env.SIM_PORT ?? 4100);
const API = process.env.SIM_API_URL ?? "http://localhost:4000";
const LATENCY_MS = Number(process.env.SIM_LATENCY_MS ?? 0);
const WEBHOOK_DELAY_MS = Number(process.env.SIM_WEBHOOK_DELAY_MS ?? 1000);
const SECRET = "whsec_simulator";

const sessions = new Map();
let seq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readForm(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

async function sendCompleted(session) {
  const payload = JSON.stringify({
    id: `evt_sim_${session.id}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: session.id, object: "checkout.session", payment_status: "paid", client_reference_id: session.orderId, metadata: { orderId: session.orderId } } },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(`${API}/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
  console.log(`웹훅 checkout.session.completed ${session.id} → ${res.status}`);
}

const page = (s) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>결제 시뮬레이터</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">결제 시뮬레이터</h1>
<p>주문 #${s.orderId} · ${s.amount.toLocaleString("ko-KR")}원</p>
<form method="post" action="/c/pay/${s.id}/complete"><button>결제 완료</button></form>
<form method="post" action="/c/pay/${s.id}/cancel" style="margin-top:.5rem"><button>취소하고 돌아가기</button></form>
</body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const form = await readForm(req);
    await sleep(LATENCY_MS);
    const id = `cs_test_sim_${Date.now()}_${++seq}`;
    sessions.set(id, {
      id,
      orderId: form.get("client_reference_id"),
      amount: Number(form.get("line_items[0][price_data][unit_amount]")),
      successUrl: form.get("success_url"),
      cancelUrl: form.get("cancel_url"),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id, object: "checkout.session", url: `http://localhost:${PORT}/c/pay/${id}` }));
  }
  const m = url.pathname.match(/^\/c\/pay\/(\w+)(?:\/(complete|cancel))?$/);
  const session = m && sessions.get(m[1]);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `시뮬레이터에 없는 경로나 세션: ${url.pathname}` } }));
  }
  if (req.method === "GET" && !m[2]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page(session));
  }
  if (req.method === "POST" && m[2] === "complete") {
    const send = () => sendCompleted(session).catch((err) => console.error(`웹훅 실패: ${err.message}`));
    if (WEBHOOK_DELAY_MS > 0) setTimeout(send, WEBHOOK_DELAY_MS);
    else await send();
  }
  res.writeHead(303, { Location: m[2] === "complete" ? session.successUrl : session.cancelUrl });
  res.end();
}).listen(PORT, () => console.log(`Stripe 시뮬레이터: http://localhost:${PORT} (API ${API}, 세션 지연 ${LATENCY_MS}ms, 웹훅 지연 ${WEBHOOK_DELAY_MS}ms)`));
