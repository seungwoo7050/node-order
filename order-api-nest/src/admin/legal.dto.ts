import { Transform, Type } from "class-transformer";
import { IsDate, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// POST /admin/legal/:kind 본문. 저장하면 새 판이 생긴다
export class LegalDocumentDto {
  @Transform(trim) @IsString() @Matches(/\S/, { message: "제목을 입력해 주세요" }) @MaxLength(100) title!: string;
  @IsString() @Matches(/\S/, { message: "본문을 입력해 주세요" }) @MaxLength(50_000) body!: string;
  // 비우면 지금부터 시행
  @IsOptional() @Type(() => Date) @IsDate({ message: "시행일이 올바르지 않습니다" }) effectiveAt?: Date;
}
