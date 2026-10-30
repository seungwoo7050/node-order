import { FILTERED, scrubBreadcrumb, scrubEvent, scrubText } from "./scrub.js";

const PHONE = "010-2345-6789";
const EMAIL = "kim.customer@example.com";
const ADDRESS = "서울특별시 강남구 테헤란로 123";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJraW0ifQ.c2lnbmF0dXJlLXZhbHVl";

describe("scrubEvent", () => {
  const event = {
    event_id: "0123456789abcdef0123456789abcdef",
    release: "blue-abc123",
    message: `주문 실패: 손님 ${PHONE}, ${EMAIL}`,
    exception: { values: [{ type: "Error", value: `연락처 ${PHONE} 토큰 Bearer ${JWT}` }] },
    request: {
      url: "http://api.local/orders",
      headers: { authorization: `Bearer ${JWT}`, cookie: "refresh_token=abc123def456", "set-cookie": ["a=b"], "user-agent": "vitest" },
      cookies: { refresh_token: "abc123def456" },
      data: { recipientPhone: PHONE, address1: ADDRESS, deliveryMemo: "문 앞" },
      query_string: "token=nop_abcdefghijkl&page=2",
    },
    user: { id: "kim", email: EMAIL, ip_address: "10.0.0.1" },
    extra: { shipping: { recipientName: "홍길동", recipientPhone: PHONE, address1: ADDRESS, email: EMAIL }, stripeKey: "sk_live_abcdefgh12345678" },
    contexts: { trace: { trace_id: "fedcba9876543210fedcba9876543210" } },
  };

  it("연락처, 주소, Authorization, Cookie 원문과 토큰이 남지 않는다", () => {
    const out = JSON.stringify(scrubEvent(structuredClone(event)));
    for (const raw of [PHONE, "01023456789", EMAIL, "테헤란로 123", JWT, "abc123def456", "nop_abcdefghijkl", "sk_live_abcdefgh12345678", "10.0.0.1"]) {
      expect(out).not.toContain(raw);
    }
  });

  it("헤더의 비밀 칸은 지우고, 요청 쿠키와 본문은 버리고, 사용자는 id만 남긴다", () => {
    const out = scrubEvent(structuredClone(event));
    expect(out.request.headers).toEqual({ authorization: FILTERED, cookie: FILTERED, "set-cookie": FILTERED, "user-agent": "vitest" });
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBe(FILTERED);
    expect(out.user).toEqual({ id: "kim" });
  });

  it("배송지 칸은 29의 규칙으로 가리고, 이메일 칸은 지운다", () => {
    const out = scrubEvent(structuredClone(event));
    expect(out.extra.shipping).toEqual({ recipientName: "홍*동", recipientPhone: "010-****-6789", address1: "서울특별시 강남구 ***", email: FILTERED });
  });

  it("식별자와 release는 그대로 둔다(문제를 찾을 수 있게)", () => {
    const out = scrubEvent(structuredClone(event));
    expect(out.event_id).toBe(event.event_id);
    expect(out.release).toBe("blue-abc123");
    expect(out.contexts.trace.trace_id).toBe(event.contexts.trace.trace_id);
    expect(out.request.url).toBe("http://api.local/orders");
  });

  it("breadcrumb의 글도 같은 규칙으로 가린다", () => {
    const out = scrubBreadcrumb({ category: "console", message: `손님 ${EMAIL} 연락 ${PHONE}`, data: { token: "x" } });
    expect(out.message).toBe("손님 k***@example.com 연락 010-****-6789");
    expect(out.data.token).toBe(FILTERED);
  });
});

describe("scrubText", () => {
  it.each([
    [`Bearer ${JWT}`],
    ["nop_0123456789abcdef"],
    ["whsec_abcdefgh12345678"],
    ["test_sk_abcdefgh12345678"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123"],
  ])("토큰 모양 %s을 지운다", (raw) => {
    expect(scrubText(`값=${raw} 끝`)).toBe(`값=${FILTERED} 끝`);
  });

  it("주문 번호·송장번호 같은 숫자와 보통 글은 그대로 둔다", () => {
    expect(scrubText("주문 #1234 송장 123456789012 처리 실패")).toBe("주문 #1234 송장 123456789012 처리 실패");
  });
});
