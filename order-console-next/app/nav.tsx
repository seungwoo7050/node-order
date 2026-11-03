"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { resolveActiveDesign } from "@/designs/types";
import { logout } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCartStore } from "@/lib/cart-store";
import { useDesignStore } from "@/lib/design-store";
import { storeInfoOptions } from "@/lib/store-info";
import { useCanSeeAdmin } from "@/lib/use-profile";
import styles from "./nav.module.css";

function NavLink({
  href,
  children,
  testId,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={current ? "page" : undefined}
      className="text-xs sm:text-[13px] tracking-[0.04em] text-muted no-underline transition-colors hover:text-fg aria-[current=page]:text-fg aria-[current=page]:font-medium aria-[current=page]:underline aria-[current=page]:underline-offset-[6px]"
    >
      {children}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const cartCount = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.quantity, 0),
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  const canSeeAdmin = useCanSeeAdmin();
  const { data: storeInfo } = useQuery(storeInfoOptions);
  const overrideDesign = useDesignStore((s) => s.overrideDesign);

  const storeName = storeInfo?.storeName ?? "Store";
  const announcementText = storeInfo?.announcementText;
  const activeDesign = resolveActiveDesign(
    overrideDesign,
    storeInfo?.storeDesign,
  );

  useEffect(() => {
    document.documentElement.dataset.storeDesign = activeDesign;
  }, [activeDesign]);

  if (pathname.startsWith("/admin")) {
    return null;
  }

  const isMuji = activeDesign === "muji-hara";
  const isZavanas = activeDesign === "zavanas-archive";

  const announcementClass = isMuji
    ? styles.announcementMuji
    : isZavanas
      ? styles.announcementZavanas
      : styles.announcementEditorial;

  const headerClass = isMuji
    ? styles.headerMuji
    : isZavanas
      ? styles.headerZavanas
      : styles.headerEditorial;

  const brandClass = isMuji
    ? styles.brandMuji
    : isZavanas
      ? styles.brandZavanas
      : styles.brandEditorial;

  return (
    <>
      {announcementText && (
        <aside
          data-testid="announcement-bar"
          className={`w-full text-center py-2 px-4 text-[11px] tracking-[0.14em] uppercase ${announcementClass}`}
        >
          {announcementText}
        </aside>
      )}

      <header data-store-design={activeDesign} className={`w-full ${headerClass}`}>
        <div className="storefront-container flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            {isMuji && <span aria-hidden="true" className={styles.mujiMark} />}
            {isZavanas && (
              <span aria-hidden="true" className={styles.zavanasPlaque}>
                <span className={styles.zavanasDot} />
                SYS.36
              </span>
            )}
            <Link
              href="/shop"
              data-testid="header-store-name"
              className={`text-xl sm:text-2xl text-fg no-underline ${brandClass}`}
            >
              {storeName}
            </Link>
          </div>

          <nav
            aria-label="주요 메뉴"
            className={`flex flex-wrap items-center gap-5 sm:gap-7 ${
              isZavanas ? styles.navZavanas : ""
            }`}
          >
            <NavLink href="/shop">상품</NavLink>
            {loggedIn ? (
              <>
                <NavLink href="/me/orders">내 주문</NavLink>
                <NavLink href="/me/profile">내 정보</NavLink>
              </>
            ) : (
              <NavLink href="/guest/orders">비회원 주문</NavLink>
            )}
            <NavLink href="/cart" testId="cart-count">
              장바구니 <span className="num font-medium">{cartCount}</span>
            </NavLink>
            {loggedIn ? (
              <button
                type="button"
                className="text-xs sm:text-[13px] tracking-[0.04em] text-muted hover:text-fg cursor-pointer"
                onClick={async () => {
                  await logout();
                  queryClient.clear();
                  router.push("/login");
                }}
              >
                로그아웃
              </button>
            ) : (
              <NavLink href="/login">로그인</NavLink>
            )}
          </nav>
        </div>
      </header>

      {canSeeAdmin && (
        <aside
          data-testid="admin-floating-badge"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-line-strong bg-bg/95 px-3.5 py-1.5 shadow-lg backdrop-blur text-xs"
        >
          <span className="font-semibold text-muted mr-1">스토어 관리</span>
          <NavLink href="/admin" exact>
            대시보드
          </NavLink>
          <span className="text-line-strong">|</span>
          <NavLink href="/admin/products">관리</NavLink>
          <span className="text-line-strong">|</span>
          <NavLink href="/admin/orders">주문 처리</NavLink>
        </aside>
      )}
    </>
  );
}
