# 10: 행 수준 보안(RLS)

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20RLS-lightgrey)

이 프로젝트는 node-order 저장소의 [09-category-tree](https://github.com/seungwoo7050/node-order/tree/09-category-tree) 브랜치의 소스코드로부터 시작합니다.

"내 주문만 보인다"는 규칙을 앱 코드의 `WHERE`가 아니라 PostgreSQL 정책으로 지킵니다. 앱이 쿼리에서 소유자 조건을 빠뜨려도 DB가 남의 행을 돌려주지 않습니다.

## 지원 범위

- 행 수준 보안 정책 (마이그레이션 `0013_enable_rls`)

  - `orders`는 세션 변수 `app.user_id`와 `user_id`가 같은 행만 읽고 쓸 수 있고, `app.role`이 `admin`이면 모든 행에 접근

  - `order_items`는 연결된 주문이 `orders` 정책을 통과할 때만 접근

  - 남의 명의로 주문을 넣으면 DB가 SQLSTATE `42501`로 거부

- 앱 전용 DB 역할 `order_app` (마이그레이션 `0014_app_role`)

  - 테이블 소유자는 정책을 우회하므로, 앱은 소유자가 아닌 `order_app`으로 접속

  - 테이블과 시퀀스의 읽기·쓰기 권한만 받고, 이후 생기는 테이블에도 같은 권한이 기본으로 붙음

- 연결 분리

  - 앱은 `DATABASE_URL`(`order_app`), 마이그레이션·시드·검증 스크립트는 `ADMIN_DATABASE_URL`(소유자 `order`)로 접속

  - 컨테이너에서도 `api`는 `order_app`, `migrate`는 소유자로 접속

- `PrismaService.asUser` / `asAdmin`

  - 트랜잭션을 열고 `set_config(..., true)`로 `app.user_id` 또는 `app.role`을 설정한 뒤 콜백을 실행

  - 설정은 그 트랜잭션 안에서만 유지되어, 커넥션 풀을 공유하는 다른 요청으로 새지 않음

  - `/me/orders`와 결제는 `asUser`, 관리자용 주문 목록·단건·생성·합계와 사용자별 주문 목록은 `asAdmin`

- 앞 단계까지의 기능은 그대로입니다. JWT 로그인과 refresh 토큰 회전, 결제와 `Idempotency-Key`, outbox와 BullMQ 메일 발송, socket.io 실시간 알림, 상품 이미지 업로드, 카테고리 트리, 리더 선출 정리 작업, 헬스 체크와 OpenTelemetry 추적이 포함됩니다.

## 구성

```text
.
├── order-api-nest/                   # NestJS API
│   ├── prisma/
│   │   ├── migrations/
│   │   │   ├── 0013_enable_rls/      # orders, order_items에 RLS와 정책
│   │   │   └── 0014_app_role/        # 앱 전용 역할 order_app과 권한
│   │   └── seed.ts                   # ADMIN_DATABASE_URL로 접속해 시드
│   ├── src/
│   │   ├── prisma/prisma.service.ts  # asUser, asAdmin
│   │   ├── me/me.controller.ts       # 내 주문 조회(asUser)
│   │   ├── orders/orders.service.ts  # 결제(asUser), 관리자용 조회·생성(asAdmin)
│   │   └── users/users.service.ts    # 사용자별 주문 목록(asAdmin)
│   ├── test/
│   │   ├── admin-db.ts               # 소유자 계정으로 접속하는 테스트용 클라이언트
│   │   ├── rls.e2e-spec.ts           # RLS 회귀 테스트
│   │   └── setup-env.ts              # TEST_DATABASE_URL, TEST_ADMIN_DATABASE_URL 확인
│   ├── scripts/                      # 동시성·큐·업로드 실험 스크립트
│   ├── loadtest/                     # 부하 테스트
│   ├── prisma7.config.ts             # ADMIN_DATABASE_URL을 우선 사용
│   ├── Dockerfile
│   ├── docker-compose.yml            # app 프로필로 api까지 컨테이너로 띄움
│   └── .env                          # 학습용 값으로 커밋됨
├── order-console-next/               # Next.js 주문 콘솔 (09-category-tree와 같음)
└── README.md
```

## 실행

PostgreSQL(`5433`), Redis(`6380`), 저장소(`9000`/`9001`)를 compose로 띄웁니다. API는 `4000`에서 뜹니다.

마이그레이션은 `ADMIN_DATABASE_URL`(소유자)로 적용되고, `order_app` 역할도 이때 만들어집니다.

```sh
cd order-api-nest
npm ci
docker compose up -d db redis storage
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

데모 계정은 `kim`, `lee`, `park`, `choi`이고 비밀번호는 `1234`입니다(`DEMO_PASSWORD`).

`kim`으로 로그인해 `lee`의 주문을 요청하면 404가 돌아옵니다.

```sh
curl -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2 # lee의 주문 → 404
```

앱까지 컨테이너로 띄우려면 `app` 프로필을 씁니다. `migrate`가 끝난 뒤 `api`가 `order_app`으로 접속합니다.

```sh
docker compose --profile app up -d --build
```

## 테스트

e2e는 테스트 전용 DB를 씁니다. 앱은 `TEST_DATABASE_URL`(`order_app`), 데이터 준비와 결과 확인은 `TEST_ADMIN_DATABASE_URL`(소유자)로 접속합니다.

처음 한 번 테스트 DB를 만들고 마이그레이션을 적용합니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # RLS 테스트 포함
npm run lint
```

RLS e2e는 사용자를 설정하지 않으면 주문이 0건인지, `kim`으로 설정하면 `kim`의 주문만 보이는지, 남의 명의로 넣으면 DB가 `42501`로 거부하는지, 트랜잭션이 끝난 뒤 설정이 남지 않는지 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
