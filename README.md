# 03: 인증 심화

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20JWT-lightgrey)

이 프로젝트는 node-order저장소의 [02-transactions-and-concurrency](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency)브랜치로부터 시작합니다.

데모 수준이던 로그인을 비밀번호 해시, 짧은 액세스 토큰, httpOnly 쿠키의 refresh token과 회전·재사용 감지로 바꾸고, 남의 주문을 id만 바꿔 읽는 IDOR을 막습니다.

## 지원 범위

- 사용자·주문·상품 API (`/users`, `/orders`, `/products`)와 결제 API `POST /orders/checkout` (트랜잭션, `FOR UPDATE` 잠금, `Idempotency-Key`, outbox)

- 주문 생성 시 그 주문의 주인에게만 보내는 실시간 알림 (socket.io)

- 비밀번호를 사용자마다 솔트를 둔 scrypt 해시로 저장

  - `POST /users`로 가입 (비밀번호 8자 이상)

  - 없는 사용자도 더미 해시와 비교해 응답 시간으로 가입 여부가 새지 않게 함

- 토큰

  - `POST /auth/login` → 본문에 액세스 토큰(`ACCESS_TOKEN_TTL`, 기본 `15m`), refresh token은 `refresh_token` httpOnly 쿠키(`SameSite=Strict`, `Path=/auth`, 7일)

  - `POST /auth/refresh`: 쓸 때마다 새 refresh token으로 바꿈. 이미 쓴 토큰이 다시 오면 그 로그인 세션의 토큰 전체를 회수

  - 같은 토큰으로 동시에 refresh해도 성공은 1번뿐 (조건부 `UPDATE`)

  - DB에는 refresh token의 SHA-256 해시만 저장

  - `POST /auth/logout`(이 세션), `POST /auth/logout-all`(JWT 필요, 그 사용자의 모든 세션)

- 내 주문만 보는 `GET /me/orders`, `GET /me/orders/:id` (남의 주문과 없는 주문 모두 404)

## 구성

```text
.
├── order-api-nest/             # NestJS API
│   ├── docker-compose.yml      # PostgreSQL 17 컨테이너(PC 쪽 포트 5433)
│   ├── prisma/
│   │   ├── schema.prisma       # 모델 선언(User, Order, Product, OrderItem, IdempotencyKey, OutboxEvent, RefreshToken)
│   │   ├── migrations/         # 적용 순서대로 쌓인 SQL 9개 + migration_lock.toml
│   │   └── seed.ts             # 사용자 4명(비밀번호 해시 포함), 주문 5건, 상품 2개
│   ├── prisma7.config.ts       # Prisma CLI 설정(.env 로드, db seed 명령)
│   ├── src/
│   │   ├── prisma/             # PrismaService, 제약 위반 → 4xx 예외 필터
│   │   ├── auth/               # 비밀번호 해시(password.ts), 로그인·refresh·로그아웃, 쿠키, JWT 전략
│   │   ├── me/                 # 내 주문 조회(GET /me/orders, /me/orders/:id)
│   │   ├── orders/             # 주문·결제 API(컨트롤러·서비스·DTO), 재고 잠금과 멱등성 처리
│   │   ├── products/           # 상품 목록 API
│   │   ├── outbox/             # outbox 이벤트를 읽어 알림으로 발행하는 relay
│   │   ├── users/              # 사용자 API(회원가입)
│   │   ├── notifications/      # socket.io 게이트웨이
│   │   ├── generated/prisma/   # prisma generate 산출물(커밋하지 않음)
│   │   ├── main.ts             # cookie-parser 등록, CORS credentials
│   │   └── app.module.ts       # 모듈 배선
│   ├── scripts/
│   │   ├── refresh-race.mjs    # 동시 refresh 실험(응답 코드별 개수, 발급된·유효한 토큰 수 출력)
│   │   └── stampede.mjs        # 동시 결제 실험(응답 코드별 개수, 남은 재고·팔린 수량 출력)
│   ├── test/                   # e2e(test/setup-env.ts에서 .env를 읽고 TEST_DATABASE_URL로 DB를 바꾼다)
│   └── scratch-client.mjs      # 실시간 알림 확인용 클라이언트
└── README.md
```

## 실행

PostgreSQL은 compose로 띄웁니다(포트 `5433`).

API는 `4000`에서 뜹니다.

시드 사용자(`kim`, `lee`, `park`, `choi`)의 비밀번호는 모두 `.env`의 `DEMO_PASSWORD`(`1234`)입니다.

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
curl -i -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' # Set-Cookie: refresh_token=...; HttpOnly
```

동시 refresh 실험(서버가 떠 있는 상태에서):

```sh
node scripts/refresh-race.mjs 10 # 같은 쿠키로 refresh 10건 → 성공 1건, 나머지는 재사용으로 401
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

e2e는 한 번 쓴 refresh token을 다시 쓰면 401이고 그 사이 발급된 토큰까지 회수되는지, 같은 토큰으로 동시에 10번 refresh해도 1번만 성공하는지 확인합니다.

## 정리

```sh
docker compose down    # 컨테이너만 내림
docker compose down -v # DB 볼륨까지 삭제
```
