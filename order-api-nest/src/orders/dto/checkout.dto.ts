import { Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsPositive, ValidateNested } from "class-validator";

export class CheckoutItemDto {
  @IsInt() @IsPositive() productId!: number;
  @IsInt() @IsPositive() quantity!: number;
}

export class CheckoutDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  @ArrayUnique((i: CheckoutItemDto) => i.productId, { message: "같은 상품은 한 줄로 합쳐 수량으로 보냅니다" })
  items!: CheckoutItemDto[];
}