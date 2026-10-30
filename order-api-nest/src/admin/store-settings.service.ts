import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ValidationPipe, type ValidationError } from "@nestjs/common";
import { Redis } from "ioredis";
import type { StoreSettings } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ShippingPolicy } from "../fulfillment/policy.js";
import { StoreSettingsDto } from "./store-settings.dto.js";

// 인스턴스가 여럿이면 저장한 쪽이 이 채널로 알리고, 받은 쪽은 메모리 캐시를 버린다
export const SETTINGS_CHANNEL = process.env.STORE_SETTINGS_CHANNEL ?? "store-settings:changed";
// pub/sub 알림을 놓쳐도(Redis가 잠깐 끊김) 이 시간 뒤에는 DB에서 다시 읽는다
const CACHE_TTL_MS = Number(process.env.STORE_SETTINGS_CACHE_MS ?? 60_000);

export type SettingsView = Omit<StoreSettings, "id">;
// 상점 바닥글·장바구니에 보이는 값(누구나 읽는다). 재고 부족 기준·version은 관리자 화면에만 있다
export type PublicStoreSettings = Omit<SettingsView, "lowStockThreshold" | "version" | "updatedAt">;

// 칸별 오류를 { 칸: 문구 }로 돌려준다(설정 화면이 칸 아래에 그대로 보인다).
// 컨트롤러의 인자 타입을 DTO 클래스로 두면 전역 ValidationPipe가 먼저 문자열 배열로 400을 낸다:
// 인자 타입은 StoreSettingsInput(타입만)으로 두고 이 파이프가 expectedType으로 검증한다
export type StoreSettingsInput = Omit<StoreSettingsDto, never>;
export const SETTINGS_BODY = new ValidationPipe({
  whitelist: true,
  transform: true,
  expectedType: StoreSettingsDto,
  exceptionFactory: (errors: ValidationError[]) => {
    const fields = Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})[0] ?? "올바르지 않은 값입니다"]));
    return new BadRequestException({ statusCode: 400, error: "Bad Request", message: Object.values(fields), fields });
  },
});

// If-Match: 3, "3", W/"3" 모두 받는다
export function parseIfMatch(header: string | undefined): number | null {
  const m = header?.trim().match(/^(?:W\/)?"?(\d+)"?$/);
  return m ? Number(m[1]) : null;
}

// 상점 설정 한 행. 메모리에 캐시하고, 저장하면 버린 뒤 다른 인스턴스에도 알린다(Redis pub/sub)
@Injectable()
export class StoreSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreSettingsService.name);
  private cached?: { value: SettingsView; at: number };
  private loading?: Promise<SettingsView>;
  private readonly pub = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 200 });
  private readonly sub = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

  constructor(private readonly prisma: PrismaService) {
    this.pub.on("error", () => {});
    this.sub.on("error", () => {});
  }

  async onModuleInit() {
    this.sub.on("message", (channel) => {
      if (channel === SETTINGS_CHANNEL) this.invalidate();
    });
    // 기다리지 않는다: Redis가 없어도 앱은 뜬다(연결되면 구독하고, 그 전에는 TTL이 지나야 다른 인스턴스가 새 값을 본다)
    this.sub.subscribe(SETTINGS_CHANNEL).catch((err: Error) => this.logger.warn(`설정 변경 알림을 구독하지 못했다: ${err.message}`));
  }

  // 테스트가 구독이 끝났는지 기다린다
  async subscribed(): Promise<void> {
    await this.sub.subscribe(SETTINGS_CHANNEL); // 이미 구독 중이면 그대로다
  }

  async onModuleDestroy() {
    await Promise.all([this.pub.quit().catch(() => {}), this.sub.quit().catch(() => {})]);
  }

  invalidate() {
    this.cached = undefined;
  }

  async get(): Promise<SettingsView> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    this.loading ??= (async () => {
      try {
        const { id: _id, ...value } = await this.prisma.storeSettings.findUniqueOrThrow({ where: { id: 1 } });
        this.cached = { value, at: Date.now() };
        return value;
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  async publicView(): Promise<PublicStoreSettings> {
    const { lowStockThreshold: _l, version: _v, updatedAt: _u, ...rest } = await this.get();
    return rest;
  }

  async shippingPolicy(): Promise<ShippingPolicy> {
    const s = await this.get();
    return { shippingFee: s.shippingFee, freeShippingThreshold: s.freeShippingThreshold, returnShippingFee: s.returnShippingFee };
  }

  // 낙관적 잠금: 화면이 읽은 version과 지금 version이 같을 때만 저장한다. 다르면 409와 지금 값
  async save(input: StoreSettingsInput, expectedVersion: number): Promise<SettingsView> {
    const { count } = await this.prisma.storeSettings.updateMany({
      where: { id: 1, version: expectedVersion },
      data: { ...input, version: { increment: 1 }, updatedAt: new Date() },
    });
    this.invalidate();
    if (count === 0) {
      const current = await this.get();
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        message: "다른 곳에서 먼저 설정을 저장했습니다. 지금 값을 다시 불러온 뒤 저장해 주세요",
        currentVersion: current.version,
        current,
      });
    }
    await this.pub.publish(SETTINGS_CHANNEL, String(expectedVersion + 1)).catch((err: Error) => this.logger.warn(`설정 변경을 알리지 못했다: ${err.message}`));
    const saved = await this.get();
    this.logger.log(`상점 설정 저장: version ${saved.version}`);
    return saved;
  }
}
