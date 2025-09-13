import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface Order { id: number; user: string; price: number; paid: boolean; }

const orderSelect = { id: true, user: true, price: true, paid: true } as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  list(paid?: boolean): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } });
  }
  async findOne(id: number): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: orderSelect });
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    const order = await this.prisma.order.create({ data: input, select: orderSelect });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    this.notifications.notifyUser(creatorId, "order.created", order);
    return order;
  }
  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ["user"], where: { paid: true }, _sum: { price: true }, orderBy: { user: "asc" },
    });
    return Object.fromEntries(rows.map((r) => [r.user, r._sum.price ?? 0]));
  }
}