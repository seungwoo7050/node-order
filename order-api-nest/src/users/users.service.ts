import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { hashPassword } from "../auth/password.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    return this.prisma.user.create({
      data: { id: dto.id, name: dto.name, passwordHash: await hashPassword(dto.password) },
      select: { id: true, name: true },
    });
  }

  async listWithOrders() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, price: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
  }
}