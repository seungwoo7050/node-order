import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { hashPassword } from "../auth/password.js";
import { withPrice } from "../me/order-select.js";

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
    const users = await this.prisma.asAdmin((tx) => tx.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, totalAmount: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    }));
    return users.map((u) => ({ ...u, orders: u.orders.map(withPrice) }));
  }
}