import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { ProductsModule } from "./products/products.module.js";
import { OutboxModule } from './outbox/outbox.module.js';
import { MeModule } from './me/me.module.js';
import { LeaderModule } from './leader/leader.module.js';
import { StorageModule } from './storage/storage.module.js';
import { HealthModule } from './health/health.module.js';
import { ShutdownLogger } from './shutdown-logger.js';
import { CategoriesModule } from './categories/categories.module.js';
import { TrpcModule } from './trpc/trpc.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        genReqId: (req, res) => {
          const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
          res.setHeader("X-Request-Id", id);
          return id;
        },
        redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty", options: { singleLine: true } },
      },
    }),
    PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}