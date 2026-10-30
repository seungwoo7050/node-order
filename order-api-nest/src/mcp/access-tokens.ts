import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

// MCP 개인 접근 토큰. 원문은 발급 응답에 한 번만 싣고 DB에는 sha256 해시만 둔다(DB가 새도 토큰으로 쓸 수 없다).
// 토큰 자체가 무작위 32바이트라 느린 해시(bcrypt)가 필요 없다: 사전 공격할 거리가 없다
export const SCOPES = ["read", "write", "pii"] as const;
export type Scope = (typeof SCOPES)[number];

export const TOKEN_PREFIX = "nop_";
export const MAX_EXPIRES_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

// 이 토큰으로 MCP를 부르는 사람. scopes는 역할까지 반영한 실제 범위(데모 관리자는 read만)
export type AuditResult = "ok" | "error" | "rate_limited" | "pending";
export type McpPrincipal = { tokenId: number; userId: string; role: "admin" | "demo_admin"; scopes: Scope[] };

export type TokenView = {
  id: number; name: string; prefix: string; scopes: string[];
  expiresAt: Date; revokedAt: Date | null; lastUsedAt: Date | null; createdAt: Date;
};

const tokenSelect = { id: true, name: true, prefix: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true } as const;

// 데모 관리자(누구나 될 수 있다)가 만든 토큰은 무엇을 요청했든 read만 갖는다
export function effectiveScopes(role: string, requested: readonly string[]): Scope[] {
  const valid = SCOPES.filter((s) => requested.includes(s));
  return role === "admin" ? valid : valid.filter((s) => s === "read");
}

@Injectable()
export class AccessTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(user: { userId: string; role: string }, input: { name: string; scopes: Scope[]; expiresInDays: number }): Promise<TokenView & { token: string }> {
    const scopes = effectiveScopes(user.role, input.scopes);
    if (scopes.length === 0) scopes.push("read");
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row = await this.prisma.accessToken.create({
      data: {
        userId: user.userId,
        name: input.name,
        tokenHash: hashToken(token),
        prefix: token.slice(0, TOKEN_PREFIX.length + 6),
        scopes,
        expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      },
      select: tokenSelect,
    });
    return { ...row, token };
  }

  list(userId: string): Promise<TokenView[]> {
    return this.prisma.accessToken.findMany({ where: { userId }, select: tokenSelect, orderBy: { id: "desc" } });
  }

  // 폐기는 행을 지우지 않는다(감사 로그가 이 토큰을 가리킨다)
  async revoke(userId: string, id: number): Promise<TokenView> {
    await this.prisma.accessToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    const row = await this.prisma.accessToken.findFirst({ where: { id, userId }, select: tokenSelect });
    if (!row) throw new NotFoundException(`토큰 #${id}가 없습니다`);
    return row;
  }

  // Bearer 원문 → 사용자. 없거나, 폐기됐거나, 만료됐거나, 주인이 더 이상 관리자가 아니면 null(401)
  async authenticate(raw: string | undefined, now = new Date()): Promise<McpPrincipal | null> {
    if (!raw?.startsWith(TOKEN_PREFIX)) return null;
    const row = await this.prisma.accessToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      select: { id: true, userId: true, scopes: true, expiresAt: true, revokedAt: true, user: { select: { role: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    const role = row.user.role;
    if (role !== "admin" && role !== "demo_admin") return null;
    // 마지막 사용 시각은 1분에 한 번만 쓴다(도구 호출마다 쓰지 않게)
    await this.prisma.accessToken.updateMany({
      where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }] },
      data: { lastUsedAt: now },
    });
    return { tokenId: row.id, userId: row.userId, role, scopes: effectiveScopes(role, row.scopes) };
  }

  // 감사 한 행을 남기고 id를 돌려준다. pending은 쓰기 도구를 실행하기 전에 남기는 행(끝나면 finishAudit)
  async audit(entry: { tokenId: number; tool: string; args: unknown; result: AuditResult; error?: string | null }): Promise<number> {
    const row = await this.prisma.mcpAuditEntry.create({
      data: { tokenId: entry.tokenId, tool: entry.tool, args: (entry.args ?? {}) as object, result: entry.result, ok: entry.result === "ok", error: entry.error ?? null },
      select: { id: true },
    });
    return row.id;
  }

  async finishAudit(id: number, outcome: { result: "ok" | "error"; error?: string | null }): Promise<void> {
    await this.prisma.mcpAuditEntry.update({ where: { id }, data: { result: outcome.result, ok: outcome.result === "ok", error: outcome.error ?? null } });
  }

  // 감사 로그 보기: 진짜 관리자는 모든 토큰, 데모 관리자는 자기 토큰 것만
  async auditLog(user: { userId: string; role: string }, query: { tokenId?: number; limit?: number }) {
    const rows = await this.prisma.mcpAuditEntry.findMany({
      where: { tokenId: query.tokenId, ...(user.role === "admin" ? {} : { token: { userId: user.userId } }) },
      select: { id: true, tool: true, args: true, ok: true, result: true, error: true, createdAt: true, token: { select: { id: true, name: true, prefix: true } } },
      orderBy: { id: "desc" },
      take: query.limit ?? 50,
    });
    return { items: rows };
  }
}
