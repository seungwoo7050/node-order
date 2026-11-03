"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function StoreNavLink({
  href,
  exact = false,
  className,
  testId,
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const currentPath = usePathname();
  const targetPath = href.split("?")[0] || href;
  const isCurrent =
    exact || targetPath === "/"
      ? currentPath === targetPath
      : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);

  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={isCurrent ? "page" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}
