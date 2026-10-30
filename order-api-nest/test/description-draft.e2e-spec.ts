import type { INestApplication } from "@nestjs/common";
import { Redis } from "ioredis";
import { adminDb } from "./admin-db.js";
import { FakeLlm } from "./fake-llm.js";
import { readSse, startApp, waitFor } from "./llm-app.js";
import { demoAdminToken, seedPaymentData } from "./payment-app.js";

describe("상품 설명 초안 - 대역 공급자", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };
  const llm = new FakeLlm();
  const redis = new Redis(process.env.REDIS_URL!);

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp(llm));
  });

  beforeEach(async () => {
    llm.reset();
    delete process.env.LLM_RATE_LIMIT_PER_MINUTE;
    const keys = await redis.keys("rate:llm:*");
    if (keys.length) await redis.del(...keys);
    tokens = await seedPaymentData(baseUrl);
    const parent = await adminDb.category.create({ data: { name: "전자기기" } });
    const child = await adminDb.category.create({ data: { name: "주변기기", parentId: parent.id } });
    await adminDb.product.update({ where: { id: 1 }, data: { categoryId: child.id, description: "기존 설명" } });
  });

  afterAll(async () => {
    delete process.env.LLM_RATE_LIMIT_PER_MINUTE;
    await redis.quit();
    await app.close();
  });

  const draft = (token = tokens.admin, body: unknown = { keywords: "조용한 클릭, 무선" }, signal?: AbortSignal) =>
    fetch(`${baseUrl}/admin/products/1/description-draft`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal,
    });
  const description = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).description;

  it("features.llm이 true이고, SSE로 조각을 순서대로 보낸 뒤 토큰 수와 함께 끝낸다(저장하지 않는다)", async () => {
    const features = (await (await fetch(`${baseUrl}/features`)).json()) as { integrations: { llm: boolean } };
    expect(features.integrations.llm).toBe(true);

    const res = await draft();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);
    expect(events).toEqual([
      { event: "delta", data: { text: "첫 문장입니다. " } },
      { event: "delta", data: { text: "둘째 문장입니다. " } },
      { event: "delta", data: { text: "셋째 문장입니다." } },
      { event: "done", data: { usage: { inputTokens: 100, outputTokens: 20 } } },
    ]);
    // 입력: 상품 이름·카테고리 경로·가격·기존 설명·키워드
    const { input } = llm.calls[0]!;
    expect(input.prompt).toContain("마우스");
    expect(input.prompt).toContain("전자기기 / 주변기기");
    expect(input.prompt).toContain("7,000원");
    expect(input.prompt).toContain("기존 설명");
    expect(input.prompt).toContain("조용한 클릭, 무선");
    expect(await description()).toBe("기존 설명");

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(metrics).toMatch(/llm_tokens_total\{provider="fake",model="fake-model",direction="output"\} \d+/);
    expect(metrics).toMatch(/llm_requests_total\{feature="description_draft",result="ok"\} \d+/);
  });

  it("손님이 연결을 끊으면 공급자가 취소 신호를 받는다", async () => {
    llm.delayMs = 300;
    const controller = new AbortController();
    const res = await draft(tokens.admin, {}, controller.signal);
    const events = await readSse(res, () => {
      controller.abort();
      return false;
    }).catch(() => []);
    expect(events.length).toBeLessThanOrEqual(1);
    await waitFor(() => llm.calls[0]?.signal.aborted === true);
  });

  it("중간에 공급자 오류가 나면 받은 조각 뒤에 error 이벤트를 보내고 done은 없다(저장되지 않는다)", async () => {
    llm.failAfter = 2;
    const events = await readSse(await draft());
    expect(events.map((e) => e.event)).toEqual(["delta", "delta", "error"]);
    expect(events[2]!.data.message).toMatch(/멈췄습니다/);
    expect(await description()).toBe("기존 설명");
  });

  it("관리자당 분당 호출 수를 넘으면 429, 데모 관리자는 403", async () => {
    process.env.LLM_RATE_LIMIT_PER_MINUTE = "2";
    expect((await draft()).status).toBe(200);
    expect((await draft()).status).toBe(200);
    const limited = await draft();
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { message: string }).message).toMatch(/1분에 2번/);
    expect(llm.calls).toHaveLength(2);

    expect((await draft(await demoAdminToken(baseUrl))).status).toBe(403);
    expect((await draft(tokens.user)).status).toBe(403);
  });
});
