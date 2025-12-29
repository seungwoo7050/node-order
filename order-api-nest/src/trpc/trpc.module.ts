import { Logger, MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { CategoriesService } from "../categories/categories.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { appRouter } from "./router.js";
import type { Context } from "./trpc.js";

@Module({})
export class TrpcModule implements NestModule {
  constructor(private readonly moduleRef: ModuleRef) {}

  configure(consumer: MiddlewareConsumer) {
    const get = <T>(type: new (...args: never[]) => T) => this.moduleRef.get(type, { strict: false });
    const jwt = get(JwtService);
    const prisma = get(PrismaService);
    const storage = get(StorageService);
    const categories = get(CategoriesService);
    const logger = new Logger("tRPC");

    const handler = createExpressMiddleware({
      router: appRouter,
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") logger.error(`${path}: ${error.message}`);
      },
      createContext: ({ req }): Context => {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        let userId: string | null = null;
        if (token) {
          try {
            userId = jwt.verify<{ sub: string }>(token).sub;
          } catch {
            userId = null;
          }
        }
        return { userId, prisma, storage, categories };
      },
    });

    consumer.apply(handler).forRoutes({ path: "trpc/*path", method: RequestMethod.ALL });
  }
}