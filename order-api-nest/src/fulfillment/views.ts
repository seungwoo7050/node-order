import type { Prisma } from "../generated/prisma/client.js";
import { CARRIERS, isCarrierCode, trackingUrl } from "./carriers.js";
import { allowedEvents, nextReturnStatus, type OrderStatus } from "./order-state.js";
import { returnDeadline } from "./policy.js";

type Tx = Prisma.TransactionClient;

// 주문 상세에 같이 싣는 이행 정보(상태 이력, 송장, 반품). 손님 화면과 관리자 화면이 같은 모양을 쓴다
export const fulfillmentSelect = {
  id: true, userId: true, totalAmount: true, shippingFee: true, paid: true, canceledAt: true, createdAt: true,
  status: true, statusChangedAt: true, deliveredAt: true,
  isGuest: true, returnShippingFee: true,
  recipientName: true, recipientPhone: true, postalCode: true, address1: true, address2: true, deliveryMemo: true,
  items: { select: { quantity: true, unitPrice: true, variantKey: true, variantId: true, variantLabel: true, product: { select: { id: true, name: true } } }, orderBy: [{ productId: "asc" }, { variantKey: "asc" }] },
  history: { select: { fromStatus: true, toStatus: true, actorType: true, reason: true, createdAt: true }, orderBy: { id: "asc" } },
  shipments: { select: { id: true, returnId: true, carrier: true, trackingNumber: true, shippedAt: true }, orderBy: { id: "asc" } },
  returns: {
    select: {
      id: true, kind: true, status: true, reason: true, detail: true, refundAmount: true, rejectReason: true,
      requestedAt: true, decidedAt: true, completedAt: true,
      items: { select: { productId: true, variantKey: true, variantId: true, variantLabel: true, quantity: true, unitPrice: true, product: { select: { name: true } } }, orderBy: [{ productId: "asc" }, { variantKey: "asc" }] },
    },
    orderBy: { id: "asc" },
  },
  payment: { select: { provider: true, status: true, amount: true } },
} as const satisfies Prisma.OrderSelect;

type Row = Prisma.OrderGetPayload<{ select: typeof fulfillmentSelect }>;

const shipmentView = (s: Row["shipments"][number]) => ({
  ...s,
  carrierName: isCarrierCode(s.carrier) ? CARRIERS[s.carrier].name : s.carrier,
  trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
});

// 반품 환불은 refunds의 멱등 키(return-<id>, 관리자가 다시 시도하면 return-<id>-r<n>)로 찾는다. 시도가 여럿이면 마지막 시도
export const RETURN_REFUND_KEY = /^return-(\d+)(?:-r\d+)?$/;
async function returnRefunds(tx: Tx, orderId: number) {
  const refunds = await tx.refund.findMany({
    where: { payment: { orderId }, idempotencyKey: { startsWith: "return-" } },
    select: { id: true, idempotencyKey: true, amount: true, status: true },
    orderBy: { id: "asc" },
  });
  const byReturn = new Map<number, { id: number; amount: number; status: (typeof refunds)[number]["status"] }>();
  for (const r of refunds) {
    const m = r.idempotencyKey.match(RETURN_REFUND_KEY);
    if (m) byReturn.set(Number(m[1]), { id: r.id, amount: r.amount, status: r.status });
  }
  return byReturn;
}

// 반품할 수 있는 수량: 주문 수량 - (거절되지 않은 반품 요청의 수량)
export function returnableQuantities(row: {
  items: { quantity: number; product: { id: number }; variantKey?: number }[];
  returns: { status: string; items: { productId: number; quantity: number; variantKey?: number }[] }[];
}): Map<string | number, number> {
  const left = new Map<string | number, number>();
  for (const i of row.items) {
    const vKey = i.variantKey ?? 0;
    const key = `${i.product.id}:${vKey}`;
    left.set(key, (left.get(key) ?? 0) + i.quantity);
    left.set(i.product.id, (left.get(i.product.id) ?? 0) + i.quantity);
  }
  for (const r of row.returns) {
    if (r.status === "rejected") continue;
    for (const i of r.items) {
      const vKey = i.variantKey ?? 0;
      const key = `${i.productId}:${vKey}`;
      left.set(key, (left.get(key) ?? 0) - i.quantity);
      left.set(i.productId, (left.get(i.productId) ?? 0) - i.quantity);
    }
  }
  return left;
}

async function baseView(tx: Tx, row: Row, now: Date) {
  const refunds = await returnRefunds(tx, row.id);
  const { totalAmount, recipientName, recipientPhone, postalCode, address1, address2, deliveryMemo, ...rest } = row;
  const deadline = row.deliveredAt ? returnDeadline(row.deliveredAt) : null;
  const left = returnableQuantities(row);
  const openReturn = row.returns.some((r) => r.status === "requested");
  const canReturn = row.status === "delivered" && deadline !== null && now <= deadline && [...left.values()].some((q) => q > 0);
  return {
    ...rest,
    price: totalAmount,
    subtotal: totalAmount - row.shippingFee,
    shipping: recipientName ? { recipientName, recipientPhone, postalCode, address1, address2, deliveryMemo } : null,
    shipments: row.shipments.map(shipmentView),
    returns: row.returns.map((r) => ({ ...r, refund: refunds.get(r.id) ?? null })),
    returnDeadline: deadline,
    returnable: row.items.map((i) => ({
      productId: i.product.id,
      variantId: i.variantId,
      variantLabel: i.variantLabel,
      name: i.variantLabel ? `${i.product.name} (${i.variantLabel})` : i.product.name,
      quantity: Math.max(0, left.get(`${i.product.id}:${i.variantKey}`) ?? left.get(i.product.id) ?? 0),
    })),
    canReturn,
    canConfirm: row.status === "delivered" && !openReturn,
  };
}

export async function customerOrderView(tx: Tx, userId: string, orderId: number, now = new Date()) {
  const row = await tx.order.findFirst({ where: { id: orderId, userId }, select: fulfillmentSelect });
  return row ? baseView(tx, row, now) : null;
}

export type AdminAction = "prepare" | "ship" | "deliver" | "cancel";

export async function adminOrderView(tx: Tx, orderId: number, now = new Date()) {
  const row = await tx.order.findUnique({ where: { id: orderId }, select: fulfillmentSelect });
  if (!row) return null;
  const view = await baseView(tx, row, now);
  const exchangeShipped = new Set(row.shipments.map((s) => s.returnId).filter((id) => id !== null));
  return {
    ...view,
    // 지금 상태에서 관리자에게 허용된 동작만(화면은 이것만 보인다)
    actions: allowedEvents(row.status as OrderStatus, "admin") as AdminAction[],
    returns: view.returns.map((r) => ({
      ...r,
      actions: [
        ...(nextReturnStatus(r.status, "approve", "admin").ok ? ["approve", "reject"] : []),
        ...(r.kind === "exchange" && r.status === "approved" && !exchangeShipped.has(r.id) ? ["ship"] : []),
      ],
    })),
  };
}
