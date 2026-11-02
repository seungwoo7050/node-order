import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as crypto from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

export const SUPPORTED_SECRET_KEYS = [
  { key: "LLM_API_KEY", label: "LLM (Anthropic) API 키", category: "ai" },
  { key: "OPENAI_API_KEY", label: "OpenAI API 키", category: "ai" },
  { key: "TOSS_CLIENT_KEY", label: "토스페이먼츠 클라이언트 키", category: "payment" },
  { key: "TOSS_SECRET_KEY", label: "토스페이먼츠 시크릿 키", category: "payment" },
  { key: "STRIPE_SECRET_KEY", label: "Stripe 시크릿 키", category: "payment" },
  { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe 웹훅 시크릿", category: "payment" },
  { key: "JUSO_API_KEY", label: "도로명주소 검색 API 키", category: "shipping" },
  { key: "SMTP_URL", label: "SMTP 연결 URL", category: "mail" },
  { key: "SMTP_HOST", label: "SMTP 호스트 주소", category: "mail" },
  { key: "SENTRY_DSN", label: "Sentry DSN (에러 추적)", category: "monitoring" },
] as const;

export type SupportedSecretKey = typeof SUPPORTED_SECRET_KEYS[number]["key"];

export function maskSecret(val: string): string {
  if (!val) return "";
  if (val.length < 8) return "****";
  return `${val.slice(0, 2)}****${val.slice(-2)}`;
}

@Injectable()
export class RuntimeSecretsService implements OnModuleInit {
  private readonly logger = new Logger(RuntimeSecretsService.name);
  private encryptionKey: Buffer;
  private readonly secretsCache = new Map<string, string>();
  private controlsCache = {
    pausePaidApis: false,
    maintenanceMode: false,
    updatedAt: new Date(),
  };

  constructor(private readonly prisma: PrismaService) {
    const rawSecret = process.env.JWT_SECRET || "default-jwt-secret-salt-34";
    this.encryptionKey = crypto.scryptSync(rawSecret, "node-order-integration-salt", 32);
  }

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    try {
      const dbSecrets = await this.prisma.integrationSecret.findMany();
      this.secretsCache.clear();
      for (const row of dbSecrets) {
        try {
          const decrypted = this.decrypt(row.ciphertext, row.iv, row.authTag);
          this.secretsCache.set(row.key, decrypted);
        } catch (err) {
          this.logger.error(`비밀값 복호화 실패 (${row.key}): ${(err as Error).message}`);
        }
      }

      let ctrl = await this.prisma.systemControl.findUnique({ where: { id: 1 } });
      if (!ctrl) {
        ctrl = await this.prisma.systemControl.create({
          data: { id: 1, pausePaidApis: false, maintenanceMode: false },
        });
      }
      this.controlsCache = {
        pausePaidApis: ctrl.pausePaidApis,
        maintenanceMode: ctrl.maintenanceMode,
        updatedAt: ctrl.updatedAt,
      };
    } catch (err) {
      this.logger.warn(`초기 런타임 시크릿 로드 실패 (마이그레이션 전일 수 있음): ${(err as Error).message}`);
    }
  }

  getSecret(key: string): string | undefined {
    const fromDb = this.secretsCache.get(key);
    if (fromDb && fromDb.trim()) return fromDb;

    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.trim()) return fromEnv;

    if (key === "LLM_API_KEY") {
      const alt = this.secretsCache.get("OPENAI_API_KEY") || process.env.OPENAI_API_KEY;
      if (alt && alt.trim()) return alt;
    }
    if (key === "OPENAI_API_KEY") {
      const alt = this.secretsCache.get("LLM_API_KEY") || process.env.LLM_API_KEY;
      if (alt && alt.trim()) return alt;
    }

    return undefined;
  }

  isPausedPaidApis(): boolean {
    return this.controlsCache.pausePaidApis;
  }

  isMaintenanceMode(): boolean {
    return this.controlsCache.maintenanceMode;
  }

  getControls() {
    return { ...this.controlsCache };
  }

  async setControls(dto: { pausePaidApis?: boolean; maintenanceMode?: boolean }) {
    const updated = await this.prisma.systemControl.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        pausePaidApis: dto.pausePaidApis ?? false,
        maintenanceMode: dto.maintenanceMode ?? false,
      },
      update: {
        ...(dto.pausePaidApis !== undefined ? { pausePaidApis: dto.pausePaidApis } : {}),
        ...(dto.maintenanceMode !== undefined ? { maintenanceMode: dto.maintenanceMode } : {}),
      },
    });

    this.controlsCache = {
      pausePaidApis: updated.pausePaidApis,
      maintenanceMode: updated.maintenanceMode,
      updatedAt: updated.updatedAt,
    };

    return this.getControls();
  }

  async setSecret(key: string, value: string) {
    const trimmed = value.trim();
    const { ciphertext, iv, authTag } = this.encrypt(trimmed);
    const masked = maskSecret(trimmed);

    const saved = await this.prisma.integrationSecret.upsert({
      where: { key },
      create: {
        key,
        ciphertext,
        iv,
        authTag,
        maskedPreview: masked,
      },
      update: {
        ciphertext,
        iv,
        authTag,
        maskedPreview: masked,
      },
    });

    this.secretsCache.set(key, trimmed);

    return {
      key: saved.key,
      configured: true,
      source: "db" as const,
      maskedPreview: saved.maskedPreview,
      updatedAt: saved.updatedAt,
    };
  }

  async deleteSecret(key: string): Promise<void> {
    await this.prisma.integrationSecret.deleteMany({ where: { key } });
    this.secretsCache.delete(key);
  }

  async getSecretsStatus() {
    const dbSecrets = await this.prisma.integrationSecret.findMany({
      select: { key: true, maskedPreview: true, updatedAt: true },
    });
    const dbMap = new Map(dbSecrets.map((s) => [s.key, s]));

    return SUPPORTED_SECRET_KEYS.map((def) => {
      const dbEntry = dbMap.get(def.key);
      if (dbEntry) {
        return {
          key: def.key,
          label: def.label,
          category: def.category,
          configured: true,
          source: "db" as const,
          maskedPreview: dbEntry.maskedPreview,
          updatedAt: dbEntry.updatedAt,
        };
      }

      const envVal = process.env[def.key];
      if (envVal && envVal.trim()) {
        return {
          key: def.key,
          label: def.label,
          category: def.category,
          configured: true,
          source: "env" as const,
          maskedPreview: maskSecret(envVal.trim()),
          updatedAt: null,
        };
      }

      return {
        key: def.key,
        label: def.label,
        category: def.category,
        configured: false,
        source: "none" as const,
        maskedPreview: null,
        updatedAt: null,
      };
    });
  }

  testSecret(key: string): { key: string; ok: boolean; message: string } {
    const val = this.getSecret(key);
    if (!val) {
      return { key, ok: false, message: "키가 설정되지 않았습니다." };
    }
    if (key.includes("KEY") || key.includes("SECRET")) {
      if (val.length < 5) return { key, ok: false, message: "키 길이가 너무 짧습니다." };
      return { key, ok: true, message: "유효한 형식의 시크릿 키입니다." };
    }
    if (key === "SENTRY_DSN") {
      try {
        new URL(val);
        return { key, ok: true, message: "유효한 DSN URL 형식입니다." };
      } catch {
        return { key, ok: false, message: "유효하지 않은 DSN URL입니다." };
      }
    }
    return { key, ok: true, message: "시크릿이 구성되어 있습니다." };
  }

  private encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  private decrypt(ciphertext: string, iv: string, authTag: string): string {
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
    return decrypted.toString("utf8");
  }
}
