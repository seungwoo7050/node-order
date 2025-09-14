import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface Order { id: number; user: string; price: number; paid: boolean; }

const orderSelect = { id: true, userId: true, price: true, paid: true } as const;
const toOrder = (row: { id: number; userId: string; price: number; paid: boolean }): Order =>(
  { id: row.id,user: row.userId, price: row.price, paid: row.paid }
);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  async list(paid?: boolean): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } });
    return rows.map(toOrder);
  }
  async findOne(id: number): Promise<Order> {
    const row = await this.prisma.order.findUnique({ where: { id }, select: orderSelect });
    if (!row) throw new NotFoundException(`order ${id} not found`);
    return toOrder(row);
  }
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    const { user, ...rest } = input;
    const order = toOrder(await this.prisma.order.create({ data: { ...rest, userId: user }, select: orderSelect }));
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    this.notifications.notifyUser(creatorId, "order.created", order);
    return order;
  }
  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ["userId"], where: { paid: true }, _sum: { price: true }, orderBy: { userId: "asc" },
    });
    return Object.fromEntries(rows.map((r) => [r.userId, r._sum.price ?? 0]));
  }
}