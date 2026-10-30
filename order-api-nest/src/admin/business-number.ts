// 사업자등록번호(10자리) 체크섬. 국세청이 공개한 검증 방식:
//   앞 9자리에 가중치 1,3,7,1,3,7,1,3,5를 곱해 더하고, 9번째 자리 × 5의 십의 자리(⌊d9 × 5 / 10⌋)를 한 번 더 더한다.
//   (10 − 합 mod 10) mod 10 이 10번째 자리(검증 번호)와 같아야 한다
// 체크섬은 오타를 거를 뿐 실제 등록 여부는 모른다(진위 확인은 국세청 API가 필요하다. 범위 밖)

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

// 하이픈·공백을 뺀 숫자만. 10자리가 아니면 null
export function normalizeBusinessNumber(input: string): string | null {
  const digits = input.replace(/[-\s]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

export function isValidBusinessNumber(input: string): boolean {
  const digits = normalizeBusinessNumber(input);
  if (!digits) return false;
  const d = Array.from(digits, Number);
  let sum = WEIGHTS.reduce((s, w, i) => s + w * d[i]!, 0);
  sum += Math.floor((d[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

// 화면 표시용: 123-45-67891
export function formatBusinessNumber(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}
