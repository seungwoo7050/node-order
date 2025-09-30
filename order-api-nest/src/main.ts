import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter.js';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
