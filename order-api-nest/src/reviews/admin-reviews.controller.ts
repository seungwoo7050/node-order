import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { AdminReviewQueryDto } from "./dto/review.dto.js";
import { ReviewsService } from "./reviews.service.js";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/reviews")
@UseGuards(AuthGuard("jwt"))
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @UseGuards(AdminViewGuard)
  list(@Query() query: AdminReviewQueryDto) {
    return this.reviewsService.listAdminReviews(query);
  }

  @Delete(":id")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  delete(@Param("id", ParseIntPipe) id: number) {
    return this.reviewsService.deleteAdminReview(id);
  }
}
