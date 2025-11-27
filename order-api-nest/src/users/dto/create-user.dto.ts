import { IsNotEmpty, IsString, Matches, MinLength } from "class-validator";

export class CreateUserDto {
  @IsString() @IsNotEmpty() @Matches(/^(?!github-)/, { message: "github-로 시작하는 id는 사용할 수 없습니다"}) id!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @MinLength(8) password!: string;
}