import { Controller, Get, Header, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Gauge } from "prom-client";
import { PrismaService } from "../prisma/prisma.service.js";
import { httpMetricsMiddleware, registry } from "./metrics.js";

@ApiExcludeController()
@Controller()
class MetricsController {
  @Get("metrics")
  @Header("Content-Type", registry.contentType)
  metrics() {
    return registry.metrics();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule implements NestModule {
  constructor(prisma: PrismaService) {
    new Gauge({
      name: "outbox_unpublished_events",
      help: "아직 발행되지 않은 outbox 이벤트 수",
      registers: [registry],
      async collect() {
        try {
          const count = prisma.outboxEvent.count({ where: { publishedAt: null } });
          const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 1000).unref());
          this.set(await Promise.race([count, timeout]));
        } catch {
          this.set(Number.NaN);
        }
      },
    });
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(httpMetricsMiddleware).forRoutes("*");
  }
}
