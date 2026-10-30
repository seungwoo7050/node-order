import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("/metrics - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const metrics = async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    return { status: res.status, text: await res.text() };
  };

  it("요청 지표의 경로 라벨은 실제 URL이 아니라 경로 패턴이다", async () => {
    for (const id of [1, 2, 3]) await fetch(`${baseUrl}/orders/${id}`);
    await fetch(`${baseUrl}/no-such-path/123`);
    const { text } = await metrics();
    expect(text).toContain('route="/orders/:id"');
    expect(text).not.toMatch(/route="\/orders\/\d+"/);
    expect(text).toContain('route="unmatched"');
    expect(text).not.toContain("no-such-path");
  });

  it("프록시(Caddy)를 거쳐 온 /metrics 요청은 경로 모양과 상관없이 404다(지표는 서버 안의 Prometheus만 긁는다)", async () => {
    const proxied = { "X-Forwarded-For": "203.0.113.7" };
    for (const path of ["/metrics", "/metrics/", "/metrics?x=1", "/METRICS", "/Metrics/", "/%6Detrics", "/%6detrics"]) {
      const res = await fetch(`${baseUrl}${path}`, { headers: proxied });
      const text = await res.text();
      expect(res.status, path).toBe(404);
      expect(text, path).not.toContain("# HELP");
    }
    const forwarded = await fetch(`${baseUrl}/metrics`, { headers: { Forwarded: "for=203.0.113.7" } });
    expect(forwarded.status).toBe(404);
    expect((await metrics()).status).toBe(200); // 직접 긁으면(Prometheus) 그대로
  });

  it("DB에 묻는 지표가 실패해도 /metrics는 200이고, 그 지표만 NaN이다", async () => {
    const prisma = app.get(PrismaService);
    const spy = vi.spyOn(prisma.outboxEvent, "count").mockRejectedValueOnce(new Error("DB에 연결할 수 없다"));
    const { status, text } = await metrics();
    expect(status).toBe(200);
    expect(text).toMatch(/^outbox_unpublished_events nan$/im);
    expect(text).toMatch(/^http_request_duration_seconds_count/m);
    spy.mockRestore();
  });
});