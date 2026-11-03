"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { authFetch } from "@/lib/api-client";
import { won } from "@/lib/orders";
import { AdminOnly } from "./products/admin-only";

type DashboardScope = "all" | "post_seed" | "seed_only";

type Tile<T> = T & { href: string };
type Dashboard = {
  today: Tile<{ date: string; orders: number; paidAmount: number; refundedAmount: number; netSales: number }>;
  pending: { paid: Tile<{ count: number }>; preparing: Tile<{ count: number }>; returnsRequested: Tile<{ count: number }> };
  lowStock: Tile<{ threshold: number; count: number; items: { id: number; name: string; stock: number }[] }>;
  zeroResultQueries: Tile<{ items: { query: string; count: number }[] }>;
  reconciliation: Tile<{ unresolved: number }>;
  pipelineFunnel?: {
    pendingPayment: number;
    paid: number;
    preparing: number;
    shipped: number;
    delivered: number;
    confirmed: number;
    canceled: number;
  };
  guestVsMember?: {
    memberOrders: number;
    guestOrders: number;
    memberRatio: number;
    guestRatio: number;
  };
  bestSellers?: { productId: number; name: string; quantity: number; totalSales: number }[];
  lowStockVariants?: { id: number; productId: number; productName: string; variantName: string; stock: number }[];
  recentSales?: { date: string; amount: number }[];
  dataOrigin?: {
    scope: DashboardScope;
    seedOrders: number;
    postSeedOrders: number;
    seedPaidAmount: number;
    postSeedPaidAmount: number;
    seedUsers: number;
    postSeedUsers: number;
  };
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
  const [scope, setScope] = useState<DashboardScope>("all");
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["admin-dashboard", scope],
    queryFn: () =>
      authFetch<Dashboard>(
        scope === "all" ? "/admin/dashboard" : `/admin/dashboard?scope=${scope}`,
      ),
  });
  if (isPending || !data) return <p role="status" className="text-sm text-muted">오늘 처리할 것을 모으는 중입니다.</p>;
  if (error)
    return (
      <p role="alert" className="alert">
        대시보드를 불러오지 못했습니다. ({error.message}) <button type="button" className="btn ml-2" onClick={() => void refetch()}>다시 시도</button>
      </p>
    );
  const { today, pending, lowStock, zeroResultQueries, reconciliation, pipelineFunnel, guestVsMember, bestSellers, lowStockVariants, recentSales, dataOrigin } = data;
  return (
    <div className="space-y-12">
      {/* 시드 기본 데이터 vs 시드 이후 실유입 데이터 구분 바 */}
      {dataOrigin && (
        <section
          aria-label="데이터 출처 구분"
          data-testid="dashboard-origin-filter"
          className="rounded border border-line bg-neutral-50/70 p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="label text-fg">데이터 출처 구분 (시드 기본 vs 시드 이후 유입)</h2>
              <p className="text-xs text-muted mt-0.5">
                시드 스크립트(manual 샘플 결제·데모 계정)로 생성된 데이터와 실제 스토어프론트 체크아웃으로 쌓인 데이터를 분리해 조회합니다.
              </p>
            </div>
            <Link
              href={scope === "post_seed" ? "/admin/orders?origin=post_seed&status=" : scope === "seed_only" ? "/admin/orders?origin=seed_only&status=" : "/admin/orders"}
              className="link-quiet text-xs"
            >
              이 범위 주문 목록 열기 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 text-left text-sm">
            <button
              type="button"
              data-testid="scope-all"
              onClick={() => setScope("all")}
              className={`rounded border p-3 text-left cursor-pointer transition-colors ${
                scope === "all"
                  ? "border-line-strong bg-bg ring-1 ring-line-strong"
                  : "border-line bg-bg/60 hover:bg-bg"
              }`}
            >
              <span className="flex items-center justify-between text-xs text-muted mb-1">
                <span>전체 합산</span>
                {scope === "all" && <span className="rounded bg-fg px-1.5 py-0.5 text-[11px] text-bg">선택됨</span>}
              </span>
              <span className="num font-semibold text-base block">
                주문 {dataOrigin.seedOrders + dataOrigin.postSeedOrders}건 · {won(dataOrigin.seedPaidAmount + dataOrigin.postSeedPaidAmount)}
              </span>
              <span className="text-xs text-muted block mt-1">
                전체 고객 {dataOrigin.seedUsers + dataOrigin.postSeedUsers}명
              </span>
            </button>

            <button
              type="button"
              data-testid="scope-post-seed"
              onClick={() => setScope("post_seed")}
              className={`rounded border p-3 text-left cursor-pointer transition-colors ${
                scope === "post_seed"
                  ? "border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700"
                  : "border-line bg-bg/60 hover:bg-bg"
              }`}
            >
              <span className="flex items-center justify-between text-xs text-emerald-800 font-medium mb-1">
                <span>시드 이후 실유입 데이터만</span>
                {scope === "post_seed" && <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[11px] text-white">선택됨</span>}
              </span>
              <span className="num font-semibold text-base block text-fg">
                주문 {dataOrigin.postSeedOrders}건 · {won(dataOrigin.postSeedPaidAmount)}
              </span>
              <span className="text-xs text-muted block mt-1">
                시드 이후 신규/비회원 고객 {dataOrigin.postSeedUsers}명 (PG 실결제·배송지 입력 주문)
              </span>
            </button>

            <button
              type="button"
              data-testid="scope-seed-only"
              onClick={() => setScope("seed_only")}
              className={`rounded border p-3 text-left cursor-pointer transition-colors ${
                scope === "seed_only"
                  ? "border-amber-700 bg-amber-50/60 ring-1 ring-amber-700"
                  : "border-line bg-bg/60 hover:bg-bg"
              }`}
            >
              <span className="flex items-center justify-between text-xs text-amber-800 font-medium mb-1">
                <span>시드·데모 초기 데이터만</span>
                {scope === "seed_only" && <span className="rounded bg-amber-700 px-1.5 py-0.5 text-[11px] text-white">선택됨</span>}
              </span>
              <span className="num font-semibold text-base block text-fg">
                주문 {dataOrigin.seedOrders}건 · {won(dataOrigin.seedPaidAmount)}
              </span>
              <span className="text-xs text-muted block mt-1">
                시드 기본 계정(kim·lee·park·choi) 및 임시 데모 계정 {dataOrigin.seedUsers}명
              </span>
            </button>
          </div>
        </section>
      )}

      {/* 기본 운영 5대 타일 */}
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

      {/* 34단계 추가 분석 지표 */}
      <div className="border-t border-line pt-8 space-y-8">
        <h2 className="title text-lg font-serif">주문 파이프라인 및 비즈니스 현황</h2>

        {/* 주문 파이프라인 퍼널 */}
        <section aria-label="주문 파이프라인 퍼널" data-testid="tile-pipeline-funnel" className="rounded border border-line p-4">
          <h3 className="label mb-3">주문 처리 파이프라인</h3>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
            <div className="rounded bg-neutral-100 p-2.5">
              <span className="text-xs text-muted block mb-1">결제 대기</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.pendingPayment ?? 0}</span>
            </div>
            <div className="rounded bg-neutral-100 p-2.5">
              <span className="text-xs text-muted block mb-1">결제 완료</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.paid ?? 0}</span>
            </div>
            <div className="rounded bg-neutral-100 p-2.5">
              <span className="text-xs text-muted block mb-1">배송 준비 중</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.preparing ?? 0}</span>
            </div>
            <div className="rounded bg-neutral-100 p-2.5">
              <span className="text-xs text-muted block mb-1">출고·배송 중</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.shipped ?? 0}</span>
            </div>
            <div className="rounded bg-neutral-100 p-2.5">
              <span className="text-xs text-muted block mb-1">배송 완료</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.delivered ?? 0}</span>
            </div>
            <div className="rounded bg-green-50 border border-green-200 p-2.5 text-green-800">
              <span className="text-xs text-green-700 block mb-1">구매 확정</span>
              <span className="num font-semibold text-lg">{pipelineFunnel?.confirmed ?? 0}</span>
            </div>
          </div>
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* 회원 vs 비회원 비율 */}
          <section aria-label="회원 vs 비회원 비율" data-testid="tile-member-ratio" className="rounded border border-line p-4">
            <h3 className="label mb-3">고객 및 주문 구성</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <span className="text-muted">가입 회원</span>
                <span className="num font-medium">주문 {guestVsMember?.memberOrders ?? 0}건 ({Math.round((guestVsMember?.memberRatio ?? 0) * 100)}%)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">비회원 주문자</span>
                <span className="num font-medium">주문 {guestVsMember?.guestOrders ?? 0}건 ({Math.round((guestVsMember?.guestRatio ?? 0) * 100)}%)</span>
              </div>
            </div>
          </section>

          {/* 최근 7일 매출 추이 */}
          <section aria-label="최근 매출 추이" data-testid="tile-recent-sales" className="rounded border border-line p-4">
            <h3 className="label mb-3">최근 매출 요약</h3>
            {recentSales && recentSales.length > 0 ? (
              <div className="space-y-1.5 text-sm">
                {recentSales.map((s) => (
                  <div key={s.date} className="flex items-center justify-between">
                    <span className="text-xs text-muted">{s.date}</span>
                    <span className="num">{won(s.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">매출 내역이 없습니다.</p>
            )}
          </section>

          {/* 베스트셀러 TOP 5 */}
          <section aria-label="베스트셀러 TOP 5" data-testid="tile-best-sellers" className="rounded border border-line p-4">
            <h3 className="label mb-3">베스트셀러 TOP 5</h3>
            {bestSellers && bestSellers.length > 0 ? (
              <ol className="space-y-2 text-sm">
                {bestSellers.map((item, idx) => (
                  <li key={item.productId} className="flex items-center justify-between">
                    <span className="truncate mr-2">
                      <span className="font-semibold text-muted mr-2">{idx + 1}.</span>
                      {item.name}
                    </span>
                    <span className="num text-xs text-muted shrink-0">
                      {item.quantity}개 판매 ({won(item.totalSales)})
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">판매 내역이 없습니다.</p>
            )}
          </section>

          {/* 옵션별 재고 부족 목록 */}
          <section aria-label="옵션 재고 부족" data-testid="tile-low-stock-variants" className="rounded border border-line p-4">
            <h3 className="label mb-3">옵션별 재고 부족 (5개 이하)</h3>
            {lowStockVariants && lowStockVariants.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {lowStockVariants.map((v) => (
                  <li key={v.id} className="flex items-center justify-between">
                    <span className="truncate mr-2">
                      <span className="font-medium text-fg">{v.productName}</span>{" "}
                      <span className="text-muted text-xs">({v.variantName})</span>
                    </span>
                    <span className="num text-red-600 font-semibold text-xs shrink-0">
                      재고 {v.stock}개
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">재고 부족 옵션이 없습니다.</p>
            )}
          </section>
        </div>
      </div>
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
          <Link href="/admin/mcp">AI 도우미 연결(MCP)</Link>
        </nav>
      </AdminOnly>
    </main>
  );
}
