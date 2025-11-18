import { INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    const logger = new Logger(RedisIoAdapter.name);
    for (const c of [pubClient, subClient]) c.on("error", (err) => logger.warn(`Redis 연결 오류: ${err.message}`));
    await Promise.all([
      new Promise((resolve) => pubClient.once("ready", resolve)),
      new Promise((resolve) => subClient.once("ready", resolve)),
    ]);
    this.clients = [pubClient, subClient];
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(...args: Parameters<IoAdapter["createIOServer"]>): ReturnType<IoAdapter["createIOServer"]> {
    const server = super.createIOServer(...args);
    server.adapter(this.adapterConstructor!);
    return server;
  }

  async close(server: unknown) {
    await super.close(server as never);
    await Promise.all(this.clients.map((c) => c.quit()));
  }
}