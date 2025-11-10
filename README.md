# 10: 행 수준 보안(RLS)

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20RLS-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [09-category-tree](https://github.com/seungwoo7050/node-order/tree/09-category-tree) 브랜치

`orders`와 `order_items`에 PostgreSQL 행 수준 보안(RLS) 정책을 걸고, 앱은 테이블 소유자가 아닌 `order_app` 역할로 접속합니다.

앱의 주문 쿼리는 트랜잭션마다 `app.user_id` 또는 `app.role` 세션 변수를 설정한 뒤 실행되고, 마이그레이션·시드·테스트 데이터 준비는 소유자 연결(`ADMIN_DATABASE_URL`)로 분리했습니다.

## 지원 범위

- RLS 정책 (`0013_enable_rls`)

  - `orders`: `user_id`가 `current_setting('app.user_id', true)`와 같거나 `app.role`이 `admin`인 행만 읽고 쓸 수 있음(`USING`과 `WITH CHECK` 동일)

  - `order_items`: 연결된 주문이 `orders` 정책으로 보이는 행만 접근

  - 세션 변수가 없으면 주문이 하나도 보이지 않고, 다른 사용자 명의로 주문을 넣으면 SQLSTATE `42501`로 거부

- 앱 전용 역할 `order_app` (`0014_app_role`)

  - 없을 때만 `LOGIN PASSWORD 'order_app'`으로 만듦(학습용 값)

  - `public` 스키마 테이블의 `SELECT`·`INSERT`·`UPDATE`·`DELETE`, 시퀀스의 `USAGE`·`SELECT` 권한. `ALTER DEFAULT PRIVILEGES`로 소유자가 이후 만드는 테이블·시퀀스에도 같은 권한

- 연결 분리

  - 앱: `DATABASE_URL`(`order_app`)

  - 소유자 `order`: `ADMIN_DATABASE_URL`. `prisma7.config.ts`(마이그레이션), `prisma/seed.ts`, `scripts/stampede.mjs`의 결과 집계는 이 값이 있으면 우선 사용

  - compose `app` 프로필: `api`는 `order_app`, `migrate`는 `order`로 접속

- `PrismaService.asUser(userId, fn)` / `asAdmin(fn)`

  - 트랜잭션을 열고 `set_config('app.user_id' | 'app.role', ..., true)`로 트랜잭션 범위 세션 변수를 설정한 뒤 `fn(tx)` 실행. 트랜잭션이 끝나면 설정이 사라짐

  - `asUser`: `GET /me/orders`, `GET /me/orders/:id`, `POST /orders/checkout`

  - `asAdmin`: `GET /orders`, `GET /orders/:id`, `GET /orders/totals`, `POST /orders`, `GET /users`(사용자별 주문 포함). 앞의 넷 중 `POST /orders`만 로그인이 필요하고, 나머지와 `GET /users`는 인증 가드가 없음

- 그 밖의 API와 `order-console-next`는 `09-category-tree`와 같습니다.

## 구성

`09`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── .env                              # DATABASE_URL(order_app), ADMIN_DATABASE_URL, TEST_ADMIN_DATABASE_URL
├── docker-compose.yml                # api의 DATABASE_URL을 order_app으로
├── prisma7.config.ts                 # ADMIN_DATABASE_URL 우선
├── prisma/
│   ├── migrations/
│   │   ├── 0013_enable_rls/          # orders, order_items에 RLS와 정책
│   │   └── 0014_app_role/            # order_app 역할과 권한
│   └── seed.ts                       # ADMIN_DATABASE_URL 우선
├── scripts/stampede.mjs              # 결과 집계를 ADMIN_DATABASE_URL로
├── src/
│   ├── prisma/prisma.service.ts      # asUser, asAdmin
│   ├── me/me.controller.ts           # asUser
│   ├── orders/orders.service.ts      # checkout은 asUser, 나머지는 asAdmin
│   └── users/users.service.ts        # asAdmin
└── test/
    ├── setup-env.ts                  # TEST_ADMIN_DATABASE_URL 필수, ADMIN_DATABASE_URL로 넘김
    ├── admin-db.ts                   # 소유자 연결 PrismaClient
    ├── rls.e2e-spec.ts               # RLS 회귀 테스트
    └── *.e2e-spec.ts                 # 데이터 준비와 결과 확인을 adminDb로
```

## 실행

개발 환경은 `09-category-tree`와 같습니다(PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, API `4000`, 시드에는 전역 `tsx` 필요). `order_app` 역할은 마이그레이션(`0014_app_role`)이 만듭니다.

```sh
cd order-api-nest
npm ci
docker compose up -d db redis storage
npx prisma migrate deploy # ADMIN_DATABASE_URL(order)로 적용
npx prisma generate
npx prisma db seed
npm run start:dev # :4000, order_app으로 접속
```

데모 계정은 `kim`, `lee`, `park`, `choi`, 비밀번호는 `1234`(`DEMO_PASSWORD`)입니다. 시드의 2번 주문은 `lee`의 주문이라 `kim`으로 요청하면 404입니다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).accessToken')
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders   # kim의 주문만
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2 # 404
```

API까지 컨테이너로 띄우려면 `app` 프로필을 씁니다. `migrate`가 소유자로 마이그레이션한 뒤 `api`가 `order_app`으로 접속합니다.

```sh
docker compose --profile app up -d --build
```

## 테스트

e2e에서 앱은 `TEST_DATABASE_URL`(`order_app`), 데이터 준비와 결과 확인은 `TEST_ADMIN_DATABASE_URL`(소유자)로 접속합니다. 둘 중 하나라도 없으면 `test/setup-env.ts`가 테스트를 멈춥니다.

처음 한 번 테스트 DB를 만들고 마이그레이션을 소유자로 적용합니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # vitest 단위 테스트
npm run test:e2e # RLS, 카테고리, 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

RLS e2e는 세션 변수 없이 주문이 0건인지, `kim`으로 설정하면 `kim`의 주문만 보이는지, `kim`으로 `lee` 명의 주문을 넣으면 `42501`로 거부되는지, 트랜잭션이 끝난 뒤 설정이 남지 않는지 확인합니다.

콘솔 테스트는 `09-category-tree`와 같습니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
