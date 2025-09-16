# 01: PostgreSQL과 Prisma

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL-lightgrey)

이 프로젝트는 `node-workspace`저장소의 [`foundation/05-ws-gateway`](https://github.com/seungwoo7050/node-workspace/tree/foundation/05-ws-gateway)브랜치로부터 시작합니다.

주문 API(`order-api-nest`)의 메모리 배열을 PostgreSQL로 옮기고, 사용자 테이블과 관계, 마이그레이션, 제약 위반 처리, 인덱스를 붙입니다.

HTTP API의 응답 모양(`{ id, user, price, paid }`)은 기존과 같습니다.

## 지원 범위

- JWT 로그인 `POST /auth/login` (데모 계정 `kim`, 비밀번호는 `.env`의 `DEMO_PASSWORD`)

- 주문 API: `GET /orders`, `GET /orders?paid=true|false`, `GET /orders/totals`, `GET /orders/:id`, `POST /orders`(JWT 필요)

- 사용자 API: `GET /users`(사용자별 주문 목록을 쿼리 2개로 조회), `POST /users`

- 주문 생성 시 그 주문을 만든 사용자에게만 보내는 실시간 알림 (socket.io, `order.created`)

- PostgreSQL + Prisma 저장, 서버를 껐다 켜도 데이터 유지

  - 마이그레이션 3개: 주문 테이블, 사용자 테이블과 외래키, `orders.user_id` 인덱스

  - 시드: 사용자 4명, 주문 5건

- DB 제약 위반을 4xx로 변환: UNIQUE 위반 409, 외래키 위반 400, 대상 없음 404

- `PRISMA_LOG=query`로 실행되는 SQL 출력

## 구성

```text
.
├── order-api-nest/             # NestJS API
│   ├── docker-compose.yml      # PostgreSQL 17 컨테이너(PC 쪽 포트 5433)
│   ├── prisma/
│   │   ├── schema.prisma       # 모델 선언(User, Order)
│   │   ├── migrations/         # 적용 순서대로 쌓인 SQL 3개 + migration_lock.toml
│   │   └── seed.ts             # 사용자 4명, 주문 5건
│   ├── prisma7.config.ts       # Prisma CLI 설정(.env 로드, db seed 명령)
│   ├── src/
│   │   ├── prisma/             # PrismaService, 제약 위반 → 4xx 예외 필터
│   │   ├── orders/             # 주문 API(컨트롤러·서비스·DTO)
│   │   ├── users/              # 사용자 API
│   │   ├── auth/               # JWT 로그인
│   │   ├── notifications/      # socket.io 게이트웨이
│   │   ├── generated/prisma/   # prisma generate 산출물(커밋하지 않음)
│   │   └── app.module.ts       # 모듈 배선
│   ├── test/                   # e2e(.env는 test/setup-env.ts에서 읽는다)
│   └── scratch-client.mjs      # 실시간 알림 확인용 클라이언트
└── README.md
```

`prisma/migrations/`는 DB 구조의 이력이므로 반드시 커밋합니다.

반대로 `src/generated/prisma/`는 빌드 산출물이라 커밋하지 않고 `npx prisma generate`로 다시 만듭니다.

## 실행

PostgreSQL은 compose로 띄웁니다(포트 `5433`, Docker 필요).

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

```sh
curl localhost:4000/users # 사용자와 각자의 주문
curl localhost:4000/orders/totals
```

`npx prisma db seed`는 기존 주문·사용자를 지우고 시드 데이터로 다시 채웁니다. 

실시간 알림은 `node scratch-client.mjs`로 확인합니다.

## 테스트

```sh
npm test # 단위 테스트
npm run test:e2e # e2e 테스트 (.env를 읽어 앱 전체를 띄움, prisma generate가 먼저 되어 있어야 함)
npm run lint
```

테스트는 NestJS 기본 예제(`GET /`가 `Hello World!`를 돌려주는지)만 확인합니다.

DB 동작은 위의 `curl`과 `npx prisma studio`로 직접 확인합니다.

## 정리

```sh
docker compose down     # 컨테이너만 내림
docker compose down -v  # DB 볼륨까지 삭제
```