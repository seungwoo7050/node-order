"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [q, setQ] = useState("");
  const [filterGuest, setFilterGuest] = useState<boolean | undefined>(undefined);
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (q.trim()) queryParams.set("q", q.trim());
  if (filterGuest !== undefined) queryParams.set("guest", String(filterGuest));
  if (filterActive !== undefined) queryParams.set("active", String(filterActive));

  const { data: users, isPending } = useQuery<UserItem[]>({
    queryKey: ["admin-users", q, filterGuest, filterActive],
    queryFn: () => authFetch<UserItem[]>(`/admin/users?${queryParams.toString()}`),
  });

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
      if (!confirm(`사용자 '${id}'를 삭제하시겠습니까?\n주문 내역이 있는 경우 자동으로 개인정보가 익명화 및 비활성화 처리됩니다.`)) return;
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
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-6">회원 및 고객 관리</h1>

      <AdminOnly>
        {/* 필터 및 검색 바 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                filterGuest === undefined && filterActive === undefined
                  ? "bg-fg text-bg"
                  : "text-muted hover:bg-neutral-100"
              }`}
              onClick={() => {
                setFilterGuest(undefined);
                setFilterActive(undefined);
              }}
            >
              전체
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                filterGuest === false ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
              }`}
              onClick={() => {
                setFilterGuest(false);
                setFilterActive(undefined);
              }}
            >
              회원만
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                filterGuest === true ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
              }`}
              onClick={() => {
                setFilterGuest(true);
                setFilterActive(undefined);
              }}
            >
              비회원
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                filterActive === false ? "bg-fg text-bg" : "text-muted hover:bg-neutral-100"
              }`}
              onClick={() => {
                setFilterActive(false);
                setFilterGuest(undefined);
              }}
            >
              정지 계정
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line-strong text-xs text-muted">
                <th className="py-2.5 font-medium">아이디</th>
                <th className="py-2.5 font-medium">이름</th>
                <th className="py-2.5 font-medium">구분</th>
                <th className="py-2.5 font-medium">연락처</th>
                <th className="py-2.5 font-medium">주문 수 / 결제액</th>
                <th className="py-2.5 font-medium">상태</th>
                <th className="py-2.5 text-right font-medium">관리</th>
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
                  <td colSpan={7} className="py-8 text-center text-xs text-muted">
                    조건에 맞는 사용자가 없습니다.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-b border-line hover:bg-neutral-50/50">
                    <td className="py-3 font-medium text-fg">
                      <span className="flex items-center gap-2">
                        {u.id}
                        {u.role === "admin" && (
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-white">
                            관리자
                          </span>
                        )}
                        {u.role === "demo_admin" && (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-800">
                            데모
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-3">{u.name}</td>
                    <td className="py-3">
                      {u.isGuest ? (
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                          비회원
                        </span>
                      ) : (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          일반회원
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-xs text-muted">{u.phone ?? "-"}</td>
                    <td className="py-3 text-xs">
                      <span className="num font-medium">{u.orderCount}건</span> ·{" "}
                      <span className="num text-muted">{won(u.totalSpent)}</span>
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        disabled={readOnly || u.role === "admin"}
                        onClick={() => toggleStatusMutation.mutate({ id: u.id, isActive: !u.isActive })}
                        className={`rounded px-2 py-0.5 text-xs font-medium cursor-pointer ${
                          u.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {u.isActive ? "정상 (활성)" : "정지됨"}
                      </button>
                    </td>
                    <td className="py-3 text-right text-xs space-x-2">
                      <button
                        type="button"
                        className="link-quiet"
                        onClick={() => setSelectedUserId(u.id)}
                      >
                        상세
                      </button>
                      {!readOnly && u.role !== "admin" && (
                        <button
                          type="button"
                          className="text-red-500 hover:underline cursor-pointer"
                          onClick={() => deleteMutation.mutate(u.id)}
                        >
                          삭제
                        </button>
                      )}
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
            <div className="w-full max-w-lg rounded border border-line-strong bg-bg p-6 shadow-xl max-h-[85vh] overflow-y-auto">
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
                      <span className="font-semibold">{userDetail.id}</span>
                    </div>
                    <div>
                      <span className="text-muted block">이름:</span>
                      <span className="font-semibold">{userDetail.name}</span>
                    </div>
                    <div>
                      <span className="text-muted block">역할 / 구분:</span>
                      <span>{userDetail.role} / {userDetail.isGuest ? "비회원" : "회원"}</span>
                    </div>
                    <div>
                      <span className="text-muted block">계정 상태:</span>
                      <span className={userDetail.isActive ? "text-green-700" : "text-red-700 font-semibold"}>
                        {userDetail.isActive ? "활성" : "정지"}
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
                            <span>
                              <strong className="text-fg">#{o.id}</strong>{" "}
                              <span className="text-muted">({o.status})</span>
                            </span>
                            <span className="num font-medium">
                              {won(o.totalAmount)} {o.paid ? "· 결제완료" : "· 미결제"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </AdminOnly>
    </main>
  );
}
