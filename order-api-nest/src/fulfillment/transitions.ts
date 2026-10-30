import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { ORDER_STATUS_LABEL, nextStatus, type Actor, type OrderEvent, type OrderStatus } from "./order-state.js";

type Tx = Prisma.TransactionClient;
export type ActorRef = { type: Actor; id?: string | null };

// 허용되지 않은 전이(또는 동시 요청에 진 전이): 409와 지금 상태를 돌려준다
export class TransitionConflict extends ConflictException {
  constructor(readonly currentStatus: string, message: string) {
    super({ statusCode: 409, error: "Conflict", message, currentStatus });
  }
}

const EVENT_LABEL: Record<OrderEvent, string> = {
  pay: "결제 완료", expire: "결제 기한 취소", prepare: "배송 준비", ship: "송장 입력", deliver: "배송 완료", confirm: "구매확정", cancel: "취소",
};

export const orderConflict = (current: OrderStatus, event: OrderEvent) =>
  new TransitionConflict(current, `${ORDER_STATUS_LABEL[current]} 상태에서는 ${EVENT_LABEL[event]}을(를) 할 수 없습니다`);

// expand 동안 옛 칸(paid, canceled_at)도 같이 맞춘다
function legacyColumns(to: OrderStatus, now: Date): Prisma.OrderUpdateManyMutationInput {
  if (to === "paid") return { paid: true };
  if (to === "canceled") return { canceledAt: now };
  if (to === "delivered") return { deliveredAt: now };
  return {};
}

export type Attempt =
  | { ok: true; from: OrderStatus; to: OrderStatus; userId: string }
  | { ok: false; current: OrderStatus };

// 전이 한 번: 지금 상태 읽기 → 전이 표 확인 → 조건부 update(WHERE status = from) → 이력 + 알림(outbox), 모두 호출한 트랜잭션 안에서.
// 같은 주문에 동시에 두 요청이 오면 둘 다 from을 읽어도, 늦은 쪽의 update는 먼저 커밋된 행을 다시 보고 0행이 된다
export async function attemptTransition(
  tx: Tx,
  orderId: number,
  event: OrderEvent,
  actor: ActorRef,
  opts: { reason?: string; now?: Date; notice?: Record<string, unknown> } = {},
): Promise<Attempt> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, userId: true } });
  if (!order) throw new NotFoundException(`order ${orderId} not found`);
  const rule = nextStatus(order.status, event, actor.type);
  if (!rule.ok) return { ok: false, current: order.status };

  const now = opts.now ?? new Date();
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: rule.from },
    data: { status: rule.to, statusChangedAt: now, ...legacyColumns(rule.to, now) },
  });
  if (count === 0) {
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    return { ok: false, current: current.status };
  }
  await tx.orderStatusHistory.create({
    data: { orderId, fromStatus: rule.from, toStatus: rule.to, actorType: actor.type, actorId: actor.id ?? null, reason: opts.reason ?? null, createdAt: now },
  });
  if (rule.notice) {
    await tx.outboxEvent.create({ data: { type: rule.notice, userId: order.userId, payload: { orderId, from: rule.from, to: rule.to, ...opts.notice } } });
  }
  return { ok: true, from: rule.from, to: rule.to, userId: order.userId };
}

export async function transitionOrder(...args: Parameters<typeof attemptTransition>): Promise<Extract<Attempt, { ok: true }>> {
  const result = await attemptTransition(...args);
  if (!result.ok) throw orderConflict(result.current, args[2]);
  return result;
}

// 주문 항목 수량만큼 재고를 돌려놓는다(취소). 상품 id 순서로 잠가 다른 재고 변경과 교착되지 않게 한다
export async function restoreOrderStock(tx: Tx, orderId: number): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { productId: "asc" } });
  for (const item of items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
}
