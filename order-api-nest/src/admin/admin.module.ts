import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

// 관리자 대시보드. 26의 0건 검색어 집계(SearchStats)를 같이 읽는다
@Module({
  imports: [SearchModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class AdminModule {}
