import { PERSONAL_DATA_MASKERS } from "../auth/demo-admin-mask.interceptor.js";
import { maskPhone } from "../fulfillment/mask.js";

// 감사 로그에 남길 도구 인자 요약.
//   - 자유 글 칸(사유, 메모, 설명, 키워드 …)은 본문을 남기지 않고 길이만 남긴다(무엇이 들어 있을지 모른다)
//   - 배송지 칸은 29의 규칙(칸 이름으로 가린다)
//   - 그 밖의 글에 섞인 전화번호(국내 0…, 국제 +82·0082·82…)와 이메일을 가리고, 긴 글은 자른다
const FREE_TEXT_KEYS = new Set(["reason", "detail", "note", "memo", "deliveryMemo", "description", "keywords", "comment", "message", "rejectReason"]);
// 국제 표기: +82-10-1234-5678, +82 10 1234 5678, 0082-10-…, 붙여 쓴 821012345678, +82-(0)2-123-4567
const INTL_PHONE = /(?<![\d+])(?:\+\s?|00)?82[-.\s]?(?:\(0\)|0)?[-.\s]?(1\d|[2-9]\d?)[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const PHONE = /(?<!\d)(0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@([\p{L}\p{N}.-]+\.[\p{L}]{2,})/gu;
const MAX_STRING = 200;

export function maskText(text: string): string {
  const masked = text
    .replace(INTL_PHONE, (_m, _a, _b, last: string) => `+82-**-****-${last}`)
    .replace(PHONE, (m) => maskPhone(m))
    .replace(EMAIL, (_, first: string, domain: string) => `${first}***@${domain}`);
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

export const freeTextSummary = (text: string) => `[자유 글 ${Array.from(text).length}자]`;

function deep(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && FREE_TEXT_KEYS.has(key)) return freeTextSummary(value);
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
