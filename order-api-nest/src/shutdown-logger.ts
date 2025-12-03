import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";

@Injectable()
export class ShutdownLogger implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger("Shutdown");
  private startedAt = 0;

  beforeApplicationShutdown(signal?: string) {
    this.startedAt = Date.now();
    this.logger.log(`종료 신호(${signal}) - 모듈 정리를 마쳤습니다. HTTP 서버를 닫습니다`);
  }

  onApplicationShutdown() {
    this.logger.log(`HTTP 서버까지 닫았습니다(${Date.now() - this.startedAt}ms) - 프로세스를 종료합니다`);
  }
}