import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

export class CreateCouponDto {
  @IsString()
  @Matches(/^\S+$/, { message: "쿠폰 코드에는 공백이 포함될 수 없습니다" })
  @MaxLength(50)
  code!: string;

  @IsString()
  @Matches(/\S/, { message: "쿠폰명을 입력해 주세요" })
  @MaxLength(100)
  name!: string;

  @IsIn(["fixed", "percent"], { message: "할인 종류는 fixed 또는 percent여야 합니다" })
  discountType!: "fixed" | "percent";

  @IsInt()
  @Min(1, { message: "할인 값은 1 이상이어야 합니다" })
  discountValue!: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: "최소 주문 금액은 0 이상이어야 합니다" })
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: "최대 할인 금액은 1 이상이어야 합니다" })
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1, { message: "최대 사용 횟수는 1 이상이어야 합니다" })
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @Matches(/^\S+$/, { message: "쿠폰 코드에는 공백이 포함될 수 없습니다" })
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "쿠폰명을 입력해 주세요" })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(["fixed", "percent"])
  discountType?: "fixed" | "percent";

  @IsOptional()
  @IsInt()
  @Min(1)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class ValidateCouponDto {
  @IsString()
  code!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  subtotal!: number;
}
