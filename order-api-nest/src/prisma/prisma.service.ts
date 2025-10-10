import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 환경변수가 없습니다");
    super({
      adapter: new PrismaPg({ connectionString: url }),
      log: process.env.PRISMA_LOG === "query" ? ["query"] : [],
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}