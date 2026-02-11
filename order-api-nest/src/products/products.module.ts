import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductImagesController } from './product-images.controller.js';
import { ProductStockController } from "./product-stock.controller.js";

@Module({ controllers: [ProductsController, ProductImagesController, ProductStockController] })
export class ProductsModule {}
