const BASE_KEY = process.env.CATALOG_CACHE_KEY ?? "catalog";
const FORMAT = 2;
export const CATALOG_KEY = `${BASE_KEY}:v${FORMAT}`;
export const CATALOG_KEYS_TO_CLEAR = [CATALOG_KEY, BASE_KEY];
