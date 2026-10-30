import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PgSearchEngine } from "../src/search/pg-search-engine.js";
import { searchEngineContract } from "./search-engine.contract.js";

// 앱과 같은 역할(order_app)로 붙는다
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
afterAll(() => prisma.$disconnect());

searchEngineContract("PostgreSQL", async () => ({
  engine: new PgSearchEngine(prisma),
  clearIndex: async () => {
    await prisma.$executeRaw`DELETE FROM product_search`;
  },
}));
