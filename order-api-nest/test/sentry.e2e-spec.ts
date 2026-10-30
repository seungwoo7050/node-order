import { BadRequestException, Body, Controller, Get, INestApplication, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as Sentry from "@sentry/nestjs";
import { AppModule } from "../src/app.module.js";
import { initSentry } from "../src/observability/sentry.js";
import { FakeSentry } from "./fake-sentry.js";

const PHONE = "010-2345-6789";
const EMAIL = "kim.customer@example.com";
const ADDRESS = "서울특별시 강남구 테헤란로 123";
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJraW0ifQ.c2VudHJ5LXRlc3Qtc2ln";
const COOKIE = "refresh_token=cookie-secret-value-1234";

// 오류를 던지는 시험용 라우트(테스트 모듈에만 붙는다)
@Controller("sentry-test")
class ThrowingController {
  @Post("boom")
  boom(@Body() body: { recipientPhone?: string; address1?: string }) {
    throw new Error(`배송지 저장 실패: ${body.recipientPhone} ${body.address1} (${EMAIL})`);
  }

  @Get("bad-request")
  badRequest() {
    throw new BadRequestException("손님이 잘못 보냈다");
  }
}

describe("오류 추적(가짜 수집 서버)", () => {
  let app: INestApplication;
  let baseUrl: string;
  const collector = new FakeSentry();

  beforeAll(async () => {
    await collector.start();
    expect(initSentry({ SENTRY_DSN: collector.dsn(), SENTRY_RELEASE: "green-e2e123", NODE_ENV: "test" })).toBe(true);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ThrowingController] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close(2000);
    await collector.stop();
  });

  it("API 라우트에서 던진 오류가 release 태그와 함께 도착하고, 연락처·주소·Authorization·Cookie 원문이 없다", async () => {
    const res = await fetch(`${baseUrl}/sentry-test/boom`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEARER}`, Cookie: COOKIE },
      body: JSON.stringify({ recipientPhone: PHONE, address1: ADDRESS }),
    });
    expect(res.status).toBe(500);
    await Sentry.flush(3000);
    const event = await collector.waitForEvent((e) => JSON.stringify(e).includes("배송지 저장 실패"));
    expect(event.release).toBe("green-e2e123");
    expect(event.environment).toBe("test");

    const raw = collector.envelopes.map((e) => e.raw).join("\n");
    for (const secret of [PHONE, "01023456789", EMAIL, "테헤란로 123", BEARER, "cookie-secret-value-1234"]) {
      expect(raw).not.toContain(secret);
    }
    expect(JSON.stringify(event)).toContain("010-****-6789");
  });

  it("4xx(HttpException)는 보내지 않는다", async () => {
    const before = collector.events().length;
    const res = await fetch(`${baseUrl}/sentry-test/bad-request`);
    expect(res.status).toBe(400);
    await Sentry.flush(2000);
    expect(collector.events().length).toBe(before);
  });
});
