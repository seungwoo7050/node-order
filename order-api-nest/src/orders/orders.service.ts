import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CheckoutItemDto, GuestCheckoutDto, ShippingAddressDto } from "./dto/checkout.dto.js";
import { maskShipping } from "../fulfillment/mask.js";
import { shippingFeeFor } from "../fulfillment/policy.js";
import { cancelUnpaidOrder, manualPayment } from "../payments/cancel-unpaid-order.js";
import type { ProviderId } from "../payments/payment-gateway.js";
import { PaymentGateways } from "../payments/payment-gateways.js";
import { LegalService } from "../admin/legal.service.js";
import { StoreSettingsService } from "../admin/store-settings.service.js";
import type { ShippingPolicy } from "../fulfillment/policy.js";
import { afterOrder, encodeOrderCursor, orderListOrder, toPage, type Page } from "../pagination/cursor.js";
import { AuthService } from "../auth/auth.service.js";
import { hashPassword } from "../auth/password.js";

export type Order = { id: number; user: string; price: number; paid: boolean; }
export type CheckoutResult = Order & { shippingFee: number; items: { productId: number; quantity: number; unitPrice: number }[] };
type Consent = { version: number; at: Date };
export type CheckoutResponse = CheckoutResult & { checkoutUrl: string; provider: ProviderId };

const orderSelect = { id: true, userId: true, totalAmount: true, paid: true } as const;
const listSelect = { ...orderSelect, createdAt: true } as const; // 다음 cursor를 만들려면 정렬 키도 읽어야 한다
const toOrder = (row: { id: number; userId: string; totalAmount: number; paid: boolean }): Order =>(
  { id: row.id,user: row.userId, price: row.totalAmount, paid: row.paid }
);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly gateways: PaymentGateways,
    private readonly settings: StoreSettingsService,
    private readonly legal: LegalService,
    private readonly authService: AuthService,
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
    const { user, price, ...rest } = input; // 입력 이름은 price 그대로, DB에는 total_amount에만 쓴다
    const order = await this.prisma.asAdmin(async (tx) => {
      const created = toOrder(await tx.order.create({ data: { ...rest, status: rest.paid ? "paid" : "pending_payment", totalAmount: price, userId: user }, select: orderSelect }));
      if (created.paid) await tx.payment.create({ data: manualPayment(created.id, created.price) });
      await tx.outboxEvent.create({ data: { type: "order.created", userId: creatorId, payload: created } });
      return created;
    });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    return order;
  }

  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.asAdmin((tx) => tx.order.groupBy({
      by: ["userId"], where: { paid: true }, _sum: { totalAmount: true }, orderBy: { userId: "asc" },
    }));
    return Object.fromEntries(rows.map((r) => [r.userId, r._sum.totalAmount ?? 0]));
  }

  async checkout(userId: string, items: CheckoutItemDto[], shipping: ShippingAddressDto, consent: { privacyConsentVersion: number }, idempotencyKey?: string, provider?: ProviderId): Promise<CheckoutResponse> {
    const gateway = this.gateways.pick(provider); // 쓸 수 없는 결제 수단이면 주문을 만들기 전에 400
    // 개인정보 수집·이용(배송지) 동의: 손님이 본 판이 지금 시행 중인 개인정보처리방침이어야 한다(아니면 400, 다시 읽고 동의)
    const privacy = await this.legal.current("privacy");
    if (consent.privacyConsentVersion !== privacy.version) {
      throw new BadRequestException(`개인정보처리방침이 바뀌었습니다(${privacy.version}판). 다시 확인하고 동의해 주세요`);
    }
    const policy = await this.settings.shippingPolicy(); // 배송비는 지금 설정으로 계산해 주문에 저장한다(지난 주문은 그대로)
    const trimmed = trimShipping(shipping);

    // 회원이 주문할 때 기본 배송지가 비어 있으면 이번 주문 배송지를 기본 배송지로 자동 저장
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true, postalCode: true, phone: true } });
    if (user && !user.isGuest && !user.postalCode) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          recipientName: trimmed.recipientName,
          recipientPhone: trimmed.recipientPhone,
          postalCode: trimmed.postalCode,
          address1: trimmed.address1,
          address2: trimmed.address2,
          deliveryMemo: trimmed.deliveryMemo,
          phone: user.phone ?? trimmed.recipientPhone,
        },
      });
    }

    const placed = await this.placeOrReplay(userId, items, trimmed, { version: privacy.version, at: new Date() }, policy, idempotencyKey);
    const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");
    try {
      const started = await gateway.startCheckout({ id: placed.id, price: placed.price, name: `주문 #${placed.id}` }, attemptKey);
      const count = await this.prisma.asUser(userId, async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: placed.id, canceledAt: null },
          data: gateway.id === "stripe" ? { stripeSessionId: started.providerOrderId } : {}, // expand 동안 옛 칸도 채운다
        });
        if (count === 0) return 0;
        // 결제 행: 같은 주문을 다시 결제하면(멱등 재요청) 아직 ready일 때만 새 시도로 바꾼다
        const existing = await tx.payment.findUnique({ where: { orderId: placed.id }, select: { status: true } });
        const attempt = { provider: gateway.id, providerOrderId: started.providerOrderId, amount: placed.price };
        if (!existing) await tx.payment.create({ data: { orderId: placed.id, ...attempt } });
        else if (existing.status === "ready") await tx.payment.update({ where: { orderId: placed.id }, data: attempt });
        return count;
      });
      if (count === 0) throw new ConflictException("결제 시도가 취소됐습니다 - 다시 결제합니다");
      return { ...placed, checkoutUrl: started.checkoutUrl, provider: gateway.id };
    } catch (err) {
      await this.prisma.asUser(userId, async (tx) => {
        await cancelUnpaidOrder(tx, placed.id);
        if (idempotencyKey) await tx.idempotencyKey.deleteMany({ where: { userId, key: idempotencyKey } });
      });
      this.logger.warn(`결제 시작 실패(${gateway.id}) → 주문 #${placed.id} 취소, 재고 복구: ${(err as Error).message}`);
      throw err;
    }
  }

  async guestCheckout(dto: GuestCheckoutDto, idempotencyKey?: string): Promise<CheckoutResponse & { guestAccessToken: string; guestUserId: string }> {
    const gateway = this.gateways.pick(dto.provider);
    const privacy = await this.legal.current("privacy");
    if (dto.privacyConsentVersion !== privacy.version) {
      throw new BadRequestException(`개인정보처리방침이 바뀌었습니다(${privacy.version}판). 다시 확인하고 동의해 주세요`);
    }
    const policy = await this.settings.shippingPolicy();
    const trimmed = trimShipping(dto.shipping);
    const guestUserId = `guest-${randomUUID()}`;
    const guestPasswordHash = await hashPassword(dto.password);

    // users 테이블에는 RLS가 없으므로 먼저 user 행 생성
    await this.prisma.user.create({
      data: {
        id: guestUserId,
        name: trimmed.recipientName,
        phone: trimmed.recipientPhone,
        isGuest: true,
      },
    });

    const placed = await this.placeOrReplay(
      guestUserId,
      dto.items,
      trimmed,
      { version: privacy.version, at: new Date() },
      policy,
      idempotencyKey,
      { isGuest: true, guestPasswordHash },
    );

    const attemptKey = idempotencyKey && createHash("sha256").update(`${guestUserId}:${idempotencyKey}:${placed.id}`).digest("hex");
    try {
      const started = await gateway.startCheckout({ id: placed.id, price: placed.price, name: `주문 #${placed.id}` }, attemptKey);
      const count = await this.prisma.asUser(guestUserId, async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: placed.id, canceledAt: null },
          data: gateway.id === "stripe" ? { stripeSessionId: started.providerOrderId } : {},
        });
        if (count === 0) return 0;
        const existing = await tx.payment.findUnique({ where: { orderId: placed.id }, select: { status: true } });
        const attempt = { provider: gateway.id, providerOrderId: started.providerOrderId, amount: placed.price };
        if (!existing) await tx.payment.create({ data: { orderId: placed.id, ...attempt } });
        else if (existing.status === "ready") await tx.payment.update({ where: { orderId: placed.id }, data: attempt });
        return count;
      });
      if (count === 0) throw new ConflictException("결제 시도가 취소됐습니다 - 다시 결제합니다");
      const guestAccessToken = this.authService.issueGuestToken(guestUserId);
      return { ...placed, checkoutUrl: started.checkoutUrl, provider: gateway.id, guestAccessToken, guestUserId };
    } catch (err) {
      await this.prisma.asUser(guestUserId, async (tx) => {
        await cancelUnpaidOrder(tx, placed.id);
        if (idempotencyKey) await tx.idempotencyKey.deleteMany({ where: { userId: guestUserId, key: idempotencyKey } });
      });
      this.logger.warn(`비회원 결제 시작 실패(${gateway.id}) → 주문 #${placed.id} 취소, 재고 복구: ${(err as Error).message}`);
      throw err;
    }
  }

  private async placeOrReplay(
    userId: string, items: CheckoutItemDto[], shipping: ShippingAddressDto, consent: Consent, policy: ShippingPolicy, idempotencyKey?: string,
    guestMeta?: { isGuest?: boolean; guestPasswordHash?: string },
  ): Promise<CheckoutResult> {
    const requestHash = createHash("sha256").update(JSON.stringify({ items, shipping })).digest("hex");
    try {
      const result = await this.prisma.asUser(userId, async (tx) => {
        if (idempotencyKey) {
          await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash } });
        }
        const placed = await this.placeOrder(tx, userId, items, shipping, consent, policy, guestMeta);
        await tx.outboxEvent.create({ data: { type: "order.created", userId, payload: placed } });
        if (idempotencyKey) {
          await tx.idempotencyKey.update({
            where: { userId_key: { userId, key: idempotencyKey } }, data: { response: placed },
          });
        }
        return placed;
      });
      // 배송지는 마스킹해서만 남긴다(연락처·상세주소 원문은 로그에 없다)
      this.logger.log(`주문 접수(결제 대기): #${result.id} (${result.user}) ${result.price}원(배송비 ${result.shippingFee}원) 배송지 ${maskShipping(shipping)}`);
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

  private async placeOrder(
    tx: Prisma.TransactionClient, userId: string, items: CheckoutItemDto[], shipping: ShippingAddressDto, consent: Consent, policy: ShippingPolicy,
    guestMeta?: { isGuest?: boolean; guestPasswordHash?: string },
  ): Promise<CheckoutResult> {
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
    // 배송비는 주문에 따로 저장하고 total_amount에 더한다. PG 승인 금액 대조(27)는 이 total과 비교한다
    const shippingFee = shippingFeeFor(total, policy);
    const order = await tx.order.create({
      data: {
        userId, totalAmount: total + shippingFee, shippingFee, paid: false, status: "pending_payment", ...shipping,
        privacyConsentVersion: consent.version, privacyConsentedAt: consent.at,
        returnShippingFee: policy.returnShippingFee,
        isGuest: guestMeta?.isGuest ?? false,
        guestPasswordHash: guestMeta?.guestPasswordHash ?? null,
        items: { create: items.map((i) => ({
          productId: i.productId, quantity: i.quantity, unitPrice: products.find((p) => p.id === i.productId)!.price,
        })) },
      },
      select: { ...orderSelect, shippingFee: true, items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    return { ...toOrder(order), shippingFee: order.shippingFee, items: order.items };
  }
}

function trimShipping(s: ShippingAddressDto): ShippingAddressDto {
  const opt = (v?: string) => (v?.trim() ? v.trim() : undefined);
  return {
    recipientName: s.recipientName.trim(), recipientPhone: s.recipientPhone.trim(), postalCode: s.postalCode, address1: s.address1.trim(),
    address2: opt(s.address2), deliveryMemo: opt(s.deliveryMemo),
  };
}
