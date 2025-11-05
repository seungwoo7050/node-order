import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
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
}