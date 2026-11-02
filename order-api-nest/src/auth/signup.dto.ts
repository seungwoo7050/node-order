import { IsNotEmpty, IsOptional, IsString, Length, Matches } from "class-validator";

export class SignupDto {
  @IsString()
  @Length(3, 30, { message: "아이디는 3~30자 사이여야 합니다" })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: "아이디는 영문, 숫자, '-', '_'만 사용할 수 있습니다" })
  id!: string;

  @IsString()
  @Length(8, 100, { message: "비밀번호는 8자 이상이어야 합니다" })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: "이름을 입력해 주세요" })
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
