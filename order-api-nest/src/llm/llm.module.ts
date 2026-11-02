import { Global, Injectable, Module, Optional } from "@nestjs/common";
import { RuntimeSecretsService } from "../admin/runtime-secrets.service.js";
import { CategoriesModule } from "../categories/categories.module.js";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { DescriptionDraftController } from "./description-draft.controller.js";
import { DEFAULT_LLM_MODEL, LLM_PROVIDER, type LlmChunk, type LlmInput, type LlmProvider } from "./llm-provider.js";

// LLM_API_KEY가 있을 때만 공급자를 만든다(없으면 null).
// LLM_MODEL로 모델을, LLM_BASE_URL로 API 주소(로컬 대역 서버)를 바꾼다
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env, apiKeyOverride?: string): AnthropicProvider | null {
  const apiKey = apiKeyOverride || env.LLM_API_KEY;
  if (!apiKey) return null;
  return new AnthropicProvider({ apiKey, model: env.LLM_MODEL || DEFAULT_LLM_MODEL, baseURL: env.LLM_BASE_URL });
}

// 환경변수를 부를 때마다 본다(다른 연동처럼 features가 키의 유무를 그때그때 알린다). 키·모델·주소가 같으면 클라이언트를 다시 쓴다.
// 키가 없으면 enabled가 false: 기능 목록 features.llm이 false, 초안 엔드포인트는 404. 테스트는 LLM_PROVIDER를 대역으로 갈아 끼운다
@Injectable()
export class EnvLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  private cache: { signature: string; provider: AnthropicProvider } | null = null;

  constructor(@Optional() private readonly secrets?: RuntimeSecretsService) {}

  get enabled(): boolean {
    if (this.secrets?.isPausedPaidApis()) return false;
    const key = this.secrets?.getSecret("LLM_API_KEY") || this.secrets?.getSecret("OPENAI_API_KEY") || process.env.LLM_API_KEY;
    return Boolean(key);
  }

  get model(): string {
    return process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
  }

  streamText(input: LlmInput, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const key = this.secrets?.getSecret("LLM_API_KEY") || this.secrets?.getSecret("OPENAI_API_KEY") || process.env.LLM_API_KEY;
    const signature = [key, this.model, process.env.LLM_BASE_URL].join("\n");
    if (this.cache?.signature !== signature) {
      const provider = createLlmProvider(process.env, key);
      if (!provider) throw new Error("LLM_API_KEY가 없습니다");
      this.cache = { signature, provider };
    }
    return this.cache.provider.streamText(input, signal);
  }
}

@Global()
@Module({
  imports: [CategoriesModule, RateLimitModule],
  controllers: [DescriptionDraftController],
  providers: [{ provide: LLM_PROVIDER, useClass: EnvLlmProvider }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
