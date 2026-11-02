import { IsInt, IsPositive, IsString, Matches, MaxLength } from "class-validator";

export class GuestOrderLookupDto {
  @IsInt({ message: "주문번호는 숫자입니다" })
  @IsPositive({ message: "주문번호는 양수입니다" })
  orderId!: number;

  @IsString({ message: "비밀번호를 입력해 주세요" })
  @Matches(/\S/, { message: "비밀번호를 입력해 주세요" })
  @MaxLength(100)
  password!: string;
}
