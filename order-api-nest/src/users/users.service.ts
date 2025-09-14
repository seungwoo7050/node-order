import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listWithOrders() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, price: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
  }
}