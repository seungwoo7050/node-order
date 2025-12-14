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