"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { API_URL } from "./api-client";
import { useCartStore } from "./cart-store";
import { productListOptions } from "./lists";
import { useTRPC } from "./trpc";

export type SortOption = "latest" | "price_asc" | "price_desc" | "reviews";

export const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "latest", label: "최신순" },
  { id: "price_asc", label: "낮은 가격순" },
  { id: "price_desc", label: "높은 가격순" },
  { id: "reviews", label: "리뷰 많은순" },
];

export type ProductVariantItem = {
  id: number;
  name: string;
  sku: string;
  priceDelta: number;
  stock: number;
  sortOrder: number;
};

export type ProductImageItem = {
  id: number;
  imageKey?: string;
  sortOrder: number;
  imageUrl?: string | null;
};

export type StorefrontProduct = {
  id: number;
  name: string;
  price: number;
  stock?: number;
  description?: string;
  imageUrl?: string | null;
  images?: ProductImageItem[];
  variants?: ProductVariantItem[];
  categoryPath: string[];
  materialInfo?: string;
  sizeGuide?: string;
  isVisible?: boolean;
  reviewCount?: number;
  averageRating?: number;
};

export type ReviewItem = {
  id: number;
  rating: number;
  content: string;
  authorName: string;
  variantName: string | null;
  createdAt: string;
};

export type ProductReviewsData = {
  averageRating: number;
  reviewCount: number;
  reviews: ReviewItem[];
};

export type CategoryItem = {
  id: number;
  name: string;
  sortOrder: number;
  parentId?: number | null;
};

export type CategoryNode = CategoryItem & {
  children: CategoryNode[];
  depth: number;
};

export function rootCategories(cats: CategoryItem[]): CategoryItem[] {
  return cats.filter((c) => !c.parentId);
}

export function descendantsOf(
  cats: CategoryItem[],
  rootId: number,
): (CategoryItem & { depth: number })[] {
  const result: (CategoryItem & { depth: number })[] = [];
  function walk(parentId: number, depth: number) {
    const children = cats.filter((c) => c.parentId === parentId);
    for (const child of children) {
      result.push({ ...child, depth });
      walk(child.id, depth + 1);
    }
  }
  walk(rootId, 1);
  return result;
}

export function rootIdOf(cats: CategoryItem[], id: number): number {
  let curr = cats.find((c) => c.id === id);
  while (curr?.parentId) {
    const parent = cats.find((c) => c.id === curr?.parentId);
    if (!parent) break;
    curr = parent;
  }
  return curr?.id ?? id;
}

export function categoryTree(cats: CategoryItem[]): CategoryNode[] {
  function buildNodes(
    parentId: number | null | undefined,
    depth: number,
  ): CategoryNode[] {
    return cats
      .filter((c) => (c.parentId ?? null) === (parentId ?? null))
      .map((c) => ({
        ...c,
        depth,
        children: buildNodes(c.id, depth + 1),
      }));
  }
  return buildNodes(null, 0);
}

export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export function krw(n: number): string {
  return "KRW " + n.toLocaleString("en-US");
}

export function eulReul(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 === 0 ? "를" : "을";
}

/**
 * 카탈로그 목록 공통 ViewModel Hook
 */
export function useStorefrontCatalogViewModel(options?: {
  initialCategoryId?: number | null;
  initialCategoryName?: string | null;
  initialSort?: SortOption;
}) {
  const trpc = useTRPC();
  const {
    data,
    isPending,
    error,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery(productListOptions(trpc));

  const [selectedCatId, setSelectedCatId] = useState<number | null>(
    options?.initialCategoryId ?? null,
  );
  const [selectedCatName, setSelectedCatName] = useState<string | null>(
    options?.initialCategoryName ?? null,
  );
  const [sort, setSort] = useState<SortOption>(options?.initialSort ?? "latest");

  // 카테고리 목록 쿼리
  const { data: categories = [] } = useQuery<CategoryItem[]>({
    queryKey: ["shop-categories"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/categories`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const onSelectCategory = useCallback((id: number | null, name: string | null) => {
    setSelectedCatId(id);
    setSelectedCatName(name);
  }, []);

  const inCart = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);

  const [addedName, setAddedName] = useState<string | null>(null);
  const clearAdded = useCallback(() => setAddedName(null), []);

  const allProducts = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap((page) => page.items as StorefrontProduct[]);
  }, [data]);

  // 필터링 및 정렬
  const products = useMemo(() => {
    const list = selectedCatName
      ? allProducts.filter((p) => p.categoryPath.includes(selectedCatName))
      : allProducts;

    switch (sort) {
      case "price_asc":
        return [...list].sort((a, b) => a.price - b.price);
      case "price_desc":
        return [...list].sort((a, b) => b.price - a.price);
      case "reviews":
        return [...list].sort(
          (a, b) =>
            (b.reviewCount ?? 0) - (a.reviewCount ?? 0) ||
            (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
            b.id - a.id,
        );
      case "latest":
      default:
        // default / latest: id 내림차순 또는 유지
        return [...list].sort((a, b) => b.id - a.id);
    }
  }, [allProducts, selectedCatName, sort]);

  const handleAddToCart = useCallback(
    (product: StorefrontProduct, variant?: ProductVariantItem | null) => {
      const price = product.price + (variant?.priceDelta ?? 0);
      add({
        productId: product.id,
        name: product.name,
        price,
        variantId: variant?.id,
        variantLabel: variant?.name,
      });
      setAddedName(product.name);
    },
    [add],
  );

  return {
    categories,
    selectedCatId,
    selectedCatName,
    onSelectCategory,
    sort,
    setSort,
    products,
    allProducts,
    isPending,
    error,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    inCart,
    handleAddToCart,
    addedName,
    clearAdded,
  };
}

/**
 * 상품 상세(PDP) 공통 ViewModel Hook
 */
export function useStorefrontDetailViewModel(
  id: number,
  initialProduct?: StorefrontProduct | null,
) {
  const router = useRouter();
  const trpc = useTRPC();
  const { data, isPending: isProductPending, error } = useQuery(
    trpc.products.byId.queryOptions({ id }),
  );

  const product = (data ?? initialProduct) as StorefrontProduct | undefined;
  const variants = product?.variants ?? initialProduct?.variants;
  const allVariants: ProductVariantItem[] = useMemo(() => variants ?? [], [variants]);
  const hasVariants = allVariants.length > 0;

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(() =>
    allVariants.length > 0 ? allVariants[0].id : null,
  );

  const selectedVariant = useMemo(() => {
    if (!hasVariants) return null;
    return allVariants.find((v) => v.id === selectedVariantId) ?? allVariants[0] ?? null;
  }, [allVariants, hasVariants, selectedVariantId]);

  const currentPrice = (product?.price ?? 0) + (selectedVariant?.priceDelta ?? 0);
  const currentStock = selectedVariant ? selectedVariant.stock : (product?.stock ?? 0);
  const isSoldOut = currentStock <= 0;

  // 장바구니 수량
  const inCartQuantity = useCartStore((s) =>
    s.items.find(
      (i) => i.productId === id && (i.variantId ?? 0) === (selectedVariant?.id ?? 0),
    )?.quantity ?? 0,
  );
  const add = useCartStore((s) => s.add);

  const [added, setAdded] = useState(false);
  const clearAdded = useCallback(() => setAdded(false), []);

  // 장바구니 담기
  const handleAddToCart = useCallback(() => {
    if (!product || isSoldOut) return;
    add({
      productId: id,
      name: product.name,
      price: currentPrice,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.name,
    });
    setAdded(true);
  }, [add, id, product, isSoldOut, currentPrice, selectedVariant]);

  // 바로 구매하기: 장바구니에 담고 즉시 /cart로 이동
  const handleBuyNow = useCallback(() => {
    if (!product || isSoldOut) return;
    add({
      productId: id,
      name: product.name,
      price: currentPrice,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.name,
    });
    router.push("/cart");
  }, [add, id, product, isSoldOut, currentPrice, selectedVariant, router]);

  // 리뷰 쿼리
  const { data: reviewsData, isPending: isReviewsPending } = useQuery<ProductReviewsData>({
    queryKey: ["product-reviews", id],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/products/${id}/reviews`);
      if (!res.ok) throw new Error("리뷰를 불러오지 못했습니다.");
      return res.json();
    },
  });

  return {
    product,
    allVariants,
    hasVariants,
    selectedVariant,
    selectedVariantId,
    setSelectedVariantId,
    currentPrice,
    currentStock,
    isSoldOut,
    inCartQuantity,
    handleAddToCart,
    handleBuyNow,
    added,
    clearAdded,
    reviewsData,
    isReviewsPending,
    isProductPending,
    error,
  };
}
