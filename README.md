# 11: 서비스 워커

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20Service%20Worker%20%7C%20TanStack%20Query%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [10-rls](https://github.com/seungwoo7050/node-order/tree/10-rls) 브랜치

주문 콘솔(`order-console-next`)에 서비스 워커(`public/sw.js`)를 등록해, 빌드 파일·페이지·인증 없는 API GET 응답을 캐시하고 네트워크가 끊기면 캐시로 응답합니다.

오프라인이면 배너를 띄우고 결제 버튼을 비활성화합니다. 백엔드(`order-api-nest`)는 바뀌지 않았습니다.

## 지원 범위

- 서비스 워커 `public/sw.js` (GET 요청만 처리)

  - 같은 출처의 `/_next/static/`: cache-first(`static-v1`)

  - 페이지 이동(`navigate`): network-first(`pages-v1`)

  - API 출처로 가는 요청 중 `Authorization` 헤더가 없는 것: network-first(`api-v1`). `Authorization`이 붙은 요청은 서비스 워커가 가로채지 않아 캐시되지 않음

  - network-first는 성공 응답만 캐시에 넣고, 네트워크 실패 시 캐시 응답, 캐시도 없으면 503

  - `install`에서 `skipWaiting()`, `activate`에서 현재 버전이 아닌 캐시를 지우고 `clients.claim()`

- 등록 `app/sw-resgister.tsx`

  - `NODE_ENV`가 `production`일 때만 `/sw.js?api=<NEXT_PUBLIC_API_URL>`로 등록. 서비스 워커는 이 쿼리로 API 출처를 앎

  - `next.config.ts`: `/sw.js`에 `Cache-Control: no-cache, no-store, must-revalidate`와 `Content-Type` 헤더

  - `proxy.ts`: CSP에 `worker-src 'self'` 추가

- 오프라인 상태 `app/online-banner.tsx`

  - `useOnline()`: `useSyncExternalStore`로 `online`/`offline` 이벤트를 구독해 `navigator.onLine`을 돌려줌

  - `OnlineBanner`: 오프라인이면 "오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다" 표시

  - `/shop` 장바구니의 결제 버튼은 오프라인이면 비활성화

- 그 밖의 콘솔 화면과 백엔드는 `10-rls`와 같습니다.

## 구성

`10`에서 바뀐 곳만 적습니다.

```text
order-console-next/
├── public/sw.js              # 서비스 워커(캐시 전략)
├── app/
│   ├── layout.tsx            # SwRegister, OnlineBanner 추가
│   ├── sw-resgister.tsx      # 운영 빌드에서만 서비스 워커 등록
│   ├── online-banner.tsx     # useOnline 훅과 오프라인 배너
│   └── shop/page.tsx         # 오프라인이면 결제 버튼 비활성화
├── proxy.ts                  # worker-src 'self'
├── next.config.ts            # /sw.js 응답 헤더
├── playwright.config.ts      # webServer를 npm run build && npm run start로(timeout 180초)
└── e2e/offline.spec.ts       # 오프라인 시나리오 2개
```

## 실행

백엔드는 `10-rls`와 같은 방법으로 `4000`에 띄웁니다(시드에는 전역 `tsx` 필요). 백엔드 `.env`의 `FRONTEND_URL`(`http://localhost:3000`)이 CORS 허용 출처입니다.

```sh
cd order-api-nest
npm ci
docker compose up -d # db, redis, storage, jaeger
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

서비스 워커는 운영 빌드에서만 등록되므로 콘솔은 `build`와 `start`로 띄웁니다(`3000`). `.env.local`의 `DEMO_PASSWORD`는 `/orders` 서버 액션이 `kim`으로 로그인할 때 쓰므로 백엔드 `.env`와 같아야 합니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run build
npm run start
```

http://localhost:3000/shop 을 한 번 연 뒤, 개발자 도구에서 네트워크를 오프라인으로 바꾸고 새로고침하면 캐시된 상품 목록과 오프라인 배너가 보이고 결제 버튼이 비활성화됩니다. 데모 계정은 `kim` / `1234`입니다.

## 테스트

콘솔 e2e(Playwright)는 백엔드가 `4000`에 떠 있어야 합니다. `3000`이 비어 있으면 Playwright가 `npm run build && npm run start`로 띄우고, 이미 떠 있는 서버가 있으면 그 서버를 씁니다. `npm run dev` 서버에서는 서비스 워커가 등록되지 않으므로 오프라인 시나리오를 돌릴 때는 개발 서버를 끕니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e # offline 2, shop 4, upload 2
npm run lint
```

`offline.spec.ts`는 한 번 본 상품 목록이 오프라인 새로고침 뒤에도 보이고 결제 버튼이 비활성화되는지, `Authorization`이 붙은 `/me/orders` 요청이 오프라인에서 캐시 응답 없이 실패하는지 확인합니다.

시나리오는 시드 데이터(`kim`·`lee`, 상품 "한정판 키보드"·"마우스", `kim`의 주문 #1)를 전제로 하고 실제로 결제하므로 돌릴 때마다 재고가 줄어듭니다. 시드를 다시 넣으면 처음 상태로 돌아갑니다.

```sh
cd order-api-nest
npx prisma db seed
```

백엔드 테스트는 `10-rls`와 같습니다.

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB·저장소 볼륨까지 삭제
```

브라우저에 남은 서비스 워커와 캐시는 개발자 도구의 Application 탭에서 등록 해제하고 지웁니다.
