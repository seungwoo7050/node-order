import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CheckoutItemDto } from "./dto/checkout.dto.js";

export type Order = { id: number; user: string; price: number; paid: boolean; }
export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };

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
  async checkout(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResult> {
    const requestHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash } });
        }
        const placed = await this.placeOrder(tx, userId, items);
        if (idempotencyKey) {
          await tx.idempotencyKey.update({
            where: { userId_key: { userId, key: idempotencyKey } }, data: { response: placed },
          });
        }
        return placed;
      });
      this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
      this.notifications.notifyUser(userId, "order.created", result);
      return result;
    } catch (err) {
      if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const saved = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key: idempotencyKey } } });
        if (saved) {
          if (saved.requestHash !== requestHash) {
            throw new UnprocessableEntityException("같은 Idempotency-Key로 다른 내용의 요청을 보냈다");
          }
          this.logger.log(`멱등 재응답: key=${idempotencyKey}`);
          return saved.response as CheckoutResult;
        }
      }
      throw err;
    }
  }

  private async placeOrder(tx: Prisma.TransactionClient, userId: string, items: CheckoutItemDto[]): Promise<CheckoutResult> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
      SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
    let total = 0;
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new NotFoundException(`product ${item.productId} not found`);
      if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
      total += product.price * item.quantity;
    }
    const order = await tx.order.create({
      data: {
        userId, price: total, paid: true,
        items: { create: items.map((i) => ({
          productId: i.productId, quantity: i.quantity, unitPrice: products.find((p) => p.id === i.productId)!.price,
        })) },
      },
      select: { ...orderSelect, items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    return { ...toOrder(order), items: order.items };
  }
}