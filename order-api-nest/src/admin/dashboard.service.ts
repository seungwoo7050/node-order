import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SearchStats } from "../search/search-stats.js";
import { StoreSettingsService } from "./store-settings.service.js";

export type DashboardScope = "all" | "post_seed" | "seed_only";

type Tile<T> = T & { href: string };
export type Dashboard = {
  today: Tile<{ date: string; orders: number; paidAmount: number; refundedAmount: number; netSales: number }>;
  pending: { paid: Tile<{ count: number }>; preparing: Tile<{ count: number }>; returnsRequested: Tile<{ count: number }> };
  lowStock: Tile<{ threshold: number; count: number; items: { id: number; name: string; stock: number }[] }>;
  zeroResultQueries: Tile<{ items: { query: string; count: number }[] }>;
  reconciliation: Tile<{ unresolved: number }>;
  pipelineFunnel: {
    pendingPayment: number;
    paid: number;
    preparing: number;
    shipped: number;
    delivered: number;
    confirmed: number;
    canceled: number;
  };
  guestVsMember: {
    memberOrders: number;
    guestOrders: number;
    memberRatio: number;
    guestRatio: number;
  };
  bestSellers: { productId: number; name: string; quantity: number; totalSales: number }[];
  lowStockVariants: { id: number; productId: number; productName: string; variantName: string; stock: number }[];
  recentSales: { date: string; amount: number }[];
  dataOrigin: {
    scope: DashboardScope;
    seedOrders: number;
    postSeedOrders: number;
    seedPaidAmount: number;
    postSeedPaidAmount: number;
    seedUsers: number;
    postSeedUsers: number;
  };
};

// 시드·데모 초기 샘플 데이터 조건:
// 1) payment.provider = 'manual' (seed.ts 및 createDemoUser가 생성한 샘플 결제)
// 2) payment가 없고 배송지(recipient_name)도 없는 초기 미결제 시드 주문
// 3) 임시 데모 사용자(expires_at IS NOT NULL)의 주문
const SEED_ORDER_COND = Prisma.sql`(
  EXISTS (SELECT 1 FROM payments sp WHERE sp.order_id = o.id AND sp.provider = 'manual')
  OR (NOT EXISTS (SELECT 1 FROM payments sp WHERE sp.order_id = o.id) AND o.recipient_name IS NULL)
  OR EXISTS (SELECT 1 FROM users su WHERE su.id = o.user_id AND su.expires_at IS NOT NULL)
)`;

// 하루 경계는 서버·DB 세션 시간대에 기대지 않고 쿼리에 Asia/Seoul을 적는다.
// 칸은 timestamp(시간대 없음, UTC로 저장)라서 KST 자정을 UTC 시각으로 바꿔 범위로 비교한다(인덱스를 쓸 수 있게).
// 기준 시각은 DB의 now()가 아니라 인자로 받는다(테스트가 시각을 고정해 자정 근처에도 흔들리지 않게)
// 관리자 대시보드 타일. 캐시하지 않는다(관리자 한 명, 작은 쿼리 몇 개)
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchStats: SearchStats,
    private readonly settings: StoreSettingsService,
  ) {}

  async get(now: Date = new Date(), scope: DashboardScope = "all"): Promise<Dashboard> {
    const at = now.toISOString();
    const { lowStockThreshold } = await this.settings.get();
    const orderScopeCond =
      scope === "post_seed"
        ? Prisma.sql`AND NOT ${SEED_ORDER_COND}`
        : scope === "seed_only"
          ? Prisma.sql`AND ${SEED_ORDER_COND}`
          : Prisma.empty;
    const paymentScopeCond =
      scope === "post_seed"
        ? Prisma.sql`AND p.provider != 'manual' AND NOT EXISTS (SELECT 1 FROM orders so JOIN users su ON su.id = so.user_id WHERE so.id = p.order_id AND su.expires_at IS NOT NULL)`
        : scope === "seed_only"
          ? Prisma.sql`AND (p.provider = 'manual' OR EXISTS (SELECT 1 FROM orders so JOIN users su ON su.id = so.user_id WHERE so.id = p.order_id AND su.expires_at IS NOT NULL))`
          : Prisma.empty;

    const [
      today,
      pending,
      lowStock,
      lowStockItems,
      unresolved,
      zero,
      funnelRows,
      guestMemberRows,
      bestSellerRows,
      lowStockVariantRows,
      recentSalesRows,
      originSummaryRows,
    ] = await Promise.all([
      // 오늘 결제된 주문(승인 시각 기준)과 순매출 = 오늘 승인된 결제액 − 오늘 요청해 성공한 환불액(어제 주문의 환불도 오늘 매출에서 뺀다)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ date: string; orders: number; paid: number; refunded: number }[]>`
        WITH day AS (SELECT (date_trunc('day', ${at}::timestamptz AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC' AS start)
        SELECT to_char(${at}::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
          (SELECT count(*)::int FROM payments p, day WHERE p.approved_at >= day.start AND p.approved_at < day.start + interval '1 day'
             AND p.status IN ('paid', 'partial_refunded', 'refunded') ${paymentScopeCond}) AS orders,
          (SELECT coalesce(sum(p.amount), 0)::int FROM payments p, day WHERE p.approved_at >= day.start AND p.approved_at < day.start + interval '1 day'
             AND p.status IN ('paid', 'partial_refunded', 'refunded') ${paymentScopeCond}) AS paid,
          (SELECT coalesce(sum(r.amount), 0)::int FROM refunds r JOIN payments p ON p.id = r.payment_id, day WHERE r.created_at >= day.start AND r.created_at < day.start + interval '1 day'
             AND r.status = 'succeeded' ${paymentScopeCond}) AS refunded`),
      // 처리 대기: 결제 완료(배송 준비 전), 배송 준비 중, 반품·교환 요청
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ paid: number; preparing: number; returns: number }[]>`
        SELECT (SELECT count(*)::int FROM orders o WHERE o.status = 'paid' ${orderScopeCond}) AS paid,
               (SELECT count(*)::int FROM orders o WHERE o.status = 'preparing' ${orderScopeCond}) AS preparing,
               (SELECT count(*)::int FROM returns rt JOIN orders o ON o.id = rt.order_id WHERE rt.status = 'requested' ${orderScopeCond}) AS returns`),
      this.prisma.product.count({ where: { deletedAt: null, stock: { lte: lowStockThreshold } } }),
      this.prisma.product.findMany({
        where: { deletedAt: null, stock: { lte: lowStockThreshold } },
        select: { id: true, name: true, stock: true },
        orderBy: [{ stock: "asc" }, { id: "asc" }],
        take: 10,
      }),
      this.prisma.reconciliationIssue.count({ where: { resolvedAt: null } }),
      this.searchStats.zeroResults(10),

      // 6단계 주문 파이프라인 퍼널 (상태별 전체 주문 수)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ status: string; count: number }[]>`
        SELECT o.status::text AS status, count(*)::int AS count
        FROM orders o
        WHERE 1=1 ${orderScopeCond}
        GROUP BY o.status`),

      // 회원 vs 비회원 비중 (취소 제외)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ is_guest: boolean; count: number }[]>`
        SELECT o.is_guest, count(*)::int AS count
        FROM orders o
        WHERE o.status != 'canceled' ${orderScopeCond}
        GROUP BY o.is_guest`),

      // 베스트셀러 TOP 5 (취소되지 않은 주문의 상품별 판매량 및 매출)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ product_id: number; name: string; quantity: number; sales: number }[]>`
        SELECT p.id AS product_id, p.name,
               COALESCE(SUM(oi.quantity), 0)::int AS quantity,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0)::int AS sales
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.status != 'canceled' ${orderScopeCond}
        GROUP BY p.id, p.name
        ORDER BY quantity DESC, sales DESC
        LIMIT 5`),

      // 품절 임박 옵션 (ProductVariant 중 재고 부족)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ id: number; product_id: number; product_name: string; variant_name: string; stock: number }[]>`
        SELECT pv.id, pv.product_id, p.name AS product_name, pv.name AS variant_name, pv.stock
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.deleted_at IS NULL AND pv.stock <= ${lowStockThreshold}
        ORDER BY pv.stock ASC, pv.id ASC
        LIMIT 10`),

      // 최근 결제일자 기준 7일 매출 추이 (DB에 존재하는 최근 결제일 기준, `now`와 무관하여 불일치 방지)
      this.prisma.asAdmin((tx) => tx.$queryRaw<{ date: string; amount: number }[]>`
        SELECT to_char(p.approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
               COALESCE(SUM(p.amount), 0)::int AS amount
        FROM payments p
        WHERE p.status IN ('paid', 'partial_refunded', 'refunded')
          AND p.approved_at IS NOT NULL
          ${paymentScopeCond}
        GROUP BY to_char(p.approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
        ORDER BY date DESC
        LIMIT 7`),

      // 시드 데이터 vs 시드 이후 데이터 구분 집계
      this.prisma.asAdmin((tx) => tx.$queryRaw<{
        seed_orders: number;
        post_seed_orders: number;
        seed_paid_amount: number;
        post_seed_paid_amount: number;
        seed_users: number;
        post_seed_users: number;
      }[]>`
        SELECT
          (SELECT count(*)::int FROM orders o WHERE ${SEED_ORDER_COND}) AS seed_orders,
          (SELECT count(*)::int FROM orders o WHERE NOT ${SEED_ORDER_COND}) AS post_seed_orders,
          (SELECT coalesce(sum(p.amount), 0)::int FROM payments p WHERE p.status IN ('paid', 'partial_refunded', 'refunded')
             AND (p.provider = 'manual' OR EXISTS (SELECT 1 FROM orders so JOIN users su ON su.id = so.user_id WHERE so.id = p.order_id AND su.expires_at IS NOT NULL))) AS seed_paid_amount,
          (SELECT coalesce(sum(p.amount), 0)::int FROM payments p WHERE p.status IN ('paid', 'partial_refunded', 'refunded')
             AND p.provider != 'manual' AND NOT EXISTS (SELECT 1 FROM orders so JOIN users su ON su.id = so.user_id WHERE so.id = p.order_id AND su.expires_at IS NOT NULL)) AS post_seed_paid_amount,
          (SELECT count(*)::int FROM users u WHERE u.id IN ('kim', 'lee', 'park', 'choi') OR u.expires_at IS NOT NULL) AS seed_users,
          (SELECT count(*)::int FROM users u WHERE u.id NOT IN ('kim', 'lee', 'park', 'choi') AND u.expires_at IS NULL) AS post_seed_users`),
    ]);

    const t = today[0]!;
    const p = pending[0]!;
    const origin = originSummaryRows[0]!;

    const funnelMap = new Map(funnelRows.map((r) => [r.status, r.count]));
    const pipelineFunnel = {
      pendingPayment: funnelMap.get("pending_payment") ?? 0,
      paid: funnelMap.get("paid") ?? 0,
      preparing: funnelMap.get("preparing") ?? 0,
      shipped: funnelMap.get("shipped") ?? 0,
      delivered: funnelMap.get("delivered") ?? 0,
      confirmed: funnelMap.get("confirmed") ?? 0,
      canceled: funnelMap.get("canceled") ?? 0,
    };

    let memberOrders = 0;
    let guestOrders = 0;
    for (const r of guestMemberRows) {
      if (r.is_guest) guestOrders += r.count;
      else memberOrders += r.count;
    }
    const totalOrdersCount = memberOrders + guestOrders;
    const memberRatio = totalOrdersCount > 0 ? Math.round((memberOrders / totalOrdersCount) * 100) : 0;
    const guestRatio = totalOrdersCount > 0 ? 100 - memberRatio : 0;

    const bestSellers = bestSellerRows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      quantity: r.quantity,
      totalSales: r.sales,
    }));

    const lowStockVariants = lowStockVariantRows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      variantName: r.variant_name,
      stock: r.stock,
    }));

    const recentSales = recentSalesRows.reverse();

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
      pipelineFunnel,
      guestVsMember: {
        memberOrders,
        guestOrders,
        memberRatio,
        guestRatio,
      },
      bestSellers,
      lowStockVariants,
      recentSales,
      dataOrigin: {
        scope,
        seedOrders: origin.seed_orders,
        postSeedOrders: origin.post_seed_orders,
        seedPaidAmount: origin.seed_paid_amount,
        postSeedPaidAmount: origin.post_seed_paid_amount,
        seedUsers: origin.seed_users,
        postSeedUsers: origin.post_seed_users,
      },
    };
  }
}
