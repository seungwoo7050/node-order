"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc";

export function MyOrderList() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.me.orders.queryOptions());

  if (isPending) return <p>내 주문을 불러오는 중...</p>;
  if (error?.data?.code === "UNAUTHORIZED") return <p role="alert">로그인이 필요합니다. <Link href="/login">로그인</Link></p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <ul data-testid="my-orders">
      {data.map((o) => (
        <li key={o.id}>
          <Link href={`/me/orders/${o.id}`}>#{o.id} - {o.price.toLocaleString()}원</Link>
        </li>
      ))}
    </ul>
  );
}
