import { Controller, Get, Inject, Optional } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { LLM_PROVIDER, type LlmProvider } from "../llm/llm-provider.js";
import { PaymentGateways } from "./payment-gateways.js";

// 키가 있으면 켜지는 기능 목록. 콘솔은 여기 있는 결제 수단만 보인다(둘 다 없으면 결제 버튼을 끈다)
// 키는 환경변수(TOSS_CLIENT_KEY·TOSS_SECRET_KEY, STRIPE_SECRET_KEY, SENTRY_DSN, LLM_API_KEY)에만 둔다.
// integrations는 연결됨(true)·없음(false)만 준다: 관리자 설정 화면이 이것으로 연결 상태를 보이고, 키 값은 어디에도 싣지 않는다
// (토스 클라이언트 키는 브라우저 위젯이 써야 하는 공개 키라 예외다)
@ApiTags("features")
@Controller("features")
export class FeaturesController {
  constructor(
    private readonly gateways: PaymentGateways,
    // LLM_API_KEY가 있을 때만 만들어진다(llm.module.ts). 콘솔은 이것으로 "설명 초안 만들기" 버튼을 보인다
    @Optional() @Inject(LLM_PROVIDER) private readonly llm: LlmProvider | null = null,
  ) {}

  @Get()
  features() {
    const payments = this.gateways.configured();
    return {
      payments,
      integrations: {
        toss: payments.includes("toss"),
        stripe: payments.includes("stripe"),
        errorTracking: Boolean(process.env.SENTRY_DSN), // 31에서 쓴다
        llm: Boolean(this.llm),
      },
      ...(payments.includes("toss") ? { toss: this.gateways.toss.widgetConfig() } : {}),
    };
  }
}
