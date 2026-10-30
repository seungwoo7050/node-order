import { BadRequestException, Injectable } from "@nestjs/common";
import { PROVIDERS, type PaymentGateway, type ProviderId } from "./payment-gateway.js";
import { StripeGateway } from "./stripe.gateway.js";
import { TossGateway } from "./toss.gateway.js";

// 결제 수단 목록. 어느 PG를 쓸지는 키가 있는지(isConfigured)로 정한다
@Injectable()
export class PaymentGateways {
  constructor(
    readonly stripe: StripeGateway,
    readonly toss: TossGateway,
  ) {}

  get(id: ProviderId): PaymentGateway {
    return id === "toss" ? this.toss : this.stripe;
  }

  configured(): ProviderId[] {
    return PROVIDERS.filter((id) => this.get(id).isConfigured());
  }

  // 결제를 시작할 PG. 고르지 않으면 Stripe(기존 흐름)를, Stripe가 없으면 토스를 쓴다
  pick(requested?: ProviderId): PaymentGateway {
    const available = this.configured();
    const id = requested ?? (available.includes("stripe") ? "stripe" : available[0]);
    if (!id || !available.includes(id)) throw new BadRequestException(requested ? `결제 수단 ${requested}를 쓸 수 없습니다` : "켜진 결제 수단이 없습니다");
    return this.get(id);
  }
}
