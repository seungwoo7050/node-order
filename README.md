# 05: 프론트엔드 상태

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20TanStack%20Query%20%7C%20Zustand%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 두 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [04-redis](https://github.com/seungwoo7050/node-order/tree/04-redis) 브랜치의 `order-api-nest`

- node-workspace 저장소의 [foundation/04-integration-and-auth](https://github.com/seungwoo7050/node-workspace/tree/foundation/04-integration-and-auth) 브랜치의 `order-console-next`

지금까지 만든 주문 API를 브라우저에서 쓰도록, 주문 콘솔(`order-console-next`)에 상품·장바구니·로그인·결제 화면을 붙입니다. 서버에 있는 데이터는 TanStack Query로, 브라우저에만 있는 데이터는 Zustand로 나눠 다룹니다.

## 지원 범위

- 상품 목록 `/shop`

  - `GET /products`를 `useQuery`로 받아 30초 동안 캐시하고 재고를 표시

  - `QueryClient`는 서버에서는 요청마다 새로 만들고, 브라우저에서는 하나를 재사용

- 장바구니 (Zustand `persist`)

  - `localStorage`에 저장되어 새로고침해도 남고, 하이드레이션 에러 없이 복원

  - 상단 메뉴에 담은 개수 표시, 재고가 0인 상품은 담기 비활성화

- 로그인 `/login`과 로그아웃

  - 액세스 토큰은 메모리(store)에만 두고, 새로고침 뒤에는 httpOnly 쿠키의 refresh token으로 다시 받음

  - `authFetch`가 401을 받으면 한 번 갱신하고 다시 요청. 401은 TanStack Query가 재시도하지 않음

  - 동시에 여러 요청이 갱신을 시도해도 `/auth/refresh`는 한 번만 보냄 (single-flight). 백엔드의 refresh token 재사용 감지에 걸려 세션이 회수되는 것을 막음

- 결제: `POST /orders/checkout`을 `useMutation`으로 호출

  - 장바구니마다 `Idempotency-Key`를 하나 발급해 두고, 장바구니가 그대로면 다시 눌러도 같은 키를 보냄. 응답이 사라져 다시 눌러도 주문은 하나만 생김

  - 장바구니를 바꾸면 키를 버리고, 성공하면 장바구니를 비움

  - 성공하면 상품 목록과 내 주문 캐시를 무효화해 다시 받아 옴

- 내 주문 `/me/orders`, `/me/orders/[id]` (401이면 로그인 안내, 404면 "해당 주문은 없습니다")

- 앞 단계의 주문 관리 화면 `/orders`, `/orders/[id]` (서버 컴포넌트와 서버 액션)

- 백엔드(`order-api-nest`)는 `04-redis` 그대로입니다. 바뀐 것은 없습니다.

## 구성

```text
.
├── order-api-nest/               # NestJS API (04-redis와 같음, 자세한 내용은 그 브랜치 README)
├── order-console-next/           # Next.js(App Router) 주문 콘솔
│   ├── app/
│   │   ├── layout.tsx            # Providers와 Nav로 감싼 루트 레이아웃
│   │   ├── providers.tsx         # QueryClientProvider(staleTime 30초, 401 재시도 안 함)
│   │   ├── nav.tsx               # 메뉴, 장바구니 개수, 로그인/로그아웃 전환
│   │   ├── shop/page.tsx         # 상품 목록, 담기, 장바구니 패널과 결제
│   │   ├── login/page.tsx        # 로그인 폼
│   │   ├── me/orders/            # 내 주문 목록(my-order-list.tsx)과 상세([id])
│   │   └── orders/               # 앞 단계의 주문 관리 화면(서버 컴포넌트, 서버 액션)
│   ├── lib/
│   │   ├── api-client.ts         # 브라우저용 fetch: publicFetch, authFetch, login/logout, single-flight refresh
│   │   ├── api.ts                # 앞 단계 주문 관리 화면용 가짜 데이터(지연을 흉내 냄)
│   │   ├── auth-store.ts         # 액세스 토큰 store(메모리에만, persist 없음)
│   │   └── cart-store.ts         # 장바구니 store(persist)와 결제용 Idempotency-Key
│   ├── e2e/shop.spec.ts          # Playwright 시나리오 4개
│   ├── playwright.config.ts      # next dev를 webServer로 띄움, workers 1
│   └── .env.example              # API_URL, DEMO_PASSWORD, NEXT_PUBLIC_API_URL
└── README.md
```

## 실행

백엔드를 먼저 `4000`에 띄웁니다. 처음이면 마이그레이션과 시드까지 합니다.

백엔드 `.env`의 `FRONTEND_URL`이 `http://localhost:3000`이어야 쿠키를 실은 요청이 CORS를 통과합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 프론트를 띄웁니다(`3000`).

`.env.local`의 `DEMO_PASSWORD`는 백엔드 `.env`의 값과 같아야 합니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run dev
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim` / `1234`입니다.

## 테스트

백엔드가 `4000`에 떠 있어야 합니다. 프론트 개발 서버는 Playwright가 직접 띄웁니다(이미 떠 있으면 그것을 씁니다).

시나리오는 시드 데이터(`kim`, 상품 "마우스" = id 2, kim의 주문 #1)를 전제로 하고, 실제로 결제하므로 돌릴 때마다 재고가 줄어듭니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

e2e는 장바구니가 새로고침 뒤에도 남고 하이드레이션 에러가 없는지, 결제 후 재고와 장바구니가 다시 받아 와지는지, 새로고침 뒤 동시 요청에도 refresh가 한 번인지, 결제 응답이 끊겨 다시 눌러도 주문이 하나인지 확인합니다.

재고가 바닥나면 시드를 다시 넣습니다(테이블을 비우고 처음 상태로 되돌립니다).

```sh
cd order-api-nest
npx prisma db seed
```

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB 볼륨까지 삭제
```
