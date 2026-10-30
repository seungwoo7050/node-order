import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from './logger/logger.options.js';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DemoAdminMaskInterceptor } from './auth/demo-admin-mask.interceptor.js';
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
import { PaymentsModule } from './payments/payments.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { CatalogCacheModule } from './cache/catalog-cache.js';
import { FulfillmentModule } from './fulfillment/fulfillment.module.js';
import { SettingsModule } from './admin/settings.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(loggerOptions),
    MetricsModule, RateLimitModule, PrismaModule, StorageModule, CatalogCacheModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule, FulfillmentModule, SettingsModule, ReconciliationModule, AdminModule],
  controllers: [AppController],
  // 데모 관리자에게 가는 관리자 API 응답의 배송지·연락처를 가린다(모든 /admin 경로에 한 번에)
  providers: [AppService, ShutdownLogger, { provide: APP_INTERCEPTOR, useClass: DemoAdminMaskInterceptor }],
})
export class AppModule {}