import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { maskAddress, maskName, maskPhone } from "../fulfillment/mask.js";

// 데모 관리자(DEMO_LOGIN=1이면 누구나 된다)에게는 손님의 개인정보 원문을 주지 않는다.
// 관리자 API(/admin/*) 응답 전체를 훑어 배송지·연락처 칸을 가린다. 칸을 이름으로 찾으므로 새 관리자 API가 생겨도 같이 가려진다
// (컨트롤러마다 따로 가리면 하나를 빠뜨린다). 진짜 관리자와 손님 자신의 응답(/me)은 그대로다
const MASKERS: Record<string, (v: string) => string> = {
  recipientName: maskName,
  recipientPhone: maskPhone,
  postalCode: (v) => `${v.slice(0, 3)}**`,
  address1: maskAddress,
  address2: () => "***",
  deliveryMemo: () => "***",
  detail: () => "***", // 반품 사유 상세(손님이 쓴 자유 글이라 연락처가 들어 있을 수 있다)
};

export function maskPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPersonalData);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      const mask = MASKERS[k];
      if (mask && typeof v === "string" && v.length > 0) return [k, mask(v)];
      return [k, maskPersonalData(v)];
    }),
  );
}

@Injectable()
export class DemoAdminMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<{ user?: { role?: string }; path?: string }>();
    if (req.user?.role !== "demo_admin" || !req.path?.startsWith("/admin")) return next.handle();
    return next.handle().pipe(map(maskPersonalData));
  }
}
