# 12: tRPC

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20tRPC%20%7C%20zod-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [11-service-worker](https://github.com/seungwoo7050/node-order/tree/11-service-worker) 브랜치

지금까지 프론트는 백엔드 응답의 모양을 손으로 다시 적었기 때문에, 백엔드가 응답을 바꾸면 화면이 실제로 깨져야 알 수 있었습니다.

백엔드(`order-api-nest`)와 프론트(`order-console-next`)를 npm 워크스페이스 하나로 묶고, 프론트가 tRPC로 백엔드 프로시저의 타입을 그대로 가져다 쓰게 합니다. 응답 모양이 바뀌면 빌드 전에 타입 검사가 잡습니다.

## 지원 범위

- 앞 단계의 API 전부

  - JWT 로그인과 refresh 회전, 주문·결제(`POST /orders/checkout`, `Idempotency-Key`)

  - outbox와 BullMQ 메일, socket.io 알림, presigned 이미지 업로드, 카테고리 트리

  - PostgreSQL RLS(`order_app` 역할), `GET /health`

- 앞 단계의 콘솔 전부: 로그인·상점·주문 관리·내 주문 화면, 장바구니, 서비스 워커 오프라인 화면

- tRPC 라우터 `/trpc` (Nest 미들웨어로 연결)

  - 공개: `products.list`, `categories.products`

  - 로그인 필요: `me.orders`, `me.order`. `Authorization` 헤더의 JWT에서 사용자를 꺼내고, `asUser`로 RLS를 적용

  - REST 컨트롤러와 tRPC 라우터가 같은 `orderSelect`를 써서 응답 모양이 같음

- 에러 처리

  - 입력은 zod로 검증하고, 맞지 않으면 프로시저가 실행되기 전에 `BAD_REQUEST`

  - 응답에서 stack을 지우고, `INTERNAL_SERVER_ERROR`는 메시지를 "서버 오류"로 감추고 로그로 남김

  - 서비스가 던진 Nest `HttpException`은 상태 코드에 맞는 tRPC 에러(`NOT_FOUND`, `CONFLICT` 등)로 바꿈

- 타입 공유

  - 백엔드 패키지가 `exports`의 `./trpc`로 라우터 타입만 내보내고, 프론트가 그 타입으로 클라이언트를 만듦

  - 상품 목록과 내 주문 목록·상세를 tRPC 쿼리로 바꾸고, 손으로 적었던 응답 타입을 지움

- 묶음 요청: `splitLink`와 `httpBatchLink`로 같은 순간의 요청을 HTTP 하나로 묶음. `me.`로 시작하는 요청만 토큰을 실음

- Docker: 워크스페이스 루트를 빌드 컨텍스트로 쓰도록 `Dockerfile`과 `.dockerignore`를 고침

## 구성

```text
.
├── package.json                  # 워크스페이스 루트(order-api-nest, order-console-next)
├── package-lock.json             # 두 프로젝트의 잠금 파일을 하나로 합친 것
├── .dockerignore                 # 루트를 빌드 컨텍스트로 쓸 때의 제외 목록
├── order-api-nest/               # NestJS API
│   ├── src/
│   │   ├── trpc/
│   │   │   ├── trpc.ts           # initTRPC, 에러 감추기, Nest 예외 변환, public/protectedProcedure
│   │   │   ├── router.ts         # appRouter와 AppRouter 타입
│   │   │   └── trpc.module.ts    # /trpc에 Express 미들웨어로 연결, JWT로 컨텍스트 생성
│   │   └── me/order-select.ts    # REST와 tRPC가 함께 쓰는 주문 select
│   ├── prisma/
│   ├── test/trpc.e2e-spec.ts     # 프로시저를 함수처럼 불러 검증·권한·RLS·에러 변환 확인
│   ├── Dockerfile                # npm ci -w order-api-nest로 백엔드 의존성만 설치
│   └── docker-compose.yml        # 빌드 컨텍스트는 저장소 루트(..)
├── order-console-next/           # Next.js(App Router) 주문 콘솔
│   ├── app/
│   │   ├── providers.tsx         # QueryClientProvider와 TRPCProvider
│   │   ├── shop/                 # 상품 목록(tRPC), 장바구니, 결제, 이미지 업로드
│   │   └── me/orders/            # 내 주문 목록과 상세(tRPC)
│   ├── lib/
│   │   ├── trpc.ts               # tRPC 클라이언트(splitLink + httpBatchLink)
│   │   └── api-client.ts         # fetchWithAuth(토큰 첨부와 refresh), authFetch
│   ├── public/sw.js              # 서비스 워커
│   └── e2e/trpc.spec.ts          # 묶음 요청이 HTTP 하나인지 확인
└── README.md
```

## 실행

의존성은 루트에서 한 번 설치합니다. 그다음 명령은 각 프로젝트 폴더에서 실행합니다.

```sh
npm ci
```

백엔드는 PostgreSQL(`5433`), Redis(`6380`), 저장소(`9000`/`9001`)를 compose로 띄우고, API는 `4000`에서 뜹니다.

마이그레이션과 시드는 `.env`의 `ADMIN_DATABASE_URL`(소유자)로, 앱은 `order_app`으로 붙습니다.

```sh
cd order-api-nest
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
curl localhost:4000/trpc/products.list
```

다른 터미널에서 프론트를 띄웁니다(`3000`). 서비스 워커까지 보려면 `build`와 `start`로 띄웁니다.

```sh
cd order-console-next
cp .env.example .env.local
npm run build
npm run start
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim`, `lee`, `park`, `choi`이고 비밀번호는 `1234`입니다.

## 테스트

백엔드 e2e는 테스트 전용 DB를 씁니다. 처음 한 번 `order-api-nest`에서 만듭니다.

```sh
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

백엔드 e2e는 tRPC 프로시저를 함수처럼 불러 로그인 확인, 다른 사용자 주문의 `NOT_FOUND`, zod 입력 검증, Nest 예외 변환을 확인하고, HTTP로 토큰 처리와 응답에 stack이 없는지 확인합니다.

프론트 e2e는 백엔드를 `4000`에 띄우고, 프론트 개발 서버는 끈 상태로 돌립니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

프론트 e2e는 주문 상세 화면의 `me.order`, `me.orders`가 HTTP 요청 하나(`/trpc/me.order,me.orders`)로 묶이는지와, 앞 단계의 장바구니·결제·업로드·오프라인 흐름을 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
