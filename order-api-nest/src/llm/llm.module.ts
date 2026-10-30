import { Global, Module } from "@nestjs/common";
import { CategoriesModule } from "../categories/categories.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { DescriptionDraftController } from "./description-draft.controller.js";
import { DEFAULT_LLM_MODEL, LLM_PROVIDER, type LlmProvider } from "./llm-provider.js";

// LLM_API_KEY가 있을 때만 공급자를 만든다(없으면 null: 기능 목록 features.llm이 false, 초안 엔드포인트는 404).
// LLM_MODEL로 모델을, LLM_BASE_URL로 API 주소(로컬 대역 서버)를 바꾼다. 테스트는 LLM_PROVIDER를 대역으로 갈아 끼운다
export function createLlmProvider(env = process.env): LlmProvider | null {
  if (!env.LLM_API_KEY) return null;
  return new AnthropicProvider({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || DEFAULT_LLM_MODEL, baseURL: env.LLM_BASE_URL });
}

@Global()
@Module({
  imports: [CategoriesModule, RateLimitModule],
  controllers: [DescriptionDraftController],
  providers: [{ provide: LLM_PROVIDER, useFactory: () => createLlmProvider() }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
