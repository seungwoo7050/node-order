import type { INestApplication } from "@nestjs/common";
import { startApp } from "./llm-app.js";
import { seedPaymentData } from "./payment-app.js";

describe("상품 설명 초안 - LLM 키가 없을 때", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    delete process.env.LLM_API_KEY;
    ({ app, baseUrl } = await startApp(null));
    tokens = await seedPaymentData(baseUrl);
  });

  afterAll(async () => {
    await app.close();
  });

  it("features.llm이 false이고 초안 엔드포인트는 (인증과 상관없이) 404다", async () => {
    const features = (await (await fetch(`${baseUrl}/features`)).json()) as { integrations: { llm: boolean } };
    expect(features.integrations.llm).toBe(false);
    const asAdmin = await fetch(`${baseUrl}/admin/products/1/description-draft`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.admin}` }, body: "{}",
    });
    expect(asAdmin.status).toBe(404);
    expect((await fetch(`${baseUrl}/admin/products/1/description-draft`, { method: "POST" })).status).toBe(404);
  });
});
