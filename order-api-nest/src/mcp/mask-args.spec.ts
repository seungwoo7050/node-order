import { maskArgs, maskText } from "./mask-args.js";

describe("maskArgs", () => {
  it("글에 섞인 국내 전화번호와 이메일을 가린다", () => {
    expect(maskText("손님(010-2345-6789, kim@example.com)이 연락 달라고 함")).toBe("손님(010-****-6789, k***@example.com)이 연락 달라고 함");
    expect(maskText("01023456789로 전화")).toBe("010-****-6789로 전화");
    expect(maskText("02 123 4567")).toBe("021-****-4567");
  });

  it.each([
    ["+82-10-2345-6789", "+82-**-****-6789"],
    ["+82 10 2345 6789", "+82-**-****-6789"],
    ["+821023456789", "+82-**-****-6789"],
    ["821023456789", "+82-**-****-6789"],
    ["0082-10-2345-6789", "+82-**-****-6789"],
    ["+82-(0)2-123-4567", "+82-**-****-4567"],
    ["+82 2 1234 5678", "+82-**-****-5678"],
  ])("국제 표기 %s도 가린다", (raw, masked) => {
    expect(maskText(`연락처 ${raw} 로`)).toBe(`연락처 ${masked} 로`);
    expect(maskText(`연락처 ${raw} 로`)).not.toContain("2345");
  });

  it("82로 시작하는 송장번호도 송장번호 칸이면 그대로 둔다", () => {
    expect(maskArgs({ orderId: 3, carrier: "cj", trackingNumber: "821012345678" })).toEqual({ orderId: 3, carrier: "cj", trackingNumber: "821012345678" });
    expect(maskArgs({ trackingNumber: "8210-1234-5678" })).toEqual({ trackingNumber: "8210-1234-5678" });
  });

  it.each([
    ["+1 415 555 2671", "+1-***-2671"],
    ["+1-415-555-2671", "+1-***-2671"],
    ["+44 20 7946 0958", "+44-***-0958"],
    ["+81 90 1234 5678", "+81-***-5678"],
    ["+14155552671", "+1-***-2671"],
  ])("+82가 아닌 국제번호(E.164) %s도 가린다", (raw, masked) => {
    expect(maskText(`연락처 ${raw} 로`)).toBe(`연락처 ${masked} 로`);
  });

  it("주문 번호·송장번호 같은 긴 숫자는 그대로 둔다", () => {
    expect(maskArgs({ orderId: 12, trackingNumber: "123456789012", carrier: "cj" })).toEqual({ orderId: 12, trackingNumber: "123456789012", carrier: "cj" });
  });

  it("자유 글 칸(사유·메모·설명·키워드)은 본문 없이 길이만 남긴다", () => {
    expect(maskArgs({ returnId: 3, reason: "손님(+82 10 9876 5432)과 통화 후 거절" })).toEqual({ returnId: 3, reason: "[자유 글 29자]" });
    expect(maskArgs({ note: "메모", deliveryMemo: "문 앞", keywords: "무선, 조용한" })).toEqual({ note: "[자유 글 2자]", deliveryMemo: "[자유 글 3자]", keywords: "[자유 글 7자]" });
  });

  it("배송지 칸은 29의 규칙대로 가리고, 중첩된 값도 본다", () => {
    expect(maskArgs({ shipping: { recipientName: "김구매", recipientPhone: "010-2345-6789" }, notes: ["메모 010-1111-2222"] })).toEqual({
      shipping: { recipientName: "김*매", recipientPhone: "010-****-6789" },
      notes: ["메모 010-****-2222"],
    });
  });

  it("긴 글은 200자에서 자른다", () => {
    expect((maskArgs({ query: "가".repeat(300) }) as { query: string }).query).toHaveLength(201);
  });
});
