import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { MoveCategoryDto } from "./move-category.dto.js";
import { CategoriesService } from "./categories.service.js";

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get("tree-naive")
  treeNaive() {
    return this.categories.treeNaive();
  }

  @Get("tree")
  tree() {
    return this.categories.tree();
  }

  @Get(":id/products")
  products(@Param("id", ParseIntPipe) id: number) {
    return this.categories.productsInSubtree(id);
  }

  @Get(":id/path")
  path(@Param("id", ParseIntPipe) id: number) {
    return this.categories.path(id);
  }

  @Patch(":id")
  @UseGuards(AuthGuard("jwt"))
  move(@Param("id", ParseIntPipe) id: number, @Body() dto: MoveCategoryDto) {
    return this.categories.move(id, dto.parentId);
  }
}