import Anthropic from "@anthropic-ai/sdk";
import type { LlmChunk, LlmInput, LlmProvider } from "./llm-provider.js";

// Anthropic Messages API 스트리밍. baseURL을 바꾸면 로컬 대역 서버(scripts/llm-sim.mjs, 테스트의 가짜 HTTP 서버)로 간다
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly enabled = true;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; model: string; baseURL?: string }) {
    this.model = opts.model;
    // 재시도는 한 번만: 사람이 화면에서 기다리고 있다(실패하면 다시 누르면 된다)
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL || undefined, maxRetries: 1, timeout: 60_000 });
  }

  async *streamText(input: LlmInput, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const stream = this.client.messages.stream(
      { model: this.model, max_tokens: input.maxTokens, system: input.system, messages: [{ role: "user", content: input.prompt }] },
      { signal },
    );
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
      }
      const { usage } = await stream.finalMessage();
      yield { type: "usage", inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    } finally {
      // 받는 쪽이 중간에 멈추면(오류·끊김) 공급자 호출도 끊는다
      if (!stream.ended && !stream.aborted) stream.abort();
    }
  }
}
