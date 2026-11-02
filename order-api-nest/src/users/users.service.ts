import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { hashPassword } from "../auth/password.js";
import { withPrice } from "../me/order-select.js";
import type { AdminUserQueryDto, CreateAdminUserDto, UpdateAdminUserDto } from "./dto/admin-user.dto.js";

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
    const users = await this.prisma.asAdmin((tx) =>
      tx.user.findMany({
        select: { id: true, name: true, orders: { select: { id: true, totalAmount: true, paid: true }, orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      }),
    );
    return users.map((u) => ({ ...u, orders: u.orders.map(withPrice) }));
  }

  async listAdminUsers(query: AdminUserQueryDto) {
    return this.prisma.asAdmin(async (tx) => {
      const where: any = {};
      if (query.q) {
        const q = query.q.trim();
        where.OR = [
          { id: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ];
      }
      if (query.role) {
        where.role = query.role;
      }
      if (query.active !== undefined) {
        where.isActive = query.active;
      }
      if (query.guest !== undefined) {
        where.isGuest = query.guest;
      }

      const users = await tx.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          isActive: true,
          isGuest: true,
          createdAt: true,
          orders: {
            select: {
              id: true,
              totalAmount: true,
              paid: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        phone: u.phone,
        isActive: u.isActive,
        isGuest: u.isGuest,
        createdAt: u.createdAt,
        orderCount: u.orders.length,
        totalSpent: u.orders.filter((o) => o.paid).reduce((sum, o) => sum + o.totalAmount, 0),
      }));
    });
  }

  async getUserDetail(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          isActive: true,
          isGuest: true,
          recipientName: true,
          recipientPhone: true,
          postalCode: true,
          address1: true,
          address2: true,
          deliveryMemo: true,
          createdAt: true,
          orders: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              paid: true,
              createdAt: true,
            },
            orderBy: { id: "desc" },
            take: 20,
          },
        },
      });
      if (!user) throw new NotFoundException(`User ${id} not found`);
      return user;
    });
  }

  async createAdminUser(dto: CreateAdminUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id: dto.id } });
    if (existing) throw new ConflictException("이미 존재하는 사용자 아이디입니다");

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        id: dto.id.trim(),
        name: dto.name.trim(),
        passwordHash,
        role: dto.role ?? "user",
        phone: dto.phone?.trim() || null,
        isActive: dto.isActive ?? true,
        isGuest: false,
      },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });
    return user;
  }

  async updateAdminUser(id: string, dto: UpdateAdminUserDto, currentAdminId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`User ${id} not found`);

    if (id === currentAdminId && dto.isActive === false) {
      throw new BadRequestException("자신의 계정을 비활성화할 수 없습니다");
    }
    if (id === currentAdminId && dto.role && dto.role !== "admin") {
      throw new BadRequestException("자신의 관리자 권한을 해제할 수 없습니다");
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.phone !== undefined) data.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      data.passwordHash = await hashPassword(dto.password);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          isActive: true,
        },
      });
    });

    return updated;
  }

  async deleteAdminUser(id: string, currentAdminId: string) {
    if (id === currentAdminId) {
      throw new BadRequestException("자신의 계정은 삭제할 수 없습니다");
    }
    return this.prisma.asAdmin(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`User ${id} not found`);

      const orderCount = await tx.order.count({ where: { userId: id } });

      if (orderCount > 0) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.user.update({
          where: { id },
          data: {
            name: "탈퇴회원",
            phone: null,
            recipientName: null,
            recipientPhone: null,
            postalCode: null,
            address1: null,
            address2: null,
            deliveryMemo: null,
            isActive: false,
          },
        });
        return { anonymized: true, message: "주문 내역이 있어 계정이 비활성화 및 익명화 처리되었습니다." };
      }

      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
      return { deleted: true, message: "계정이 삭제되었습니다." };
    });
  }
}
