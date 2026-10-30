import { Controller, Get, Inject, Ip, Query } from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hydrateProducts } from "../products/product-list.js";
import { StorageService } from "../storage/storage.service.js";
import { SEARCH_ENGINE, SEARCH_MAX_PAGES, SEARCH_PAGE_SIZE, SUGGEST_LIMIT, type SearchEngine } from "./search-engine.js";
import { SearchStats } from "./search-stats.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

class SuggestQueryDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) q!: string;
}

class SearchQueryDto extends SuggestQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(SEARCH_MAX_PAGES) page: number = 1;
}

// ProductsModule이 이 컨트롤러를 ProductsController보다 먼저 등록한다("/products/:id"가 "search"를 먼저 받지 않게)
@ApiTags("search")
@Controller()
export class SearchController {
  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly stats: SearchStats,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get("products/search")
  async search(@Query(PAGE_QUERY) { q, page }: SearchQueryDto, @Ip() ip: string) {
    const result = await this.engine.search(q, { page, pageSize: SEARCH_PAGE_SIZE });
    const matchOf = new Map(result.hits.map((h) => [h.id, h.match]));
    const products = await hydrateProducts({ prisma: this.prisma, storage: this.storage }, result.hits.map((h) => h.id));
    if (page === 1) await this.stats.record(q, ip, products.length > 0);
    return {
      items: products.map((p) => ({ ...p, match: matchOf.get(p.id)! })),
      page,
      nextPage: result.hasMore ? page + 1 : null,
    };
  }

  @Get("products/suggest")
  async suggest(@Query(PAGE_QUERY) { q }: SuggestQueryDto) {
    return { items: await this.engine.suggest(q, SUGGEST_LIMIT) };
  }

  @Get("search/popular")
  async popular() {
    return { items: await this.stats.popular(10) };
  }
}
