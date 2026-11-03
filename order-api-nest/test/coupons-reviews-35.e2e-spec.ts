import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { FakeStripeGateway } from "./fake-stripe.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { adminDb } from "./admin-db.js";

describe("35-coupons-reviews E2E Tests", () => {
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;
  let userToken: string;
  let otherUserToken: string;
  let productId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeGateway)
      .useClass(FakeStripeGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE coupons, reviews, categories, refresh_tokens, outbox_events, idempotency_keys, return_items, returns, shipments, payments, refunds, order_status_history, order_items, orders, product_images, product_variants, products, integration_secrets, users RESTART IDENTITY CASCADE`;
    await adminDb.$executeRaw`UPDATE system_controls SET pause_paid_apis = false, maintenance_mode = false`;

    await adminDb.user.create({ data: { id: "admin", name: "관리자", role: "admin", passwordHash: await hashPassword("admin1234!") } });
    await adminDb.user.create({ data: { id: "user1", name: "김철수", role: "user", passwordHash: await hashPassword("user1234!") } });
    await adminDb.user.create({ data: { id: "user2", name: "이영희", role: "user", passwordHash: await hashPassword("user1234!") } });

    // admin login
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin1234!" }),
    });
    adminToken = ((await adminLoginRes.json()) as { accessToken: string }).accessToken;

    // user1 login
    const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user1", password: "user1234!" }),
    });
    userToken = ((await userLoginRes.json()) as { accessToken: string }).accessToken;

    // user2 login
    const user2LoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user2", password: "user1234!" }),
    });
    otherUserToken = ((await user2LoginRes.json()) as { accessToken: string }).accessToken;

    // Create a product
    const p = await adminDb.product.create({
      data: {
        name: "테스트 셔츠",
        price: 30000,
        stock: 50,
        variants: {
          create: [
            { name: "화이트 / M", stock: 20, priceDelta: 0 },
            { name: "블랙 / L", stock: 30, priceDelta: 2000 },
          ],
        },
      },
      include: { variants: true },
    });
    productId = p.id;
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  describe("관리자 쿠폰 CRUD 및 검증", () => {
    it("관리자가 정액/정률 쿠폰을 생성하고 조회할 수 있다", async () => {
      // Create fixed coupon
      const resFixed = await fetch(`${baseUrl}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          code: "FIXED5000",
          name: "5000원 할인 쿠폰",
          discountType: "fixed",
          discountValue: 5000,
          minOrderAmount: 20000,
          maxUses: 10,
        }),
      });
      expect(resFixed.status).toBe(201);
      const fixed = await resFixed.json();
      expect(fixed.code).toBe("FIXED5000");
      expect(fixed.discountType).toBe("fixed");
      expect(fixed.discountValue).toBe(5000);
      expect(fixed.maxUses).toBe(10);
      expect(fixed.usedCount).toBe(0);

      // Create percent coupon
      const resPercent = await fetch(`${baseUrl}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          code: "PERCENT10",
          name: "10% 할인 쿠폰",
          discountType: "percent",
          discountValue: 10,
          minOrderAmount: 10000,
          maxDiscountAmount: 4000,
        }),
      });
      expect(resPercent.status).toBe(201);

      // Duplicate code returns 409
      const resDup = await fetch(`${baseUrl}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          code: "fixed5000",
          name: "중복 쿠폰",
          discountType: "fixed",
          discountValue: 1000,
        }),
      });
      expect(resDup.status).toBe(409);

      // List coupons
      const resList = await fetch(`${baseUrl}/admin/coupons`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resList.status).toBe(200);
      const list = await resList.json();
      expect(list.length).toBe(2);

      // Update coupon
      const resPatch = await fetch(`${baseUrl}/admin/coupons/${fixed.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ active: false, name: "비활성화된 5000원 쿠폰" }),
      });
      expect(resPatch.status).toBe(200);
      const patched = await resPatch.json();
      expect(patched.active).toBe(false);
      expect(patched.name).toBe("비활성화된 5000원 쿠폰");

      // Delete coupon
      const resDel = await fetch(`${baseUrl}/admin/coupons/${fixed.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resDel.status).toBe(200);
    });

    it("공개 쿠폰 검증 API가 유효성 및 할인 금액을 계산한다", async () => {
      await fetch(`${baseUrl}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          code: "SALE20",
          name: "20% 세일",
          discountType: "percent",
          discountValue: 20,
          minOrderAmount: 20000,
          maxDiscountAmount: 5000,
          maxUses: 1,
        }),
      });

      // Valid check (30000원 주문 -> 20% = 6000원이나 maxDiscountAmount 5000원에 걸림)
      const resVal = await fetch(`${baseUrl}/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "SALE20", subtotal: 30000 }),
      });
      expect(resVal.status).toBe(200);
      const val = await resVal.json();
      expect(val.valid).toBe(true);
      expect(val.discountAmount).toBe(5000);
      expect(val.finalSubtotal).toBe(25000);

      // Min order amount check fails
      const resMinFail = await fetch(`${baseUrl}/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "SALE20", subtotal: 10000 }),
      });
      expect(resMinFail.status).toBe(400);

      // Non-existent coupon
      const resNotFound = await fetch(`${baseUrl}/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "NO_SUCH_COUPON", subtotal: 30000 }),
      });
      expect(resNotFound.status).toBe(400);
    });
  });

  describe("주문 시 쿠폰 적용 및 주문 취소 시 복구", () => {
    it("체크아웃 시 쿠폰이 적용되어 usedCount가 증가하고 취소 시 복구된다", async () => {
      const couponRes = await fetch(`${baseUrl}/admin/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          code: "LIMIT1",
          name: "1회 한정 5000원",
          discountType: "fixed",
          discountValue: 5000,
          minOrderAmount: 10000,
          maxUses: 1,
        }),
      });
      const coupon = await couponRes.json();

      // user1 orders with coupon
      const checkoutRes = await fetch(`${baseUrl}/orders/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          items: [{ productId, quantity: 1 }],
          shipping: {
            recipientName: "김철수",
            recipientPhone: "010-1234-5678",
            postalCode: "12345",
            address1: "서울시 강남구 테헤란로 1",
          },
          privacyConsentVersion: 1,
          couponCode: "LIMIT1",
        }),
      });
      expect(checkoutRes.status).toBe(201);
      const placed = await checkoutRes.json();
      // Price = 30000 - 5000 + 3000 (배송비) = 28000
      expect(placed.price).toBe(28000);
      expect(placed.couponCode).toBe("LIMIT1");
      expect(placed.discountAmount).toBe(5000);

      // Check coupon usedCount is now 1
      const couponAfter = await adminDb.coupon.findUnique({ where: { id: coupon.id } });
      expect(couponAfter?.usedCount).toBe(1);

      // Next checkout with same coupon should fail (limit exceeded: 409)
      const secondCheckout = await fetch(`${baseUrl}/orders/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          items: [{ productId, quantity: 1 }],
          shipping: {
            recipientName: "김철수",
            recipientPhone: "010-1234-5678",
            postalCode: "12345",
            address1: "서울시 강남구 테헤란로 1",
          },
          privacyConsentVersion: 1,
          couponCode: "LIMIT1",
        }),
      });
      expect(secondCheckout.status).toBe(409);

      // Customer cancels unpaid order
      const cancelRes = await fetch(`${baseUrl}/me/orders/${placed.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ reason: "단순 변심" }),
      });
      expect(cancelRes.status).toBe(200);

      // Coupon usedCount should be restored to 0!
      const couponRestored = await adminDb.coupon.findUnique({ where: { id: coupon.id } });
      expect(couponRestored?.usedCount).toBe(0);
    });
  });

  describe("리뷰 작성 및 조회 권한 검증", () => {
    it("구매확정된 주문의 소유자만 리뷰를 작성할 수 있고, 중복 작성 시 409를 반환한다", async () => {
      // Create and pay an order
      const variant = await adminDb.productVariant.findFirst({ where: { productId } });
      const order = await adminDb.order.create({
        data: {
          userId: "user1",
          totalAmount: 32000,
          shippingFee: 0,
          paid: true,
          status: "delivered", // 배송 완료 상태
          recipientName: "김철수",
          recipientPhone: "010-1234-5678",
          postalCode: "12345",
          address1: "서울시 강남구 테헤란로 1",
          items: {
            create: [
              {
                productId,
                variantKey: variant!.id,
                variantId: variant!.id,
                variantLabel: variant!.name,
                quantity: 1,
                unitPrice: 32000,
              },
            ],
          },
        },
      });

      // Try writing review before confirm -> 400 Bad Request
      const prematureReview = await fetch(`${baseUrl}/me/orders/${order.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          productId,
          rating: 5,
          content: "너무 예뻐요!",
        }),
      });
      expect(prematureReview.status).toBe(400);

      // Confirm order
      const confirmRes = await fetch(`${baseUrl}/me/orders/${order.id}/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(confirmRes.status).toBe(200);

      // Another user attempts to review this order -> 403 Forbidden
      const unauthorizedReview = await fetch(`${baseUrl}/me/orders/${order.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherUserToken}` },
        body: JSON.stringify({
          productId,
          rating: 5,
          content: "남의 주문 리뷰 시도",
        }),
      });
      expect(unauthorizedReview.status).toBe(403);

      // Owner reviews the order -> 201 Created
      const validReview = await fetch(`${baseUrl}/me/orders/${order.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          productId,
          rating: 5,
          content: "정말 만족스러운 핏입니다!",
        }),
      });
      expect(validReview.status).toBe(201);
      const reviewJson = await validReview.json();
      expect(reviewJson.authorName).toBe("김*수"); // 김철수 masked
      expect(reviewJson.variantName).toBe(variant!.name);
      expect(reviewJson.rating).toBe(5);

      // Duplicate review on same order and product -> 409 Conflict
      const dupReview = await fetch(`${baseUrl}/me/orders/${order.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          productId,
          rating: 4,
          content: "중복 작성 시도",
        }),
      });
      expect(dupReview.status).toBe(409);

      // Public product reviews endpoint
      const prodReviewsRes = await fetch(`${baseUrl}/products/${productId}/reviews`);
      expect(prodReviewsRes.status).toBe(200);
      const prodReviews = await prodReviewsRes.json();
      expect(prodReviews.reviewCount).toBe(1);
      expect(prodReviews.averageRating).toBe(5);
      expect(prodReviews.reviews[0].authorName).toBe("김*수");
      expect(prodReviews.reviews[0].variantName).toBe(variant!.name);

      // Admin review list & moderation
      const adminReviewsRes = await fetch(`${baseUrl}/admin/reviews`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(adminReviewsRes.status).toBe(200);
      const adminReviews = await adminReviewsRes.json();
      expect(adminReviews.length).toBe(1);
      expect(adminReviews[0].product.name).toBe("테스트 셔츠");

      // Admin delete review
      const delReviewRes = await fetch(`${baseUrl}/admin/reviews/${reviewJson.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(delReviewRes.status).toBe(200);

      // Product reviews count is now 0
      const afterDelRes = await fetch(`${baseUrl}/products/${productId}/reviews`);
      const afterDel = await afterDelRes.json();
      expect(afterDel.reviewCount).toBe(0);
      expect(afterDel.averageRating).toBe(0);
    });
  });
});
