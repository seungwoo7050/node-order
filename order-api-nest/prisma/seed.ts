import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL! }) });

await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;

const users = [
  { id: "kim", name: "김", role: "admin" as const },
  { id: "lee", name: "이" },
  { id: "park", name: "박" },
  { id: "choi", name: "최" },
];

const tree: [string, number | null][] = [
  ["전자기기", null], ["컴퓨터", 1], ["키보드", 2], ["마우스", 2], ["음향", 1], ["헤드폰", 5], ["생활", null], ["주방", 7],
];
for (const [name, parentId] of tree) await prisma.category.create({ data: { name, parentId } });

await prisma.user.createMany({
  data: await Promise.all(users.map(async (u) => ({ ...u, passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) }))),
});

await prisma.order.createMany({
  data: [
    { userId: "kim", price: 12000, paid: true },
    { userId: "lee", price: 8000, paid: false },
    { userId: "kim", price: 5000, paid: true },
    { userId: "lee", price: 30000, paid: true },
    { userId: "park", price: 7000, paid: true },
  ],
});

await prisma.product.createMany({
  data: [
    { name: "한정판 키보드", price: 150000, stock: 10, categoryId: 3 },
    { name: "마우스", price: 30000, stock: 100, categoryId: 4 },
    { name: "무선 헤드폰", price: 90000, stock: 30, categoryId: 6 },
    { name: "전기 주전자", price: 40000, stock: 20, categoryId: 8 },
  ],
});

console.log("seed 완료: 사용자", await prisma.user.count(), "명, 주문", await prisma.order.count(), "건, 상품", await prisma.product.count(), "개");