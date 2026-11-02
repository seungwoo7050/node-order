import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { CategoriesService } from "./categories.service.js";
import { CreateCategoryDto, UpdateCategoryDto } from "./move-category.dto.js";

@ApiTags("categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.listAll();
  }

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

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(":id")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  move(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.categories.delete(id);
  }
}

@ApiTags("admin-categories")
@Controller("admin/categories")
@ApiBearerAuth()
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  list() {
    return this.categories.listAll();
  }

  @Get("tree")
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  tree() {
    return this.categories.tree();
  }

  @Post()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.categories.delete(id);
  }
}
