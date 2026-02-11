"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { myOrderListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";
import { LoadMore } from "../../load-more";
import { OrderStatus, orderDate } from "./order-status";

export function MyOrderList() {
  const trpc = useTRPC();
  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(myOrderListOptions(trpc));

  if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
  if (error?.data?.code === "UNAUTHORIZED")
    return <p role="alert" className="note">주문을 보려면 <Link href="/login">로그인</Link>해 주세요.</p>;
  if (error && !data) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
  const orders = data.pages.flatMap((p) => p.items);
  if (orders.length === 0)
    return (
      <p className="border-y border-line py-8 text-sm text-muted" data-testid="my-orders">
        <span className="mb-1 block font-serif font-normal text-fg">아직 주문이 없습니다</span>
        <Link href="/shop">상품</Link>에서 담고 결제하면 여기에 쌓입니다.
      </p>
    );
  return (
    <>
      <ul data-testid="my-orders" className="border-t border-line">
        {orders.map((o) => (
          <li key={o.id} className="border-b border-line">
            <Link href={`/me/orders/${o.id}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 no-underline sm:grid-cols-[5rem_minmax(0,1fr)_auto_11rem]">
              <span className="num order-1 text-sm text-muted sm:order-none">#{o.id}</span>
              <span className="num order-3 text-sm text-muted sm:order-none">{orderDate(o.createdAt)}</span>
              <span className="num order-2 text-right sm:order-none">{o.price.toLocaleString("ko-KR")}원</span>
              <span className="order-4 text-right sm:order-none sm:text-left"><OrderStatus order={o} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
        fetchNextPage={fetchNextPage} loaded={orders.length} pages={data.pages.length} noun="주문" />
    </>
  );
}
