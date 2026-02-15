import { Redis } from "ioredis";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 200);
const loads = async () => Number((await (await fetch(`${API}/metrics`)).text()).match(/^catalog_loads_total (\d+)/m)?.[1] ?? 0);

const redis = new Redis(process.env.REDIS_URL);
await redis.del(process.env.CATALOG_CACHE_KEY ?? "catalog");
await redis.quit();

const before = await loads();
const start = performance.now();
const statuses = await Promise.all(Array.from({ length: N }, () => fetch(`${API}/products`).then((r) => r.status)));
const ms = performance.now() - start;
console.log(`요청 ${N}개: ${statuses.filter((s) => s === 200).length}개 200, ${ms.toFixed(0)}ms`);
console.log(`DB에서 카탈로그를 읽은 횟수: ${(await loads()) - before}`);
