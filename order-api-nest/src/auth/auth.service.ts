import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { AuthCodeStore } from "./auth-code.store.js";
import { verifyGithubToken } from "./github.js";
import { createDemoUser, newDemoUserId, type DemoKind } from "./demo-user.js";
import type { SignupDto } from "./signup.dto.js";

export const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export type IssuedTokens = { accessToken: string; refreshToken: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const RESERVED_PREFIXES = ["guest-", "demo-", "github-"];

function isReservedId(id: string): boolean {
  const lower = id.toLowerCase();
  return RESERVED_PREFIXES.some((prefix) => lower.startsWith(prefix)) || lower === "admin" || lower.startsWith("admin-");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly codes: AuthCodeStore,
  ) {}

  private readonly dummyHash = hashPassword("never-matches-any-real-password");

  async signup(dto: SignupDto): Promise<IssuedTokens> {
    const id = dto.id.trim();
    if (isReservedId(id)) {
      throw new BadRequestException("예약된 아이디나 접두사(guest-, demo-, github-, admin)는 사용할 수 없습니다");
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (existing) {
      throw new ConflictException("이미 사용 중인 아이디입니다");
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        id,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        passwordHash,
        role: "user",
        isGuest: false,
      },
    });

    return this.issueTokens(this.prisma, user.id, randomUUID());
  }

  async checkId(id: string): Promise<{ available: boolean; reason?: string }> {
    const trimmed = id.trim();
    if (!trimmed || trimmed.length < 3) return { available: false, reason: "아이디는 3자 이상이어야 합니다" };
    if (isReservedId(trimmed)) return { available: false, reason: "예약된 접두사가 포함된 아이디입니다" };
    const existing = await this.prisma.user.findUnique({ where: { id: trimmed }, select: { id: true } });
    if (existing) return { available: false, reason: "이미 사용 중인 아이디입니다" };
    return { available: true };
  }

  issueGuestToken(userId: string): string {
    return this.jwtService.sign({ sub: userId, role: "user", isGuest: true }, { expiresIn: "1h" });
  }

  async login(id: string, password: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user?.passwordHash || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    if (user.isActive === false) throw new ForbiddenException("정지된 계정입니다");
    return this.issueTokens(this.prisma, user.id, randomUUID());
  }

  demoEnabled(): boolean {
    return process.env.DEMO_LOGIN === "1";
  }

  async loginAsDemo(as: DemoKind): Promise<IssuedTokens> {
    if (!this.demoEnabled()) throw new NotFoundException();
    const id = newDemoUserId();
    await this.prisma.asUser(id, (tx) => createDemoUser(tx, id, as));
    return this.issueTokens(this.prisma, id, randomUUID());
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

      const user = await tx.user.findUnique({ where: { id: token.userId }, select: { isActive: true } });
      if (!user || user.isActive === false) return { kind: "invalid" as const };

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
    const { role } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const accessToken = this.jwtService.sign({ sub: userId, role });
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
