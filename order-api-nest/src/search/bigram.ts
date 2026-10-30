// 한국어 검색 토큰: 단어를 나누고 각 단어를 2글자씩 자른다(2-gram). 1글자 단어는 그대로 둔다.
// 색인(product_search.tokens)과 검색어가 같은 함수를 지나야 토큰이 맞는다.
//   "여행용 가방" → 여행, 행용, 가방
//   "블루투스"   → 블루, 루투, 투스

// 검색어·인기 검색어 키로 쓰는 정규화: 호환 문자 합치기(NFKC), 소문자, 공백 정리
export function normalizeQuery(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// 글자와 숫자가 아닌 것(공백, 문장부호)에서 단어를 나눈다
export function words(text: string): string[] {
  return normalizeQuery(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function bigrams(text: string): string[] {
  const out = new Set<string>();
  for (const word of words(text)) {
    const chars = Array.from(word); // 서로게이트 쌍(이모지 등)을 한 글자로 센다
    if (chars.length === 1) out.add(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i]! + chars[i + 1]!);
  }
  return [...out];
}

const quote = (t: string) => `'${t.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

// tsquery 문자열. 따옴표로 감싸 파서를 거치지 않게 한다(::tsquery 캐스트는 정규화하지 않는다)
// weights를 주면 그 가중치의 토큰만 찾는다(예: "A"는 이름만)
export function toTsQuery(tokens: string[], weights = ""): string {
  return tokens.map((t) => quote(t) + (weights ? `:${weights}` : "")).join(" & ");
}

export type Weight = "A" | "B" | "C" | "D";
const MAX_POSITION = 16383; // tsvector 위치의 상한

// tsvector 문자열: '가방':1A,7C '여행':2A ... 가중치는 위치에 붙으므로 위치를 꼭 준다
// (array_to_tsvector는 위치가 없어 setweight가 먹지 않는다)
export function toTsVector(sections: [text: string, weight: Weight][]): string {
  const positions = new Map<string, string[]>();
  let pos = 0;
  for (const [text, weight] of sections) {
    for (const token of bigrams(text)) {
      pos = Math.min(pos + 1, MAX_POSITION);
      const list = positions.get(token) ?? [];
      list.push(`${pos}${weight}`);
      positions.set(token, list);
    }
  }
  return [...positions].map(([token, list]) => `${quote(token)}:${list.join(",")}`).join(" ");
}
