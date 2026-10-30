import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth-store";
import { createSseParser, streamDescriptionDraft } from "./description-draft";

const sseBody = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });

describe("createSseParser", () => {
  it("조각 경계가 이벤트 중간에 걸려도 이벤트 단위로 낸다", () => {
    const events: { event: string; data: string }[] = [];
    const parse = createSseParser((e) => events.push(e));
    parse('event: delta\ndata: {"te');
    parse('xt":"가"}\n\nevent: del');
    parse('ta\r\ndata: {"text":"나"}\r\n\r\n');
    expect(events).toEqual([
      { event: "delta", data: '{"text":"가"}' },
      { event: "delta", data: '{"text":"나"}' },
    ]);
  });
});

describe("streamDescriptionDraft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("글 조각을 차례로 넘기고 done이면 ok", async () => {
    useAuthStore.getState().setAccessToken("token");
    const fetchMock = vi.fn(async () => new Response(sseBody([
      'event: delta\ndata: {"text":"첫 "}\n\n',
      'event: delta\ndata: {"text":"둘"}\n\nevent: done\ndata: {"usage":{}}\n\n',
    ]), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const texts: string[] = [];
    const result = await streamDescriptionDraft(6, "무선", { signal: new AbortController().signal, onText: (t) => texts.push(t) });
    expect(result).toEqual({ ok: true });
    expect(texts).toEqual(["첫 ", "둘"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/products\/6\/description-draft$/);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
  });

  it("error 이벤트면 받은 글은 이미 넘겼고 오류 문구를 돌려준다. done 없이 끊겨도 실패", async () => {
    useAuthStore.getState().setAccessToken("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody(['event: delta\ndata: {"text":"반쯤"}\n\nevent: error\ndata: {"message":"멈췄습니다"}\n\n']))));
    const texts: string[] = [];
    expect(await streamDescriptionDraft(6, "", { signal: new AbortController().signal, onText: (t) => texts.push(t) })).toEqual({ ok: false, message: "멈췄습니다" });
    expect(texts).toEqual(["반쯤"]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody(['event: delta\ndata: {"text":"반쯤"}\n\n']))));
    expect(await streamDescriptionDraft(6, "", { signal: new AbortController().signal, onText: () => {} })).toMatchObject({ ok: false, message: expect.stringMatching(/끊겼습니다/) });
  });

  it("429 같은 거절은 API 문구를 그대로 돌려준다", async () => {
    useAuthStore.getState().setAccessToken("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ statusCode: 429, message: "1분에 5번까지" }), { status: 429 })));
    expect(await streamDescriptionDraft(6, "", { signal: new AbortController().signal, onText: () => {} })).toEqual({ ok: false, message: "1분에 5번까지" });
  });
});
