import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CheckoutItemDto } from "./dto/checkout.dto.js";
import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";
import { StripeGateway } from "../payments/stripe.gateway.js";
import { afterOrder, encodeOrderCursor, orderListOrder, toPage, type Page } from "../pagination/cursor.js";

export type Order = { id: number; user: string; price: number; paid: boolean; }
export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };
export type CheckoutResponse = CheckoutResult & { checkoutUrl: string };

const orderSelect = { id: true, userId: true, price: true, paid: true } as const;
const listSelect = { ...orderSelect, createdAt: true } as const; // 다음 cursor를 만들려면 정렬 키도 읽어야 한다
const toOrder = (row: { id: number; userId: string; price: number; paid: boolean }): Order =>(
  { id: row.id,user: row.userId, price: row.price, paid: row.paid }
);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly stripe: StripeGateway,
  ) {}

  async list(query: { limit: number; cursor?: string; offset?: number; paid?: boolean }): Promise<Page<Order & { createdAt: Date }>> {
    const rows = await this.prisma.asAdmin((tx) => tx.order.findMany({
      where: { paid: query.paid, ...afterOrder(query.cursor) },
      select: listSelect,
      orderBy: [...orderListOrder],
      skip: query.cursor ? undefined : query.offset,
      take: query.limit + 1,
    }));
    const page = toPage(rows, query.limit, encodeOrderCursor);
    return { items: page.items.map((r) => ({ ...toOrder(r), createdAt: r.createdAt })), nextCursor: page.nextCursor };
  }

  async findOne(id: number): Promise<Order> {
    const row = await this.prisma.asAdmin((tx) => tx.order.findUnique({ where: { id }, select: orderSelect }));
    if (!row) throw new NotFoundException(`order ${id} not found`);
    return toOrder(row);
  }

  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    const { user, ...rest } = input;
    const order = await this.prisma.asAdmin(async (tx) => {
      const created = toOrder(await tx.order.create({ data: { ...rest, userId: user }, select: orderSelect }));
      await tx.outboxEvent.create({ data: { type: "order.created", userId: creatorId, payload: created } });
      return created;
    });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    return order;
  }

  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.asAdmin((tx) => tx.order.groupBy({
      by: ["userId"], where: { paid: true }, _sum: { price: true }, orderBy: { userId: "asc" },
    }));
    return Object.fromEntries(rows.map((r) => [r.userId, r._sum.price ?? 0]));
  }

  async checkout(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResponse> {
    const placed = await this.placeOrReplay(userId, items, idempotencyKey);
    const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");
    try {
      const session = await this.stripe.createCheckoutSession(placed, attemptKey);
      const { count } = await this.prisma.asUser(userId, (tx) =>
        tx.order.updateMany({ where: { id: placed.id, canceledAt: null }, data: { stripeSessionId: session.id } }),
      );
      if (count === 0) throw new ConflictException("결제 시도가 취소됐습니다 - 다시 결제합니다");
      return { ...placed, checkoutUrl: session.url };
    } catch (err) {
      await this.prisma.asUser(userId, async (tx) => {
        await cancelUnpaidOrder(tx, placed.id);
        if (idempotencyKey) await tx.idempotencyKey.deleteMany({ where: { userId, key: idempotencyKey } });
      });
      this.logger.warn(`결제 세션 생성 실패 → 주문 #${placed.id} 취소, 재고 복구: ${(err as Error).message}`);
      throw err;
    }
  }

  private async placeOrReplay(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResult> {
    const requestHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
    try {
      const result = await this.prisma.asUser(userId, async (tx) => {
        if (idempotencyKey) {
          await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash } });
        }
        const placed = await this.placeOrder(tx, userId, items);
        await tx.outboxEvent.create({ data: { type: "order.created", userId, payload: placed } });
        if (idempotencyKey) {
          await tx.idempotencyKey.update({
            where: { userId_key: { userId, key: idempotencyKey } }, data: { response: placed },
          });
        }
        return placed;
      });
      this.logger.log(`주문 접수(결제 대기): #${result.id} (${result.user}) ${result.price}원`);
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
        userId, price: total, paid: false,
        items: { create: items.map((i) => ({
          productId: i.productId, quantity: i.quantity, unitPrice: products.find((p) => p.id === i.productId)!.price,
        })) },
      },
      select: { ...orderSelect, items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    return { ...toOrder(order), items: order.items };
  }
}
