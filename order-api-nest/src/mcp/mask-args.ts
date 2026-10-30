import { maskContacts, PERSONAL_DATA_MASKERS } from "../fulfillment/mask.js";

// 감사 로그에 남길 도구 인자 요약.
//   - 자유 글 칸(사유, 메모, 설명, 키워드 …)은 본문을 남기지 않고 길이만 남긴다(무엇이 들어 있을지 모른다)
//   - 배송지 칸은 29의 규칙(칸 이름으로 가린다)
//   - 그 밖의 글에 섞인 전화번호(국내 0…, 국제 +82·0082·82…)와 이메일을 가리고(maskContacts), 긴 글은 자른다
const FREE_TEXT_KEYS = new Set(["reason", "detail", "note", "memo", "deliveryMemo", "description", "keywords", "comment", "message", "rejectReason"]);
// 사람의 연락처가 아닌 식별자 칸은 가리지 않는다(82로 시작하는 송장번호가 국제 전화번호로 가려지지 않게)
const IDENTIFIER_KEYS = new Set(["trackingNumber", "carrier", "paymentKey", "providerOrderId"]);
const MAX_STRING = 200;

export function maskText(text: string): string {
  const masked = maskContacts(text);
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

export const freeTextSummary = (text: string) => `[자유 글 ${Array.from(text).length}자]`;

function deep(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && FREE_TEXT_KEYS.has(key)) return freeTextSummary(value);
    if (key && IDENTIFIER_KEYS.has(key)) return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    const mask = key ? PERSONAL_DATA_MASKERS[key] : undefined;
    if (mask && value.length > 0) return mask(value);
    return maskText(value);
  }
  if (Array.isArray(value)) return value.map((v) => deep(v));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deep(v, k)]));
}

export function maskArgs(args: unknown): unknown {
  return deep(args ?? {});
}
