import { Body, Controller, HttpCode, NotFoundException, Post, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "../auth/auth.service.js";
import { verifyPassword } from "../auth/password.js";
import { customerOrderView } from "../fulfillment/views.js";
import { GuestOrderLookupDto } from "./guest-orders.dto.js";

@ApiTags("guest")
@Controller("guest/orders")
export class GuestOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  @Post("lookup")
  @HttpCode(200)
  async lookup(@Body() dto: GuestOrderLookupDto) {
    const order = await this.prisma.asAdmin((tx) =>
      tx.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true, userId: true, isGuest: true, guestPasswordHash: true },
      }),
    );

    if (!order || !order.isGuest || !order.guestPasswordHash) {
      throw new NotFoundException(`비회원 주문 #${dto.orderId}을 찾을 수 없습니다`);
    }

    const ok = await verifyPassword(dto.password, order.guestPasswordHash);
    if (!ok) {
      throw new UnauthorizedException("비회원 주문 비밀번호가 일치하지 않습니다");
    }

    const guestAccessToken = this.authService.issueGuestToken(order.userId);
    const orderView = await this.prisma.asUser(order.userId, (tx) => customerOrderView(tx, order.userId, order.id));

    return {
      order: orderView,
      guestAccessToken,
    };
  }
}
