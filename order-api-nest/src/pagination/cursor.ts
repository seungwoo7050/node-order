import { BadRequestException } from "@nestjs/common";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type Page<T, C = string> = { items: T[]; nextCursor: C | null };

type OrderKey = { createdAt: Date; id: number };

export const encodeOrderCursor = (row: OrderKey) => Buffer.from(`${row.createdAt.toISOString()}_${row.id}`).toString("base64url");

export function decodeOrderCursor(cursor: string): OrderKey {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("_");
  const key = { createdAt: new Date(iso ?? ""), id: Number(id) };
  if (Number.isNaN(key.createdAt.getTime()) || !Number.isInteger(key.id)) throw new BadRequestException("cursor가 올바르지 않다");
  return key;
}

export function afterOrder(cursor: string | null | undefined) {
  if (!cursor) return {};
  const c = decodeOrderCursor(cursor);
  return { createdAt: { lte: c.createdAt }, OR: [{ createdAt: { lt: c.createdAt } }, { id: { lt: c.id } }] };
}
export const orderListOrder = [{ createdAt: "desc" }, { id: "desc" }] as const;

export function toPage<T, C>(rows: T[], limit: number, cursorOf: (last: T) => C): Page<T, C> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? cursorOf(items[items.length - 1]!) : null };
}
