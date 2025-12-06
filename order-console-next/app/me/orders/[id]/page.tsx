"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useTRPC } from "@/lib/trpc";
import { MyOrderList } from "../my-order-list";
import { orderStatus } from "../order-status";

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  const fromCheckout = useSearchParams().get("checkout") === "success";
  const { data, isPending, error } = useQuery({
    ...trpc.me.order.queryOptions({ id }),
    refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
  });
  if (isPending) return <p>주문을 불러오는 중...</p>;
  if (error?.data?.code === "NOT_FOUND") return <p>해당 주문은 없습니다</p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <p data-testid="order-detail">
      주문 #{data.id} - {data.price.toLocaleString()}원, {new Date(data.createdAt).toISOString().slice(0, 10)} ·{" "}
      <span data-testid="order-status">{orderStatus(data)}</span>
    </p>
  );
}

export default function MyOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <main>
      <h1>내 주문</h1>
      <MyOrderDetail id={Number(id)} />
      <h2>전체</h2>
      <MyOrderList />
    </main>
  );
}