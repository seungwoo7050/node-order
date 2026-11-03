"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCartStore } from "@/lib/cart-store";
import { won } from "@/lib/storefront-view-model";
import { StorefrontCatalog } from "@/designs/registry";

function CartDock() {
  const items = useCartStore((s) => s.items);
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className="sticky bottom-0 border-t border-line-strong bg-bg py-3 sm:hidden z-40">
      <div className="page flex items-center justify-between gap-3">
        <span className="text-sm">
          <span className="label">장바구니 <span className="num">{count}</span></span>
          <br />
          <span className="num">{won(total)}</span>
        </span>
        <Link href="/cart" className="btn no-underline">
          장바구니 보기
        </Link>
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
        <Suspense fallback={null}>
          <CheckoutNotice />
        </Suspense>
        <section aria-label="상품 목록">
          <StorefrontCatalog />
        </section>
      </main>
      <CartDock />
    </>
  );
}
