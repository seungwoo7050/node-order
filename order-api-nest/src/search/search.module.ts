import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { PgSearchEngine } from "./pg-search-engine.js";
import { SEARCH_ENGINE } from "./search-engine.js";
import { SearchStats } from "./search-stats.js";

// 엔진을 바꿀 때는 이 useFactory만 바꾼다(같은 계약 테스트를 통과하는 구현으로)
@Module({
  providers: [{ provide: SEARCH_ENGINE, useFactory: (prisma: PrismaService) => new PgSearchEngine(prisma), inject: [PrismaService] }, SearchStats],
  exports: [SEARCH_ENGINE, SearchStats],
})
export class SearchModule {}
