import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { LegalService, legalKind } from "./legal.service.js";
import { StoreSettingsService } from "./store-settings.service.js";

// 누구나 읽는 상점 정보: 바닥글의 사업자 표시(전자상거래법), 배송비 안내, 약관·개인정보처리방침·청약철회 안내
@ApiTags("store")
@Controller()
export class StoreController {
  constructor(
    private readonly settings: StoreSettingsService,
    private readonly legal: LegalService,
  ) {}

  @Get("store")
  store() {
    return this.settings.publicView();
  }

  // 지금 시행 중인 판과 판 목록
  @Get("legal/:kind")
  current(@Param("kind") kind: string) {
    return this.legal.view(legalKind(kind));
  }

  // 지난 판도 연다(개인정보처리방침 변경 이력 공개)
  @Get("legal/:kind/versions/:version")
  version(@Param("kind") kind: string, @Param("version", ParseIntPipe) version: number) {
    return this.legal.view(legalKind(kind), version);
  }
}
