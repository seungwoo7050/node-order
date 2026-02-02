"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useCartStore } from "@/lib/cart-store";
import { productListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";
import { LoadMore } from "../load-more";
import { Stepper } from "./stepper";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
function eulReul(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 === 0 ? "를" : "을";
}

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

function AddedToast({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [name, onDone]);
  return (
    <p role="status" className="sticky bottom-4 ml-auto mt-6 w-fit max-w-full bg-fg px-4 py-3 text-sm text-bg">
      {name}{eulReul(name)} 담았습니다. <Link href="/cart" className="ml-3 text-bg">장바구니 보기</Link>
    </p>
  );
}

function ProductList() {
  const trpc = useTRPC();
  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(productListOptions(trpc));
  const add = useCartStore((s) => s.add);
  const inCart = useCartStore((s) => s.items);
  const [added, setAdded] = useState<string | null>(null);
  const clearAdded = useCallback(() => setAdded(null), []);

  if (isPending) return <ProductSkeleton />;
  if (error && !data)
    return (
      <p role="alert" className="alert">
        상품을 불러오지 못했습니다.
        <span className="block text-sm text-muted">잠시 뒤 새로 고침해 주세요. ({error.message})</span>
      </p>
    );
  const products = data.pages.flatMap((page) => page.items);
  return (
    <>
      <ul className="border-t border-line">
        {products.map((p) => {
          const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
          const soldOut = p.stock === 0;
          return (
            <li key={p.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} width={64} height={64} className="size-16 object-cover" data-testid={`image-${p.id}`} />
              ) : (
                <span aria-hidden="true" className="grid size-16 place-items-center bg-surface font-serif text-xl text-faint">{p.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <p className="font-normal">{p.name}</p>
                <p className="flex flex-wrap gap-x-3 text-[0.8rem] text-muted">
                  <span className="num">{won(p.price)}</span>
                  {soldOut ? <span className="text-fg">품절</span> : <span>재고 <span className="num" data-testid={`stock-${p.id}`}>{p.stock}</span></span>}
                </p>
              </div>
              {soldOut ? (
                <button type="button" className="btn" disabled>품절</button>
              ) : quantity > 0 ? (
                <Stepper productId={p.id} name={p.name} quantity={quantity} max={p.stock} />
              ) : (
                <button type="button" className="btn" onClick={() => { add({ productId: p.id, name: p.name, price: p.price }); setAdded(p.name); }}>
                  담기
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
      fetchNextPage={fetchNextPage} loaded={products.length} pages={data.pages.length} noun="상품" />
      {added && <AddedToast name={added} onDone={clearAdded} />}
    </>
  );
}

function CartDock() {
  const items = useCartStore((s) => s.items);
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className="sticky bottom-0 border-t border-line-strong bg-bg py-3 sm:hidden">
      <div className="page flex items-center justify-between gap-3">
        <span className="text-sm"><span className="label">장바구니 <span className="num">{count}</span></span><br /><span className="num">{won(total)}</span></span>
        <Link href="/cart" className="btn no-underline">장바구니 보기</Link>
      </div>
    </div>
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
    <>
      <main className="page flex-1 pb-12 pt-2">
        <Suspense><CheckoutNotice /></Suspense>
        <h1 className="title mb-8">상품</h1>
        <section aria-label="상품 목록"><ProductList /></section>
      </main>
      <CartDock />
    </>
  );
}
