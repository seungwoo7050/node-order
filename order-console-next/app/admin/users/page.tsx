"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { won } from "@/lib/orders";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type UserItem = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  isGuest: boolean;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
};

type UserDetail = UserItem & {
  recipientName: string | null;
  recipientPhone: string | null;
  postalCode: string | null;
  address1: string | null;
  address2: string | null;
  deliveryMemo: string | null;
  orders: {
    id: number;
    status: string;
    totalAmount: number;
    paid: boolean;
    createdAt: string;
  }[];
};

function AdminUsersContent() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [q, setQ] = useState("");
  const [filterGuest, setFilterGuest] = useState<boolean | undefined>(undefined);
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);
  const [filterOrigin, setFilterOrigin] = useState<"all" | "post_seed" | "seed_only">("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSeedAccount = (id: string) =>
    ["kim", "lee", "park", "choi"].includes(id) || id.startsWith("demo-");

  const queryParams = new URLSearchParams();
  if (q.trim()) queryParams.set("q", q.trim());
  if (filterGuest !== undefined) queryParams.set("guest", String(filterGuest));
  if (filterActive !== undefined) queryParams.set("active", String(filterActive));

  const { data: rawUsers, isPending } = useQuery<UserItem[]>({
    queryKey: ["admin-users", q, filterGuest, filterActive],
    queryFn: () => authFetch<UserItem[]>(`/admin/users?${queryParams.toString()}`),
  });
  const users = rawUsers?.filter((u) =>
    filterOrigin === "post_seed"
      ? !isSeedAccount(u.id)
      : filterOrigin === "seed_only"
        ? isSeedAccount(u.id)
        : true,
  );

  const { data: userDetail, isPending: detailPending } = useQuery<UserDetail>({
    queryKey: ["admin-user-detail", selectedUserId],
    queryFn: () => authFetch<UserDetail>(`/admin/users/${selectedUserId}`),
    enabled: !!selectedUserId,
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      setError(null);
      await authFetch(`/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      if (selectedUserId) void queryClient.invalidateQueries({ queryKey: ["admin-user-detail", selectedUserId] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "상태 변경 실패"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!confirm(`사용자 '${id}'를 삭제하시겠습니까?\n주문 내역이 있는 경우 자동으로 개인정보가 익명화 및 비활성화(정지) 처리됩니다.`)) return;
      setError(null);
      const res = await authFetch<{ anonymized?: boolean; deleted?: boolean; message: string }>(`/admin/users/${id}`, {
        method: "DELETE",
      });
      alert(res.message);
    },
    onSuccess: () => {
      setSelectedUserId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "삭제 실패"),
  });

  return (
    <>
      {/* 필터 및 검색 바 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterGuest === undefined && filterActive === undefined
                ? "bg-fg text-bg"
                : "text-muted hover:bg-neutral-100"
            }`}
            onClick={() => {
              setFilterGuest(undefined);
              setFilterActive(undefined);
            }}
          >
            전체 고객
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterGuest === false && filterActive === undefined ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
            }`}
            onClick={() => {
              setFilterGuest(false);
              setFilterActive(undefined);
            }}
          >
            가입 회원만
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterGuest === true ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
            }`}
            onClick={() => {
              setFilterGuest(true);
              setFilterActive(undefined);
            }}
          >
            비회원 주문 고객
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterActive === false ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
            }`}
            onClick={() => {
              setFilterActive(false);
              setFilterGuest(false);
            }}
          >
            정지 계정
          </button>
          <span className="mx-1 text-line">|</span>
          <button
            type="button"
            data-testid="user-origin-post-seed"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterOrigin === "post_seed"
                ? "bg-fg text-bg"
                : "border border-line bg-bg text-fg hover:bg-neutral-100"
            }`}
            onClick={() => setFilterOrigin(filterOrigin === "post_seed" ? "all" : "post_seed")}
          >
            시드 이후 유입만
          </button>
          <button
            type="button"
            data-testid="user-origin-seed-only"
            className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
              filterOrigin === "seed_only"
                ? "bg-fg text-bg"
                : "border border-line bg-bg text-fg hover:bg-neutral-100"
            }`}
            onClick={() => setFilterOrigin(filterOrigin === "seed_only" ? "all" : "seed_only")}
          >
            시드·데모 계정만
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            data-testid="user-search-input"
            placeholder="아이디, 이름, 연락처 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-line bg-bg px-3 py-1.5 text-xs rounded w-56"
          />
        </div>
      </div>

      {error && <p role="alert" className="alert mb-4">{error}</p>}

      {/* 사용자 목록 테이블 */}
      <div className="overflow-x-auto bg-white border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-neutral-50 text-xs text-muted">
              <th className="py-2.5 px-3 font-medium">아이디</th>
              <th className="py-2.5 px-3 font-medium">이름</th>
              <th className="py-2.5 px-3 font-medium">구분</th>
              <th className="py-2.5 px-3 font-medium">연락처</th>
              <th className="py-2.5 px-3 font-medium">주문 수 / 결제액</th>
              <th className="py-2.5 px-3 font-medium">계정 상태</th>
              <th className="py-2.5 px-3 text-right font-medium">관리 (상세 · 정지 · 삭제)</th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-muted">
                  사용자 목록을 불러오는 중입니다…
                </td>
              </tr>
            ) : !users || users.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 px-4 text-center text-xs text-muted space-y-2">
                  {filterGuest === true ? (
                    <div className="space-y-2">
                      <p className="font-medium text-fg">현재 누적된 비회원 주문 고객이 없습니다.</p>
                      <p>
                        비회원이 장바구니에서 주문을 접수하면 수령인·연락처 기준 고객 레코드(<code>guest-*</code>)가 자동 생성되어 이곳에서 누적 주문 수와 결제액을 조회할 수 있습니다.
                      </p>
                      <p>
                        <Link href="/admin/orders" className="underline text-fg font-medium">
                          주문 관리 (/admin/orders)에서 비회원 주문 조회하기 →
                        </Link>
                      </p>
                    </div>
                  ) : filterActive === false ? (
                    <div className="space-y-1.5">
                      <p className="font-medium text-fg">현재 로그인 정지된 회원 계정이 없습니다.</p>
                      <p>
                        회원 목록 우측 <strong>[계정 정지]</strong> 버튼을 누르거나 주문 이력이 있는 회원을 삭제(익명화)하면 계정이 정지 상태로 전환되어 이곳에 표시됩니다.
                      </p>
                    </div>
                  ) : (
                    <p>조건에 맞는 사용자가 없습니다.</p>
                  )}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-line hover:bg-neutral-50/50">
                  <td className="py-3 px-3 font-medium text-fg">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs">{u.id}</span>
                      {u.role === "admin" && (
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-white">
                          관리자
                        </span>
                      )}
                      {u.role === "demo_admin" && (
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-800">
                          데모
                        </span>
                      )}
                      {["kim", "lee", "park", "choi"].includes(u.id) ? (
                        <span className="rounded bg-neutral-100 border border-line px-1.5 py-0.5 text-[11px] font-normal text-muted">
                          시드 기본
                        </span>
                      ) : u.id.startsWith("demo-") ? (
                        <span className="rounded bg-neutral-100 border border-line px-1.5 py-0.5 text-[11px] font-normal text-muted">
                          데모 임시
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-normal text-white">
                          시드 이후
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 px-3">{u.name}</td>
                  <td className="py-3 px-3">
                    {u.isGuest ? (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                        비회원 주문자
                      </span>
                    ) : (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-fg font-medium">
                        가입 회원
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-xs text-muted font-mono">{u.phone ?? "-"}</td>
                  <td className="py-3 px-3 text-xs">
                    <span className="num font-medium">{u.orderCount}건</span> ·{" "}
                    <span className="num text-muted">{won(u.totalSpent)}</span>
                  </td>
                  <td className="py-3 px-3">
                    {u.isGuest ? (
                      <span className="text-xs text-muted">비회원 (로그인 없음)</span>
                    ) : u.isActive ? (
                      <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        정상 (활성)
                      </span>
                    ) : (
                      <span className="rounded bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-800">
                        정지됨 (로그인 차단)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right text-xs">
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="border border-line bg-bg px-2 py-1 text-xs hover:border-fg transition cursor-pointer"
                        onClick={() => setSelectedUserId(u.id)}
                      >
                        상세
                      </button>
                      {!u.isGuest && u.role !== "admin" && (
                        <button
                          type="button"
                          disabled={readOnly || toggleStatusMutation.isPending}
                          data-testid={`toggle-user-active-${u.id}`}
                          onClick={() => toggleStatusMutation.mutate({ id: u.id, isActive: !u.isActive })}
                          className={`border px-2 py-1 text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            u.isActive
                              ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                              : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                          }`}
                        >
                          {u.isActive ? "계정 정지" : "정지 해제"}
                        </button>
                      )}
                      {!readOnly && u.role !== "admin" && (
                        <button
                          type="button"
                          className="border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 transition cursor-pointer"
                          onClick={() => deleteMutation.mutate(u.id)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 상세 모달/패널 */}
      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded border border-line-strong bg-bg p-6 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <h3 className="font-semibold text-lg">사용자 상세 정보</h3>
              <button
                type="button"
                className="text-sm text-muted hover:text-fg cursor-pointer"
                onClick={() => setSelectedUserId(null)}
              >
                ✕ 닫기
              </button>
            </div>

            {detailPending || !userDetail ? (
              <p className="text-xs text-muted py-6 text-center">불러오는 중입니다…</p>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-neutral-50 p-3 rounded border border-line">
                  <div>
                    <span className="text-muted block">아이디:</span>
                    <span className="font-semibold font-mono">{userDetail.id}</span>
                  </div>
                  <div>
                    <span className="text-muted block">이름:</span>
                    <span className="font-semibold">{userDetail.name}</span>
                  </div>
                  <div>
                    <span className="text-muted block">역할 / 구분:</span>
                    <span>{userDetail.role} / {userDetail.isGuest ? "비회원 주문자" : "가입 회원"}</span>
                  </div>
                  <div>
                    <span className="text-muted block">계정 상태:</span>
                    <span className={userDetail.isActive ? "text-emerald-700 font-medium" : "text-red-700 font-semibold"}>
                      {userDetail.isGuest ? "비회원 (로그인 없음)" : userDetail.isActive ? "정상 (활성)" : "정지됨 (로그인 차단)"}
                    </span>
                  </div>
                </div>

                {/* 기본 배송지 정보 */}
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-fg">기본 배송지 정보</h4>
                  <div className="rounded border border-line p-3 space-y-1 bg-surface">
                    <p><span className="text-muted">수령인:</span> {userDetail.recipientName ?? "-"}</p>
                    <p><span className="text-muted">연락처:</span> {userDetail.recipientPhone ?? userDetail.phone ?? "-"}</p>
                    <p>
                      <span className="text-muted">주소:</span>{" "}
                      {userDetail.postalCode ? `(${userDetail.postalCode}) ` : ""}
                      {userDetail.address1 ?? "-"} {userDetail.address2 ?? ""}
                    </p>
                    {userDetail.deliveryMemo && <p><span className="text-muted">메모:</span> {userDetail.deliveryMemo}</p>}
                  </div>
                </div>

                {/* 최근 주문 내역 */}
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-fg">최근 주문 내역</h4>
                  {userDetail.orders.length === 0 ? (
                    <p className="text-muted text-xs">주문 내역이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1.5 border border-line rounded p-2 max-h-40 overflow-y-auto">
                      {userDetail.orders.map((o) => (
                        <li key={o.id} className="flex items-center justify-between py-1 border-b border-line last:border-b-0">
                          <Link href={`/admin/orders/${o.id}`} className="hover:underline">
                            <strong className="text-fg">#{o.id}</strong>{" "}
                            <span className="text-muted">({o.status})</span>
                          </Link>
                          <span className="num font-medium">
                            {won(o.totalAmount)} {o.paid ? "· 결제완료" : "· 미결제"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 모달 하단 계정 상태 제어 */}
                {!readOnly && !userDetail.isGuest && userDetail.role !== "admin" && (
                  <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                    <button
                      type="button"
                      disabled={toggleStatusMutation.isPending}
                      onClick={() =>
                        toggleStatusMutation.mutate({
                          id: userDetail.id,
                          isActive: !userDetail.isActive,
                        })
                      }
                      className="border border-line-strong bg-bg px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 cursor-pointer"
                    >
                      {userDetail.isActive ? "이 계정 로그인 정지" : "이 계정 정지 해제"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-6">회원 및 고객 관리</h1>

      <AdminOnly
        readOnlyNote="데모 관리자는 볼 수만 있습니다. 회원 계정 정지·해제 및 삭제(익명화)는 실제 관리자(kim) 계정으로 로그인해야 실행할 수 있습니다."
        note="가입 회원과 비회원 주문 고객(비회원 결제 시 자동 생성된 수령인 레코드)의 누적 주문·결제액을 조회하고, 회원 계정 로그인 정지·해제 및 삭제(주문 보유 시 개인정보 익명화)를 관리합니다."
      >
        <AdminUsersContent />
      </AdminOnly>
    </main>
  );
}
