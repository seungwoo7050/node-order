import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateReviewDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  orderId?: number;

  @IsInt({ message: "상품 ID가 필요합니다" })
  @IsPositive()
  productId!: number;

  @IsInt({ message: "별점은 1~5점 사이의 정수여야 합니다" })
  @Min(1, { message: "별점은 1점 이상이어야 합니다" })
  @Max(5, { message: "별점은 5점 이하이어야 합니다" })
  rating!: number;

  @IsString({ message: "리뷰 내용을 입력해 주세요" })
  @Matches(/\S/, { message: "리뷰 내용은 공백만으로 작성할 수 없습니다" })
  @MaxLength(1000, { message: "리뷰는 1,000자 이하여야 합니다" })
  content!: string;
}

export class AdminReviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsString()
  q?: string;
}
