"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { authFetch } from "@/lib/api-client";
import { won } from "@/lib/orders";
import { AdminOnly } from "./products/admin-only";
import styles from "./admin.module.css";

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

function TileCard({
  title,
  href,
  testId,
  featured = false,
  children,
  linkLabel = "목록 보기",
}: {
  title: string;
  href: string;
  testId: string;
  featured?: boolean;
  children: ReactNode;
  linkLabel?: string;
}) {
  return (
    <section
      aria-label={title}
      className={featured ? styles.kpiTileFeatured : styles.kpiTile}
      data-testid={testId}
    >
      <div>
        <div className={styles.kpiHeader}>
          <h2 className={styles.kpiTitle}>{title}</h2>
        </div>
        <div className={styles.kpiBody}>{children}</div>
      </div>
      <Link href={href} className={styles.kpiFooterLink}>
        {linkLabel} →
      </Link>
    </section>
  );
}

const Big = ({ children }: { children: ReactNode }) => <p className={styles.kpiBig}>{children}</p>;

function formatRatio(val: number | undefined): number {
  if (!val) return 0;
  return val > 1 ? Math.round(val) : Math.round(val * 100);
}

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
  const {
    today,
    pending,
    lowStock,
    zeroResultQueries,
    reconciliation,
    pipelineFunnel,
    guestVsMember,
    bestSellers,
    lowStockVariants,
    recentSales,
    dataOrigin,
  } = data;

  const activeSummary = dataOrigin
    ? scope === "post_seed"
      ? {
          orders: dataOrigin.postSeedOrders,
          amount: dataOrigin.postSeedPaidAmount,
          users: dataOrigin.postSeedUsers,
          note: "시드 이후 스토어프론트에서 실제 발생한 주문·고객만 집계 중입니다.",
        }
      : scope === "seed_only"
        ? {
            orders: dataOrigin.seedOrders,
            amount: dataOrigin.seedPaidAmount,
            users: dataOrigin.seedUsers,
            note: "시드 스크립트 기본 계정(kim·lee·park·choi) 및 임시 데모 데이터만 집계 중입니다.",
          }
        : {
            orders: dataOrigin.seedOrders + dataOrigin.postSeedOrders,
            amount: dataOrigin.seedPaidAmount + dataOrigin.postSeedPaidAmount,
            users: dataOrigin.seedUsers + dataOrigin.postSeedUsers,
            note: "시드 초기 데이터와 실제 체크아웃 유입 데이터를 모두 합산해 표시합니다.",
          }
    : null;

  return (
    <div className={styles.dashboard}>
      {/* 데이터 출처 세그먼트 컨트롤 바 */}
      {dataOrigin && activeSummary && (
        <section
          aria-label="데이터 출처 구분"
          data-testid="dashboard-origin-filter"
          className={styles.originPanel}
        >
          <div className={styles.originTopRow}>
            <div className={styles.originSegmentGroup} role="group" aria-label="집계 데이터 범위">
              <button
                type="button"
                data-testid="scope-all"
                onClick={() => setScope("all")}
                className={`${styles.originTab} ${scope === "all" ? styles.originTabActive : ""}`}
              >
                <span>전체 합산</span>
                <span className={styles.originTabCount}>
                  {dataOrigin.seedOrders + dataOrigin.postSeedOrders}건
                </span>
              </button>

              <button
                type="button"
                data-testid="scope-post-seed"
                onClick={() => setScope("post_seed")}
                className={`${styles.originTab} ${scope === "post_seed" ? styles.originTabActive : ""}`}
              >
                <span>시드 이후 실유입</span>
                <span className={styles.originTabCount}>
                  {dataOrigin.postSeedOrders}건
                </span>
              </button>

              <button
                type="button"
                data-testid="scope-seed-only"
                onClick={() => setScope("seed_only")}
                className={`${styles.originTab} ${scope === "seed_only" ? styles.originTabActive : ""}`}
              >
                <span>시드 초기 데이터</span>
                <span className={styles.originTabCount}>
                  {dataOrigin.seedOrders}건
                </span>
              </button>
            </div>

            <Link
              href={
                scope === "post_seed"
                  ? "/admin/orders?origin=post_seed&status="
                  : scope === "seed_only"
                    ? "/admin/orders?origin=seed_only&status="
                    : "/admin/orders"
              }
              className={styles.originActionLink}
            >
              현재 범위 주문 목록 열기 →
            </Link>
          </div>

          <div className={styles.originSummaryBar}>
            <div className={styles.originSummaryStats}>
              <span className={styles.originStatItem}>
                <span className={styles.originStatLabel}>선택 범위 주문</span>
                <span className={styles.originStatValue}>{activeSummary.orders}건</span>
              </span>
              <span className={styles.originStatItem}>
                <span className={styles.originStatLabel}>누적 결제액</span>
                <span className={styles.originStatValue}>{won(activeSummary.amount)}</span>
              </span>
              <span className={styles.originStatItem}>
                <span className={styles.originStatLabel}>등록 고객</span>
                <span className={styles.originStatValue}>{activeSummary.users}명</span>
              </span>
            </div>
            <p className={styles.originDesc}>{activeSummary.note}</p>
          </div>
        </section>
      )}

      {/* 기본 운영 5대 지표 카드 */}
      <div className={styles.kpiMatrix}>
        <TileCard title={`오늘(${today.date}) 결제된 주문`} href={today.href} testId="tile-today" featured>
          <Big>{today.orders}건 · {won(today.netSales)}</Big>
          <p className={styles.kpiCaption}>
            순매출 = 결제 {won(today.paidAmount)} − 환불 {won(today.refundedAmount)} (한국 시각 자정 기준)
          </p>
        </TileCard>

        <TileCard title="처리 대기" href={pending.paid.href} testId="tile-pending" linkLabel="배송 준비할 주문 보기">
          <ul className={styles.kpiList}>
            <li className={styles.kpiListRow}>
              <Link href={pending.paid.href} className={styles.kpiListLink}>결제 완료(배송 준비 전)</Link>
              <span className={styles.kpiListNum}>{pending.paid.count}건</span>
            </li>
            <li className={styles.kpiListRow}>
              <Link href={pending.preparing.href} className={styles.kpiListLink}>배송 준비 중</Link>
              <span className={styles.kpiListNum}>{pending.preparing.count}건</span>
            </li>
            <li className={styles.kpiListRow}>
              <Link href={pending.returnsRequested.href} className={styles.kpiListLink}>반품·교환 요청</Link>
              <span className={styles.kpiListNum}>{pending.returnsRequested.count}건</span>
            </li>
          </ul>
        </TileCard>

        <TileCard title={`재고 부족(${lowStock.threshold}개 이하)`} href={lowStock.href} testId="tile-low-stock" linkLabel="상품 관리">
          <Big>{lowStock.count}개 상품</Big>
          {lowStock.items.length > 0 && (
            <ul className={styles.kpiList}>
              {lowStock.items.map((p) => (
                <li key={p.id} className={styles.kpiListRow}>
                  <span>{p.name}</span>
                  <span className={styles.kpiListNum}>{p.stock}개</span>
                </li>
              ))}
            </ul>
          )}
        </TileCard>

        <TileCard title="못 찾은 검색어(최근 7일)" href={zeroResultQueries.href} testId="tile-zero-search" linkLabel="검색 화면">
          {zeroResultQueries.items.length === 0 ? (
            <p className={styles.kpiCaption}>결과가 0건인 검색어가 없습니다.</p>
          ) : (
            <ol className={styles.kpiList}>
              {zeroResultQueries.items.map((q) => (
                <li key={q.query} className={styles.kpiListRow}>
                  <span>{q.query}</span>
                  <span className={styles.kpiListNum}>{q.count}회</span>
                </li>
              ))}
            </ol>
          )}
        </TileCard>

        <TileCard title="PG 대사 미해결" href={reconciliation.href} testId="tile-reconciliation" linkLabel="불일치 목록">
          <Big>{reconciliation.unresolved}건</Big>
          <p className={styles.kpiCaption}>PG 결제 원장과 내부 주문 DB 간 미해결 대사 건수</p>
        </TileCard>
      </div>

      {/* 주문 파이프라인 및 비즈니스 분석 지표 */}
      <div className={styles.analyticsSection}>
        <div className={styles.sectionHeaderBar}>
          <h2 className={styles.sectionHeading}>주문 파이프라인 및 비즈니스 현황</h2>
          <span className={styles.sectionSub}>주문 단계별 누적 현황과 매출·재고 요약</span>
        </div>

        {/* 주문 파이프라인 퍼널 */}
        <section aria-label="주문 파이프라인 퍼널" data-testid="tile-pipeline-funnel" className={styles.funnelPanel}>
          <div className={styles.funnelPanelHeader}>
            <h3 className={styles.funnelPanelTitle}>주문 처리 단계별 현황</h3>
            <span className={styles.funnelPanelMeta}>결제 대기부터 구매 확정까지 전체 흐름</span>
          </div>
          <div className={styles.funnelGrid}>
            <div className={styles.funnelStep}>
              <span className={styles.funnelStepLabel}>결제 대기</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.pendingPayment ?? 0}</span>
            </div>
            <div className={styles.funnelStep}>
              <span className={styles.funnelStepLabel}>결제 완료</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.paid ?? 0}</span>
            </div>
            <div className={styles.funnelStep}>
              <span className={styles.funnelStepLabel}>배송 준비 중</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.preparing ?? 0}</span>
            </div>
            <div className={styles.funnelStep}>
              <span className={styles.funnelStepLabel}>출고·배송 중</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.shipped ?? 0}</span>
            </div>
            <div className={styles.funnelStep}>
              <span className={styles.funnelStepLabel}>배송 완료</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.delivered ?? 0}</span>
            </div>
            <div className={styles.funnelStepHighlight}>
              <span className={styles.funnelStepLabel}>구매 확정</span>
              <span className={styles.funnelStepValue}>{pipelineFunnel?.confirmed ?? 0}</span>
            </div>
          </div>
        </section>

        <div className={styles.analyticsGrid}>
          {/* 회원 vs 비회원 비율 */}
          <section aria-label="회원 vs 비회원 비율" data-testid="tile-member-ratio" className={styles.analyticsCard}>
            <div className={styles.analyticsCardHeader}>
              <h3 className={styles.analyticsCardTitle}>고객 유형별 주문 비중</h3>
              <span className={styles.analyticsCardSub}>회원 · 비회원</span>
            </div>
            <div className={styles.analyticsTable}>
              <div className={styles.analyticsRow}>
                <span>가입 회원</span>
                <span className={styles.monoValue}>
                  주문 {guestVsMember?.memberOrders ?? 0}건 ({formatRatio(guestVsMember?.memberRatio)}%)
                </span>
              </div>
              <div className={styles.analyticsRow}>
                <span>비회원 주문자</span>
                <span className={styles.monoValue}>
                  주문 {guestVsMember?.guestOrders ?? 0}건 ({formatRatio(guestVsMember?.guestRatio)}%)
                </span>
              </div>
            </div>
          </section>

          {/* 최근 7일 매출 추이 */}
          <section aria-label="최근 매출 추이" data-testid="tile-recent-sales" className={styles.analyticsCard}>
            <div className={styles.analyticsCardHeader}>
              <h3 className={styles.analyticsCardTitle}>최근 7일 일자별 매출</h3>
              <span className={styles.analyticsCardSub}>결제 승인 기준</span>
            </div>
            {recentSales && recentSales.length > 0 ? (
              <div className={styles.analyticsTable}>
                {recentSales.map((s) => (
                  <div key={s.date} className={styles.analyticsRow}>
                    <span className={styles.monoValue}>{s.date}</span>
                    <span className={styles.monoValue}>{won(s.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.kpiCaption}>최근 매출 내역이 없습니다.</p>
            )}
          </section>

          {/* 베스트셀러 TOP 5 */}
          <section aria-label="베스트셀러 TOP 5" data-testid="tile-best-sellers" className={styles.analyticsCard}>
            <div className={styles.analyticsCardHeader}>
              <h3 className={styles.analyticsCardTitle}>베스트셀러 상위 5개 상품</h3>
              <span className={styles.analyticsCardSub}>누적 판매량 순</span>
            </div>
            {bestSellers && bestSellers.length > 0 ? (
              <ol className={styles.analyticsTable}>
                {bestSellers.map((item, idx) => (
                  <li key={item.productId} className={styles.analyticsRow}>
                    <span>
                      <span className={styles.rankBadge}>{idx + 1}</span>
                      {item.name}
                    </span>
                    <span className={styles.monoValue}>
                      {item.quantity}개 판매 ({won(item.totalSales)})
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.kpiCaption}>판매 내역이 없습니다.</p>
            )}
          </section>

          {/* 옵션별 재고 부족 목록 */}
          <section aria-label="옵션 재고 부족" data-testid="tile-low-stock-variants" className={styles.analyticsCard}>
            <div className={styles.analyticsCardHeader}>
              <h3 className={styles.analyticsCardTitle}>옵션별 재고 부족 (5개 이하)</h3>
              <span className={styles.analyticsCardSub}>품절 임박 옵션</span>
            </div>
            {lowStockVariants && lowStockVariants.length > 0 ? (
              <ul className={styles.analyticsTable}>
                {lowStockVariants.map((v) => (
                  <li key={v.id} className={styles.analyticsRow}>
                    <span>
                      <strong>{v.productName}</strong>
                      <span className={styles.variantOptionTag}>({v.variantName})</span>
                    </span>
                    <span className={styles.alertValue}>재고 {v.stock}개</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.kpiCaption}>재고 부족 옵션이 없습니다.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <h1 className={styles.pageTitle}>오늘 처리할 것</h1>
          <p className={styles.pageDesc}>오늘 접수된 주문, 출고·반품 대기, 재고 부족 및 PG 정산 대사 현황을 한눈에 확인합니다.</p>
        </div>
        <span className={styles.headerMeta}>한국 표준시(KST) 실시간 집계</span>
      </header>
      <AdminOnly readOnlyNote={READ_ONLY} note={null}>
        <Tiles />
        <nav aria-label="관리 화면" className={styles.QuickLinksFooter}>
          <Link href="/admin/settings" className={styles.quickLink}>상점 설정</Link>
          <Link href="/admin/legal" className={styles.quickLink}>약관·방침</Link>
          <Link href="/admin/reconciliation" className={styles.quickLink}>PG 대사</Link>
          <Link href="/admin/mcp" className={styles.quickLink}>AI 도우미 연결(MCP)</Link>
        </nav>
      </AdminOnly>
    </div>
  );
}
