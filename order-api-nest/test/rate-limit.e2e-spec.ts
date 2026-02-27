import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { Redis } from "ioredis";
import { io } from "socket.io-client";
import { AppModule } from "../src/app.module.js";

describe("요청 수 제한", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  const redis = new Redis(process.env.REDIS_URL!);
  const before = { all: process.env.RATE_LIMIT_PER_MINUTE, auth: process.env.AUTH_RATE_LIMIT_PER_MINUTE, allow: process.env.RATE_LIMIT_ALLOW_IPS };

  beforeAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "5";
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = "2";
    process.env.RATE_LIMIT_ALLOW_IPS = "203.0.113.50";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.use(cookieParser());
    app.set("trust proxy", "loopback");
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    const keys = await redis.keys("rate:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = before.all;
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = before.auth;
    process.env.RATE_LIMIT_ALLOW_IPS = before.allow;
    await app.close();
    await redis.quit();
  });

  const get = (path: string, ip: string) => fetch(`${baseUrl}${path}`, { headers: { "X-Forwarded-For": ip } });
  const login = (ip: string) =>
    fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ id: "nobody", password: "wrong" }),
    });

  it("허용 목록의 IP는 세지 않는다 — 한도 5에서 8번 보내도 200이고 RateLimit 머리글이 없다", async () => {
    for (let i = 0; i < 8; i++) {
      const res = await get("/products", "203.0.113.50");
      expect(res.status).toBe(200);
      expect(res.headers.get("ratelimit-limit")).toBeNull();
    }
    expect(await redis.keys("rate:*:203.0.113.50:*")).toEqual([]);
  });

  it("한도를 넘은 요청은 429와 Retry-After를 받고, 다른 IP는 영향받지 않는다", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await get("/products", "203.0.113.1")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);

    const blocked = await get("/products", "203.0.113.1");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await blocked.json()) as { message: string }).message).toMatch(/요청이 너무 많습니다/);

    expect((await get("/products", "203.0.113.2")).status).toBe(200);
  });

  it("로그인 계열은 더 낮은 한도를 따로 센다", async () => {
    const statuses = [(await login("198.51.100.7")).status, (await login("198.51.100.7")).status, (await login("198.51.100.7")).status];
    expect(statuses).toEqual([401, 401, 429]);
    expect((await get("/products", "198.51.100.7")).status).toBe(200);
  });

  it("헬스 체크와 결제사 웹훅은 세지 않는다", async () => {
    for (let i = 0; i < 8; i++) expect((await get("/health", "192.0.2.9")).status).toBe(200);
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.11" }, body: "{}",
      });
      expect(res.status).not.toBe(429);
    }
  });

  it("WebSocket 연결은 세지 않는다 — 한도 5에서 8번 붙어도 HTTP 한도는 그대로다", async () => {
    const token = app.get(JwtService, { strict: false }).sign({ sub: "kim" });
    for (let i = 0; i < 8; i++) {
      const socket = io(baseUrl, { transports: ["websocket"], auth: { token }, extraHeaders: { "X-Forwarded-For": "192.0.2.12" }, reconnection: false, forceNew: true });
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      socket.close();
    }
    expect(await redis.keys("rate:*:192.0.2.12:*")).toEqual([]);
    expect((await get("/products", "192.0.2.12")).headers.get("ratelimit-remaining")).toBe("4");
  });
});
