# 04: Redis로 서버 여러 대

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Redis%20%7C%20BullMQ%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 node-order저장소의 [03-auth-hardening](https://github.com/seungwoo7050/node-order/tree/03-auth-hardening)브랜치로부터 시작합니다.

한 대로만 돌던 주문 API를 서버 두 대(`4000`, `4001`)로 띄워도 알림·메일·정리 작업이 맞게 돌도록, Redis Pub/Sub(socket.io Redis 어댑터), BullMQ 작업 큐, PostgreSQL advisory lock 리더 선출을 붙입니다.

## 지원 범위

- 사용자·주문·상품 API (`/users`, `/orders`, `/products`, `/me/orders`)와 결제 API `POST /orders/checkout` (트랜잭션, `FOR UPDATE` 잠금, `Idempotency-Key`, outbox)

- 로그인과 토큰 (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`): scrypt 비밀번호 해시, 짧은 액세스 토큰, httpOnly 쿠키의 refresh token 회전·재사용 감지

- 주문 알림 (socket.io)

  - Redis 어댑터로 서버끼리 이벤트를 주고받아, 서버 A에서 만든 주문의 알림이 서버 B에 붙은 클라이언트에도 전달됨

  - 채널은 `socket.io#/#user:<id>#` (사용자별 방)

- 주문 확인 메일을 BullMQ `mail` 큐로 처리

  - outbox relay는 job을 넣기만 하고, 각 서버의 워커가 나눠 발송 (동시 `MAIL_CONCURRENCY`개)

  - 최대 4회 시도(처음 1번 + 재시도 3번), 재시도 간격 0.5초 → 1초 → 2초. 다 실패하면 failed에 남아 다시 돌릴 수 있음

  - `jobId`를 `order-email-<outbox 이벤트 id>`로 고정해, 같은 이벤트가 다시 발행돼도 메일은 한 번만 나감

  - Redis가 잠깐 꺼져도 ioredis가 명령을 쥐고 기다리므로(`maxRetriesPerRequest: null`), 그 사이 주문의 메일이 빠지거나 두 번 나가지 않음

  - 메일 발송기는 가짜 (`MAIL_DELAY_MS`로 지연, `MAIL_FAIL_RATE`로 실패 확률 조절)

- 리더 선출

  - 서버마다 전용 DB 연결로 2초마다 `pg_try_advisory_lock`을 시도해, 잡은 한 대만 리더가 됨

  - 리더만 `CLEANUP_INTERVAL_MS`마다 만료 후 1일이 지난 refresh token을 한 번에 최대 1000건 삭제

  - 리더 프로세스가 죽으면 연결과 함께 잠금이 풀려 다른 서버가 이어받음

## 구성

```text
.
├── order-api-nest/             # NestJS API
│   ├── docker-compose.yml      # PostgreSQL 17(PC 쪽 포트 5433), Redis 7(PC 쪽 포트 6380)
│   ├── prisma/
│   │   ├── schema.prisma       # 모델 선언(User, Order, Product, OrderItem, IdempotencyKey, OutboxEvent, RefreshToken)
│   │   ├── migrations/         # 적용 순서대로 쌓인 SQL 9개 + migration_lock.toml
│   │   └── seed.ts             # 사용자 4명(비밀번호 해시 포함), 주문 5건, 상품 2개
│   ├── prisma7.config.ts       # Prisma CLI 설정(.env 로드, db seed 명령)
│   ├── src/
│   │   ├── redis/              # socket.io Redis 어댑터(RedisIoAdapter)
│   │   ├── queue/              # BullMQ 메일 큐와 워커(MailQueue)
│   │   ├── mail/               # 지연·실패를 흉내 내는 가짜 메일 발송기(FakeMailer)
│   │   ├── leader/             # advisory lock 리더 선출(LeaderElection), 토큰 정리 작업(TokenCleanupJob)
│   │   ├── outbox/             # outbox 이벤트를 읽어 알림을 보내고 메일 job을 넣는 relay
│   │   ├── notifications/      # socket.io 게이트웨이
│   │   ├── auth/               # 비밀번호 해시, 로그인·refresh·로그아웃, 쿠키, JWT 전략
│   │   ├── me/                 # 내 주문 조회(GET /me/orders, /me/orders/:id)
│   │   ├── orders/             # 주문·결제 API(컨트롤러·서비스·DTO), 재고 잠금과 멱등성 처리
│   │   ├── products/           # 상품 목록 API
│   │   ├── users/              # 사용자 API(회원가입)
│   │   ├── prisma/             # PrismaService, 제약 위반 → 4xx 예외 필터
│   │   ├── generated/prisma/   # prisma generate 산출물(커밋하지 않음)
│   │   ├── main.ts             # Redis 어댑터 연결 후 useWebSocketAdapter, cookie-parser, CORS
│   │   └── app.module.ts       # 모듈 배선(LeaderModule 포함)
│   ├── scripts/
│   │   ├── notify-check.mjs    # 서버 A로 주문 N개 → 서버 B에 붙은 클라이언트가 받은 알림 수
│   │   ├── order-burst.mjs     # 주문 N개를 동시에 만들고 받은 알림 횟수(중복 포함)와 서로 다른 주문 수 출력
│   │   ├── queue-stats.mjs     # 메일 큐의 상태별 job 수(waiting, active, delayed, completed, failed)
│   │   ├── retry-failed.mjs    # failed에 쌓인 메일 job을 다시 대기열로
│   │   ├── lock-race.mjs       # 프로세스 셋이 잠금을 다툴 때 작업 구간이 겹치는지 비교(redis-naive | redis-safe | pg)
│   │   ├── refresh-race.mjs    # 동시 refresh 실험
│   │   └── stampede.mjs        # 동시 결제 실험
│   ├── test/                   # e2e(test/setup-env.ts에서 .env를 읽고 TEST_DATABASE_URL로 DB를 바꾼다)
│   └── scratch-client.mjs      # 실시간 알림 확인용 클라이언트
└── README.md
```

## 실행

PostgreSQL(`5433`)과 Redis(`6380`)는 compose로 띄웁니다.

시드 사용자(`kim`, `lee`, `park`, `choi`)의 비밀번호는 모두 `.env`의 `DEMO_PASSWORD`(`1234`)입니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

서버 두 대는 한 번 빌드한 결과물을 포트만 달리 해서 띄웁니다(터미널 두 개).

`start:dev`(watch 모드) 두 개는 같은 `dist`를 동시에 다시 빌드해 서로 꼬이므로 쓰지 않습니다.

```sh
npm run build
PORT=4000 node --env-file=.env dist/main.js # 터미널 1
PORT=4001 node --env-file=.env dist/main.js # 터미널 2
```

실험 스크립트(서버가 떠 있는 상태에서):

```sh
node scripts/notify-check.mjs 10 4000 4001 # 4000으로 주문 10개 → 4001에 붙은 클라이언트가 받은 알림: 10개
node scripts/order-burst.mjs 40 8000       # 주문 40개를 동시에 → 받은 알림 40번(서로 다른 주문 40개)
node scripts/queue-stats.mjs               # { waiting: 0, active: 0, delayed: 0, completed: 40, failed: 0 }
node scripts/retry-failed.mjs              # failed에 있던 job을 다시 대기열로
node scripts/lock-race.mjs redis-naive     # 잠금 비교: redis-naive | redis-safe | pg (서버 없이 돈다)
```

메일 실패와 재시도를 보려면 서버를 `MAIL_FAIL_RATE`를 바꿔 띄웁니다(명령 앞의 값이 `.env`보다 우선).

```sh
PORT=4000 MAIL_FAIL_RATE=1 node --env-file=.env dist/main.js # 항상 실패 → 4회 시도 뒤 failed
```

## 테스트

e2e 테스트는 개발 DB가 아니라 테스트 전용 DB(`TEST_DATABASE_URL`)를 씁니다.

처음 한 번 만들고, 마이그레이션이 늘 때마다 적용합니다.

```sh
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # refresh 회전·동시 결제 회귀 테스트 포함
npm run lint
```

e2e는 재고보다 많은 동시 결제에서 정확히 재고만큼만 성공하는지, 한 번 쓴 refresh token을 다시 쓰거나 동시에 10번 써도 성공이 1번뿐인지 확인합니다.

## 정리

```sh
docker compose down    # 컨테이너만 내림
docker compose down -v # DB 볼륨까지 삭제
```
