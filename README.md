# 01: PostgreSQL과 Prisma

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- `node-workspace` 저장소의 [`foundation/05-ws-gateway`](https://github.com/seungwoo7050/node-workspace/tree/foundation/05-ws-gateway) 브랜치

주문 API(`order-api-nest`)의 메모리 배열 저장을 PostgreSQL + Prisma로 바꾸고, 사용자 테이블과 외래키, 마이그레이션, 시드, `orders.user_id` 인덱스를 더했습니다.
Prisma 제약 위반 오류는 예외 필터에서 4xx 응답으로 바꿉니다.
주문 응답 모양(`{ id, user, price, paid }`)은 그대로입니다.

## 지원 범위

- `POST /auth/login`: 데모 계정 `kim`, 비밀번호는 `.env`의 `DEMO_PASSWORD`. 1시간짜리 JWT를 돌려줍니다.
- 주문 API
  - `GET /orders`, `GET /orders?paid=true|false`
  - `GET /orders/totals`: 결제된 주문의 사용자별 합계
  - `GET /orders/:id`
  - `POST /orders`: JWT 필요
- 사용자 API: `GET /users`(사용자와 각자의 주문), `POST /users`
- 실시간 알림: 주문을 만들면 만든 사용자에게만 socket.io 이벤트 `order.created`를 보냅니다(연결 시 `auth.token`에 JWT).
- 마이그레이션 3개: 주문 테이블, 사용자 테이블과 외래키, `orders.user_id` 인덱스
- 시드: 사용자 4명, 주문 5건(실행할 때마다 기존 주문·사용자를 지우고 다시 채움)
- 제약 위반 변환: UNIQUE 위반(`P2002`) 409, 외래키 위반(`P2003`) 400, 대상 없음(`P2025`) 404
- `PRISMA_LOG=query`로 실행하면 Prisma가 보내는 SQL을 로그로 출력

## 구성

```text
.
├── order-api-nest/              # NestJS API
│   ├── docker-compose.yml       # PostgreSQL 17 (PC 쪽 포트 5433)
│   ├── .env                     # 로컬 개발 값(JWT_SECRET은 자리값)
│   ├── prisma/
│   │   ├── schema.prisma        # User, Order 모델
│   │   ├── migrations/          # 0001_init, 0002_add-user, 0003_index_orders_user_id
│   │   └── seed.ts              # 사용자 4명, 주문 5건
│   ├── prisma7.config.ts        # Prisma CLI 설정(.env 로드, 마이그레이션 경로, seed 명령)
│   ├── src/
│   │   ├── prisma/              # PrismaService, 제약 위반 → 4xx 예외 필터
│   │   ├── orders/              # 주문 컨트롤러·서비스·DTO
│   │   ├── users/               # 사용자 컨트롤러·서비스·DTO
│   │   ├── auth/                # JWT 로그인과 passport 전략
│   │   ├── notifications/       # socket.io 게이트웨이
│   │   ├── generated/prisma/    # prisma generate 산출물(.gitignore)
│   │   └── main.ts              # ValidationPipe, 예외 필터, CORS(FRONTEND_URL)
│   ├── test/                    # e2e 테스트, .env 로드
│   └── scratch-client.mjs       # 로그인 후 order.created를 기다리는 확인용 클라이언트
└── README.md
```

## 실행

필요한 도구: Node.js(`process.loadEnvFile`을 쓰므로 20.12 이상), Docker, `tsx`(시드 명령 `tsx prisma/seed.ts`가 쓰지만 package.json 의존성에 없으므로 따로 설치해 PATH에 있어야 합니다).

```sh
cd order-api-nest
npm ci
docker compose up -d        # PostgreSQL, localhost:5433
npx prisma migrate deploy
npx prisma generate         # src/generated/prisma 생성
npx prisma db seed
npm run start:dev           # API, localhost:4000
```

```sh
curl localhost:4000/users
curl localhost:4000/orders/totals
node scratch-client.mjs     # 다른 터미널에서 POST /orders를 보내면 알림이 찍힘
```

`.env`의 값: `PORT=4000`, `DATABASE_URL`(compose의 계정·포트), `DEMO_PASSWORD`, `FRONTEND_URL=http://localhost:3000`, `JWT_SECRET`.

## 테스트

```sh
npm test            # 단위 테스트(vitest)
npm run test:e2e    # e2e 테스트(.env를 읽고 앱 전체를 띄움, prisma generate가 먼저 필요)
npm run lint        # oxlint
```

단위·e2e 테스트는 NestJS 기본 예제(`GET /`가 `Hello World!`를 돌려주는지) 하나씩만 있습니다.
주문·사용자 API와 DB 동작은 위의 `curl`이나 `npx prisma studio`로 확인합니다.

## 정리

```sh
docker compose down      # 컨테이너만 내림
docker compose down -v   # DB 볼륨까지 삭제
```
