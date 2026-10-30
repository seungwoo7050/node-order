import { Type } from "class-transformer";
import {
  ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, ValidateNested,
} from "class-validator";
import { PageQueryDto } from "../pagination/page-query.dto.js";
import { CARRIER_CODES, type CarrierCode } from "./carriers.js";
import { ORDER_STATUSES, type OrderStatus } from "./order-state.js";
import type { ReturnReason } from "./policy.js";

export class AdminFulfillmentQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: OrderStatus;
  // 대시보드의 "반품 요청" 타일: 처리하지 않은 반품·교환 요청이 있는 주문만
  @IsOptional() @IsIn(["requested"]) returns?: "requested";
}

// 목록에 없는 택배사 코드는 400
export class ShipmentDto {
  @IsIn(CARRIER_CODES, { message: `택배사는 ${CARRIER_CODES.join(", ")} 가운데 하나입니다` }) carrier!: CarrierCode;
  @IsString() @MaxLength(30) trackingNumber!: string;
}

export class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class RejectReturnDto {
  @IsString() @Matches(/\S/, { message: "거절 사유를 입력해 주세요" }) @MaxLength(200) reason!: string;
}

export class ReturnItemDto {
  @IsInt() @IsPositive() productId!: number;
  @IsInt() @IsPositive() quantity!: number;
}

export const RETURN_REASONS: readonly ReturnReason[] = ["change_of_mind", "defective", "wrong_item"];

export class ReturnRequestDto {
  @IsIn(["refund", "exchange"]) kind!: "refund" | "exchange";
  @IsIn(RETURN_REASONS) reason!: ReturnReason;
  @IsOptional() @IsString() @MaxLength(500) detail?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReturnItemDto)
  @ArrayUnique((i: ReturnItemDto) => i.productId) items!: ReturnItemDto[];
}
