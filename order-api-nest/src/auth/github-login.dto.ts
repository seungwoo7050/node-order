import { IsNotEmpty, IsString } from "class-validator";

export class GithubLoginDto {
  @IsString() @IsNotEmpty() accessToken!: string;
}

export class ExchangeCodeDto {
  @IsString() @IsNotEmpty() code!: string;
}
