"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { logout } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCartStore } from "@/lib/cart-store";
import { useCanSeeAdmin } from "@/lib/use-profile";

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
  const queryClient = useQueryClient();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  const canSeeAdmin = useCanSeeAdmin();

  return (
    <header className="page flex flex-wrap items-baseline gap-x-6 gap-y-2 py-4 sm:py-6">
      <Link href="/shop" className="mr-auto font-serif text-base no-underline">Brown Store.</Link>
      <nav aria-label="주요 메뉴" className="flex items-baseline gap-5">
        <NavLink href="/shop">상품</NavLink>
        <NavLink href="/me/orders">내 주문</NavLink>
        {canSeeAdmin && <NavLink href="/admin/products">관리</NavLink>}
        <NavLink href="/cart" testId="cart-count">장바구니 <span className="num">{cartCount}</span></NavLink>
        {loggedIn ? (
          <button type="button" className="text-sm text-muted cursor-pointer" onClick={async () => {
            await logout();
            queryClient.clear();
            router.push("/login");
          }}>
            로그아웃
          </button>
        ) : (
          <NavLink href="/login">로그인</NavLink>
        )}
      </nav>
    </header>

  );
}
