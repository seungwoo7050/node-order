import { Logger, type INestApplication } from "@nestjs/common";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service.js";
import { DAY_MS } from "../src/fulfillment/policy.js";
import { FakeMailer } from "../src/mail/fake-mailer.js";
import { PaymentGateways } from "../src/payments/payment-gateways.js";
import { TossGateway } from "../src/payments/toss.gateway.js";
import { resolveStaleRefunds } from "../src/payments/refund-resolver.js";
import { RefundsService } from "../src/payments/refunds.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { SHIPPING, client, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 주문 이행: 토스 시뮬레이터로 결제를 끝낸 주문을 관리자·손님 API로 움직인다.
// 상품 20,000원(배송비 3,000원, 1개 결제 23,000원), 재고 10
describe("주문 이행 - 배송·취소·반품·교환", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    process.env.PAYMENT_TIMEOUT_MS = "400";
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
  });

  beforeEach(async () => {
    await sim.reset();
    tokens = await seedPaymentData(baseUrl, 20_000);
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    delete process.env.PAYMENT_TIMEOUT_MS;
    await sim.stop();
    await app.close();
  });

  const user = () => client(baseUrl, tokens.user);
  const admin = () => client(baseUrl, tokens.admin);
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;
  const statusOf = async (orderId: number) => (await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).status;
  const refundCalls = async () => (await sim.calls()).cancel; // 토스 환불 = 결제 취소 API

  // 토스로 결제를 끝낸 주문
  const paidOrder = async (quantity = 1) => {
    const started = await user().post("/orders/checkout", { items: [{ productId: 1, quantity }], shipping: SHIPPING, provider: "toss" });
    expect(started.status).toBe(201);
    const payment = await paymentOf(started.body.id);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    expect((await user().post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: payment.amount })).status).toBe(200);
    return started.body.id as number;
  };
  const ship = (orderId: number, carrier = "cj", trackingNumber = "123456789012") =>
    admin().post(`/admin/orders/${orderId}/shipment`, { carrier, trackingNumber });
  const deliveredOrder = async (quantity = 1) => {
    const id = await paidOrder(quantity);
    expect((await admin().post(`/admin/orders/${id}/prepare`)).status).toBe(200);
    expect((await ship(id)).status).toBe(200);
    expect((await admin().post(`/admin/orders/${id}/deliver`)).status).toBe(200);
    return id;
  };
  const requestReturn = (orderId: number, body: Record<string, unknown> = {}) =>
    user().post(`/me/orders/${orderId}/returns`, { kind: "refund", reason: "change_of_mind", items: [{ productId: 1, quantity: 1 }], ...body });

  describe("상태 전이", () => {
    it("결제 승인은 pending_payment → paid 이력을 남기고, 관리자 상세에는 지금 허용된 동작만 실린다", async () => {
      const id = await paidOrder();
      expect(await statusOf(id)).toBe("paid");
      const detail = await admin().get(`/admin/orders/${id}`);
      expect(detail.body).toMatchObject({ status: "paid", price: 23_000, subtotal: 20_000, shippingFee: 3_000, actions: ["prepare", "cancel"] });
      expect(detail.body.shipping).toMatchObject({ recipientName: "김구매", postalCode: "06236" });
      expect(detail.body.history).toMatchObject([{ fromStatus: "pending_payment", toStatus: "paid", actorType: "system" }]);
    });

    it("허용되지 않은 전이는 409와 지금 상태를 돌려준다", async () => {
      const id = await paidOrder();
      const early = await ship(id);
      expect(early.status).toBe(409);
      expect(early.body.currentStatus).toBe("paid");
      expect((await admin().post(`/admin/orders/${id}/deliver`)).body).toMatchObject({ statusCode: 409, currentStatus: "paid" });
      expect((await user().post(`/me/orders/${id}/confirm`)).body).toMatchObject({ statusCode: 409, currentStatus: "paid" });
      expect(await statusOf(id)).toBe("paid");
    });

    it("같은 주문에 송장 입력을 동시에 두 번 보내면 하나만 성공하고 이력·송장은 한 행", async () => {
      const id = await paidOrder();
      await admin().post(`/admin/orders/${id}/prepare`);
      const results = await Promise.all([ship(id, "cj", "111111111111"), ship(id, "hanjin", "222222222222")]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.currentStatus).toBe("shipped");
      expect(await adminDb.orderStatusHistory.count({ where: { orderId: id, toStatus: "shipped" } })).toBe(1);
      expect(await adminDb.shipment.count({ where: { orderId: id } })).toBe(1);
    });

    it("택배사별 조회 링크가 템플릿대로 만들어지고, 목록에 없는 택배사·잘못된 송장번호는 400", async () => {
      const id = await paidOrder();
      await admin().post(`/admin/orders/${id}/prepare`);
      expect((await ship(id, "dhl")).status).toBe(400);
      expect((await ship(id, "cj", "abc")).status).toBe(400);
      expect(await statusOf(id)).toBe("preparing");
      const shipped = await ship(id, "logen", "1234-5678-9012");
      expect(shipped.status).toBe(200);
      expect(shipped.body.shipments).toMatchObject([{ carrier: "logen", carrierName: "로젠택배", trackingNumber: "123456789012", trackingUrl: "https://www.ilogen.com/web/personal/trace/123456789012" }]);
      const mine = await user().get(`/me/orders/${id}`);
      expect(mine.body.shipments[0].trackingUrl).toBe("https://www.ilogen.com/web/personal/trace/123456789012");
      expect(mine.body.status).toBe("shipped");
    });

    it("관리자 목록은 상태로 거른다. 데모 관리자는 보기만 되고 상태를 바꾸면 403", async () => {
      const a = await paidOrder();
      const b = await paidOrder();
      await admin().post(`/admin/orders/${b}/prepare`);
      const preparing = await admin().get("/admin/orders?status=preparing");
      expect(preparing.body.items.map((o: { id: number }) => o.id)).toEqual([b]);
      expect((await admin().get("/admin/orders?status=nope")).status).toBe(400);

      const demo = client(baseUrl, (await (await fetch(`${baseUrl}/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as: "admin" }) })).json()).accessToken);
      expect((await demo.get("/admin/orders")).status).toBe(200);
      expect((await demo.get(`/admin/orders/${a}`)).status).toBe(200);
      expect((await demo.post(`/admin/orders/${a}/prepare`)).status).toBe(403);
      expect(await statusOf(a)).toBe("paid");
      expect((await user().get("/admin/orders")).status).toBe(403);
    });

    it("손님은 배송 완료된 주문을 구매확정할 수 있고, 다시 누르면 409", async () => {
      const id = await deliveredOrder();
      const confirmed = await user().post(`/me/orders/${id}/confirm`);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({ status: "confirmed", canConfirm: false, canReturn: false });
      expect((await user().post(`/me/orders/${id}/confirm`)).body).toMatchObject({ statusCode: 409, currentStatus: "confirmed" });
      expect((await client(baseUrl, tokens.admin).post(`/me/orders/${id}/confirm`)).status).toBe(404); // 남의 주문
    });
  });

  describe("취소", () => {
    it("결제 완료 주문을 취소하면 PG 환불 1회·재고 복구 1회. 연달아 다시 눌러도 같다", async () => {
      const id = await paidOrder(2);
      expect(await stock()).toBe(8);
      const first = await admin().post(`/admin/orders/${id}/cancel`, { reason: "품절" });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ replayed: false, refund: { amount: 43_000, status: "succeeded" }, order: { status: "canceled", actions: [] } });
      const again = await admin().post(`/admin/orders/${id}/cancel`);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ replayed: true, refund: { id: first.body.refund.id, status: "succeeded" } });
      expect(await stock()).toBe(10);
      expect(await refundCalls()).toBe(1);
      expect(await adminDb.refund.count()).toBe(1);
      expect((await paymentOf(id)).status).toBe("refunded");
      expect(await adminDb.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "canceled", paid: true, canceledAt: expect.any(Date) });
    });

    it("동시에 세 번 눌러도 PG 환불 1회·재고 복구 1회", async () => {
      const id = await paidOrder();
      await admin().post(`/admin/orders/${id}/prepare`);
      const results = await Promise.all(Array.from({ length: 3 }, () => admin().post(`/admin/orders/${id}/cancel`)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(await stock()).toBe(10);
      expect(await refundCalls()).toBe(1);
      expect(await adminDb.refund.count()).toBe(1);
      expect(await adminDb.orderStatusHistory.count({ where: { orderId: id, toStatus: "canceled" } })).toBe(1);
    });

    it("배송이 시작된 주문과 결제 전 주문은 취소할 수 없다(409)", async () => {
      const id = await paidOrder();
      await admin().post(`/admin/orders/${id}/prepare`);
      await ship(id);
      expect((await admin().post(`/admin/orders/${id}/cancel`)).body).toMatchObject({ statusCode: 409, currentStatus: "shipped" });
      const unpaid = await user().post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, provider: "toss" });
      expect((await admin().post(`/admin/orders/${unpaid.body.id}/cancel`)).body).toMatchObject({ statusCode: 409, currentStatus: "pending_payment" });
      expect(await refundCalls()).toBe(0);
    });
  });

  describe("반품", () => {
    it("배송 완료 뒤 7일 안에는 신청된다. 7일이 지났거나 구매확정 뒤면 409", async () => {
      const id = await deliveredOrder(2);
      const ok = await requestReturn(id);
      expect(ok.status).toBe(201);
      expect(ok.body.returns).toMatchObject([{ kind: "refund", status: "requested", reason: "change_of_mind", items: [{ productId: 1, quantity: 1 }] }]);
      expect(ok.body.canConfirm).toBe(false); // 처리 중인 요청이 있으면 구매확정을 미룬다
      expect((await requestReturn(id, { items: [{ productId: 1, quantity: 2 }] })).status).toBe(400); // 남은 수량은 1개

      const late = await deliveredOrder();
      await adminDb.order.update({ where: { id: late }, data: { deliveredAt: new Date(Date.now() - 8 * DAY_MS) } });
      expect((await user().get(`/me/orders/${late}`)).body.canReturn).toBe(false);
      expect((await requestReturn(late)).body).toMatchObject({ statusCode: 409, currentStatus: "delivered" });

      const confirmed = await deliveredOrder();
      await user().post(`/me/orders/${confirmed}/confirm`);
      expect((await requestReturn(confirmed)).body).toMatchObject({ statusCode: 409, currentStatus: "confirmed" });

      const shipped = await paidOrder();
      expect((await requestReturn(shipped)).body).toMatchObject({ statusCode: 409, currentStatus: "paid" });
    });

    it("단순변심 반품 승인: 왕복 배송비 6,000원을 뺀 금액을 환불하고, 두 번 눌러도 환불·재고 복구는 1회", async () => {
      const id = await deliveredOrder();
      expect(await stock()).toBe(9);
      const { body } = await requestReturn(id);
      const returnId = body.returns[0].id as number;
      const first = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ replayed: false, refund: { amount: 14_000, status: "succeeded" } });
      expect(first.body.order.returns[0]).toMatchObject({ status: "completed", refundAmount: 14_000, refund: { amount: 14_000, status: "succeeded" } });
      const again = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(await refundCalls()).toBe(1);
      expect(await adminDb.refund.count()).toBe(1);
      expect(await stock()).toBe(10);
      expect((await paymentOf(id)).status).toBe("partial_refunded");
      const mine = await user().get(`/me/orders/${id}`);
      expect(mine.body.returns[0]).toMatchObject({ status: "completed", refund: { amount: 14_000, status: "succeeded" } });
    });

    it("상품 하자면 항목 금액 전액을 환불한다", async () => {
      const id = await deliveredOrder();
      const { body } = await requestReturn(id, { reason: "defective", detail: "전원이 안 켜짐" });
      const approved = await admin().post(`/admin/returns/${body.returns[0].id}/approve`);
      expect(approved.body.refund).toMatchObject({ amount: 20_000, status: "succeeded" });
    });

    it("환불이 시간 초과면 반품은 approved로 남고, 환불 확정 명령 뒤 자동 작업이 완료로 바꾼다", async () => {
      const id = await deliveredOrder();
      const { body } = await requestReturn(id, { reason: "wrong_item" });
      const returnId = body.returns[0].id as number;
      await sim.fault("cancel", "timeout", { delayMs: 1_500 });
      const approved = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body.refund).toMatchObject({ amount: 20_000, status: "requested" });
      expect(await adminDb.return.findUniqueOrThrow({ where: { id: returnId } })).toMatchObject({ status: "approved" });

      const service = app.get(FulfillmentService);
      expect((await service.autoAdvance(new Date())).returnsCompleted).toBe(0); // 아직 결과를 모른다
      const deps = { prisma: app.get(PrismaService), gateways: app.get(PaymentGateways), refunds: app.get(RefundsService) };
      expect(await resolveStaleRefunds(deps, { olderThanMs: 0 })).toMatchObject({ succeeded: 1 });
      expect((await service.autoAdvance(new Date())).returnsCompleted).toBe(1);
      expect((await service.autoAdvance(new Date())).returnsCompleted).toBe(0);
      expect(await adminDb.return.findUniqueOrThrow({ where: { id: returnId } })).toMatchObject({ status: "completed" });
      expect(await refundCalls()).toBe(1);
      expect(await stock()).toBe(10);
    });

    it("거절하면 환불·재고 변화가 없고, 거절된 수량은 다시 신청할 수 있다", async () => {
      const id = await deliveredOrder();
      const { body } = await requestReturn(id);
      const rejected = await admin().post(`/admin/returns/${body.returns[0].id}/reject`, { reason: "사용 흔적" });
      expect(rejected.status).toBe(200);
      expect(rejected.body.returns[0]).toMatchObject({ status: "rejected", rejectReason: "사용 흔적", actions: [] });
      expect((await admin().post(`/admin/returns/${body.returns[0].id}/approve`)).body).toMatchObject({ statusCode: 409, currentStatus: "rejected" });
      expect(await refundCalls()).toBe(0);
      expect(await stock()).toBe(9);
      expect((await requestReturn(id)).status).toBe(201);
    });
  });

  describe("교환", () => {
    it("승인하면 환불 0회, 반품 수량 복구와 교환품 수량 차감, 그 뒤 새 송장을 넣으면 완료", async () => {
      const id = await deliveredOrder(2);
      const { body } = await requestReturn(id, { kind: "exchange", reason: "defective", items: [{ productId: 1, quantity: 2 }] });
      const returnId = body.returns[0].id as number;
      expect(await stock()).toBe(8);
      const approved = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body.refund).toBeNull();
      expect(approved.body.order.returns[0]).toMatchObject({ status: "approved", refundAmount: null, actions: ["ship"] });
      expect(await stock()).toBe(8); // +2(반품) -2(교환품)
      expect(await refundCalls()).toBe(0);

      expect((await admin().post(`/admin/returns/${returnId}/shipment`, { carrier: "dhl", trackingNumber: "999999999999" })).status).toBe(400);
      const shipped = await admin().post(`/admin/returns/${returnId}/shipment`, { carrier: "epost", trackingNumber: "999999999999" });
      expect(shipped.status).toBe(200);
      expect(shipped.body.returns[0]).toMatchObject({ status: "completed", actions: [] });
      expect(shipped.body.shipments.map((s: { returnId: number | null }) => s.returnId)).toEqual([null, returnId]);
      expect(shipped.body.shipments[1].trackingUrl).toBe("https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=999999999999");
      expect((await admin().post(`/admin/returns/${returnId}/shipment`, { carrier: "epost", trackingNumber: "999999999999" })).status).toBe(409);
    });

    it("교환품 재고가 모자라면 409이고 아무것도 바뀌지 않는다", async () => {
      const id = await deliveredOrder(2);
      const { body } = await requestReturn(id, { kind: "exchange", reason: "wrong_item", items: [{ productId: 1, quantity: 2 }] });
      const returnId = body.returns[0].id as number;
      await adminDb.product.update({ where: { id: 1 }, data: { stock: 1 } });
      const res = await admin().post(`/admin/returns/${returnId}/approve`);
      expect(res.status).toBe(409);
      expect(await stock()).toBe(1);
      expect(await adminDb.return.findUniqueOrThrow({ where: { id: returnId } })).toMatchObject({ status: "requested", decidedAt: null });
      expect(await adminDb.outboxEvent.count({ where: { type: "return.approved" } })).toBe(0);
    });
  });

  describe("배송지", () => {
    it("필수 칸이 비었거나 우편번호가 5자리가 아니면 결제를 시작하지 않고 400", async () => {
      const bad = [
        undefined,
        { ...SHIPPING, recipientName: "  " },
        { ...SHIPPING, recipientPhone: "" },
        { ...SHIPPING, address1: undefined },
        { ...SHIPPING, postalCode: "1234" },
        { ...SHIPPING, postalCode: "123456" },
        { ...SHIPPING, postalCode: "12a45" },
        { ...SHIPPING, recipientPhone: "전화 없음" },
      ];
      for (const shipping of bad) {
        const res = await user().post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping, provider: "toss" });
        expect(res.status, JSON.stringify(shipping)).toBe(400);
      }
      expect(await adminDb.order.count()).toBe(0);
      expect(await adminDb.payment.count()).toBe(0);
      expect(await stock()).toBe(10);
    });

    it("주문에 배송지 사본이 붙고, 로그에는 연락처 원문이 남지 않는다(마스킹)", async () => {
      // 앱 코드는 Nest Logger로 남긴다(운영에서는 pino로 나간다). 테스트 모듈의 기본 로거는 오류만 찍으므로 Logger에 넘긴 값을 가로챈다
      const written: string[] = [];
      const spies = (["log", "warn", "error", "debug", "verbose"] as const).map((level) =>
        vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(" "))));
      let id: number;
      try {
        id = await paidOrder();
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
      const log = written.join("\n");
      expect(log).toContain("010-****-6789");
      expect(log).not.toContain("010-2345-6789");
      expect(log).not.toContain("01023456789");
      expect(log).not.toContain("테헤란로");
      expect(await adminDb.order.findUniqueOrThrow({ where: { id } })).toMatchObject({
        recipientName: "김구매", recipientPhone: "010-2345-6789", postalCode: "06236", address1: "서울특별시 강남구 테헤란로 123", address2: "4층", deliveryMemo: "문 앞",
      });
    });
  });

  describe("자동 전이(시계 주입)", () => {
    it("발송 5일 뒤 배송 완료, 배송 완료 7일 뒤 구매확정. 같은 시각으로 두 번 돌려도 같고, 기준일 전 주문은 그대로", async () => {
      const now = new Date("2026-11-20T00:00:00Z");
      const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
      const shippedOld = await paidOrder();
      const shippedNew = await paidOrder();
      const deliveredOld = await paidOrder();
      const deliveredNew = await paidOrder();
      const withReturn = await paidOrder();
      await adminDb.order.updateMany({ where: { id: { in: [shippedOld, shippedNew] } }, data: { status: "shipped" } });
      await adminDb.order.update({ where: { id: shippedOld }, data: { statusChangedAt: ago(5) } }); // 딱 5일
      await adminDb.order.update({ where: { id: shippedNew }, data: { statusChangedAt: ago(4) } });
      await adminDb.order.update({ where: { id: deliveredOld }, data: { status: "delivered", statusChangedAt: ago(8), deliveredAt: ago(8) } });
      await adminDb.order.update({ where: { id: deliveredNew }, data: { status: "delivered", statusChangedAt: ago(6), deliveredAt: ago(6) } });
      await adminDb.order.update({ where: { id: withReturn }, data: { status: "delivered", statusChangedAt: ago(8), deliveredAt: ago(8) } });
      await adminDb.return.create({ data: { orderId: withReturn, kind: "refund", reason: "defective", items: { create: [{ productId: 1, quantity: 1, unitPrice: 20_000 }] } } });

      const service = app.get(FulfillmentService);
      const snapshot = async () => ({
        statuses: await Promise.all([shippedOld, shippedNew, deliveredOld, deliveredNew, withReturn].map(statusOf)),
        history: await adminDb.orderStatusHistory.count(),
        notices: await adminDb.outboxEvent.count({ where: { type: "order.delivered" } }),
      });
      expect(await service.autoAdvance(now)).toMatchObject({ delivered: 1, confirmed: 1, returnsCompleted: 0 });
      const once = await snapshot();
      expect(once.statuses).toEqual(["delivered", "shipped", "confirmed", "delivered", "delivered"]);
      expect(await service.autoAdvance(now)).toEqual({ expired: 0, paidOnRecheck: 0, delivered: 0, confirmed: 0, returnsCompleted: 0 });
      expect(await snapshot()).toEqual(once);
      // 방금 배송 완료가 된 주문은 그 시각부터 7일을 센다
      expect(await adminDb.order.findUniqueOrThrow({ where: { id: shippedOld } })).toMatchObject({ deliveredAt: now, statusChangedAt: now });
      expect(await adminDb.orderStatusHistory.findFirstOrThrow({ where: { orderId: shippedOld, toStatus: "delivered" } })).toMatchObject({ actorType: "system", createdAt: now });
      expect(await service.autoAdvance(new Date(now.getTime() + 7 * DAY_MS))).toMatchObject({ delivered: 1, confirmed: 2 });
    });
  });

  describe("결제 기한(시계 주입)", () => {
    const HOUR_MS = 60 * 60 * 1000;
    const startToss = async () => {
      const started = await user().post("/orders/checkout", { items: [{ productId: 1, quantity: 2 }], shipping: SHIPPING, provider: "toss" });
      expect(started.status).toBe(201);
      return { id: started.body.id as number, payment: await paymentOf(started.body.id) };
    };

    it("pending_payment가 24시간을 넘으면 canceled + 재고 복구, 두 번 돌려도 한 번. 24시간 전 주문은 그대로", async () => {
      const old = await startToss();
      const fresh = await startToss();
      expect(await stock()).toBe(6);
      const now = new Date(Date.now() + 24 * HOUR_MS + 60_000); // old·fresh 모두 만든 지 24시간 1분
      await adminDb.order.update({ where: { id: fresh.id }, data: { createdAt: new Date(now.getTime() - 23 * HOUR_MS) } });
      const service = app.get(FulfillmentService);
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 1, paidOnRecheck: 0 });
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 0, paidOnRecheck: 0 });
      expect(await statusOf(old.id)).toBe("canceled");
      expect(await statusOf(fresh.id)).toBe("pending_payment");
      expect(await stock()).toBe(8);
      expect((await paymentOf(old.id)).status).toBe("canceled");
      expect(await adminDb.orderStatusHistory.findMany({ where: { orderId: old.id } })).toMatchObject([
        { fromStatus: "pending_payment", toStatus: "canceled", actorType: "system", createdAt: now },
      ]);
      expect((await sim.calls()).fetch).toBeGreaterThan(0); // 취소하기 전에 PG에 물었다
    });

    it("PG에서 이미 승인된 결제(승인 응답을 잃음)는 취소하지 않고 결제 완료로 반영한다", async () => {
      const lost = await startToss();
      const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: lost.payment.providerOrderId, amount: lost.payment.amount });
      await app.get(TossGateway).confirm({ providerOrderId: lost.payment.providerOrderId, amount: lost.payment.amount, paymentKey }, "lost-confirm");
      expect((await paymentOf(lost.id)).status).toBe("ready");
      const now = new Date(Date.now() + 25 * HOUR_MS);
      const service = app.get(FulfillmentService);
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 0, paidOnRecheck: 1 });
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 0, paidOnRecheck: 0 });
      expect(await statusOf(lost.id)).toBe("paid");
      expect(await paymentOf(lost.id)).toMatchObject({ status: "paid", providerPaymentKey: paymentKey });
      expect(await stock()).toBe(8); // 재고는 결제된 주문의 것이라 돌려놓지 않는다
      expect(await adminDb.outboxEvent.count({ where: { type: "order.paid" } })).toBe(1);
    });

    it("PG 조회가 실패하면 취소하지 않고 다음 회차에 다시 본다", async () => {
      const o = await startToss();
      await sim.fault("fetch", "unavailable");
      const now = new Date(Date.now() + 25 * HOUR_MS);
      const service = app.get(FulfillmentService);
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 0 });
      expect(await statusOf(o.id)).toBe("pending_payment");
      expect(await service.autoAdvance(now)).toMatchObject({ expired: 1 });
      expect(await stock()).toBe(10);
    });
  });

  describe("알림 메일", () => {
    it("상태가 바뀔 때마다 fake mailer가 그 템플릿 메일을 정확히 1통 받는다", async () => {
      const mailer = app.get(FakeMailer);
      mailer.sent.length = 0;
      const delivered = await deliveredOrder();
      const { body } = await requestReturn(delivered);
      await admin().post(`/admin/returns/${body.returns[0].id}/approve`);
      const second = await requestReturn(delivered, { reason: "defective" });
      expect(second.status).toBe(400); // 1개 주문이라 남은 수량이 없다
      const rejectedOrder = await deliveredOrder();
      const r2 = await requestReturn(rejectedOrder);
      await admin().post(`/admin/returns/${r2.body.returns[0].id}/reject`, { reason: "기간 확인 필요" });
      const canceled = await paidOrder();
      await admin().post(`/admin/orders/${canceled}/cancel`);

      const expected: [number, string][] = [
        ...["order.paid", "order.preparing", "order.shipped", "order.delivered", "return.approved"].map((t) => [delivered, t] as [number, string]),
        ...["order.paid", "order.preparing", "order.shipped", "order.delivered", "return.rejected"].map((t) => [rejectedOrder, t] as [number, string]),
        [canceled, "order.paid"], [canceled, "order.canceled"],
      ];
      const count = (orderId: number, template: string) => mailer.sent.filter((m) => m.orderId === orderId && m.template === template).length;
      await vi.waitFor(() => {
        for (const [orderId, template] of expected) expect(count(orderId, template), `${template} #${orderId}`).toBe(1);
      }, { timeout: 15_000, interval: 200 });
      await new Promise((r) => setTimeout(r, 1_200)); // relay가 한 바퀴 더 돌아도 늘지 않는다
      for (const [orderId, template] of expected) expect(count(orderId, template), `${template} #${orderId}`).toBe(1);
      expect(mailer.sent.find((m) => m.orderId === delivered && m.template === "order.shipped")!.subject).toBe(`주문 #${delivered} 발송: CJ대한통운 123456789012`);
      expect(mailer.sent.find((m) => m.orderId === delivered && m.template === "return.approved")!.subject).toContain("14,000원 환불");
    });
  });
});
