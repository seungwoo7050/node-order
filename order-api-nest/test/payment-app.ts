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

// 10,000원 상품 하나, 구매자 kim, 관리자 boss
export async function seedPaymentData(baseUrl: string): Promise<{ user: string; admin: string }> {
  await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
  await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw") } });
  await adminDb.user.create({ data: { id: "boss", name: "관리자", role: "admin", passwordHash: await hashPassword("pw") } });
  await adminDb.product.create({ data: { name: "마우스", price: 10_000, stock: 10 } });
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
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call("POST", path, body, headers),
  };
}

export const paymentOf = (orderId: number) => adminDb.payment.findUniqueOrThrow({ where: { orderId } });
export const paidNotices = () => adminDb.outboxEvent.count({ where: { type: "order.paid" } });
