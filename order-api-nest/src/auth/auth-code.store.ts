import { createHash, randomBytes } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

const CODE_TTL_SECONDS = 60;
const keyOf = (code: string) => `auth-code:${createHash("sha256").update(code).digest("hex")}`;

@Injectable()
export class AuthCodeStore implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL!);

  async issue(userId: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await this.redis.set(keyOf(code), userId, "EX", CODE_TTL_SECONDS);
    return code;
  }

  consume(code: string): Promise<string | null> {
    return this.redis.getdel(keyOf(code));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}