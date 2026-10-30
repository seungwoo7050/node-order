import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PaymentGateways } from "./payment-gateways.js";

// 키가 있으면 켜지는 기능 목록. 콘솔은 여기 있는 결제 수단만 보인다(둘 다 없으면 결제 버튼을 끈다)
// 키는 환경변수(TOSS_CLIENT_KEY·TOSS_SECRET_KEY, STRIPE_SECRET_KEY)에만 둔다
@ApiTags("features")
@Controller("features")
export class FeaturesController {
  constructor(private readonly gateways: PaymentGateways) {}

  @Get()
  features() {
    const payments = this.gateways.configured();
    return {
      payments,
      ...(payments.includes("toss") ? { toss: this.gateways.toss.widgetConfig() } : {}),
    };
  }
}
