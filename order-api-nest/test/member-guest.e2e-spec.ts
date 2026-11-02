import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { adminDb } from "./admin-db.js";
import { FakeStripeGateway } from "./fake-stripe.js";

describe("회원가입, 기본배송지, 비회원 주문/조회, 반품배송비 스냅샷 E2E", () => {
  let app: INestApplication;
  let baseUrl: string;

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
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, return_items, returns, shipments, payments, refunds, order_status_history, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "admin", name: "관리자", role: "admin", passwordHash: await hashPassword("admin1234!") } });
    await adminDb.user.create({ data: { id: "kim", name: "김구매", role: "user", passwordHash: await hashPassword("password1234!") } });
    await adminDb.product.create({ data: { id: 1, name: "테스트 상품", price: 10000, stock: 100 } });
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  it("1. 회원가입 및 아이디 중복/예약어 검증", async () => {
    // 예약어 차단
    for (const reserved of ["guest-user", "demo-test", "github-1234", "admin"]) {
      const res = await fetch(`${baseUrl}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reserved, password: "password123!", name: "예약" }),
      });
      expect(res.status).toBe(400);
    }

    // check-id
    const checkRes = await fetch(`${baseUrl}/auth/check-id?id=kim`);
    const checkData = (await checkRes.json()) as { available: boolean };
    expect(checkData.available).toBe(false);

    const checkAvailable = await fetch(`${baseUrl}/auth/check-id?id=newuser`);
    expect(((await checkAvailable.json()) as { available: boolean }).available).toBe(true);

    // 중복 가입 시 409
    const dupRes = await fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "password123!", name: "김" }),
    });
    expect(dupRes.status).toBe(409);

    // 정상 가입 및 즉시 로그인 토큰 발급
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "park", password: "password123!", name: "박회원", phone: "010-9876-5432" }),
    });
    expect(signupRes.status).toBe(201);
    const signupData = (await signupRes.json()) as { accessToken: string };
    expect(signupData.accessToken).toBeDefined();

    // refresh cookie 발급 확인
    const cookies = signupRes.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("refresh_token="))).toBe(true);
  });

  it("2. 회원 주문 시 기본 배송지 자동 저장 및 내 정보(/me/profile) 수정", async () => {
    // kim 로그인
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "password1234!" }),
    });
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    // 주문 전 kim의 배송지는 비어 있음
    const beforeProfile = await fetch(`${baseUrl}/me/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const beforeData = (await beforeProfile.json()) as { postalCode: string | null };
    expect(beforeData.postalCode).toBeNull();

    // kim이 첫 주문 진행
    const checkoutRes = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 2 }],
        shipping: {
          recipientName: "김구매",
          recipientPhone: "010-2345-6789",
          postalCode: "06236",
          address1: "서울특별시 강남구 테헤란로 123",
          address2: "4층",
          deliveryMemo: "문 앞",
        },
        privacyConsentVersion: 1,
      }),
    });
    expect(checkoutRes.status).toBe(201);

    // 주문 후 kim의 기본 배송지가 자동 채워졌는지 확인
    const afterProfile = await fetch(`${baseUrl}/me/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const afterData = (await afterProfile.json()) as { postalCode: string; address1: string; recipientName: string };
    expect(afterData.postalCode).toBe("06236");
    expect(afterData.address1).toBe("서울특별시 강남구 테헤란로 123");
    expect(afterData.recipientName).toBe("김구매");

    // PATCH /me/profile 로 기본 배송지 및 이름 수정
    const patchRes = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "김수정",
        address2: "5층 (수정됨)",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { name: string; address2: string };
    expect(patched.name).toBe("김수정");
    expect(patched.address2).toBe("5층 (수정됨)");

    // POST /me/password 로 비밀번호 변경
    const pwRes = await fetch(`${baseUrl}/me/password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: "password1234!",
        newPassword: "newpassword5678!",
      }),
    });
    expect(pwRes.status).toBe(200);

    // 변경된 비밀번호로 로그인 성공 확인
    const reLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "newpassword5678!" }),
    });
    expect(reLogin.status).toBe(200);
  });

  it("3. 비회원 주문 생성, 조회 및 관리자 주문 목록 비회원 배지·필터", async () => {
    // 비회원 주문 생성
    const guestCheckoutRes = await fetch(`${baseUrl}/orders/guest-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1 }],
        shipping: {
          recipientName: "이비회원",
          recipientPhone: "010-1111-2222",
          postalCode: "04781",
          address1: "서울특별시 성동구 성수이로 51",
          address2: "2층",
        },
        privacyConsentVersion: 1,
        password: "guestpass1234!",
      }),
    });
    expect(guestCheckoutRes.status).toBe(201);
    const guestOrderData = (await guestCheckoutRes.json()) as { id: number; guestAccessToken: string; isGuest?: boolean };
    const orderId = guestOrderData.id;
    expect(orderId).toBeDefined();
    expect(guestOrderData.guestAccessToken).toBeDefined();

    // 비회원 주문 조회 (/guest/orders/lookup)
    // 틀린 비밀번호 -> 401
    const wrongPwRes = await fetch(`${baseUrl}/guest/orders/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, password: "wrongpassword" }),
    });
    expect(wrongPwRes.status).toBe(401);

    // 올바른 비밀번호 -> 200 및 order 정보 + guestAccessToken 반환
    const rightPwRes = await fetch(`${baseUrl}/guest/orders/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, password: "guestpass1234!" }),
    });
    expect(rightPwRes.status).toBe(200);
    const lookupData = (await rightPwRes.json()) as { order: { id: number; isGuest: boolean }; guestAccessToken: string };
    expect(lookupData.order.id).toBe(orderId);
    expect(lookupData.order.isGuest).toBe(true);

    // 관리자 로그인 후 비회원 배지 및 ?guest 필터 확인
    const adminLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin1234!" }),
    });
    const { accessToken: adminToken } = (await adminLogin.json()) as { accessToken: string };

    // admin 목록 조회
    const adminOrdersRes = await fetch(`${baseUrl}/admin/orders?guest=true`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminOrdersRes.status).toBe(200);
    const adminOrdersData = (await adminOrdersRes.json()) as { items: { id: number; isGuest: boolean }[] };
    expect(adminOrdersData.items.length).toBeGreaterThan(0);
    expect(adminOrdersData.items.every((it) => it.isGuest === true)).toBe(true);

    const adminMembersRes = await fetch(`${baseUrl}/admin/orders?guest=false`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminMembersData = (await adminMembersRes.json()) as { items: { id: number; isGuest: boolean }[] };
    expect(adminMembersData.items.every((it) => it.isGuest === false)).toBe(true);
  });

  it("4. 주문 당시 반품배송비가 주문 레코드에 스냅샷으로 고정된다", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "password1234!" }),
    });
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const checkoutRes = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1 }],
        shipping: {
          recipientName: "김구매",
          recipientPhone: "010-2345-6789",
          postalCode: "06236",
          address1: "서울특별시 강남구 테헤란로 123",
        },
        privacyConsentVersion: 1,
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const checkoutData = (await checkoutRes.json()) as { id: number };

    const orderInDb = await adminDb.order.findUnique({ where: { id: checkoutData.id } });
    expect(orderInDb?.returnShippingFee).toBe(6000);

    try {
      // 상점 설정의 반품 배송비를 변경해도 기존 주문의 스냅샷은 유지된다
      await adminDb.storeSettings.update({
        where: { id: 1 },
        data: { returnShippingFee: 5000 },
      });

      const orderAfterSetting = await adminDb.order.findUnique({ where: { id: checkoutData.id } });
      expect(orderAfterSetting?.returnShippingFee).toBe(6000);
    } finally {
      await adminDb.storeSettings.update({
        where: { id: 1 },
        data: { returnShippingFee: 6000 },
      });
    }
  });
});

