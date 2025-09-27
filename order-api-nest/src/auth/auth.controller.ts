import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from "@nestjs/jwt"
import { LoginDto } from './login.dto.js';

@Controller("auth")
export class AuthController {
  constructor(private readonly jwtService: JwtService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    if (dto.id !== "kim" || dto.password !== process.env.DEMO_PASSWORD) {
      throw new UnauthorizedException("id 또는 password가 틀렸습니다.");
    }
    return { accessToken: this.jwtService.sign({ sub: dto.id })};
  }
}
