# 22: 페이지네이션과 잠금

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20k6-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [21-public-demo](https://github.com/seungwoo7050/node-order/tree/21-public-demo) 브랜치

목록 API가 전체 행을 돌려주던 것을 cursor 페이지로 나누고, 화면을 무한 스크롤로 바꿉니다. 재고 차감의 잠금 세 가지를 부하로 비교해 비관적 잠금을 남기고, 관리자의 재고 입고를 증가량으로 받습니다.

과정 전체(측정, 실험, 에러 신호)는 [guide/README.md](guide/README.md)에 있습니다. 이 문서는 무엇이 있고 어떻게 돌리는지만 적습니다.

## 지원 범위

- 페이지네이션
  - 내 주문·전체 주문(관리자)·상품이 `{ items, nextCursor }`로 20건씩(최대 100). REST와 tRPC가 같은 함수를 씀
  - 주문의 정렬 키는 `(createdAt, id)`, 인덱스 `0020_order_list_indexes`. 전체 주문은 `offset`·`paid`도 받음
  - 전체 주문은 관리자만. 데모 관리자는 403

- 화면
  - 내 주문·상점·관리자 상품이 무한 목록. "더 보기" 버튼은 늘 두고 불러오는 동안 `aria-disabled`
  - 결제가 확인되면 목록 캐시의 그 줄만 고침(`setQueryData`). 무한 목록의 무효화는 `pathKey()`

- 재고
  - 결제는 `FOR UPDATE` 그대로. 낙관적 잠금·`SERIALIZABLE`과 비교한 이유를 `placeOrder` 위 주석에 남김
  - 관리자 입고·조정 `POST /products/:id/stock-adjustments { delta }`. `stock = stock + delta`를 한 문장으로, 음수가 되면 409. 데모 관리자는 403
  - 관리자 상품 화면의 입고 입력칸(데모 관리자에게는 꺼짐)

- 개발용
  - Stripe 시뮬레이터 `scripts/stripe-sim.mjs`(:4100). API를 `STRIPE_SIMULATOR_URL`과 함께 띄웠을 때만 쓰고, `NODE_ENV=production`에서는 무시
  - REST API 문서 `/docs`(`@nestjs/swagger`)

## 구성

`21`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── prisma/migrations/0020_order_list_indexes/
│   ├── src/pagination/                 # cursor, 쿼리 DTO, 목록용 파이프
│   ├── src/me/my-orders.ts
│   ├── src/products/                   # product-list.ts, product-stock.controller.ts, stock-adjustment.dto.ts
│   ├── src/payments/stripe.gateway.ts  # 시뮬레이터 주소
│   ├── scripts/                        # stripe-sim, bulk-orders.sql, page-drift, page-latency, stampede, restock-race
│   ├── loadtest/                       # k6 시나리오, 부하용 상품
│   └── test/                           # pagination, stock-adjustments e2e
├── order-console-next/
│   ├── app/load-more.tsx
│   ├── app/admin/products/stock-adjuster.tsx
│   ├── lib/lists.ts                    # 무한 목록 쿼리 옵션
│   └── e2e/                            # infinite-orders, stock-adjust
└── README.md
```

## 실행

```sh
npm ci
docker compose up -d
cd order-api-nest
npx prisma generate && npx prisma migrate deploy && npx prisma db seed
node scripts/stripe-sim.mjs # 터미널 1
npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js # 터미널 2
```

웹은 저장소 루트에서 `npm run dev:web`(:3000)입니다. 비밀번호 로그인은 `kim` / `1234`(관리자)입니다.

## 테스트

테스트 DB에 마이그레이션을 적용한 뒤 돌립니다.

```sh
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
npm run lint
npm run typecheck
npm run test:api
STRIPE_SIM=1 npm run test:web # API(시뮬레이터 모드)와 시뮬레이터를 띄운 채로
```
