import { bigrams, normalizeQuery, toTsQuery, toTsVector } from "./bigram.js";

describe("bigram", () => {
  it("단어마다 2글자씩 자른다", () => {
    expect(bigrams("여행용 가방")).toEqual(["여행", "행용", "가방"]);
  });

  it("1글자 단어는 그대로 둔다", () => {
    expect(bigrams("가")).toEqual(["가"]);
    expect(bigrams("티 셔츠")).toEqual(["티", "셔츠"]);
  });

  it("문장부호에서 나누고 소문자로 맞추며 같은 토큰은 한 번만 낸다", () => {
    expect(bigrams("USB-C 허브, usb")).toEqual(["us", "sb", "c", "허브"]);
  });

  it("검색어를 정규화한다(소문자, 공백 정리, 전각 문자)", () => {
    expect(normalizeQuery("  Ｂluetooth   이어폰 ")).toBe("bluetooth 이어폰");
  });

  it("tsquery는 토큰을 따옴표로 감싸 AND로 잇는다", () => {
    expect(toTsQuery(["여행", "it's"])).toBe("'여행' & 'it''s'");
    expect(toTsQuery(["가방"], "A")).toBe("'가방':A");
  });

  it("tsvector는 토큰마다 위치와 가중치를 붙이고 같은 토큰의 위치를 모은다", () => {
    expect(toTsVector([["여행 가방", "A"], ["가방", "C"]])).toBe("'여행':1A '가방':2A,3C");
  });
});
