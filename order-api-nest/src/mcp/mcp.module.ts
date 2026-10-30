import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { FulfillmentModule } from "../fulfillment/fulfillment.module.js";
import { ReconciliationModule } from "../reconciliation/reconciliation.module.js";
import { SearchModule } from "../search/search.module.js";
import { AccessTokensController } from "./access-tokens.controller.js";
import { AccessTokensService } from "./access-tokens.js";
import { McpController } from "./mcp.controller.js";

// 판매자용 MCP 서버(/mcp)와 개인 접근 토큰. 도구는 이행(28·27)·대시보드(29)·대사(29)·검색 통계(26) 서비스를 직접 부른다
@Module({
  imports: [FulfillmentModule, AdminModule, ReconciliationModule, SearchModule],
  controllers: [McpController, AccessTokensController],
  providers: [AccessTokensService],
})
export class McpModule {}
