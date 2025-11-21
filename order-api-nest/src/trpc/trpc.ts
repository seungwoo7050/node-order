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

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const internal = error.code === "INTERNAL_SERVER_ERROR";
    return { ...shape, message: internal ? "서버 오류" : shape.message, data: { ...shape.data, stack: undefined } };
  },
});

export const router = t.router;
const CODE_BY_STATUS: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "TOO_MANY_REQUESTS",
};

const nestExceptions = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof HttpException) {
    const code = CODE_BY_STATUS[result.error.cause.getStatus()];
    if (code) throw new TRPCError({ code, message: result.error.cause.message, cause: result.error.cause });
  }
  return result;
});

export const publicProcedure = t.procedure.use(nestExceptions);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});