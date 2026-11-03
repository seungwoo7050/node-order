import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AdminReviewQueryDto, CreateReviewDto } from "./dto/review.dto.js";

export function maskAuthorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "고*";
  if (trimmed.length <= 1) return `${trimmed}*`;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${"*".repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReview(userId: string, orderId: number, dto: CreateReviewDto) {
    const order = await this.prisma.asAdmin(async (tx) =>
      tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          reviews: true,
        },
      }),
    );

    if (!order) {
      throw new NotFoundException(`주문 #${orderId}을 찾을 수 없습니다`);
    }

    if (order.userId !== userId) {
      throw new ForbiddenException("본인의 주문에 대해서만 리뷰를 작성할 수 있습니다");
    }

    if (order.status !== "confirmed") {
      throw new BadRequestException("구매확정된 주문만 리뷰를 작성할 수 있습니다");
    }

    const orderItem = order.items.find((item) => item.productId === dto.productId);
    if (!orderItem) {
      throw new BadRequestException("해당 주문에 포함되지 않은 상품입니다");
    }

    if (order.reviews.some((r) => r.productId === dto.productId)) {
      throw new ConflictException("이미 리뷰를 작성한 상품입니다");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const rawAuthor = user?.name || order.recipientName || "고객";
    const authorName = maskAuthorName(rawAuthor);

    try {
      return await this.prisma.asAdmin(async (tx) =>
        tx.review.create({
          data: {
            orderId,
            productId: dto.productId,
            userId,
            authorName,
            rating: dto.rating,
            content: dto.content.trim(),
            variantName: orderItem.variantLabel || null,
          },
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("이미 리뷰를 작성한 상품입니다");
      }
      throw err;
    }
  }

  async getProductReviews(productId: number) {
    const reviews = await this.prisma.asAdmin(async (tx) =>
      tx.review.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          content: true,
          authorName: true,
          variantName: true,
          createdAt: true,
        },
      }),
    );

    const reviewCount = reviews.length;
    const averageRating =
      reviewCount > 0
        ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
        : 0;

    return {
      averageRating,
      reviewCount,
      reviews,
    };
  }

  async listAdminReviews(query: AdminReviewQueryDto) {
    const where: Prisma.ReviewWhereInput = {};
    if (query.productId) {
      where.productId = query.productId;
    }
    if (query.q) {
      const term = query.q.trim();
      where.OR = [
        { content: { contains: term, mode: "insensitive" } },
        { authorName: { contains: term, mode: "insensitive" } },
        { product: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    return this.prisma.asAdmin(async (tx) =>
      tx.review.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          order: { select: { id: true, createdAt: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  async deleteAdminReview(id: number) {
    const review = await this.prisma.asAdmin(async (tx) => tx.review.findUnique({ where: { id } }));
    if (!review) {
      throw new NotFoundException(`리뷰 #${id}을 찾을 수 없습니다`);
    }

    await this.prisma.asAdmin(async (tx) => tx.review.delete({ where: { id } }));
    return { success: true };
  }
}
