import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductImagesController } from './product-images.controller.js';

@Module({ controllers: [ProductsController, ProductImagesController] })
export class ProductsModule {}