# 04: Redis로 서버 여러 대

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Redis%20%7C%20BullMQ%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [03-auth-hardening](https://github.com/seungwoo7050/node-order/tree/03-auth-hardening) 브랜치

compose에 Redis를 더하고, socket.io에 Redis 어댑터를 붙여 서버 여러 대가 알림을 주고받게 했습니다.
outbox relay가 주문 확인 메일을 BullMQ `mail` 큐에 넣고 각 서버의 워커가 처리하며, PostgreSQL advisory lock으로 뽑은 리더 한 대만 만료 refresh token 정리를 돌립니다.

## 지원 범위

- 03의 API 전부(`/auth/*`, `/users`, `/orders`, `/orders/checkout`, `/products`, `/me/orders`)
- socket.io Redis 어댑터: 서버 A에서 만든 주문의 `order.created` 알림이 서버 B에 붙은 클라이언트에도 전달됨
- 주문 확인 메일(BullMQ `mail` 큐)
  - outbox relay가 이벤트마다 `order-email` job을 넣음. `jobId`가 `order-email-<outbox 이벤트 id>`라서 같은 이벤트로는 job이 하나만 생김
  - 서버마다 워커 하나, 동시 처리 `MAIL_CONCURRENCY`개(기본 5)
  - 최대 4회 시도, 지수 백오프(0.5초 → 1초 → 2초). 다 실패한 job은 failed 상태로 남음
  - ioredis 연결은 `maxRetriesPerRequest: null`
  - 메일 발송기는 가짜: `MAIL_DELAY_MS`만큼 기다린 뒤 `MAIL_FAIL_RATE` 확률로 실패, 성공하면 로그만 남김
- 리더 선출
  - 서버마다 전용 `pg` 연결로 2초마다 `pg_try_advisory_lock`을 시도하고, 잡은 서버가 리더
  - 연결이 끊기면 리더 자격을 내려놓음
  - 리더만 `CLEANUP_INTERVAL_MS`(기본 60000)마다 만료 후 1일이 지난 refresh token을 최대 1000건 삭제
- 확인용 스크립트(`scripts/`): `notify-check.mjs`, `order-burst.mjs`, `queue-stats.mjs`, `retry-failed.mjs`, `lock-race.mjs`

## 구성

`03`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── .env                          # REDIS_URL, MAIL_DELAY_MS, MAIL_FAIL_RATE, MAIL_CONCURRENCY, CLEANUP_INTERVAL_MS 추가
├── docker-compose.yml            # redis:7 추가(PC 쪽 포트 6380)
├── package.json                  # @socket.io/redis-adapter, bullmq, ioredis 추가
├── scripts/
│   ├── notify-check.mjs          # 서버 A로 주문 N개 → 서버 B에 붙은 클라이언트가 받은 알림 수
│   ├── order-burst.mjs           # 주문 N개를 동시에 만들고 받은 알림 횟수와 서로 다른 주문 수
│   ├── queue-stats.mjs           # mail 큐의 상태별 job 수
│   ├── retry-failed.mjs          # failed job을 다시 대기열로
│   └── lock-race.mjs             # 프로세스 셋이 잠금을 다툴 때 작업 구간이 겹치는지(redis-naive | redis-safe | pg)
└── src/
    ├── main.ts                   # Redis 연결 후 useWebSocketAdapter(RedisIoAdapter)
    ├── app.module.ts             # LeaderModule 등록
    ├── redis/redis-io.adapter.ts # socket.io Redis 어댑터
    ├── queue/                    # MailQueue(BullMQ 큐와 워커)
    ├── mail/                     # FakeMailer
    ├── leader/                   # LeaderElection, TokenCleanupJob
    └── outbox/                   # relay가 메일 job도 넣음
```

## 실행

03에 더해 Redis가 필요하며 compose가 함께 띄웁니다(PostgreSQL `localhost:5433`, Redis `localhost:6380`).

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

서버 한 대는 `npm run start:dev`(포트 4000)로 띄웁니다.
두 대를 띄울 때는 빌드한 결과물을 포트만 바꿔 터미널 두 개에서 실행합니다. 명령 앞에 준 환경변수가 `.env`보다 우선합니다.

```sh
npm run build
PORT=4000 node --env-file=.env dist/main.js   # 터미널 1
PORT=4001 node --env-file=.env dist/main.js   # 터미널 2
```

확인용 스크립트(괄호는 기본값):

```sh
node scripts/notify-check.mjs 10 4000 4001   # 주문 수(10), 주문 보낼 포트(4000), 소켓 붙일 포트(4001)
node scripts/order-burst.mjs 40 8000         # 4000에 동시 주문 수(20), 알림 기다릴 ms(5000)
node scripts/queue-stats.mjs                 # waiting, active, delayed, completed, failed 개수
node scripts/retry-failed.mjs                # failed job을 다시 대기열로
node scripts/lock-race.mjs redis-safe        # redis-naive | redis-safe | pg, API 서버 없이 Redis·DB만 필요
```

메일 실패와 재시도는 `MAIL_FAIL_RATE`를 바꿔 띄워 봅니다.

```sh
PORT=4000 MAIL_FAIL_RATE=1 node --env-file=.env dist/main.js   # 모든 시도 실패 → 4회 뒤 failed
```

## 테스트

테스트 DB(`order_api_test`) 준비는 02와 같습니다.
e2e는 앱 모듈 전체를 띄우므로 메일 큐가 붙을 Redis도 떠 있어야 합니다.

```sh
npm test            # 단위 테스트(vitest)
npm run test:e2e    # e2e 테스트(동시 결제·멱등 키, refresh 회전)
npm run lint        # oxlint
```

이 브랜치에서 새로 더한 테스트는 없습니다. Redis 어댑터·큐·리더 선출은 위 스크립트로 확인합니다.

## 정리

```sh
docker compose down      # PostgreSQL·Redis 컨테이너 내림
docker compose down -v   # DB 볼륨까지 삭제
```
