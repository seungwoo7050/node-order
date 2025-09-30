import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { AuthService, REFRESH_TOKEN_TTL_SECONDS } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";

const REFRESH_COOKIE = "refresh_token";
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/auth",
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.login(dto.id, dto.password);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
    return { accessToken };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
    return { accessToken };
  }
}