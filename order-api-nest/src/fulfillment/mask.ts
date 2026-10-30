// 배송지의 개인정보를 로그에 남길 때 쓰는 마스킹. 원문(연락처, 상세주소)은 로그에 쓰지 않는다

// 010-1234-5678 → 010-****-5678 (숫자만 보고 앞 3자리와 끝 4자리만 남긴다)
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

// 서울특별시 강남구 테헤란로 123 → 서울특별시 강남구 *** (시·구까지만)
export function maskAddress(address: string): string {
  const words = address.trim().split(/\s+/);
  return [...words.slice(0, 2), "***"].join(" ");
}

// 홍길동 → 홍*동, 김철 → 김*
export function maskName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

// 칸 이름으로 가리는 규칙(29). 관리자 API 응답(데모 관리자), MCP 감사 로그, 오류 추적 이벤트(31)가 같이 쓴다.
// 이 파일은 다른 모듈을 가져오지 않는다(콘솔의 오류 추적 설정도 그대로 가져다 쓴다)
export const PERSONAL_DATA_MASKERS: Record<string, (v: string) => string> = {
  recipientName: maskName,
  recipientPhone: maskPhone,
  postalCode: (v) => `${v.slice(0, 3)}**`,
  address1: maskAddress,
  address2: () => "***",
  deliveryMemo: () => "***",
  detail: () => "***", // 반품 사유 상세(손님이 쓴 자유 글이라 연락처가 들어 있을 수 있다)
};

// 국제 표기: +82-10-1234-5678, +82 10 1234 5678, 0082-10-…, 붙여 쓴 821012345678, +82-(0)2-123-4567
const INTL_PHONE = /(?<![\d+])(?:\+\s?|00)?82[-.\s]?(?:\(0\)|0)?[-.\s]?(1\d|[2-9]\d?)[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const PHONE = /(?<!\d)(0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@([\p{L}\p{N}.-]+\.[\p{L}]{2,})/gu;

// 글에 섞인 전화번호(국내 0…, 국제 +82·0082·82…)와 이메일을 가린다(길이는 자르지 않는다)
export function maskContacts(text: string): string {
  return text
    .replace(INTL_PHONE, (_m, _a, _b, last: string) => `+82-**-****-${last}`)
    .replace(PHONE, (m) => maskPhone(m))
    .replace(EMAIL, (_, first: string, domain: string) => `${first}***@${domain}`);
}

export function maskShipping(s: { recipientName: string; recipientPhone: string; postalCode: string; address1: string }): string {
  return `${maskName(s.recipientName)} ${maskPhone(s.recipientPhone)} (${s.postalCode.slice(0, 3)}**) ${maskAddress(s.address1)}`;
}
