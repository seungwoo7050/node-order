// Stripe 시뮬레이터(테스트 대역). stripe SDK가 protocol/host/port로 이 서버를 부른다(STRIPE_SIMULATOR_URL).
//   Checkout: POST /v1/checkout/sessions, GET /v1/checkout/sessions/{id}(payment_intent 조회), 결제창 /c/pay/{id}(완료하면 서명한 checkout.session.completed 웹훅)
//   결제·환불: GET /v1/payment_intents/{id}, POST /v1/refunds, GET /v1/refunds?payment_intent=
//   목록(대사용): GET /v1/payment_intents, GET /v1/refunds — created[gte|gt|lte|lt], limit(1~100, 기본 10), starting_after,
//               최신순, 응답 { object: "list", url, has_more, data }
//   제어(테스트용, /__sim): faults(실패 주입: refund의 timeout·unavailable, list의 internal(500)·rate_limited(429 + Retry-After)), calls(호출 수), reset,
//               대사용 불일치 심기: intents(PG에만 있는 결제), intents/{id}/patch·delete, refunds/{id}/patch
// 실행: SIM_PORT=4100 SIM_API_URL=http://localhost:4000 node scripts/stripe-sim.mjs  (SIM_PORT=0이면 빈 포트)
import { createServer } from "node:http";
import Stripe from "stripe";

const PORT = Number(process.env.SIM_PORT ?? 4100);
const API = process.env.SIM_API_URL ?? "http://localhost:4000";
const LATENCY_MS = Number(process.env.SIM_LATENCY_MS ?? 0);
const WEBHOOK_DELAY_MS = Number(process.env.SIM_WEBHOOK_DELAY_MS ?? 1000);
const SECRET = "whsec_simulator";

const sessions = new Map();
const intents = new Map();
const refunds = new Map();
const idempotent = new Map();
let faults = [];
let calls = { refund: 0, fetch: 0, session: 0, list: 0 };
let seq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readForm(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const invalid = (message, code) => ({ status: 400, body: { error: { type: "invalid_request_error", code, message } } });

function takeFault(op) {
  const i = faults.findIndex((f) => f.op === op);
  if (i < 0) return undefined;
  const f = faults[i];
  if (--f.times <= 0) faults.splice(i, 1);
  return f;
}

const sessionView = (s) => ({
  id: s.id, object: "checkout.session", url: `http://localhost:${server.address().port}/c/pay/${s.id}`,
  payment_status: s.paymentIntent ? "paid" : "unpaid", status: s.paymentIntent ? "complete" : "open",
  amount_total: s.amount, currency: "krw", client_reference_id: s.orderId, metadata: { orderId: s.orderId }, payment_intent: s.paymentIntent ?? null,
});

function pay(session) {
  if (session.paymentIntent) return;
  const id = `pi_sim_${Date.now()}_${++seq}`;
  intents.set(id, { id, object: "payment_intent", amount: session.amount, amount_received: session.amount, currency: "krw", status: "succeeded", created: Math.floor(Date.now() / 1000), metadata: { orderId: session.orderId }, seq });
  session.paymentIntent = id;
}

async function sendCompleted(session) {
  const payload = JSON.stringify({
    id: `evt_sim_${session.id}`,
    object: "event",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: { object: sessionView(session) },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(`${API}/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
  console.log(`웹훅 checkout.session.completed ${session.id} → ${res.status}`);
}

// Stripe 목록 API 흉내: created 범위로 거르고 최신순, starting_after 뒤부터 limit개
function listPage(url, path, objects) {
  const q = url.searchParams;
  const n = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  const [gte, gt, lte, lt] = [n("created[gte]"), n("created[gt]"), n("created[lte]"), n("created[lt]")];
  let rows = objects
    .filter((o) => (gte === undefined || o.created >= gte) && (gt === undefined || o.created > gt) && (lte === undefined || o.created <= lte) && (lt === undefined || o.created < lt))
    .sort((a, b) => b.created - a.created || (b.seq ?? 0) - (a.seq ?? 0));
  const after = q.get("starting_after");
  if (after) rows = rows.slice(rows.findIndex((o) => o.id === after) + 1);
  const limit = Math.min(100, Math.max(1, n("limit") ?? 10));
  return { object: "list", url: path, has_more: rows.length > limit, data: rows.slice(0, limit).map(({ seq: _s, ...o }) => o) };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

function createRefund(form) {
  const intent = intents.get(form.get("payment_intent"));
  if (!intent) return invalid(`No such payment_intent: '${form.get("payment_intent")}'`, "resource_missing");
  const done = [...refunds.values()].filter((r) => r.payment_intent === intent.id).reduce((s, r) => s + r.amount, 0);
  const amount = form.has("amount") ? Number(form.get("amount")) : intent.amount - done;
  if (!(amount > 0) || amount > intent.amount - done) {
    return invalid(`Refund amount (${amount}) is greater than unrefunded amount on charge (${intent.amount - done})`, "amount_too_large");
  }
  const metadata = {};
  for (const [k, v] of form) {
    const m = k.match(/^metadata\[(.+)\]$/);
    if (m) metadata[m[1]] = v;
  }
  const id = `re_sim_${Date.now()}_${++seq}`;
  const refund = { id, object: "refund", amount, currency: "krw", status: "succeeded", payment_intent: intent.id, metadata, created: Math.floor(Date.now() / 1000), seq };
  refunds.set(id, refund);
  return { status: 200, body: refund };
}

const page = (s) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>결제 시뮬레이터</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">결제 시뮬레이터</h1>
<p>주문 #${s.orderId} · ${s.amount.toLocaleString("ko-KR")}원</p>
<form method="post" action="/c/pay/${s.id}/complete"><button>결제 완료</button></form>
<form method="post" action="/c/pay/${s.id}/cancel" style="margin-top:.5rem"><button>취소하고 돌아가기</button></form>
</body></html>`;

const server = createServer(async (req, res) => {
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
    return json(res, 200, sessionView(sessions.get(id)));
  }
  let m = url.pathname.match(/^\/v1\/checkout\/sessions\/(\w+)$/);
  if (req.method === "GET" && m) {
    calls.session++; // 결제 키 지연 채움(세션 → payment_intent)이 몇 번 묻는지 테스트가 본다
    const s = sessions.get(m[1]);
    return s ? json(res, 200, sessionView(s)) : json(res, 404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such checkout.session: '${m[1]}'` } });
  }
  m = url.pathname.match(/^\/v1\/payment_intents\/(\w+)$/);
  if (req.method === "GET" && m) {
    calls.fetch++;
    const pi = intents.get(m[1]);
    if (!pi) return json(res, 404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such payment_intent: '${m[1]}'` } });
    const { seq: _s, ...view } = pi;
    return json(res, 200, view);
  }
  if (req.method === "GET" && (url.pathname === "/v1/payment_intents" || url.pathname === "/v1/refunds")) {
    const isList = url.pathname === "/v1/payment_intents" || !url.searchParams.has("payment_intent");
    if (isList) {
      calls.list++;
      const fault = takeFault("list");
      if (fault?.kind === "internal") return json(res, 500, { error: { type: "api_error", message: "시뮬레이터: 내부 오류" } });
      if (fault?.kind === "rate_limited") {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(fault.retryAfter ?? 1) });
        return res.end(JSON.stringify({ error: { type: "invalid_request_error", code: "rate_limit", message: "Too many requests" } }));
      }
    }
    if (url.pathname === "/v1/payment_intents") return json(res, 200, listPage(url, url.pathname, [...intents.values()]));
    const pi = url.searchParams.get("payment_intent");
    return json(res, 200, listPage(url, url.pathname, [...refunds.values()].filter((r) => !pi || r.payment_intent === pi)));
  }
  if (req.method === "POST" && url.pathname === "/v1/refunds") {
    calls.refund++;
    const key = req.headers["idempotency-key"];
    if (key && idempotent.has(key)) {
      const saved = idempotent.get(key);
      return json(res, saved.status, saved.body);
    }
    const form = await readForm(req);
    const fault = takeFault("refund");
    // unavailable: 처리 전에 떨어진 요청(멱등 결과를 남기지 않는다)
    const result = fault?.kind === "unavailable" ? { status: 503, body: { error: { type: "api_error", message: "시뮬레이터: 잠시 쓸 수 없음" } } } : createRefund(form);
    if (key && fault?.kind !== "unavailable") idempotent.set(key, result);
    if (fault?.kind === "timeout") await sleep(fault.delayMs ?? 5000); // 처리는 끝났고 응답만 늦다
    if (!res.destroyed) json(res, result.status, result.body);
    return;
  }
  if (req.method === "POST" && url.pathname === "/__sim/faults") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const b = JSON.parse(raw || "{}");
    faults.push({ op: b.op, kind: b.kind, delayMs: b.delayMs, retryAfter: b.retryAfter, times: b.times ?? 1 });
    return json(res, 200, { faults });
  }
  if (req.method === "GET" && url.pathname === "/__sim/calls") return json(res, 200, calls);
  // 대사 테스트: PG에만 있는 결제(우리 DB에 없다)
  if (req.method === "POST" && url.pathname === "/__sim/intents") {
    const b = await readJson(req);
    const id = `pi_sim_${Date.now()}_${++seq}`;
    intents.set(id, { id, object: "payment_intent", amount: b.amount ?? 10000, amount_received: b.amount ?? 10000, currency: "krw", status: "succeeded", created: Math.floor(Date.now() / 1000), metadata: {}, seq });
    return json(res, 200, intents.get(id));
  }
  m = url.pathname.match(/^\/__sim\/(intents|refunds)\/(\w+)\/(patch|delete)$/);
  if (req.method === "POST" && m) {
    const store = m[1] === "intents" ? intents : refunds;
    const obj = store.get(m[2]);
    if (!obj) return json(res, 404, { error: { message: `없는 ${m[1]}: ${m[2]}` } });
    if (m[3] === "delete") {
      store.delete(m[2]);
      if (m[1] === "intents") for (const [id, r] of refunds) if (r.payment_intent === m[2]) refunds.delete(id);
      return json(res, 200, { ok: true });
    }
    const b = await readJson(req);
    for (const k of ["amount", "status"]) if (b[k] !== undefined) obj[k] = b[k];
    return json(res, 200, obj);
  }
  if (req.method === "POST" && url.pathname === "/__sim/reset") {
    sessions.clear(); intents.clear(); refunds.clear(); idempotent.clear();
    faults = [];
    calls = { refund: 0, fetch: 0, session: 0, list: 0 };
    return json(res, 200, { ok: true });
  }

  m = url.pathname.match(/^\/c\/pay\/(\w+)(?:\/(complete|cancel))?$/);
  const session = m && sessions.get(m[1]);
  if (!session) return json(res, 404, { error: { message: `시뮬레이터에 없는 경로나 세션: ${url.pathname}` } });
  if (req.method === "GET" && !m[2]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page(session));
  }
  if (req.method === "POST" && m[2] === "complete") {
    pay(session);
    const send = () => sendCompleted(session).catch((err) => console.error(`웹훅 실패: ${err.message}`));
    if (WEBHOOK_DELAY_MS > 0) setTimeout(send, WEBHOOK_DELAY_MS);
    else await send();
  }
  res.writeHead(303, { Location: m[2] === "complete" ? session.successUrl : session.cancelUrl });
  res.end();
});

server.listen(PORT, () => console.log(`Stripe 시뮬레이터 listening ${server.address().port} (API ${API}, 세션 지연 ${LATENCY_MS}ms, 웹훅 지연 ${WEBHOOK_DELAY_MS}ms)`));
