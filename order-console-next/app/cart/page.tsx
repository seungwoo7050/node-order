"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";
import { productListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";
import { useOnline } from "../online-banner";
import { Stepper } from "../shop/stepper";

type CheckoutResult = { id: number; price: number; checkoutUrl: string };

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const online = useOnline();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { data: products } = useInfiniteQuery(productListOptions(trpc));
  const stockOf = (productId: number) => products?.pages.flatMap((p) => p.items).find((p) => p.id === productId)?.stock ?? Infinity;

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
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
      window.location.assign(data.checkoutUrl);
    },
  });

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">장바구니</h1>
      {items.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-muted">
          <span className="mb-1 block font-serif font-normal text-fg">비어 있습니다</span>
          <Link href="/shop">상품</Link>에서 담으면 여기에 모입니다.
        </p>
      ) : (
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ul className="border-t border-line">
            {items.map((i) => (
              <li key={i.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto_7rem]">
                <div className="min-w-0">
                  <p className="font-normal">{i.name}</p>
                  <p className="num text-[0.8rem] text-muted">{won(i.price)}</p>
                </div>
                <span className="num text-right sm:order-last">{won(i.price * i.quantity)}</span>
                <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                  <Stepper productId={i.productId} name={i.name} quantity={i.quantity} max={stockOf(i.productId)} />
                  <button type="button" className="link-quiet" onClick={() => remove(i.productId)}>빼기</button>
                </span>
              </li>
            ))}
          </ul>
          <aside aria-label="결제" className="lg:sticky lg:top-6">
            <p className="mb-5 flex items-baseline justify-between">
              <span className="label">합계</span>
              <span className="num text-xl font-normal">{won(total)}</span>
            </p>
            <button type="button" className="btn btn-primary w-full" disabled={checkout.isPending || !online} onClick={() => checkout.mutate()}>
              {checkout.isPending ? "결제 화면을 여는 중…" : "결제하기"}
            </button>
            <p className="mt-3 text-[0.78rem] text-muted">
              {online ? "결제는 Stripe 화면에서 이어집니다. 24시간 안에 결제하지 않으면 주문이 취소됩니다." : "연결되면 결제할 수 있습니다."}
            </p>
          </aside>
        </div>
      )}
      {checkout.isSuccess && <p role="status" className="mt-4 text-sm">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중입니다.</p>}
      {checkout.error && (
        <p role="alert" className="alert mt-4">
          결제를 시작하지 못했습니다: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> - <Link href="/login">로그인</Link>해 주세요.</>}
        </p>
      )}
    </main>
  );
}
