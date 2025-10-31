"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCartStore } from "@/lib/cart-store";

export function Nav() {
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const router = useRouter();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);

  return (
    <nav className="flex gap-3">
      <Link href="/orders">주문 목록</Link>
      <Link href="/shop">상품</Link>
      <Link href="/me/orders">내 주문</Link>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
      {loggedIn ? (
        <button onClick={async () => { await logout(); router.push("/login"); }}>로그아웃</button>
      ) : (
        <Link href="/login">로그인</Link>
      )}
    </nav>
  );
}