import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/auth/password.js";
import { deleteUsers } from "../src/auth/demo-user.js";
import { deleteOrdersKeepingPgPayments } from "../src/orders/delete-orders.js";
import { StorageService } from "../src/storage/storage.service.js";
import { CATALOG_KEYS_TO_CLEAR } from "../src/cache/catalog-key.js";

type Catalog = {
  categories: { id: number; name: string; parentId: number | null }[];
  products: { id: number; name: string; price: number; stock: number; category: string; photo: string; description: string }[];
};

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL! }) });
const storage = new StorageService();
const dir = new URL("./seed/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", dir), "utf8")) as Catalog;

// 1. 임시 사용자
const temp = await prisma.user.findMany({ where: { expiresAt: { not: null } }, select: { id: true } });
const deletedTemp = await prisma.$transaction((tx) => deleteUsers(tx, temp.map((u) => u.id)));

// 2. 사진
await storage.ensureBucket();
let uploaded = 0;
const noPhoto = new Set<string>();
for (const p of catalog.products) {
  const key = `seed/${p.photo}`;
  const body = await readFile(new URL(`photos/${p.photo}`, dir)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (body) {
    if (await storage.putIfAbsent(key, body, "image/webp")) uploaded++;
  } else if (!(await storage.head(key))) {
    noPhoto.add(p.photo);
  }
}
if (noPhoto.size > 0) console.warn(`사진 없음(파일도 저장소의 키도 없다): ${[...noPhoto].join(", ")}`);

// 3. 카테고리·상품·상점 설정·약관·쿠폰·리뷰 초기화
for (const c of catalog.categories) {
  await prisma.category.upsert({ where: { id: c.id }, create: c, update: { name: c.name, parentId: c.parentId, sortOrder: 0 } });
}
const categoryIds = new Map(catalog.categories.map((c) => [c.name, c.id]));
const seedCategoryIdList = catalog.categories.map((c) => c.id);
for (const p of catalog.products) {
  const categoryId = categoryIds.get(p.category);
  if (categoryId === undefined) throw new Error(`catalog.json: 없는 카테고리 "${p.category}" (${p.name})`);
  const data = { name: p.name, price: p.price, stock: p.stock, description: p.description, categoryId, imageKey: noPhoto.has(p.photo) ? null : `seed/${p.photo}`, isVisible: true, deletedAt: null, materialInfo: "", sizeGuide: "" };
  await prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
}
const productIds = catalog.products.map((p) => p.id);
await prisma.productImage.deleteMany({});
await prisma.productVariant.deleteMany({ where: { orderItems: { none: {} }, returnItems: { none: {} } } });
await prisma.product.deleteMany({ where: { id: { notIn: productIds }, items: { none: {} }, returnItems: { none: {} } } });
await prisma.product.updateMany({ where: { id: { notIn: productIds } }, data: { stock: 0, isVisible: false, deletedAt: new Date(), categoryId: null } });
await prisma.category.updateMany({ where: { id: { notIn: seedCategoryIdList } }, data: { parentId: null } });
await prisma.category.deleteMany({ where: { id: { notIn: seedCategoryIdList }, products: { none: {} }, children: { none: {} } } });
await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT max(id) FROM categories))`;
await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products))`;

const defaultStoreSettings = {
  storeName: "Brown Store",
  representative: "대표자",
  businessNumber: "1234567891",
  mailOrderNumber: "제0000-서울강남-00000호",
  address: "서울특별시 강남구 테헤란로 123",
  phone: "02-000-0000",
  email: "help@example.com",
  privacyOfficer: "개인정보 보호책임자",
  shippingFee: 3000,
  freeShippingThreshold: 50000,
  returnShippingFee: 6000,
  lowStockThreshold: 5,
  storeDesign: "editorial-atelier",
  heroTitle: "CONTEMPORARY ARCHIVE COLLECTION",
  heroSubtitle: "소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브",
  announcementText: "전 상품 50,000원 이상 구매 시 무료배송 · 신규 가입 웰컴 쿠폰 증정",
};
await prisma.storeSettings.upsert({
  where: { id: 1 },
  create: { id: 1, ...defaultStoreSettings },
  update: defaultStoreSettings,
});
await prisma.legalDocument.deleteMany({ where: { version: { gt: 1 } } });
await prisma.review.deleteMany({});
await prisma.coupon.deleteMany({});

// 4. 시드 사용자와 그 주문
const seedUsers = [
  { id: "kim", name: "김", role: "admin" as const },
  { id: "lee", name: "이", role: "user" as const },
  { id: "park", name: "박", role: "user" as const },
  { id: "choi", name: "최", role: "user" as const },
];
for (const u of seedUsers) {
  const passwordHash = await hashPassword(process.env.DEMO_PASSWORD!);
  await prisma.user.upsert({ where: { id: u.id }, create: { ...u, passwordHash, isActive: true }, update: { name: u.name, passwordHash, isActive: true, role: u.role } });
}
await prisma.systemControl.upsert({
  where: { id: 1 },
  create: { id: 1, pausePaidApis: false, maintenanceMode: false },
  update: { pausePaidApis: false, maintenanceMode: false },
});

const seedOrders: { userId: string; paid: boolean; items: [productId: number, quantity: number][] }[] = [
  { userId: "kim", paid: true, items: [[6, 1], [16, 2]] },
  { userId: "lee", paid: false, items: [[8, 1]] },
  { userId: "kim", paid: true, items: [[9, 1]] },
  { userId: "lee", paid: true, items: [[7, 1], [13, 1]] },
  { userId: "park", paid: true, items: [[15, 1], [16, 1]] },
];
const seedUserIds = seedUsers.map((u) => u.id);
// 시드 외 일반/비회원 사용자 중 PG(stripe·toss) 결제가 없는 사용자의 주문을 정리하고 계정도 정리한다
const extraUsers = await prisma.user.findMany({ where: { id: { notIn: seedUserIds } }, select: { id: true } });
const extraUserIds = extraUsers.map((u) => u.id);
if (extraUserIds.length > 0) {
  await prisma.$transaction((tx) => deleteOrdersKeepingPgPayments(tx, extraUserIds));
  const removableUsers = await prisma.user.findMany({
    where: { id: { in: extraUserIds }, orders: { none: {} } },
    select: { id: true },
  });
  const removableIds = removableUsers.map((u) => u.id);
  if (removableIds.length > 0) {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: removableIds } } });
    await prisma.accessToken.deleteMany({ where: { userId: { in: removableIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: removableIds } } });
    await prisma.outboxEvent.deleteMany({ where: { userId: { in: removableIds } } });
    await prisma.user.deleteMany({ where: { id: { in: removableIds } } });
  }
}
// 견본 주문을 다시 만든다. PG(stripe·toss) 결제 기록이 있는 주문은 지우지 않고 남긴다(0031)
const { kept: keptPgOrders } = await prisma.$transaction((tx) => deleteOrdersKeepingPgPayments(tx, seedUserIds));
const priceOf = new Map(catalog.products.map((p) => [p.id, p.price]));
for (const o of seedOrders) {
  const items = o.items.map(([productId, quantity]) => ({ productId, quantity, unitPrice: priceOf.get(productId)! }));
  const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const order = await prisma.order.create({
    data: { userId: o.userId, paid: o.paid, status: o.paid ? "paid" : "pending_payment", totalAmount: total, items: { create: items } },
  });
  // 결제 완료 견본 주문에도 결제 행을 둔다(PG를 거치지 않았으므로 manual)
  if (o.paid) await prisma.payment.create({ data: { orderId: order.id, provider: "manual", providerOrderId: `order-${order.id}`, amount: total, status: "paid", approvedAt: order.createdAt } });
}

// 5. 카탈로그 캐시
let cacheCleared = "건너뜀(REDIS_URL 없음)";
if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 2000 });
  try {
    await redis.connect();
    await redis.del(...CATALOG_KEYS_TO_CLEAR);
    cacheCleared = "지움";
  } catch (err) {
    cacheCleared = `못 지움(${(err as Error).message}, TTL이 지나면 사라진다)`;
  } finally {
    redis.disconnect();
  }
}

console.log(
  `seed 완료: 상품 ${catalog.products.length}개(사진 새로 올림 ${uploaded}장, 사진 없음 ${noPhoto.size}개), 임시 사용자 ${deletedTemp}명 삭제,`,
  `사용자 ${await prisma.user.count()}명, 주문 ${await prisma.order.count()}건(PG 결제가 있어 남긴 견본 사용자 주문 ${keptPgOrders}건), 카탈로그 캐시 ${cacheCleared}`,
);
await prisma.$disconnect();
