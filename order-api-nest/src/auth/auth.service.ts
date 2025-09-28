import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service.js";
import { verifyPassword } from "./password.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    return { accessToken: this.jwtService.sign({ sub: user.id }) };
  }
}