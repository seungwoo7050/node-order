# 11: 서비스 워커

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20Service%20Worker%20%7C%20TanStack%20Query%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [10-rls](https://github.com/seungwoo7050/node-order/tree/10-rls) 브랜치

주문 콘솔(`order-console-next`)에 서비스 워커를 붙여, 한 번 본 상점 화면과 상품 목록을 네트워크가 끊겨도 보여 줍니다.

결제처럼 서버가 꼭 필요한 기능은 오프라인에서 막고, 로그인이 필요한 응답은 캐시하지 않습니다.

## 지원 범위

- 서비스 워커 `public/sw.js`

  - `/_next/static/` 빌드 파일은 cache-first(`static-v1`)

  - 페이지 이동(`pages-v1`)과 공개 API GET(`api-v1`)은 network-first. 네트워크가 끊기면 캐시로, 캐시도 없으면 503

  - `Authorization` 헤더가 붙은 요청은 캐시하지 않음. 오프라인에서 다른 사용자의 토큰으로 남의 응답을 받아 볼 수 없음

  - 캐시 이름에 버전을 붙이고, 새 버전이 활성화되면 옛 캐시를 지움. `skipWaiting`과 `clients.claim`으로 바로 교체

- 서비스 워커 등록 `app/sw-resgister.tsx`

  - 운영 빌드에서만 등록하고, API 주소는 `/sw.js?api=...` 쿼리로 넘김

  - `/sw.js`는 캐시하지 않도록 응답 헤더를 지정(`next.config.ts`)하고, CSP에 `worker-src 'self'`를 추가(`proxy.ts`)

- 오프라인 상태 `app/online-banner.tsx`

  - `useSyncExternalStore`로 `online`/`offline` 이벤트를 구독하는 `useOnline` 훅

  - 오프라인이면 "마지막으로 받은 내용"이라는 배너를 띄우고 결제 버튼을 비활성화

- 앞 단계의 기능(상점·장바구니·로그인·결제·내 주문·주문 관리, 상품 이미지 직접 업로드, nonce 기반 CSP)은 그대로입니다.

- 백엔드(`order-api-nest`)는 `10-rls` 그대로입니다. 바뀐 것은 없습니다.

## 구성

```text
.
├── order-api-nest/               # NestJS API (10-rls와 같음, 자세한 내용은 그 브랜치 README)
├── order-console-next/           # Next.js(App Router) 주문 콘솔
│   ├── app/
│   │   ├── layout.tsx            # Providers, Nav, SwRegister, OnlineBanner로 감싼 루트 레이아웃
│   │   ├── sw-resgister.tsx      # 운영 빌드에서만 서비스 워커 등록
│   │   ├── online-banner.tsx     # useOnline 훅과 오프라인 배너
│   │   ├── shop/                 # 상품 목록, 장바구니와 결제(오프라인이면 막음), 이미지 업로드
│   │   ├── login/page.tsx        # 로그인 폼
│   │   ├── me/orders/            # 내 주문 목록과 상세
│   │   └── orders/               # 주문 관리 화면(서버 컴포넌트, 서버 액션)
│   ├── lib/                      # api-client(publicFetch, authFetch), auth-store, cart-store
│   ├── public/sw.js              # 서비스 워커(캐시 전략)
│   ├── proxy.ts                  # nonce 기반 CSP, worker-src 'self'
│   ├── next.config.ts            # /sw.js 응답 헤더(no-cache)
│   ├── e2e/
│   │   ├── offline.spec.ts       # 오프라인 시나리오 2개
│   │   ├── shop.spec.ts          # 장바구니·결제·refresh 시나리오 4개
│   │   └── upload.spec.ts        # 이미지 업로드 시나리오 2개
│   ├── playwright.config.ts      # build + start를 webServer로 띄움, workers 1
│   └── .env.example              # API_URL, DEMO_PASSWORD, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STORAGE_URL
└── README.md
```

## 실행

백엔드를 먼저 `4000`에 띄웁니다. 처음이면 마이그레이션과 시드까지 합니다.

백엔드 `.env`의 `FRONTEND_URL`이 `http://localhost:3000`이어야 쿠키를 실은 요청이 CORS를 통과합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d # db, redis, storage, jaeger
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 프론트를 띄웁니다(`3000`). 서비스 워커는 운영 빌드에서만 등록되므로 `dev`가 아니라 `build`와 `start`로 띄웁니다.

`.env.local`의 `DEMO_PASSWORD`는 백엔드 `.env`의 값과 같아야 합니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run build
npm run start
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim` / `1234`입니다.

`/shop`을 한 번 연 뒤 개발자 도구에서 네트워크를 오프라인으로 바꾸고 새로고침하면, 상품 목록과 오프라인 배너가 보이고 결제 버튼은 눌리지 않습니다.

## 테스트

백엔드가 `4000`에 떠 있어야 합니다. 프론트는 Playwright가 `npm run build && npm run start`로 직접 띄웁니다.

`3000`에 이미 떠 있는 서버가 있으면 Playwright가 그것을 그대로 씁니다. `npm run dev`로 띄운 개발 서버에서는 서비스 워커가 등록되지 않아 오프라인 시나리오가 실패하므로, 개발 서버는 끄고 실행합니다.

시나리오는 시드 데이터(`kim`, `lee`, 상품 "한정판 키보드"와 "마우스", kim의 주문 #1)를 전제로 하고, 실제로 결제하므로 돌릴 때마다 재고가 줄어듭니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

e2e는 한 번 본 상품 목록이 오프라인에서도 보이고 결제가 막히는지, `Authorization`이 붙은 응답이 캐시되지 않아 오프라인에서 요청이 실패하는지 확인합니다. 앞 단계의 장바구니·결제·refresh·업로드 시나리오도 함께 돌립니다.

재고가 바닥나면 시드를 다시 넣습니다(테이블을 비우고 처음 상태로 되돌립니다).

```sh
cd order-api-nest
npx prisma db seed
```

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB·저장소 볼륨까지 삭제
```

브라우저에 남은 서비스 워커와 캐시는 개발자 도구의 Application 탭에서 등록 해제하고 지웁니다.
