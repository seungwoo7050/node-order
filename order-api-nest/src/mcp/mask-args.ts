import { maskPersonalData } from "../auth/demo-admin-mask.interceptor.js";
import { maskPhone } from "../fulfillment/mask.js";

// 감사 로그에 남길 도구 인자 요약. 칸 이름으로 가리는 29의 규칙(maskPersonalData)에 더해,
// 자유 글(거절 사유 등)에 섞인 전화번호·이메일도 가린다. 긴 글은 자른다
const PHONE = /(?<!\d)(0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/g;
const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@([\p{L}\p{N}.-]+\.[\p{L}]{2,})/gu;
const MAX_STRING = 200;

export function maskText(text: string): string {
  const masked = text.replace(PHONE, (m) => maskPhone(m)).replace(EMAIL, (_, first: string, domain: string) => `${first}***@${domain}`);
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

function deep(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(deep);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deep(v)]));
}

export function maskArgs(args: unknown): unknown {
  return deep(maskPersonalData(args ?? {}));
}
