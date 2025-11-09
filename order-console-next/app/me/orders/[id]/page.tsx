"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ApiError, authFetch } from "@/lib/api-client";
import { MyOrderList, type MyOrder } from "../my-order-list";

function MyOrderDetail({ id }: { id: number }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["my-order", id],
    queryFn: () => authFetch<MyOrder>(`/me/orders/${id}`),
  });
  if (isPending) return <p>주문을 불러오는 중...</p>;
  if (error instanceof ApiError && error.status === 404) return <p>해당 주문은 없습니다</p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <p data-testid="order-detail">
      주문 #{data.id} - {data.price.toLocaleString()}원, {new Date(data.createdAt).toISOString().slice(0, 10)}
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