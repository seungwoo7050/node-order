import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SearchStats } from "../search/search-stats.js";
import { StoreSettingsService } from "./store-settings.service.js";

type Tile<T> = T & { href: string };
export type Dashboard = {
  today: Tile<{ date: string; orders: number; paidAmount: number; refundedAmount: number; netSales: number }>;
  pending: { paid: Tile<{ count: number }>; preparing: Tile<{ count: number }>; returnsRequested: Tile<{ count: number }> };
  lowStock: Tile<{ threshold: number; count: number; items: { id: number; name: string; stock: number }[] }>;
  zeroResultQueries: Tile<{ items: { query: string; count: number }[] }>;
  reconciliation: Tile<{ unresolved: number }>;
};

// 하루 경계는 서버·DB 세션 시간대에 기대지 않고 쿼리에 Asia/Seoul을 적는다.
// 칸은 timestamp(시간대 없음, UTC로 저장)라서 KST 자정을 UTC 시각으로 바꿔 범위로 비교한다(인덱스를 쓸 수 있게)
const TODAY_START_UTC = `(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`;

// 관리자 대시보드 타일. 캐시하지 않는다(관리자 한 명, 작은 쿼리 몇 개)
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchStats: SearchStats,
    private readonly settings: StoreSettingsService,
  ) {}

  async get(): Promise<Dashboard> {
    const { lowStockThreshold } = await this.settings.get();
    const [today, pending, lowStock, lowStockItems, unresolved, zero] = await Promise.all([
      // 오늘 결제된 주문(승인 시각 기준)과 순매출 = 오늘 승인된 결제액 − 오늘 요청해 성공한 환불액(어제 주문의 환불도 오늘 매출에서 뺀다)
      this.prisma.asAdmin((tx) => tx.$queryRawUnsafe<{ date: string; orders: number; paid: number; refunded: number }[]>(`
        WITH day AS (SELECT ${TODAY_START_UTC} AS start)
        SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
          (SELECT count(*)::int FROM payments p, day WHERE p.approved_at >= day.start AND p.approved_at < day.start + interval '1 day'
             AND p.status IN ('paid', 'partial_refunded', 'refunded')) AS orders,
          (SELECT coalesce(sum(p.amount), 0)::int FROM payments p, day WHERE p.approved_at >= day.start AND p.approved_at < day.start + interval '1 day'
             AND p.status IN ('paid', 'partial_refunded', 'refunded')) AS paid,
          (SELECT coalesce(sum(r.amount), 0)::int FROM refunds r, day WHERE r.created_at >= day.start AND r.created_at < day.start + interval '1 day'
             AND r.status = 'succeeded') AS refunded`)),
      // 처리 대기: 결제 완료(배송 준비 전), 배송 준비 중, 반품·교환 요청
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ paid: number; preparing: number; returns: number }[]>`
        SELECT (SELECT count(*)::int FROM orders WHERE status = 'paid') AS paid,
               (SELECT count(*)::int FROM orders WHERE status = 'preparing') AS preparing,
               (SELECT count(*)::int FROM returns WHERE status = 'requested') AS returns`),
      this.prisma.product.count({ where: { stock: { lte: lowStockThreshold } } }),
      this.prisma.product.findMany({ where: { stock: { lte: lowStockThreshold } }, select: { id: true, name: true, stock: true }, orderBy: [{ stock: "asc" }, { id: "asc" }], take: 10 }),
      this.prisma.reconciliationIssue.count({ where: { resolvedAt: null } }),
      this.searchStats.zeroResults(10),
    ]);
    const t = today[0]!;
    const p = pending[0]!;
    return {
      today: { date: t.date, orders: t.orders, paidAmount: t.paid, refundedAmount: t.refunded, netSales: t.paid - t.refunded, href: "/admin/orders" },
      pending: {
        paid: { count: p.paid, href: "/admin/orders?status=paid" },
        preparing: { count: p.preparing, href: "/admin/orders?status=preparing" },
        returnsRequested: { count: p.returns, href: "/admin/orders?returns=requested" },
      },
      lowStock: { threshold: lowStockThreshold, count: lowStock, items: lowStockItems, href: "/admin/products" },
      zeroResultQueries: { items: zero, href: "/shop/search" },
      reconciliation: { unresolved, href: "/admin/reconciliation" },
    };
  }
}
