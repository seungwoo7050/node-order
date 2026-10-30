import { maskContacts, PERSONAL_DATA_MASKERS } from "../fulfillment/mask.js";

// 오류 추적 이벤트(Sentry 호환)를 보내기 전에 개인정보와 비밀값을 지운다(beforeSend, beforeBreadcrumb).
// API와 콘솔이 같은 함수를 쓴다(콘솔은 order-api-nest/observability/scrub으로 가져간다). 그래서 이 파일은
// 다른 모듈을 가져오지 않는 fulfillment/mask.ts만 쓴다.
//   1. 칸 이름: 배송지 칸은 29의 규칙(PERSONAL_DATA_MASKERS)으로 가리고, 연락처·이메일·주소 칸은 통째로 가린다.
//      비밀 칸(토큰, 비밀번호, 쿠키, Authorization …)은 값을 지운다
//   2. 글: 섞인 전화번호·이메일을 가리고(maskContacts), 토큰 모양 값(Bearer, JWT, nop_ 접근 토큰, sk_·whsec_ 키,
//      GitHub 토큰)을 지운다
//   3. 요청: 헤더의 Authorization·Cookie·Set-Cookie, 요청 쿠키, 본문을 위 규칙으로 본다
// event_id·trace_id 같은 식별자는 칸 이름을 보고 건드리지 않는다(32자리 16진수라 토큰 규칙에 걸리지 않게 규칙을 좁게 둔다)
export const FILTERED = "[Filtered]";

const SECRET_KEY = /(authorization|cookie|token|secret|password|passwd|api[-_]?key|session|signature|dsn)/i;
const CONTACT_KEY = /^(email|e-mail|phone|mobile|tel|contact|address|recipient|ip_address)$/i;
const KEEP_KEYS = new Set(["modules", "event_id", "trace_id", "span_id", "parent_span_id", "release", "environment", "timestamp", "start_timestamp", "platform", "level", "type", "filename", "abs_path", "module", "function", "lineno", "colno", "in_app"]);

const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, // Authorization 헤더 값
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT(접근 토큰, Auth.js 세션)
  /\bnop_[A-Za-z0-9_-]{8,}/g, // MCP 개인 접근 토큰(30)
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe 키
  /\bwhsec_[A-Za-z0-9]{8,}/g, // Stripe 웹훅 비밀
  /\b(?:test|live)_(?:sk|gsk|ck|gck)_[A-Za-z0-9]{8,}/g, // 토스 키
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub 토큰
];

// 글에 섞인 도로명 주소: "서울특별시 강남구 테헤란로 123 101동 202호" → "서울특별시 강남구 ***"(maskAddress처럼 시·구까지만).
// 앞에 시·도·구·군 낱말이 있어야 한다("무선 이어폰 프로 2" 같은 상품 이름을 가리지 않게)
const ROAD_ADDRESS = /((?:[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|시|도|구|군)\s+){1,3})[가-힣\d]+(?:로|길)(?:\s?\d+(?:-\d+)?)?(?:,?\s?[\d가-힣-]*\d[\d가-힣-]*(?:동|호|층))*/g;

export function scrubText(text: string): string {
  let out = text; // 토큰을 먼저 지운다(토큰 속 숫자가 전화번호처럼 반만 가려지지 않게)
  for (const re of TOKEN_PATTERNS) out = out.replace(re, FILTERED);
  return maskContacts(out).replace(ROAD_ADDRESS, (_m, head: string) => `${head}***`);
}

function scrubValue(value: unknown, key: string | undefined, depth: number): unknown {
  if (depth > 12) return FILTERED; // 순환·아주 깊은 값은 버린다
  if (key !== undefined && KEEP_KEYS.has(key)) return value;
  if (typeof value === "string") {
    if (key !== undefined) {
      if (SECRET_KEY.test(key)) return FILTERED;
      const mask = PERSONAL_DATA_MASKERS[key];
      if (mask) return value.length > 0 ? mask(value) : value;
      if (CONTACT_KEY.test(key)) return FILTERED;
    }
    return scrubText(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, undefined, depth + 1));
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // 비밀 칸은 문자열이 아니어도(객체·배열로 온 쿠키 등) 통째로 지운다
    if (SECRET_KEY.test(k) && v !== null && v !== undefined && typeof v !== "boolean" && typeof v !== "number") out[k] = FILTERED;
    else out[k] = scrubValue(v, k, depth + 1);
  }
  return out;
}

type Scrubbable = { request?: { cookies?: unknown; headers?: unknown; data?: unknown } & Record<string, unknown>; user?: unknown } & Record<string, unknown>;

// beforeSend. 이벤트 전체를 훑는다(예외 메시지, breadcrumb, extra, contexts, 요청)
export function scrubEvent<T>(event: T): T {
  const e = scrubValue(event, undefined, 0) as Scrubbable;
  if (e.request) {
    delete e.request.cookies;
    // 요청 본문은 칸 규칙으로 가린 뒤에도 남기지 않는다: 손님이 쓴 자유 글(배송 메모 등)이 칸 이름 밖에 있을 수 있다
    if (e.request.data !== undefined) e.request.data = FILTERED;
  }
  if (e.user && typeof e.user === "object") e.user = { id: (e.user as { id?: unknown }).id }; // 사용자 id만(이메일·IP는 버린다)
  return e as T;
}

// beforeBreadcrumb. 콘솔 로그·HTTP 호출 기록에 섞인 값도 같은 규칙으로
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return scrubValue(breadcrumb, undefined, 0) as T;
}
