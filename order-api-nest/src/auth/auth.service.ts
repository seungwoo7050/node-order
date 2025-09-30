import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";

export const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export type IssuedTokens = { accessToken: string; refreshToken: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private readonly dummyHash = hashPassword("never-matches-any-real-password");

  async login(id: string, password: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user?.passwordHash || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    return this.issueTokens(this.prisma, user.id, randomUUID());
  }

  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException("refresh token이 없습니다");
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!token || token.revokedAt || token.expiresAt < new Date()) throw new UnauthorizedException("유효하지 않은 refresh token입니다");
    return { accessToken: this.jwtService.sign({ sub: token.userId }), refreshToken: rawToken };
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