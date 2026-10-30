import { formatBusinessNumber, isValidBusinessNumber, normalizeBusinessNumber } from "./business-number.js";

describe("사업자등록번호 체크섬", () => {
  it.each(["1234567891", "123-45-67891", "2208162517", "1048123454"])("맞는 번호: %s", (n) => {
    expect(isValidBusinessNumber(n)).toBe(true);
  });

  it.each([
    ["1234567890", "검증 번호가 틀림"],
    ["2208162510", "끝자리 하나가 다름"],
    ["123456789", "9자리"],
    ["12345678912", "11자리"],
    ["12345a7891", "숫자가 아님"],
    ["", "빈 값"],
  ])("틀린 번호: %s (%s)", (n) => {
    expect(isValidBusinessNumber(n)).toBe(false);
  });

  it("9번째 자리 × 5의 십의 자리를 더한다(빼면 틀린 번호를 맞다고 본다)", () => {
    // 9번째 자리가 2 이상이면 ⌊d9 × 5 / 10⌋ > 0 이라 이 항이 결과를 바꾼다
    expect(isValidBusinessNumber("1234567891")).toBe(true);
    expect(isValidBusinessNumber("1234567895")).toBe(false); // 이 항을 빼고 계산한 검증 번호
  });

  it("하이픈을 빼고 저장하고, 화면에는 3-2-5로 끊어 보인다", () => {
    expect(normalizeBusinessNumber("123-45-67891")).toBe("1234567891");
    expect(formatBusinessNumber("1234567891")).toBe("123-45-67891");
  });
});
