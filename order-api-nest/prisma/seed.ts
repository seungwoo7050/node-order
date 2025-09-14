import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

await prisma.order.deleteMany();
await prisma.user.deleteMany();

await prisma.user.createMany({
  data: [
    { id: "kim", name: "김" },
    { id: "lee", name: "이" },
    { id: "park", name: "박" },
    { id: "choi", name: "최" },
  ],
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
console.log("seed 완료: 사용자", await prisma.user.count(), "명, 주문", await prisma.order.count(), "건");