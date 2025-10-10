"use client";

import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";

export function Nav() {
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));

  return (
    <nav style={{ display: "flex", gap: 12 }}>
      <Link href="/orders">주문 목록</Link>
      <Link href="/shop">상품</Link>
      <Link href="/me/orders">내 주문</Link>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
    </nav>
  );
}