import { maskArgs, maskText } from "./mask-args.js";

describe("maskArgs", () => {
  it("자유 글에 섞인 전화번호와 이메일을 가린다", () => {
    expect(maskText("손님(010-2345-6789, kim@example.com)이 연락 달라고 함")).toBe("손님(010-****-6789, k***@example.com)이 연락 달라고 함");
    expect(maskText("01023456789로 전화")).toBe("010-****-6789로 전화");
    expect(maskText("02 123 4567")).toBe("021-****-4567");
  });

  it("주문 번호·송장번호 같은 긴 숫자는 그대로 둔다", () => {
    expect(maskArgs({ orderId: 12, trackingNumber: "123456789012", carrier: "cj" })).toEqual({ orderId: 12, trackingNumber: "123456789012", carrier: "cj" });
  });

  it("배송지 칸은 29의 규칙대로 가리고, 중첩된 값도 본다", () => {
    expect(maskArgs({ shipping: { recipientName: "김구매", recipientPhone: "010-2345-6789" }, notes: ["메모 010-1111-2222"] })).toEqual({
      shipping: { recipientName: "김*매", recipientPhone: "010-****-6789" },
      notes: ["메모 010-****-2222"],
    });
  });

  it("긴 글은 200자에서 자른다", () => {
    expect((maskArgs({ reason: "가".repeat(300) }) as { reason: string }).reason).toHaveLength(201);
  });
});
