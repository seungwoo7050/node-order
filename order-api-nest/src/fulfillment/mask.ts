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

export function maskShipping(s: { recipientName: string; recipientPhone: string; postalCode: string; address1: string }): string {
  return `${maskName(s.recipientName)} ${maskPhone(s.recipientPhone)} (${s.postalCode.slice(0, 3)}**) ${maskAddress(s.address1)}`;
}
