import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { adminDb } from "./admin-db.js";

describe("상품 이미지 업로드 권한", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    const passwordHash = await hashPassword(process.env.DEMO_PASSWORD!);
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", passwordHash, role: "admin" }, { id: "lee", name: "이", passwordHash }] });
    await adminDb.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } });
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  const tokenOf = async (id: string) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: process.env.DEMO_PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  const askUploadUrl = (token?: string) =>
    fetch(`${baseUrl}/products/1/image/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ contentType: "image/png", size: 100 }),
    });

  it("로그인하지 않으면 401", async () => {
    expect((await askUploadUrl()).status).toBe(401);
  });

  it("일반 사용자는 403", async () => {
    const res = await askUploadUrl(await tokenOf("lee"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe("관리자만 할 수 있습니다");
  });

  it("관리자는 업로드 URL을 받는다", async () => {
    const res = await askUploadUrl(await tokenOf("kim"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { key: string }).key).toMatch(/^products\/1\/.+\.png$/);
  });
});
