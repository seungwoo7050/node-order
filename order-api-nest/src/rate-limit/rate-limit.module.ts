import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RateLimitMiddleware, RateLimitStore } from "./rate-limit.middleware.js";

@Module({ providers: [RateLimitStore] })
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes("*");
  }
}
