import type { CatalogCache } from "../cache/catalog-cache.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { toPage } from "../pagination/cursor.js";

type CategoryStep = { id: number; name: string };
export type CatalogItem = { id: number; name: string; price: number; imageKey: string | null; categories: CategoryStep[] };
type CatalogPage = { items: CatalogItem[]; nextCursor: number | null };
type CatalogProduct = CatalogItem & { description: string };
export type ProductDeps = { prisma: PrismaService; storage: StorageService; cache: CatalogCache };

async function categoryPaths(prisma: PrismaService, leaves: number[]): Promise<Map<number, CategoryStep[]>> {
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

export async function loadCatalogPage(prisma: PrismaService, page: { limit: number; cursor?: number | null }): Promise<CatalogPage> {
  const rows = await prisma.product.findMany({
    where: page.cursor ? { id: { gt: page.cursor } } : {},
    select: { id: true, name: true, price: true, imageKey: true, categoryId: true },
    orderBy: { id: "asc" },
    take: page.limit + 1,
  });
  const { items, nextCursor } = toPage(rows, page.limit, (last) => last.id);
  const pathOf = await categoryPaths(prisma, [...new Set(items.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);
  return {
    items: items.map(({ categoryId, ...p }) => ({ ...p, categories: (categoryId && pathOf.get(categoryId)) || [] })),
    nextCursor,
  };
}

export async function listProducts(deps: ProductDeps, page: { limit: number; cursor?: number | null }) {
  const catalog = await deps.cache.getOrLoad(`list:${page.cursor ?? 0}:${page.limit}`, () => loadCatalogPage(deps.prisma, page));
  const stocks = await deps.prisma.product.findMany({ where: { id: { in: catalog.items.map((p) => p.id) } }, select: { id: true, stock: true } });
  const stockOf = new Map(stocks.map((s) => [s.id, s.stock]));
  const items = await Promise.all(
    catalog.items.map(async ({ imageKey, ...p }) => ({
      ...p,
      categoryPath: p.categories.map((c) => c.name),
      stock: stockOf.get(p.id) ?? 0,
      imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : null,
    })),
  );
  return { items, nextCursor: catalog.nextCursor };
}

async function loadProduct(prisma: PrismaService, id: number): Promise<CatalogProduct | null> {
  const row = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, price: true, description: true, imageKey: true, categoryId: true },
  });
  if (!row) return null;
  const { categoryId, ...p } = row;
  const pathOf = await categoryPaths(prisma, categoryId ? [categoryId] : []);
  return { ...p, categories: (categoryId && pathOf.get(categoryId)) || [] };
}

export async function getProduct(deps: ProductDeps, id: number) {
  const catalog = await deps.cache.getOrLoad(`product:${id}`, () => loadProduct(deps.prisma, id));
  if (!catalog) return null;
  const row = await deps.prisma.product.findUnique({ where: { id }, select: { stock: true } });
  if (!row) return null;
  const { imageKey, ...p } = catalog;
  return { ...p, categoryPath: p.categories.map((c) => c.name), stock: row.stock, imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : null };
}
