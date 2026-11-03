"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { StoreHeader } from "@/designs/registry";
import { StoreNavLink } from "@/designs/shared/nav-link";
import {
  resolveActiveDesign,
  type StoreDesignId,
} from "@/designs/types";
import { logout } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCartStore } from "@/lib/cart-store";
import {
  restoreSessionDesign,
  useDesignStore,
  useLinkFor,
} from "@/lib/design-store";
import { storeInfoOptions } from "@/lib/store-info";
import { useCanSeeAdmin } from "@/lib/use-profile";
import styles from "./nav.module.css";

export function Nav({ defaultDesign }: { defaultDesign?: StoreDesignId }) {
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
  const linkFor = useLinkFor();

  useEffect(() => {
    restoreSessionDesign();
  }, []);

  const activeDesign = resolveActiveDesign(
    overrideDesign,
    storeInfo?.storeDesign,
    defaultDesign,
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.storeDesign = activeDesign;
    }
  }, [activeDesign]);

  if (pathname.startsWith("/admin")) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <>
      <StoreHeader
        design={activeDesign}
        storeName={storeInfo?.storeName ?? "Store"}
        announcementText={storeInfo?.announcementText}
        cartCount={cartCount}
        loggedIn={loggedIn}
        onLogout={handleLogout}
        linkFor={linkFor}
      />

      {canSeeAdmin && (
        <aside
          data-testid="admin-floating-badge"
          className={styles.adminFloatingBadge}
        >
          <span className={styles.adminFloatingTitle}>스토어 관리</span>
          <StoreNavLink href="/admin" exact>
            대시보드
          </StoreNavLink>
          <span className={styles.adminFloatingSep}>|</span>
          <StoreNavLink href="/admin/products">관리</StoreNavLink>
          <span className={styles.adminFloatingSep}>|</span>
          <StoreNavLink href="/admin/orders">주문 처리</StoreNavLink>
        </aside>
      )}
    </>
  );
}
