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

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, AuthModule, NotificationsModule, ProductsModule, OutboxModule, MeModule, LeaderModule, StorageModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
