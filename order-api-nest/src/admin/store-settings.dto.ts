import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from "class-validator";
import { isValidBusinessNumber, normalizeBusinessNumber } from "./business-number.js";

@ValidatorConstraint({ name: "businessNumber" })
class BusinessNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === "string" && isValidBusinessNumber(value);
  }
  defaultMessage() {
    return "사업자등록번호가 올바르지 않습니다(10자리, 검증 번호 확인)";
  }
}

const NOT_BLANK = /\S/;
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const MAX_AMOUNT = 1_000_000;

export const STORE_DESIGNS = ["muji-hara", "editorial-atelier", "zavanas-archive"] as const;
export type StoreDesign = (typeof STORE_DESIGNS)[number];

export class BrandingDto {
  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @IsIn(STORE_DESIGNS, { message: "스토어 디자인은 muji-hara, editorial-atelier, zavanas-archive 중 하나여야 합니다" })
  storeDesign?: StoreDesign;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  heroTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  heroSubtitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  announcementText?: string;
}

// PUT /admin/settings 본문. 칸 전체를 보낸다(빠진 칸은 400). 비밀값(PG 키 등) 칸은 없다: 환경변수에만 둔다
export class StoreSettingsDto {
  @Transform(trim) @IsString() @Matches(NOT_BLANK, { message: "상호를 입력해 주세요" }) @MaxLength(100) storeName!: string;
  @Transform(trim) @IsString() @Matches(NOT_BLANK, { message: "대표자를 입력해 주세요" }) @MaxLength(50) representative!: string;
  // 하이픈은 있어도 되고, 저장할 때는 숫자 10자리로 바꾼다
  @Transform(({ value }) => (typeof value === "string" ? (normalizeBusinessNumber(value) ?? value) : value))
  @IsString() @Validate(BusinessNumberConstraint) businessNumber!: string;
  @Transform(trim) @IsString() @Matches(NOT_BLANK, { message: "통신판매업 신고번호를 입력해 주세요" }) @MaxLength(50) mailOrderNumber!: string;
  @Transform(trim) @IsString() @Matches(NOT_BLANK, { message: "사업장 주소를 입력해 주세요" }) @MaxLength(200) address!: string;
  @Transform(trim) @IsString() @Matches(/^0\d{1,2}-?\d{3,4}-?\d{4}$|^1\d{3}-?\d{4}$/, { message: "연락처는 02-123-4567, 1588-1234 꼴로 입력해 주세요" }) phone!: string;
  @Transform(trim) @IsEmail({}, { message: "이메일 형식이 아닙니다" }) @MaxLength(100) email!: string;
  @Transform(trim) @IsString() @Matches(NOT_BLANK, { message: "개인정보 보호책임자를 입력해 주세요" }) @MaxLength(100) privacyOfficer!: string;
  @IsInt({ message: "배송비는 원 단위 정수입니다" }) @Min(0) @Max(MAX_AMOUNT) shippingFee!: number;
  @IsInt({ message: "무료 배송 기준은 원 단위 정수입니다" }) @Min(0) @Max(100_000_000) freeShippingThreshold!: number;
  @IsInt({ message: "반품 왕복 배송비는 원 단위 정수입니다" }) @Min(0) @Max(MAX_AMOUNT) returnShippingFee!: number;
  @IsInt({ message: "재고 부족 기준은 정수입니다" }) @Min(0) @Max(100_000) lowStockThreshold!: number;

  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @IsIn(STORE_DESIGNS, { message: "스토어 디자인은 muji-hara, editorial-atelier, zavanas-archive 중 하나여야 합니다" })
  storeDesign?: StoreDesign;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  heroTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  heroSubtitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  announcementText?: string;
}
