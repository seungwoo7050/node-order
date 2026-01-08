"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { logout } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCartStore } from "@/lib/cart-store";

function NavLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  const current = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={current ? "page" : undefined}
      className="text-sm text-muted no-underline aria-[current=page]:text-fg aria-[current=page]:underline aria-[current=page]:underline-offset-[6px]"
    >
      {children}
    </Link>
  );
}

export function Nav() {
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const router = useRouter();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);

  return (
    <nav className="flex gap-3">
      <NavLink href="/shop">상품</NavLink>
      <NavLink href="/me/orders">내 주문</NavLink>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
      {loggedIn ? (
        <button onClick={async () => { await logout(); router.push("/login"); }}>로그아웃</button>
      ) : (
        <Link href="/login">로그인</Link>
      )}
    </nav>
  );
}
