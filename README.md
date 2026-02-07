# 22: 페이지네이션과 잠금

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20k6-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [21-public-demo](https://github.com/seungwoo7050/node-order/tree/21-public-demo) 브랜치

전체 행을 돌려주던 목록 API를 cursor 페이지(`{ items, nextCursor }`)로 나누고, 화면의 목록을 무한 스크롤로 바꿉니다. 관리자의 재고 입고·조정을 증가량(`delta`)으로 받는 API와 화면을 더하고, 결제의 재고 차감은 `FOR UPDATE` 비관적 잠금을 유지합니다. 개발용 Stripe 시뮬레이터와 REST API 문서(`/docs`)를 더합니다.

## 지원 범위

- 페이지네이션(기본 20건, `limit` 최대 100)
  - 내 주문 `GET /me/orders`와 tRPC `me.orders`: 같은 함수(`listMyOrders`). 정렬은 `(createdAt, id)` 내림차순, cursor는 그 두 값을 base64url로 담음
  - 전체 주문 `GET /orders`(관리자, 데모 관리자는 403): cursor 외에 `offset`(cursor가 없을 때만)과 `paid=true|false`
  - 상품 `GET /products`와 tRPC `products.list`: 같은 함수(`listProducts`). id 오름차순, cursor는 마지막 상품의 id
  - 잘못된 cursor, 범위 밖 `limit`, 불리언이 아닌 `paid`는 400
  - 인덱스: 마이그레이션 `0020_order_list_indexes`가 `orders(created_at, id)`, `orders(user_id, created_at, id)`를 만들고 `orders(user_id)`를 지움
- 화면
  - 내 주문·상품·관리자 상품 표가 무한 목록(`useInfiniteQuery`, `lib/lists.ts`). `app/load-more.tsx`의 "더 보기" 버튼이 화면에 들어오면 다음 페이지를 부르고, 키보드로도 누를 수 있으며 불러오는 동안 `aria-disabled`. 실패하면 "다시 시도"
  - 주문 상세에서 결제가 확인되면 무한 목록 캐시의 그 주문만 고침(`setQueryData`). 결제·이미지 업로드 뒤 목록 무효화는 `pathKey()`로 모든 페이지에
- 재고
  - 관리자 입고·조정 `POST /products/:id/stock-adjustments` `{ "delta": <정수> }`: `UPDATE ... SET stock = stock + delta WHERE stock + delta >= 0` 한 문장. 음수가 되면 409, 없는 상품 404, `delta`가 0이거나 정수가 아니면 400. 데모 관리자는 403
  - 관리자 상품 화면의 입고 입력칸(`stock-adjuster.tsx`). 데모 관리자에게는 꺼짐
  - 결제(`placeOrder`)는 상품 행을 `SELECT ... ORDER BY id FOR UPDATE`로 잠금(이전과 같음)
- 개발용
  - Stripe 시뮬레이터 `order-api-nest/scripts/stripe-sim.mjs`(기본 :4100, `SIM_PORT`). API를 `STRIPE_SIMULATOR_URL`과 함께 띄우면 Stripe 대신 시뮬레이터로 결제 세션을 만들고, 시뮬레이터가 서명한 `checkout.session.completed` 웹훅을 API로 보냄. `NODE_ENV=production`에서는 무시
  - REST API 문서 `/docs`(`@nestjs/swagger`). `/`, `/metrics`는 문서에서 뺌
- 실험 스크립트(`order-api-nest/scripts/`, API가 :4000에 떠 있어야 함)
  - `bulk-orders.sql`: 시드 사용자에게 주문 30만 건
  - `page-latency.mjs`: 깊이별 offset·cursor 응답 시간 표
  - `page-drift.mjs`: 페이지 사이에 주문이 생기거나 결제될 때 offset과 cursor의 2쪽 비교
  - `restock-race.mjs [delta|set] [together]`: 결제와 관리자 재고 저장이 겹칠 때 재고 장부 비교
  - `stampede.mjs`: 같은 상품 동시 결제(응답 메시지별 개수)
  - `loadtest/checkout.js`(k6): 부하용 상품을 페이지로 찾아 결제. `HOT=1`이면 상품 5번만

## 구성

`21`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── package.json, nest-cli.json     # @nestjs/swagger와 그 CLI 플러그인
│   ├── prisma/
│   │   ├── schema.prisma               # Order 인덱스
│   │   └── migrations/0020_order_list_indexes/
│   ├── src/
│   │   ├── pagination/                 # 새 폴더: cursor.ts, page-query.dto.ts, page-query.pipe.ts
│   │   ├── me/my-orders.ts             # 새 파일
│   │   ├── products/                   # product-list.ts, product-stock.controller.ts, stock-adjustment.dto.ts(새 파일)
│   │   ├── orders/orders.service.ts    # 전체 주문 페이지
│   │   ├── trpc/router.ts              # products.list, me.orders에 limit·cursor
│   │   ├── payments/stripe.gateway.ts  # 시뮬레이터 주소
│   │   ├── main.ts                     # /docs
│   │   └── */*.controller.ts           # @ApiTags, @ApiBearerAuth
│   ├── scripts/                        # stripe-sim, bulk-orders.sql, page-drift, page-latency, restock-race(새 파일), stampede(수정)
│   ├── loadtest/                       # checkout.js, load-seed.sql을 새 카탈로그에 맞춤
│   └── test/                           # pagination, stock-adjustments e2e(새 파일), admin-only·trpc 수정
├── order-console-next/
│   ├── app/load-more.tsx               # 새 파일
│   ├── app/admin/products/stock-adjuster.tsx  # 새 파일
│   ├── app/shop/, app/me/orders/, app/cart/, app/admin/products/  # 무한 목록, 캐시 고치기
│   ├── lib/lists.ts                    # 새 파일: 무한 목록 쿼리 옵션
│   └── e2e/                            # infinite-orders, stock-adjust(새 파일), shop·trpc·demo-login 수정
├── package-lock.json
└── README.md
```

## 실행

필요한 도구와 포트는 `21`과 같습니다. 결제를 실제 Stripe 없이 해 보려면 시뮬레이터와 함께 API를 띄웁니다.

```sh
npm ci
docker compose up -d
cd order-api-nest
npx prisma generate && npx prisma migrate deploy && npx prisma db seed
node scripts/stripe-sim.mjs                                                            # 터미널 1 (:4100)
npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js   # 터미널 2 (:4000)
```

웹은 저장소 루트에서 `npm run dev:web`(:3000)입니다. 비밀번호 로그인은 `kim`(관리자) / `1234`, API 문서는 http://localhost:4000/docs 입니다.

페이지 실험용 주문은 `docker compose exec -T db psql -U order -d order_api < order-api-nest/scripts/bulk-orders.sql`로 넣고, `npx prisma db seed`로 시드 사용자의 주문과 함께 지웁니다.

## 테스트

테스트 DB에 마이그레이션을 적용한 뒤 돌립니다.

```sh
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
npm run lint
npm run typecheck
npm run test:api
STRIPE_SIM=1 npm run test:web   # API(시뮬레이터 모드)와 시뮬레이터를 띄운 채로
```

- API e2e: `pagination.e2e-spec.ts`(정렬·끝까지 넘기기·offset 뒤 cursor·`paid` 필터·400·상품 cursor·tRPC와 REST가 같은 페이지), `stock-adjustments.e2e-spec.ts`(동시 +1·-1이 모두 반영, 재고 3에서 동시 -1 5번이면 3번 성공·2번 409, 400·404)
- 웹 e2e: `infinite-orders.spec.ts`(다음 20건이 붙고 중복 없음, 키보드로 "더 보기", 결제 확인 뒤 목록의 그 주문만 바뀜). 마지막 것은 `STRIPE_SIM=1`일 때만 돎. `stock-adjust.spec.ts`(입고·출고와 409 안내)
- CI의 작업 구성은 `21`과 같고, CI의 `test:web`에는 `STRIPE_SIM`이 없어 시뮬레이터 결제 테스트는 건너뜁니다.

## 정리

```sh
docker compose down          # -v를 붙이면 DB·저장소 볼륨도 지움
```
