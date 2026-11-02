import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { adminDb } from "./admin-db.js";

// 결제 e2e가 같이 쓰는 앱·데이터 준비. PG는 바꿔 끼우지 않는다(시뮬레이터 주소를 환경변수로 준다)
export async function startPaymentApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(0);
  return { app, baseUrl: (await app.getUrl()).replace("[::1]", "localhost") };
}

// 결제 시작에 필요한 배송지(28). 연락처 원문이 로그에 남지 않는지 보는 테스트도 이 값을 쓴다
// 결제할 때 동의한 개인정보처리방침 판(29). 테스트 DB의 지금 판은 0033이 넣은 1판이다(판을 늘린 테스트는 끝나면 지운다)
export const CONSENT = { privacyConsentVersion: 1 };

export const SHIPPING = { recipientName: "김구매", recipientPhone: "010-2345-6789", postalCode: "06236", address1: "서울특별시 강남구 테헤란로 123", address2: "4층", deliveryMemo: "문 앞" };

// 7,000원 상품 하나(배송비 3,000원을 더해 1개 결제 금액이 10,000원), 구매자 kim, 관리자 boss
export async function seedPaymentData(baseUrl: string, price = 7_000): Promise<{ user: string; admin: string }> {
  await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
  await adminDb.$executeRaw`DELETE FROM integration_secrets`;
  await adminDb.$executeRaw`UPDATE system_controls SET pause_paid_apis = false, maintenance_mode = false WHERE id = 1`;
  await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw") } });
  await adminDb.user.create({ data: { id: "boss", name: "관리자", role: "admin", passwordHash: await hashPassword("pw") } });
  await adminDb.product.create({ data: { name: "마우스", price, stock: 10 } });
  const login = async (id: string) => {
    const res = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password: "pw" }) });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  return { user: await login("kim"), admin: await login("boss") };
}

export function client(baseUrl: string, token: string) {
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call("POST", path, body, headers),
    put: (path: string, body?: unknown, headers?: Record<string, string>) => call("PUT", path, body, headers),
    patch: (path: string, body?: unknown, headers?: Record<string, string>) => call("PATCH", path, body, headers),
    delete: (path: string) => call("DELETE", path),
  };
}

export async function demoAdminToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as: "admin" }) });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export const paymentOf = (orderId: number) => adminDb.payment.findUniqueOrThrow({ where: { orderId } });
export const paidNotices = () => adminDb.outboxEvent.count({ where: { type: "order.paid" } });
