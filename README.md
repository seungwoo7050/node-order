# 12: tRPC

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20tRPC%20%7C%20zod-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [11-service-worker](https://github.com/seungwoo7050/node-order/tree/11-service-worker) 브랜치

저장소 루트를 npm 워크스페이스(`order-api-nest`, `order-console-next`)로 묶고, 백엔드에 tRPC 라우터(`/trpc`)를 Nest 미들웨어로 붙였습니다.

프론트는 백엔드 패키지가 내보내는 라우터 타입(`order-api-nest/trpc`)으로 tRPC 클라이언트를 만들어 상품 목록과 내 주문 조회를 바꿨고, 손으로 적었던 응답 타입을 지웠습니다. Docker 빌드는 워크스페이스 루트를 컨텍스트로 쓰도록 바꿨습니다.

## 지원 범위

- tRPC 프로시저 (`/trpc`, Express 어댑터)

  - 공개: `products.list`(REST `GET /products`와 같이 10분짜리 `imageUrl` 포함), `categories.products({ categoryId })`

  - 로그인 필요: `me.orders`, `me.order({ id })`. `Authorization: Bearer` 토큰을 `JwtService`로 검증해 `userId`를 컨텍스트에 넣고, 쿼리는 `asUser`(RLS)로 실행. 다른 사용자의 주문은 `NOT_FOUND`

  - REST `/me/orders`와 tRPC `me.*`가 같은 `orderSelect`(`src/me/order-select.ts`)를 씀

- 에러 처리

  - 입력은 zod로 검증하고, 맞지 않으면 프로시저 실행 전에 `BAD_REQUEST`

  - 토큰이 없거나 잘못되면 `me.*`는 `UNAUTHORIZED`(HTTP 401)

  - 응답 `data.stack`을 지우고, `INTERNAL_SERVER_ERROR`는 메시지를 "서버 오류"로 바꾸고 서버 로그에 남김

  - 프로시저 안에서 던진 Nest `HttpException`은 400·401·403·404·409·429를 같은 의미의 tRPC 에러 코드로 바꿈

- 프론트 tRPC 클라이언트 (`lib/trpc.ts`)

  - `@trpc/tanstack-react-query`의 `TRPCProvider`/`useTRPC`, 쿼리 키는 `trpc.*.queryKey()`로 무효화

  - `splitLink`: `me.`로 시작하는 요청만 `fetchWithAuth`(토큰 첨부, 401이면 refresh 후 재시도)를 쓰는 `httpBatchLink`로, 나머지는 토큰 없는 `httpBatchLink`로 보냄. 같은 순간의 요청은 HTTP 하나로 묶임

  - `/shop` 상품 목록, `/me/orders` 목록과 상세가 tRPC 쿼리. 결제와 이미지 업로드는 REST(`authFetch`) 그대로

- 워크스페이스와 Docker

  - 루트 `package.json`의 `workspaces`, 루트 `package-lock.json` 하나(각 프로젝트의 잠금 파일은 지움)

  - `order-api-nest/package.json`의 `exports["./trpc"]`가 `src/trpc/router.ts` 타입을 가리킴

  - `Dockerfile`은 `npm ci -w order-api-nest`로 백엔드 의존성만 설치하고, compose의 `migrate`·`api`는 빌드 컨텍스트를 저장소 루트(`..`)로 씀. 제외 목록은 루트 `.dockerignore`

- 그 밖의 REST API와 콘솔 화면(서비스 워커 포함)은 `11-service-worker`와 같습니다.

## 구성

`11`에서 바뀐 곳만 적습니다.

```text
.
├── package.json                  # 워크스페이스 루트
├── package-lock.json             # 두 프로젝트를 합친 잠금 파일
├── .dockerignore                 # 루트를 빌드 컨텍스트로 쓸 때의 제외 목록
├── .gitignore
├── order-api-nest/
│   ├── package.json              # exports ./trpc, @trpc/server, zod
│   ├── Dockerfile                # npm ci -w order-api-nest
│   ├── docker-compose.yml        # migrate·api 빌드 컨텍스트를 ..로
│   ├── src/
│   │   ├── app.module.ts         # TrpcModule 등록
│   │   ├── trpc/
│   │   │   ├── trpc.ts           # initTRPC, 에러 포맷, Nest 예외 변환, public/protectedProcedure
│   │   │   ├── router.ts         # appRouter와 AppRouter 타입
│   │   │   └── trpc.module.ts    # /trpc에 미들웨어 연결, JWT로 컨텍스트 생성
│   │   └── me/
│   │       ├── order-select.ts   # REST와 tRPC가 함께 쓰는 주문 select
│   │       └── me.controller.ts
│   └── test/trpc.e2e-spec.ts     # createCaller로 권한·RLS·입력 검증·예외 변환, HTTP로 토큰·stack 확인
└── order-console-next/
    ├── package.json              # @trpc/client, @trpc/server, @trpc/tanstack-react-query
    ├── lib/
    │   ├── trpc.ts               # TRPCProvider, useTRPC, splitLink + httpBatchLink
    │   └── api-client.ts         # fetchWithAuth 분리, authFetch는 그 위에
    ├── app/
    │   ├── providers.tsx         # TRPCProvider, tRPC 401도 재시도하지 않음
    │   ├── shop/                 # 상품 목록을 trpc.products.list로
    │   └── me/orders/            # 목록·상세를 trpc.me.orders / me.order로
    └── e2e/trpc.spec.ts          # me.order, me.orders가 HTTP 요청 하나로 묶이는지
```

## 실행

의존성은 저장소 루트에서 한 번 설치합니다. 그다음 명령은 각 프로젝트 폴더에서 실행합니다.

```sh
npm ci
```

백엔드 실행은 `11-service-worker`와 같습니다(PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, API `4000`, 시드에는 전역 `tsx` 필요).

```sh
cd order-api-nest
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy # ADMIN_DATABASE_URL(소유자)로 적용
npx prisma db seed
npm run start:dev # :4000
curl localhost:4000/trpc/products.list
```

콘솔은 다른 터미널에서 띄웁니다(`3000`). 서비스 워커까지 보려면 `build`와 `start`로 띄웁니다.

```sh
cd order-console-next
cp .env.example .env.local
npm run build
npm run start
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim`, `lee`, `park`, `choi`, 비밀번호는 `1234`입니다.

API까지 컨테이너로 띄우려면 `order-api-nest`에서 `docker compose --profile app up -d --build`를 실행합니다. 빌드 컨텍스트가 저장소 루트이므로 루트의 `package-lock.json`이 필요합니다.

## 테스트

백엔드 e2e는 테스트 전용 DB를 씁니다. 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # vitest 단위 테스트
npm run test:e2e # tRPC, RLS, 카테고리, 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

`trpc.e2e-spec.ts`는 `createCaller`로 로그인 없는 `me.orders`의 `UNAUTHORIZED`, 다른 사용자 주문의 `NOT_FOUND`, zod 입력 검증의 `BAD_REQUEST`, Nest `NotFoundException`의 `NOT_FOUND` 변환을 확인하고, HTTP로 토큰이 있으면 200, 잘못된 토큰이면 401이며 응답에 stack이 없는지 확인합니다.

콘솔 e2e는 백엔드가 `4000`에 떠 있어야 하고, `3000`이 비어 있으면 Playwright가 `npm run build && npm run start`로 띄웁니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e # trpc 1, offline 2, shop 4, upload 2
npm run lint
```

`trpc.spec.ts`는 `/me/orders/1` 화면의 `me.order`, `me.orders`가 HTTP 요청 하나(`/trpc/me.order,me.orders`)로 나가는지 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
