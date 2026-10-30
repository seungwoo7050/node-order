// 토스페이먼츠 시뮬레이터(테스트 대역). 키 없이 토스 결제를 끝까지 돌리고, 실패를 주입한다.
//   코어 API: POST /v1/payments/confirm, GET /v1/payments/{paymentKey}, GET /v1/payments/orders/{orderId},
//            POST /v1/payments/{paymentKey}/cancel, GET /v1/transactions?startDate&endDate&startingAfter&limit
//            (Basic 인증, Idempotency-Key, 오류 본문 { code, message })
//   거래 조회: 승인과 취소가 따로 한 행(transactionKey로 구분). 날짜 인자는 yyyy-MM-dd'T'HH:mm:ss 한국 시각, 끝을 포함한다
//   결제위젯: GET /v2/standard 가 window.TossPayments를 흉내 내는 가짜 SDK를 준다. requestPayment는 이 서버의
//            결제창(/widget/pay)으로 가고, 승인하면 successUrl?paymentKey&orderId&amount로 돌려보낸다
//   제어(테스트용, /__sim): authorize(결제창 없이 인증), faults(실패 주입: timeout, already_processed, amount_mismatch, unavailable, internal(500)),
//            calls(호출 수), status(PG 쪽 상태 바꾸기), webhook(PAYMENT_STATUS_CHANGED 보내기), reset,
//            대사용 불일치 심기: payments(PG에만 있는 결제), payments/{key}/patch(금액·잔액·상태·취소 고치기), payments/{key}/delete(PG에서 지우기)
// 실행: SIM_PORT=4200 SIM_API_URL=http://localhost:4000 node scripts/toss-sim.mjs  (SIM_PORT=0이면 빈 포트)
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.SIM_PORT ?? 4200);
const API = process.env.SIM_API_URL ?? "http://localhost:4000";

const payments = new Map(); // paymentKey → Payment
let transactions = []; // 거래 조회용: 승인·취소 한 건마다 한 행(시간순)
const idempotent = new Map(); // "METHOD path key" → { status, body } | "processing"
let faults = []; // { op, kind, delayMs, times }
let calls = { confirm: 0, fetch: 0, cancel: 0, transactions: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 한국 시각 + 오프셋 표기(실제 API처럼 2026-10-30T13:00:00+09:00)
const KST_MS = 9 * 3600_000;
const kstLocal = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 19);
const now = () => `${kstLocal(Date.now())}+09:00`;
const newKey = (prefix) => `${prefix}${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if ((req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
};
const error = (status, code, message) => ({ status, body: { code, message } });

function takeFault(op) {
  const i = faults.findIndex((f) => f.op === op);
  if (i < 0) return undefined;
  const f = faults[i];
  if (--f.times <= 0) faults.splice(i, 1);
  return f;
}

function authorize(orderId, amount, orderName = "주문") {
  const paymentKey = newKey("tsim_");
  payments.set(paymentKey, {
    paymentKey, orderId, orderName, status: "IN_PROGRESS", method: "카드", currency: "KRW",
    totalAmount: amount, balanceAmount: amount, requestedAt: now(), approvedAt: null, cancels: null,
  });
  return paymentKey;
}

function confirm(body) {
  const p = payments.get(body.paymentKey);
  if (!p) return error(404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.");
  if (p.status !== "IN_PROGRESS") return error(400, "ALREADY_PROCESSED_PAYMENT", "이미 처리된 결제 입니다.");
  if (p.orderId !== body.orderId) return error(400, "INVALID_REQUEST", "주문번호가 인증된 결제와 다릅니다.");
  if (Number(body.amount) !== p.totalAmount) return error(400, "INVALID_REQUEST", "결제 금액이 인증된 금액과 다릅니다.");
  Object.assign(p, { status: "DONE", approvedAt: now() });
  record(p, p.lastTransactionKey = newKey("tx_"), p.totalAmount);
  return { status: 200, body: p };
}

function record(p, transactionKey, amount) {
  transactions.push({
    mId: "tvivarepublica", transactionKey, paymentKey: p.paymentKey, orderId: p.orderId, method: p.method, customerKey: "sim-customer",
    useEscrow: false, receiptUrl: null, status: p.status, transactionAt: now(), currency: "KRW", amount,
  });
}

// startDate·endDate(한국 시각, 끝 포함) 안의 거래. startingAfter 뒤부터 limit개
function listTransactions(q) {
  const start = q.get("startDate"), end = q.get("endDate");
  if (!start || !end) return error(400, "INVALID_REQUEST", "startDate, endDate가 필요합니다.");
  const limit = Math.min(5000, Math.max(1, Number(q.get("limit") ?? 100)));
  const at = (t) => t.transactionAt.slice(0, 19);
  let rows = transactions.filter((t) => at(t) >= start && at(t) <= end);
  const after = q.get("startingAfter");
  if (after) rows = rows.slice(rows.findIndex((t) => t.transactionKey === after) + 1);
  return { status: 200, body: rows.slice(0, limit) };
}

function cancel(paymentKey, body) {
  const p = payments.get(paymentKey);
  if (!p) return error(404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.");
  if (p.status === "CANCELED") return error(400, "ALREADY_CANCELED_PAYMENT", "이미 취소된 결제 입니다.");
  if (p.status !== "DONE" && p.status !== "PARTIAL_CANCELED") return error(403, "NOT_CANCELABLE_PAYMENT", "취소 할 수 없는 결제 입니다.");
  if (!body.cancelReason) return error(400, "INVALID_REQUEST", "cancelReason이 필요합니다.");
  const amount = body.cancelAmount === undefined ? p.balanceAmount : Number(body.cancelAmount);
  if (!(amount > 0) || amount > p.balanceAmount) return error(403, "NOT_CANCELABLE_AMOUNT", "취소 할 수 없는 금액 입니다.");
  p.balanceAmount -= amount;
  p.status = p.balanceAmount === 0 ? "CANCELED" : "PARTIAL_CANCELED";
  const transactionKey = newKey("tx_");
  p.cancels = [...(p.cancels ?? []), {
    transactionKey, cancelAmount: amount, cancelReason: body.cancelReason, taxFreeAmount: 0,
    refundableAmount: p.balanceAmount, canceledAt: now(), cancelStatus: "DONE",
  }];
  record(p, transactionKey, amount);
  return { status: 200, body: p };
}

// 멱등 키가 같으면 첫 응답을 그대로 돌려준다. 첫 요청이 처리 중이면 409 IDEMPOTENT_REQUEST_PROCESSING
async function core(req, res, op, path, run) {
  const auth = req.headers.authorization ?? "";
  const secret = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString();
  if (!auth.startsWith("Basic ") || !secret.endsWith(":") || secret.length < 2) {
    return send(res, 401, { code: "UNAUTHORIZED_KEY", message: "인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다." });
  }
  calls[op]++;
  const key = req.headers["idempotency-key"];
  const cacheKey = key && `${req.method} ${path} ${key}`;
  if (cacheKey && idempotent.has(cacheKey)) {
    const saved = idempotent.get(cacheKey);
    if (saved === "processing") return send(res, 409, { code: "IDEMPOTENT_REQUEST_PROCESSING", message: "이전 멱등 요청이 처리 중입니다." });
    return send(res, saved.status, saved.body);
  }
  if (cacheKey) idempotent.set(cacheKey, "processing");
  const fault = takeFault(op);
  let result;
  if (fault?.kind === "already_processed") result = error(400, "ALREADY_PROCESSED_PAYMENT", "이미 처리된 결제 입니다.");
  else if (fault?.kind === "amount_mismatch") result = error(400, "INVALID_REQUEST", "결제 금액이 인증된 금액과 다릅니다.");
  else if (fault?.kind === "unavailable") result = error(503, "FAILED_INTERNAL_SYSTEM_PROCESSING", "내부 시스템 처리 작업이 실패했습니다.");
  else if (fault?.kind === "internal") result = error(500, "FAILED_INTERNAL_SYSTEM_PROCESSING", "내부 시스템 처리 작업이 실패했습니다.");
  else result = run(await readBody(req));
  // unavailable: 요청이 처리 전에 떨어졌다(멱등 결과를 남기지 않는다 - 같은 키로 다시 보내면 처리된다)
  if (cacheKey && (fault?.kind === "unavailable" || fault?.kind === "internal")) idempotent.delete(cacheKey);
  else if (cacheKey) idempotent.set(cacheKey, { status: result.status, body: structuredClone(result.body) });
  // 시간 초과: 처리는 끝냈지만(돈은 움직였다) 응답이 늦게 간다
  if (fault?.kind === "timeout") await sleep(fault.delayMs ?? 5000);
  if (!res.destroyed) send(res, result.status, result.body);
}

async function sendWebhook(paymentKey, status) {
  const p = payments.get(paymentKey);
  // 본문의 상태는 마음대로 바꿀 수 있다(위조 흉내). API는 본문을 믿지 않고 GET /v1/payments/{paymentKey}로 다시 묻는다
  const data = p ? { ...p, ...(status ? { status } : {}) } : { paymentKey, status: status ?? "DONE" };
  const res = await fetch(`${API}/payments/toss/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: now(), data }),
  });
  console.log(`웹훅 PAYMENT_STATUS_CHANGED ${paymentKey} (${data.status}) → ${res.status}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sdk = (origin) => `/* 토스페이먼츠 결제위젯 SDK(v2) 시뮬레이터 */
(function () {
  var SIM = ${JSON.stringify(origin)};
  function box(selector, text, testId) {
    var el = document.querySelector(selector);
    if (!el) throw new Error("렌더링할 요소가 없습니다: " + selector);
    var div = document.createElement("div");
    div.setAttribute("data-testid", testId);
    div.textContent = text;
    el.replaceChildren(div);
  }
  window.TossPayments = function (clientKey) {
    if (typeof clientKey !== "string" || !clientKey) throw new Error("clientKey가 없습니다");
    return {
      widgets: function (options) {
        if (!options || !options.customerKey) throw new Error("customerKey가 없습니다");
        var amount = null;
        return {
          setAmount: function (a) { amount = a; return Promise.resolve(); },
          renderPaymentMethods: function (o) { box(o.selector, "결제 수단: 카드 (토스 시뮬레이터)", "toss-sim-methods"); return Promise.resolve({}); },
          renderAgreement: function (o) { box(o.selector, "필수 약관에 동의합니다 (토스 시뮬레이터)", "toss-sim-agreement"); return Promise.resolve({}); },
          requestPayment: function (p) {
            if (!amount) return Promise.reject(new Error("setAmount를 먼저 불러야 합니다"));
            var q = new URLSearchParams({ clientKey: clientKey, orderId: p.orderId, orderName: p.orderName || "", amount: String(amount.value), successUrl: p.successUrl, failUrl: p.failUrl });
            window.location.assign(SIM + "/widget/pay?" + q.toString());
            return new Promise(function () {});
          }
        };
      }
    };
  };
})();
`;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (q) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>토스 결제 시뮬레이터</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">토스 결제 시뮬레이터</h1>
<p>${escape(q.get("orderName"))} · ${Number(q.get("amount")).toLocaleString("ko-KR")}원</p>
<form method="post" action="/widget/pay/approve">
${["orderId", "orderName", "amount", "successUrl", "failUrl"].map((k) => `<input type="hidden" name="${k}" value="${escape(q.get(k) ?? "")}">`).join("")}
<button>결제 승인</button></form>
<form method="post" action="/widget/pay/cancel" style="margin-top:.5rem">
${["orderId", "failUrl"].map((k) => `<input type="hidden" name="${k}" value="${escape(q.get(k) ?? "")}">`).join("")}
<button>결제 취소</button></form>
</body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const origin = `http://${req.headers.host}`;
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/v2/standard") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(sdk(origin));
    }
    if (req.method === "GET" && path === "/widget/pay") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page(url.searchParams));
    }
    if (req.method === "POST" && path === "/widget/pay/approve") {
      const f = await readBody(req);
      const paymentKey = authorize(f.orderId, Number(f.amount), f.orderName);
      const to = new URL(f.successUrl);
      to.search = new URLSearchParams({ paymentType: "NORMAL", orderId: f.orderId, paymentKey, amount: f.amount }).toString();
      res.writeHead(303, { Location: to.toString() });
      return res.end();
    }
    if (req.method === "POST" && path === "/widget/pay/cancel") {
      const f = await readBody(req);
      const to = new URL(f.failUrl);
      to.search = new URLSearchParams({ code: "PAY_PROCESS_CANCELED", message: "사용자에 의해 결제가 취소되었습니다", orderId: f.orderId }).toString();
      res.writeHead(303, { Location: to.toString() });
      return res.end();
    }

    if (req.method === "POST" && path === "/v1/payments/confirm") return core(req, res, "confirm", path, confirm);
    if (req.method === "GET" && path === "/v1/transactions") return core(req, res, "transactions", path, () => listTransactions(url.searchParams));
    let m = path.match(/^\/v1\/payments\/orders\/([^/]+)$/);
    if (req.method === "GET" && m) {
      return core(req, res, "fetch", path, () => {
        const p = [...payments.values()].find((x) => x.orderId === decodeURIComponent(m[1]));
        return p ? { status: 200, body: p } : error(404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.");
      });
    }
    m = path.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
    if (req.method === "POST" && m) return core(req, res, "cancel", path, (body) => cancel(decodeURIComponent(m[1]), body));
    m = path.match(/^\/v1\/payments\/([^/]+)$/);
    if (req.method === "GET" && m) {
      return core(req, res, "fetch", path, () => {
        const p = payments.get(decodeURIComponent(m[1]));
        return p ? { status: 200, body: p } : error(404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.");
      });
    }

    if (req.method === "POST" && path === "/__sim/authorize") {
      const b = await readBody(req);
      return send(res, 200, { paymentKey: authorize(b.orderId, Number(b.amount), b.orderName) });
    }
    if (req.method === "POST" && path === "/__sim/faults") {
      const b = await readBody(req);
      faults.push({ op: b.op, kind: b.kind, delayMs: b.delayMs, times: b.times ?? 1 });
      return send(res, 200, { faults });
    }
    if (req.method === "GET" && path === "/__sim/calls") return send(res, 200, calls);
    if (req.method === "POST" && path === "/__sim/reset") {
      payments.clear();
      idempotent.clear();
      transactions = [];
      faults = [];
      calls = { confirm: 0, fetch: 0, cancel: 0, transactions: 0 };
      return send(res, 200, { ok: true });
    }
    m = path.match(/^\/__sim\/payments\/([^/]+)\/status$/);
    if (req.method === "POST" && m) {
      const p = payments.get(m[1]);
      if (!p) return send(res, 404, { code: "NOT_FOUND_PAYMENT" });
      p.status = (await readBody(req)).status;
      return send(res, 200, p);
    }
    // 대사 테스트: PG에만 있는 결제(우리 DB에 없다). 승인 거래도 남긴다
    if (req.method === "POST" && path === "/__sim/payments") {
      const b = await readBody(req);
      const paymentKey = authorize(b.orderId ?? `sim-only-${Date.now()}`, Number(b.amount ?? 10000), "PG에만 있는 결제");
      const p = payments.get(paymentKey);
      Object.assign(p, { status: "DONE", approvedAt: now() });
      record(p, newKey("tx_"), p.totalAmount);
      return send(res, 200, p);
    }
    // 대사 테스트: PG 쪽 값 고치기(totalAmount, balanceAmount, status, cancelAmounts = 취소 금액을 차례로 바꾼다)
    m = path.match(/^\/__sim\/payments\/([^/]+)\/patch$/);
    if (req.method === "POST" && m) {
      const p = payments.get(m[1]);
      if (!p) return send(res, 404, { code: "NOT_FOUND_PAYMENT" });
      const b = await readBody(req);
      for (const k of ["totalAmount", "balanceAmount", "status"]) if (b[k] !== undefined) p[k] = b[k];
      if (Array.isArray(b.cancelAmounts)) b.cancelAmounts.forEach((a, i) => { if (p.cancels?.[i]) p.cancels[i].cancelAmount = a; });
      return send(res, 200, p);
    }
    // 대사 테스트: PG가 모르는 결제로 만들기(결제와 그 거래를 지운다)
    m = path.match(/^\/__sim\/payments\/([^/]+)\/delete$/);
    if (req.method === "POST" && m) {
      payments.delete(m[1]);
      transactions = transactions.filter((t) => t.paymentKey !== m[1]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/__sim/webhook") {
      const b = await readBody(req);
      return send(res, 200, await sendWebhook(b.paymentKey, b.status));
    }
    send(res, 404, { code: "NOT_FOUND", message: `시뮬레이터에 없는 경로: ${req.method} ${path}` });
  } catch (err) {
    send(res, 500, { code: "SIMULATOR_ERROR", message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`토스 시뮬레이터 listening ${server.address().port} (API ${API})`);
});
