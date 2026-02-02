import type { useTRPC } from "./trpc";

type Trpc = ReturnType<typeof useTRPC>;
export const PAGE_SIZE = 20;

export const productListOptions = (trpc: Trpc) =>
  trpc.products.list.infiniteQueryOptions({ limit: PAGE_SIZE }, { getNextPageParam: (last) => last.nextCursor });

export const myOrderListOptions = (trpc: Trpc) =>
  trpc.me.orders.infiniteQueryOptions({ limit: PAGE_SIZE }, { getNextPageParam: (last) => last.nextCursor });
