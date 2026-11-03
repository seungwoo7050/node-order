import type { StoreInfo } from "@/lib/store-info";
import type {
  CategoryItem,
  ProductVariantItem,
  SortOption,
  StorefrontProduct,
} from "@/lib/storefront-view-model";

export type StoreDesignId = "muji-hara" | "editorial-atelier" | "zavanas-archive";

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
  handleAddToCart: (product: StorefrontProduct, variant?: ProductVariantItem | null) => void;
  addedName: string | null;
  clearAdded: () => void;
}

export interface DetailDesignProps {
  id: number;
  initialProduct?: StorefrontProduct | null;
  storeInfo?: StoreInfo | null;
}
