import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listWithOrders() {
    const users = await this.prisma.user.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
    const result = [];
    for (const u of users) {
      const orders = await this.prisma.order.findMany({
        where: { userId: u.id },
        select: { id: true, price: true, paid: true },
        orderBy: { id: "asc" },
      });
      result.push({ ...u, orders });
    }
    return result;
  }
}