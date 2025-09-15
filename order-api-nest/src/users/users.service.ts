import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto, select: { id: true, name: true } });
  }

  async listWithOrders() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, price: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
  }
}