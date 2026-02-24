# 23: 캐시 — 상품 카탈로그를 Redis와 Next 서버에 캐시하고, 수정 한 번이 지울 곳을 정한다

## 목표

`22`까지 상품 목록은 요청마다 DB에서 조립됐다. 이 문서는 상품에 캐시를 두 겹 얹는다. API 앞에는 Redis, 화면 앞에는 Next 서버의 캐시다. 그리고 캐시가 늘 때마다 무엇이 깨지는지 하나씩 재현한다.

1. 상품 목록에 cache-aside를 적용한다. 결제마다 바뀌는 재고는 빼고, 잘 바뀌지 않는 카탈로그(이름·가격·이미지·카테고리 경로)만 Redis에 둔다. 재고까지 통째로 캐시하면 결제 부하에서 적중률이 어떻게 무너지는지 k6로 잰다
2. 무효화를 하나 빠뜨리면 옛 가격이 보이는 것, 캐시가 비는 순간 요청이 DB로 몰리는 스탬피드, Redis가 죽었을 때 목록이 멈추는 것을 재현하고 고친다
3. 이미 켜져 있는 Next 16의 Cache Components가 이 앱에서 무엇을 하는지 빌드 출력으로 읽는다
4. 상품 상세 페이지(`/shop/[id]`)를 만든다. 상품에 설명 칸을 더하고, 카탈로그는 Next 서버에 캐시하고 재고는 브라우저가 따로 받는다. 목록에서 누르면 팝업, 주소를 직접 열면 전체 페이지다
5. 관리자 상품 화면을 Server Component와 `"use cache"`로 바꾸고, 상품 수정(이름·가격·설명)을 Server Action으로 만든다. 저장 뒤 목록 태그와 상품별 태그를 지운다
6. 캐시가 세 겹(Redis, Next 서버, 브라우저)일 때 수정 한 번이 어디를 지워야 하는지 표로 정리한다

| 측정 | 경우 | 결과 |
|---|---|---|
| k6 20초, 목록 보는 사람 20 + 결제하는 사람 20 | 캐시 없음 | 목록 3,256건, p95 166ms |
| | 재고까지 통째로 캐시 | 적중률 22.2%, 목록 5,495건, p95 114ms |
| | 카탈로그만 캐시 | 적중률 99.7%, 목록 7,069건, p95 79ms |
| 캐시가 빈 순간 목록 요청 200개 | single-flight 없음 | DB에서 카탈로그를 읽은 횟수 111 |
| | single-flight | 1 |
| Redis를 멈춘 뒤 `GET /products` | ioredis 기본값 | 30초 넘게 응답 없음 |
| | 캐시용 연결 옵션을 준 뒤 | 200, 0.01초 |

> 전제: `22`까지의 코드가 있다. 이 브랜치 `23-caching`은 [`22-pagination-locking`](https://github.com/seungwoo7050/node-order/tree/22-pagination-locking)의 소스에서 시작한다. 경로는 모두 저장소 루트 기준이다. 결제는 Stripe 시뮬레이터(`scripts/stripe-sim.mjs`)로 한다.  
> 배포한 서버는 쓰지 않는다. 모두 이 PC에서 compose와 `npm`으로 띄운다. 배포 브랜치(`DEPLOY_BRANCH`)는 그대로 두므로 이 브랜치를 푸시하면 검사·테스트만 돈다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 측정 결과를 읽는 법 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·옵션의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨리거나 바꿔 보는 것. 결과가 장애이거나 버릴 코드다 | 친다. 확인한 뒤 되돌린다 |
| `진단 N.` | 11장에서 증상으로 원인을 가르는 절차 | 친다 |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. `실험`은 건너뛰어도 다음 작업이 깨지지 않는다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가른다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드·테스트·마이그레이션, compose, 측정 스크립트 | 한다 |
| `[실행]` | 저장소 밖의 상태: 띄운 컨테이너와 서버, DB·Redis의 데이터. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 지표·빌드 출력·부하 결과 읽기, 테스트 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`.

- 실험은 커밋한 뒤에 시작한다. 실험 전에 `git status`가 깨끗한지 보고, 되돌릴 때는 `git restore`로 실험 파일만 되돌린다. 3장과 9장의 첫 실험, 4장·7장의 실험은 블록 안에서 되돌린다. 3장의 둘째 실험과 9장의 뒤 두 실험은 이어지는 `[원복]` 작업이 되돌린다.

- 코드 블록의 모양: 그 작업에서 새로 만드는 파일은 전체를 싣고 첫 줄에 경로 주석(`// order-api-nest/...`)을 둔다. 이 주석은 실제 파일에 넣지 않는다. 경로 주석은 명령 블록의 위치 주석(`# order-api-nest/에서`)과 상관없이 늘 저장소 루트 기준이다. `order-api-nest/`에 있는 터미널에서 `// order-api-nest/scripts/x.mjs`를 만들면 `scripts/x.mjs`다. 이미 있는 파일은 `diff`로 싣는다. `-`가 지금, `+`가 바꾼 뒤다. 스니펫의 주석은 학습용이라 저장소의 다른 코드보다 많다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 11장 "진단 9"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 11~13장은 디버깅·체크리스트·자가 점검이라 `남길 것`을 두지 않았다.

- `<!-- 검증 안 됨: 새로 쓴 절 -->`이 달린 절은 예전 측정 없이 새로 쓴 것이다. 코드는 이 브랜치의 시작 코드에 차례로 적용해 타입 검사·린트·`next build`까지만 확인했다.

| 단계 | 하는 일 |
|---|---|
| [0. 캐시에 대한 사전지식](#0-캐시에-대한-사전지식) | 캐시의 위치, cache-aside, 무효화와 TTL, 캐시가 만드는 장애(작업 없음) |
| [1. 준비](#1-준비) | 쿼리 통계 확장을 켜고 인프라·시뮬레이터·API를 띄운다 |
| [2. 1단계: 카탈로그를 Redis에 캐시한다](#2-1단계-카탈로그를-redis에-캐시한다) | 카탈로그만 cache-aside로 두고, 바꾸는 곳(시드 포함)만 지운다 |
| [3. 2단계: 일부러 바꿔보기, 재고까지 통째로 캐시한다](#3-2단계-일부러-바꿔보기-재고까지-통째로-캐시한다) | 통째로 캐시한 경우와 캐시 없음을 k6로 비교하고 되돌린다 |
| [4. 3단계: 일부러 깨뜨려보기 ①, 무효화 하나를 빠뜨린다](#4-3단계-일부러-깨뜨려보기-①-무효화-하나를-빠뜨린다) | 무효화를 빼면 TTL 동안 옛 가격이 보인다 |
| [5. 4단계: 일부러 깨뜨려보기 ②, 캐시가 비는 순간](#5-4단계-일부러-깨뜨려보기-②-캐시가-비는-순간) | 스탬피드를 재현하고 single-flight로 막는다 |
| [6. 5단계: 일부러 깨뜨려보기 ③, Redis가 죽는다](#6-5단계-일부러-깨뜨려보기-③-redis가-죽는다) | Redis가 멈추면 목록이 멈추는 것을 재현하고 고친다 |
| [7. 6단계: 이미 켜져 있는 Next 서버 캐시를 읽는다](#7-6단계-이미-켜져-있는-next-서버-캐시를-읽는다) | 켜져 있는 Cache Components와 `instant = false`를 빌드 출력으로 읽는다 |
| [8. 7단계: 상품 상세 페이지](#8-7단계-상품-상세-페이지) | 설명 칸, `GET /products/:id`, 서버 캐시한 상세 페이지와 팝업 |
| [9. 8단계: 관리자 상품 화면을 서버에서 캐시하고 Server Action으로 고친다](#9-8단계-관리자-상품-화면을-서버에서-캐시하고-server-action으로-고친다) | `"use cache"`와 두 가지 태그, Server Action 수정과 `updateTag` |
| [10. 9단계: 세 겹의 캐시, 수정 한 번이 지울 곳](#10-9단계-세-겹의-캐시-수정-한-번이-지울-곳) | 상품 하나의 복사본과 지우는 순서, 그것을 지키는 e2e |
| [11. 디버깅](#11-디버깅) | 증상별 진단과 에러 신호 표 |
| [12. 완성 확인](#12-완성-확인) | 체크리스트 |
| [13. 다음 단계](#13-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 캐시에 대한 사전지식

### 개념 1 | 캐시는 어디에 두는가, cache-aside

캐시는 원본(DB)보다 가까운 곳에 복사본을 두는 일이다. 이 문서가 다루는 복사본은 세 곳에 있다. API 서버들이 함께 보는 Redis, 화면을 그리는 Next 서버의 메모리, 사용자 브라우저의 메모리다. 가까울수록 빠르고, 대신 원본이 바뀐 것을 알기 어렵다.

cache-aside는 읽는 쪽이 캐시를 관리하는 방식이다. 캐시에 있으면 그 값을 쓰고(적중, hit), 없으면(빗나감, miss) DB에서 읽어 캐시에 넣은 뒤 돌려준다. 쓰는 쪽은 DB에 쓴 뒤 캐시를 지운다(무효화). 다음 읽기가 새 값으로 다시 채운다. 이 서비스의 상품 목록이 2장부터 이 방식이다.

### 개념 2 | 캐시할 것은 "얼마나 자주 바뀌는가"로 나눈다

상품 한 줄에는 몇 달에 한 번 바뀌는 칸(이름, 가격, 이미지, 카테고리)과 결제마다 바뀌는 칸(재고)이 섞여 있다. 한 줄을 통째로 캐시하면 캐시의 수명은 가장 자주 바뀌는 칸이 정한다. 한쪽이 바뀔 때마다 줄 전체가 버려진다.

### 개념 3 | 무효화와 TTL

원본이 바뀌면 그 값을 복사해 둔 모든 곳을 지워야 한다. 지우는 것을 잊으면 옛 값이 남는다. 그래서 캐시에는 수명(TTL)도 건다. TTL은 무효화를 잊었을 때의 안전망이고, 그 길이가 "틀린 값을 얼마나 참을 수 있는가"다.

캐시가 한 겹 늘면 지울 곳도 한 곳 는다. 이 문서가 끝나면 상품 가격의 복사본은 DB 말고도 Redis, Next 서버, 브라우저에 있다. 수정하는 코드가 그것을 모두 알아야 한다.

### 개념 4 | 캐시가 만드는 장애

캐시를 넣으면 새 장애가 생긴다. 지우는 것을 잊으면 옛 값이 보이고(4장), 캐시가 비는 순간 몰린 요청이 각자 DB로 가고(스탬피드, 5장), 캐시 서버가 죽으면 그것을 기다리다 멈춘다(6장). 스탬피드는 "지금 읽는 중"인 요청 하나를 나머지가 함께 기다리게 해서(single-flight) 막는다. 캐시 서버 장애는 캐시가 없는 것처럼 원본으로 가게 해서(fail-open) 견딘다. 이 문서의 단계 대부분이 이 세 가지를 재현하고 고치는 일이다.

### 개념 5 | 메모리 캐시는 오래 안 쓴 것부터 버린다

Next 서버의 캐시는 프로세스 메모리에 있고 크기에 한도가 있다(기본 50MB). 가득 차면 가장 오래 쓰지 않은 칸부터 버린다(LRU). 해시 맵 하나와 사용 순서를 담은 이중 연결 리스트로 만든다. 꺼낼 때마다 그 칸을 리스트의 앞으로 옮기고, 넘치면 리스트의 끝을 버린다. 그래서 Next 서버의 캐시는 서버를 다시 띄우면 비고, 서버가 두 대면 두 벌이다(9장 개념).

## 1. 준비

### 작업 1. [커밋] 쿼리 통계 확장을 켠다

캐시 전후로 DB에 실제로 간 쿼리를 앱 밖에서 세려고 `pg_stat_statements`를 켠다.

```diff
--- a/compose.yaml
+++ b/compose.yaml
@@
       - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
   db:
     image: postgres:17
+    # 쿼리 모양마다 실행 횟수와 시간을 세는 확장. 서버가 뜰 때 읽어야 하므로 command로 넘긴다
+    command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements"]
     environment:
       POSTGRES_USER: order
       POSTGRES_PASSWORD: order
```

`pg_stat_statements`는 쿼리 모양(값을 `$1`로 바꾼 것)마다 몇 번 실행됐고 시간이 얼마 걸렸는지 센다. 서버가 뜰 때 읽어야 하는 확장이라 설정 파일 대신 `command`로 넘긴다.

### 작업 2. [실행] 인프라·시뮬레이터·API를 띄운다

```sh
# 저장소 루트에서
docker compose up -d
docker compose exec -T db psql -U order -d order_api -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
# CREATE EXETENSION
```

`docker compose up -d`는 `command`가 바뀐 `db` 컨테이너를 다시 만든다. 데이터는 볼륨(`pgdata`)에 있어 그대로다.

```sh
# order-api-nest/에서
npx prisma migrate deploy && npx prisma db seed
docker compose -f ../compose.yaml exec -T db psql -q -U order -d order_api < loadtest/load-seed.sql
node scripts/stripe-sim.mjs # 터미널 1
npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 LOG_LEVEL=warn node --env-file=.env dist/main.js # 터미널 2
```

`load-seed.sql`은 `22`와 같은 부하용 상품 50개다. 이름이 `부하용 상품 N`이고, 번호는 시드 상품(1~16) 뒤에 붙는다. 시드를 다시 돌리면 시퀀스가 되돌아가지 않으므로 번호는 밀린다. 부하 시나리오는 그래서 번호가 아니라 이름으로 상품을 찾는다.

`LOG_LEVEL=warn`이라 API는 다 떠도 아무것도 찍지 않는다. 떴는지는 다른 터미널에서 본다.

```sh
# 저장소 루트에서
curl -s localhost:4000/health/ready
# 출력
{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}
```

이 문서에서 API를 "다시 빌드해 띄운다"는 터미널 2를 `Ctrl+C`로 끄고 같은 줄을 다시 치는 것이다.

### 남길 것

- **찾아보면 되는 것**: `shared_preload_libraries`, `CREATE EXTENSION pg_stat_statements`, `pg_stat_statements_reset()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 캐시의 효과는 앱이 세는 지표만이 아니라 DB에 실제로 간 쿼리 수로 확인한다. 잴 때마다 통계를 0부터 센다.

- **에러 신호**:

  - `relation "pg_stat_statements" does not exist` → `CREATE EXTENSION`을 했는지

  - `pg_stat_statements must be loaded via "shared_preload_libraries"` → compose의 `command`를 더한 뒤 DB 컨테이너를 다시 만들었는지(`docker compose up -d`)

## 2. 1단계: 카탈로그를 Redis에 캐시한다

### 작업 1. [커밋] cache-aside를 해시 하나에 둔다

캐시 키 이름은 API와 시드(작업 4)가 함께 쓰므로 따로 둔다.

```ts
// order-api-nest/src/cache/catalog-key.ts
// 카탈로그 캐시의 Redis 키. API와 시드(prisma/seed.ts)가 함께 쓴다
// e2e는 개발 서버와 같은 Redis를 쓰므로 test/setup-env.ts에서 다른 이름으로 바꾼다
export const CATALOG_KEY = process.env.CATALOG_CACHE_KEY ?? "catalog";
```

```ts
// order-api-nest/src/cache/catalog-cache.ts
import { Global, Injectable, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { catalogCacheRequests, catalogLoads } from "../metrics/metrics.js";
import { CATALOG_KEY } from "./catalog-key.js";

const TTL_SECONDS = Number(process.env.CATALOG_TTL_SECONDS ?? 60);
// "칸이 비었다"와 "Redis에 닿지 않았다"를 캐시에 든 값(null도 값이다)과 섞이지 않게 표시한다
const MISS = Symbol("miss");
const ERROR = Symbol("error");

@Injectable()
export class CatalogCache implements OnModuleDestroy {
  private readonly logger = new Logger(CatalogCache.name);
  // 캐시용 연결은 기다리지 않고 실패한다(5단계). Socket.IO 어댑터·BullMQ 연결은 기본값(다시 붙을 때까지 기다림) 그대로 둔다
  private readonly redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 100 });
  // 지금 DB에서 읽고 있는 칸. 빈 칸을 동시에 본 요청들이 이 Promise 하나를 함께 기다린다(single-flight, 4단계)
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor() {
    this.redis.on("error", () => {}); // 연결 오류는 read/write의 catch가 다룬다. 여기서 찍으면 끊긴 동안 로그가 쏟아진다
  }

  // cache-aside: 캐시에 있으면 그 값을, 없으면 load()로 DB에서 읽어 캐시에 넣고 돌려준다
  async getOrLoad<T>(field: string, load: () => Promise<T>): Promise<T> {
    const cached = await this.read(field);
    if (cached !== MISS && cached !== ERROR) {
      catalogCacheRequests.inc({ result: "hit" });
      return cached as T;
    }
    catalogCacheRequests.inc({ result: cached === ERROR ? "error" : "miss" }); // 한 요청은 셋 중 하나로만 센다
    const running = this.inflight.get(field);
    if (running) return running as Promise<T>;
    const loading = (async () => {
      catalogLoads.inc();
      const value = await load();
      await this.write(field, value);
      return value;
    })().finally(() => this.inflight.delete(field));
    this.inflight.set(field, loading);
    return loading;
  }

  // 모든 칸이 해시 하나에 있으므로 DEL 한 번이면 어느 페이지에 있던 상품이든 함께 지워진다
  async invalidate(): Promise<void> {
    try {
      await this.redis.del(CATALOG_KEY);
    } catch (err) {
      this.logger.warn(`카탈로그 캐시를 지우지 못했다: ${(err as Error).message}`); // TTL이 지날 때까지 옛 값이 보인다
    }
  }

  private async read(field: string): Promise<unknown> {
    try {
      const raw = await this.redis.hget(CATALOG_KEY, field);
      return raw === null ? MISS : JSON.parse(raw);
    } catch {
      return ERROR; // Redis 장애는 캐시가 없는 것처럼 DB로 간다(fail-open)
    }
  }

  private async write(field: string, value: unknown) {
    try {
      // EXPIRE … NX: 만료가 없을 때만 건다. 칸을 채울 때마다 다시 걸면 계속 읽히는 동안 영영 만료되지 않는다
      await this.redis.multi().hset(CATALOG_KEY, field, JSON.stringify(value)).expire(CATALOG_KEY, TTL_SECONDS, "NX").exec();
    } catch {
      // 캐시에 못 넣어도 응답은 이미 DB에서 읽은 값으로 한다
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}

@Global()
@Module({ providers: [CatalogCache], exports: [CatalogCache] })
export class CatalogCacheModule {}
```

페이지마다 키를 따로 두지 않고 해시 `catalog` 하나에 칸(`list:<cursor>:<limit>`)으로 둔다. 상품 하나가 바뀌면 그 상품이 어느 페이지에 있는지 따질 것 없이 `DEL catalog` 한 번으로 모든 페이지가 지워진다. 8장에서 상품 하나짜리 칸(`product:<id>`)도 같은 해시에 넣는다.

`EXPIRE … NX`는 만료가 없을 때만 건다. 첫 칸을 넣은 때부터 60초를 센다. `inflight`(single-flight)는 5장에서, `read`가 돌려주는 `ERROR`와 연결 옵션은 6장에서 다룬다.

`@Global()` 모듈이라 한 번 등록하면 어느 모듈의 컨트롤러든 생성자로 받는다. 적중·빗나감을 세는 지표 둘을 더하고 모듈을 등록한다.

```diff
--- a/order-api-nest/src/metrics/metrics.ts
+++ b/order-api-nest/src/metrics/metrics.ts
@@
   registers: [registry],
 });
 
+// 적중률 = hit / (hit + miss + error)
+export const catalogCacheRequests = new Counter({
+  name: "catalog_cache_requests_total",
+  help: "카탈로그 캐시 조회 수",
+  labelNames: ["result"] as const,
+  registers: [registry],
+});
+
+// 빗나간 요청이 여럿이어도 single-flight로 묶이면 한 번으로 센다
+export const catalogLoads = new Counter({
+  name: "catalog_loads_total",
+  help: "카탈로그를 DB에서 읽은 횟수",
+  registers: [registry],
+});
+
 function routeOf(req: Request): string {
   const path = req.route?.path as string | undefined;
   if (!path || path === "{/*splat}") return "unmatched";
```

```diff
--- a/order-api-nest/src/app.module.ts
+++ b/order-api-nest/src/app.module.ts
@@
 import { PaymentsModule } from './payments/payments.module.js';
 import { MetricsModule } from './metrics/metrics.module.js';
 import { RateLimitModule } from './rate-limit/rate-limit.module.js';
+import { CatalogCacheModule } from './cache/catalog-cache.js';
 
 @Module({
   imports: [
     LoggerModule.forRoot(loggerOptions),
-    MetricsModule, RateLimitModule, PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule],
+    MetricsModule, RateLimitModule, PrismaModule, StorageModule, CatalogCacheModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule],
   controllers: [AppController],
   providers: [AppService, ShutdownLogger],
 })
```

### 작업 2. [커밋] 목록을 카탈로그와 재고로 나눈다

상품 목록의 한 줄에 카테고리 경로(`["전자기기", "컴퓨터", "키보드"]`)를 붙인다. 카테고리는 부모를 따라 올라가는 트리라서(`09`) 재귀 CTE로 루트까지 올라가며 이름을 모은다. 실제 서비스의 카탈로그도 이렇게 여러 표를 모아 조립하고, 캐시가 아끼는 것은 그 조립이다.

옛 `listProducts`의 앞부분(상품 한 페이지 읽기)이 `loadCatalogPage`가 되고, 그 아래에 새 `listProducts`가 붙는다.

```diff
--- a/order-api-nest/src/products/product-list.ts
+++ b/order-api-nest/src/products/product-list.ts
@@
+import type { CatalogCache } from "../cache/catalog-cache.js";
 import type { PrismaService } from "../prisma/prisma.service.js";
 import type { StorageService } from "../storage/storage.service.js";
 import { toPage } from "../pagination/cursor.js";
 
-export async function listProducts(prisma: PrismaService, storage: StorageService, page: { limit: number; cursor?: number | null }) {
+// 카탈로그 = 잘 바뀌지 않는 칸. 재고는 결제마다 바뀌므로 넣지 않는다
+export type CatalogItem = { id: number; name: string; price: number; imageKey: string | null; categoryPath: string[] };
+type CatalogPage = { items: CatalogItem[]; nextCursor: number | null };
+export type ProductDeps = { prisma: PrismaService; storage: StorageService; cache: CatalogCache };
+
+// 카테고리 id마다 루트부터의 이름 배열. 부모를 따라 올라가는 재귀 CTE(09)
+async function categoryPaths(prisma: PrismaService, leaves: number[]): Promise<Map<number, string[]>> {
+  if (leaves.length === 0) return new Map();
+  const rows = await prisma.$queryRaw<{ leaf: number; path: string[] }[]>`
+    WITH RECURSIVE up AS (
+      SELECT id AS leaf, id, name, parent_id, 0 AS depth FROM categories WHERE id = ANY(${leaves})
+      UNION ALL
+      SELECT up.leaf, c.id, c.name, c.parent_id, up.depth + 1 FROM up JOIN categories c ON c.id = up.parent_id
+    ) CYCLE id SET is_cycle USING visited
+    SELECT leaf, array_agg(name ORDER BY depth DESC) AS path FROM up WHERE NOT is_cycle GROUP BY leaf`;
+  return new Map(rows.map((r) => [r.leaf, r.path]));
+}
+
+// 카탈로그 한 페이지를 DB에서 조립한다. 캐시가 아끼는 것이 이 조립이다
+export async function loadCatalogPage(prisma: PrismaService, page: { limit: number; cursor?: number | null }): Promise<CatalogPage> {
   const rows = await prisma.product.findMany({
     where: page.cursor ? { id: { gt: page.cursor } } : {},
+    select: { id: true, name: true, price: true, imageKey: true, categoryId: true },
     orderBy: { id: "asc" },
     take: page.limit + 1,
   });
   const { items, nextCursor } = toPage(rows, page.limit, (last) => last.id);
-  const withUrls = await Promise.all(
-    items.map(async ({ imageKey, ...p }) => ({
+  const pathOf = await categoryPaths(prisma, [...new Set(items.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);
+  return {
+    items: items.map(({ categoryId, ...p }) => ({ ...p, categoryPath: (categoryId && pathOf.get(categoryId)) || [] })),
+    nextCursor,
+  };
+}
+
+// REST(GET /products)와 tRPC(products.list)가 함께 부른다 → 같은 캐시를 본다
+export async function listProducts(deps: ProductDeps, page: { limit: number; cursor?: number | null }) {
+  const catalog = await deps.cache.getOrLoad(`list:${page.cursor ?? 0}:${page.limit}`, () => loadCatalogPage(deps.prisma, page));
+  // 재고만 그 페이지의 id로 매번 읽는다. 기본키 조회라 싸다
+  const stocks = await deps.prisma.product.findMany({ where: { id: { in: catalog.items.map((p) => p.id) } }, select: { id: true, stock: true } });
+  const stockOf = new Map(stocks.map((s) => [s.id, s.stock]));
+  const items = await Promise.all(
+    catalog.items.map(async ({ imageKey, ...p }) => ({
       ...p,
-      imageUrl: imageKey ? await storage.createDownloadUrl(imageKey, 600) : null,
+      stock: stockOf.get(p.id) ?? 0, // 캐시를 읽은 사이 지워진 상품이면 0(품절로 보인다)
+      // 서명한 주소는 캐시에 넣지 않는다. 10분 뒤 스스로 만료되므로 TTL과 따로 논다
+      imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : null,
     })),
   );
-  return { items: withUrls, nextCursor };
+  return { items, nextCursor: catalog.nextCursor };
 }
```

`loadCatalogPage`의 결과에는 `stock`이 없다. 카탈로그는 몇 달에 한 번 바뀌는 칸만 담는다. 목록은 카탈로그를 캐시에서 꺼내고, 재고만 그 페이지의 상품 id로 DB에서 읽어 합친다.

이미지 주소는 캐시하지 않고 요청마다 서명한다. 서명한 주소는 10분 뒤 만료되는데(`06`), 캐시에 넣으면 그 만료와 캐시의 TTL을 함께 맞춰야 한다. 서명은 DB도 네트워크도 쓰지 않는 계산이라 요청마다 해도 싸다.

`listProducts`의 인자가 `(prisma, storage, page)`에서 `(deps, page)`로 바뀌었다. 부르는 곳 둘(REST, tRPC)을 고친다. tRPC는 컨텍스트에 `catalogCache`를 더한다.

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
 import { Controller, Get, Query } from "@nestjs/common";
 import { ApiTags } from "@nestjs/swagger";
+import { CatalogCache } from "../cache/catalog-cache.js";
 import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
 import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 import { PrismaService } from "../prisma/prisma.service.js";
@@
   constructor(
     private readonly prisma: PrismaService,
     private readonly storage: StorageService,
+    private readonly cache: CatalogCache,
   ) {}
 
   @Get()
   list(@Query(PAGE_QUERY) query: ProductPageQueryDto) {
-    return listProducts(this.prisma, this.storage, query);
+    return listProducts({ prisma: this.prisma, storage: this.storage, cache: this.cache }, query);
   }
 }
```

```diff
--- a/order-api-nest/src/trpc/trpc.ts
+++ b/order-api-nest/src/trpc/trpc.ts
@@
 import { HttpException } from "@nestjs/common";
 import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
+import type { CatalogCache } from "../cache/catalog-cache.js";
 import type { CategoriesService } from "../categories/categories.service.js";
 import type { PrismaService } from "../prisma/prisma.service.js";
 import type { StorageService } from "../storage/storage.service.js";
@@
   prisma: PrismaService;
   storage: StorageService;
   categories: CategoriesService;
+  catalogCache: CatalogCache;
 }
 
 const t = initTRPC.context<Context>().create({
```

```diff
--- a/order-api-nest/src/trpc/trpc.module.ts
+++ b/order-api-nest/src/trpc/trpc.module.ts
@@
 import { ModuleRef } from "@nestjs/core";
 import { JwtService } from "@nestjs/jwt";
 import { createExpressMiddleware } from "@trpc/server/adapters/express";
+import { CatalogCache } from "../cache/catalog-cache.js";
 import { CategoriesService } from "../categories/categories.service.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
@@
     const prisma = get(PrismaService);
     const storage = get(StorageService);
     const categories = get(CategoriesService);
+    const catalogCache = get(CatalogCache);
     const logger = new Logger("tRPC");
 
     const handler = createExpressMiddleware({
@@
             userId = null;
           }
         }
-        return { userId, prisma, storage, categories };
+        return { userId, prisma, storage, categories, catalogCache };
       },
     });
 
```

```diff
--- a/order-api-nest/src/trpc/router.ts
+++ b/order-api-nest/src/trpc/router.ts
@@
   products: router({
     list: publicProcedure
       .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.number().int().positive().nullish() }).default({ limit: DEFAULT_LIMIT }))
-      .query(({ ctx, input }) => listProducts(ctx.prisma, ctx.storage, input)),
+      .query(({ ctx, input }) => listProducts({ prisma: ctx.prisma, storage: ctx.storage, cache: ctx.catalogCache }, input)),
   }),
 
   categories: router({
```

컨텍스트 타입에 칸이 늘었으므로, 컨텍스트를 직접 만드는 테스트도 같이 고친다. 고치지 않으면 `npm run typecheck`가 `Property 'catalogCache' is missing`으로 멈춘다.

```diff
--- a/order-api-nest/test/trpc.e2e-spec.ts
+++ b/order-api-nest/test/trpc.e2e-spec.ts
@@
 import { Test } from "@nestjs/testing";
 import { TRPCError } from "@trpc/server";
 import { AppModule } from "../src/app.module.js";
+import { CatalogCache } from "../src/cache/catalog-cache.js";
 import { CategoriesService } from "../src/categories/categories.service.js";
 import { PrismaService } from "../src/prisma/prisma.service.js";
 import { StorageService } from "../src/storage/storage.service.js";
@@
       prisma: app.get(PrismaService),
       storage: app.get(StorageService),
       categories: app.get(CategoriesService, { strict: false }),
+      catalogCache: app.get(CatalogCache),
     };
     callerAs = (userId) => appRouter.createCaller({ userId, ...deps });
   });
```

### 작업 3. [커밋] 카탈로그를 바꾸는 곳만 캐시를 지운다

관리자의 상품 수정 API가 아직 없다. `PATCH /products/:id`(관리자만)를 만든다. 저장한 뒤 캐시를 지운다.

```ts
// order-api-nest/src/products/update-product.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";

// 보낸 칸만 바꾼다. 재고는 결제·취소·입고 조정(22)이 바꾸므로 여기서 받지 않는다(whitelist가 걸러 낸다)
export class UpdateProductDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsInt() @Min(0) price?: number;
}
```

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
-import { Controller, Get, Query } from "@nestjs/common";
-import { ApiTags } from "@nestjs/swagger";
+import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Query, UseGuards } from "@nestjs/common";
+import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
+import { AdminGuard } from "../auth/admin.guard.js";
 import { CatalogCache } from "../cache/catalog-cache.js";
 import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
 import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
 import { listProducts } from "./product-list.js";
+import { UpdateProductDto } from "./update-product.dto.js";
 
 @ApiTags("products")
 @Controller("products")
@@
   list(@Query(PAGE_QUERY) query: ProductPageQueryDto) {
     return listProducts({ prisma: this.prisma, storage: this.storage, cache: this.cache }, query);
   }
+
+  // 데모 관리자는 AdminGuard가 403으로 막는다(21)
+  // 가격을 바꿔도 이미 만든 주문은 그대로다. 주문 품목은 주문할 때의 가격(unitPrice)을 따로 저장한다
+  @Patch(":id")
+  @ApiBearerAuth()
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
+  async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
+    const { count } = await this.prisma.product.updateMany({ where: { id }, data: dto });
+    if (count === 0) throw new NotFoundException(`product ${id} not found`);
+    await this.cache.invalidate(); // DB에 쓴 뒤에 지운다. 먼저 지우면 그 사이에 옛 값이 다시 채워질 수 있다
+    return this.prisma.product.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, price: true } });
+  }
 }
```

`AdminGuard`는 `21`의 데모 관리자(`demo_admin`)에게 403(`데모 관리자는 볼 수만 있습니다`)을 준다. 관리자 전용 API 목록 테스트에 한 줄을 더해 수정 API도 그렇게 막히는지 지킨다.

```diff
--- a/order-api-nest/test/admin-only.e2e-spec.ts
+++ b/order-api-nest/test/admin-only.e2e-spec.ts
@@
   ["PATCH", "/categories/1"], ["DELETE", "/categories/1"],
   ["POST", "/products/1/image/upload-url"], ["POST", "/products/1/image/confirm"],
   ["POST", "/products/1/stock-adjustments"],
+  ["PATCH", "/products/1"],
 ] as const;
 
 describe("관리자 전용 API", () => {
```

이미지 교체(`06`의 `confirm`)도 `imageKey`를 바꾸므로 같은 줄을 더한다.

```diff
--- a/order-api-nest/src/products/product-images.controller.ts
+++ b/order-api-nest/src/products/product-images.controller.ts
@@
 import { EXTENSIONS, looksLike } from "./image-signature.js";
 import { ConfirmImageDto, UploadUrlDto } from "./product-image.dto.js";
 import { AdminGuard } from "../auth/admin.guard.js";
+import { CatalogCache } from "../cache/catalog-cache.js";
 
 export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 2 * 1024 * 1024); // 2MB
 const UPLOAD_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 60);
@@
   constructor(
     private readonly prisma: PrismaService,
     private readonly storage: StorageService,
+    private readonly cache: CatalogCache,
   ) {}
 
   @Post("upload-url")
@@
  @Post("confirm")
  async confirm(@Param("id", ParseIntPipe) id: number, @Body() dto: ConfirmImageDto) {
    ...
     }
     const before = await this.prisma.product.findUnique({ where: { id }, select: { imageKey: true } });
     await this.prisma.product.update({ where: { id }, data: { imageKey: dto.key } });
+    await this.cache.invalidate(); // 이미지 키는 카탈로그에 들어 있다
     if (before?.imageKey && before.imageKey !== dto.key) await this.storage.delete(before.imageKey);
     return { key: dto.key, imageUrl: await this.storage.createDownloadUrl(dto.key, 600) };
   }
```

재고를 바꾸는 곳은 캐시를 건드리지 않는다. 재고는 캐시에 없기 때문이다. 이 서비스에서 상품을 쓰는 곳을 모두 적으면 이렇다.

| 쓰는 곳 | 바꾸는 칸 | 카탈로그 캐시 |
|---|---|---|
| `02` 결제(`POST /orders/checkout`) | 재고 차감 | 그대로 둔다 |
| `14` 미결제 취소(24시간이 지난 결제 대기) | 재고 복구 | 그대로 둔다 |
| `22` 재고 입고·조정(`POST /products/:id/stock-adjustments`) | 재고 | 그대로 둔다 |
| `06` 이미지 확인(`POST /products/:id/image/confirm`) | `imageKey` | 지운다 |
| 이 문서의 관리자 수정(`PATCH /products/:id`) | 이름·가격(8장부터 설명도) | 지운다 |
| `21` 시드와 매일 초기화(`prisma db seed`, `deploy/ops/reset-demo.sh`) | 카탈로그 전부 | 시드 끝에서 지운다(작업 4) |
| 부하용 상품(`loadtest/load-seed.sql`을 psql로) | 상품 추가 | 지우지 않는다. 손으로 `DEL catalog` |

### 작업 4. [커밋] 시드와 매일 초기화도 캐시를 지운다

시드는 API를 거치지 않고 DB를 직접 바꾸는 쓰기다. `21`의 데모 서버는 매일 `reset-demo.sh`가 이 시드를 다시 돌린다. 시드가 캐시를 지우지 않으면 초기화 뒤 최대 60초 동안 초기화 전의 카탈로그가 보인다. 시드 끝에서 캐시 키를 지운다.

```diff
--- a/order-api-nest/prisma/seed.ts
+++ b/order-api-nest/prisma/seed.ts
@@
 import { readFile } from "node:fs/promises";
 import { PrismaPg } from "@prisma/adapter-pg";
+import { Redis } from "ioredis";
 import { PrismaClient } from "../src/generated/prisma/client.js";
 import { hashPassword } from "../src/auth/password.js";
 import { deleteUsers } from "../src/auth/demo-user.js";
 import { StorageService } from "../src/storage/storage.service.js";
+import { CATALOG_KEY } from "../src/cache/catalog-key.js";
 
 type Catalog = {
   categories: { id: number; name: string; parentId: number | null }[];
@@
   });
 }
 
+// 5. 카탈로그 캐시
+// 시드는 DB를 직접 바꾸므로 API의 무효화를 거치지 않는다. 서버의 매일 초기화(21의 reset-demo.sh)도 이 시드다
+let cacheCleared = "건너뜀(REDIS_URL 없음)";
+if (process.env.REDIS_URL) {
+  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 2000 });
+  try {
+    await redis.connect();
+    await redis.del(CATALOG_KEY);
+    cacheCleared = "지움";
+  } catch (err) {
+    cacheCleared = `못 지움(${(err as Error).message}, TTL이 지나면 사라진다)`; // 캐시 때문에 시드가 실패하지는 않게 한다
+  } finally {
+    redis.disconnect();
+  }
+}
+
 console.log(
   `seed 완료: 상품 ${catalog.products.length}개(사진 새로 올림 ${uploaded}장, 사진 없음 ${noPhoto.size}개), 임시 사용자 ${deletedTemp}명 삭제,`,
-  `사용자 ${await prisma.user.count()}명, 주문 ${await prisma.order.count()}건`,
+  `사용자 ${await prisma.user.count()}명, 주문 ${await prisma.order.count()}건, 카탈로그 캐시 ${cacheCleared}`,
 );
 await prisma.$disconnect();
```

Redis에 닿지 않아도 시드는 실패하지 않게 했다. 시드의 일은 DB를 맞추는 것이고, 캐시는 TTL이 지나면 어차피 사라진다. 그 대신 끝 줄에 지웠는지를 찍는다.

서버에서 시드를 돌리는 `migrate` 컨테이너에는 지금 `REDIS_URL`이 없다. 그대로 두면 서버의 초기화는 `건너뜀(REDIS_URL 없음)`을 찍고 지나간다. 같은 compose 안의 `redis` 서비스를 가리키게 한다.

```diff
--- a/deploy/compose.yml
+++ b/deploy/compose.yml
@@
     environment:
       DATABASE_URL: ${ADMIN_DATABASE_URL:?}
       DEMO_PASSWORD: ${DEMO_PASSWORD:-}
+      REDIS_URL: redis://redis:6379
       NODE_EXTRA_CA_CERTS: /certs/rds-ca.pem
       S3_ENDPOINT: ""
       S3_REGION: ${AWS_REGION:?}
```

`reset-demo.sh`는 고치지 않는다. 그 스크립트가 부르는 시드가 지운다.

### 작업 5. [커밋] 캐시의 약속을 테스트로 지킨다

e2e는 개발 서버와 같은 Redis를 쓴다. 키를 나눈다.

```diff
--- a/order-api-nest/test/setup-env.ts
+++ b/order-api-nest/test/setup-env.ts
@@
 process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
 
 if (!process.env.TEST_ADMIN_DATABASE_URL) throw new Error("TEST_ADMIN_DATABASE_URL이 없습니다");
process.env.ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL;
+
+// e2e는 개발 서버와 같은 Redis를 쓴다. 키를 나누지 않으면 테스트 DB의 상품이 개발 화면의 캐시에 들어간다
+process.env.CATALOG_CACHE_KEY = "test:catalog";
```

DB를 직접 바꾼 테스트는 캐시를 비운 뒤 읽는다. 이미 있는 테스트 중 상품을 넣고 목록을 읽는 곳이 하나 있다.

```diff
--- a/order-api-nest/test/pagination.e2e-spec.ts
+++ b/order-api-nest/test/pagination.e2e-spec.ts
@@
 import { JwtService } from "@nestjs/jwt";
 import { Test } from "@nestjs/testing";
 import { AppModule } from "../src/app.module.js";
+import { CatalogCache } from "../src/cache/catalog-cache.js";
 import { adminDb } from "./admin-db.js";
 
 describe("페이지네이션 - 회귀 테스트", () => {
@@
 
   it("상품: id 순으로, cursor는 마지막 상품의 id", async () => {
     await adminDb.product.createMany({ data: [1, 2, 3].map((i) => ({ name: `상품 ${i}`, price: 1000, stock: 1 })) });
+    await app.get(CatalogCache).invalidate(); // DB를 직접 바꿨으므로 캐시를 비운다
     const first = await get("/products", { limit: 2 });
     expect(first.body).toMatchObject({ items: [{ id: 1 }, { id: 2 }], nextCursor: 2 });
     const last = await get("/products", { limit: 2, cursor: 2 });
```

```ts
// order-api-nest/test/catalog-cache.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { CatalogCache } from "../src/cache/catalog-cache.js";
import { catalogLoads } from "../src/metrics/metrics.js";
import { adminDb } from "./admin-db.js";

// 카탈로그는 캐시에서, 재고는 DB에서. 카탈로그를 바꾸는 API는 캐시를 지운다
describe("카탈로그 캐시 - 회귀 테스트", () => {
  let app: INestApplication;
  let tokenOf: (role: string) => string;
  const list = () => request(app.getHttpServer()).get("/products").expect(200);
  const loads = async () => (await catalogLoads.get()).values[0]?.value ?? 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); // main.ts와 같게. 없으면 DTO 검사를 하지 않는다
    await app.init();
    tokenOf = (role) => app.get(JwtService, { strict: false }).sign({ sub: "kim", role });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김", role: "admin" } });
    const parent = await adminDb.category.create({ data: { name: "전자기기" } });
    const leaf = await adminDb.category.create({ data: { name: "키보드", parentId: parent.id } });
    await adminDb.product.create({ data: { name: "키보드", price: 1000, stock: 5, categoryId: leaf.id } }); // id 1
    await app.get(CatalogCache).invalidate(); // DB를 직접 바꿨으므로 앞 테스트가 채운 캐시를 비운다
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  it("두 번째 목록은 캐시에서 온다. DB의 가격을 직접 바꿔도 그대로다. 카테고리 경로가 붙는다", async () => {
    expect((await list()).body.items[0]).toMatchObject({ price: 1000, categoryPath: ["전자기기", "키보드"] });
    await adminDb.product.update({ where: { id: 1 }, data: { price: 9999 } });
    expect((await list()).body.items[0].price).toBe(1000);
  });

  it("재고는 캐시하지 않는다. 바뀐 재고가 바로 보인다", async () => {
    await list();
    await adminDb.product.update({ where: { id: 1 }, data: { stock: 2 } });
    expect((await list()).body.items[0].stock).toBe(2);
  });

  it("관리자가 수정하면 캐시를 지워 새 가격이 보인다. 재고는 받지 않는다", async () => {
    await list();
    await request(app.getHttpServer()).patch("/products/1").set("Authorization", `Bearer ${tokenOf("admin")}`).send({ price: 2000, stock: 0 }).expect(200);
    expect((await list()).body.items[0]).toMatchObject({ price: 2000, stock: 5 });
  });

  it("REST와 tRPC가 같은 캐시를 본다", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 20 }));
    await request(app.getHttpServer()).get(`/trpc/products.list?input=${input}`).expect(200); // tRPC가 채운다
    await adminDb.product.update({ where: { id: 1 }, data: { price: 9999 } });
    expect((await list()).body.items[0].price).toBe(1000); // REST가 그 값을 읽는다
  });

  it("비어 있는 칸을 동시에 50개가 읽어도 DB에서는 한 번만 읽는다(single-flight)", async () => {
    const before = await loads();
    await Promise.all(Array.from({ length: 50 }, () => list()));
    expect((await loads()) - before).toBe(1);
  });

  it("Redis에 닿지 않으면 DB에서 읽어 바로 응답한다(fail-open)", async () => {
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:1"; // 아무것도 듣지 않는 포트
    const broken = new CatalogCache();
    process.env.REDIS_URL = saved;
    const start = Date.now();
    expect(await broken.getOrLoad("x", async () => "from-db")).toBe("from-db");
    expect(Date.now() - start).toBeLessThan(1000);
    await broken.onModuleDestroy();
  });
});
```

```sh
# order-api-nest/에서
npx vitest run --config ./vitest.config.e2e.ts test/catalog-cache.e2e-spec.ts test/admin-only.e2e-spec.ts test/pagination.e2e-spec.ts test/trpc.e2e-spec.ts

# 출력(줄임)
 Test Files  4 passed (4)
      Tests  32 passed (32)
```

### 작업 6. [실행] 다시 빌드해 띄우고 캐시를 들여다본다

API를 다시 빌드해 띄운다(1장 작업 2의 터미널 2). 그다음 목록을 두 번 부르고 지표와 Redis를 본다.

```sh
# 저장소 루트에서
curl -s -o /dev/null localhost:4000/products && curl -s -o /dev/null localhost:4000/products
curl -s localhost:4000/metrics | grep '^catalog_'
# 출력
catalog_cache_requests_total{result="miss"} 1
catalog_cache_requests_total{result="hit"} 1
catalog_loads_total 1

docker compose exec redis redis-cli HKEYS catalog
# 1) "list:0:20"
docker compose exec redis redis-cli TTL catalog
# (integer) 57
```

첫 요청은 빗나가 DB에서 카탈로그를 읽었고(`catalog_loads_total 1`), 두 번째는 캐시에서 왔다. `TTL`은 남은 초다. 지표가 하나도 찍히지 않으면 API가 이 작업의 코드로 다시 빌드되지 않은 것이다(`grep`이 아무것도 거르지 못한다).

> 1장에서 넣은 부하용 상품이나 시드를 다시 넣으면, 이제부터는 넣은 뒤 `docker compose exec redis redis-cli DEL catalog`를 한다. `load-seed.sql`은 DB를 직접 바꾸고, 시드는 스스로 지우지만 끝 줄에 `카탈로그 캐시 지움`이 찍히는지 본다.

### 용어 | Redis·ioredis API

- `HSET key field value` / `HGET key field` / `HKEYS key`: 해시 한 키 안의 칸에 쓰고, 읽고, 칸 이름을 모두 본다
- `EXPIRE key seconds NX`: 만료가 없을 때만 건다(Redis 7)
- `TTL key`: 남은 초. 키가 없으면 `-2`, 만료가 없으면 `-1`
- `MULTI … EXEC`: 명령 여럿을 한 번에 보내 차례로 실행한다. ioredis에서는 `redis.multi().hset(…).expire(…).exec()`
- `new Redis(url, { enableOfflineQueue, maxRetriesPerRequest, commandTimeout })`: 6장에서 다룬다

### 남길 것

- **찾아보면 되는 것**: `HSET`/`HGET`/`HKEYS`, `EXPIRE … NX`, ioredis의 `multi().….exec()`, 재귀 CTE 문법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 캐시할 것은 "얼마나 자주 바뀌는가"로 나눈다. 비싼 조립(카탈로그)은 캐시하고, 자주 바뀌는 싼 조회(재고)는 매번 읽는다.

  - 무효화 단위를 크게 잡으면(해시 하나) 어느 페이지에 있는지 따지지 않고 `DEL` 한 번으로 끝난다. 그 데이터를 바꾸는 곳만 지운다.

  - 쓰는 곳을 표로 적으면 빠진 곳이 보인다. API를 거치지 않는 쓰기(시드, 매일 초기화, psql로 넣은 데이터)가 가장 잘 빠진다. 테스트와 개발이 같은 Redis를 쓰면 키를 나눈다.

- **에러 신호**:

  - 시드나 `load-seed.sql`을 넣었는데 옛 목록이 보인다 → 시드 끝 줄의 `카탈로그 캐시 …`, psql로 넣었으면 `redis-cli DEL catalog`

  - 테스트 DB의 상품이 개발 화면에 보인다 → `test/setup-env.ts`의 `CATALOG_CACHE_KEY`

  - `Property 'catalogCache' is missing` → 컨텍스트를 직접 만드는 곳(`test/trpc.e2e-spec.ts`)에 `catalogCache`를 넣었는지

  - `curl …/metrics | grep '^catalog_'`가 아무것도 찍지 않는다 → API를 다시 빌드해 띄웠는지

  - 지표에서 `hit`이 늘지 않고 `miss`만 는다 → 누군가 계속 지우고 있다

## 3. 2단계: 일부러 바꿔보기, 재고까지 통째로 캐시한다

### 작업 1. [커밋] 목록과 결제를 섞은 k6 시나리오

`loadtest/browse.js`는 목록을 보는 사람과 결제하는 사람을 함께 돌린다. 결제는 부하용 상품 50개에 흩어진다.

```js
// order-api-nest/loadtest/browse.js
// 상품 목록을 보는 사람과 결제하는 사람이 섞인 부하. 카탈로그 캐시의 적중률과 목록의 처리량을 잰다
//   -e BROWSERS=20 : 목록을 보는 가상 사용자 수 / -e BUYERS=5 : 결제하는 가상 사용자 수
import http from "k6/http";
import { check } from "k6";

const API = __ENV.API ?? "http://api:4000";
const DURATION = __ENV.DURATION ?? "20s";

export const options = {
  scenarios: {
    browse: { executor: "constant-vus", vus: Number(__ENV.BROWSERS ?? 20), duration: DURATION, exec: "browse" },
    buy: { executor: "constant-vus", vus: Number(__ENV.BUYERS ?? 5), duration: DURATION, exec: "buy" },
  },
  // 이름(name 태그)별 요청 수와 지연을 요약에 따로 찍으려고 건다. 기준은 넉넉히 잡아 측정이 끝까지 돌게 한다
  thresholds: {
    "http_req_duration{name:list}": ["p(95)<1000"],
    "http_reqs{name:list}": ["count>0"],
    "http_reqs{name:checkout}": ["count>0"],
    // 요청 수만 세면 결제가 모두 실패해도(401, 500) 통과한다. 응답이 맞는지(check)도 99%를 넘어야 한다
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ id: "kim", password: "1234" }), { headers: { "Content-Type": "application/json" } });
  // 준비가 틀렸으면 재지 않고 멈춘다. setup에서 던지면 k6는 시나리오를 돌리지 않는다
  if (res.status !== 200) throw new Error(`kim으로 로그인하지 못했다(${res.status})`);
  // 결제할 상품은 이름으로 찾는다. 시드를 다시 돌리면 부하용 상품의 id가 밀린다(checkout.js와 같은 방법)
  const loadIds = [];
  for (let cursor = null; ;) {
    const page = http.get(`${API}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`).json();
    loadIds.push(...page.items.filter((p) => p.name.startsWith("부하용 상품") && p.stock > 0).map((p) => p.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  if (loadIds.length === 0) throw new Error("부하용 상품이 없다. loadtest/load-seed.sql을 넣었는지 본다");
  return { token: res.json("accessToken"), loadIds };
}

export function browse() {
  const res = http.get(`${API}/products`, { tags: { name: "list" } });
  check(res, { "목록 200": (r) => r.status === 200 });
}

export function buy(data) {
  const productId = data.loadIds[Math.floor(Math.random() * data.loadIds.length)];
  const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: [{ productId, quantity: 1 }] }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
    tags: { name: "checkout" },
  });
  check(res, { "결제 201": (r) => r.status === 201 });
}
```

임계값 `count>0`은 요청이 나갔는지만 본다. 로그인이 실패하면(토큰 없음) 결제는 모두 401이고, 부하용 상품이 없으면 `loadIds`가 비어 `productId`가 `undefined`라 결제가 모두 400이다. 그래도 요청 수는 0보다 크므로 스크립트는 통과로 끝나고, 적중률 표에는 결제 없이 잰 값이 들어간다. 그래서 두 겹으로 막는다. 준비(로그인, 부하용 상품)가 틀렸으면 `setup`에서 던져 재지 않는다. 돌다가 결제가 실패하면(시뮬레이터가 꺼져 500) `checks: ["rate>0.99"]`가 실패로 끝낸다. 이때도 요약은 끝까지 찍히므로, 실패하면 숫자를 표에 옮기지 말고 원인부터 본다.

### 작업 2. [확인] 카탈로그만 캐시한 지금 코드로 기준선을 잰다

잴 때마다 같은 조건으로 시작한다. 부하용 상품의 재고는 넉넉하므로(100만) 시드는 다시 넣지 않는다. 캐시와 쿼리 통계를 0부터 세고, API를 다시 띄워(지표가 0부터 센다) 돌린다.

```sh
# order-api-nest/에서
docker compose -f ../compose.yaml exec -T redis redis-cli DEL catalog
# 0
docker compose -f ../compose.yaml exec -T db psql -q -U order -d order_api -c "SELECT pg_stat_statements_reset()"
# 출력
   pg_stat_statements_reset    
-------------------------------
 2026-02-14 13:35:28.343944+00

docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e API=http://host.docker.internal:4000 -e BUYERS=20 /scripts/browse.js
# 출력(줄임)
  █ THRESHOLDS 
    checks
    ✓ 'rate>0.99' rate=100.00%
    http_req_duration{name:list}
    ✓ 'p(95)<1000' p(95)=79.18ms
    http_reqs{name:checkout}
    ✓ 'count>0' count=2590
    http_reqs{name:list}
    ✓ 'count>0' count=7069

curl -s localhost:4000/metrics | grep '^catalog_'
# 출력
catalog_cache_requests_total{result="miss"} 21
catalog_cache_requests_total{result="hit"} 7049
catalog_loads_total 2

docker compose -f ../compose.yaml exec -T db psql -U order -d order_api -c "SELECT calls, left(regexp_replace(query, '\s+', ' ', 'g'), 70) AS query FROM pg_stat_statements WHERE query ~* 'products|categories' ORDER BY calls DESC LIMIT 6"
# 출력
 calls |                                query                                 
-------+------------------------------------------------------------------------
  7070 | SELECT "public"."products"."id", "public"."products"."stock" FROM "pub
     2 | SELECT "public"."products"."id", "public"."products"."name", "public".
     2 |  WITH RECURSIVE up AS ( SELECT id AS leaf, id, name, parent_id, 0 AS d
(3 rows)
```

k6는 컨테이너 안에서 돌므로 `localhost`는 컨테이너 자신이다. 이 PC의 API에는 `host.docker.internal`로 닿는다. Docker Desktop(macOS)에서는 `--network host`를 줘도 설정에서 host 네트워킹을 켜지 않았으면 `localhost:4000`이 `connection refused`라, 그 방법은 쓰지 않는다. `--add-host=host.docker.internal:host-gateway`는 Linux에서도 같은 이름이 이 PC를 가리키게 한다.

`-v "$PWD/loadtest:/scripts"`는 `order-api-nest/`에서 쳐야 한다. 다른 폴더에서 치면 Docker가 빈 폴더를 만들어 붙이고 k6가 `browse.js`를 찾지 못한다.

결제하는 사람이 적을 때와도 비교하려면 `-e BUYERS=20`을 `-e BUYERS=5`로 바꿔 한 번 더 돈다. 아래 개념의 표 두 개가 그 두 경우다.

`catalog_loads_total`이 2인 것은 `setup`이 부하용 상품을 찾으려고 부른 `?limit=100`이 다른 칸(`list:0:100`)이라서다. 목록 칸(`list:0:20`)은 20초 동안 한 번 읽었다. `WITH RECURSIVE` 줄의 `calls 2`도 같은 두 번이다.

결과에서 세 가지를 읽는다. k6 요약의 `http_reqs{name:list}`(목록 요청 수)와 `http_req_duration{name:list}`의 `p(95)`, 지표의 hit·miss(적중률 = hit / 전체), `pg_stat_statements`에서 `WITH RECURSIVE`로 시작하는 줄의 `calls`(카탈로그를 DB에서 조립한 횟수)다.

### 실험 | 캐시를 거치지 않는다

비교할 첫 경우는 캐시가 없는 것이다. `git status`가 깨끗한지 보고 시작한다.

```diff
--- a/order-api-nest/src/products/product-list.ts
+++ b/order-api-nest/src/products/product-list.ts
@@
 
 // REST(GET /products)와 tRPC(products.list)가 함께 부른다 → 같은 캐시를 본다
 export async function listProducts(deps: ProductDeps, page: { limit: number; cursor?: number | null }) {
-  const catalog = await deps.cache.getOrLoad(`list:${page.cursor ?? 0}:${page.limit}`, () => loadCatalogPage(deps.prisma, page));
+  const catalog = await loadCatalogPage(deps.prisma, page); // 바꿔보기: 캐시를 거치지 않는다
   // 재고만 그 페이지의 id로 매번 읽는다. 기본키 조회라 싸다
   const stocks = await deps.prisma.product.findMany({ where: { id: { in: catalog.items.map((p) => p.id) } }, select: { id: true, stock: true } });
   const stockOf = new Map(stocks.map((s) => [s.id, s.stock]));
```

API를 다시 빌드해 띄우고, 작업 2의 명령을 그대로 친다. 다 쟀으면 되돌린다.

```sh
# 저장소 루트에서
git restore order-api-nest/src/products/product-list.ts
```

### 실험 | 재고까지 통째로 캐시하고 결제마다 지운다

처음 떠올리는 캐시는 응답을 통째로 넣는 것이다. 그러면 재고가 바뀔 때마다 지워야 한다. `listProducts`가 재고까지 넣은 페이지를 캐시하게 바꾸고, 결제가 재고를 줄일 때마다 `invalidate()`를 부른다.

```diff
--- a/order-api-nest/src/orders/orders.service.ts
+++ b/order-api-nest/src/orders/orders.service.ts
@@
 import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";
 import { StripeGateway } from "../payments/stripe.gateway.js";
 import { afterOrder, encodeOrderCursor, orderListOrder, toPage, type Page } from "../pagination/cursor.js";
+import { CatalogCache } from "../cache/catalog-cache.js";
 
 export type Order = { id: number; user: string; price: number; paid: boolean; }
 export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };
@@
     private readonly prisma: PrismaService,
     private readonly notifications: NotificationsGateway,
     private readonly stripe: StripeGateway,
+    private readonly cache: CatalogCache,
   ) {}
 
   async list(query: { limit: number; cursor?: string; offset?: number; paid?: boolean }): Promise<Page<Order & { createdAt: Date }>> {
@@
 
   async checkout(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResponse> {
     const placed = await this.placeOrReplay(userId, items, idempotencyKey);
+    await this.cache.invalidate(); // 바꿔보기: 재고를 줄였으니 통째로 캐시한 목록을 지운다
     const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");
     try {
       const session = await this.stripe.createCheckoutSession(placed, attemptKey);
```

```diff
--- a/order-api-nest/src/products/product-list.ts
+++ b/order-api-nest/src/products/product-list.ts
@@
 
 // REST(GET /products)와 tRPC(products.list)가 함께 부른다 → 같은 캐시를 본다
 export async function listProducts(deps: ProductDeps, page: { limit: number; cursor?: number | null }) {
-  const catalog = await deps.cache.getOrLoad(`list:${page.cursor ?? 0}:${page.limit}`, () => loadCatalogPage(deps.prisma, page));
-  // 재고만 그 페이지의 id로 매번 읽는다. 기본키 조회라 싸다
-  const stocks = await deps.prisma.product.findMany({ where: { id: { in: catalog.items.map((p) => p.id) } }, select: { id: true, stock: true } });
+  // 바꿔보기: 재고까지 넣은 페이지를 통째로 캐시한다
+  const catalog = await deps.cache.getOrLoad(`list:${page.cursor ?? 0}:${page.limit}`, async () => {
+    const c = await loadCatalogPage(deps.prisma, page);
+    const st = await deps.prisma.product.findMany({ where: { id: { in: c.items.map((p) => p.id) } }, select: { id: true, stock: true } });
+    return { ...c, stocks: st };
+  });
+  const stocks = catalog.stocks;
   const stockOf = new Map(stocks.map((s) => [s.id, s.stock]));
   const items = await Promise.all(
     catalog.items.map(async ({ imageKey, ...p }) => ({
```

API를 다시 빌드해 띄우고, 작업 2의 명령을 그대로 친다.

### 작업 3. [원복] 바꿔보기 코드를 되돌린다

```sh
# 저장소 루트에서
git restore order-api-nest/src/products/product-list.ts order-api-nest/src/orders/orders.service.ts
git status --short
```

`git status --short`가 아무것도 찍지 않으면 실험 전과 같다. API를 다시 빌드해 띄운다. 실험을 건너뛰었어도 이 명령은 실패하지 않는다.

### 개념 | 결제하는 사람이 5명일 때

| 경우 | 캐시 적중률 | 목록 요청(20초) | 목록 p95 | 카탈로그를 DB에서 읽은 횟수 | 결제 |
|---|---|---|---|---|---|
| 캐시 없음 | - | 9,223 | 60ms | 9,224 | 1,074 |
| 통째로 캐시 | 49.6% | 30,748 | 22ms | 776 | 1,728 |
| 카탈로그만 캐시 | 99.9% | 18,562 | 31ms | 2 | 914 |

`-e BUYERS=5`로 잰 값이다. "카탈로그를 DB에서 읽은 횟수"에는 `setup`이 부른 `?limit=100` 한 번이 들어 있다. 결제가 드물면 통째로 캐시한 쪽이 가장 빠르다. 재고를 따로 읽는 쿼리가 없기 때문이다. 그런데 결제하는 사람이 겨우 5명인데 적중률이 이미 절반이다.

### 개념 | 결제하는 사람이 20명일 때

| 경우 | 캐시 적중률 | 목록 요청(20초) | 목록 p95 | 카탈로그를 DB에서 읽은 횟수 | 결제 |
|---|---|---|---|---|---|
| 캐시 없음 | - | 3,256 | 166ms | 3,257 | 2,973 |
| 통째로 캐시 | 22.2% | 5,495 | 114ms | 214 | 3,409 |
| 카탈로그만 캐시 | 99.7% | 7,069 | 79ms | 2 | 2,590 |

결제가 늘자 통째로 캐시한 쪽의 적중률이 22%로 떨어졌다. 결제 3,409건이 캐시를 3,409번 지웠고, 그 사이사이에 목록 요청이 빈 캐시를 만났다. 목록 처리량은 캐시 없음보다 낫지만 카탈로그만 캐시한 쪽에 못 미친다. **통째로 캐시한 쪽의 효과는 쓰기 빈도에 달려 있고, 쓰기는 읽기가 몰리는 순간(할인, 한정판)에 함께 몰린다.**

카탈로그만 캐시한 쪽은 결제가 5명이든 20명이든 적중률이 99%를 넘는다. DB에서 카탈로그(재귀 CTE 포함)를 읽은 것은 20초 동안 두 번이고, 그중 하나는 `setup`의 `?limit=100`이다. 목록 칸은 한 번 읽었다. 대신 목록마다 재고를 기본키로 한 번 읽는다. 비싼 조립은 한 번, 싼 조회는 매번이다.

> "카탈로그를 DB에서 읽은 횟수"가 빗나간 수보다 훨씬 적은 것은 5장의 single-flight 때문이다. 캐시가 빈 순간 몰린 요청들이 한 번의 읽기를 함께 기다린다.

### 개념 | 통째로 캐시하면 재고도 틀린다

캐시를 지우는 것은 결제가 커밋된 뒤다. 그 사이에 다른 목록 요청이 DB에서 옛 재고를 읽어 캐시에 넣는 중이었다면, 지운 직후에 옛 재고가 다시 들어간다. 이 값은 다음 결제가 지울 때까지 남는다. 품절인데 재고 1이 보이면 결제가 409로 돌아온다. 카탈로그만 캐시하면 재고는 언제나 DB에서 읽은 그 순간의 값이다.

### 남길 것

- **찾아보면 되는 것**: k6의 여러 시나리오(`scenarios`·`exec`), `pg_stat_statements`에서 쿼리별 `calls`를 보는 쿼리. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 응답을 통째로 캐시하면 수명은 가장 자주 바뀌는 칸이 정한다. 쓰기가 드물 때는 가장 빠르지만, 쓰기는 읽기가 몰리는 순간에 함께 몰린다.

  - 지우는 것과 다시 채우는 것이 겹치면 지운 직후에 옛 값이 다시 들어간다. 자주 바뀌는 값은 캐시에 두지 않는 것이 가장 단순한 해법이다.

- **에러 신호**:

  - 결제가 늘자 캐시 적중률이 크게 떨어진다 → 자주 바뀌는 칸(재고)까지 캐시하고 쓰기마다 지우고 있다

  - 품절인데 재고 1이 보이고 결제가 409로 돌아온다 → 재고를 캐시했다. 지운 직후 옛 재고가 다시 들어갔다

  - k6가 `browse.js`를 찾지 못한다(`no such file or directory`) → `order-api-nest/`에서 쳤는지(`$PWD/loadtest`)

  - `Error: kim으로 로그인하지 못했다(401)` → 시드를 넣었는지, API의 `DEMO_PASSWORD`가 `1234`인지

  - `Error: kim으로 로그인하지 못했다(0)` → k6가 API에 닿지 않았다. `-e API=http://host.docker.internal:4000`과 `--add-host`를 줬는지(`localhost`는 컨테이너 자신이다)

  - `Error: 부하용 상품이 없다. loadtest/load-seed.sql을 넣었는지 본다` → 1장 작업 2의 `load-seed.sql`

  - `thresholds on metrics 'checks' have been crossed`, 요약의 `✗ 결제 201` → 결제가 실패했다. Stripe 시뮬레이터(터미널 1)가 떠 있는지, API를 `STRIPE_SIMULATOR_URL`과 함께 띄웠는지

## 4. 3단계: 일부러 깨뜨려보기 ①, 무효화 하나를 빠뜨린다

### 실험 | 관리자 수정 API에서 무효화를 뺀다

관리자 수정 API에서 `await this.cache.invalidate();`를 주석 처리한다.

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
   async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
     const { count } = await this.prisma.product.updateMany({ where: { id }, data: dto });
     if (count === 0) throw new NotFoundException(`product ${id} not found`);
-    await this.cache.invalidate(); // DB에 쓴 뒤에 지운다. 먼저 지우면 그 사이에 옛 값이 다시 채워질 수 있다
+    // await this.cache.invalidate(); // DB에 쓴 뒤에 지운다. 먼저 지우면 그 사이에 옛 값이 다시 채워질 수 있다
     return this.prisma.product.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, price: true } });
   }
 }
```

API를 다시 빌드해 띄우고 마우스(상품 6)의 가격을 바꿔 본다. 토큰은 kim으로 로그인해 받는다.

```sh
# 저장소 루트에서
T=$(curl -s localhost:4000/auth/login -H 'content-type: application/json' -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
curl -s 'localhost:4000/products?limit=6' | jq -c '.items[-1] | {name, price}'
curl -s -X PATCH localhost:4000/products/6 -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"price":25000}'
echo
curl -s 'localhost:4000/products?limit=6' | jq -c '.items[-1] | {name, price}'
docker compose exec redis redis-cli TTL catalog
```

```text
# 출력
{"name":"마우스","price":30000}
{"id":6,"name":"마우스","price":25000}
{"name":"마우스","price":30000}
(integer) 54
```

API는 25,000원을 저장했다고 답했지만 목록은 30,000원이다. `TTL`만큼(최대 60초) 옛 가격이 보인다. 결제 금액은 DB의 가격으로 계산하므로(`02`) 화면의 가격과 결제 금액이 달라진다.

TTL이 있어 틀린 값은 언젠가 사라진다. TTL은 무효화를 잊었을 때의 안전망이고, 그 길이가 "틀린 값을 얼마나 참을 수 있는가"다.

확인했으면 되돌리고 가격도 시드 값으로 돌린다.

```sh
# 저장소 루트에서
git restore order-api-nest/src/products/products.controller.ts
```

API를 다시 빌드해 띄운 뒤 가격을 되돌린다.

```sh
# 저장소 루트에서
curl -s -X PATCH localhost:4000/products/6 -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"price":30000}'
```

토큰은 15분짜리다(`ACCESS_TOKEN_TTL`). 401이 오면 위의 `T=$(…)` 줄을 다시 친다.

### 남길 것

- **찾아보면 되는 것**: `redis-cli TTL`, `jq -c`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - TTL은 무효화를 잊었을 때의 안전망이다. 그 길이가 "틀린 값을 얼마나 참을 수 있는가"다.

- **에러 신호**:

  - API는 새 가격을 저장했다고 답하는데 목록은 옛 가격 → 그 쓰기 경로에서 `cache.invalidate()`를 부르는지. `redis-cli TTL catalog`가 남은 시간이다

## 5. 4단계: 일부러 깨뜨려보기 ②, 캐시가 비는 순간

### 작업 1. [커밋] 캐시가 비는 순간을 만드는 cache-stampede.mjs

TTL이 끝나는 순간 캐시는 빈다. 그때 몰린 요청은 모두 빈 캐시를 보고 각자 DB로 간다. 이 스크립트는 캐시 키를 지우고(TTL이 끝난 것과 같다) 목록 요청 200개를 동시에 보낸 뒤, 지표 `catalog_loads_total`이 얼마나 늘었는지 본다. `scripts/stampede.mjs`(`02`의 동시 결제)와는 다른 파일이다.

```js
// order-api-nest/scripts/cache-stampede.mjs
// 카탈로그 캐시가 비는 순간(TTL이 끝난 것과 같다) 목록 요청 N개가 한꺼번에 오면 DB를 몇 번 읽는가
//   node scripts/cache-stampede.mjs [요청 수, 기본 200]
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
```

경로 주석은 저장소 루트 기준이다. 편집기에서 `order-api-nest/scripts/` 폴더(`stampede.mjs`가 있는 곳)에 만든다. 터미널이 `order-api-nest/`에 있을 때 그 경로를 그대로 붙이면 `order-api-nest/order-api-nest/scripts/`에 생기고, 아래 명령이 `Cannot find module`로 멈춘다.

지금 코드(single-flight가 있다)로 두 번 돌린다.

```sh
# order-api-nest/에서
node scripts/cache-stampede.mjs
# 출력
요청 200개: 200개 200, 596ms
DB에서 카탈로그를 읽은 횟수: 1

node scripts/cache-stampede.mjs
# 출력
요청 200개: 200개 200, 504ms
DB에서 카탈로그를 읽은 횟수: 1
```

### 실험 | single-flight를 빼고 200개를 보낸다

`getOrLoad`에서 `inflight`를 보는 두 줄을 주석 처리한다.

```diff
--- a/order-api-nest/src/cache/catalog-cache.ts
+++ b/order-api-nest/src/cache/catalog-cache.ts
@@
       return cached as T;
     }
     catalogCacheRequests.inc({ result: cached === ERROR ? "error" : "miss" }); // 한 요청은 셋 중 하나로만 센다
-    const running = this.inflight.get(field);
-    if (running) return running as Promise<T>;
+    // const running = this.inflight.get(field);
+    // if (running) return running as Promise<T>;
     const loading = (async () => {
       catalogLoads.inc();
       const value = await load();
```

API를 다시 빌드해 띄운 뒤 같은 스크립트를 두 번 돌린다.

```text
# 출력(single-flight 없음)
요청 200개: 200개 200, 742ms
DB에서 카탈로그를 읽은 횟수: 111
요청 200개: 200개 200, 611ms
DB에서 카탈로그를 읽은 횟수: 92
```

200개 중 100개 안팎이 각자 DB에서 같은 카탈로그를 조립했다. 첫 요청이 DB에서 돌아와 캐시를 채우기 전에 도착한 요청은 모두 빈 캐시를 본다. 카탈로그 조립이 몇 초짜리 쿼리였다면 DB가 그 순간 같은 쿼리 100개를 받는다.

`inflight`는 "지금 이 칸을 DB에서 읽고 있는 Promise"를 담는 `Map`이다. 빈 캐시를 본 요청은 먼저 `inflight`를 보고, 이미 누가 읽는 중이면 그 Promise를 같이 기다린다. `05`에서 refresh 요청을 하나로 묶은 것(`lib/api-client.ts`의 `refreshing`)과 같은 방법이다.

### 작업 2. [원복] single-flight를 되돌린다

```sh
# 저장소 루트에서
git restore order-api-nest/src/cache/catalog-cache.ts
```

API를 다시 빌드해 띄우고 `node scripts/cache-stampede.mjs`(`order-api-nest/`에서)가 다시 `1`을 찍는지 본다.

> single-flight는 프로세스 안에서만 묶는다. API를 세 대 띄우면 DB 읽기는 세 번이다. 서버 수만큼이라 감당할 수 있다고 보고 여기서 멈춘다. 여러 대를 하나로 묶으려면 Redis의 `SET NX`로 "읽는 중" 표시를 하거나, 만료 전에 미리 다시 채운다.

### 남길 것

- **찾아보면 되는 것**: `catalog_loads_total` 지표를 읽는 법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 캐시가 비는 순간 몰린 요청은 각자 DB로 간다. 읽는 중인 Promise를 함께 기다리게 하면(single-flight) 한 번으로 줄어든다.

  - single-flight는 프로세스 안에서만 묶는다. 서버가 N대면 N번이다.

- **에러 신호**:

  - 캐시를 비운 뒤 요청 200개에 `catalog_loads_total`이 100 안팎 늘어난다 → `getOrLoad`가 `inflight`를 보는지

  - `Error: Cannot find module '…/order-api-nest/scripts/cache-stampede.mjs'` → 파일이 `order-api-nest/scripts/`에 있는지(`order-api-nest/order-api-nest/scripts/`에 만들지 않았는지), `order-api-nest/`에서 쳤는지

## 6. 5단계: 일부러 깨뜨려보기 ③, Redis가 죽는다

### 실험 | ioredis 기본값으로 Redis를 멈춘다

cache-aside의 장점은 캐시가 죽어도 DB로 돈다는 것이다. 그렇게 짰는지 확인한다. 캐시용 연결을 ioredis 기본값으로 바꾼다.

```diff
--- a/order-api-nest/src/cache/catalog-cache.ts
+++ b/order-api-nest/src/cache/catalog-cache.ts
@@
 export class CatalogCache implements OnModuleDestroy {
   private readonly logger = new Logger(CatalogCache.name);
   // 캐시용 연결은 기다리지 않고 실패한다(5단계). Socket.IO 어댑터·BullMQ 연결은 기본값(다시 붙을 때까지 기다림) 그대로 둔다
-  private readonly redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 100 });
+  private readonly redis = new Redis(process.env.REDIS_URL!); // 바꿔보기: ioredis 기본값
   // 지금 DB에서 읽고 있는 칸. 빈 칸을 동시에 본 요청들이 이 Promise 하나를 함께 기다린다(single-flight, 4단계)
   private readonly inflight = new Map<string, Promise<unknown>>();
 
```

API를 다시 빌드해 띄운 뒤 Redis를 멈춘다.

```sh
# 저장소 루트에서
curl -s -o /dev/null -w 'redis 켜짐: %{http_code} %{time_total}s\n' localhost:4000/products
docker compose stop redis
curl -s -o /dev/null -m 30 -w 'redis 멈춤: %{http_code} %{time_total}s\n' localhost:4000/products
docker compose start redis
```

```text
# 출력(ioredis 기본값)
redis 켜짐: 200 0.043976s
redis 멈춤: 000 30.002691s
```

`read`에 `try/catch`가 있는데도 목록이 30초 넘게 응답하지 않았다(curl이 30초에 포기해 `000`). 예외가 나지 않았기 때문이다. ioredis는 연결이 끊기면 명령을 오프라인 큐에 쌓아 두고, 다시 붙으면 보낸다. 다시 붙을 때까지 재시도하므로 `hget`의 Promise가 끝나지 않는다. **캐시를 위해 쓴 코드가 목록 전체를 멈춘 것이다.**

### 작업 1. [원복] 캐시용 연결 옵션을 되돌리고 Redis를 다시 멈춰 본다

```sh
# 저장소 루트에서
git restore order-api-nest/src/cache/catalog-cache.ts
```

API를 다시 빌드해 띄운 뒤 같은 상황을 만든다. 실험을 건너뛰었다면 여기서 처음 재는 것이다.

```sh
# 저장소 루트에서
docker compose stop redis
for i in 1 2 3; do curl -s -o /dev/null -m 30 -w 'redis 멈춤: %{http_code} %{time_total}s\n' localhost:4000/products; done
curl -s localhost:4000/metrics | grep '^catalog_'
curl -s localhost:4000/health/ready; echo
docker compose start redis
```

```text
# 출력
redis 멈춤: 200 0.080226s
redis 멈춤: 200 0.010340s
redis 멈춤: 200 0.008819s
catalog_cache_requests_total{result="error"} 3
catalog_loads_total 3
{"status":"fail","checks":{"db":"ok","redis":"1000ms 초과","storage":"ok"}}
```

Redis가 없는 동안 목록은 DB에서 읽어 10ms 안팎에 응답한다. 다시 켜면 다음 요청부터 캐시를 쓴다. `/health/ready`는 Redis가 없으니 503이다. "일은 하지만 정상은 아니다"를 알리는 것은 그쪽의 일이다(`07`). `redis` 칸의 사유는 연결 상태에 따라 다른 글자가 나올 수 있다.

지표가 `error`와 `miss`를 함께 세지 않는 것은 `read`가 `MISS`와 `ERROR` 두 `Symbol` 중 하나를 돌려주기 때문이다. `read`가 오류에 `undefined`를 돌려주면 `getOrLoad`가 그것을 빗나감으로 또 센다. 한 요청은 셋(hit·miss·error) 중 하나로만 센다.

### 용어 | ioredis 옵션

- `enableOfflineQueue: false`: 연결이 없을 때 명령을 쌓지 않고 바로 실패한다. 기본값 `true`
- `maxRetriesPerRequest: 0`: 연결이 끊긴 명령을 다시 보내지 않는다. 기본값 20
- `commandTimeout: 100`: 연결은 됐는데 응답이 없을 때 100ms 뒤에 실패한다. 기본값은 없음

> Socket.IO 어댑터(`src/redis/redis-io.adapter.ts`)와 BullMQ 큐(`04`)는 기본값 그대로 둔다. 그쪽은 다시 붙을 때까지 기다렸다가 이어서 보내는 것이 맞는 동작이다. 같은 Redis라도 쓰는 목적에 따라 연결 설정이 다르다. `21`의 요청 수 제한(`src/rate-limit/`)도 Redis에 닿지 않으면 세지 않고 통과시킨다(fail-open). 이 PC에서는 제한 값(`RATE_LIMIT_PER_MINUTE`)이 없어 그 코드까지 가지 않는다.

### 남길 것

- **찾아보면 되는 것**: ioredis의 `enableOfflineQueue`·`maxRetriesPerRequest`·`commandTimeout`과 그 기본값. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `try/catch`가 있어도 예외가 나지 않으면 소용없다. 캐시용 연결은 "기다리지 말고 실패하라"로 둔다. 같은 Redis라도 큐·어댑터 연결은 기다리는 것이 맞다.

- **에러 신호**:

  - Redis를 멈추자 `GET /products`가 30초 넘게 응답하지 않는다(`000`) → 캐시 연결이 ioredis 기본값인지

  - `catalog_cache_requests_total{result="error"}`가 는다 → Redis에 닿지 않는다. 목록은 DB로 돌고 있다

## 7. 6단계: 이미 켜져 있는 Next 서버 캐시를 읽는다

### 개념 | 이 앱의 Next는 이미 Cache Components 모드다

지금까지 화면은 데이터를 브라우저에서 TanStack Query로 받았다(`05`). 서버 쪽 캐시는 여기서 처음 다룬다. 다만 켜는 설정은 이미 들어와 있다.

```ts
// order-console-next/next.config.ts (지금 코드, 읽기만)
  cacheComponents: true,
  partialPrefetching: true,
```

```tsx
// order-console-next/app/layout.tsx (지금 코드, 읽기만)
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
```

Cache Components를 켜면 `"use cache"`로 표시한 함수·컴포넌트의 결과를 Next 서버가 요청 사이에 캐시한다. 그리고 Next는 페이지마다 빌드 때 미리 그릴 수 있는 부분(정적 셸)을 찾는다. 요청이 와야 알 수 있는 것(`cookies()`, `connection()` 등)은 `<Suspense>` 안에 두라고 요구하고, 그러면 정적 셸을 먼저 보내고 나머지를 이어서 흘려보낸다(부분 사전 렌더링).

이 앱은 루트 레이아웃에서 `await connection()`으로 모든 페이지를 요청마다 그린다. CSP의 nonce(`08`) 때문이다. nonce는 요청마다 새로 만드는 값이라(`proxy.ts`) 빌드 때 만든 정적 셸의 스크립트에는 넣을 수 없다. 루트 레이아웃의 `instant = false`는 그래서 앱 전체의 정적 셸 검사를 끈다. **이 앱에서 Cache Components로 얻는 것은 정적 HTML이 아니라 서버의 데이터 캐시다.** 8장부터 그 데이터 캐시를 쓴다.

### 작업 1. [확인] 빌드 출력을 읽는다

```sh
# order-console-next/에서
npx next build
```

```text
# 출력(줄임)
- Cache Components enabled
- Partial Prefetching enabled
…
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /admin/products
├ ƒ /api/auth/[...nextauth]
├ ƒ /auth/github/complete
├ ƒ /cart
├ ƒ /login
├ ƒ /me/orders
├   /me/orders/[id]
│ └ ◐ /me/orders/[id]
└ ƒ /shop


ƒ Proxy (Middleware)

◐  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content
ƒ  (Dynamic)            server-rendered on demand
```

`ƒ`는 요청마다 서버가 그린다는 표시다. 빌드 때 통째로 미리 그린 페이지(`○`)는 하나도 없다. 경로에 `[id]`가 있는 화면은 `◐`로 찍힌다. 주소의 id는 빌드 때 알 수 없으므로 그 부분은 요청 때 채워진다는 뜻이다. 이 빌드는 API 없이도 된다. 아직 어느 화면도 서버에서 API를 부르지 않는다.

### 실험 | instant = false를 지운다

```diff
--- a/order-console-next/app/layout.tsx
+++ b/order-console-next/app/layout.tsx
@@
 const body = Noto_Sans_KR({ variable: "--font-body", weight: ["300", "400", "500"], preload: false, display: "swap" });
 const display = Noto_Serif_KR({ variable: "--font-display", weight: ["400"], preload: false, display: "swap" });
 
-export const instant = false;
+// export const instant = false;
 
 export const metadata: Metadata = {
   title: "주문 콘솔",
```

```sh
# order-console-next/에서
npx next build
git restore app/layout.tsx
```

```text
# 출력(줄임)
Error: Route "/_not-found": Next.js encountered uncached or runtime data during prerendering.

`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of `<Suspense>` prevents the route from being prerendered, blocking the page load and leading to a slower user experience.

Ways to fix this:
  - [stream] Provide a placeholder with `<Suspense fallback={...}>` around the data access
  - [cache] For uncached data (`fetch`, database calls): cache the access with `"use cache"` (does not apply to `connection()`)
  - [block] Set `export const instant = false` to allow a blocking route

Learn more: https://nextjs.org/docs/messages/blocking-prerender-dynamic
…
Error occurred prerendering page "/_not-found". Read more: https://nextjs.org/docs/messages/prerender-error
Export encountered an error on /_not-found/page: /_not-found, exiting the build.
```

루트 레이아웃의 `await connection()`이 `<Suspense>` 밖에 있어 모든 페이지의 정적 셸이 비었다. 오류가 제안하는 세 길 중 이 앱은 `[block]`을 골라 둔 것이다. 먼저 걸린 `/_not-found`는 Next가 만드는 404 페이지다. 이 페이지도 루트 레이아웃 아래에 있다. 어느 경로가 먼저 찍히는지는 페이지 구성에 따라 다르다(`/cart`가 찍히기도 한다). 블록의 둘째 줄이 되돌리기다.

### 남길 것

- **찾아보면 되는 것**: `cacheComponents`, `instant = false`, `connection()`, 빌드 표의 `ƒ`·`◐`·`○`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 요청마다 만드는 값(CSP nonce)이 있으면 정적 셸을 만들 수 없다. 그래도 `"use cache"`의 데이터 캐시는 요청 사이에 남는다.

- **에러 신호**:

  - `Error: Route "/_not-found": Next.js encountered uncached or runtime data during prerendering.`(경로는 `/cart` 등 다를 수 있다) → 루트 레이아웃의 `instant = false`가 빠졌는지

## 8. 7단계: 상품 상세 페이지

<!-- 검증 안 됨: 새로 쓴 절 -->

상품 하나를 보는 화면 `/shop/[id]`를 만든다. 이 장의 캐시 설계는 2장과 같다. 잘 바뀌지 않는 카탈로그(이름·가격·설명·이미지·카테고리 경로)는 Next 서버에 캐시하고, 결제마다 바뀌는 재고는 브라우저가 따로 받는다.

| 화면의 조각 | 어디서 그리나 | 데이터 | 캐시 |
|---|---|---|---|
| 이름·가격·설명·이미지·카테고리 | Next 서버(Server Component) | `GET /products/:id`(REST) | Redis(`product:<id>`) + Next 서버(태그 `product-<id>`) |
| 재고·담기 버튼 | 브라우저(Client Component) | `products.byId`(tRPC) | Redis의 카탈로그 칸만. 재고는 매번 DB, 브라우저는 30초(`staleTime`) |

목록에서 누르면 목록 위에 팝업으로 뜨고(주소는 `/shop/6`으로 바뀐다), 그 주소를 직접 열거나 새로고침하면 팝업이 아니라 전체 페이지다.

### 작업 1. [커밋] 상품에 설명 칸을 더한다

schema에 칸을 더한다.

```diff
--- a/order-api-nest/prisma/schema.prisma
+++ b/order-api-nest/prisma/schema.prisma
@@
model Product {
  id            Int         @id @default(autoincrement())
   name          String
   price         Int
   stock         Int
+  description   String      @default("")
   imageKey      String?     @map("image_key")
   items         OrderItem[]
   categoryId    Int?        @map("category_id")
```

`String`(필수)에 `@default("")`를 붙인 것은 화면이 `null`을 따로 다루지 않아도 되게 하려는 것이다. 설명이 없는 상품(부하용 상품)은 빈 글자이고, 화면은 빈 글자면 문단을 그리지 않는다.

Prisma가 schema와 DB를 비교해 마이그레이션 SQL을 만들게 하고, 적용하기 전에 읽는다. `--create-only`는 파일만 만들고 DB에는 적용하지 않는다. 비교에 개발 DB를 쓰므로 1장에서 띄운 compose가 떠 있어야 한다.

```sh
# order-api-nest/에서
npx prisma migrate dev --create-only --name product_description
```

Prisma는 폴더 이름 앞에 만든 시각을 붙인다(`prisma/migrations/<만든 시각>_product_description/`). 이 저장소는 폴더를 순서 번호로 붙여 왔으므로 앞의 `0020_order_list_indexes` 다음 번호로 바꾼다. `mv` 줄은 한 번만 친다. 바꾼 뒤에 다시 치면 `*_product_description`이 `0021_product_description` 자신과 맞아 실패한다.

```sh
# order-api-nest/에서
mv prisma/migrations/*_product_description prisma/migrations/0021_product_description
cat prisma/migrations/0021_product_description/migration.sql
# 출력
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';
```

읽을 것은 `NOT NULL DEFAULT ''`다. 이미 있는 행(시드 상품, 부하용 상품)에 칸을 더하면서 값을 채우므로 `NOT NULL`이어도 실패하지 않는다. 기본값이 없는 `String`으로 두었다면 Prisma는 ``Added the required column `description` to the `products` table without a default value. This is not possible if the table is not empty.``라고 경고하고, 그대로 적용하면 실패한다. 폴더 이름 바꾸기는 적용하기 전에만 한다. Prisma는 적용한 마이그레이션을 폴더 이름으로 기록하므로(`_prisma_migrations` 표), 적용한 뒤에 바꾸면 다른 마이그레이션으로 본다. 적용은 작업 3에서 한다.

`21`의 `prisma/seed/catalog.json`에 상품마다 설명을 더한다. 매일 초기화가 이 파일로 상품을 되돌리므로, 여기 없으면 초기화 뒤 상세 페이지의 설명이 모두 빈다.

```diff
--- a/order-api-nest/prisma/seed/catalog.json
+++ b/order-api-nest/prisma/seed/catalog.json
@@
     { "id": 9, "name": "만든 사람", "parentId": null }
   ],
   "products": [
-    { "id": 1, "name": "네임 카드", "price": 1000, "stock": 100, "category": "만든 사람", "photo": "maker-card.webp" },
-    { "id": 2, "name": "증명사진 20대", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-1.webp" },
-    { "id": 3, "name": "증명사진 20대 중후반", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-2.webp" },
-    { "id": 4, "name": "증명사진 30대 초", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-3.webp" },
-    { "id": 5, "name": "한정판 키보드", "price": 150000, "stock": 10, "category": "키보드", "photo": "keyboard-limited.webp" },
-    { "id": 6, "name": "마우스", "price": 30000, "stock": 100, "category": "마우스", "photo": "mouse.webp" },
-    { "id": 7, "name": "무선 헤드폰", "price": 90000, "stock": 30, "category": "헤드폰", "photo": "headphones.webp" },
-    { "id": 8, "name": "전기 주전자", "price": 40000, "stock": 20, "category": "주방", "photo": "kettle.webp" },
-    { "id": 9, "name": "키캡 세트", "price": 45000, "stock": 40, "category": "키보드", "photo": "keycaps.webp" },
-    { "id": 10, "name": "USB 허브", "price": 25000, "stock": 50, "category": "컴퓨터", "photo": "usb-hub.webp" },
-    { "id": 11, "name": "웹캠", "price": 60000, "stock": 25, "category": "컴퓨터", "photo": "webcam.webp" },
-    { "id": 12, "name": "트랙볼", "price": 55000, "stock": 15, "category": "마우스", "photo": "trackball.webp" },
-    { "id": 13, "name": "유선 헤드폰", "price": 35000, "stock": 40, "category": "헤드폰", "photo": "headphones-wired.webp" },
-    { "id": 14, "name": "휴대용 라디오", "price": 28000, "stock": 20, "category": "음향", "photo": "radio.webp" },
-    { "id": 15, "name": "모카포트", "price": 32000, "stock": 30, "category": "주방", "photo": "moka-pot.webp" },
-    { "id": 16, "name": "머그컵", "price": 12000, "stock": 60, "category": "주방", "photo": "mug.webp" }
+    { "id": 1, "name": "네임 카드", "price": 1000, "stock": 100, "category": "만든 사람", "photo": "maker-card.webp", "description": "이 서비스를 만든 사람의 명함입니다." },
+    { "id": 2, "name": "증명사진 20대", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-1.webp", "description": "이 서비스를 만든 사람의 20대 증명사진입니다." },
+    { "id": 3, "name": "증명사진 20대 중후반", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-2.webp", "description": "이 서비스를 만든 사람의 20대 중후반 증명사진입니다." },
+    { "id": 4, "name": "증명사진 30대 초", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-3.webp", "description": "이 서비스를 만든 사람의 30대 초 증명사진입니다." },
+    { "id": 5, "name": "한정판 키보드", "price": 150000, "stock": 10, "category": "키보드", "photo": "keyboard-limited.webp", "description": "10개만 만든 한정판 기계식 키보드입니다. 다시 만들지 않습니다." },
+    { "id": 6, "name": "마우스", "price": 30000, "stock": 100, "category": "마우스", "photo": "mouse.webp", "description": "손에 맞는 크기의 유선 마우스입니다. 버튼 두 개와 휠 하나, 군더더기가 없습니다." },
+    { "id": 7, "name": "무선 헤드폰", "price": 90000, "stock": 30, "category": "헤드폰", "photo": "headphones.webp", "description": "한 번 충전하면 하루 종일 쓰는 무선 헤드폰입니다. 접어서 가방에 넣을 수 있습니다." },
+    { "id": 8, "name": "전기 주전자", "price": 40000, "stock": 20, "category": "주방", "photo": "kettle.webp", "description": "1.7리터 전기 주전자입니다. 물이 끓으면 저절로 꺼집니다." },
+    { "id": 9, "name": "키캡 세트", "price": 45000, "stock": 40, "category": "키보드", "photo": "keycaps.webp", "description": "키보드 카테고리의 키캡 세트입니다. 대부분의 기계식 키보드에 맞습니다." },
+    { "id": 10, "name": "USB 허브", "price": 25000, "stock": 50, "category": "컴퓨터", "photo": "usb-hub.webp", "description": "포트 네 개짜리 USB 허브입니다. 노트북 옆에 두고 쓰기 좋은 크기입니다." },
+    { "id": 11, "name": "웹캠", "price": 60000, "stock": 25, "category": "컴퓨터", "photo": "webcam.webp", "description": "화상 회의용 웹캠입니다. 모니터 위에 걸어 둡니다." },
+    { "id": 12, "name": "트랙볼", "price": 55000, "stock": 15, "category": "마우스", "photo": "trackball.webp", "description": "엄지로 공을 굴리는 트랙볼입니다. 손목을 움직이지 않아도 됩니다." },
+    { "id": 13, "name": "유선 헤드폰", "price": 35000, "stock": 40, "category": "헤드폰", "photo": "headphones-wired.webp", "description": "선이 있는 헤드폰입니다. 충전할 필요가 없습니다." },
+    { "id": 14, "name": "휴대용 라디오", "price": 28000, "stock": 20, "category": "음향", "photo": "radio.webp", "description": "건전지로 도는 휴대용 라디오입니다. 정전 때 쓰려고 하나쯤 둡니다." },
+    { "id": 15, "name": "모카포트", "price": 32000, "stock": 30, "category": "주방", "photo": "moka-pot.webp", "description": "가스레인지에 올려 커피를 내리는 모카포트입니다. 3인분 크기입니다." },
+    { "id": 16, "name": "머그컵", "price": 12000, "stock": 60, "category": "주방", "photo": "mug.webp", "description": "350ml 머그컵입니다. 식기세척기에 넣어도 됩니다." }
   ]
 }
```

```diff
--- a/order-api-nest/prisma/seed.ts
+++ b/order-api-nest/prisma/seed.ts
@@
 
 type Catalog = {
   categories: { id: number; name: string; parentId: number | null }[];
-  products: { id: number; name: string; price: number; stock: number; category: string; photo: string }[];
+  products: { id: number; name: string; price: number; stock: number; category: string; photo: string; description: string }[];
 };
 
 const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL! }) });
@@
// 3. 카테고리 상품
 for (const p of catalog.products) {
   const categoryId = categoryIds.get(p.category);
   if (categoryId === undefined) throw new Error(`catalog.json: 없는 카테고리 "${p.category}" (${p.name})`);
-  const data = { name: p.name, price: p.price, stock: p.stock, categoryId, imageKey: noPhoto.has(p.photo) ? null : `seed/${p.photo}` };
+  const data = { name: p.name, price: p.price, stock: p.stock, description: p.description, categoryId, imageKey: noPhoto.has(p.photo) ? null : `seed/${p.photo}` };
   await prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
 }
 const productIds = catalog.products.map((p) => p.id);
```

`upsert`의 `update`에도 `description`이 들어가므로, 관리자가 고친 설명도 초기화 때 시드 값으로 돌아간다. 다른 칸(이름·가격)과 같다.

### 작업 2. [커밋] GET /products/:id와 products.byId

상품 하나도 목록과 같은 해시의 다른 칸(`product:<id>`)에 둔다. 관리자 수정의 `DEL catalog` 한 번이 목록과 상세를 함께 지운다. 재고는 목록과 같이 매번 DB에서 읽는다.

```diff
--- a/order-api-nest/src/products/product-list.ts
+++ b/order-api-nest/src/products/product-list.ts
@@
 // 카탈로그 = 잘 바뀌지 않는 칸. 재고는 결제마다 바뀌므로 넣지 않는다
 export type CatalogItem = { id: number; name: string; price: number; imageKey: string | null; categoryPath: string[] };
 type CatalogPage = { items: CatalogItem[]; nextCursor: number | null };
+// 상세 한 건. 설명은 길 수 있어 목록 칸에는 넣지 않고 상세에만 둔다
+type CatalogProduct = CatalogItem & { description: string };
 export type ProductDeps = { prisma: PrismaService; storage: StorageService; cache: CatalogCache };
 
 // 카테고리 id마다 루트부터의 이름 배열. 부모를 따라 올라가는 재귀 CTE(09)
@@
   );
   return { items, nextCursor: catalog.nextCursor };
 }
+
+async function loadProduct(prisma: PrismaService, id: number): Promise<CatalogProduct | null> {
+  const row = await prisma.product.findUnique({
+    where: { id },
+    select: { id: true, name: true, price: true, description: true, imageKey: true, categoryId: true },
+  });
+  if (!row) return null;
+  const { categoryId, ...p } = row;
+  const pathOf = await categoryPaths(prisma, categoryId ? [categoryId] : []);
+  return { ...p, categoryPath: (categoryId && pathOf.get(categoryId)) || [] };
+}
+
+// 상품 하나. 목록과 같은 해시의 다른 칸(product:<id>)에 둔다 → 관리자 수정의 DEL 한 번에 목록과 상세가 함께 지워진다
+export async function getProduct(deps: ProductDeps, id: number) {
+  // 없는 상품(null)도 칸에 남는다. 없는 번호를 계속 불러도 DB까지 가지 않는다
+  const catalog = await deps.cache.getOrLoad(`product:${id}`, () => loadProduct(deps.prisma, id));
+  if (!catalog) return null;
+  const row = await deps.prisma.product.findUnique({ where: { id }, select: { stock: true } });
+  if (!row) return null; // 캐시를 읽은 사이 지워졌다
+  const { imageKey, ...p } = catalog;
+  return { ...p, stock: row.stock, imageUrl: imageKey ? await deps.storage.createDownloadUrl(imageKey, 600) : null };
+}
```

없는 상품의 `null`도 칸에 남는다. `JSON.stringify(null)`은 `"null"`이고, 읽으면 `null`이라 `MISS`와 구별된다. 없는 번호를 계속 불러도 DB까지 가지 않는다. 이 서비스에는 상품을 새로 만드는 API가 없고, 시드가 상품을 만들면 시드가 캐시를 지운다(2장 작업 4).

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
 import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
-import { listProducts } from "./product-list.js";
+import { getProduct, listProducts } from "./product-list.js";
 import { UpdateProductDto } from "./update-product.dto.js";
 
 @ApiTags("products")
@@
     return listProducts({ prisma: this.prisma, storage: this.storage, cache: this.cache }, query);
   }
 
+  @Get(":id")
+  async detail(@Param("id", ParseIntPipe) id: number) {
+    const product = await getProduct({ prisma: this.prisma, storage: this.storage, cache: this.cache }, id);
+    if (!product) throw new NotFoundException(`product ${id} not found`);
+    return product;
+  }
+
   // 데모 관리자는 AdminGuard가 403으로 막는다(21)
   // 가격을 바꿔도 이미 만든 주문은 그대로다. 주문 품목은 주문할 때의 가격(unitPrice)을 따로 저장한다
   @Patch(":id")
```

`@Get(":id")`는 `@Get()` 아래에 둔다. `products/:id/image/...`(`06`)와 `products/:id/stock-adjustments`(`22`)는 다른 컨트롤러의 POST라 겹치지 않는다.

```diff
--- a/order-api-nest/src/trpc/router.ts
+++ b/order-api-nest/src/trpc/router.ts
@@
 import { listMyOrders } from "../me/my-orders.js";
 import { orderDetailSelect } from "../me/order-select.js";
 import { DEFAULT_LIMIT, MAX_LIMIT } from "../pagination/cursor.js";
-import { listProducts } from "../products/product-list.js";
+import { getProduct, listProducts } from "../products/product-list.js";
 import { protectedProcedure, publicProcedure, router } from "./trpc.js";
 
 export const appRouter = router({
@@
     list: publicProcedure
       .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.number().int().positive().nullish() }).default({ limit: DEFAULT_LIMIT }))
       .query(({ ctx, input }) => listProducts({ prisma: ctx.prisma, storage: ctx.storage, cache: ctx.catalogCache }, input)),
+    // 상세 화면의 재고·담기(브라우저)가 부른다. REST GET /products/:id와 같은 함수, 같은 캐시
+    byId: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
+      const product = await getProduct({ prisma: ctx.prisma, storage: ctx.storage, cache: ctx.catalogCache }, input.id);
+      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: `product ${input.id} not found` });
+      return product;
+    }),
   }),
 
   categories: router({
```

REST는 Next 서버가, tRPC는 브라우저가 부른다. 둘 다 같은 `getProduct`를 부르므로 같은 Redis 칸을 본다. `products.byId`는 `me.`으로 시작하지 않으므로 `lib/trpc.ts`의 `splitLink`가 토큰 없이 보낸다.

관리자 수정이 설명도 받게 한다.

```diff
--- a/order-api-nest/src/products/update-product.dto.ts
+++ b/order-api-nest/src/products/update-product.dto.ts
@@
 export class UpdateProductDto {
   @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
   @IsOptional() @IsInt() @Min(0) price?: number;
+  @IsOptional() @IsString() @MaxLength(2000) description?: string; // 빈 글자는 받는다(설명을 지우는 경우)
 }
```

`@IsNotEmpty()`를 붙이지 않았다. 설명을 지우는 것(빈 글자)도 수정이다.

```diff
--- a/order-api-nest/test/catalog-cache.e2e-spec.ts
+++ b/order-api-nest/test/catalog-cache.e2e-spec.ts
@@
     expect((await list()).body.items[0]).toMatchObject({ price: 2000, stock: 5 });
   });
 
+  it("상세는 목록과 같은 해시에 있다. 수정 한 번에 목록과 상세가 함께 새 값이다. 없는 상품은 404", async () => {
+    expect((await request(app.getHttpServer()).get("/products/1").expect(200)).body).toMatchObject({ price: 1000, stock: 5, categoryPath: ["전자기기", "키보드"] });
+    await list();
+    await request(app.getHttpServer()).patch("/products/1").set("Authorization", `Bearer ${tokenOf("admin")}`).send({ description: "새 설명" }).expect(200);
+    expect((await request(app.getHttpServer()).get("/products/1").expect(200)).body.description).toBe("새 설명");
+    await request(app.getHttpServer()).get("/products/999").expect(404);
+  });
+
   it("REST와 tRPC가 같은 캐시를 본다", async () => {
     const input = encodeURIComponent(JSON.stringify({ limit: 20 }));
     await request(app.getHttpServer()).get(`/trpc/products.list?input=${input}`).expect(200); // tRPC가 채운다
```

### 작업 3. [실행] 마이그레이션·시드를 넣고 API를 다시 띄운다

```sh
# order-api-nest/에서
npx prisma migrate deploy && npx prisma generate && npx prisma db seed
# 출력(줄임)
Applying migration `0021_product_description`
✔ Generated Prisma Client
seed 완료: 상품 16개(사진 새로 올림 0장, 사진 없음 0개), 임시 사용자 0명 삭제, 사용자 4명, 주문 5건, 카탈로그 캐시 지움

🌱  The seed command has been executed.
```

`prisma generate`를 빼면 `description`이 Prisma Client에 없다. `npm run build`는 `Object literal may only specify known properties, and 'description' does not exist`로 멈추고, 시드는 ``Unknown argument `description` ``으로 멈춘다. 주문 수는 그동안 결제한 만큼 다르다.

API를 다시 빌드해 띄운 뒤 두 경로를 부른다.

```sh
# 저장소 루트에서
curl -s localhost:4000/products/6 | jq -c '{name, price, stock, categoryPath, description}'
# {"name":"마우스","price":30000,"stock":100,"categoryPath":["전자기기","컴퓨터","마우스"],"description":"손에 맞는 크기의 유선 마우스입니다. 버튼 두 개와 휠 하나, 군더더기가 없습니다."}

curl -s -G localhost:4000/trpc/products.byId --data-urlencode 'input={"id":6}' | jq -c '.result.data | {name, stock}'
# {"name":"마우스","stock":100}

curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/products/999999
# 404

docker compose exec redis redis-cli HKEYS catalog
# 출력
1) "product:999999"
2) "product:6"
```

재고는 그동안 결제한 만큼 다르다. `product:999999`가 있는 것이 없는 상품을 캐시한 칸이다.

### 작업 4. [커밋] 상세 페이지를 Server Component와 Next 서버 캐시로 만든다

Next 서버에서 읽는 상품 카탈로그를 한 파일에 모은다. 9장에서 목록도 여기에 더한다.

```ts
// order-console-next/lib/catalog.ts
import { cacheLife, cacheTag } from "next/cache";

// Next 서버(Server Component)에서 읽는 상품 카탈로그. 재고는 담지 않는다. 결제마다 바뀌므로 브라우저가 tRPC로 따로 받는다
export type CatalogProduct = { id: number; name: string; price: number; description: string; imageUrl: string | null; categoryPath: string[] };

// 상품 하나에만 붙는 태그. 상품 6을 고치면 product-6이 붙은 캐시만 지운다
export const productTag = (id: number) => `product-${id}`;

// 이미지 주소는 API가 10분짜리로 서명해 준다 → 캐시는 그보다 먼저 버린다(expire 9분)
const CATALOG_LIFE = { stale: 60, revalidate: 60, expire: 540 };

export async function getProduct(id: number): Promise<CatalogProduct | null> {
  "use cache";
  cacheTag(productTag(id));
  cacheLife(CATALOG_LIFE);
  // 안쪽 fetch는 따로 캐시하지 않는다. 캐시는 바깥의 "use cache" 한 겹으로 둔다
  const res = await fetch(`${process.env.API_URL}/products/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`상품을 받지 못했다(${res.status})`); // 던지면 캐시에 남지 않는다
  const p = (await res.json()) as CatalogProduct & { stock: number };
  // 응답의 stock은 버린다. 여기 넣으면 결제가 있어도 최대 1분 옛 재고가 보인다(Redis에서 재고를 뺀 것과 같은 이유)
  return { id: p.id, name: p.name, price: p.price, description: p.description, imageUrl: p.imageUrl, categoryPath: p.categoryPath };
}
```

`"use cache"`가 붙은 함수는 결과가 Next 서버 메모리에 남는다. 캐시의 키는 빌드, 함수, 인자다. 인자 `id`가 다르면 다른 칸이다. `cacheTag`는 그 칸에 이름표를 붙인다. 나중에 이 이름표로 지운다(9장).

`cacheLife`의 세 값은 초다. `revalidate`(60초)가 지나면 다음 요청은 옛 값을 받고, 그동안 뒤에서 새로 받는다. `expire`(9분)가 지나면 버린다. `stale`(60초)은 브라우저가 서버에 묻지 않고 쓰는 시간이다. 이미지 주소는 API가 10분짜리로 서명해 준다. 그래서 캐시는 그보다 먼저 버린다. 2장에서 서명한 주소를 Redis에 넣지 않은 이유가 여기서 다시 나온다. Next 서버 캐시는 API 응답을 통째로 담으므로 그 주소도 함께 들어간다.

`ProductDetail`은 상세 페이지와 팝업이 함께 쓰는 Server Component다.

```tsx
// order-console-next/app/shop/product-detail.tsx
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/catalog";
import { BuyBox } from "./buy-box";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

// 상세 페이지(/shop/[id])와 팝업(@modal/(.)[id])이 함께 쓴다. 카탈로그는 서버 캐시에서, 재고·담기는 BuyBox가 브라우저에서
export async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const product = await getProduct(id);
  if (!product) notFound();
  return (
    <article className="grid gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" data-testid="product-detail">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt={product.name} width={240} height={240} className="aspect-square w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="grid aspect-square w-full place-items-center bg-surface font-serif text-4xl text-faint">{product.name.slice(0, 1)}</span>
      )}
      <div className="grid content-start gap-3">
        {product.categoryPath.length > 0 && <p className="label">{product.categoryPath.join(" / ")}</p>}
        {/* 팝업의 이름표(aria-labelledby)가 이 id를 가리킨다 */}
        <h1 id="product-title" className="title">{product.name}</h1>
        <p className="num">{won(product.price)}</p>
        {product.description && <p className="whitespace-pre-line text-sm text-muted">{product.description}</p>}
        <BuyBox id={product.id} name={product.name} price={product.price} />
      </div>
    </article>
  );
}
```

재고와 담기 버튼은 Client Component가 브라우저에서 받는다.

```tsx
// order-console-next/app/shop/buy-box.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useCartStore } from "@/lib/cart-store";
import { useTRPC } from "@/lib/trpc";
import { Stepper } from "./stepper";

// 재고는 서버 캐시에 없다. 브라우저가 tRPC products.byId로 받는다(staleTime 30초, providers.tsx)
export function BuyBox({ id, name, price }: { id: number; name: string; price: number }) {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.byId.queryOptions({ id }));
  const quantity = useCartStore((s) => s.items.find((i) => i.productId === id)?.quantity ?? 0);
  const add = useCartStore((s) => s.add);

  if (isPending) return <p role="status" className="text-sm text-muted">재고를 확인하는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">재고를 확인하지 못했습니다. ({error.message})</p>;
  if (data.stock === 0) return <p className="flex items-center gap-3"><span>품절</span><button type="button" className="btn" disabled>품절</button></p>;
  return (
    <p className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">재고 <span className="num" data-testid={`detail-stock-${id}`}>{data.stock}</span></span>
      {quantity > 0 ? (
        <Stepper productId={id} name={name} quantity={quantity} max={data.stock} />
      ) : (
        // 장바구니에 담는 가격은 서버 캐시에서 받은 카탈로그 가격이다. 결제 금액은 API가 DB 가격으로 다시 계산한다
        <button type="button" className="btn" onClick={() => add({ productId: id, name, price })}>담기</button>
      )}
    </p>
  );
}
```

주소를 직접 열었을 때의 전체 페이지다.

```tsx
// order-console-next/app/shop/[id]/page.tsx
import Link from "next/link";
import { Suspense } from "react";
import { ProductDetail } from "../product-detail";

// 주소를 직접 열거나 새로고침했을 때의 전체 페이지
export default function ProductPage({ params }: PageProps<"/shop/[id]">) {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-6"><Link href="/shop">상품</Link> / 상세</p>
      <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
        <ProductDetail params={params} />
      </Suspense>
    </main>
  );
}
```

`ProductDetail`을 `<Suspense>`로 감싼 것은 `params`와 `getProduct`를 기다리는 동안 머리글(`상품 / 상세`)을 먼저 보내려는 것이다. 루트 레이아웃이 `instant = false`라 감싸지 않아도 빌드는 되지만, 기다리는 곳마다 `Suspense`를 두는 것이 Cache Components의 기본 모양이다.

없는 상품 번호면 `ProductDetail`이 `notFound()`를 부른다. 그때 그릴 화면을 같은 폴더에 둔다. 없으면 Next의 영어 기본 화면(`This page could not be found`)이 나온다.

```tsx
// order-console-next/app/shop/[id]/not-found.tsx
import Link from "next/link";

// 이 폴더(/shop/[id]) 안에서 notFound()가 불리면 페이지 대신 이것을 그린다(없는 번호, 지워진 상품)
export default function ProductNotFound() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-4">상품을 찾을 수 없습니다</h1>
      <p className="note">주소의 상품 번호가 없거나 지워진 상품입니다. <Link href="/shop">상품 목록</Link>에서 다시 골라 주세요.</p>
    </main>
  );
}
```

### 작업 5. [커밋] 목록에서 누르면 팝업, 주소를 직접 열면 전체 페이지

두 가지 라우팅 규칙을 함께 쓴다.

- parallel route: `@modal` 폴더는 주소에 나타나지 않는 슬롯이다. 부모 레이아웃이 `children` 옆에 `modal`을 함께 받아 그린다
- intercepting route: `(.)[id]`는 같은 단계의 `[id]`를 가로챈다. 목록 안에서 링크로 이동할 때(soft navigation)만 가로채고, 주소를 직접 열거나 새로고침할 때(hard navigation)는 가로채지 않는다

```text
app/shop/
├── layout.tsx
├── page.tsx
├── [id]/page.tsx
└── @modal/
    ├── default.tsx
    ├── page.tsx
    └── (.)[id]/page.tsx
```

| 파일 | 슬롯 | 언제 그려지나 | 그리는 것 |
|---|---|---|---|
| `layout.tsx` | - | `/shop` 아래 모든 주소 | `children`과 `modal`을 나란히 |
| `page.tsx` | `children` | `/shop` | 상품 목록 |
| `[id]/page.tsx` | `children` | `/shop/6`을 직접 열거나 새로고침했을 때 | 상세 전체 페이지 |
| `@modal/(.)[id]/page.tsx` | `modal` | 목록에서 `/shop/6`으로 링크 이동했을 때 | 목록 위의 팝업 |
| `@modal/page.tsx` | `modal` | `/shop`으로 링크 이동했을 때 | 없음(`null`). 팝업을 닫는다 |
| `@modal/default.tsx` | `modal` | 새로고침 등으로 슬롯의 상태를 모를 때 | 없음(`null`) |

링크로 `/shop/6`에 가면 `children`은 목록을 그대로 두고 `modal`만 팝업이 된다. 주소를 직접 열면 `children`이 상세 전체 페이지를, `modal`이 `default.tsx`(아무것도 없음)를 그린다.

```tsx
// order-console-next/app/shop/layout.tsx
// modal : @modal 폴더(슬롯)가 그린 것. 목록에서 상품을 누르면 여기에 팝업이 들어온다
export default function ShopLayout({ children, modal }: LayoutProps<"/shop">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
```

`LayoutProps<"/shop">`의 `modal` 칸은 Next가 폴더 구조로 만드는 타입이다(`npx next typegen`, `npm run typecheck`가 먼저 돌린다).

```tsx
// order-console-next/app/shop/@modal/default.tsx
// 주소를 직접 열거나 새로고침하면 Next는 슬롯이 무엇을 보이던 중이었는지 모른다 → 이것을 그린다. 없으면 오류다
export default function ModalDefault() {
  return null;
}
```

```tsx
// order-console-next/app/shop/@modal/page.tsx
// /shop으로 링크 이동하면 슬롯도 /shop에 맞는 것을 그린다. 이 파일이 없으면 팝업이 열린 채로 남는다
export default function ModalNone() {
  return null;
}
```

```tsx
// order-console-next/app/shop/@modal/(.)[id]/page.tsx
import { Suspense } from "react";
import { Modal } from "../../modal";
import { ProductDetail } from "../../product-detail";

// (.)[id] : 같은 단계의 [id]를 가로챈다. 목록에서 링크로 갈 때만 이것이 그려지고, 주소를 직접 열면 app/shop/[id]/page.tsx가 그려진다
export default function ProductModal({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Modal>
      <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
        <ProductDetail params={params} />
      </Suspense>
    </Modal>
  );
}
```

`(.)`는 폴더가 아니라 라우트 단계를 센다. `@modal`은 슬롯이라 단계로 치지 않으므로 `app/shop/@modal/(.)[id]`는 `/shop/[id]`를 가리킨다. `(..)`(한 단계 위), `(...)`(`app`부터)도 있다.

팝업 틀은 브라우저의 `<dialog>`를 쓴다.

```tsx
// order-console-next/app/shop/modal.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// showModal()은 뒤쪽 페이지를 inert로 막지만, 마지막 요소에서 Tab을 누르면 포커스를 브라우저 UI(주소창)로 내보낸다
// 팝업의 처음과 끝에서 Tab을 직접 돌려 팝업 안에만 머물게 한다
function keepTabInside(e: KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  // 포커스가 dialog 자체에 있을 때(아직 안의 요소로 들어가지 않았을 때) Shift+Tab도 끝으로 보낸다
  if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// 주소는 /shop/[id]인 채로 목록 위에 뜨는 팝업. 닫기는 모두 "뒤로 가기"다 → 주소도 /shop으로 돌아간다
export function Modal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; // 팝업을 연 링크
    // showModal: 뒤쪽 페이지를 inert로 만든다(누르거나 포커스할 수 없다). Esc는 dialog를 닫고 close 이벤트를 낸다
    if (dialog && !dialog.open) dialog.showModal(); // 개발 모드의 StrictMode는 effect를 두 번 돌린다. 이미 열렸으면 다시 열지 않는다
    return () => opener?.focus(); // 뒤로 가기로 팝업이 사라지면(언마운트) 연 링크로 포커스를 돌려준다
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="product-title"
      className="m-auto max-h-[85vh] w-[min(640px,calc(100%-32px))] overflow-auto border border-line-strong bg-bg p-6 text-fg backdrop:bg-black/40"
      onClose={() => router.back()} // Esc로 닫혔을 때만 온다. 언마운트로 사라질 때는 close 이벤트가 없다
      onKeyDown={keepTabInside}
      onClick={(e) => { if (e.target === e.currentTarget) router.back(); }} // 바깥(배경)을 누르면 이벤트의 대상이 dialog 자신이다
    >
      <p className="mb-4 text-right">
        <button type="button" className="btn" onClick={() => router.back()}>닫기</button>
      </p>
      {children}
    </dialog>
  );
}
```

닫는 길은 넷이고, 모두 "뒤로 가기"로 모인다. 팝업을 연 것이 주소 이동(`/shop` → `/shop/6`)이었으므로 닫는 것도 주소를 되돌리는 것이어야 한다. 그래야 브라우저의 뒤로 가기·앞으로 가기와 화면이 어긋나지 않는다.

| 닫는 길 | 무엇이 일어나나 | 코드 |
|---|---|---|
| 닫기 버튼 | `router.back()` → 주소가 `/shop`으로 → 슬롯이 `@modal/page.tsx`(null) → 팝업이 사라진다 | `onClick` |
| 배경 누르기 | 위와 같다. 배경을 누르면 이벤트의 대상이 `dialog` 자신이다 | `onClick`의 `e.target === e.currentTarget` |
| Esc | 브라우저가 `dialog`를 닫고 `close` 이벤트를 낸다 → `router.back()` | `onClose` |
| 브라우저의 뒤로 가기 | 주소가 먼저 바뀌어 팝업이 사라진다. 이때는 `close` 이벤트가 나지 않아 두 번 뒤로 가지 않는다 | 없음 |

`showModal()`로 연 `dialog`는 뒤쪽 페이지를 inert(누를 수도, 포커스할 수도 없는 상태)로 만든다. 그래서 Tab을 눌러도 목록이나 위쪽 메뉴로는 가지 않는다. 다만 팝업의 마지막 요소에서 Tab을 한 번 더 누르면 포커스가 브라우저 UI(주소창)로 나간다. 표준이 정한 동작이고, Chromium에서 `닫기 → 담기 → (주소창) → 닫기`로 도는 것을 확인했다. 페이지 안에서 보면 `document.activeElement`가 `body`다. 키보드로 쓰는 사람에게는 팝업을 벗어난 것처럼 보이므로, `keepTabInside`가 처음과 끝에서 Tab·Shift+Tab을 직접 돌린다. 열 때는 브라우저가 포커스를 팝업 안으로 옮긴다. 닫힐 때는 effect의 정리 함수가 팝업을 연 링크로 포커스를 돌려준다. 키보드로 쓰는 사람이 목록의 자기 자리를 잃지 않게 하려는 것이다.

목록의 이름을 링크로 바꾼다.

```diff
--- a/order-console-next/app/shop/page.tsx
+++ b/order-console-next/app/shop/page.tsx
@@
                 <span aria-hidden="true" className="grid size-16 place-items-center bg-surface font-serif text-xl text-faint">{p.name.slice(0, 1)}</span>
               )}
               <div className="min-w-0">
-                <p className="font-normal">{p.name}</p>
+                {/* 목록 안에서 누르면 팝업(@modal/(.)[id]), 주소를 직접 열면 전체 페이지([id]) */}
+                <p className="font-normal"><Link href={`/shop/${p.id}`} className="no-underline">{p.name}</Link></p>
                 <p className="flex flex-wrap gap-x-3 text-[0.8rem] text-muted">
                   <span className="num">{won(p.price)}</span>
                   {soldOut ? <span className="text-fg">품절</span> : <span>재고 <span className="num" data-testid={`stock-${p.id}`}>{p.stock}</span></span>}
```

### 작업 6. [커밋] 팝업과 전체 페이지를 e2e로 지킨다

```ts
// order-console-next/e2e/product-detail.spec.ts
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("목록에서 누르면 팝업으로 열리고, Esc와 뒤로 가기로 닫히며, 포커스가 링크로 돌아온다", async ({ page }) => {
  await page.goto("/shop");
  const link = page.getByRole("link", { name: "마우스", exact: true });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "마우스" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/shop\/6$/);
  await expect(dialog.getByTestId("detail-stock-6")).not.toHaveText("");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/shop$/);
  await expect(link).toBeFocused();

  await link.click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/shop$/);
});

test("팝업이 열린 채 Tab을 눌러도 포커스가 팝업 밖으로 나가지 않는다", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "마우스" });
  await expect(dialog.getByRole("button", { name: "담기" })).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
});

test("주소를 직접 열거나 새로고침하면 팝업이 아니라 전체 페이지다. 설명이 보인다", async ({ page }) => {
  await page.goto("/shop/6");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("product-detail")).toContainText("유선 마우스");
  await expect(page.getByRole("heading", { name: "마우스", exact: true })).toBeVisible();

  // 목록에서 팝업으로 연 뒤 새로고침해도 같은 전체 페이지다. 새로고침은 링크 이동이 아니라 가로채지 않는다
  await page.goto("/shop");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/shop\/6$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("product-detail")).toContainText("유선 마우스");
});

test("없는 상품은 찾을 수 없다는 화면이다", async ({ page }) => {
  await page.goto("/shop/999999");
  // Next의 기본 404 문구가 아니라 app/shop/[id]/not-found.tsx의 제목을 본다
  await expect(page.getByRole("heading", { name: "상품을 찾을 수 없습니다" })).toBeVisible();
});
```

Tab 테스트의 `dialog.evaluate(...)`는 지금 포커스가 팝업 안에 있는지를 브라우저에 묻는다. `keepTabInside`를 빼면 세 번째 Tab에서 `Expected: true / Received: false`로 실패한다(포커스가 `body`로 나간다). 손으로 확인할 때는 Tab과 Shift+Tab을 여러 번 눌러 보면 된다(작업 7).

### 작업 7. [확인] 빌드 출력과 화면을 본다

웹을 다시 빌드해 띄운다. API(1장 작업 2의 터미널 2)는 떠 있어야 한다.

```sh
# order-console-next/에서
npx next build && npx next start

# 출력
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /admin/products
├ ƒ /api/auth/[...nextauth]
├ ƒ /auth/github/complete
├ ƒ /cart
├ ƒ /login
├ ƒ /me/orders
├   /me/orders/[id]
│ └ ◐ /me/orders/[id]
├ ƒ /shop
├   /shop/(.)[id]
│ └ ◐ /shop/(.)[id]
└   /shop/[id]
  └ ◐ /shop/[id]
```

상세 페이지는 `◐`다. 빌드 때 그릴 수 있는 것이 없고(id를 모른다), `getProduct`도 인자가 주소에서 오므로 빌드 때 돌지 않는다. 그래서 이 빌드도 API 없이 된다. 페이지(HTML)는 요청마다 그린다. 다른 터미널에서 같은 주소를 두 번 받아 nonce를 비교하면 보인다.

```sh
# 저장소 루트에서
curl -s localhost:3000/shop/6 | grep -o 'nonce="[^"]*"' | head -1
curl -s localhost:3000/shop/6 | grep -o 'nonce="[^"]*"' | head -1

# 출력, 요청마다 다른 값이 나오면 정상이다.
nonce="ZjhlYTE4Y2MtZjlhMS00NDYzLTliMDQtOGUwYmVlMjVjNmI3"
nonce="NDNhZDNiZjQtMTBmMy00YTk5LTk1MWUtMDk1N2ZmZWE5NTYx"
```

두 줄의 값이 다르면 HTML은 요청마다 새로 그린 것이다. 그래도 카탈로그는 다시 받지 않는다. Next 서버가 API의 `GET /products/:id`를 몇 번 불렀는지 API의 요청 지표로 센다. 위의 `curl` 두 줄을 한 번 더 치고 다시 센다.

```sh
# 저장소 루트에서
curl -s localhost:4000/metrics | grep 'route="/products/:id"' | grep _count
# http_request_duration_seconds_count{method="GET",route="/products/:id",status_code="200"} 1
```

`curl`을 더 쳐도 1분(`revalidate`) 안에는 이 수가 늘지 않는다. 카탈로그가 Next 서버 캐시에서 왔다. 수는 그동안 상세를 연 상품 수와 작업 3의 `curl`에 따라 다르다. 줄이 아예 없으면 Next 서버가 아직 한 번도 API를 부르지 않은 것이다.

브라우저에서 확인한다.

1. `/shop`에서 마우스를 누른다. 목록 위에 팝업이 뜨고 주소가 `/shop/6`이다
2. Tab과 Shift+Tab을 여러 번 눌러도 포커스가 팝업 밖(목록, 위쪽 메뉴, 주소창)으로 나가지 않는다
3. Esc를 누르면 닫히고 주소가 `/shop`이다. 포커스는 마우스 링크에 있다
4. 다시 열고 브라우저의 뒤로 가기를 누르면 닫힌다. 앞으로 가기를 누르면 다시 열린다
5. 팝업이 열린 채 새로고침하면 팝업이 아니라 전체 페이지다
6. 개발자 도구의 Network 탭을 열어 둔 채 30초쯤 기다렸다가 팝업을 닫고 다시 연다. `products.byId`(재고)는 다시 받는다(`staleTime` 30초가 지났다)

```sh
# order-console-next/에서
npx playwright test e2e/product-detail.spec.ts e2e/shop.spec.ts
```

`e2e/shop.spec.ts`도 함께 돌린다. 목록의 상품 이름이 링크가 되었어도 `getByRole("listitem").filter({ hasText: "마우스" })`로 찾는 기존 테스트는 그대로 통과해야 한다.

### 용어 | 라우팅 파일 규칙

- `@폴더`: 슬롯(parallel route). 주소에 나타나지 않고, 부모 레이아웃의 같은 이름 prop으로 들어온다. `children`도 암묵적인 슬롯이다
- `default.tsx`: 새로고침처럼 Next가 슬롯의 상태를 모를 때 그리는 것. 이름 있는 슬롯에 없으면 오류다
- `(.)폴더`, `(..)폴더`, `(...)폴더`: intercepting route. 같은 단계, 한 단계 위, `app`부터의 라우트를 링크 이동 때만 가로챈다
- `<dialog>`의 `showModal()`: 뒤쪽 페이지를 inert로 두고 연다. 마지막 요소 다음의 Tab은 브라우저 UI로 나간다. Esc는 `cancel` 다음 `close` 이벤트를 낸다

### 남길 것

- **찾아보면 되는 것**: `prisma migrate dev --create-only --name`, `@modal`·`default.tsx`·`(.)` 규칙, `cacheTag`·`cacheLife`의 인자, `dialog`의 `showModal`·`close` 이벤트. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 한 화면 안에서도 캐시할 조각과 매번 받을 조각을 나눈다. 카탈로그는 서버 캐시, 재고는 브라우저가 매번. 2장의 Redis와 같은 기준이다.

  - 서명된 주소처럼 스스로 만료되는 값을 캐시하면 캐시의 수명을 그보다 짧게 맞춘다.

  - 주소로 연 팝업은 주소로 닫는다. 닫는 길이 여럿이어도 모두 `router.back()`으로 모아야 뒤로 가기와 화면이 어긋나지 않는다. `showModal()`은 뒤쪽 페이지를 막아 줄 뿐 포커스를 팝업 안에 가두지는 않는다. 도구가 해 준다고 믿은 동작은 키보드로 직접 눌러 확인한다.

- **에러 신호**:

  - `Object literal may only specify known properties, and 'description' does not exist`, 시드의 ``Unknown argument `description` `` → `npx prisma generate`를 했는지

  - 팝업이 아니라 늘 전체 페이지로 간다 → `app/shop/layout.tsx`가 `modal`을 그리는지, 폴더 이름이 `@modal/(.)[id]`인지

  - 새로고침하면 404 화면이고 서버 로그에 `No default component was found for a parallel route rendered on this page.` → `@modal/default.tsx`

  - `/shop`으로 링크 이동했는데 팝업이 남아 있다 → `@modal/page.tsx`

  - 팝업의 마지막 버튼에서 Tab을 누르면 포커스가 주소창으로 나간다, e2e의 `Expected: true / Received: false` → `dialog`의 `onKeyDown={keepTabInside}`

  - Esc로 닫으면 두 화면 뒤로 간다 → `onClose`와 다른 닫기가 둘 다 `router.back()`을 부르는지(닫기 버튼에서 `dialog.close()`를 부르지 않는다)

## 9. 8단계: 관리자 상품 화면을 서버에서 캐시하고 Server Action으로 고친다

지금 관리자 상품 화면(`app/admin/products/page.tsx`)은 Client Component다. 관리자인지 묻고, 상품을 TanStack Query 무한 목록(`22`)으로 받고, 줄마다 재고 입고·조정(`22`)과 이미지 올리기(`06`)를 둔다. 이 장은 상품 표를 서버가 그리게 하고, 상품 수정 화면을 더한다.

### 작업 1. [커밋] 서버에서 받는 상품 목록

```diff
--- a/order-console-next/lib/catalog.ts
+++ b/order-console-next/lib/catalog.ts
@@
 
 // Next 서버(Server Component)에서 읽는 상품 카탈로그. 재고는 담지 않는다. 결제마다 바뀌므로 브라우저가 tRPC로 따로 받는다
 export type CatalogProduct = { id: number; name: string; price: number; description: string; imageUrl: string | null; categoryPath: string[] };
+export type CatalogListItem = Omit<CatalogProduct, "description">;
+
+// 목록 전체에 붙는 태그. 어느 상품이 바뀌어도 목록은 다시 받아야 한다
+export const PRODUCTS_TAG = "products";
 
 // 상품 하나에만 붙는 태그. 상품 6을 고치면 product-6이 붙은 캐시만 지운다
 export const productTag = (id: number) => `product-${id}`;
@@
   // 응답의 stock은 버린다. 여기 넣으면 결제가 있어도 최대 1분 옛 재고가 보인다(Redis에서 재고를 뺀 것과 같은 이유)
   return { id: p.id, name: p.name, price: p.price, description: p.description, imageUrl: p.imageUrl, categoryPath: p.categoryPath };
 }
+
+// 관리자 상품 표가 쓴다. 인자가 없으므로 캐시 칸은 하나다
+export async function getProducts(): Promise<CatalogListItem[]> {
+  "use cache";
+  cacheTag(PRODUCTS_TAG);
+  cacheLife(CATALOG_LIFE);
+  const products: CatalogListItem[] = [];
+  let cursor: number | null = null;
+  do {
+    // 관리 화면은 모든 상품을 한 표에서 본다. 서버가 페이지를 끝까지 이어 받는다
+    const res = await fetch(`${process.env.API_URL}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`, { cache: "no-store" });
+    if (!res.ok) throw new Error(`상품 목록을 받지 못했다(${res.status})`);
+    const page = (await res.json()) as { items: (CatalogListItem & { stock: number })[]; nextCursor: number | null };
+    products.push(...page.items.map((p) => ({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, categoryPath: p.categoryPath }))); // stock은 버린다
+    cursor = page.nextCursor;
+  } while (cursor);
+  return products;
+}
```

`getProducts`는 인자가 없으므로 캐시 칸이 하나다. 태그는 목록 전체를 뜻하는 `products`다. 상품별 태그(`product-<id>`)와 나눈 이유는 아래 "목록 태그와 상품별 태그"에서 다룬다. `cache: "no-store"`는 아래 "안쪽 fetch도 캐시될 수 있다"에서 다룬다.

### 작업 2. [커밋] 상품 표는 서버가, 재고 칸은 브라우저가 그린다

표를 서버가 그리면 두 가지가 걸린다.

- 재고: 서버 캐시에 넣으면 결제가 있어도 1분 동안 옛 재고가 보이고, 입고·조정 결과도 바로 반영되지 않는다. 그래서 재고 칸과 입고·조정 칸은 Client Component(`StockCell`)로 두고 `products.byId`로 받는다
- 누가 보는가: 로그인은 브라우저 메모리의 액세스 토큰이라(`05`) 서버는 관리자인지, 데모 관리자(`21`)인지 모른다. 관리자인지 묻는 일은 Client Component(`AdminOnly`)가 하고, 서버가 그린 표를 `children`으로 받아 보여 줄지만 정한다. 데모 관리자면 입력을 끄라는 표시를 컨텍스트로 아래에 내려 준다

```tsx
// order-console-next/app/admin/products/admin-only.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { useTRPC } from "@/lib/trpc";

// 데모 관리자(21)는 볼 수만 있다. 표는 서버가 그려 role을 모르므로, 입력을 끌지는 이 컨텍스트로 아래 클라이언트 컴포넌트에 알린다
const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

// 누가 관리자인지는 브라우저만 안다(액세스 토큰이 브라우저 메모리에 있다). 서버가 그린 표를 children으로 받아 보여 줄지만 정한다
// 실제로 막는 것은 API의 AdminGuard다. 카탈로그는 상점에도 보이는 공개 정보라 서버가 먼저 그려 두어도 된다
export function AdminOnly({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  // 메모리의 토큰만 보고 판단하지 않는다. 새로고침하면 토큰이 없다 → 물으면 refresh 쿠키로 다시 받아 온다
  const { data: profile, isPending, error } = useQuery({ ...trpc.me.profile.queryOptions(), retry: false });
  if (isPending) return <p role="status" className="text-sm text-muted">확인하는 중입니다.</p>;
  if (error?.data?.code === "UNAUTHORIZED") return <p className="note">관리자 계정으로 <Link href="/login">로그인</Link>해 주세요.</p>;
  if (error) return <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
  if (profile.role !== "admin" && profile.role !== "demo_admin") return <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
  const readOnly = profile.role === "demo_admin";
  return (
    <ReadOnly value={readOnly}>
      {readOnly ? (
        <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
          데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기, 재고 조정, 상품 수정은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.
        </p>
      ) : (
        <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
      )}
      {children}
    </ReadOnly>
  );
}
```

```tsx
// order-console-next/app/admin/products/stock-cell.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";
import { useReadOnly } from "./admin-only";
import { StockAdjuster } from "./stock-adjuster";

// 표의 재고 칸과 입고·조정 칸. 재고는 서버 캐시에 없으므로 브라우저가 받는다
// 줄마다 products.byId를 부르지만 httpBatchLink가 같은 순간의 호출을 한 요청으로 묶는다
export function StockCell({ productId, name }: { productId: number; name: string }) {
  const trpc = useTRPC();
  const readOnly = useReadOnly();
  const { data } = useQuery(trpc.products.byId.queryOptions({ id: productId }));
  return (
    <>
      <td className="num hidden py-3 sm:table-cell" data-testid={`admin-stock-${productId}`}>{data?.stock ?? ""}</td>
      <td className="hidden py-3 sm:table-cell"><StockAdjuster productId={productId} name={name} readOnly={readOnly} /></td>
    </>
  );
}
```

`StockCell`은 줄마다 `products.byId`를 부른다. 상품이 66개면 66번이다. `lib/trpc.ts`의 `httpBatchLink`가 같은 순간의 호출을 HTTP 요청 하나로 묶어 주지만, 줄어드는 것은 왕복 수뿐이다. API는 그 요청 안에서 상품마다 `getProduct`를 따로 돈다. 상품 하나에 Redis 조회(`HGET catalog product:<id>`) 한 번과 재고 쿼리(`findUnique`) 한 번이니, 표를 한 번 열 때 66번씩이다. 관리 화면이라 받아들인다. 상품이 수천 개라면 id 목록을 받아 재고만 한 쿼리(`WHERE id IN (...)`)로 돌려주는 API를 따로 둔다.

관리자 상품 화면을 Server Component로 바꾼다. 맨 위의 `"use client"`를 지우고, 관리자 확인은 `AdminOnly`로, 재고 두 칸은 `StockCell`로 옮긴다. 무한 목록(`LoadMore`)은 걷어 낸다. 관리 화면은 모든 상품을 한 표에서 보고, 서버가 페이지를 끝까지 이어 받는다.

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
-"use client";
-
-import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
-import Link from "next/link";
-import { productListOptions } from "@/lib/lists";
-import { useTRPC } from "@/lib/trpc";
-import { LoadMore } from "../../load-more";
+import { connection } from "next/server";
+import { Suspense } from "react";
+import { getProducts } from "@/lib/catalog";
+import { AdminOnly } from "./admin-only";
 import { ProductImageUploader } from "./product-image-uploader";
-import { StockAdjuster } from "./stock-adjuster";
+import { StockCell } from "./stock-cell";
 
 const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
 
-function ProductTable({ readOnly }: { readOnly: boolean }) {
-  const trpc = useTRPC();
-  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(productListOptions(trpc));
-  if (isPending) return <p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>;
-  if (error && !data) return <p role="alert" className="alert">상품을 불러오지 못했습니다. ({error.message})</p>;
-  const products = data.pages.flatMap((page) => page.items);
+// 상품 표를 서버가 그린다. 카탈로그는 getProducts("use cache", 태그 products)에서, 재고는 StockCell이 브라우저에서
+async function ProductTable() {
+  // "use cache" 함수는 빌드 중에도 미리 돈다. 이미지 빌드에는 API가 없다 → 그 앞에서 멈춘다. 이 뒤의 코드는 요청이 왔을 때만 돈다
+  await connection();
+  const products = await getProducts();
   return (
-    <>
     <table className="w-full border-collapse text-left">
       <thead>
         <tr className="border-b border-line-strong">
@@
                 {p.name}
               </span>
             </td>
-            <td className="num hidden py-3 sm:table-cell">{won(p.price)}</td>
-            <td className="num hidden py-3 sm:table-cell" data-testid={`admin-stock-${p.id}`}>{p.stock}</td>
-            <td className="hidden py-3 sm:table-cell"><StockAdjuster productId={p.id} name={p.name} readOnly={readOnly} /></td>
-            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} readOnly={readOnly} /></td>
+            <td className="num hidden py-3 sm:table-cell" data-testid={`price-${p.id}`}>{won(p.price)}</td>
+            <StockCell productId={p.id} name={p.name} />
+            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} /></td>
           </tr>
         ))}
       </tbody>
     </table>
-    <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
-      fetchNextPage={fetchNextPage} loaded={products.length} pages={data.pages.length} noun="상품" />
-    </>
   );
 }
 
 export default function AdminProductsPage() {
-  const trpc = useTRPC();
-  const { data: profile, isPending, error } = useQuery({ ...trpc.me.profile.queryOptions(), retry: false });
-  let body;
-  if (isPending) body = <p role="status" className="text-sm text-muted">확인하는 중입니다.</p>;
-  else if (error?.data?.code === "UNAUTHORIZED") body = <p className="note">관리자 계정으로 <Link href="/login">로그인</Link>해 주세요.</p>;
-  else if (error) body = <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
-  else if (profile.role !== "admin" && profile.role !== "demo_admin") body = <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
-  else
-    body = (
-      <>
-        {profile.role === "demo_admin" ? (
-          <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
-            데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기와 재고 조정은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.
-          </p>
-        ) : (
-          <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
-        )}
-        <ProductTable readOnly={profile.role === "demo_admin"} />
-      </>
-    );
   return (
     <main className="page flex-1 pb-12 pt-2">
       <h1 className="title mb-8">상품 관리</h1>
-      {body}
+      <AdminOnly>
+        <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
+          <ProductTable />
+        </Suspense>
+      </AdminOnly>
     </main>
   );
 }
```

가격 칸에 `data-testid="price-<id>"`를 새로 붙인다(10장의 e2e가 쓴다). `admin-stock-<id>`(`StockCell` 안), `image-<id>`는 그대로 둔다. `22`의 `e2e/stock-adjust.spec.ts`와 `06`의 `e2e/upload.spec.ts`가 그것으로 찾는다.

이미지 올리기와 입고·조정을 고친다. 이미지 올리기는 `readOnly`를 prop 대신 컨텍스트에서 받는다. 입고·조정은 결과 재고를 `products.byId`의 칸에도 넣는다. 그 칸을 이제 재고 칸(`StockCell`)과 상세의 담기 상자(8장)가 본다.

```diff
--- a/order-console-next/app/admin/products/product-image-uploader.tsx
+++ b/order-console-next/app/admin/products/product-image-uploader.tsx
@@
 import { useMutation, useQueryClient } from "@tanstack/react-query";
 import { authFetch } from "@/lib/api-client";
 import { useTRPC } from "@/lib/trpc";
+import { useReadOnly } from "./admin-only";
 
 type UploadUrl = { key: string; uploadUrl: string; expiresIn: number };
 
-export function ProductImageUploader({ productId, hasImage, readOnly }: { productId: number; hasImage: boolean; readOnly: boolean }) {
+export function ProductImageUploader({ productId, hasImage }: { productId: number; hasImage: boolean }) {
   const trpc = useTRPC();
+  const readOnly = useReadOnly(); // 표를 서버가 그리므로 prop 대신 AdminOnly의 컨텍스트에서 받는다
   const queryClient = useQueryClient();
   const upload = useMutation({
     mutationFn: async (file: File) => {
```

```diff
--- a/order-console-next/app/admin/products/stock-adjuster.tsx
+++ b/order-console-next/app/admin/products/stock-adjuster.tsx
@@
       }),
     onSuccess: ({ stock }) => {
       setDelta("");
+      // 관리자 표의 재고 칸(StockCell)과 상세의 담기 상자가 보는 칸
+      queryClient.setQueryData(trpc.products.byId.queryKey({ id: productId }), (old) => old && { ...old, stock });
       queryClient.setQueryData(productListOptions(trpc).queryKey, (old) => old && {
         ...old,
         pages: old.pages.map((page) => ({ ...page, items: page.items.map((p) => (p.id === productId ? { ...p, stock } : p)) })),
```

> 이 작업부터 다음 작업까지는 이미지를 올려도 표가 바로 바뀌지 않는다. 업로더는 브라우저의 TanStack Query(`products.list`)만 지우는데, 표는 이제 서버 캐시(`getProducts`)로 그린다. 그래서 썸네일과 버튼 글자(`올리기`/`바꾸기`)가 옛 상태로 남는다. `revalidate`가 60초라, 1분이 지난 뒤 첫 요청은 여전히 옛 표를 받고 그다음 요청부터 새 이미지가 보인다. `e2e/upload.spec.ts`의 첫 테스트도 이 동안 실패한다. 작업 3이 Server Action의 `updateTag`로 고친다. 푸시는 작업 3 뒤에 한다.

### 실험 | connection()을 빼고 API 없이 빌드한다

`ProductTable`의 `await connection()`을 주석 처리하고, API가 없는 상태로 빌드한다. 이미지 빌드(`16`)에는 API가 없다. 떠 있는 API를 끄지 않고, 아무것도 듣지 않는 포트(4999)를 `API_URL`로 준다. 명령 앞의 환경 변수가 `.env.local`보다 먼저다.

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
 // 상품 표를 서버가 그린다. 카탈로그는 getProducts("use cache", 태그 products)에서, 재고는 StockCell이 브라우저에서
 async function ProductTable() {
   // "use cache" 함수는 빌드 중에도 미리 돈다. 이미지 빌드에는 API가 없다 → 그 앞에서 멈춘다. 이 뒤의 코드는 요청이 왔을 때만 돈다
-  await connection();
+  // await connection();
   const products = await getProducts();
   return (
     <table className="w-full border-collapse text-left">
```

```sh
# order-console-next/에서
API_URL=http://localhost:4999 npx next build
```

```text
# 출력(줄임)
Error occurred prerendering page "/admin/products". Read more: https://nextjs.org/docs/messages/prerender-error
[TypeError: fetch failed] {
  digest: '3227098399',
  [cause]: AggregateError: 
      at ignore-listed frames {
    code: 'ECONNREFUSED',
    [errors]: [
      Error: connect ECONNREFUSED ::1:4999
…
      Error: connect ECONNREFUSED 127.0.0.1:4999
…
Export encountered an error on /admin/products/page: /admin/products, exiting the build.
```

루트 레이아웃이 요청마다 그리게 했는데도 Next는 `"use cache"` 함수를 빌드 중에 실행해 결과를 미리 채워 두려 했다. 인자가 없어 빌드 때도 부를 수 있고, `cacheLife`의 `expire`(9분)가 5분보다 길어 미리 그릴 대상이기 때문이다. API가 있으면(`API_URL` 없이 그냥 `npx next build`) 빌드는 되고, 빌드 표에 그 흔적이 남는다.

```text
# 출력(API가 있을 때, 줄임)
Route (app)                  Revalidate  Expire
┌ ƒ /
├ ƒ /_not-found
├ ƒ /admin/products                  1m      9m
├   /admin/products/[id]
│ └ ◐ /admin/products/[id]
…
```

`cacheLife`의 1분과 9분이 찍혔다. 빌드 때 받은 결과를 들고 시작한다는 뜻이다. 배포 이미지라면 빌드한 시점의 상품 목록이다. 확인했으면 되돌린다.

```sh
# 저장소 루트에서
git restore order-console-next/app/admin/products/page.tsx
```

`connection()` 뒤의 코드는 요청이 왔을 때만 돈다. 되돌린 코드로 `API_URL=http://localhost:4999 npx next build`를 하면 빌드가 되고, 빌드 표에서 `/admin/products`의 Revalidate·Expire 칸이 사라진다. 캐시는 첫 요청 때 채워지고 요청 사이에 남는다. 8장의 `getProduct`는 인자가 주소에서 오므로 빌드 때 부를 수 없다. 그래서 `connection()`이 필요 없었다.

### 개념 | 안쪽 fetch도 캐시될 수 있다

안쪽 `fetch`에 `cache: "no-store"`가 없고 `getProducts`가 빌드 중에 돌면(위 실험처럼 `connection()`을 뺀 채 API가 있을 때 빌드), 빌드가 끝난 `.next`에 폴더가 하나 더 생긴다.

```sh
# order-console-next/에서
ls .next/cache/fetch-cache
```

```text
# 출력(no-store도 connection()도 없이 빌드했을 때)
<요청을 해시한 64자 이름>
# 출력(connection()만 없고 no-store는 있을 때)
ls: .next/cache/fetch-cache: No such file or directory
```

`getProducts` 안의 `fetch` 응답이 `"use cache"`와 별개로 `.next/cache/fetch-cache`에 디스크로 저장된 것이다. 이 문서의 바탕이 된 예전 측정에서는 이 파일이 다시 빌드하고 서버를 다시 띄워도 남아서, 빈 메모리 캐시를 채우는 첫 호출에 빌드 때의 옛 가격을 돌려줬다. 캐시 층이 하나 숨어 있었던 것이다. 그래서 안쪽 `fetch`에는 `cache: "no-store"`를 주고, 캐시는 바깥의 `"use cache"` 한 겹으로 둔다. 지금 코드로 빌드한 뒤 위의 `ls`가 `No such file or directory`면 숨은 층이 없다.

### 작업 3. [커밋] 이미지를 바꾼 뒤에도 서버 캐시를 지운다

이미지 주소는 목록(`getProducts`)과 상품(`getProduct`)의 캐시 양쪽에 들어 있다. 이미지를 바꾸면 둘 다 지워야 한다. 그런데 캐시를 지우는 일(`updateTag`)은 Next 서버의 Server Action 안에서만 할 수 있다.

가장 먼저 떠오르는 모양은 "업로드가 끝나면 캐시만 지우는 액션"을 부르는 것이다. 그런데 Server Action은 브라우저에서 함수처럼 부르지만 실제로는 Next 서버의 공개 엔드포인트다. 주소와 액션 id만 알면 로그인하지 않은 누구나 부를 수 있다. 캐시만 지우는 액션은 데이터를 바꾸지는 않지만, 반복해서 부르면 지울 때마다 다음 요청이 API로 가서 부하가 된다. 그렇다고 액션 안에서 관리자인지 따로 확인하면, 권한 판단이 API와 Next 두 곳에 생긴다.

그래서 캐시만 지우는 액션은 두지 않는다. 이미지를 상품에 붙이는 요청(`06`의 `confirm`) 자체를 액션이 API에 보내고, API가 관리자인지 확인해(`AdminGuard`) 실제로 바꾼 뒤에만 지운다. 관리자가 아니면 API가 401·403을 주므로 캐시에 닿지 못한다. 작업 4의 상품 수정도 같은 모양이다.

```ts
// order-console-next/app/admin/products/actions.ts
"use server";

import { updateTag } from "next/cache";
import { PRODUCTS_TAG, productTag } from "@/lib/catalog";

export type ActionResult = { status: number; message: string };

// Server Action: 브라우저에서 함수처럼 부르지만 Next 서버에서 돈다. 주소만 알면 누구나 부를 수 있는 공개 엔드포인트다
// 그래서 "캐시만 지우는" 액션은 두지 않는다. 바꾸는 요청을 액션이 API에 보내고, API가 관리자인지 확인해 실제로 바꾼 뒤에만 지운다
async function failure(res: Response): Promise<ActionResult> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  return { status: res.status, message: Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText) };
}

// 올린 이미지를 상품에 붙인다(06의 confirm). 성공하면 null
export async function confirmProductImage(token: string, id: number, key: string): Promise<ActionResult | null> {
  const res = await fetch(`${process.env.API_URL}/products/${id}/image/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) return failure(res); // 401·403(데모 관리자)·400(이미지가 아니다)이면 캐시를 건드리지 않는다
  // 이미지 주소는 목록(getProducts)과 상품(getProduct)의 캐시 양쪽에 들어 있다
  // updateTag: 지우고, 다음 요청은 옛 값을 보지 않고 새 값을 받을 때까지 기다린다. Server Action에서만 부를 수 있다
  updateTag(PRODUCTS_TAG);
  updateTag(productTag(id));
  return null;
}
```

업로더는 저장소에 올리기(`PUT`)까지는 지금처럼 브라우저가 하고, 확인만 액션으로 바꾼다. 액션은 Next 서버에서 돌아 브라우저 메모리의 토큰을 모르므로 인자로 넘긴다. 실패하면 API의 사유(`이미지 파일이 아니다` 등)로 에러를 던져, 지금처럼 `role="alert"`에 보이게 한다.

```diff
--- a/order-console-next/app/admin/products/product-image-uploader.tsx
+++ b/order-console-next/app/admin/products/product-image-uploader.tsx
@@
 "use client";
 
 import { useMutation, useQueryClient } from "@tanstack/react-query";
-import { authFetch } from "@/lib/api-client";
+import { authFetch, refreshAccessToken } from "@/lib/api-client";
+import { useAuthStore } from "@/lib/auth-store";
 import { useTRPC } from "@/lib/trpc";
+import { confirmProductImage } from "./actions";
 import { useReadOnly } from "./admin-only";
 
 type UploadUrl = { key: string; uploadUrl: string; expiresIn: number };
@@
       });
       const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
       if (!put.ok) throw new Error(`저장소 업로드 실패(${put.status})`);
-      await authFetch(`/products/${productId}/image/confirm`, {
-        method: "POST",
-        headers: { "Content-Type": "application/json" },
-        body: JSON.stringify({ key }),
-      });
+      // 확인(confirm)은 Server Action이 API에 보낸다. 성공하면 같은 액션이 서버 캐시까지 지우고, 새로 그린 표를 응답에 실어 온다
+      // 메모리에 토큰이 없으면(새로고침 직후) refresh 쿠키로 받아 온다. 만료로 401이면 한 번만 새로 받아 다시 보낸다
+      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
+      if (!token) throw new Error("로그인이 필요합니다.");
+      let failed = await confirmProductImage(token, productId, key);
+      if (failed?.status === 401 && (token = await refreshAccessToken())) failed = await confirmProductImage(token, productId, key);
+      if (failed) throw new Error(failed.message); // 아래 role="alert"에 사유가 보인다(이미지 파일이 아니다 등)
     },
-    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.list.pathKey() }),
+    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.pathKey() }), // 이 탭의 상점 목록과 상세(byId)
   });
 
   return (
```

`updateTag`는 그 태그가 붙은 캐시 칸을 지운다. Server Action 안에서 캐시를 지우면 Next는 지금 화면을 새로 그려 Server Action의 응답에 함께 실어 보낸다. 그래서 새로고침하지 않아도 새 이미지가 보인다. TanStack Query 쪽은 `trpc.products.pathKey()`로 `products.` 아래 모든 쿼리(목록·`byId`)를 한 번에 지운다.

`confirm` 요청이 이제 브라우저가 아니라 Next 서버에서 나간다. `06`의 `e2e/upload.spec.ts`는 브라우저에서 `/image/confirm` 응답을 기다려 키를 읽었으므로 그대로 두면 그 응답을 끝없이 기다리다 시간 초과로 실패한다. 키는 브라우저가 저장소에 올린 주소에서 읽는다. 저장소 클라이언트가 path style(`forcePathStyle: true`)이라 주소가 `http://localhost:9000/product-images/<키>?…` 모양이다.

```diff
--- a/order-console-next/e2e/upload.spec.ts
+++ b/order-console-next/e2e/upload.spec.ts
@@
   await loginAsKim(page);
   await page.getByRole("link", { name: "관리" }).click();
   const storagePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().startsWith("http://localhost:9000/"));
-  const confirm = page.waitForResponse((r) => r.url().endsWith("/products/6/image/confirm"));
   await page.getByTestId("image-input-6").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));
 
-  expect((await storagePut).status()).toBe(200);
-  const { key } = (await (await confirm).json()) as { key: string };
+  const put = await storagePut;
+  expect(put.status()).toBe(200);
+  // confirm은 Next 서버의 Server Action이 보내므로 브라우저에는 보이지 않는다. 키는 저장소에 올린 주소(path style)에서 읽는다
+  const key = new URL(put.url()).pathname.replace(/^\/product-images\//, "");
   const img = page.getByTestId("image-6").filter({ visible: true });
   await expect(img).toHaveAttribute("src", new RegExp(`^http://localhost:9000/product-images/${key}\\?`));
   await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
```

### 작업 4. [커밋] 상품 수정을 Server Action으로 만든다

```diff
--- a/order-console-next/app/admin/products/actions.ts
+++ b/order-console-next/app/admin/products/actions.ts
@@
 "use server";
 
 import { updateTag } from "next/cache";
+import { redirect } from "next/navigation";
 import { PRODUCTS_TAG, productTag } from "@/lib/catalog";
 
 export type ActionResult = { status: number; message: string };
+export type ProductInput = { name: string; price: number; description: string };
 
 // Server Action: 브라우저에서 함수처럼 부르지만 Next 서버에서 돈다. 주소만 알면 누구나 부를 수 있는 공개 엔드포인트다
 // 그래서 "캐시만 지우는" 액션은 두지 않는다. 바꾸는 요청을 액션이 API에 보내고, API가 관리자인지 확인해 실제로 바꾼 뒤에만 지운다
@@
   updateTag(productTag(id));
   return null;
 }
+
+// 관리자의 상품 수정. 이 앱의 로그인은 브라우저 메모리의 액세스 토큰이라 Next 서버는 누가 관리자인지 모른다
+// → 브라우저가 토큰을 인자로 넘기고, 권한 검사는 API의 AdminGuard가 한다(데모 관리자는 403)
+export async function saveProduct(token: string, id: number, input: ProductInput): Promise<ActionResult> {
+  const res = await fetch(`${process.env.API_URL}/products/${id}`, {
+    method: "PATCH",
+    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
+    body: JSON.stringify(input),
+  });
+  if (!res.ok) return failure(res);
+  // 여기까지 왔으면 API가 자기 Redis를 이미 지웠다 → 그다음에 Next 서버 캐시를 지운다(거꾸로 하면 Redis의 옛 값으로 다시 채운다)
+  updateTag(PRODUCTS_TAG); // 관리자 목록
+  updateTag(productTag(id)); // 이 상품의 상세·팝업·수정 화면. 다른 상품의 상세 캐시는 그대로 둔다
+  redirect("/admin/products"); // 예외를 던져 이동한다 → 이 뒤의 코드는 돌지 않는다. 무효화가 먼저다
+}
```

작업 3의 `confirmProductImage`와 같은 모양이다. 실패 응답을 읽는 `failure`도 함께 쓴다. Next 서버는 누가 관리자인지 모른다. 브라우저가 토큰을 인자로 넘기고, 권한 검사는 API의 `AdminGuard`가 한다. 데모 관리자의 토큰이면 API가 403(`데모 관리자는 볼 수만 있습니다`)을 주고, 그 문장이 폼에 그대로 보인다.

`redirect`는 예외를 던져 이동하므로 그 뒤의 코드는 돌지 않는다. 그래서 무효화가 먼저다.

수정 화면의 지금 값은 상점 상세와 같은 캐시(`getProduct`)에서 꺼낸다.

```tsx
// order-console-next/app/admin/products/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProduct } from "@/lib/catalog";
import { AdminOnly } from "../admin-only";
import { EditProductForm } from "./edit-product-form";

// 지금 값은 상점 상세와 같은 캐시(getProduct, 태그 product-<id>)에서 꺼낸다
// 목록과 달리 connection()이 없어도 빌드 때 API를 부르지 않는다. 인자(id)가 요청의 주소에서 와서 빌드 때는 알 수 없다
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = Number.isInteger(id) && id > 0 ? await getProduct(id) : null;
  if (!product) notFound();
  return <EditProductForm product={product} />;
}

export default function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-1"><Link href="/admin/products">상품 관리</Link> / 수정</p>
      <h1 className="title mb-8">상품 수정</h1>
      <AdminOnly>
        <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
          <Editor params={params} />
        </Suspense>
      </AdminOnly>
    </main>
  );
}
```

```tsx
// order-console-next/app/admin/products/[id]/edit-product-form.tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import type { CatalogProduct } from "@/lib/catalog";
import { useTRPC } from "@/lib/trpc";
import { saveProduct } from "../actions";
import { useReadOnly } from "../admin-only";

// 저장은 Server Action(saveProduct)이 하고, 성공하면 서버가 목록으로 보낸다(redirect)
// 실패하면 입력값을 그대로 두고 사유를 role=alert로 읽어 준다
export function EditProductForm({ product }: { product: CatalogProduct }) {
  const readOnly = useReadOnly();
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [description, setDescription] = useState(product.description);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readOnly) return;
    setError(null);
    startTransition(async () => {
      // 메모리에 토큰이 없으면(새로고침 직후) refresh 쿠키로 받아 온다. 만료로 401이면 한 번만 새로 받아 다시 보낸다
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) return setError("로그인이 필요합니다.");
      const input = { name: name.trim(), price: Number(price), description: description.trim() };
      // 이 브라우저의 TanStack Query(상점 목록·상세의 재고)도 지운다. 성공하면 바로 이동하므로 먼저 지운다
      void queryClient.invalidateQueries({ queryKey: trpc.products.pathKey() });
      let result = await saveProduct(token, product.id, input);
      if (result.status === 401 && (token = await refreshAccessToken())) result = await saveProduct(token, product.id, input);
      setError(result.message); // 성공하면 redirect로 이 줄에 오지 않는다
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-6">
      <label className="grid gap-1">
        <span className="label">이름</span>
        <input className="border border-line-strong bg-bg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={100} disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid gap-1">
        <span className="label">가격(원)</span>
        <input className="num border border-line-strong bg-bg px-3 py-2" inputMode="numeric" pattern="[0-9]+" value={price} onChange={(e) => setPrice(e.target.value)}
          required disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid gap-1">
        <span className="label">설명</span>
        <textarea className="min-h-32 border border-line-strong bg-bg px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)}
          maxLength={2000} disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      {error && <p role="alert" className="alert">{error}</p>}
      <p>
        {/* 저장 중에는 disabled 대신 aria-disabled. 포커스를 잃지 않게 하고, 두 번 누름은 pending으로 막는다 */}
        <button type="submit" className="btn btn-primary" disabled={readOnly} aria-disabled={pending}>
          {pending ? "저장하는 중…" : "저장"}
        </button>
      </p>
    </form>
  );
}
```

API가 거절하면(400, 403) 입력값을 둔 채 사유를 `role="alert"`로 알린다. 저장 중에는 `22`와 같은 이유로 `disabled` 대신 `aria-disabled`를 쓴다. 데모 관리자는 처음부터 입력과 저장이 꺼져 있다(`disabled`). 화면에서 끄는 것은 안내이고, 막는 것은 API다.

표에 수정 링크를 더한다.

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
+import Link from "next/link";
 import { connection } from "next/server";
 import { Suspense } from "react";
 import { getProducts } from "@/lib/catalog";
@@
           <th scope="col" className="label hidden py-3 font-normal sm:table-cell">재고</th>
           <th scope="col" className="label hidden py-3 font-normal sm:table-cell">입고·조정</th>
           <th scope="col" className="label py-3 font-normal">이미지</th>
+          <th scope="col" className="sr-only">수정</th>
         </tr>
       </thead>
       <tbody>
@@
             <td className="num hidden py-3 sm:table-cell" data-testid={`price-${p.id}`}>{won(p.price)}</td>
             <StockCell productId={p.id} name={p.name} />
             <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} /></td>
+            <td className="py-3 text-right"><Link href={`/admin/products/${p.id}`} aria-label={`${p.name} 수정`}>수정</Link></td>
           </tr>
         ))}
       </tbody>
```

### 개념 | 목록 태그와 상품별 태그

상품 6의 가격을 고치면 지워야 할 Next 서버 캐시 칸은 둘이다. 목록 칸 하나(`getProducts()`)와 상품 6의 칸(`getProduct(6)`)이다. 상품 5의 칸은 그대로여야 한다. 태그를 어떻게 붙이느냐에 따라 지워지는 칸이 다르다.

| 태그를 붙이는 법 | 상품 6을 고친 뒤 `updateTag(...)` | 지워지는 칸 | 문제 |
|---|---|---|---|
| 모든 칸에 `products` 하나 | `products` | 목록, 상품 1~66 전부 | 상품 하나 고칠 때마다 모든 상세의 캐시를 버린다. 다음 방문마다 API를 부른다 |
| 상품 칸에만 `product-<id>` | `product-6` | 상품 6 | 목록은 그대로다. 관리자 목록에 옛 가격이 남는다 |
| 목록은 `products`, 상품은 `product-<id>`(이 문서) | `products`, `product-6` | 목록, 상품 6 | 없다 |

태그는 "무엇이 바뀌었나"를 이름 붙이는 것이다. 목록은 어느 상품이 바뀌어도 바뀌므로 목록 전체의 태그를, 상세는 그 상품이 바뀔 때만 바뀌므로 상품별 태그를 단다. `next/cache`의 `updateTag` 문서의 예도 같은 모양이다(`posts`와 `post-<id>`).

Redis는 반대로 해시 하나를 통째로 지운다(2장). Redis의 칸은 API가 다시 채우는 데 싸고(조립 한 번), 상품을 고치는 일이 드물어서다. Next 서버의 칸은 그보다 비싸다(API 왕복 + 렌더링). 같은 "지울 곳"이라도 다시 채우는 비용에 따라 지우는 단위가 다르다.

### 작업 5. [확인] 빌드해 띄우고 브라우저로 고쳐 본다

웹을 다시 빌드해 띄운다(8장 작업 7과 같은 명령). kim으로 로그인해 관리자 화면에서 마우스의 `수정`을 누르고, 가격을 31,000원으로 저장한다.

1. 저장하면 상품 관리 목록으로 돌아가고 31,000원이다
2. 위쪽 메뉴의 `상품`을 누르면 상점 목록도 31,000원이다
3. 마우스를 누르면 팝업도 31,000원이다

마우스 가격을 30,000원으로 되돌려 저장한다. 다른 e2e가 시드 값(30,000원)을 전제한다.

### 실험 | updateTag를 뺀다

<!-- 검증 안 됨: 새로 쓴 절 -->

두 실험을 쌓는다. 이 실험으로 `updateTag` 두 줄을 주석 처리하고, 다음 실험에서 그 자리에 `revalidatePath`를 더한다. 끝나면 작업 6의 `[원복]` 하나로 함께 되돌린다. `git status`가 깨끗한지 보고 시작한다.

```diff
--- a/order-console-next/app/admin/products/actions.ts
+++ b/order-console-next/app/admin/products/actions.ts
@@
     return { status: res.status, message: Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText) };
   }
   // 여기까지 왔으면 API가 자기 Redis를 이미 지웠다 → 그다음에 Next 서버 캐시를 지운다(거꾸로 하면 Redis의 옛 값으로 다시 채운다)
-  updateTag(PRODUCTS_TAG); // 관리자 목록
-  updateTag(productTag(id)); // 이 상품의 상세·팝업·수정 화면. 다른 상품의 상세 캐시는 그대로 둔다
+  // updateTag(PRODUCTS_TAG); // 관리자 목록
+  // updateTag(productTag(id)); // 이 상품의 상세·팝업·수정 화면. 다른 상품의 상세 캐시는 그대로 둔다
   redirect("/admin/products"); // 예외를 던져 이동한다 → 이 뒤의 코드는 돌지 않는다. 무효화가 먼저다
 }
```

웹을 다시 빌드해 띄운다. 관리자 목록을 한 번 열어(목록 칸을 30,000원으로 채운다) 작업 5처럼 마우스를 32,000원으로 저장하고 본다.

| 볼 곳 | 보이는 가격 | 왜 |
|---|---|---|
| 저장 직후 관리자 목록 | 30,000원(옛 값) | Next 서버의 목록 칸이 그대로다 |
| 관리자 목록 새로고침 | 30,000원(옛 값) | 새로고침해도 같은 칸을 읽는다 |
| `curl -s localhost:4000/products/6 \| jq .price` | 32000 | API와 Redis는 새 값이다 |
| 1분 뒤 새로고침 두 번 | 30,000원 → 32,000원 | `revalidate: 60`이 지나면 첫 요청은 옛 값을 받고 그동안 뒤에서 새로 받는다 |

### 실험 | revalidatePath로 바꾼다

<!-- 검증 안 됨: 새로 쓴 절 -->

`updateTag` 대신 경로를 지정한다. 경로를 지정하면 그 경로를 그릴 때 쓴 캐시가 지워진다.

```diff
--- a/order-console-next/app/admin/products/actions.ts
+++ b/order-console-next/app/admin/products/actions.ts
@@
 "use server";
 
-import { updateTag } from "next/cache";
+import { revalidatePath, updateTag } from "next/cache";
 import { redirect } from "next/navigation";
 import { PRODUCTS_TAG, productTag } from "@/lib/catalog";
 
@@
     return { status: res.status, message: Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText) };
   }
   // 여기까지 왔으면 API가 자기 Redis를 이미 지웠다 → 그다음에 Next 서버 캐시를 지운다(거꾸로 하면 Redis의 옛 값으로 다시 채운다)
-  updateTag(PRODUCTS_TAG); // 관리자 목록
-  updateTag(productTag(id)); // 이 상품의 상세·팝업·수정 화면. 다른 상품의 상세 캐시는 그대로 둔다
+  // updateTag(PRODUCTS_TAG); // 관리자 목록
+  // updateTag(productTag(id)); // 이 상품의 상세·팝업·수정 화면. 다른 상품의 상세 캐시는 그대로 둔다
+  revalidatePath("/admin/products"); // 바꿔보기: 데이터(태그) 대신 화면(경로)을 지정한다
   redirect("/admin/products"); // 예외를 던져 이동한다 → 이 뒤의 코드는 돌지 않는다. 무효화가 먼저다
 }
```

이 diff는 원본에서 바로 비교한 것이다. 앞 실험의 주석 처리 위에 `import`와 `revalidatePath` 한 줄을 더하면 이 모양이 된다. 웹을 다시 빌드해 띄우고(서버 메모리가 비어 모든 화면이 32,000원에서 시작한다), 상점에서 마우스 팝업을 한 번 열어 둔 뒤(상품 6의 칸을 채운다) 관리자 화면에서 33,000원으로 저장한다.

| 볼 곳 | 보이는 가격 | 왜 |
|---|---|---|
| 저장 직후 관리자 목록 | 33,000원 | `/admin/products`를 그릴 때 쓴 캐시(`getProducts`)가 지워졌다 |
| 마우스 수정 화면(`/admin/products/6`) | 32,000원(옛 값) | 다른 경로다. `getProduct(6)`의 칸은 그대로다 |
| 상점 상세(`/shop/6`)를 새로 열기 | 32,000원(옛 값) | 같은 이유 |

경로 방식은 "어느 화면을 새로 그릴까"를 정하고, 태그 방식은 "어느 데이터가 바뀌었나"를 정한다. 상품 데이터를 쓰는 화면이 하나 늘 때마다 경로 방식은 저장 코드에 그 경로를 더해야 한다(`/admin/products/6`, `/shop/6`, 다음에 생길 화면). 태그 방식은 새 화면이 `getProduct`를 쓰기만 하면 같이 지워진다. 그래서 태그를 쓴다.

### 작업 6. [원복] 실험 코드를 되돌린다

```sh
# 저장소 루트에서
git restore order-console-next/app/admin/products/actions.ts
git status --short
```

`git status --short`가 아무것도 찍지 않으면 실험 전과 같다. 웹을 다시 빌드해 띄우고, 관리자 화면에서 마우스 가격을 30,000원으로 되돌려 저장한다. 실험을 건너뛰었어도 이 명령은 실패하지 않는다.

### 용어 | Next 캐시 API

- `cacheComponents: true`(`next.config.ts`): `"use cache"`와 부분 사전 렌더링을 켠다
- `"use cache"`: 함수·컴포넌트 첫 줄에 두면 결과를 캐시한다. 키는 빌드, 함수, 인자다. 인자와 결과는 직렬화할 수 있는 값만. 안에서 `cookies()`·`headers()`를 부를 수 없다
- `cacheTag(...tags)`: 지금 캐시 칸에 이름표를 붙인다. 한 번에 128개, 하나에 256자까지
- `cacheLife({ stale, revalidate, expire })`: 초 단위. 빼면 기본값(5분·15분·만료 없음). `expire`가 5분보다 짧으면 미리 그리지 않는다
- `updateTag(tag)`: Server Action에서만. 지우고, 다음 요청은 새 값을 기다린다
- `revalidateTag(tag, "max")`: Route Handler에서도 된다. 옛 값을 주면서 뒤로 새로 받는다. 인자 하나짜리 형태는 더 쓰지 않는다
- `revalidatePath(path)`: 그 경로를 그릴 때 쓴 캐시를 지운다. 같은 태그를 쓰는 다른 경로는 그대로다
- `connection()`: 이 뒤의 코드는 요청이 왔을 때만 돈다
- `instant = false`(레이아웃·페이지에서 내보낸다): 그 아래의 정적 셸 검사를 끈다

### 개념 | 서버 캐시는 어디에 있는가

`next start`로 띄운 서버에서 `"use cache"`의 결과는 그 프로세스의 메모리(LRU, 기본 50MB)에 있다. 서버를 다시 띄우면 비고, 다시 빌드하면 빌드가 바뀌어 키가 달라진다. 웹 서버를 두 대 띄우면 캐시도 두 벌이고, `updateTag`는 요청을 받은 한 대의 캐시만 지운다.

```text
웹 서버 A: updateTag("products") → A의 칸이 지워진다
웹 서버 B: 아무 일도 없다 → revalidate(1분)가 지나야 새로 받는다
```

이 점은 Redis와 다르다. Redis는 모든 API 서버가 같은 캐시를 보므로 `DEL` 한 번으로 끝난다.

> 여러 대에서 Next 캐시를 함께 쓰려면 `cacheHandlers`로 저장소를 바꾼다. 이 앱은 웹 서버가 한 대(`18`)라 기본값으로 둔다.

### 남길 것

- **찾아보면 되는 것**: `cacheTag`·`cacheLife`의 인자, `updateTag`와 `revalidateTag`·`revalidatePath`의 차이, `connection()`, tRPC의 `pathKey()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - Server Action은 누구나 부를 수 있는 공개 엔드포인트다. 캐시만 지우는 액션을 두지 말고, 바꾸는 요청을 API에 보내 권한 확인과 변경이 성공한 뒤에만 지운다.

  - 지울 때는 화면(경로)이 아니라 데이터(태그)로 지운다. 목록에는 목록 전체의 태그를, 상세에는 상품별 태그를 단다. 둘을 나누지 않으면 너무 많이 지우거나 덜 지운다.

  - `"use cache"` 함수는 인자가 없으면 빌드 중에도 돈다. 요청이 와야 하는 일이면 그 앞에 `await connection()`을 둔다.

  - 서버가 그린 화면 안에도 매번 받아야 하는 칸(재고)은 Client Component로 남긴다. 누가 보는지(관리자·데모 관리자)를 서버가 모르면 그 판단도 브라우저에 두고, 막는 것은 API가 한다.

  - 캐시 층이 숨어 있을 수 있다(`fetch`의 디스크 캐시). 캐시는 한 겹으로 두고 나머지는 끈다.

- **에러 신호**:

  - `Error occurred prerendering page "/admin/products"`, `connect ECONNREFUSED`(API 주소) → `getProducts()` 앞에 `await connection()`이 있는지

  - 새로 띄운 웹 서버가 옛 값을 보여 준다 → `.next/cache/fetch-cache`가 있는지. 안쪽 `fetch`에 `cache: "no-store"`

  - 저장했는데 관리자 목록이 새로고침해도 옛 가격 → Server Action의 `updateTag(PRODUCTS_TAG)`

  - 관리자 목록은 새 값인데 상세·수정 화면이 옛 값 → `updateTag(productTag(id))`. `revalidatePath`로 목록 경로만 지우지 않았는지

  - 이미지를 올렸는데 관리자 표의 이미지가 그대로다 → 업로더가 확인을 `confirmProductImage`(Server Action)로 보내는지

  - `e2e/upload.spec.ts`가 `/image/confirm` 응답을 기다리다 시간 초과 → confirm은 Next 서버가 보낸다. 키를 저장소 `PUT` 주소에서 읽는다

  - 관리자 표의 재고가 비어 있다 → `StockCell`의 `products.byId`가 실패했다. API를 8장 작업 2의 코드로 다시 빌드했는지

## 10. 9단계: 세 겹의 캐시, 수정 한 번이 지울 곳

### 개념 | 상품 하나의 복사본이 있는 곳

관리자가 마우스의 가격이나 설명을 바꾸면 그 값의 복사본이 있는 곳은 이렇다.

| 층 | 있는 곳 | 키·태그 | 누가 지우나 | 빠뜨리면 |
|---|---|---|---|---|
| Redis 카탈로그 | API 서버들이 함께 보는 Redis | 해시 `catalog`의 `list:*`, `product:<id>` | API `PATCH /products/:id`의 `cache.invalidate()` | 상점 목록·상세·관리자 화면 모두 최대 60초(TTL) 옛 값 |
| Next 서버 목록 | 웹 서버 메모리 | `getProducts()`, 태그 `products` | Server Action의 `updateTag(PRODUCTS_TAG)` | 관리자 목록이 새로고침해도 옛 값(최대 1분 뒤 새로 받기 시작) |
| Next 서버 상품 | 웹 서버 메모리 | `getProduct(id)`, 태그 `product-<id>` | Server Action의 `updateTag(productTag(id))` | 상점 상세·팝업·수정 화면이 옛 값 |
| Next 브라우저 라우터 캐시 | 브라우저 메모리(본 페이지의 렌더링 결과) | 경로 | Server Action이 캐시를 지우면 응답에서 함께 새로 그린다 | 뒤로 가기·링크 이동에서 옛 화면(최소 30초) |
| TanStack Query | 브라우저 메모리 | `products.list`(상점 목록), `products.byId`(재고 칸·담기) | 수정 폼의 `invalidateQueries(trpc.products.pathKey())` | 같은 탭의 상점이 최대 30초(`staleTime`) 옛 값 |

재고는 이 표에 없다. 재고는 Redis에도 Next 서버에도 넣지 않았으므로 결제·입고 조정이 지울 서버 캐시가 없다. 남는 것은 브라우저의 `staleTime`(30초)뿐이고, 입고·조정은 그 칸을 `setQueryData`로 직접 고친다(9장 작업 2).

순서도 있다. 아래층(Redis)이 먼저 지워져야 위층이 새로 받을 때 새 값을 받는다. Server Action은 API가 응답한 뒤에(API가 이미 Redis를 지운 뒤에) `updateTag`를 부른다. 반대로 하면 Next 서버가 다시 채우는 순간 Redis의 옛 값을 받아 1분 더 들고 있는다.

수정 말고 다른 쓰기도 같은 표로 따진다.

| 쓰기 | Redis | Next 서버 목록·상품 | 브라우저 |
|---|---|---|---|
| 관리자 수정(9장) | API가 지운다 | Server Action이 둘 다 지운다 | 수정 폼이 지운다 |
| 이미지 교체(`06`) | API가 지운다 | `confirmProductImage`가 둘 다 지운다 | 업로더가 지운다 |
| 재고 입고·조정(`22`), 결제(`02`), 미결제 취소(`14`) | 캐시에 없다 | 캐시에 없다 | 입고·조정만 `setQueryData`. 결제는 `staleTime`이 지나면 |
| 시드·매일 초기화(`21`) | 시드가 지운다(2장 작업 4) | 지우지 않는다. `revalidate`(1분) 뒤 새로 받기 시작하고 `expire`(9분)면 버린다 | 다음 방문 때 |

<!-- 검증 안 됨: 새로 쓴 절 -->

시드는 Next 서버의 캐시를 지우지 못한다. `updateTag`는 Server Action 안에서만 부를 수 있고, 시드는 Next 밖에서 도는 스크립트다. 초기화가 새벽에 돌아 바로 보일 필요가 없으므로 `cacheLife`에 맡긴다. 바로 지워야 한다면 웹에 `revalidateTag(tag, "max")`를 부르는 Route Handler를 비밀 값으로 막아 두고, 초기화 스크립트가 그 주소를 부른다. 이 문서에서는 만들지 않는다.

### 작업 1. [커밋] 수정 한 번을 e2e로 지킨다

`e2e/admin-edit.spec.ts`가 이 표를 지킨다. 상점 목록과 상세 팝업을 먼저 열어 TanStack Query와 Next 서버의 상품 칸을 채워 둔다. 그다음 관리자 화면에서 가격과 설명을 저장하면, 목록·상점(페이지를 새로 받지 않는 링크 이동)·상세가 모두 새 값이어야 한다. 끝나면 시드 값으로 되돌린다(다른 e2e가 그 값을 전제한다). 되돌리기도 수정 폼으로 한다. API로 직접 되돌리면 위 표의 Redis만 지워지고 Next 서버의 상품 칸은 바꾼 값으로 남아, 다음에 도는 `e2e/product-detail.spec.ts`가 31,500원과 바꾼 설명을 받고 실패한다. 시드가 Next 서버 캐시를 지우지 못하는 것(위 표)과 같은 일이 테스트 정리 코드에서 일어난다.

```ts
// order-console-next/e2e/admin-edit.spec.ts
import { expect, test, type Page } from "@playwright/test";

// 저장 한 번에 복사본이 있는 곳(API의 Redis, Next 서버의 목록·상품 캐시, 브라우저의 TanStack Query)이 모두 새 값이어야 한다
const MOUSE = { name: "마우스", price: 30000, description: "손에 맞는 크기의 유선 마우스입니다. 버튼 두 개와 휠 하나, 군더더기가 없습니다." };

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

// 다른 테스트가 마우스의 시드 값(30,000원, 설명)을 전제한다 → 끝나면 되돌린다
// API(PATCH /products/6)로 되돌리면 Redis만 지워지고 Next 서버의 상품 캐시(product-6)는 바꾼 값으로 남는다
// → 다음 테스트 파일의 상세 화면이 31,500원을 받는다. 되돌리기도 화면의 수정 폼(Server Action)으로 한다
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await loginAsKim(page);
  await page.goto("/admin/products/6");
  await page.getByLabel("이름").fill(MOUSE.name);
  await page.getByLabel("가격(원)").fill(String(MOUSE.price));
  await page.getByLabel("설명").fill(MOUSE.description);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await page.close();
});

test("가격과 설명을 저장하면 목록·상점·상세가 모두 새 값이다", async ({ page }) => {
  await loginAsKim(page);
  // 상점 목록과 상세 팝업을 먼저 열어 TanStack Query와 Next 서버 캐시(product-6)를 채워 둔다
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await expect(mouse).toContainText("30,000원");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toContainText("유선 마우스");
  await page.keyboard.press("Escape");

  await page.goto("/admin/products");
  await expect(page.getByTestId("price-6")).toHaveText("30,000원");
  await page.getByRole("link", { name: "마우스 수정" }).click();
  await page.getByLabel("가격(원)").fill("31500");
  await page.getByLabel("설명").fill("가격을 고친 마우스입니다.");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page).toHaveURL(/\/admin\/products$/); // Server Action의 redirect
  await expect(page.getByTestId("price-6")).toHaveText("31,500원"); // updateTag(PRODUCTS_TAG)
  await page.getByRole("link", { name: "상품" }).first().click(); // 페이지를 새로 받지 않고 상점으로(브라우저 캐시가 남아 있는 이동)
  await expect(page.getByRole("listitem").filter({ hasText: "마우스" })).toContainText("31,500원"); // invalidateQueries
  await page.goto("/shop/6");
  await expect(page.getByTestId("product-detail")).toContainText("가격을 고친 마우스입니다."); // updateTag(productTag(6))
});

test("API가 거절하면 목록으로 가지 않고, 입력값을 둔 채 사유를 알린다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin/products/6");
  await page.getByLabel("이름").fill("   "); // 브라우저의 required는 통과하지만, 앞뒤 공백을 지우면 빈 이름이라 API가 400을 준다
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "name" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/6$/);
  await expect(page.getByLabel("가격(원)")).not.toHaveValue("");
});

test("데모 관리자는 수정 화면을 볼 수 있지만 입력과 저장이 꺼져 있다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.goto("/admin/products/6");
  await expect(page.getByTestId("read-only-note")).toBeVisible();
  await expect(page.getByLabel("가격(원)")).toBeDisabled();
  await expect(page.getByRole("button", { name: "저장" })).toBeDisabled();
});
```

API와 웹이 떠 있는 상태에서 돌린다. `playwright.config.ts`는 이미 떠 있는 웹(3000번)을 그대로 쓴다. 웹을 이 장의 코드로 다시 빌드해 띄웠는지 먼저 본다.

```sh
# order-console-next/에서
npx playwright test e2e/admin-edit.spec.ts e2e/product-detail.spec.ts e2e/upload.spec.ts e2e/stock-adjust.spec.ts e2e/demo-login.spec.ts
# 출력(줄임)
  13 passed (16.5s)
```

> 이 표는 같은 탭 안의 이야기다. 다른 사용자의 브라우저에 있는 TanStack Query는 지울 수 없다. 그 브라우저는 `staleTime`이 지나거나 창을 다시 볼 때 새로 받는다. 서버에서 밀어 주려면 WebSocket(`04`의 알림 게이트웨이)으로 "상품이 바뀌었다"를 알려야 한다.

### 남길 것

- **찾아보면 되는 것**: 각 층을 지우는 함수 이름(`invalidate`, `updateTag`, `invalidateQueries`, `setQueryData`). 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 캐시가 한 겹 늘면 지울 곳도 한 곳 는다. 쓰기마다 지울 곳을 표로 적어 두고, 아래층(Redis)부터 지운다. 거꾸로 하면 위층이 옛 값을 다시 채운다.

  - 지울 수 없는 곳(다른 사용자의 브라우저, Next 밖에서 도는 시드)은 수명(`staleTime`, `cacheLife`)이 정한다. 그 수명이 곧 "틀린 값을 얼마나 참을 수 있는가"다.

- **에러 신호**:

  - `admin-edit.spec.ts` 다음에 돈 테스트의 상세가 31,500원·바꾼 설명(`Expected substring: "유선 마우스"`) → 되돌리기를 API가 아니라 수정 폼(Server Action)으로 하는지

  - 관리자 화면은 새 가격인데 같은 탭의 상점은 옛 가격 → 수정 폼의 `invalidateQueries(trpc.products.pathKey())`

  - 초기화 뒤 상세에 옛 설명이 몇 분 보인다 → Next 서버 캐시는 시드가 지우지 못한다. `cacheLife`의 `revalidate`·`expire`를 기다린다

## 11. 디버깅

### 진단 1. 시드나 부하용 상품을 다시 넣었는데 옛 목록이 보인다

시드는 끝에서 Redis 카탈로그를 지운다. 끝 줄의 `카탈로그 캐시 …`를 본다. `load-seed.sql`처럼 psql로 넣은 것은 지우지 않으므로 손으로 지운다.

```sh
# 저장소 루트에서
docker compose exec redis redis-cli DEL catalog
```

웹 화면(관리자 목록·상세)이라면 Next 서버 캐시도 있다. 웹 서버를 다시 띄우면 빈다.

### 진단 2. 캐시가 맞게 도는지 본다

```sh
# 저장소 루트에서
curl -s localhost:4000/metrics | grep '^catalog_'
docker compose exec redis redis-cli HKEYS catalog
docker compose exec redis redis-cli TTL catalog
```

`hit`이 늘지 않고 `miss`만 늘면 누군가 계속 지우고 있다. `error`가 늘면 Redis에 닿지 않는다. `HKEYS`가 빈 목록이면 지워진 직후거나 아직 아무도 읽지 않았다. `TTL`이 `-2`면 키가 없다.

### 진단 3. 목록이 응답하지 않는다

Redis가 떠 있는지 본다(`docker compose ps redis`). 캐시 연결 설정이 기본값으로 돌아갔으면 Redis를 기다리느라 멈춘다(6장).

### 진단 4. `next build`가 정적 셸 오류로 멈춘다

Cache Components는 요청을 기다리는 코드가 `<Suspense>` 밖에 있으면 빌드를 멈춘다. 이 앱은 루트 레이아웃의 `instant = false`로 피한다. 그 줄이 빠졌는지 본다.

### 진단 5. `next build`가 `connect ECONNREFUSED`(API 주소)로 멈춘다

인자 없는 `"use cache"` 함수가 빌드 중에 실행됐다. 부르는 컴포넌트에서 그보다 먼저 `await connection()`을 둔다.

### 진단 6. 새로 띄운 웹 서버가 옛 값을 보여 준다

`.next/cache/fetch-cache`가 있는지 본다. 있으면 어딘가의 `fetch`가 기본값으로 캐시되고 있다. `cache: "no-store"`를 주고, 그 폴더를 지운 뒤 다시 빌드한다.

### 진단 7. 어느 층이 옛 값을 들고 있는지 가른다

<!-- 검증 안 됨: 새로 쓴 절 -->

아래에서 위로 하나씩 본다. 처음으로 새 값이 나오는 층의 바로 위가 옛 값을 들고 있는 층이다.

| 순서 | 볼 곳 | 명령·방법 | 옛 값이면 |
|---|---|---|---|
| 1 | DB | `docker compose exec -T db psql -U order -d order_api -c "SELECT price, description FROM products WHERE id = 6"` | 저장 자체가 안 됐다. API 응답(400·403)을 본다 |
| 2 | API(Redis 뒤) | `curl -s localhost:4000/products/6 \| jq .price` | Redis 칸이 안 지워졌다(4장) |
| 3 | Next 서버 | 다른 브라우저(시크릿 창)로 `/shop/6`·`/admin/products`를 연다 | `updateTag` 누락(9장) |
| 4 | 이 탭 | 새로고침 | 새로고침으로 새 값이면 TanStack Query·라우터 캐시다(10장) |

### 진단 8. pg_stat_statements가 없다고 나온다

compose의 `command`(`shared_preload_libraries`)를 더한 뒤에는 DB 컨테이너를 다시 만들어야 읽힌다(`docker compose up -d`). 그다음 `CREATE EXTENSION`을 한 번 한다.

### 진단 9. 에러 신호 모아 보기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `relation "pg_stat_statements" does not exist` | 확장을 DB에 만들지 않았다 | `CREATE EXTENSION`(진단 8) | 1장 |
| `pg_stat_statements must be loaded via "shared_preload_libraries"` | 서버가 뜰 때 확장을 읽지 않았다 | compose의 `command`, DB 컨테이너를 다시 만들었는지(진단 8) | 1장 |
| 시드나 `load-seed.sql`을 넣었는데 옛 목록이 보인다 | DB를 직접 바꾼 쓰기는 API의 무효화를 거치지 않는다 | 시드 끝 줄의 `카탈로그 캐시 …`, `redis-cli DEL catalog`(진단 1) | 2장 |
| 테스트 DB의 상품이 개발 화면에 보인다 | e2e와 개발 서버가 같은 Redis 키를 쓴다 | `test/setup-env.ts`의 `CATALOG_CACHE_KEY` | 2장 |
| `Property 'catalogCache' is missing` | tRPC 컨텍스트 타입에 칸이 늘었다 | 컨텍스트를 직접 만드는 `test/trpc.e2e-spec.ts` | 2장 |
| `curl …/metrics \| grep '^catalog_'`가 아무것도 찍지 않는다 | 떠 있는 API가 캐시 코드 전이다 | API를 다시 빌드해 띄웠는지 | 2장 |
| 지표에서 `hit`이 늘지 않고 `miss`만 는다 | 누군가 계속 지우고 있다 | `invalidate()`를 부르는 곳(진단 2) | 2장 |
| 결제가 늘자 캐시 적중률이 크게 떨어진다 | 자주 바뀌는 칸까지 캐시하고 쓰기마다 지운다 | 캐시에 재고가 들어 있는지 | 3장 |
| 품절인데 재고 1이 보이고 결제가 409 | 지운 직후 옛 재고가 다시 캐시에 들어갔다 | 재고를 캐시에서 빼고 DB에서 읽는다 | 3장 |
| k6가 `browse.js`를 찾지 못한다(`no such file or directory`) | 다른 폴더에서 쳐서 빈 폴더가 붙었다 | `order-api-nest/`에서 쳤는지 | 3장 |
| `Error: kim으로 로그인하지 못했다(401)` | 부하 시나리오의 준비(로그인)가 틀렸다 | 시드, API의 `DEMO_PASSWORD` | 3장 |
| `Error: kim으로 로그인하지 못했다(0)` | k6 컨테이너가 API에 닿지 않았다 | `-e API=http://host.docker.internal:4000`, `--add-host` | 3장 |
| `Error: 부하용 상품이 없다. loadtest/load-seed.sql을 넣었는지 본다` | 결제할 상품이 없어 재지 않고 멈췄다 | 1장 작업 2의 `load-seed.sql` | 3장 |
| `thresholds on metrics 'checks' have been crossed`, `✗ 결제 201` | 요청은 나갔지만 결제가 실패했다. 이 결과는 표에 옮기지 않는다 | Stripe 시뮬레이터, `STRIPE_SIMULATOR_URL` | 3장 |
| API는 새 가격을 저장했다는데 목록은 옛 가격 | 그 쓰기 경로가 Redis를 지우지 않았다 | `cache.invalidate()`, `redis-cli TTL catalog` | 4장 |
| 캐시를 비운 뒤 요청 200개에 `catalog_loads_total`이 100 안팎 는다 | 빈 캐시를 본 요청이 각자 DB로 갔다 | `getOrLoad`의 `inflight` | 5장 |
| `Error: Cannot find module '…/order-api-nest/scripts/cache-stampede.mjs'` | 스크립트가 그 자리에 없다 | 파일 위치(`order-api-nest/order-api-nest/`에 만들지 않았는지), 친 폴더 | 5장 |
| Redis를 멈추자 `GET /products`가 30초 넘게 응답 없음(`000`) | ioredis가 명령을 쌓아 두고 다시 붙기를 기다린다 | 캐시 연결의 `enableOfflineQueue`·`maxRetriesPerRequest`·`commandTimeout`(진단 3) | 6장 |
| `catalog_cache_requests_total{result="error"}`가 는다 | Redis에 닿지 않는다(목록은 DB로 돈다) | Redis가 떠 있는지 | 6장 |
| `Error: Route "/_not-found": Next.js encountered uncached or runtime data during prerendering.`(경로는 다를 수 있다) | 정적 셸 검사가 요청 시점 데이터를 만났다 | 루트 레이아웃의 `instant = false`(진단 4) | 7장 |
| `Object literal may only specify known properties, and 'description' does not exist`, ``Unknown argument `description` `` | 마이그레이션은 했는데 Prisma Client가 옛 모양이다 | `npx prisma generate` | 8장 |
| 팝업이 아니라 늘 전체 페이지로 간다 | 가로채는 라우트가 그려지지 않는다 | `app/shop/layout.tsx`의 `modal`, 폴더 이름 `@modal/(.)[id]` | 8장 |
| 새로고침하면 404, `No default component was found for a parallel route rendered on this page.` | 슬롯의 상태를 모를 때 그릴 것이 없다 | `@modal/default.tsx` | 8장 |
| `/shop`으로 링크 이동했는데 팝업이 남아 있다 | 링크 이동에서는 슬롯이 앞 상태를 유지한다 | `@modal/page.tsx` | 8장 |
| 팝업의 마지막 버튼에서 Tab을 누르면 포커스가 주소창으로 나간다(e2e `Received: false`) | `showModal()`은 뒤쪽만 막고 포커스를 가두지 않는다 | `dialog`의 `onKeyDown={keepTabInside}` | 8장 |
| Esc로 닫으면 두 화면 뒤로 간다 | 닫는 길 둘이 함께 `router.back()`을 불렀다 | 닫기 버튼이 `dialog.close()`를 부르지 않는지 | 8장 |
| `Error occurred prerendering page "/admin/products"`, `connect ECONNREFUSED`(API 주소) | 인자 없는 `"use cache"` 함수가 빌드 중에 API를 불렀다 | `getProducts()` 앞의 `await connection()`(진단 5) | 9장 |
| 새로 띄운 웹 서버가 옛 값을 보여 준다 | `fetch` 응답이 디스크에 따로 캐시됐다 | `.next/cache/fetch-cache`, `cache: "no-store"`(진단 6) | 9장 |
| 저장했는데 관리자 목록이 새로고침해도 옛 가격 | Next 서버의 목록 칸이 그대로다 | Server Action의 `updateTag(PRODUCTS_TAG)` | 9장 |
| 관리자 목록은 새 값인데 상세·수정 화면이 옛 값 | 상품 칸이 그대로다 | `updateTag(productTag(id))`, `revalidatePath`로 바꾸지 않았는지 | 9장 |
| 이미지를 올렸는데 관리자 표의 이미지가 그대로다 | 서버가 캐시한 표가 그대로다 | 업로더가 `confirmProductImage`를 쓰는지 | 9장 |
| `upload.spec.ts`가 `/image/confirm` 응답을 기다리다 시간 초과 | confirm은 이제 Next 서버가 보내 브라우저에 보이지 않는다 | 키를 저장소 `PUT` 주소에서 읽는지 | 9장 |
| 관리자 표의 재고가 비어 있다 | 재고 칸의 `products.byId`가 실패했다 | API를 8장 작업 2의 코드로 다시 빌드했는지 | 9장 |
| `admin-edit.spec.ts` 다음에 돈 테스트의 상세가 바꾼 값(`Expected substring: "유선 마우스"`) | API로 되돌려 Next 서버의 상품 칸이 남았다 | `afterAll`이 수정 폼으로 되돌리는지 | 10장 |
| 관리자 화면은 새 가격인데 같은 탭의 상점은 옛 가격 | 브라우저의 TanStack Query가 그대로다 | 수정 폼의 `invalidateQueries(trpc.products.pathKey())`(진단 7) | 10장 |
| 초기화 뒤 상세에 옛 설명이 몇 분 보인다 | 시드는 Next 서버 캐시를 지우지 못한다 | `cacheLife`의 `revalidate`·`expire`를 기다리거나 웹 서버를 다시 띄운다 | 10장 |

## 12. 완성 확인

### 시험해보기

API와 Stripe 시뮬레이터, 웹을 이 문서의 마지막 코드로 다시 빌드해 띄우고, 시드를 다시 넣고 돌린다.

```sh
# 저장소 루트에서
npm run lint && npm run typecheck
npm run test:api
npm run test:web
```

```sh
# order-api-nest/에서
node scripts/cache-stampede.mjs
```

`npm run test:web`의 Stripe 결제 테스트 하나는 진짜 Stripe 키가 있을 때만 돈다(`22`와 같다).

### 체크리스트

- [ ] 상품 목록·상세의 카탈로그는 Redis에서, 재고는 DB에서 온다. REST와 tRPC가 같은 캐시를 본다
- [ ] 관리자 수정·이미지 교체·시드만 카탈로그 캐시를 지운다. 결제·취소·입고 조정은 지우지 않는다
- [ ] 재고까지 통째로 캐시하면 결제가 늘수록 적중률이 떨어지는 것을 k6로 쟀다
- [ ] 무효화를 빼면 TTL 동안 옛 가격이 보이는 것을 재현했다
- [ ] 캐시가 빈 순간 200개가 와도 DB에서는 한 번 읽는다
- [ ] Redis를 멈춰도 목록이 DB에서 바로 응답한다
- [ ] 목록에서 상품을 누르면 팝업이 뜨고, Esc·닫기·뒤로 가기로 닫히며, 포커스가 팝업 안에 갇혔다가 링크로 돌아온다
- [ ] `/shop/6`을 직접 열면 전체 페이지이고 설명이 보인다. 초기화 뒤에도 설명이 있다
- [ ] 웹이 API 없이 빌드된다. 빌드 표에서 상세 페이지가 `◐`이고 HTML은 요청마다 그린다
- [ ] 관리자가 가격·설명을 저장하면 목록·상점·상세에 새 값이 보이고, `updateTag`를 빼거나 `revalidatePath`로 바꾸면 옛 값이 남는 곳을 재현했다
- [ ] 데모 관리자는 수정 화면을 보지만 입력이 꺼져 있고, API도 403으로 막는다

## 13. 다음 단계

### 자가 점검

1. 상품 한 줄을 통째로 캐시하지 않고 카탈로그와 재고로 나눈 이유는? 결제가 드물 때는 통째로 캐시한 쪽이 더 빨랐는데도 나눈 이유는?

2. 카탈로그 캐시를 페이지마다 다른 키가 아니라 해시 하나의 칸으로 둔 이유는? `EXPIRE … NX`의 `NX`를 빼면 무슨 일이 생기는가?

3. 시드가 캐시를 지워야 하는 이유는? `load-seed.sql`은 왜 지우지 않는가?

4. 이미지의 서명된 주소를 Redis에는 넣지 않았는데 Next 서버 캐시에는 들어간다. 그래서 `cacheLife`에서 무엇을 맞췄는가?

5. 무효화를 빠뜨렸을 때 옛 가격이 "언젠가는" 사라지는 이유는? 그동안 화면 가격과 결제 금액은 어떻게 되는가?

6. single-flight가 없으면 캐시가 빈 순간 200개 중 100개 안팎이 DB로 간 이유는? API를 세 대 띄우면 single-flight가 있어도 몇 번 읽는가?

7. `try/catch`가 있는데도 Redis가 멈추자 목록이 멈춘 이유는?

8. 이 앱에서 Cache Components를 켜고도 정적 HTML을 만들지 않는 이유는? 그러면 Cache Components로 얻는 것은 무엇인가?

9. 상세 페이지는 팝업과 전체 페이지 두 모양이다. 어떤 이동일 때 어느 파일이 그려지는가? 팝업을 닫는 길이 모두 `router.back()`이어야 하는 이유는?

10. 관리자 목록의 `getProducts()` 앞에는 `await connection()`이 있고 상세의 `getProduct(id)` 앞에는 없다. 왜 그래도 되는가?

11. 태그를 `products` 하나로 모든 칸에 붙이면 무엇이 문제인가? `revalidatePath("/admin/products")`로 지우면 어느 화면이 옛 값으로 남는가?

12. 관리자가 가격을 저장하면 지워야 하는 곳과, 지우는 순서가 아래층부터여야 하는 이유는? 웹 서버를 두 대 띄우면 `updateTag`는 어디까지 지우는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- write-through·write-behind 캐시
- 여러 대의 Redis에 걸친 캐시 일관성, 분산 락(Redlock), 여러 서버를 한 번에 묶는 스탬피드 대책
- 읽기 복제본으로 목록 조회 나누기, 전문 검색
- 여러 웹 서버가 함께 쓰는 Next 캐시 저장소(`cacheHandlers`), Next 밖에서 태그를 지우는 Route Handler
- 변경을 WebSocket으로 밀어 다른 사용자의 브라우저 캐시 지우기
- CDN과 HTTP 캐시 헤더(`Cache-Control`, `stale-while-revalidate`)

`20`까지 서비스를 만들고 운영했고, `21`에서 공개 데모로 열었다. `22`와 이 문서에서 면접의 단골 주제인 페이지네이션, 잠금, 캐시를 이 서비스에 적용하고 쟀다.

다음 단계 `24: 무중단 배포`는 사용자가 쓰고 있는 서비스를 내리지 않고 새 버전으로 바꾼다. 배포 도중 옛 코드와 새 코드가 같은 DB와 Redis 캐시를 함께 쓸 때 깨지는 것을 재현하고 막는다. 이 문서의 `description` 칸처럼 칸을 더하는 마이그레이션과 캐시에 든 옛 모양의 값이 그 주제가 된다.

---

## 이 브랜치의 코드 실행

| 폴더 | 확인 명령 |
|---|---|
| 저장소 루트 | `npm ci`, `docker compose up -d`, `npm run lint`, `npm run typecheck`, `npm run test:api`, `npm run test:web` |
| 저장소 루트 | `docker compose exec -T db psql -U order -d order_api -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"` |
| `order-api-nest/` | `npx prisma migrate deploy && npx prisma generate && npx prisma db seed`, `node scripts/stripe-sim.mjs`, `npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js` |
| `order-api-nest/` | `node scripts/cache-stampede.mjs`, `docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run -e API=http://host.docker.internal:4000 -e BUYERS=20 /scripts/browse.js` |
| `order-console-next/` | `npx next build`, `npx playwright test e2e/admin-edit.spec.ts e2e/product-detail.spec.ts` |
