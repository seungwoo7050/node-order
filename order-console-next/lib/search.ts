import { publicFetch } from "./api-client";

// 검색 API(REST). 결과는 카탈로그 캐시를 거치지 않으므로 브라우저에서 바로 부른다
export type SearchItem = {
  id: number;
  name: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  categoryPath: string[];
  match: "token" | "similar" | "prefix"; // similar: 오타 보충으로 찾은 상품
};
export type SearchPage = { items: SearchItem[]; page: number; nextPage: number | null };
export type Suggestion = { id: number; name: string };
export type PopularQuery = { query: string; count: number };

export const SUGGEST_DEBOUNCE_MS = 200;

export const searchHref = (q: string) => `/shop/search?q=${encodeURIComponent(q)}`;

export const searchProducts = (q: string, page: number) =>
  publicFetch<SearchPage>(`/products/search?q=${encodeURIComponent(q)}&page=${page}`);

export const suggestProducts = async (q: string) =>
  (await publicFetch<{ items: Suggestion[] }>(`/products/suggest?q=${encodeURIComponent(q)}`)).items;

export const popularQueries = async () => (await publicFetch<{ items: PopularQuery[] }>("/search/popular")).items;
