// Anthropic Messages API 시뮬레이터(테스트 대역). 키 없이 상품 설명 초안의 스트리밍을 끝까지 돌린다(실제 API는 부르지 않는다).
//   POST /v1/messages (stream: true만): message_start → content_block_start → content_block_delta(text_delta)를
//   SIM_CHUNK_MS 간격으로 → content_block_stop → message_delta(usage) → message_stop
//   프롬프트에 "sim:error"가 있으면 조각 두 개 뒤에 error 이벤트(overloaded_error)를 보내고 끊는다(중간 오류 흉내)
//   GET /__sim/calls: 받은 요청 수와 마지막 요청 본문(모델·max_tokens·system·stream 확인용)
// 실행: SIM_PORT=4300 node scripts/llm-sim.mjs  (API는 LLM_API_KEY=아무 값, LLM_BASE_URL=http://localhost:4300)
import { createServer } from "node:http";

const PORT = Number(process.env.SIM_PORT ?? 4300);
const CHUNK_MS = Number(process.env.SIM_CHUNK_MS ?? 250);

const CHUNKS = [
  "가볍게 손에 감기는 모양으로 ",
  "오래 써도 손목이 편합니다. ",
  "책상 위 어디에 두어도 ",
  "잘 어울리는 단정한 디자인이라 ",
  "매일 쓰는 물건으로 오래 곁에 둘 수 있습니다.",
];

let calls = { messages: 0, last: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

async function stream(req, res, body) {
  const text = JSON.stringify(body.messages ?? []);
  const fail = text.includes("sim:error");
  let closed = false;
  res.on("close", () => (closed = true));
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.write(frame("message_start", {
    message: { id: `msg_sim_${calls.messages}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: Math.ceil(text.length / 2), output_tokens: 1 } },
  }));
  res.write(frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
  for (const [i, chunk] of CHUNKS.entries()) {
    await sleep(CHUNK_MS);
    if (closed) return;
    if (fail && i === 2) {
      res.end(frame("error", { error: { type: "overloaded_error", message: "Overloaded (simulated)" } }));
      return;
    }
    res.write(frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: chunk } }));
  }
  res.write(frame("content_block_stop", { index: 0 }));
  res.write(frame("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: CHUNKS.join("").length } }));
  res.end(frame("message_stop", {}));
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://sim");
    if (req.method === "GET" && url.pathname === "/__sim/calls") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(calls));
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const body = raw ? JSON.parse(raw) : {};
      calls = { messages: calls.messages + 1, last: body };
      if (!body.stream) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "simulator supports stream: true only" } }));
      }
      return void stream(req, res, body);
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "not found" } }));
  });
});

server.listen(PORT, () => {
  console.log(`LLM 시뮬레이터 listening ${server.address().port}`);
});
