import type { StoreInfo } from "@/lib/store-info";
import type {
  CategoryItem,
  ProductVariantItem,
  SortOption,
  StorefrontProduct,
} from "@/lib/storefront-view-model";

export const STORE_DESIGN_IDS = [
  "editorial-atelier",
  "muji-hara",
  "zavanas-archive",
] as const;

export type StoreDesignId = (typeof STORE_DESIGN_IDS)[number];

export function isStoreDesignId(v: unknown): v is StoreDesignId {
  return (
    typeof v === "string" && (STORE_DESIGN_IDS as readonly string[]).includes(v)
  );
}

export interface StoreDesignConfig {
  id: StoreDesignId;
  name: string;
  koName: string;
}

export const STORE_DESIGNS: StoreDesignConfig[] = [
  {
    id: "editorial-atelier",
    name: "Editorial Atelier",
    koName: "에디토리얼 아틀리에",
  },
  {
    id: "muji-hara",
    name: "Muji · Hara",
    koName: "무지 · 하라 켄야",
  },
  {
    id: "zavanas-archive",
    name: "Zavanas Archive",
    koName: "자바나스 아카이브",
  },
];

export function resolveActiveDesign(
  ...candidates: (string | null | undefined)[]
): StoreDesignId {
  for (const c of candidates) {
    if (isStoreDesignId(c)) return c;
  }
  return "editorial-atelier";
}

export interface HeaderDesignProps {
  storeName: string;
  announcementText?: string | null;
  cartCount: number;
  loggedIn: boolean;
  onLogout: () => void | Promise<void>;
  linkFor: (href: string) => string;
}

export interface CatalogDesignProps {
  categories: CategoryItem[];
  selectedCatId: number | null;
  selectedCatName: string | null;
  onSelectCategory: (id: number | null, name: string | null) => void;
  sort: SortOption;
  setSort: (s: SortOption) => void;
  products: StorefrontProduct[];
  allProducts: StorefrontProduct[];
  isPending: boolean;
  error: { message?: string } | null | unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => void;
  storeInfo?: StoreInfo | null;
  handleAddToCart: (
    product: StorefrontProduct,
    variant?: ProductVariantItem | null,
  ) => void;
  addedName: string | null;
  clearAdded: () => void;
  linkFor: (href: string) => string;
}

export interface DetailDesignProps {
  id: number;
  initialProduct?: StorefrontProduct | null;
  storeInfo?: StoreInfo | null;
  linkFor?: (href: string) => string;
}
