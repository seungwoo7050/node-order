# 23: 캐시

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20Redis%20%7C%20k6-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [22-pagination-locking](https://github.com/seungwoo7050/node-order/tree/22-pagination-locking) 브랜치

상품 카탈로그를 API 앞의 Redis와 화면 앞의 Next 서버에 캐시하고, 재고는 캐시하지 않습니다. 상품 상세 페이지를 더하고, 관리자 상품 화면을 서버에서 그리며, 수정 한 번이 지울 캐시를 정합니다.

과정 전체(측정, 실험, 에러 신호)는 [guide/README.md](guide/README.md)에 있습니다. 이 문서는 무엇이 있고 어떻게 돌리는지만 적습니다.

## 지원 범위

- Redis 카탈로그 캐시
  - 상품 목록·상세의 이름·가격·설명·이미지 키·카테고리 경로를 해시 `catalog` 한 키에 둠(TTL 60초). 재고와 서명한 이미지 주소는 요청마다
  - 관리자 수정·이미지 교체·시드가 `DEL catalog`. 결제·취소·입고 조정은 지우지 않음
  - 빈 칸을 동시에 읽으면 DB는 한 번(single-flight). Redis에 닿지 않으면 DB로 응답(fail-open)
  - 지표 `catalog_cache_requests_total{result}`, `catalog_loads_total`

- 상품 API
  - `GET /products/:id`, tRPC `products.byId`. 상품 설명 칸 `0021_product_description`
  - 관리자 수정 `PATCH /products/:id { name, price, description }`. 데모 관리자는 403

- 화면
  - 상품 상세 `/shop/[id]`. 목록에서 누르면 팝업, 주소를 직접 열면 전체 페이지. 카탈로그는 `"use cache"`(태그 `product-<id>`), 재고·담기는 브라우저
  - 관리자 상품 표는 Server Component(태그 `products`). 재고 칸과 입고·조정은 브라우저
  - 상품 수정 `/admin/products/[id]`와 이미지 확인은 Server Action. API가 성공한 뒤에만 `updateTag`

- 측정
  - `pg_stat_statements`(compose의 `db`)
  - k6 `loadtest/browse.js`(목록 보기 + 결제), `scripts/cache-stampede.mjs`(캐시가 빈 순간 요청 200개)

## 구성

`22`에서 바뀐 곳만 적습니다.

```text
.
├── compose.yaml                        # pg_stat_statements
├── order-api-nest/
│   ├── prisma/migrations/0021_product_description/
│   ├── prisma/seed.ts                  # 끝에서 카탈로그 캐시를 지움
│   ├── prisma/seed/catalog.json        # 상품 설명
│   ├── src/cache/                      # catalog-cache.ts, catalog-key.ts
│   ├── src/products/                   # product-list.ts, products.controller.ts, update-product.dto.ts
│   ├── scripts/cache-stampede.mjs
│   ├── loadtest/browse.js
│   └── test/catalog-cache.e2e-spec.ts
├── order-console-next/
│   ├── lib/catalog.ts                  # getProducts, getProduct("use cache")
│   ├── app/shop/                       # layout.tsx, [id]/, @modal/, modal.tsx, product-detail.tsx, buy-box.tsx
│   ├── app/admin/products/             # page.tsx, [id]/, actions.ts, admin-only.tsx, stock-cell.tsx
│   └── e2e/                            # product-detail, admin-edit
└── README.md
```

## 실행

```sh
npm ci
docker compose up -d
docker compose exec -T db psql -U order -d order_api -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
cd order-api-nest
npx prisma generate && npx prisma migrate deploy && npx prisma db seed
node scripts/stripe-sim.mjs # 터미널 1
npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js # 터미널 2
```

웹은 `order-console-next/`에서 `npx next build && npx next start`(:3000)입니다. 비밀번호 로그인은 `kim` / `1234`(관리자)입니다.

## 테스트

테스트 DB에 마이그레이션을 적용한 뒤 돌립니다.

```sh
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
npm run lint
npm run typecheck
npm run test:api
STRIPE_SIM=1 npm run test:web # API(시뮬레이터 모드)와 시뮬레이터를 띄운 채로
```

부하 측정은 `order-api-nest/`에서 돌립니다.

```sh
docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run -e API=http://host.docker.internal:4000 -e BUYERS=20 /scripts/browse.js
node scripts/cache-stampede.mjs
```
