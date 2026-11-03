import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CreateReviewDto } from "./dto/review.dto.js";
import { ReviewsService } from "./reviews.service.js";

function userIdOf(req: Request): string {
  return (req.user as { userId?: string; sub?: string }).userId ?? (req.user as { sub?: string }).sub ?? "";
}

@ApiTags("reviews")
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post("me/orders/:id/reviews")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"))
  @HttpCode(201)
  createOrderReview(
    @Param("id", ParseIntPipe) orderId: number,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ) {
    const userId = userIdOf(req);
    return this.reviewsService.createReview(userId, orderId, dto);
  }

  @Post("reviews")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"))
  @HttpCode(201)
  createReview(@Body() dto: CreateReviewDto, @Req() req: Request) {
    const userId = userIdOf(req);
    const orderId = dto.orderId;
    if (!orderId) {
      throw new BadRequestException("주문 ID(orderId)가 필요합니다");
    }
    return this.reviewsService.createReview(userId, orderId, dto);
  }

  @Get("products/:id/reviews")
  getProductReviews(@Param("id", ParseIntPipe) productId: number) {
    return this.reviewsService.getProductReviews(productId);
  }
}
