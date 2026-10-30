"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { authFetch } from "@/lib/api-client";
import { won } from "@/lib/orders";
import { AdminOnly } from "./products/admin-only";

type Tile<T> = T & { href: string };
type Dashboard = {
  today: Tile<{ date: string; orders: number; paidAmount: number; refundedAmount: number; netSales: number }>;
  pending: { paid: Tile<{ count: number }>; preparing: Tile<{ count: number }>; returnsRequested: Tile<{ count: number }> };
  lowStock: Tile<{ threshold: number; count: number; items: { id: number; name: string; stock: number }[] }>;
  zeroResultQueries: Tile<{ items: { query: string; count: number }[] }>;
  reconciliation: Tile<{ unresolved: number }>;
};

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 타일의 링크로 각 목록을 열어 볼 수 있고, 바꾸는 동작은 진짜 관리자만 할 수 있습니다.";

function TileCard({ title, href, testId, children, linkLabel = "목록 보기" }: { title: string; href: string; testId: string; children: ReactNode; linkLabel?: string }) {
  return (
    <section aria-label={title} className="border-t border-line-strong pt-3" data-testid={testId}>
      <h2 className="label mb-2">{title}</h2>
      <div className="mb-2">{children}</div>
      <Link href={href} className="link-quiet">{linkLabel}</Link>
    </section>
  );
}

const Big = ({ children }: { children: ReactNode }) => <p className="num font-serif text-2xl">{children}</p>;

function Tiles() {
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["admin-dashboard"], queryFn: () => authFetch<Dashboard>("/admin/dashboard") });
  if (isPending) return <p role="status" className="text-sm text-muted">오늘 처리할 것을 모으는 중입니다.</p>;
  if (error)
    return (
      <p role="alert" className="alert">
        대시보드를 불러오지 못했습니다. ({error.message}) <button type="button" className="btn ml-2" onClick={() => void refetch()}>다시 시도</button>
      </p>
    );
  const { today, pending, lowStock, zeroResultQueries, reconciliation } = data;
  return (
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      <TileCard title={`오늘(${today.date}) 결제된 주문`} href={today.href} testId="tile-today">
        <Big>{today.orders}건 · {won(today.netSales)}</Big>
        <p className="text-[0.78rem] text-muted">순매출 = 결제 {won(today.paidAmount)} − 환불 {won(today.refundedAmount)} (한국 시각 자정 기준)</p>
      </TileCard>
      <TileCard title="처리 대기" href={pending.paid.href} testId="tile-pending" linkLabel="배송 준비할 주문 보기">
        <ul className="grid gap-1 text-sm">
          <li><Link href={pending.paid.href}>결제 완료(배송 준비 전)</Link> <span className="num">{pending.paid.count}건</span></li>
          <li><Link href={pending.preparing.href}>배송 준비 중</Link> <span className="num">{pending.preparing.count}건</span></li>
          <li><Link href={pending.returnsRequested.href}>반품·교환 요청</Link> <span className="num">{pending.returnsRequested.count}건</span></li>
        </ul>
      </TileCard>
      <TileCard title={`재고 부족(${lowStock.threshold}개 이하)`} href={lowStock.href} testId="tile-low-stock" linkLabel="상품 관리">
        <Big>{lowStock.count}개 상품</Big>
        {lowStock.items.length > 0 && (
          <ul className="text-sm">
            {lowStock.items.map((p) => <li key={p.id}>{p.name} <span className="num text-muted">{p.stock}개</span></li>)}
          </ul>
        )}
      </TileCard>
      <TileCard title="못 찾은 검색어(최근 7일)" href={zeroResultQueries.href} testId="tile-zero-search" linkLabel="검색 화면">
        {zeroResultQueries.items.length === 0 ? (
          <p className="text-sm text-muted">결과가 0건인 검색어가 없습니다.</p>
        ) : (
          <ol className="text-sm">
            {zeroResultQueries.items.map((q) => <li key={q.query}>{q.query} <span className="num text-muted">{q.count}회</span></li>)}
          </ol>
        )}
      </TileCard>
      <TileCard title="PG 대사 미해결" href={reconciliation.href} testId="tile-reconciliation" linkLabel="불일치 목록">
        <Big>{reconciliation.unresolved}건</Big>
      </TileCard>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">오늘 처리할 것</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={null}>
        <Tiles />
        <nav aria-label="관리 화면" className="mt-12 flex flex-wrap gap-4 text-sm">
          <Link href="/admin/settings">상점 설정</Link>
          <Link href="/admin/legal">약관·방침</Link>
          <Link href="/admin/reconciliation">PG 대사</Link>
        </nav>
      </AdminOnly>
    </main>
  );
}
