import { Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsPositive, ValidateNested } from "class-validator";
import { PROVIDERS, type ProviderId } from "../../payments/payment-gateway.js";

export class CheckoutItemDto {
  @IsInt() @IsPositive() productId!: number;
  @IsInt() @IsPositive() quantity!: number;
}

export class CheckoutDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  @ArrayUnique((i: CheckoutItemDto) => i.productId, { message: "같은 상품은 한 줄로 합쳐 수량으로 보냅니다" })
  items!: CheckoutItemDto[];

  // 고르지 않으면 Stripe, Stripe가 꺼져 있으면 토스(GET /features가 켜진 수단을 알려 준다)
  @IsOptional() @IsIn(PROVIDERS) provider?: ProviderId;
}