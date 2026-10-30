import { Module } from "@nestjs/common";
import { SearchController } from "../search/search.controller.js";
import { SearchModule } from "../search/search.module.js";
import { ProductsController } from "./products.controller.js";
import { ProductImagesController } from './product-images.controller.js';
import { ProductStockController } from "./product-stock.controller.js";

// SearchController가 먼저: "/products/search"·"/products/suggest"를 "/products/:id"보다 먼저 맞춘다
@Module({ imports: [SearchModule], controllers: [SearchController, ProductsController, ProductImagesController, ProductStockController] })
export class ProductsModule {}
