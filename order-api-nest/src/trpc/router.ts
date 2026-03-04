import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listMyOrders } from "../me/my-orders.js";
import { orderDetailSelect, withPrice } from "../me/order-select.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../pagination/cursor.js";
import { getProduct, listProducts } from "../products/product-list.js";
import { protectedProcedure, publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  products: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.number().int().positive().nullish() }).default({ limit: DEFAULT_LIMIT }))
      .query(({ ctx, input }) => listProducts({ prisma: ctx.prisma, storage: ctx.storage, cache: ctx.catalogCache }, input)),
    byId: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const product = await getProduct({ prisma: ctx.prisma, storage: ctx.storage, cache: ctx.catalogCache }, input.id);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: `product ${input.id} not found` });
      return product;
    }),
  }),

  categories: router({
    products: publicProcedure
      .input(z.object({ categoryId: z.number().int().positive() }))
      .query(({ ctx, input }) => ctx.categories.productsInSubtree(input.categoryId)),
  }),

  me: router({
    profile: protectedProcedure.query(({ ctx }) =>
      ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true, role: true } }),
    ),
    orders: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.string().nullish() }).default({ limit: DEFAULT_LIMIT }))
      .query(({ ctx, input }) => ctx.prisma.asUser(ctx.userId, (tx) => listMyOrders(tx, ctx.userId, input))),
    order: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const order = await ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findFirst({ where: { id: input.id, userId: ctx.userId }, select: orderDetailSelect }),
      );
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: `order ${input.id} not found` });
      return withPrice(order);
    }),
  }),
});

export type AppRouter = typeof appRouter;
