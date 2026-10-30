import { CARRIER_CODES, isCarrierCode, trackingUrl } from "./carriers.js";
import { maskPhone, maskShipping } from "./mask.js";
import { returnDeadline, returnRefundAmount, shippingFeeFor } from "./policy.js";

describe("배송비 정책", () => {
  it("상품 합계 49,000원이면 3,000원, 50,000원 이상이면 무료", () => {
    expect(shippingFeeFor(49_000)).toBe(3_000);
    expect(shippingFeeFor(50_000)).toBe(0);
    expect(shippingFeeFor(120_000)).toBe(0);
  });

  it("상점 설정의 값으로 계산한다(배송비 2,500원, 3만 원 이상 무료)", () => {
    const policy = { shippingFee: 2_500, freeShippingThreshold: 30_000 };
    expect(shippingFeeFor(29_999, policy)).toBe(2_500);
    expect(shippingFeeFor(30_000, policy)).toBe(0);
  });
});

describe("반품 환불액", () => {
  const items = [{ unitPrice: 10_000, quantity: 2 }, { unitPrice: 5_000, quantity: 1 }];
  it("단순변심이면 항목 합계에서 왕복 배송비 6,000원을 뺀다", () => {
    expect(returnRefundAmount(items, "change_of_mind")).toBe(19_000);
  });
  it("반품 왕복 배송비도 설정 값으로 뺀다", () => {
    expect(returnRefundAmount(items, "change_of_mind", 5_000)).toBe(20_000);
  });
  it("하자·오배송이면 항목 합계 전액", () => {
    expect(returnRefundAmount(items, "defective")).toBe(25_000);
    expect(returnRefundAmount(items, "wrong_item")).toBe(25_000);
  });
  it("배송비보다 싼 단순변심 반품은 0원(음수가 되지 않는다)", () => {
    expect(returnRefundAmount([{ unitPrice: 4_000, quantity: 1 }], "change_of_mind")).toBe(0);
  });
  it("청약철회 기한은 배송 완료 뒤 7일", () => {
    expect(returnDeadline(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("택배사 조회 링크", () => {
  it.each([
    ["cj", "https://trace.cjlogistics.com/next/tracking.html?wblNo=123456789012"],
    ["epost", "https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=123456789012"],
    ["hanjin", "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnum=123456789012"],
    ["lotte", "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=123456789012"],
    ["logen", "https://www.ilogen.com/web/personal/trace/123456789012"],
  ])("%s 송장 링크가 템플릿대로 만들어진다", (carrier, url) => {
    expect(trackingUrl(carrier, "123456789012")).toBe(url);
  });

  it("목록은 다섯 곳이고, 목록에 없는 코드는 링크가 없다", () => {
    expect(CARRIER_CODES).toEqual(["cj", "epost", "hanjin", "lotte", "logen"]);
    expect(isCarrierCode("dhl")).toBe(false);
    expect(isCarrierCode("toString")).toBe(false);
    expect(trackingUrl("dhl", "123456789012")).toBeNull();
  });
});

describe("배송지 마스킹", () => {
  it("연락처는 앞 3자리와 끝 4자리만 남는다", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });
  it("로그 한 줄에 연락처 원문·상세 주소가 없다", () => {
    const line = maskShipping({ recipientName: "홍길동", recipientPhone: "010-1234-5678", postalCode: "06236", address1: "서울특별시 강남구 테헤란로 123" });
    expect(line).toBe("홍*동 010-****-5678 (062**) 서울특별시 강남구 ***");
    expect(line).not.toContain("1234");
    expect(line).not.toContain("테헤란로");
  });
});
