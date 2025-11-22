import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { TRPCError } from "@trpc/server";
import { AppModule } from "../src/app.module.js";
import { CategoriesService } from "../src/categories/categories.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { StorageService } from "../src/storage/storage.service.js";
import { appRouter } from "../src/trpc/router.js";
import { adminDb } from "./admin-db.js";

describe("tRPC - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let callerAs: (userId: string | null) => ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
    const deps = {
      prisma: app.get(PrismaService),
      storage: app.get(StorageService),
      categories: app.get(CategoriesService, { strict: false }),
    };
    callerAs = (userId) => appRouter.createCaller({ userId, ...deps });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김" }, { id: "lee", name: "이" }] });
    await adminDb.order.createMany({ data: [{ userId: "kim", price: 1000, paid: true }, { userId: "lee", price: 2000, paid: true }] });
    await adminDb.category.create({ data: { name: "주변기기" } });
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: unknown) => (e instanceof TRPCError ? e.code : String(e)));

  it("로그인하지 않으면 me.orders는 UNAUTHORIZED", async () => {
    expect(await codeOf(callerAs(null).me.orders())).toBe("UNAUTHORIZED");
  });

  it("kim은 자기 주문만 받고, lee의 주문은 NOT_FOUND", async () => {
    const kim = callerAs("kim");
    expect((await kim.me.orders()).map((o) => o.price)).toEqual([1000]);
    expect(await codeOf(kim.me.order({ id: 2 }))).toBe("NOT_FOUND");
  });

  it("입력이 스키마에 맞지 않으면 프로시저가 실행되기 전에 BAD_REQUEST", async () => {
    // @ts-expect-error - 타입으로도 막히지만, 런타임 검사(zod)를 확인하려고 일부러 문자열을 넣는다
    expect(await codeOf(callerAs(null).categories.products({ categoryId: "abc" }))).toBe("BAD_REQUEST");
  });

  it("서비스가 던진 Nest 예외(NotFoundException)는 NOT_FOUND로 바뀐다 - 500이 아니다", async () => {
    expect(await codeOf(callerAs(null).categories.products({ categoryId: 999 }))).toBe("NOT_FOUND");
  });

  it("HTTP: 토큰을 실으면 그 사용자로, 잘못된 토큰이면 401이고 응답에 stack이 없다", async () => {
    const token = app.get(JwtService, { strict: false }).sign({ sub: "kim" });
    const ok = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.data).toHaveLength(1);

    const bad = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: "Bearer not-a-token" } });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.data.stack).toBeUndefined();
  });
});