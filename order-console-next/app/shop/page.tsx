"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StorefrontCatalog } from "@/designs/registry";
import { useCartStore } from "@/lib/cart-store";
import { won } from "@/lib/storefront-view-model";
import styles from "./shop-page.module.css";

function CartDock() {
  const items = useCartStore((s) => s.items);
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className={styles.cartDock}>
      <div className={`storefront-container ${styles.cartDockInner}`}>
        <span className={styles.cartDockSummary}>
          <span className={styles.cartDockLabel}>
            장바구니 <span className={styles.cartDockNum}>{count}</span>
          </span>
          <br />
          <span className={styles.cartDockNum}>{won(total)}</span>
        </span>
        <Link href="/cart" className={styles.cartDockBtn}>
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
    <div className={`storefront-container ${styles.checkoutNotice}`}>
      <p role="status" className={styles.noticeNote}>
        결제를 취소했습니다.{" "}
        {order ? (
          <>
            주문 <Link href={`/me/orders/${order}`}>#{order}</Link>은
          </>
        ) : (
          "방금 만든 주문은"
        )}{" "}
        결제 대기로 남아 있다가 24시간이 지나면 자동으로 취소되고, 담았던 수량은 재고로
        돌아갑니다.
      </p>
    </div>
  );
}

export default function ShopPage() {
  return (
    <>
      <main className={styles.main}>
        <Suspense fallback={null}>
          <CheckoutNotice />
        </Suspense>
        <section aria-label="상품 목록" className={styles.catalogSection}>
          <StorefrontCatalog />
        </section>
      </main>
      <CartDock />
    </>
  );
}
