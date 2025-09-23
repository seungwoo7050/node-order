# 02: 트랜잭션과 동시성

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [01-postgres-prisma](https://github.com/seungwoo7050/node-order/tree/01-postgres-prisma) 브랜치

상품·주문 품목 테이블과 결제 API `POST /orders/checkout`을 더했습니다.
결제는 한 트랜잭션 안에서 상품 행을 잠그고 재고를 줄이며, `Idempotency-Key` 헤더로 같은 요청을 한 번만 처리합니다.
주문 알림은 직접 보내지 않고 같은 트랜잭션에서 outbox 테이블에 쓴 뒤 relay가 발송합니다.

## 지원 범위

- 01의 API 전부: `POST /auth/login`, `GET|POST /users`, `GET /orders`, `GET /orders/totals`, `GET /orders/:id`, `POST /orders`
- `GET /products`: 상품 목록(id, name, price, stock)
- `POST /orders/checkout`(JWT 필요): 본문 `{ items: [{ productId, quantity }] }`
  - 상품 행을 id 순서로 `SELECT ... FOR UPDATE`로 잠근 뒤 재고 차감, 주문·품목 생성을 한 트랜잭션에서 처리
  - 재고 부족 409, 없는 상품 404, 같은 상품을 두 줄로 보내면 400
  - `Idempotency-Key` 헤더: 사용자별로 키를 저장해 같은 키의 재요청에는 저장한 응답을 그대로 돌려줌. 같은 키에 다른 본문이면 422
- outbox: `POST /orders`와 결제는 주문과 같은 트랜잭션에서 `outbox_events`에 이벤트를 기록하고, relay가 0.5초마다 미발행 이벤트를 `FOR UPDATE SKIP LOCKED`로 최대 20건 읽어 socket.io `order.created`로 보냄
- 마이그레이션 7개(01의 3개 + 상품·품목, 단가 컬럼 이름 변경, 멱등 키, outbox)
- 시드: 사용자 4명, 주문 5건, 상품 2개(`한정판 키보드` 재고 10, `마우스` 재고 100). 모든 테이블을 `TRUNCATE ... RESTART IDENTITY`한 뒤 채움
- e2e 테스트는 개발 DB 대신 `TEST_DATABASE_URL`의 DB를 씀

## 구성

`01`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── .env                              # TEST_DATABASE_URL 추가
├── prisma/
│   ├── schema.prisma                 # Product, OrderItem, IdempotencyKey, OutboxEvent 추가
│   ├── migrations/
│   │   ├── 0004_add_products/
│   │   ├── 0005_rename_unit_price/
│   │   ├── 0006_idempotency_keys/
│   │   └── 0007_add_outbox_events/
│   └── seed.ts                       # TRUNCATE 후 상품 2개까지 채움
├── scripts/
│   └── stampede.mjs                  # 결제 요청을 동시에 N개 보내고 응답 코드·재고를 출력
├── src/
│   ├── app.module.ts                 # ProductsModule, OutboxModule 등록
│   ├── orders/
│   │   ├── dto/checkout.dto.ts       # 결제 본문 검증
│   │   ├── orders.controller.ts      # POST /orders/checkout
│   │   └── orders.service.ts         # 결제 트랜잭션, 멱등 처리, outbox 기록
│   ├── outbox/                       # OutboxRelay(0.5초 주기 발행)
│   └── products/                     # GET /products
└── test/
    ├── checkout.e2e-spec.ts          # 동시 결제·멱등 키 회귀 테스트
    └── setup-env.ts                  # DATABASE_URL을 TEST_DATABASE_URL로 바꿈(없으면 중단)
```

## 실행

도구와 띄우는 순서는 01과 같습니다(PostgreSQL `localhost:5433`, API `localhost:4000`).

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev
```

```sh
curl localhost:4000/products
```

서버가 떠 있을 때 `node scripts/stampede.mjs <요청 수> [items JSON] [멱등 키]`로 `kim` 계정의 결제 요청을 동시에 보내고, 응답 코드별 개수와 상품별 남은 재고·팔린 수량을 출력합니다.
셋째 인자(멱등 키)를 주면 모든 요청이 같은 `Idempotency-Key`를 달고, 주지 않으면 키 없이 보냅니다.

## 테스트

e2e는 테스트 전용 DB `order_api_test`가 있어야 합니다. 처음 한 번 만듭니다.

```sh
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test            # 단위 테스트(vitest)
npm run test:e2e    # e2e 테스트
npm run lint        # oxlint
```

`test/checkout.e2e-spec.ts`는 테이블을 비우고 재고 5개 상품을 만든 뒤 두 가지를 확인합니다.

- 키 없이 동시 결제 20건 → 201이 5건, 409가 15건, 재고 0
- 같은 `Idempotency-Key`로 동시 결제 10건 → 응답이 모두 같은 주문, 주문 1건, outbox 이벤트 1건

## 정리

```sh
docker compose down      # 컨테이너만 내림
docker compose down -v   # DB 볼륨까지 삭제(테스트 DB 포함)
```
