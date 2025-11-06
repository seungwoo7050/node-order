import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PrismaService } from "../prisma/prisma.service.js";
import { MoveCategoryDto } from "./move-category.dto.js";
import { CategoriesService } from "./categories.service.js";

@Controller("categories")
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly prisma: PrismaService,
  ) {}

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

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AuthGuard("jwt"))
  async remove(@Param("id", ParseIntPipe) id: number) {
    await this.prisma.category.delete({ where: { id } });
  }
}