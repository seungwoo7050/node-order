import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

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

  asUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  asAdmin<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', 'admin', true)`;
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}