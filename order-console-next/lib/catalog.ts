import { cacheLife, cacheTag } from "next/cache";

export type ProductVariant = {
  id: number;
  name: string;
  sku: string;
  priceDelta: number;
  stock: number;
  sortOrder: number;
};

export type ProductImage = {
  id: number;
  imageUrl: string;
  sortOrder: number;
};

export type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  description: string;
  imageUrl: string | null;
  categoryPath: string[];
  materialInfo?: string;
  sizeGuide?: string;
  isVisible?: boolean;
  variants?: ProductVariant[];
  images?: ProductImage[];
};
export type CatalogListItem = Omit<CatalogProduct, "description">;

export const PRODUCTS_TAG = "products";

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
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    description: p.description,
    imageUrl: p.imageUrl,
    categoryPath: p.categoryPath,
    materialInfo: p.materialInfo,
    sizeGuide: p.sizeGuide,
    isVisible: p.isVisible,
    variants: p.variants,
    images: p.images,
  };
}

export async function getProducts(): Promise<CatalogListItem[]> {
  "use cache";
  cacheTag(PRODUCTS_TAG);
  cacheLife(CATALOG_LIFE);
  const products: CatalogListItem[] = [];
  let cursor: number | null = null;
  do {
    const res = await fetch(`${process.env.API_URL}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`상품 목록을 받지 못했다(${res.status})`);
    const page = (await res.json()) as { items: (CatalogListItem & { stock: number })[]; nextCursor: number | null };
    products.push(...page.items.map((p) => ({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, categoryPath: p.categoryPath }))); // stock은 버린다
    cursor = page.nextCursor;
  } while (cursor);
  return products;
}
