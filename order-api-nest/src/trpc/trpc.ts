import { HttpException } from "@nestjs/common";
import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import type { CategoriesService } from "../categories/categories.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";

export interface Context {
  userId: string | null;
  prisma: PrismaService;
  storage: StorageService;
  categories: CategoriesService;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});