// 글 생성 공급자. 첫 구현은 Anthropic(anthropic-provider.ts), 테스트는 대역(test/fake-llm.ts)이 같은 인터페이스를 쓴다.
// 손님이 연결을 끊으면 호출한 쪽이 signal을 abort하고, 공급자는 그 신호로 HTTP 호출을 끊는다
export const LLM_PROVIDER = Symbol("LLM_PROVIDER");

export type LlmInput = { system: string; prompt: string; maxTokens: number };

// 글 조각이 차례로 오고, 끝나면 토큰 수가 한 번 온다(지표용)
export type LlmChunk = { type: "text"; text: string } | { type: "usage"; inputTokens: number; outputTokens: number };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  streamText(input: LlmInput, signal: AbortSignal): AsyncIterable<LlmChunk>;
}

export const DEFAULT_LLM_MODEL = "claude-haiku-4-5";
