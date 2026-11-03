import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { ReviewsController } from "./reviews.controller.js";
import { AdminReviewsController } from "./admin-reviews.controller.js";
import { ReviewsService } from "./reviews.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [ReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
