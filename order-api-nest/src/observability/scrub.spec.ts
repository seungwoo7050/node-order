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

  it("헤더는 허용 목록만 남기고, 요청 쿠키와 본문은 버리고, 사용자는 id만 남긴다", () => {
    const out = scrubEvent(structuredClone(event));
    expect(out.request.headers).toEqual({ "user-agent": "vitest" }); // 허용 목록 밖(Authorization·Cookie·Set-Cookie)은 지운다
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBe(FILTERED);
    expect(out.user).toEqual({ id: "kim" });
  });

  it("요청 헤더는 허용 목록만 남긴다(손님 IP가 든 X-Forwarded-For·Forwarded·X-Real-IP는 대소문자와 상관없이 지운다)", () => {
    const out = scrubEvent({
      request: {
        headers: {
          "X-Forwarded-For": "203.0.113.7, 10.0.0.1", forwarded: "for=203.0.113.7", "x-real-ip": "203.0.113.7", "CF-Connecting-IP": "203.0.113.7",
          "x-request-id": "req-1", "content-type": "application/json", "User-Agent": "vitest", host: "api.local",
        },
      },
    });
    expect(JSON.stringify(out)).not.toContain("203.0.113.7");
    expect(out.request.headers).toEqual({ "x-request-id": "req-1", "content-type": "application/json", "User-Agent": "vitest", host: "api.local" });
  });

  it("시·구 없이 쓴 주소도 주소 칸이면 칸 이름으로 지운다", () => {
    const out = scrubEvent({ extra: { address: "테헤란로 123", shippingAddress: "테헤란로 123 4층", addressLine1: "테헤란로 123", roadAddress: "테헤란로 123" } });
    expect(JSON.stringify(out)).not.toContain("테헤란로");
  });

  it("배송지 칸은 29의 규칙으로 가리고, 이메일 칸은 지운다", () => {
    const out = scrubEvent(structuredClone(event));
    expect(out.extra.shipping).toEqual({ recipientName: "홍*동", recipientPhone: "010-****-6789", address1: "서울특별시 강남구 ***", email: FILTERED });
  });

  it("주소 관련 키의 값이 객체나 배열이어도 [Filtered]로 지운다", () => {
    const out = scrubEvent({
      extra: {
        address: { road: "테헤란로 123", detail: "4층" },
        addresses: ["테헤란로 123", "판교역로 4"],
        postalInfo: { zip: "12345" },
      },
    });
    expect(out.extra.address).toBe(FILTERED);
    expect(out.extra.addresses).toBe(FILTERED);
    expect(out.extra.postalInfo).toBe(FILTERED);
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

  it("주문 번호·송장번호 같은 숫자와 보통 글, 상품 이름은 그대로 둔다", () => {
    expect(scrubText("주문 #1234 송장 123456789012 처리 실패")).toBe("주문 #1234 송장 123456789012 처리 실패");
    expect(scrubText("무선 이어폰 프로 2 재고 부족")).toBe("무선 이어폰 프로 2 재고 부족");
  });

  it.each([
    ["서울특별시 강남구 테헤란로 123", "서울특별시 강남구 ***"],
    ["부산광역시 해운대구 센텀중앙로 55 101동 202호", "부산광역시 해운대구 ***"],
    ["경기도 성남시 분당구 판교역로 4", "경기도 성남시 분당구 ***"],
  ])("글에 섞인 도로명 주소 %s를 시·구까지만 남긴다", (raw, masked) => {
    expect(scrubText(`배송지(${raw}) 저장 실패`)).toBe(`배송지(${masked}) 저장 실패`);
  });

  it.each([
    ["테헤란로 123"],
    ["성수이로 51"],
    ["판교역로 10-2"],
  ])("시·구 없이 쓴 도로명 주소 %s는 [주소]로 가린다", (road) => {
    expect(scrubText(`배송지: ${road} 문 앞`)).toBe(`배송지: [주소] 문 앞`);
  });
});
