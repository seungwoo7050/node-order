import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";

const ADMIN_ONLY = [
  ["GET", "/orders"], ["GET", "/orders/totals"], ["GET", "/orders/1"], ["POST", "/orders"],
  ["GET", "/users"], ["POST", "/users"],
  ["PATCH", "/categories/1"], ["DELETE", "/categories/1"],
  ["POST", "/products/1/image/upload-url"], ["POST", "/products/1/image/confirm"],
] as const;

describe("관리자 전용 API", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenOf: (role: string) => string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
    tokenOf = (role) => app.get(JwtService, { strict: false }).sign({ sub: `someone-${role}`, role });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: string, path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === "GET" ? undefined : "{}",
    });

  it.each(ADMIN_ONLY)("%s %s: 로그인 없이 401, 일반 사용자 403, 데모 관리자도 403", async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
    expect((await call(method, path, tokenOf("user"))).status).toBe(403);
    const demoAdmin = await call(method, path, tokenOf("demo_admin"));
    expect(demoAdmin.status).toBe(403);
    expect(((await demoAdmin.json()) as { message: string }).message).toBe("데모 관리자는 볼 수만 있습니다");
  });
});
