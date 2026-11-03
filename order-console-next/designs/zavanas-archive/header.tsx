"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HeaderDesignProps } from "../types";
import styles from "./zavanas-archive.module.css";

export type ZavanasArchiveHeaderProps = HeaderDesignProps;

export function ZavanasArchiveHeader({
  storeName,
  announcementText,
  cartCount,
  loggedIn,
  onLogout,
  linkFor = (href: string) => href,
}: HeaderDesignProps) {
  const pathname = usePathname();

  return (
    <header data-store-design="zavanas-archive" className={styles.header}>
      {announcementText && (
        <aside data-testid="announcement-bar" className={styles.announce}>
          {announcementText}
        </aside>
      )}

      <div className={styles.util}>
        <div className={styles.wrap}>
          <div className={styles.utilInner}>
            <nav aria-label="주요 메뉴" className={styles.utilNav}>
              <Link
                href={linkFor("/shop")}
                className={styles.utilLink}
                aria-current={pathname === "/shop" ? "page" : undefined}
              >
                상품
              </Link>
              {loggedIn ? (
                <>
                  <Link
                    href={linkFor("/me/orders")}
                    className={styles.utilLink}
                    aria-current={
                      pathname.startsWith("/me/orders") ? "page" : undefined
                    }
                  >
                    내 주문
                  </Link>
                  <Link
                    href={linkFor("/me/profile")}
                    className={styles.utilLink}
                    aria-current={
                      pathname.startsWith("/me/profile") ? "page" : undefined
                    }
                  >
                    내 정보
                  </Link>
                  <button
                    type="button"
                    onClick={onLogout}
                    className={styles.logoutBtn}
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href={linkFor("/guest/orders")}
                    className={styles.utilLink}
                    aria-current={
                      pathname.startsWith("/guest/orders") ? "page" : undefined
                    }
                  >
                    비회원 주문
                  </Link>
                  <Link
                    href={linkFor("/login")}
                    className={styles.utilLink}
                    aria-current={
                      pathname.startsWith("/login") ? "page" : undefined
                    }
                  >
                    로그인
                  </Link>
                </>
              )}
            </nav>

            <div className={styles.utilRight}>
              <Link
                href={linkFor("/cart")}
                data-testid="cart-count"
                className={styles.cartCount}
              >
                장바구니 {cartCount}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.brandRow}>
        <Link
          href={linkFor("/shop")}
          data-testid="header-store-name"
          className={styles.brand}
        >
          {storeName}
        </Link>
      </div>
    </header>
  );
}

export { ZavanasArchiveHeader as Header };
