import type { LlmChunk, LlmInput, LlmProvider } from "../src/llm/llm-provider.js";

// LLM 공급자 대역: 정해 둔 조각을 간격을 두고 차례로 낸다. failAfter번째 조각 앞에서 오류를 던질 수 있고,
// 받은 입력과 취소 신호를 기록한다(연결을 끊었을 때 신호가 abort되는지 본다)
export class FakeLlm implements LlmProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly enabled = true;
  chunks = ["첫 문장입니다. ", "둘째 문장입니다. ", "셋째 문장입니다."];
  delayMs = 0;
  failAfter: number | null = null;
  calls: { input: LlmInput; signal: AbortSignal }[] = [];

  reset() {
    this.chunks = ["첫 문장입니다. ", "둘째 문장입니다. ", "셋째 문장입니다."];
    this.delayMs = 0;
    this.failAfter = null;
    this.calls = [];
  }

  async *streamText(input: LlmInput, signal: AbortSignal): AsyncIterable<LlmChunk> {
    this.calls.push({ input, signal });
    for (const [i, text] of this.chunks.entries()) {
      if (this.failAfter === i) throw new Error("fake provider failure");
      if (this.delayMs) await sleep(this.delayMs, signal);
      yield { type: "text", text };
    }
    yield { type: "usage", inputTokens: 100, outputTokens: 20 };
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
