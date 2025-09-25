# 02: 트랜잭션과 동시성

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 node-order저장소의 [01-postgres-prisma](https://github.com/seungwoo7050/node-order/tree/01-postgres-prisma)브랜치로부터 시작합니다.

주문 API(`order-api-nest`)에 재고를 줄이며 주문을 만드는 결제 API를 붙이고, 동시 요청·중복 요청·부분 실패에도 재고와 주문이 어긋나지 않게 합니다.

## 지원 범위

- JWT 로그인과 사용자·주문 API (`/auth/login`, `/users`, `/orders`)

- 주문 생성 시 그 주문의 주인에게만 보내는 실시간 알림 (socket.io)

- PostgreSQL + Prisma 저장, 마이그레이션, 시드

- 상품 목록과 결제 API `POST /orders/checkout`

  - 트랜잭션으로 재고 차감·주문·품목을 한 번에 기록

  - 상품 행을 id 순서로 `FOR UPDATE` 잠가 초과 판매와 교착 상태를 막음

  - `Idempotency-Key` 헤더로 같은 요청을 한 번만 처리 (같은 키에 다른 내용이면 422)

- outbox 테이블과 relay로 DB 커밋과 알림 발송을 일치시킴

## 구성

```
.
├── order-api-nest/             # NestJS API
│   ├── docker-compose.yml      # PostgreSQL 17 컨테이너(PC 쪽 포트 5433)
│   ├── prisma/
│   │   ├── schema.prisma       # 모델 선언(User, Order, Product, OrderItem, IdempotencyKey, OutboxEvent)
│   │   ├── migrations/         # 적용 순서대로 쌓인 SQL 7개 + migration_lock.toml
│   │   └── seed.ts             # 사용자 4명, 주문 5건, 상품 2개
│   ├── prisma7.config.ts       # Prisma CLI 설정(.env 로드, db seed 명령)
│   ├── src/
│   │   ├── prisma/             # PrismaService, 제약 위반 → 4xx 예외 필터
│   │   ├── orders/             # 주문·결제 API(컨트롤러·서비스·DTO), 재고 잠금과 멱등성 처리
│   │   ├── products/           # 상품 목록 API
│   │   ├── outbox/             # outbox 이벤트를 읽어 알림으로 발행하는 relay
│   │   ├── users/              # 사용자 API
│   │   ├── auth/               # JWT 로그인
│   │   ├── notifications/      # socket.io 게이트웨이
│   │   ├── generated/prisma/   # prisma generate 산출물(커밋하지 않음)
│   │   └── app.module.ts       # 모듈 배선
│   ├── scripts/
│   │   └── stampede.mjs        # 동시 결제 실험(응답 코드별 개수, 남은 재고·팔린 수량 출력)
│   ├── test/                   # e2e(test/setup-env.ts에서 .env를 읽고 TEST_DATABASE_URL로 DB를 바꾼다)
│   └── scratch-client.mjs      # 실시간 알림 확인용 클라이언트
└── README.md
```

## 실행

PostgreSQL은 compose로 띄웁니다(포트 `5433`).

API는 `4000`에서 뜹니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev
```

동시 결제 실험(서버가 떠 있는 상태에서):

```sh
node scripts/stampede.mjs 50 # 재고 10개에 동시 50건 → 201이 정확히 10건
node scripts/stampede.mjs 20 '[{"productId":1,"quantity":1}]' same-key-1 # 같은 키 20건 → 주문 1건
```

## 테스트

e2e 테스트는 개발 DB가 아니라 테스트 전용 DB(`TEST_DATABASE_URL`)를 씁니다.

처음 한 번 만듭니다.

```sh
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # 동시 결제 회귀 테스트 포함
npm run lint
```

e2e는 재고 5개에 동시 요청 20개를 보내 정확히 5건만 성공하는지, 같은 `Idempotency-Key`로 동시에 10개를 보내 주문이 1건인지 확인합니다.

## 정리

```sh
docker compose down    # 컨테이너만 내림
docker compose down -v # DB 볼륨까지 삭제
```