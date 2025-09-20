import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { ProductsModule } from "./products/products.module.js";

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, AuthModule, NotificationsModule, ProductsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
