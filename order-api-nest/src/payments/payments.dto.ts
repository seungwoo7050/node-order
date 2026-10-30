import { IsInt, IsNotEmpty, IsPositive, IsString, Matches, MaxLength } from "class-validator";

// 토스 성공 리다이렉트의 쿼리(paymentKey, orderId, amount)를 그대로 받는다
export class TossConfirmDto {
  @IsString() @IsNotEmpty() @MaxLength(200) paymentKey!: string;
  @IsString() @Matches(/^[A-Za-z0-9_=-]{6,64}$/, { message: "orderId는 6~64자 영문·숫자·-_=입니다" }) orderId!: string;
  @IsInt() @IsPositive() amount!: number;
}

export class RefundDto {
  @IsInt() @IsPositive() amount!: number;
  @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}
