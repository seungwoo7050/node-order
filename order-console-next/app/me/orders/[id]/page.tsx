"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { myOrderListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";
import { won } from "@/lib/orders";
import { MyOrderList } from "../my-order-list";
import { OrderStatus, orderDate } from "../order-status";
import { ConfirmButton, OrderReviewSection, ReturnForm, Returns, Shipments, Timeline } from "./fulfillment";

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  const fromCheckout = useSearchParams().get("checkout") === "success";
  const { data, isPending, error } = useQuery({
    ...trpc.me.order.queryOptions({ id }),
    refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
  });
  const queryClient = useQueryClient();
  const paid = data?.paid === true;
  useEffect(() => {
    if (!fromCheckout || !paid) return;
    queryClient.setQueryData(myOrderListOptions(trpc).queryKey, (old) => old && {
      ...old,
      pages: old.pages.map((page) => ({ ...page, items: page.items.map((o) => (o.id === id ? { ...o, paid: true, status: "paid" as const } : o)) })),
    });
  }, [fromCheckout, paid, id, queryClient, trpc]);
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
        <dd className="num mb-3 sm:mb-0" data-testid="order-amount">
          {won(data.price)}
          {data.shippingFee > 0 && <span className="ml-2 text-[0.82rem] text-muted">(상품 {won(data.subtotal)} + 배송비 {won(data.shippingFee)})</span>}
        </dd>
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
        {data.shipping && (
          <>
            <dt className="text-sm text-muted">배송지</dt>
            <dd className="mb-3 text-sm sm:mb-0" data-testid="order-shipping">
              {data.shipping.recipientName} · <span className="num">{data.shipping.recipientPhone}</span>
              <br />({data.shipping.postalCode}) {data.shipping.address1} {data.shipping.address2}
              {data.shipping.deliveryMemo && <><br /><span className="text-muted">메모: {data.shipping.deliveryMemo}</span></>}
            </dd>
          </>
        )}
        <dt className="text-sm text-muted">진행</dt>
        <dd className="mb-3 sm:mb-0"><Timeline createdAt={data.createdAt} history={data.history} /></dd>
        {data.shipments.length > 0 && (
          <>
            <dt className="text-sm text-muted">송장</dt>
            <dd className="mb-3 sm:mb-0"><Shipments shipments={data.shipments} /></dd>
          </>
        )}
        {data.returns.length > 0 && (
          <>
            <dt className="text-sm text-muted">반품·교환</dt>
            <dd className="mb-3 sm:mb-0"><Returns returns={data.returns} /></dd>
          </>
        )}
      </dl>
      {waiting && <p className="mt-3 text-[0.78rem] text-muted">결제사(PG)가 결제 결과를 알려 주면 자동으로 바뀝니다. 보통 몇 초 걸립니다.</p>}
      {(data.canConfirm || data.canReturn) && (
        <div className="mt-8 grid gap-8">
          {data.canConfirm && <ConfirmButton orderId={data.id} />}
          {data.canReturn && data.returnDeadline && (
            <section>
              <h2 className="subtitle mb-3">반품·교환 신청</h2>
              <ReturnForm orderId={data.id} returnable={data.returnable} deadline={data.returnDeadline} returnShippingFee={data.returnShippingFee} />
            </section>
          )}
        </div>
      )}
      {data.status === "confirmed" && (
        <OrderReviewSection orderId={data.id} items={data.items} reviews={(data as { reviews?: { id: number; productId: number; rating: number; content: string; createdAt: string }[] }).reviews} />
      )}
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
