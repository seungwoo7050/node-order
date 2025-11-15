const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const API_CACHE = `api-${VERSION}`;
const CURRENT = [STATIC_CACHE, PAGE_CACHE, API_CACHE];

const API_ORIGIN = new URL(self.location.href).searchParams.get("api");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!CURRENT.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(PAGE_CACHE, req));
    return;
  }

  if (API_ORIGIN && url.origin === API_ORIGIN && !req.headers.has("authorization")) {
    event.respondWith(networkFirst(API_CACHE, req));
  }
});

async function cacheFirst(cacheName, req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirst(cacheName, req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response("오프라인, 저장된 응답이 없습니다", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}