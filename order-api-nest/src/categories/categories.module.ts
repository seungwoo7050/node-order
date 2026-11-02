import { Module } from "@nestjs/common";
import { AdminCategoriesController, CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";

@Module({
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
