import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

await prisma.order.deleteMany();
await prisma.order.createMany({
  data: [
    { user: "kim", price: 12000, paid: true },
    { user: "lee", price: 8000, paid: false },
    { user: "kim", price: 5000, paid: true },
    { user: "lee", price: 30000, paid: true },
    { user: "park", price: 7000, paid: true },
  ],
});
console.log("seed 완료:", await prisma.order.count(), "건");
await prisma.$disconnect();
