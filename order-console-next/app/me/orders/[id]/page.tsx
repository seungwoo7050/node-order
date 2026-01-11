"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTRPC } from "@/lib/trpc";
import { MyOrderList } from "../my-order-list";
import { OrderStatus, orderDate } from "../order-status";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  const fromCheckout = useSearchParams().get("checkout") === "success";
  const { data, isPending, error } = useQuery({
    ...trpc.me.order.queryOptions({ id }),
    refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
  });
  if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
  if (error?.data?.code === "NOT_FOUND") return <p className="note">주문 #{id}을 찾을 수 없습니다.</p>;
  if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
  const waiting = fromCheckout && !data.paid && !data.canceledAt;
  return (
    <section data-testid="order-detail" className="mb-12">
      <p className="label mb-1"><Link href="/me/orders">내 주문</Link> / #{data.id}</p>
      <h1 className="title mb-8">주문 #{data.id}</h1>
      <dl className="grid items-baseline gap-x-8 gap-y-1 border-y border-line py-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-3">
        <dt className="text-sm text-muted">상태</dt>
        <dd className="mb-3 sm:mb-0">
          {waiting ? (
            <span role="status" className="inline-flex items-center gap-2 text-sm text-wait" data-testid="order-status">
              <span aria-hidden="true" className="size-2.5 animate-spin rounded-full border border-wait border-t-transparent" />
              결제를 확인하는 중입니다
            </span>
          ) : (
            <OrderStatus order={data} testId="order-status" />
          )}
        </dd>
        <dt className="text-sm text-muted">금액</dt>
        <dd className="num mb-3 sm:mb-0">{won(data.price)}</dd>
        <dt className="text-sm text-muted">주문일</dt>
        <dd className="num mb-3 sm:mb-0">{orderDate(data.createdAt)}</dd>
        <dt className="text-sm text-muted">상품</dt>
        <dd>
          <ul className="grid max-w-md gap-y-1">
            {data.items.map((it) => (
              <li key={it.product.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6">
                <span>{it.product.name}</span>
                <span className="num text-right text-muted">{won(it.unitPrice)} × {it.quantity}</span>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      {waiting && <p className="mt-3 text-[0.78rem] text-muted">Stripe가 결제 결과를 알려 주면 자동으로 바뀝니다. 보통 몇 초 걸립니다.</p>}
    </section>
  );
}

export default function MyOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="page flex-1 pb-12 pt-2">
      <MyOrderDetail id={Number(id)} />
      <h2 className="subtitle mb-4">전체 주문</h2>
      <MyOrderList />
    </main>
  );
}
