# 23: 캐시

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20Redis%20%7C%20k6-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [22-pagination-locking](https://github.com/seungwoo7050/node-order/tree/22-pagination-locking) 브랜치

상품 카탈로그(이름·가격·설명·이미지 키·카테고리 경로)를 API에서는 Redis에, 화면에서는 Next 서버의 `"use cache"`에 캐시하고, 재고는 캐시하지 않고 요청마다 읽습니다. 상품 설명 칸과 상품 상세(API·화면), 관리자 상품 수정을 더하고, 수정·이미지 교체가 두 캐시를 지우게 합니다.

## 지원 범위

- Redis 카탈로그 캐시(`src/cache/catalog-cache.ts`)
  - 상품 목록 페이지(`list:<cursor>:<limit>`)와 상세(`product:<id>`)를 해시 `catalog` 한 키의 필드로 둠. TTL 60초(`CATALOG_TTL_SECONDS`), 첫 필드를 쓸 때 정함
  - 재고와 서명한 이미지 주소는 캐시하지 않고 요청마다 붙임
  - 관리자 상품 수정, 이미지 교체(confirm), 시드가 `catalog` 키를 지움. 결제·취소·입고 조정은 지우지 않음
  - 같은 칸이 비어 있을 때 한 프로세스 안의 동시 요청은 DB를 한 번만 읽음(single-flight)
  - Redis에 닿지 않으면(명령 제한 100ms) DB에서 읽어 응답(fail-open)
  - 지표: `catalog_cache_requests_total{result="hit|miss|error"}`, `catalog_loads_total`
- 상품 API
  - 상품 설명 칸: 마이그레이션 `0021_product_description`, `catalog.json`의 `description`
  - 목록 항목에 `categoryPath`(루트부터 카테고리 이름 배열)
  - 상세 `GET /products/:id`, tRPC `products.byId`. 없으면 404
  - 관리자 수정 `PATCH /products/:id` `{ name?, price?, description? }`. 데모 관리자는 403
- 화면(`order-console-next`)
  - 상품 상세 `/shop/[id]`: 목록에서 누르면 팝업(`@modal` 병렬 라우트와 가로채기 `(.)[id]`), 주소를 직접 열거나 새로고침하면 전체 페이지. 팝업은 Esc·뒤로 가기로 닫히고 포커스를 팝업 안에 가둠. 없는 상품은 `not-found`
  - 카탈로그는 `lib/catalog.ts`의 `getProduct`(태그 `product-<id>`)·`getProducts`(태그 `products`)가 `"use cache"`로 Next 서버에 둠(`cacheLife` stale·revalidate 60초). 재고와 담기(`buy-box.tsx`)는 브라우저에서
  - 관리자 상품 표는 Server Component가 `getProducts`로 그리고, 재고 칸(`stock-cell.tsx`)과 입고·조정은 브라우저에서
  - 상품 수정 `/admin/products/[id]`와 이미지 확인은 Server Action(`actions.ts`). API가 성공한 뒤에만 `updateTag`로 두 태그를 지우고, 실패하면 입력값을 둔 채 사유를 보여 줌. 데모 관리자에게는 입력·저장이 꺼짐
- 측정 도구
  - 개발 `compose.yaml`의 `db`가 `pg_stat_statements`를 불러옴
  - k6 `loadtest/browse.js`: 목록 보기(`BROWSERS`, 기본 20)와 결제(`BUYERS`, 기본 5)를 함께
  - `scripts/cache-stampede.mjs [N]`: 캐시를 지운 직후 `GET /products` N개(기본 200)를 동시에 보내고 `catalog_loads_total` 증가량을 찍음

## 구성

`22`에서 바뀐 곳만 적습니다.

```text
.
├── compose.yaml                        # db: pg_stat_statements, migrate: REDIS_URL
├── order-api-nest/
│   ├── prisma/
│   │   ├── schema.prisma               # Product.description
│   │   ├── migrations/0021_product_description/
│   │   ├── seed.ts                     # description, 끝에서 카탈로그 캐시를 지움
│   │   └── seed/catalog.json           # 상품 설명
│   ├── src/
│   │   ├── cache/                      # 새 폴더: catalog-cache.ts, catalog-key.ts
│   │   ├── products/                   # product-list.ts(캐시·카테고리 경로·상세), products.controller.ts(상세·수정), update-product.dto.ts(새 파일), product-images.controller.ts(캐시 지우기)
│   │   ├── trpc/                       # products.byId, 컨텍스트에 catalogCache
│   │   ├── metrics/metrics.ts          # 캐시 지표
│   │   └── app.module.ts
│   ├── scripts/cache-stampede.mjs      # 새 파일
│   ├── loadtest/browse.js              # 새 파일
│   └── test/                           # catalog-cache e2e(새 파일), setup-env.ts(테스트용 캐시 키 test:catalog)
├── order-console-next/
│   ├── lib/catalog.ts                  # 새 파일: getProducts, getProduct("use cache")
│   ├── app/shop/                       # layout.tsx, [id]/, @modal/, modal.tsx, product-detail.tsx, buy-box.tsx(새 파일)
│   ├── app/admin/products/             # page.tsx(Server Component), [id]/, actions.ts, admin-only.tsx, stock-cell.tsx(새 파일)
│   └── e2e/                            # product-detail, admin-edit(새 파일), upload 수정
└── README.md
```

## 실행

필요한 도구와 포트는 `22`와 같습니다. `compose.yaml`의 `db` 명령이 바뀌었으므로 `docker compose up -d`가 db 컨테이너를 다시 만듭니다.

```sh
npm ci
docker compose up -d
docker compose exec -T db psql -U order -d order_api -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
cd order-api-nest
npx prisma generate && npx prisma migrate deploy && npx prisma db seed   # 끝에 "카탈로그 캐시 지움"
node scripts/stripe-sim.mjs                                                            # 터미널 1
npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js   # 터미널 2 (:4000)
```

웹은 `order-console-next/`에서 `npx next build && npx next start`(:3000)입니다. 비밀번호 로그인은 `kim`(관리자) / `1234`입니다.

## 테스트

테스트 DB에 마이그레이션을 적용한 뒤 돌립니다.

```sh
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
npm run lint
npm run typecheck
npm run test:api
STRIPE_SIM=1 npm run test:web   # API(시뮬레이터 모드)와 시뮬레이터를 띄운 채로
```

- API e2e `catalog-cache.e2e-spec.ts`: 두 번째 목록은 캐시에서 옴, 재고는 바로 보임, 수정하면 목록·상세가 함께 새 값, REST와 tRPC가 같은 캐시, 동시 50개에 DB 한 번(single-flight), Redis가 없을 때 DB로 응답(fail-open)
- 웹 e2e: `product-detail.spec.ts`(팝업 열고 닫기·포커스, 직접 열면 전체 페이지, 없는 상품), `admin-edit.spec.ts`(저장하면 목록·상점·상세가 새 값, API가 거절하면 사유, 데모 관리자는 꺼짐)
- CI의 작업 구성은 `22`와 같습니다.

부하 측정은 API를 띄운 채 `order-api-nest/`에서 돌립니다.

```sh
docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run -e API=http://host.docker.internal:4000 -e BUYERS=20 /scripts/browse.js
node scripts/cache-stampede.mjs
docker compose exec db psql -U order -d order_api -c "SELECT calls, query FROM pg_stat_statements ORDER BY calls DESC LIMIT 10"
```

## 정리

```sh
docker compose down          # -v를 붙이면 DB·저장소 볼륨도 지움
```
