import type { INestApplication } from "@nestjs/common";
import { adminDb } from "./admin-db.js";
import { client, demoAdminToken, seedPaymentData, startPaymentApp } from "./payment-app.js";

describe("36-storefront-designs: 상점 브랜딩 및 디자인 설정 API", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
  });

  beforeEach(async () => {
    tokens = await seedPaymentData(baseUrl);
  });

  afterAll(async () => {
    await app.close();
  });

  const admin = () => client(baseUrl, tokens.admin);

  it("GET /store에 storeDesign, heroTitle, heroSubtitle, announcementText가 기본값과 함께 포함된다", async () => {
    const res = await fetch(`${baseUrl}/store`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      storeDesign: "editorial-atelier",
      heroTitle: "CONTEMPORARY ARCHIVE COLLECTION",
      heroSubtitle: "소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브",
      announcementText: "전 상품 50,000원 이상 구매 시 무료배송 · 신규 가입 웰컴 쿠폰 증정",
    });
    expect(body).not.toHaveProperty("lowStockThreshold");
    expect(body).not.toHaveProperty("version");
  });

  it("GET /admin/settings 응답은 엄격히 기존 14개 키만 돌려준다", async () => {
    const res = await admin().get("/admin/settings");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "address",
      "businessNumber",
      "email",
      "freeShippingThreshold",
      "lowStockThreshold",
      "mailOrderNumber",
      "phone",
      "privacyOfficer",
      "representative",
      "returnShippingFee",
      "shippingFee",
      "storeName",
      "updatedAt",
      "version",
    ]);
  });

  it("GET /admin/settings/branding 및 PUT /admin/settings/branding으로 브랜딩 설정을 수정할 수 있다", async () => {
    const getRes = await admin().get("/admin/settings/branding");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      storeDesign: "editorial-atelier",
    });

    // 데모 관리자 읽기 가능, 쓰기는 403
    const demo = client(baseUrl, await demoAdminToken(baseUrl));
    expect((await demo.get("/admin/settings/branding")).status).toBe(200);
    expect((await demo.put("/admin/settings/branding", { storeDesign: "muji-hara" })).status).toBe(403);

    // 유저는 403
    const user = client(baseUrl, tokens.user);
    expect((await user.get("/admin/settings/branding")).status).toBe(403);

    // 관리자 수정
    const putRes = await admin().put("/admin/settings/branding", {
      storeDesign: "zavanas-archive",
      heroTitle: "TECHNICAL ARCHIVE",
      heroSubtitle: "기능주의 소재 스펙 매트릭스",
      announcementText: "시즌 오프 최대 30% 할인 진행 중",
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({
      storeDesign: "zavanas-archive",
      heroTitle: "TECHNICAL ARCHIVE",
      heroSubtitle: "기능주의 소재 스펙 매트릭스",
      announcementText: "시즌 오프 최대 30% 할인 진행 중",
    });

    // 공개 /store에 즉시 반영
    const storeRes = await fetch(`${baseUrl}/store`);
    const storeBody = await storeRes.json();
    expect(storeBody).toMatchObject({
      storeDesign: "zavanas-archive",
      heroTitle: "TECHNICAL ARCHIVE",
    });

    // 다시 원복
    await admin().put("/admin/settings/branding", {
      storeDesign: "editorial-atelier",
      heroTitle: "CONTEMPORARY ARCHIVE COLLECTION",
      heroSubtitle: "소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브",
      announcementText: "전 상품 50,000원 이상 구매 시 무료배송 · 신규 가입 웰컴 쿠폰 증정",
    });
  });

  it("허용되지 않은 storeDesign 값은 400 거절된다", async () => {
    const res = await admin().put("/admin/settings/branding", {
      storeDesign: "invalid-design",
    });
    expect(res.status).toBe(400);
  });

  it("상품 목록 및 상세 조회 시 reviewCount와 averageRating이 포함된다", async () => {
    // 상품과 리뷰 시딩
    const product = await adminDb.product.findFirstOrThrow();
    const reviewsRes = await fetch(`${baseUrl}/products/${product.id}`);
    expect(reviewsRes.status).toBe(200);
    const detail = await reviewsRes.json();
    expect(detail).toHaveProperty("reviewCount");
    expect(detail).toHaveProperty("averageRating");

    const listRes = await fetch(`${baseUrl}/products?limit=10`);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items[0]).toHaveProperty("reviewCount");
    expect(listBody.items[0]).toHaveProperty("averageRating");
  });
});
