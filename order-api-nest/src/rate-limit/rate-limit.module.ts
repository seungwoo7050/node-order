import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RateLimitMiddleware, RateLimitStore } from "./rate-limit.middleware.js";

// RateLimitStore는 관리자당 LLM 호출 제한(30)도 같이 쓴다
@Module({ providers: [RateLimitStore], exports: [RateLimitStore] })
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes("*");
  }
}
