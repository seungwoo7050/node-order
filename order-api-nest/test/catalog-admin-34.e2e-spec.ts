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

describe("34-catalog-admin E2E Tests", () => {
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;
  let userToken: string;

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
    await adminDb.user.create({ data: { id: "user1", name: "사용자1", role: "user", passwordHash: await hashPassword("user1234!") } });

    // admin login
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin1234!" }),
    });
    adminToken = ((await adminLoginRes.json()) as { accessToken: string }).accessToken;

    // user login
    const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user1", password: "user1234!" }),
    });
    userToken = ((await userLoginRes.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  it("1. 상품 생성/수정/삭제 및 옵션(Variant) 재고 관리", async () => {
    // 1-1. 상품 생성 (옵션 2개 포함)
    const createRes = await fetch(`${baseUrl}/admin/products`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "오버핏 옥스포드 셔츠",
        price: 39000,
        stock: 50,
        materialInfo: "면 100%",
        sizeGuide: "M(95~100), L(100~105)",
        variants: [
          { name: "화이트 / M", sku: "SHT-W-M", priceDelta: 0, stock: 20 },
          { name: "화이트 / L", sku: "SHT-W-L", priceDelta: 2000, stock: 30 },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const createdProduct = (await createRes.json()) as any;
    expect(createdProduct.id).toBeDefined();
    expect(createdProduct.name).toBe("오버핏 옥스포드 셔츠");
    expect(createdProduct.variants).toHaveLength(2);
    expect(createdProduct.stock).toBe(50); // 합산 재고

    const productId = createdProduct.id;
    const variantM = createdProduct.variants.find((v: any) => v.name === "화이트 / M");
    const variantL = createdProduct.variants.find((v: any) => v.name === "화이트 / L");
    expect(variantM).toBeDefined();

    // 1-2. 옵션 상품으로 주문 생성 시 옵션 재고 및 전체 재고 차감 확인
    const checkoutRes = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId, variantId: variantM.id, quantity: 3 }],
        shipping: {
          recipientName: "홍길동",
          recipientPhone: "010-1234-5678",
          postalCode: "12345",
          address1: "서울시 종로구",
        },
        privacyConsentVersion: 1,
      }),
    });
    expect(checkoutRes.status).toBe(201);

    // DB에서 재고 차감 확인
    const updatedVarM = await adminDb.productVariant.findUnique({ where: { id: variantM.id } });
    expect(updatedVarM?.stock).toBe(17);
    const updatedProd = await adminDb.product.findUnique({ where: { id: productId } });
    expect(updatedProd?.stock).toBe(47);

    // 1-3. 상품 상세 조회 (/products/:id)
    const getRes = await fetch(`${baseUrl}/products/${productId}`);
    expect(getRes.status).toBe(200);
    const prodDetail = (await getRes.json()) as any;
    expect(prodDetail.materialInfo).toBe("면 100%");
    expect(prodDetail.sizeGuide).toBe("M(95~100), L(100~105)");
    expect(prodDetail.variants).toHaveLength(2);
  });

  it("2. 시스템 제어 (유지보수 모드 503 및 유료 API 일시정지)", async () => {
    // 2-1. 유지보수 모드 활성화
    const patchControlRes = await fetch(`${baseUrl}/admin/system/controls`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maintenanceMode: true }),
    });
    expect(patchControlRes.status).toBe(200);

    // 상품 등록
    const p = await adminDb.product.create({ data: { name: "상품1", price: 10000, stock: 10 } });

    // 유지보수 모드에서 주문 시도 시 503 Service Unavailable
    const blockedCheckout = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: p.id, quantity: 1 }],
        shipping: { recipientName: "홍길동", recipientPhone: "010-0000-0000", postalCode: "12345", address1: "서울" },
        privacyConsentVersion: 1,
      }),
    });
    expect(blockedCheckout.status).toBe(503);

    // 2-2. 유지보수 모드 해제
    await fetch(`${baseUrl}/admin/system/controls`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ maintenanceMode: false }),
    });

    const normalCheckout = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: p.id, quantity: 1 }],
        shipping: { recipientName: "홍길동", recipientPhone: "010-0000-0000", postalCode: "12345", address1: "서울" },
        privacyConsentVersion: 1,
      }),
    });
    expect(normalCheckout.status).toBe(201);
  });

  it("3. 연동 비밀값(Vault) 등록, 마스킹 및 조회", async () => {
    // 3-1. 비밀값 저장
    const putSecretRes = await fetch(`${baseUrl}/admin/integrations/secrets`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "TOSS_SECRET_KEY",
        value: "test_sk_secret_1234567890",
      }),
    });
    expect(putSecretRes.status).toBe(200);

    // 3-2. 시스템 현황 조회 시 마스킹 확인 (원문 노출 금지)
    const systemRes = await fetch(`${baseUrl}/admin/system`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(systemRes.status).toBe(200);
    const systemData = (await systemRes.json()) as any;
    const secretItem = systemData.secrets.find((s: any) => s.key === "TOSS_SECRET_KEY");
    expect(secretItem).toBeDefined();
    expect(secretItem.configured).toBe(true);
    expect(secretItem.maskedPreview).toContain("****");
    expect(JSON.stringify(systemData)).not.toContain("test_sk_secret_1234567890");

    // 3-3. 비밀값 삭제
    const delRes = await fetch(`${baseUrl}/admin/integrations/secrets/TOSS_SECRET_KEY`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.status).toBe(200);
  });

  it("4. 카테고리 관리 및 순환 방지 트리 이동", async () => {
    // 4-1. 카테고리 생성
    const cat1Res = await fetch(`${baseUrl}/admin/categories`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "상의" }),
    });
    expect(cat1Res.status).toBe(201);
    const cat1 = (await cat1Res.json()) as any;

    const cat2Res = await fetch(`${baseUrl}/admin/categories`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "셔츠", parentId: cat1.id }),
    });
    expect(cat2Res.status).toBe(201);
    const cat2 = (await cat2Res.json()) as any;

    // 4-2. 순환 발생 방지 (cat1의 부모를 cat2로 이동 불가)
    const invalidMoveRes = await fetch(`${baseUrl}/admin/categories/${cat1.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: cat2.id }),
    });
    expect(invalidMoveRes.status).toBe(400);

    // 4-3. 카테고리 목록 조회
    const listRes = await fetch(`${baseUrl}/admin/categories`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as any[];
    expect(list.length).toBe(2);
  });

  it("5. 회원 관리 (상태 토글 및 주문 존재 시 익명화 삭제)", async () => {
    // 5-1. 회원 목록 조회
    const usersRes = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(usersRes.status).toBe(200);
    const users = (await usersRes.json()) as any[];
    expect(users.find((u) => u.id === "user1")).toBeDefined();

    // 5-2. 회원 상태 비활성화 (정지)
    const toggleRes = await fetch(`${baseUrl}/admin/users/user1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(toggleRes.status).toBe(200);

    // 5-3. 정지된 회원은 로그인 차단 (403)
    const blockedLogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user1", password: "user1234!" }),
    });
    expect(blockedLogin.status).toBe(403);

    // 다시 활성화
    await fetch(`${baseUrl}/admin/users/user1`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });

    // 주문 1건 생성
    const prod = await adminDb.product.create({ data: { name: "테스트", price: 1000, stock: 10 } });
    await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: prod.id, quantity: 1 }],
        shipping: { recipientName: "홍길동", recipientPhone: "010-1234-5678", postalCode: "12345", address1: "서울" },
        privacyConsentVersion: 1,
      }),
    });

    // 5-4. 주문이 있는 회원을 삭제 시도 -> 익명화(탈퇴회원) 처리 확인
    const deleteRes = await fetch(`${baseUrl}/admin/users/user1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.status).toBe(200);
    const delResult = (await deleteRes.json()) as any;
    expect(delResult.anonymized).toBe(true);

    const checkUser = await adminDb.user.findUnique({ where: { id: "user1" } });
    expect(checkUser?.name).toBe("탈퇴회원");
    expect(checkUser?.phone).toBeNull();
    expect(checkUser?.isActive).toBe(false);
  });
});
