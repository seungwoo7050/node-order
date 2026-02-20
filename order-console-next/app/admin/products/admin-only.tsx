"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { useTRPC } from "@/lib/trpc";

const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

export function AdminOnly({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const { data: profile, isPending, error } = useQuery({ ...trpc.me.profile.queryOptions(), retry: false });
  if (isPending) return <p role="status" className="text-sm text-muted">확인하는 중입니다.</p>;
  if (error?.data?.code === "UNAUTHORIZED") return <p className="note">관리자 계정으로 <Link href="/login">로그인</Link>해 주세요.</p>;
  if (error) return <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
  if (profile.role !== "admin" && profile.role !== "demo_admin") return <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
  const readOnly = profile.role === "demo_admin";
  return (
    <ReadOnly value={readOnly}>
      {readOnly ? (
        <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
          데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기, 재고 조정, 상품 수정은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.
        </p>
      ) : (
        <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
      )}
      {children}
    </ReadOnly>
  );
}
