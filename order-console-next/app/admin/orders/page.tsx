"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { API_URL, authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { ORDER_STATUS_CODES, ORDER_STATUS_LABEL, won, type OrderStatusCode } from "@/lib/orders";
import { LoadMore } from "../../load-more";
import { AdminOnly } from "../products/admin-only";

type Row = { id: number; userId: string; status: OrderStatusCode; price: number; recipientName: string | null; createdAt: string; isGuest?: boolean };
type Page = { items: Row[]; nextCursor: string | null };

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 배송 준비·송장 입력·취소·반품 처리는 진짜 관리자만 할 수 있어 버튼을 꺼 두었습니다.";

const isStatus = (v: string | null): v is OrderStatusCode => !!v && (ORDER_STATUS_CODES as string[]).includes(v);

// 대시보드 타일 링크(?status=paid, ?returns=requested)로 열면 그 필터로 시작한다
function OrderTable() {
  const search = useSearchParams();
  const initialStatus = search.get("status");
  const [status, setStatus] = useState<OrderStatusCode | "">(isStatus(initialStatus) ? initialStatus : search.get("returns") ? "" : "paid");
  const [returnsOnly, setReturnsOnly] = useState(search.get("returns") === "requested");
  const [guestFilter, setGuestFilter] = useState<string>(search.get("guest") ?? "");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ["admin-orders", status, returnsOnly, guestFilter, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (status) params.set("status", status);
      if (returnsOnly) params.set("returns", "requested");
      if (guestFilter) params.set("guest", guestFilter);
      if (q.trim()) params.set("q", q.trim());
      if (pageParam) params.set("cursor", pageParam);
      return authFetch<Page>(`/admin/orders?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      const res = await fetch(`${API_URL}/admin/orders/export.csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("CSV 내보내기 실패");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("주문 내역 CSV 다운로드에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2">
            <span className="label">상태</span>
            <select className="border border-line px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value as OrderStatusCode | "")} data-testid="status-filter">
              <option value="">전체</option>
              {ORDER_STATUS_CODES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="label">구분</span>
            <select className="border border-line px-2 py-1" value={guestFilter} onChange={(e) => setGuestFilter(e.target.value)} data-testid="guest-filter">
              <option value="">전체</option>
              <option value="false">회원만</option>
              <option value="true">비회원만</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={returnsOnly} onChange={(e) => setReturnsOnly(e.target.checked)} data-testid="returns-filter" />
            반품·교환만
          </label>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="search"
            data-testid="order-search-input"
            placeholder="주문번호, 주문자, 수령인 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-line px-2.5 py-1 text-xs rounded w-48"
          />
          <button
            type="button"
            data-testid="export-csv-btn"
            onClick={handleExportCsv}
            disabled={exporting}
            className="btn btn-sm text-xs"
          >
            {exporting ? "다운로드 중…" : "CSV 다운로드"}
          </button>
        </div>
      </div>

      {query.isPending ? (
        <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>
      ) : query.error && rows.length === 0 ? (
        <p role="alert" className="alert">주문을 불러오지 못했습니다. ({query.error.message})</p>
      ) : rows.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-muted">이 상태의 주문이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm" data-testid="admin-orders">
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="label py-3 font-normal">주문</th>
              <th scope="col" className="label hidden py-3 font-normal sm:table-cell">주문일</th>
              <th scope="col" className="label hidden py-3 font-normal sm:table-cell">받는 분</th>
              <th scope="col" className="label py-3 text-right font-normal">금액</th>
              <th scope="col" className="label py-3 pl-6 font-normal">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line">
                <td className="py-3">
                  <Link href={`/admin/orders/${o.id}`}>#{o.id}</Link> <span className="text-muted">{o.userId}</span>
                  {o.isGuest && (
                    <span className="ml-1.5 text-xs px-1.5 py-0.5 bg-neutral-200 rounded font-normal" data-testid="guest-badge">
                      비회원
                    </span>
                  )}
                </td>
                <td className="num hidden py-3 sm:table-cell">{new Date(o.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="hidden py-3 sm:table-cell">{o.recipientName ?? "-"}</td>
                <td className="num py-3 text-right">{won(o.price)}</td>
                <td className="py-3 pl-6">{ORDER_STATUS_LABEL[o.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {query.data && (
        <LoadMore hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} isFetchNextPageError={query.isFetchNextPageError}
          fetchNextPage={query.fetchNextPage} loaded={rows.length} pages={query.data.pages.length} noun="주문" />
      )}
    </>
  );
}

export default function AdminOrdersPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">주문 관리</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={null}>
        <Suspense fallback={<p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>}>
          <OrderTable />
        </Suspense>
      </AdminOnly>
    </main>
  );
}
