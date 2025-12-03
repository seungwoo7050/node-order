import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { orderSelect } from "../me/order-select.js";
import { protectedProcedure, publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  products: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const products = await ctx.prisma.product.findMany({ orderBy: { id: "asc" } });
      return Promise.all(
        products.map(async ({ imageKey, ...p }) => ({
          ...p,
          imageUrl: imageKey ? await ctx.storage.createDownloadUrl(imageKey, 600) : null,
        })),
      );
    }),
  }),

  categories: router({
    products: publicProcedure
      .input(z.object({ categoryId: z.number().int().positive() }))
      .query(({ ctx, input }) => ctx.categories.productsInSubtree(input.categoryId)),
  }),

  me: router({
    orders: protectedProcedure.query(({ ctx }) =>
      ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "asc" } }),
      ),
    ),
    order: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const order = await ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findFirst({ where: { id: input.id, userId: ctx.userId }, select: orderSelect }),
      );
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: `order ${input.id} not found` });
      return order;
    }),
  }),
});

export type AppRouter = typeof appRouter;