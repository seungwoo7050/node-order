"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/lib/api-client";
import { useProfile } from "@/lib/use-profile";

const NAV_ITEMS = [
  { href: "/admin", label: "대시보드", exact: true },
  { href: "/admin/products", label: "상품 관리" },
  { href: "/admin/categories", label: "카테고리 관리" },
  { href: "/admin/coupons", label: "쿠폰 관리" },
  { href: "/admin/reviews", label: "리뷰 관리" },
  { href: "/admin/orders", label: "주문 관리" },
  { href: "/admin/users", label: "회원 관리" },
  { href: "/admin/reconciliation", label: "PG 대사" },
  { href: "/admin/settings", label: "상점 설정" },
  { href: "/admin/legal", label: "약관·방침" },
  { href: "/admin/mcp", label: "AI 도우미 연결(MCP)" },
  { href: "/admin/system", label: "시스템·API 금고" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
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
    <div className="min-h-screen bg-bg text-fg">
      {notification && (
        <div
          role="alert"
          data-testid="admin-notification-banner"
          className="bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium shadow sticky top-0 z-50 flex items-center justify-center gap-4"
        >
          <span>🔔 {notification}</span>
          <button
            type="button"
            className="text-xs underline cursor-pointer"
            onClick={() => setNotification(null)}
          >
            닫기
          </button>
        </div>
      )}

      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row gap-8">
          <aside
            data-testid="admin-sidebar"
            className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-line pb-6 md:pb-0 md:pr-6"
          >
            <div className="mb-6 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <Link
                  href="/shop"
                  className="font-serif text-lg font-bold tracking-tight text-fg no-underline hover:opacity-80"
                >
                  Brown Store.
                </Link>
                {/* FIRST link with name '상품' must navigate to /shop for admin-edit.spec.ts */}
                <Link
                  href="/shop"
                  className="text-xs text-muted hover:text-fg underline font-medium"
                >
                  상품
                </Link>
              </div>
              <span className="text-[11px] text-muted">관리자 워크스페이스</span>
            </div>

            <nav aria-label="관리자 메뉴" className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded px-3 py-2 text-sm font-medium transition-colors no-underline ${
                      active
                        ? "bg-neutral-200 text-fg font-semibold"
                        : "text-muted hover:bg-neutral-100 hover:text-fg"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-8 border-t border-line pt-4 text-xs text-muted flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span>
                  {profile ? (
                    <>
                      <span className="font-medium text-fg">{profile.name}</span>
                      <span className="ml-1 text-[10px] text-muted">
                        ({profile.role === "demo_admin" ? "데모 관리자" : "관리자"})
                      </span>
                    </>
                  ) : (
                    "관리자 모드"
                  )}
                </span>
                <button
                  type="button"
                  className="link-quiet cursor-pointer"
                  onClick={async () => {
                    await logout();
                    queryClient.clear();
                    router.push("/login");
                  }}
                >
                  로그아웃
                </button>
              </div>
            </div>
          </aside>

          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
