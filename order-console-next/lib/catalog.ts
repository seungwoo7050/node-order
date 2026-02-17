import { cacheLife, cacheTag } from "next/cache";

export type CatalogProduct = { id: number; name: string; price: number; description: string; imageUrl: string | null; categoryPath: string[] };

export const productTag = (id: number) => `product-${id}`;

const CATALOG_LIFE = { stale: 60, revalidate: 60, expire: 540 };

export async function getProduct(id: number): Promise<CatalogProduct | null> {
  "use cache";
  cacheTag(productTag(id));
  cacheLife(CATALOG_LIFE);
  const res = await fetch(`${process.env.API_URL}/products/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`상품을 받지 못했다(${res.status})`);
  const p = (await res.json()) as CatalogProduct & { stock: number };
  return { id: p.id, name: p.name, price: p.price, description: p.description, imageUrl: p.imageUrl, categoryPath: p.categoryPath };
}
