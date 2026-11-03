import type { StoreInfo } from "@/lib/store-info";
import type {
  CategoryItem,
  ProductVariantItem,
  SortOption,
  StorefrontProduct,
} from "@/lib/storefront-view-model";

export type StoreDesignId = "muji-hara" | "editorial-atelier" | "zavanas-archive";

export interface StoreDesignConfig {
  id: StoreDesignId;
  number: string;
  name: string;
  koName: string;
  badge: string;
  subtitle: string;
  swatch: [string, string, string];
}

export const STORE_DESIGNS: StoreDesignConfig[] = [
  {
    id: "editorial-atelier",
    number: "01",
    name: "Editorial Atelier",
    koName: "에디토리얼 아틀리에",
    badge: "Lookbook",
    subtitle: "Coor · Firstfloor 컨템포러리 룩북",
    swatch: ["#f6f4f0", "#141413", "#8c7f70"],
  },
  {
    id: "muji-hara",
    number: "02",
    name: "Muji · Hara",
    koName: "무지 · 하라 켄야",
    badge: "Tactile",
    subtitle: "MUJI · 45R 자연주의 촉각 카탈로그",
    swatch: ["#f3eee4", "#7f1d1d", "#26231f"],
  },
  {
    id: "zavanas-archive",
    number: "03",
    name: "Zavanas Archive",
    koName: "자바나스 아카이브",
    badge: "Matrix",
    subtitle: "Zavanas · Braun 인더스트리얼 매트릭스",
    swatch: ["#e9ecef", "#ff4d00", "#111315"],
  },
];

export function resolveActiveDesign(
  param: string | null | undefined,
  serverDesign?: string | null,
): StoreDesignId {
  if (
    param === "muji-hara" ||
    param === "editorial-atelier" ||
    param === "zavanas-archive"
  ) {
    return param;
  }
  if (
    serverDesign === "muji-hara" ||
    serverDesign === "editorial-atelier" ||
    serverDesign === "zavanas-archive"
  ) {
    return serverDesign;
  }
  return "editorial-atelier";
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
}

export interface DetailDesignProps {
  id: number;
  initialProduct?: StorefrontProduct | null;
  storeInfo?: StoreInfo | null;
}
