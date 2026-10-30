import type { PrismaService } from "../prisma/prisma.service.js";
import { StoreSettingsService } from "./store-settings.service.js";

// 설정 캐시 경합: 저장 전에 시작한 읽기가 무효화 뒤에 끝나도 옛 값을 다시 캐시하지 않는다
type Row = { id: number; storeName: string; version: number };

function fakePrisma() {
  const pending: { resolve: (row: Row) => void }[] = [];
  let row: Row = { id: 1, storeName: "옛 상호", version: 1 };
  const prisma = {
    storeSettings: {
      // 읽기는 테스트가 끝낼 때까지 기다린다(그때의 행을 돌려준다)
      findUniqueOrThrow: vi.fn(() => new Promise<Row>((resolve) => pending.push({ resolve }))),
    },
  };
  return {
    prisma: prisma as unknown as PrismaService,
    reads: () => prisma.storeSettings.findUniqueOrThrow.mock.calls.length,
    setRow: (r: Row) => (row = r),
    // 가장 먼저 시작한 읽기를 지금 행으로 끝낸다. snapshot을 주면 그 값으로(읽기 시작 시점의 옛 값 흉내)
    finishNext: async (snapshot?: Row) => {
      pending.shift()!.resolve(snapshot ?? row);
      await new Promise((r) => setImmediate(r));
    },
  };
}

describe("상점 설정 캐시", () => {
  let service: StoreSettingsService;
  afterEach(async () => service?.onModuleDestroy());

  it("저장 전에 시작한 읽기가 무효화 뒤에 옛 값으로 끝나도 캐시에 넣지 않고, 다음 읽기는 새로 읽는다", async () => {
    const db = fakePrisma();
    service = new StoreSettingsService(db.prisma);
    const stale = service.get(); // 1판을 읽는 중
    const oldRow = { id: 1, storeName: "옛 상호", version: 1 };

    // 그 사이 다른 곳에서 2판으로 저장하고 알렸다
    db.setRow({ id: 1, storeName: "새 상호", version: 2 });
    service.invalidate(2);

    await db.finishNext(oldRow);
    expect((await stale).version).toBe(1); // 먼저 시작한 호출에는 그때 읽은 값을 돌려준다

    const fresh = service.get();
    expect(db.reads()).toBe(2); // 옛 값이 캐시에 없어 새로 읽는다(무효화 전 읽기를 이어받지도 않는다)
    await db.finishNext();
    expect(await fresh).toMatchObject({ storeName: "새 상호", version: 2 });
    expect(await service.get()).toMatchObject({ version: 2 }); // 이번에는 캐시에서
    expect(db.reads()).toBe(2);
  });

  it("알린 판보다 낮은 값은 캐시에 넣지 않는다(다른 인스턴스의 저장 알림이 읽기보다 먼저 온 경우)", async () => {
    const db = fakePrisma();
    service = new StoreSettingsService(db.prisma);
    service.invalidate(3); // 3판으로 저장됐다는 알림
    const read = service.get();
    await db.finishNext({ id: 1, storeName: "늦게 보이는 옛 값", version: 2 });
    expect((await read).version).toBe(2);
    const again = service.get();
    expect(db.reads()).toBe(2); // 2판은 캐시하지 않았다
    await db.finishNext({ id: 1, storeName: "3판", version: 3 });
    expect((await again).version).toBe(3);
    await service.get();
    expect(db.reads()).toBe(2);
  });

  it("동시에 들어온 읽기는 한 번만 DB를 읽는다", async () => {
    const db = fakePrisma();
    service = new StoreSettingsService(db.prisma);
    const both = Promise.all([service.get(), service.get()]);
    expect(db.reads()).toBe(1);
    await db.finishNext();
    expect((await both).map((v) => v.version)).toEqual([1, 1]);
  });
});
