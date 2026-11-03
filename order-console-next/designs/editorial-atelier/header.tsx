"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HeaderDesignProps } from "../types";
import styles from "./editorial-atelier.module.css";

export function EditorialAtelierHeader({
  storeName,
  announcementText,
  cartCount,
  loggedIn,
  onLogout,
  linkFor,
}: HeaderDesignProps) {
  const pathname = usePathname();
  const getHref = linkFor ?? ((h: string) => h);

  return (
    <>
      {announcementText && (
        <aside
          data-testid="announcement-bar"
          className={styles.announce}
        >
          {announcementText}
        </aside>
      )}

      <header
        data-store-design="editorial-atelier"
        className={styles.header}
      >
        <Link
          href={getHref("/shop")}
          data-testid="header-store-name"
          className={styles.wordmark}
        >
          {storeName}
        </Link>

        <nav aria-label="주요 메뉴" className={styles.nav}>
          <Link
            href={getHref("/shop")}
            aria-current={pathname === "/shop" ? "page" : undefined}
            className={styles.navLink}
          >
            상품
          </Link>

          {loggedIn ? (
            <>
              <Link
                href={getHref("/me/orders")}
                aria-current={
                  pathname.startsWith("/me/orders") ? "page" : undefined
                }
                className={styles.navLink}
              >
                내 주문
              </Link>
              <Link
                href={getHref("/me/profile")}
                aria-current={
                  pathname.startsWith("/me/profile") ? "page" : undefined
                }
                className={styles.navLink}
              >
                내 정보
              </Link>
            </>
          ) : (
            <Link
              href={getHref("/guest/orders")}
              aria-current={
                pathname.startsWith("/guest/orders") ? "page" : undefined
              }
              className={styles.navLink}
            >
              비회원 주문
            </Link>
          )}

          <Link
            href={getHref("/cart")}
            data-testid="cart-count"
            aria-current={pathname === "/cart" ? "page" : undefined}
            className={styles.navLink}
          >
            장바구니 <span>{cartCount}</span>
          </Link>

          {loggedIn ? (
            <button
              type="button"
              onClick={onLogout}
              className={styles.logoutBtn}
            >
              로그아웃
            </button>
          ) : (
            <Link
              href={getHref("/login")}
              aria-current={pathname === "/login" ? "page" : undefined}
              className={styles.navLink}
            >
              로그인
            </Link>
          )}
        </nav>
      </header>
    </>
  );
}

export default EditorialAtelierHeader;
