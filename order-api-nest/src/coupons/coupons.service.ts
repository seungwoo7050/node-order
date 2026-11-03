import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateCouponDto, UpdateCouponDto } from "./dto/coupon.dto.js";

export type CouponValidationResult = {
  valid: true;
  couponId: number;
  code: string;
  name: string;
  discountType: "fixed" | "percent";
  discountValue: number;
  discountAmount: number;
  finalSubtotal: number;
};

export function calculateDiscount(
  subtotal: number,
  discountType: string,
  discountValue: number,
  maxDiscountAmount: number | null,
): number {
  if (discountType === "fixed") {
    return Math.min(subtotal, discountValue);
  }
  if (discountType === "percent") {
    const raw = Math.floor((subtotal * discountValue) / 100);
    const capped = maxDiscountAmount != null ? Math.min(raw, maxDiscountAmount) : raw;
    return Math.min(subtotal, capped);
  }
  return 0;
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async validateCoupon(rawCode: string, subtotal: number): Promise<CouponValidationResult> {
    const code = rawCode.trim().toUpperCase();
    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon) {
      throw new BadRequestException("존재하지 않는 쿠폰입니다");
    }
    if (!coupon.active) {
      throw new BadRequestException("비활성화된 쿠폰입니다");
    }
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException("아직 사용할 수 없는 쿠폰입니다");
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new BadRequestException("유효기간이 만료된 쿠폰입니다");
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw new ConflictException("쿠폰 사용 한도가 초과되었습니다");
    }
    if (subtotal < coupon.minOrderAmount) {
      throw new BadRequestException(
        `최소 주문 금액(${coupon.minOrderAmount.toLocaleString()}원) 이상일 때 사용 가능합니다`,
      );
    }

    const discountAmount = calculateDiscount(
      subtotal,
      coupon.discountType,
      coupon.discountValue,
      coupon.maxDiscountAmount,
    );
    const finalSubtotal = Math.max(0, subtotal - discountAmount);

    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      name: coupon.name,
      discountType: coupon.discountType as "fixed" | "percent",
      discountValue: coupon.discountValue,
      discountAmount,
      finalSubtotal,
    };
  }

  async list() {
    return this.prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: number) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException(`쿠폰 #${id}을 찾을 수 없습니다`);
    return coupon;
  }

  async create(dto: CreateCouponDto) {
    const code = dto.code.trim().toUpperCase();
    try {
      return await this.prisma.coupon.create({
        data: {
          code,
          name: dto.name.trim(),
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderAmount: dto.minOrderAmount ?? 0,
          maxDiscountAmount: dto.maxDiscountAmount ?? null,
          maxUses: dto.maxUses ?? null,
          active: dto.active ?? true,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("이미 존재하는 쿠폰 코드입니다");
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateCouponDto) {
    await this.findOne(id);
    const data: Prisma.CouponUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.minOrderAmount !== undefined) data.minOrderAmount = dto.minOrderAmount;
    if (dto.maxDiscountAmount !== undefined) data.maxDiscountAmount = dto.maxDiscountAmount;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    try {
      return await this.prisma.coupon.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("이미 존재하는 쿠폰 코드입니다");
      }
      throw err;
    }
  }

  async delete(id: number) {
    await this.findOne(id);
    await this.prisma.coupon.delete({ where: { id } });
    return { success: true };
  }
}
