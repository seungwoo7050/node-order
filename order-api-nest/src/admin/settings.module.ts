import { Global, Module } from "@nestjs/common";
import { LegalService } from "./legal.service.js";
import { RuntimeSecretsService } from "./runtime-secrets.service.js";
import { AdminSettingsController } from "./settings.controller.js";
import { StoreController } from "./store.controller.js";
import { StoreSettingsService } from "./store-settings.service.js";
import { SystemController } from "./system.controller.js";

// 상점 설정과 법적 고지, 런타임 비밀값·시스템 제어는 주문(배송비, 동의 판)·이행(반품 배송비)·관리자 화면이 같이 읽는다
@Global()
@Module({
  controllers: [AdminSettingsController, StoreController, SystemController],
  providers: [StoreSettingsService, LegalService, RuntimeSecretsService],
  exports: [StoreSettingsService, LegalService, RuntimeSecretsService],
})
export class SettingsModule {}

