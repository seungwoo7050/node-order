import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { adminDb } from "./admin-db.js";

function startFakeGithub(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/user") {
        const valid = ["Bearer good-token", "Bearer token-of-another-app"].includes(req.headers.authorization ?? "");
        res.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify(valid ? { id: 4242, login: "octo" } : { message: "Bad credentials" }));
        return;
      }
      const appAuth = `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`;
      const ok =
        req.method === "POST" &&
        req.url === "/applications/test-client/token" &&
        req.headers.authorization === appAuth &&
        JSON.parse(body || "{}").access_token === "good-token";
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { user: { id: 4242, login: "octo" } } : { message: "Not Found" }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

describe("GitHub 로그인 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let github: Server;

  beforeAll(async () => {
    github = await startFakeGithub();
    process.env.GITHUB_API_URL = `http://localhost:${(github.address() as AddressInfo).port}`;
    process.env.GITHUB_CLIENT_ID = "test-client";
    process.env.GITHUB_CLIENT_SECRET = "test-secret";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
    github.close();
    await adminDb.$disconnect();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const codeFor = async (accessToken: string) => (await (await post("/auth/github", { accessToken })).json()).code as string;

  it("우리 앱의 토큰이면 사용자를 만들고, 코드를 토큰으로 바꿔 내 주문까지 볼 수 있다", async () => {
    const code = await codeFor("good-token");
    const res = await post("/auth/exchange", { code });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^refresh_token=.*HttpOnly/);
    const { accessToken } = await res.json();

    const me = await fetch(`${baseUrl}/me/orders`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(me.status).toBe(200);
    expect(await adminDb.user.findUnique({ where: { githubId: "4242" } })).toMatchObject({ id: "github-4242", name: "octo", passwordHash: null });
  });

  it("다시 로그인해도 같은 사용자다(GitHub id로 찾는다)", async () => {
    await codeFor("good-token");
    await codeFor("good-token");
    expect(await adminDb.user.count()).toBe(1);
  });

  it("같은 사람의 토큰이라도 다른 앱이 받은 것이면 401이고 사용자를 만들지 않는다", async () => {
    const res = await post("/auth/github", { accessToken: "token-of-another-app" });
    expect(res.status).toBe(401);
    expect((await post("/auth/github", { accessToken: "made-up" })).status).toBe(401);
    expect(await adminDb.user.count()).toBe(0);
  });

  it("코드는 한 번만 쓸 수 있다", async () => {
    const code = await codeFor("good-token");
    expect((await post("/auth/exchange", { code })).status).toBe(200);
    expect((await post("/auth/exchange", { code })).status).toBe(401);
  });

  it("같은 코드로 동시에 여러 번 내도 하나만 성공한다", async () => {
    const code = await codeFor("good-token");
    const statuses = await Promise.all(Array.from({ length: 10 }, () => post("/auth/exchange", { code }).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  });
});
