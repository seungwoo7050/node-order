# 05: 프론트엔드 상태

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20TanStack%20Query%20%7C%20Zustand%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [04-redis](https://github.com/seungwoo7050/node-order/tree/04-redis) 브랜치의 `order-api-nest`
- node-workspace 저장소의 [foundation/04-integration-and-auth](https://github.com/seungwoo7050/node-workspace/tree/foundation/04-integration-and-auth) 브랜치의 `order-console-next`

주문 콘솔(`order-console-next`)에 상품 목록·장바구니·로그인·결제·내 주문 화면을 더했습니다.
API에서 받는 데이터는 TanStack Query로, 장바구니와 액세스 토큰은 Zustand store로 다룹니다.
백엔드(`order-api-nest`)는 04와 같습니다.

## 지원 범위

- `/shop`: `GET /products`를 `useQuery`로 받아 재고와 함께 표시, 재고 0인 상품은 담기 버튼 비활성화
- `QueryClient`: `staleTime` 30초, 401은 재시도하지 않음(그 밖의 오류는 1번 재시도). 서버에서는 렌더마다 새로 만들고 브라우저에서는 하나를 재사용
- 장바구니: Zustand `persist`로 `localStorage`의 `cart` 키에 저장, 상단 메뉴에 담은 개수 표시
- `/login`과 로그아웃
  - 액세스 토큰은 메모리 store에만 두고, 새로고침 뒤에는 httpOnly 쿠키의 refresh token으로 `/auth/refresh`를 불러 다시 받음
  - `authFetch`: 토큰이 없으면 먼저 refresh, 401을 받으면 한 번 refresh 후 재요청
  - 동시에 여러 요청이 refresh를 시도해도 진행 중인 Promise 하나를 같이 기다림(`/auth/refresh` 1번)
- 결제: `POST /orders/checkout`을 `useMutation`으로 호출
  - 장바구니마다 `Idempotency-Key`(UUID)를 하나 만들어 store에 두고, 장바구니가 그대로면 다시 눌러도 같은 키를 보냄. 담기·빼기를 하면 키를 버림
  - 성공하면 장바구니를 비우고 `products`, `my-orders` 쿼리를 무효화
  - 실패가 401이면 로그인 링크 표시
- `/me/orders`, `/me/orders/[id]`: 내 주문 목록과 상세. 목록은 401이면 로그인 안내, 상세는 404면 "해당 주문은 없습니다"
- `/orders`, `/orders/[id]`: 이전 단계의 주문 관리 화면(`lib/api.ts`의 고정 데이터). "테스트 주문 만들기" 버튼은 서버 액션이 `API_URL`로 `kim` 로그인 후 `POST /orders`

## 구성

`04`에서 바뀐 곳만 적습니다. `order-api-nest`는 바뀌지 않았고, `order-console-next`가 새로 들어왔습니다.

```text
order-console-next/                  # Next.js 16(App Router) 주문 콘솔
├── app/
│   ├── layout.tsx                   # Providers와 Nav로 감싼 루트 레이아웃
│   ├── providers.tsx                # QueryClientProvider
│   ├── nav.tsx                      # 메뉴, 장바구니 개수, 로그인/로그아웃
│   ├── shop/page.tsx                # 상품 목록, 장바구니 패널, 결제
│   ├── login/page.tsx               # 로그인 폼
│   ├── me/orders/                   # 내 주문 목록(my-order-list.tsx)과 상세([id]/page.tsx)
│   └── orders/                      # 이전 단계의 주문 관리 화면, 서버 액션(actions.ts)
├── lib/
│   ├── api-client.ts                # publicFetch, authFetch, login, logout, refreshAccessToken
│   ├── auth-store.ts                # 액세스 토큰 store(persist 없음)
│   ├── cart-store.ts                # 장바구니 store(persist)와 checkoutKey
│   └── api.ts                       # /orders 화면용 고정 데이터와 지연
├── e2e/shop.spec.ts                 # Playwright 시나리오 4개
├── playwright.config.ts             # webServer로 npm run dev(:3000), workers 1
├── .env.example                     # API_URL, DEMO_PASSWORD, NEXT_PUBLIC_API_URL
└── package.json                     # next, @tanstack/react-query, zustand, @playwright/test
```

## 실행

백엔드는 04와 같이 띄웁니다(PostgreSQL `5433`, Redis `6380`, API `4000`).
백엔드 `.env`의 `FRONTEND_URL`은 `http://localhost:3000`이고, CORS가 이 출처에만 쿠키를 실은 요청을 허용합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev                  # localhost:4000
```

다른 터미널에서 프론트를 띄웁니다. `.env.local`의 `DEMO_PASSWORD`는 백엔드 `.env`와 같은 값이어야 서버 액션의 로그인이 됩니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run dev                        # localhost:3000
```

http://localhost:3000/shop 에서 시드 계정 `kim` / `1234`로 로그인합니다.

## 테스트

```sh
cd order-console-next
npm run lint                       # eslint
npx playwright install chromium    # 처음 한 번
npm run test:e2e                   # Playwright
```

e2e는 백엔드가 `4000`에 떠 있어야 하고, 프론트 개발 서버는 Playwright가 띄웁니다(이미 떠 있으면 그것을 씀).
시나리오는 시드 데이터(`kim`/`1234`, 상품 id 2 "마우스", `kim`의 주문 #1)를 전제로 하며 실제로 결제하므로 돌릴 때마다 재고가 줄어듭니다. 처음 상태로 돌리려면 `order-api-nest`에서 `npx prisma db seed`를 다시 실행합니다.

`e2e/shop.spec.ts`의 시나리오:

- 장바구니에 2개 담고 새로고침해도 개수가 남고, 콘솔에 hydration 오류가 없음
- 결제하면 재고가 1 줄어든 값으로 다시 표시되고 장바구니가 비워짐
- 새로고침 뒤 `/me/orders/1`에서 인증 요청 두 개가 동시에 나가도 `/auth/refresh`는 1번
- 첫 결제 응답을 끊고 다시 눌러도 내 주문은 1건만 늘어남

백엔드 테스트는 04와 같습니다.

## 정리

```sh
cd order-api-nest
docker compose down      # PostgreSQL·Redis 컨테이너 내림
docker compose down -v   # DB 볼륨까지 삭제
```
