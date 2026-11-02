import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { PageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { listMyOrders } from "./my-orders.js";
import { customerOrderView } from "../fulfillment/views.js";
import { ChangePasswordDto, UpdateProfileDto } from "./profile.dto.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const profileSelect = {
  id: true,
  name: true,
  role: true,
  phone: true,
  isGuest: true,
  recipientName: true,
  recipientPhone: true,
  postalCode: true,
  address1: true,
  address2: true,
  deliveryMemo: true,
  createdAt: true,
} as const;

@ApiTags("me")
@ApiBearerAuth()
@Controller("me")
@UseGuards(AuthGuard("jwt"))
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("profile")
  async getProfile(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new NotFoundException("사용자를 찾을 수 없습니다");
    return user;
  }

  @Patch("profile")
  async updateProfile(@Body() dto: UpdateProfileDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (dto.recipientName !== undefined) data.recipientName = dto.recipientName.trim() || null;
    if (dto.recipientPhone !== undefined) data.recipientPhone = dto.recipientPhone.trim() || null;
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode.trim() || null;
    if (dto.address1 !== undefined) data.address1 = dto.address1.trim() || null;
    if (dto.address2 !== undefined) data.address2 = dto.address2.trim() || null;
    if (dto.deliveryMemo !== undefined) data.deliveryMemo = dto.deliveryMemo.trim() || null;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: profileSelect,
    });
    return updated;
  }

  @Post("password")
  @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new NotFoundException("사용자를 찾을 수 없습니다");
    if (!user.passwordHash) throw new BadRequestException("소셜 로그인 또는 비밀번호가 없는 계정입니다");

    const valid = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException("현재 비밀번호가 일치하지 않습니다");

    const newHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
    return { success: true };
  }

  @Get("orders")
  myOrders(@Req() req: Request, @Query(PAGE_QUERY) query: PageQueryDto) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.asUser(userId, (tx) => listMyOrders(tx, userId, query));
  }

  @Get("orders/:id")
  async myOrder(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    // 상태 이력·송장 조회 링크·반품 요청과 구매확정·반품 신청 가능 여부까지 싣는다
    const order = await this.prisma.asUser(userId, (tx) => customerOrderView(tx, userId, id));
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
}
