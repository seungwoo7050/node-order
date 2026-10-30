import { isPublicQuery } from "./search-stats.js";

describe("인기 검색어 공개 규칙(isPublicQuery)", () => {
  it.each(["블루투스", "usb-c", "에어팟 프로", "c++", "아이폰 15"])("통과: %s", (q) => {
    expect(isPublicQuery(q)).toBe(true);
  });

  it.each([
    ["1글자", "가"],
    ["21글자 이상", "가".repeat(21)],
    ["URL", "https://spam.example"],
    ["기호로 시작", "-할인"],
    ["허용하지 않은 기호", "무료<script>"],
    ["이모지", "가방🔥"],
  ])("막음: %s", (_, q) => {
    expect(isPublicQuery(q)).toBe(false);
  });
});
