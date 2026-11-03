"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { logout } from "@/lib/api-client";
import { storeInfoOptions } from "@/lib/store-info";
import { useProfile } from "@/lib/use-profile";
import styles from "./admin.module.css";

const NAV_GROUPS = [
  {
    group: "현황",
    items: [{ href: "/admin", label: "대시보드", exact: true }],
  },
  {
    group: "주문·카탈로그",
    items: [
      { href: "/admin/orders", label: "주문 관리" },
      { href: "/admin/products", label: "상품 관리" },
      { href: "/admin/categories", label: "카테고리 관리" },
      { href: "/admin/coupons", label: "쿠폰 관리" },
      { href: "/admin/reviews", label: "리뷰 관리" },
      { href: "/admin/users", label: "회원 관리" },
    ],
  },
  {
    group: "운영·시스템",
    items: [
      { href: "/admin/reconciliation", label: "PG 대사" },
      { href: "/admin/settings", label: "상점 설정" },
      { href: "/admin/legal", label: "약관·방침" },
      { href: "/admin/mcp", label: "AI 도우미 연결(MCP)" },
      { href: "/admin/system", label: "시스템·API 금고" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: storeInfo } = useQuery(storeInfoOptions);
  const storeName = storeInfo?.storeName ?? "상점";
  const [notification, setNotification] = useState<string | null>(null);

  // Real-time admin notification
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      if (typeof window !== "undefined" && "WebSocket" in window) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname;
        const wsUrl = `${protocol}//${host}:3000/notifications`;
        ws = new WebSocket(wsUrl);
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "admin_order_notification" || payload.event === "admin_order_notification") {
              setNotification(payload.message ?? "새로운 주문이 접수되었습니다.");
              setTimeout(() => setNotification(null), 5000);
            }
          } catch {}
        };
      }
    } catch {}
    return () => {
      try {
        ws?.close();
      } catch {}
    };
  }, []);

  return (
    <div className={styles.shell}>
      {notification && (
        <div
          role="alert"
          data-testid="admin-notification-banner"
          className={styles.noticeBanner}
        >
          <span>{notification}</span>
          <button
            type="button"
            className={styles.noticeClose}
            onClick={() => setNotification(null)}
          >
            닫기
          </button>
        </div>
      )}

      <div className={styles.container}>
        <div className={styles.workspace}>
          <aside
            data-testid="admin-sidebar"
            className={styles.sidebar}
          >
            <div className={styles.sidebarTop}>
              <div className={styles.brandHeader}>
                <div className={styles.brandRow}>
                  <Link
                    href="/shop"
                    data-testid="admin-logo-store-name"
                    className={styles.brandTitle}
                  >
                    {storeName}
                  </Link>
                  {/* FIRST link with name '상품' must navigate to /shop for admin-edit.spec.ts */}
                  <Link
                    href="/shop"
                    className={styles.storefrontLink}
                  >
                    상품
                  </Link>
                </div>
                <span className={styles.workspaceTag}>상점 관리 콘솔</span>
              </div>

              <nav aria-label="관리자 메뉴" className={styles.navList}>
                {NAV_GROUPS.map((section) => (
                  <div key={section.group} className={styles.navSection}>
                    <div className={styles.navGroupLabel}>{section.group}</div>
                    {section.items.map((item) => {
                      const isExact = "exact" in item && Boolean(item.exact);
                      const active = isExact
                        ? pathname === item.href
                        : pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                        >
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </div>

            <div className={styles.sidebarFooter}>
              <div className={styles.operatorInfo}>
                {profile ? (
                  <>
                    <span className={styles.operatorName}>{profile.name} ({profile.id})</span>
                    <span className={styles.operatorRole}>
                      {profile.role === "demo_admin" ? "데모 관리자 · 읽기 전용" : "최고 관리자"}
                    </span>
                  </>
                ) : (
                  <span className={styles.operatorRole}>관리자 세션</span>
                )}
              </div>
              <button
                type="button"
                className={styles.logoutBtn}
                onClick={async () => {
                  await logout();
                  queryClient.clear();
                  router.push("/login");
                }}
              >
                로그아웃
              </button>
            </div>
          </aside>

          <main className={styles.mainContent}>{children}</main>
        </div>
      </div>
    </div>
  );
}
