import { Type } from "class-transformer";
import {
  ArrayMinSize, ArrayUnique, IsArray, IsDefined, IsIn, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, ValidateNested,
} from "class-validator";
import { PROVIDERS, type ProviderId } from "../../payments/payment-gateway.js";

export class CheckoutItemDto {
  @IsInt() @IsPositive() productId!: number;
  @IsInt() @IsPositive() quantity!: number;
}

const NOT_BLANK = /\S/;

// 배송지. 주문에 사본으로 붙는다. 비었거나 형식이 틀리면 결제를 시작하기 전에 400
export class ShippingAddressDto {
  @IsString() @Matches(NOT_BLANK, { message: "수령인을 입력해 주세요" }) @MaxLength(50) recipientName!: string;
  @IsString() @Matches(/^0\d{1,2}-?\d{3,4}-?\d{4}$/, { message: "연락처는 010-1234-5678 꼴로 입력해 주세요" }) recipientPhone!: string;
  @IsString() @Matches(/^\d{5}$/, { message: "우편번호는 숫자 5자리입니다" }) postalCode!: string;
  @IsString() @Matches(NOT_BLANK, { message: "주소를 입력해 주세요" }) @MaxLength(200) address1!: string;
  @IsOptional() @IsString() @MaxLength(200) address2?: string;
  @IsOptional() @IsString() @MaxLength(200) deliveryMemo?: string;
}

export class CheckoutDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  @ArrayUnique((i: CheckoutItemDto) => i.productId, { message: "같은 상품은 한 줄로 합쳐 수량으로 보냅니다" })
  items!: CheckoutItemDto[];

  @IsDefined({ message: "배송지(shipping)가 필요합니다" }) @ValidateNested() @Type(() => ShippingAddressDto)
  shipping!: ShippingAddressDto;

  // 결제 화면에서 손님이 동의한 개인정보처리방침 판(GET /legal/privacy의 version). 없거나 지금 판이 아니면 400
  @IsInt({ message: "개인정보 수집·이용(배송지)에 동의해 주세요" }) @IsPositive() privacyConsentVersion!: number;

  // 고르지 않으면 Stripe, Stripe가 꺼져 있으면 토스(GET /features가 켜진 수단을 알려 준다)
  @IsOptional() @IsIn(PROVIDERS) provider?: ProviderId;
}

export class GuestCheckoutDto extends CheckoutDto {
  @IsString()
  @Matches(NOT_BLANK, { message: "비회원 주문 비밀번호를 입력해 주세요" })
  @MaxLength(50)
  password!: string;
}
