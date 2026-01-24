import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { Logger } from 'nestjs-pino';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter.js';
import { RedisIoAdapter } from './redis/redis-io.adapter.js';
import { existsSync } from 'node:fs';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  
  // 1. 앱 생성과 앱 자체의 동작
  // bufferLogs : pino 로거가 준비될 때까지 부팅 로그를 모아 뒀다가 pino로 내보낸다
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map((s) => s.trim()));
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // 2. 미들웨어: 라우팅 전에 모든 요청이 거친다
  app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
  app.use(cookieParser());

  // 3. Nest 전역 설정: 미들웨어가 아니다. 라우팅이 끝나 어느 핸들러로 갈지 정해진 뒤에 걸린다
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  
  // 4. ws 어댑터
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(process.env.REDIS_URL!);
  app.useWebSocketAdapter(redisIoAdapter);

  // 5. 마지막 요청 받기 시작
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
