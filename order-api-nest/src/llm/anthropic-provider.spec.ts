import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicProvider } from "./anthropic-provider.js";
import { draftPrompt } from "./description-draft.js";
import type { LlmChunk } from "./llm-provider.js";
import { EnvLlmProvider, createLlmProvider } from "./llm.module.js";

// 실제 API를 부르지 않는다: SDK의 baseURL을 로컬 가짜 HTTP 서버로 바꿔 요청 모양과 스트림 파싱을 본다
type Captured = { method?: string; url?: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };

const event = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

function messageStream(texts: string[], opts: { failAfter?: number } = {}): string[] {
  const out = [
    event("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 321, output_tokens: 1 } } }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  ];
  for (const [i, text] of texts.entries()) {
    if (opts.failAfter === i) {
      out.push(event("error", { error: { type: "overloaded_error", message: "Overloaded" } }));
      return out;
    }
    out.push(event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }));
  }
  out.push(
    event("content_block_stop", { index: 0 }),
    event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 42 } }),
    event("message_stop", {}),
  );
  return out;
}

describe("AnthropicProvider (가짜 HTTP 서버)", () => {
  let server: Server;
  let baseURL: string;
  let captured: Captured[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c));
      req.on("end", () => {
        captured.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : {} });
        respond(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const sseResponse = (frames: string[]) => (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const f of frames) res.write(f);
    res.end();
  };

  const collect = async (provider: AnthropicProvider, signal = new AbortController().signal) => {
    const chunks: LlmChunk[] = [];
    for await (const c of provider.streamText(draftPrompt({ name: "무선 마우스", categoryPath: ["전자기기", "주변기기"], price: 19_000, description: "", keywords: "조용한 클릭" }), signal)) chunks.push(c);
    return chunks;
  };

  it("요청 모양: POST /v1/messages, 모델·max_tokens·system·stream, API 키 헤더", async () => {
    respond = sseResponse(messageStream(["가볍고 ", "조용한 ", "마우스입니다."]));
    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-haiku-4-5", baseURL });
    await collect(provider);

    expect(captured).toHaveLength(1);
    const [req] = captured;
    expect(req!.method).toBe("POST");
    expect(req!.url).toBe("/v1/messages");
    // SDK 1.x는 API 키를 Authorization: Bearer로 보낸다(0.x는 x-api-key)
    expect(req!.headers["authorization"] ?? `Bearer ${String(req!.headers["x-api-key"])}`).toBe("Bearer test-key");
    expect(req!.headers["anthropic-version"]).toBeTruthy();
    expect(req!.body).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 1024, stream: true });
    expect(typeof req!.body.system).toBe("string");
    expect(req!.body.system).toContain("지어내지 않는다");
    const messages = req!.body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain("무선 마우스");
    expect(messages[0]!.content).toContain("전자기기 / 주변기기");
    expect(messages[0]!.content).toContain("조용한 클릭");
  });

  it("스트림을 글 조각 순서대로 파싱하고 끝에 입력·출력 토큰 수를 낸다", async () => {
    respond = sseResponse(messageStream(["가볍고 ", "조용한 ", "마우스입니다."]));
    const chunks = await collect(new AnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", baseURL }));
    expect(chunks).toEqual([
      { type: "text", text: "가볍고 " },
      { type: "text", text: "조용한 " },
      { type: "text", text: "마우스입니다." },
      { type: "usage", inputTokens: 321, outputTokens: 42 },
    ]);
  });

  it("중간에 error 이벤트가 오면 받은 조각을 낸 뒤 예외를 던진다", async () => {
    respond = sseResponse(messageStream(["첫 문장. ", "둘째 문장. ", "셋째"], { failAfter: 2 }));
    const chunks: LlmChunk[] = [];
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", baseURL });
    await expect((async () => {
      for await (const c of provider.streamText({ system: "s", prompt: "p", maxTokens: 10 }, new AbortController().signal)) chunks.push(c);
    })()).rejects.toThrow(/Overloaded/);
    expect(chunks).toEqual([{ type: "text", text: "첫 문장. " }, { type: "text", text: "둘째 문장. " }]);
  });

  it("abort 신호를 받으면 HTTP 연결을 끊는다", async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((resolve) => (closed = resolve));
    respond = (req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const frames = messageStream(["하나 "]);
      res.write(frames[0]! + frames[1]! + frames[2]!); // 첫 조각까지만 보내고 기다린다
      res.on("close", () => closed());
    };
    const controller = new AbortController();
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", baseURL });
    const got: LlmChunk[] = [];
    await expect((async () => {
      for await (const c of provider.streamText({ system: "s", prompt: "p", maxTokens: 10 }, controller.signal)) {
        got.push(c);
        controller.abort();
      }
    })()).rejects.toThrow();
    expect(got).toEqual([{ type: "text", text: "하나 " }]);
    await serverSawClose;
  });

  it("EnvLlmProvider는 부를 때마다 환경변수를 본다(키가 없으면 enabled false)", async () => {
    const saved = { key: process.env.LLM_API_KEY, base: process.env.LLM_BASE_URL };
    try {
      delete process.env.LLM_API_KEY;
      const provider = new EnvLlmProvider();
      expect(provider.enabled).toBe(false);
      process.env.LLM_API_KEY = "k";
      process.env.LLM_BASE_URL = baseURL;
      expect(provider.enabled).toBe(true);
      expect(provider.model).toBe("claude-haiku-4-5");
      respond = sseResponse(messageStream(["env"]));
      const chunks: LlmChunk[] = [];
      for await (const c of provider.streamText({ system: "s", prompt: "p", maxTokens: 10 }, new AbortController().signal)) chunks.push(c);
      expect(chunks[0]).toEqual({ type: "text", text: "env" });
    } finally {
      if (saved.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.key;
      if (saved.base === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = saved.base;
    }
  });

  it("LLM_MODEL로 모델을 바꾸고, 키가 없으면 공급자를 만들지 않는다", async () => {
    expect(createLlmProvider({})).toBeNull();
    expect(createLlmProvider({ LLM_API_KEY: "k" })?.model).toBe("claude-haiku-4-5");
    const provider = createLlmProvider({ LLM_API_KEY: "k", LLM_MODEL: "claude-sonnet-5-5", LLM_BASE_URL: baseURL })!;
    respond = sseResponse(messageStream(["a"]));
    for await (const c of provider.streamText({ system: "s", prompt: "p", maxTokens: 10 }, new AbortController().signal)) void c;
    expect(captured[0]!.body.model).toBe("claude-sonnet-5-5");
  });
});
