import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { AuthCodeStore } from "./auth-code.store.js";
import { verifyGithubToken } from "./github.js";

export const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export type IssuedTokens = { accessToken: string; refreshToken: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly codes: AuthCodeStore,
  ) {}

  private readonly dummyHash = hashPassword("never-matches-any-real-password");

  async login(id: string, password: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user?.passwordHash || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    return this.issueTokens(this.prisma, user.id, randomUUID());
  }

  async loginWithGithub(githubAccessToken: string): Promise<string> {
    const gh = await verifyGithubToken(githubAccessToken);
    if (!gh) throw new UnauthorizedException("GitHub 토큰을 확인할 수 없습니다");
    const user = await this.prisma.user.upsert({
      where: { githubId: gh.id },
      create: { id: `github-${gh.id}`, name: gh.login, githubId: gh.id },
      update: { name: gh.login },
    });
    return this.codes.issue(user.id);
  }

  async exchangeCode(code: string): Promise<IssuedTokens> {
    const userId = await this.codes.consume(code);
    if (!userId) throw new UnauthorizedException("코드가 없거나, 이미 썼거나, 만료됐습니다");
    return this.issueTokens(this.prisma, userId, randomUUID());
  }

  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException("refresh token이 없습니다");
    const result = await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
      if (!token || token.expiresAt < new Date()) return { kind: "invalid" as const };

      const { count } = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { kind: "reused" as const };
      }
      return { kind: "ok" as const, tokens: await this.issueTokens(tx, token.userId, token.familyId) };
    });
    if (result.kind === "invalid") throw new UnauthorizedException("유효하지 않은 refresh token입니다");
    if (result.kind === "reused") throw new UnauthorizedException("이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다");
    return result.tokens;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  private async issueTokens(db: Prisma.TransactionClient, userId: string, familyId: string): Promise<IssuedTokens> {
    const accessToken = this.jwtService.sign({ sub: userId });
    const refreshToken = randomBytes(32).toString("base64url");
    await db.refreshToken.create({
      data: {
        userId, familyId, tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { accessToken, refreshToken };
  }
}