# 08: 부하 테스트와 CSP

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20k6%20%7C%20CSP-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [07-operations](https://github.com/seungwoo7050/node-order/tree/07-operations) 브랜치

결제 API(`POST /orders/checkout`)용 k6 부하 시나리오와 부하용 시드 SQL을 더하고, compose의 `api`에서 추적 샘플링과 로그 레벨을 환경변수로 바꿀 수 있게 했습니다.

주문 콘솔(`order-console-next`)에는 `proxy.ts`에서 요청마다 nonce를 새로 만들어 Content-Security-Policy 헤더를 붙입니다.

## 지원 범위

- k6 결제 시나리오 `loadtest/checkout.js`

  - `setup()`에서 `kim` / `1234`로 한 번 로그인하고, 모든 VU가 그 토큰으로 `POST /orders/checkout`을 수량 1개씩 반복

  - 기본은 3~52번 상품 중 무작위로 고르고, `HOT=1`이면 모든 요청을 1번 상품으로 보냄(같은 행 잠금 경합)

  - `VUS`(기본 20), `DURATION`(기본 `20s`), `API`(기본 `http://api:4000`)로 조건을 바꿈

  - 기준: 실패율 1% 미만, 결제 응답 p95 200ms 미만. 넘으면 k6가 실패로 종료

- 부하용 시드 `loadtest/load-seed.sql`

  - 재고 100만 개짜리 부하용 상품 50개를 추가하고, 1·2번 상품의 재고를 100만 개로 올림

  - `npx prisma db seed`가 상품 2개를 id 1부터 다시 만든 직후에 넣어야 부하용 상품이 3~52번이 됨

- compose `api`의 관측 설정 환경변수

  - `OTEL_SDK_DISABLED`(기본 `false`), `OTEL_TRACES_SAMPLER`(기본 `parentbased_always_on`), `OTEL_TRACES_SAMPLER_ARG`(기본 `1`), `LOG_LEVEL`(기본 `info`)

  - 셸 환경변수로 값을 주고 `api`만 다시 띄우면 적용됨

- 콘솔 CSP (`proxy.ts`)

  - 요청마다 nonce를 만들어 요청 헤더(`x-nonce`, `Content-Security-Policy`)와 응답 헤더에 넣음

  - `script-src 'self' 'nonce-...' 'strict-dynamic'`, `style-src 'self' 'nonce-...'`. `NODE_ENV`가 `development`일 때만 `script-src`에 `'unsafe-eval'` 추가

  - `img-src`·`connect-src`는 `'self'`에 API(`NEXT_PUBLIC_API_URL`)와 저장소(`NEXT_PUBLIC_STORAGE_URL`)를 더해 허용

  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`

  - `matcher`에서 `api`, `_next/static`, `_next/image`, `favicon.ico`와 prefetch 요청은 제외

- nonce에 맞춘 렌더링

  - 루트 레이아웃이 `await connection()`으로 요청마다 렌더링되고, `export const instant = false`를 둠

  - `style-src`에 `'unsafe-inline'`이 없어 `Nav`의 `style` 속성을 Tailwind 클래스(`flex gap-3`)로 바꿈

- 그 밖의 API와 콘솔 화면은 `07-operations`와 같습니다. 화면 문구와 로그의 `—`·`…`는 `-`·`...`로 바꿨습니다.

## 구성

`07`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── docker-compose.yml          # api에 OTEL_SDK_DISABLED, OTEL_TRACES_SAMPLER(_ARG), LOG_LEVEL
│   └── loadtest/
│       ├── checkout.js             # k6 결제 시나리오(VUS, DURATION, HOT, API)
│       └── load-seed.sql           # 부하용 상품 50개와 재고 보충
└── order-console-next/
    ├── proxy.ts                    # 요청마다 nonce를 만들고 CSP 헤더를 붙임
    ├── .env.example                # NEXT_PUBLIC_STORAGE_URL 추가
    └── app/
        ├── layout.tsx              # connection(), instant = false
        └── nav.tsx                 # style 속성 대신 클래스
```

## 실행

Docker가 필요합니다. k6는 설치하지 않고 `grafana/k6` 이미지로 실행합니다. 포트는 `07-operations`와 같습니다(API `4000`, PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, Jaeger `16686`, 콘솔 `3000`).

백엔드를 컨테이너로 띄우고, 시드와 부하용 상품을 넣습니다. 시드에는 전역 `tsx`가 필요합니다.

```sh
cd order-api-nest
npm ci
docker compose --profile app up -d --build
npx prisma generate
npx prisma db seed
docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
```

k6는 compose 네트워크 안에서 `http://api:4000`으로 요청합니다. 네트워크 이름은 compose 프로젝트 이름(기본은 폴더 이름 `order-api-nest`)을 따르므로 다르면 `docker network ls`로 확인합니다.

```sh
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run /scripts/checkout.js
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run -e VUS=50 -e HOT=1 /scripts/checkout.js
```

관측 설정은 `api`만 다시 띄워 바꿉니다. `api`가 healthy가 된 뒤에 k6를 돌립니다.

```sh
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 docker compose --profile app up -d api # 추적 10%
OTEL_SDK_DISABLED=true docker compose --profile app up -d api                                                    # 추적 끔
OTEL_SDK_DISABLED=true LOG_LEVEL=warn docker compose --profile app up -d api                                     # 추적 끔, info 요청 로그 끔
docker compose --profile app up -d api                                                                           # 기본값으로 되돌림
```

콘솔은 운영 빌드로 띄웁니다. 개발 서버(`npm run dev`)에서는 `script-src`에 `'unsafe-eval'`이 더해집니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run build
npx next start -p 3000
```

헤더는 다른 터미널에서 확인합니다. 다시 요청하면 `nonce-` 뒤의 값이 바뀝니다.

```sh
curl -sI localhost:3000/shop | grep -i content-security-policy
```

## 테스트

백엔드 e2e용 테스트 DB 준비와 명령은 `07-operations`와 같습니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test # 처음 한 번
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npm test         # vitest 단위 테스트
npm run test:e2e # 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

콘솔 e2e(Playwright, 시나리오 6개: `shop.spec.ts` 4개, `upload.spec.ts` 2개)는 API가 `4000`에 떠 있어야 합니다. `playwright.config.ts`가 `reuseExistingServer: true`라 `3000`에 위의 운영 서버가 떠 있으면 그 서버로, 없으면 `npm run dev`를 띄워 돌립니다.

`/me/orders`는 사용자의 주문을 페이지 나누기 없이 모두 돌려주므로, k6로 `kim`의 주문이 많이 쌓였으면 e2e 전에 `order-api-nest`에서 `npx prisma db seed`로 시드를 다시 넣습니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

## 정리

```sh
cd order-api-nest
docker compose --profile app down                # 컨테이너만 내림
docker compose --profile app down -v --rmi local # 볼륨과 빌드한 이미지까지 삭제
docker image rm grafana/k6                       # k6 이미지를 지울 때
```
