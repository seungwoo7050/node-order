"use client";

import { StoreNavLink } from "../shared/nav-link";
import type { HeaderDesignProps } from "../types";
import styles from "./muji-hara.module.css";

export function MujiHaraHeader({
  storeName,
  announcementText,
  cartCount,
  loggedIn = false,
  onLogout,
  linkFor,
}: HeaderDesignProps) {
  const toHref = linkFor ?? ((h: string) => h);

  return (
    <header className={styles.headerRoot} data-store-design="muji-hara">
      {announcementText && (
        <aside data-testid="announcement-bar" className={styles.announce}>
          {announcementText}
        </aside>
      )}
      <div className={styles.header}>
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <div className={styles.headerLeft}>
            <StoreNavLink
              href={toHref("/shop")}
              exact
              testId="header-store-name"
              className={styles.brand}
            >
              {storeName}
            </StoreNavLink>
            <nav className={styles.nav} aria-label="메인 메뉴">
              <StoreNavLink
                href={toHref("/shop")}
                className={styles.navLink}
              >
                상품
              </StoreNavLink>
            </nav>
          </div>
          <div className={styles.rightNav}>
            {loggedIn ? (
              <>
                <StoreNavLink
                  href={toHref("/orders")}
                  className={styles.navLink}
                >
                  내 주문
                </StoreNavLink>
                <StoreNavLink
                  href={toHref("/profile")}
                  exact
                  className={styles.navLink}
                >
                  내 정보
                </StoreNavLink>
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
                <StoreNavLink
                  href={toHref("/order-lookup")}
                  exact
                  className={styles.navLink}
                >
                  비회원 주문
                </StoreNavLink>
                <StoreNavLink
                  href={toHref("/login")}
                  exact
                  className={styles.navLink}
                >
                  로그인
                </StoreNavLink>
              </>
            )}
            <StoreNavLink
              href={toHref("/cart")}
              exact
              testId="cart-count"
              className={styles.cartLink}
            >
              {"장바구니 "}
              <span className={styles.badge}>{cartCount}</span>
            </StoreNavLink>
          </div>
        </div>
      </div>
    </header>
  );
}
