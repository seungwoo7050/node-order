import type { CatalogCache } from "../cache/catalog-cache.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { toPage } from "../pagination/cursor.js";

export type CategoryStep = { id: number; name: string };
export type VariantItem = { id: number; name: string; sku: string; priceDelta: number; stock: number; sortOrder: number };
export type ImageItem = { id: number; imageKey: string; sortOrder: number; imageUrl?: string | null };

export type CatalogItem = {
  id: number;
  name: string;
  price: number;
  imageKey: string | null;
  categories: CategoryStep[];
  materialInfo?: string;
  sizeGuide?: string;
  isVisible?: boolean;
  variants?: VariantItem[];
  images?: ImageItem[];
  reviewCount?: number;
  averageRating?: number;
};
type CatalogPage = { items: CatalogItem[]; nextCursor: number | null };
type CatalogProduct = CatalogItem & { description: string };
export type ProductDeps = { prisma: PrismaService; storage: StorageService; cache: CatalogCache };

export async function categoryPaths(prisma: Pick<PrismaClient, "$queryRaw">, leaves: number[]): Promise<Map<number, CategoryStep[]>> {
  if (leaves.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ leaf: number; path: CategoryStep[] }[]>`
    WITH RECURSIVE up AS (
      SELECT id AS leaf, id, name, parent_id, 0 AS depth FROM categories WHERE id = ANY(${leaves})
      UNION ALL
      SELECT up.leaf, c.id, c.name, c.parent_id, up.depth + 1 FROM up JOIN categories c ON c.id = up.parent_id
    ) CYCLE id SET is_cycle USING visited
    SELECT leaf, json_agg(json_build_object('id', id, 'name', name) ORDER BY depth DESC) AS path FROM up WHERE NOT is_cycle GROUP BY leaf`;
  return new Map(rows.map((r) => [r.leaf, r.path]));
}

export async function loadCatalogPage(
  prisma: PrismaService,
  page: { limit: number; cursor?: number | null; categoryId?: number | null },
): Promise<CatalogPage> {
  let categoryIds: number[] | undefined;
  if (page.categoryId) {
    const sub = await prisma.$queryRaw<{ id: number }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE id = ${page.categoryId}
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
      ) CYCLE id SET is_cycle USING visited
      SELECT id FROM subtree WHERE NOT is_cycle`;
    categoryIds = sub.map((r) => r.id);
  }

  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      isVisible: true,
      ...(page.cursor ? { id: { gt: page.cursor } } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      price: true,
      imageKey: true,
      categoryId: true,
      materialInfo: true,
      sizeGuide: true,
      isVisible: true,
      variants: {
        select: { id: true, name: true, sku: true, priceDelta: true, stock: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      images: {
        select: { id: true, imageKey: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      reviews: {
        select: { rating: true },
      },
    },
    orderBy: { id: "asc" },
    take: page.limit + 1,
  });

  const { items, nextCursor } = toPage(rows, page.limit, (last) => last.id);
  const pathOf = await categoryPaths(prisma, [...new Set(items.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);
  return {
    items: items.map(({ categoryId, reviews, ...p }) => {
      const revs = reviews ?? [];
      const reviewCount = revs.length;
      const averageRating =
        reviewCount > 0
          ? Math.round((revs.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
          : 0;
      return {
        ...p,
        categories: (categoryId && pathOf.get(categoryId)) || [],
        reviewCount,
        averageRating,
      };
    }),
    nextCursor,
  };
}

export async function listProducts(deps: ProductDeps, page: { limit: number; cursor?: number | null; categoryId?: number | null }) {
  const cacheKey = page.categoryId
    ? `list:${page.cursor ?? 0}:${page.limit}:cat:${page.categoryId}`
    : `list:${page.cursor ?? 0}:${page.limit}`;

  const catalog = await deps.cache.getOrLoad(cacheKey, () => loadCatalogPage(deps.prisma, page));
  const productIds = catalog.items.map((p) => p.id);

  const [stocks, variantStocks] = await Promise.all([
    deps.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } }),
    deps.prisma.productVariant.findMany({ where: { productId: { in: productIds } }, select: { id: true, stock: true } }),
  ]);

  const stockOf = new Map(stocks.map((s) => [s.id, s.stock]));
  const variantStockOf = new Map(variantStocks.map((v) => [v.id, v.stock]));

  const items = await Promise.all(
    catalog.items.map(async ({ imageKey, ...p }) => {
      const imagesWithUrl = await Promise.all(
        (p.images ?? []).map(async (img) => ({
          ...img,
          imageUrl: await deps.storage.createDownloadUrl(img.imageKey, 600),
        })),
      );

      return {
        ...p,
        categoryPath: p.categories.map((c) => c.name),
        stock: stockOf.get(p.id) ?? 0,
        imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : (imagesWithUrl[0]?.imageUrl ?? null),
        images: imagesWithUrl,
        variants: (p.variants ?? []).map((v) => ({
          ...v,
          stock: variantStockOf.get(v.id) ?? v.stock,
        })),
      };
    }),
  );

  return { items, nextCursor: catalog.nextCursor };
}

async function loadProduct(prisma: PrismaService, id: number): Promise<CatalogProduct | null> {
  const row = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      price: true,
      description: true,
      imageKey: true,
      categoryId: true,
      deletedAt: true,
      isVisible: true,
      materialInfo: true,
      sizeGuide: true,
      variants: {
        select: { id: true, name: true, sku: true, priceDelta: true, stock: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      images: {
        select: { id: true, imageKey: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      reviews: {
        select: { rating: true },
      },
    },
  });
  if (!row || row.deletedAt !== null) return null;
  const { categoryId, deletedAt: _, reviews, ...p } = row;
  const pathOf = await categoryPaths(prisma, categoryId ? [categoryId] : []);
  const revs = reviews ?? [];
  const reviewCount = revs.length;
  const averageRating =
    reviewCount > 0
      ? Math.round((revs.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
      : 0;
  return { ...p, categories: (categoryId && pathOf.get(categoryId)) || [], reviewCount, averageRating };
}

export async function getProduct(deps: ProductDeps, id: number) {
  const catalog = await deps.cache.getOrLoad(`product:${id}`, () => loadProduct(deps.prisma, id));
  if (!catalog) return null;
  const row = await deps.prisma.product.findUnique({ where: { id }, select: { stock: true } });
  if (!row) return null;

  const variantStocks = await deps.prisma.productVariant.findMany({ where: { productId: id }, select: { id: true, stock: true } });
  const variantStockOf = new Map(variantStocks.map((v) => [v.id, v.stock]));

  const { imageKey, ...p } = catalog;
  const imagesWithUrl = await Promise.all(
    (p.images ?? []).map(async (img) => ({
      ...img,
      imageUrl: await deps.storage.createDownloadUrl(img.imageKey, 600),
    })),
  );

  return {
    ...p,
    categoryPath: p.categories.map((c) => c.name),
    stock: row.stock,
    imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : (imagesWithUrl[0]?.imageUrl ?? null),
    images: imagesWithUrl,
    variants: (p.variants ?? []).map((v) => ({
      ...v,
      stock: variantStockOf.get(v.id) ?? v.stock,
    })),
  };
}

export async function hydrateProducts(deps: Omit<ProductDeps, "cache">, ids: number[]) {
  if (ids.length === 0) return [];
  const rows = await deps.prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      imageKey: true,
      categoryId: true,
      materialInfo: true,
      sizeGuide: true,
      isVisible: true,
      variants: {
        select: { id: true, name: true, sku: true, priceDelta: true, stock: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
      images: {
        select: { id: true, imageKey: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = await categoryPaths(deps.prisma, [...new Set(rows.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);
  return Promise.all(
    ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return []; // 색인에는 남았지만 지워진 상품
      const { categoryId, imageKey, ...p } = row;
      const categories = (categoryId && pathOf.get(categoryId)) || [];
      return [
        (async () => {
          const imagesWithUrl = await Promise.all(
            (p.images ?? []).map(async (img) => ({
              ...img,
              imageUrl: await deps.storage.createDownloadUrl(img.imageKey, 600),
            })),
          );
          return {
            ...p,
            categories,
            categoryPath: categories.map((c) => c.name),
            imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : (imagesWithUrl[0]?.imageUrl ?? null),
            images: imagesWithUrl,
          };
        })(),
      ];
    }),
  );
}
