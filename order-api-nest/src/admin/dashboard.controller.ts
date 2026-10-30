import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { DashboardService } from "./dashboard.service.js";

// 관리자 대시보드(오늘 처리할 것). 데모 관리자도 본다
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/dashboard")
@UseGuards(AuthGuard("jwt"), AdminViewGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get() {
    return this.dashboard.get();
  }
}
