import { Body, Controller, Get, Headers, HttpException, HttpStatus, Param, Post, Put, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { LegalDocumentDto } from "./legal.dto.js";
import { LegalService, legalKind } from "./legal.service.js";
import { BrandingDto } from "./store-settings.dto.js";
import { SETTINGS_BODY, StoreSettingsService, parseIfMatch, type StoreSettingsInput } from "./store-settings.service.js";

// 관리자 상점 설정·법적 고지. 읽기는 데모 관리자도 되고(AdminViewGuard), 쓰기는 진짜 관리자만(AdminGuard)
// 응답에는 비밀값이 없다: 설정 스키마에 비밀 칸이 없고, 연결 여부는 GET /features가 참·거짓으로만 준다
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(AuthGuard("jwt"))
export class AdminSettingsController {
  constructor(
    private readonly settings: StoreSettingsService,
    private readonly legal: LegalService,
  ) {}

  // ETag = version. 저장할 때 If-Match로 돌려보낸다
  @Get("settings")
  @UseGuards(AdminViewGuard)
  async getSettings(@Res({ passthrough: true }) res: Response) {
    const settings = await this.settings.get();
    res.setHeader("ETag", `"${settings.version}"`);
    return settings;
  }

  @Put("settings")
  @UseGuards(AdminGuard)
  async saveSettings(@Body(SETTINGS_BODY) dto: StoreSettingsInput, @Res({ passthrough: true }) res: Response, @Headers("if-match") ifMatch?: string) {
    const version = parseIfMatch(ifMatch);
    if (version === null) throw new HttpException({ statusCode: 428, message: "If-Match 헤더(읽은 설정의 version)가 필요합니다" }, HttpStatus.PRECONDITION_REQUIRED);
    const saved = await this.settings.save(dto, version);
    res.setHeader("ETag", `"${saved.version}"`);
    return saved;
  }

  @Get("settings/branding")
  @UseGuards(AdminViewGuard)
  getBranding() {
    return this.settings.getBranding();
  }

  @Put("settings/branding")
  @UseGuards(AdminGuard)
  saveBranding(@Body() dto: BrandingDto) {
    return this.settings.saveBranding(dto);
  }

  @Get("legal/:kind")
  @UseGuards(AdminViewGuard)
  getLegal(@Param("kind") kind: string) {
    return this.legal.view(legalKind(kind));
  }

  @Post("legal/:kind")
  @UseGuards(AdminGuard)
  publishLegal(@Param("kind") kind: string, @Body(PAGE_QUERY) dto: LegalDocumentDto) {
    return this.legal.publish(legalKind(kind), dto);
  }
}
