"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, authFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";
import { useIsAdmin } from "@/lib/use-profile";
import { useOnline } from "../online-banner";
import { useTRPC } from "@/lib/trpc";
import { ProductImageUploader } from "./product-image-uploader";

type CheckoutResult = { id: number; price: number; checkoutUrl: string };

function ProductSkeleton() {
  return (
    <div aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-line py-4">
          <span className="size-16 bg-surface" />
          <span className="grid gap-2"><span className="h-3 w-2/5 bg-surface" /><span className="h-3 w-1/4 bg-surface" /></span>
        </div>
      ))}
      <p role="status" className="mt-4 text-sm text-muted">상품을 불러오는 중입니다.</p>
    </div>
  );
}

function ProductList() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
  const add = useCartStore((s) => s.add);
  const isAdmin = useIsAdmin();

  if (isPending) return <ProductSkeleton />;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.name} width={48} height={48} data-testid={`image-${p.id}`} />
          )}
          {p.name} - {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
          <button disabled={p.stock === 0} onClick={() => add({ productId: p.id, name: p.name, price: p.price })}>
            담기
          </button>
          {isAdmin && <ProductImageUploader productId={p.id} />}
        </li>
      ))}
    </ul>
  );
}

function CartPanel() {
  const trpc = useTRPC();
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const online = useOnline();
  const queryClient = useQueryClient();

  const checkout = useMutation({
    mutationFn: () => {
      const key = useCartStore.getState().beginCheckout();
      return authFetch<CheckoutResult>("/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }),
      });
    },
    onSuccess: (data) => {
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
      window.location.assign(data.checkoutUrl);
    },
  });

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return (
    <section>
      <h2>장바구니</h2>
      {items.length === 0 && <p>비어 있습니다</p>}
      <ul>
        {items.map((i) => (
          <li key={i.productId}>
            {i.name} × {i.quantity} <button onClick={() => remove(i.productId)}>빼기</button>
          </li>
        ))}
      </ul>
      <p>합계 {total.toLocaleString()}원</p>
      <button disabled={items.length === 0 || checkout.isPending || !online} onClick={() => checkout.mutate()}>
        {checkout.isPending ? "결제 중..." : "결제"}
      </button>
      {checkout.isSuccess && <p role="status">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중...</p>}
      {checkout.error && (
        <p role="alert">
          결제 실패: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> - <Link href="/login">로그인</Link></>}
        </p>
      )}
    </section>
  );
}

function CheckoutNotice() {
  const params = useSearchParams();
  if (params.get("checkout") !== "canceled") return null;
  const order = params.get("order");
  return (
    <p role="status" className="note mb-8">
      결제를 취소했습니다. {order ? <>주문 <Link href={`/me/orders/${order}`}>#{order}</Link>은</> : "방금 만든 주문은"} 결제 대기로 남아 있다가 24시간이 지나면
      자동으로 취소되고, 담았던 수량은 재고로 돌아갑니다.
    </p>
  );
}

export default function ShopPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <Suspense><CheckoutNotice /></Suspense>
      <h1 className="title mb-8">상품</h1>
      <section aria-label="상품 목록"><ProductList /></section>
      <CartPanel />
    </main>
  );
}