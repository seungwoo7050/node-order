import { Controller, Get, Header, MiddlewareConsumer, Module, NestModule, NotFoundException, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { Gauge } from "prom-client";
import { PrismaService } from "../prisma/prisma.service.js";
import { httpMetricsMiddleware, registry } from "./metrics.js";

// 지표는 서버 안의 Prometheus가 컨테이너 주소(api-blue:4000)로 직접 긁을 때만 준다.
// 공개 주소로 온 요청은 Caddy가 /metrics*를 막고(경로 접두, 대소문자 무시), 그래도 새어 들어오면(경로 변형, 설정 실수)
// 여기서 한 번 더 막는다: Caddy reverse_proxy는 X-Forwarded-For를 항상 붙이고 손님이 지울 수 없다. 직접 긁는 Prometheus는 붙이지 않는다.
// Express 라우팅은 대소문자·끝 슬래시를 가리지 않으므로(/METRICS/) 경로가 아니라 이 헤더로 판단한다
@ApiExcludeController()
@Controller()
class MetricsController {
  @Get("metrics")
  @Header("Content-Type", registry.contentType)
  metrics(@Req() req: Request) {
    if (req.headers["x-forwarded-for"] !== undefined || req.headers.forwarded !== undefined) throw new NotFoundException();
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
