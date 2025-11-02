# 08: 부하 테스트와 CSP

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20k6%20%7C%20CSP-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [07-operations](https://github.com/seungwoo7050/node-order/tree/07-operations) 브랜치

k6로 결제 API에 부하를 걸어 처리량이 멈추는 지점과 추적·로그가 드는 비용을 숫자로 재고, 주문 콘솔(`order-console-next`)에 요청마다 nonce를 새로 넣은 Content-Security-Policy 헤더를 붙입니다.

## 지원 범위

- k6 결제 부하 시나리오 `loadtest/checkout.js`

  - `setup()`에서 `kim`으로 한 번 로그인하고, 모든 VU가 그 토큰으로 `POST /orders/checkout`을 수량 1개씩 반복

  - 기본은 3~52번 상품에 고르게 분산하고, `HOT=1`이면 모든 요청을 1번 상품에 몰아 같은 행의 잠금 경합을 재현

  - `VUS`(기본 20), `DURATION`(기본 20s), `API`(기본 `http://api:4000`)로 조건을 바꿈

  - 기준선: 실패율 1% 미만, 결제 응답 p95 200ms 미만. 넘으면 k6가 실패로 종료

- 부하용 시드 `loadtest/load-seed.sql`

  - 재고 100만 개짜리 부하용 상품 50개(3~52번)를 추가하고, 1·2번 상품의 재고도 100만 개로 올림

  - `npx prisma db seed`로 상품 id를 1부터 다시 센 직후에 넣어야 번호가 맞음

- 관측 비용 비교용 설정 (compose의 api 환경변수)

  - `OTEL_SDK_DISABLED`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `LOG_LEVEL`을 앞에 붙여 api만 다시 띄움

  - 값을 주지 않으면 기존과 같이 추적 100%, 로그 레벨 `info`

- 프론트 CSP (`proxy.ts`)

  - 요청마다 nonce를 새로 만들어 요청 헤더(`x-nonce`, `Content-Security-Policy`)와 응답 헤더에 둘 다 넣음

  - `script-src 'self' 'nonce-...' 'strict-dynamic'`, `style-src 'self' 'nonce-...'`. 개발 모드에서만 `'unsafe-eval'`을 더함

  - 이미지와 fetch는 API(`NEXT_PUBLIC_API_URL`)와 저장소(`NEXT_PUBLIC_STORAGE_URL`)만 허용

  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`

  - 정적 파일과 prefetch 요청은 `matcher`에서 제외

- nonce에 맞춘 렌더링

  - 루트 레이아웃에서 `await connection()`으로 모든 페이지를 요청마다 렌더링하고, `instant = false`로 빌드가 멈추지 않게 함

  - `style-src`에 `'unsafe-inline'`이 없으므로 `Nav`의 `style` 속성을 Tailwind 클래스로 바꿈

- 그 밖의 API와 콘솔 화면(로그인·토큰 회전, 주문·결제, 알림, 메일 큐, 이미지 업로드, 헬스 체크, pino 로그, OpenTelemetry 추적)은 `07-operations` 그대로입니다.

## 구성

```text
.
├── order-api-nest/                 # NestJS API (07-operations 기반)
│   ├── docker-compose.yml          # db·redis·storage(RustFS)·jaeger, app 프로필에 migrate·api, 관측 스위치 환경변수
│   └── loadtest/
│       ├── checkout.js             # k6 결제 시나리오(VUS, DURATION, HOT, API)
│       └── load-seed.sql           # 부하용 상품 50개와 재고 보충
├── order-console-next/             # Next.js 주문 콘솔
│   ├── proxy.ts                    # 요청마다 nonce를 만들고 CSP 헤더를 붙임
│   ├── app/layout.tsx              # connection()으로 요청마다 렌더링, instant = false
│   ├── app/nav.tsx                 # style 속성 대신 클래스
│   ├── e2e/                        # Playwright 시나리오 6개(shop 4, upload 2)
│   └── .env.example                # API_URL, DEMO_PASSWORD, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STORAGE_URL
└── README.md
```

## 실행

백엔드를 컨테이너로 띄우고 시드와 부하용 상품을 넣습니다.

API `4000`, PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, Jaeger 화면 `16686`입니다. 데모 계정은 `kim` / `1234`입니다.

```sh
cd order-api-nest
npm ci
docker compose --profile app up -d --build
npx prisma generate
npx prisma db seed
docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
```

k6는 설치하지 않고 Docker 이미지로 compose 네트워크(`order-api-nest_default`) 안에서 실행합니다. 폴더 이름이 다르면 네트워크 이름도 달라지니 `docker network ls`로 확인합니다.

```sh
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run /scripts/checkout.js
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run -e VUS=50 -e HOT=1 /scripts/checkout.js
```

관측 비용은 설정마다 api만 다시 띄워 같은 조건으로 잽니다. 매번 api가 healthy가 된 뒤에 재고, 끝나면 기본값으로 되돌립니다.

```sh
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 docker compose --profile app up -d api # 추적 10%
OTEL_SDK_DISABLED=true docker compose --profile app up -d api                                                    # 추적 끔
OTEL_SDK_DISABLED=true LOG_LEVEL=warn docker compose --profile app up -d api                                     # 추적·요청 로그 끔
docker compose --profile app up -d api                                                                           # 기본값으로 되돌림
```

프론트는 CSP를 실제 배포 모양으로 보기 위해 운영 빌드로 띄웁니다(`3000`). 개발 서버는 `'unsafe-eval'`이 더해지고 동작도 달라서 확인용으로 맞지 않습니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run build
npx next start -p 3000
```

헤더는 다른 터미널에서 확인합니다. 같은 명령을 다시 치면 `nonce-` 뒤의 값이 바뀌어야 합니다.

```sh
curl -sI localhost:3000/shop | grep -i content-security-policy
```

## 테스트

e2e 테스트는 `.env`의 `TEST_DATABASE_URL`이 가리키는 테스트 전용 DB를 씁니다. 인프라가 떠 있는 상태에서 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

프론트 e2e는 백엔드와 위의 운영 서버(`3000`)가 떠 있는 상태에서 돌립니다. Playwright는 이미 떠 있는 서버를 그대로 쓰므로, 6개 시나리오가 CSP가 붙은 운영 빌드에서도 통과하는지 확인합니다.

부하 테스트 뒤에는 `kim`의 주문이 수십만 건 쌓여 `/me/orders`가 제한 시간 안에 뜨지 않습니다. e2e 전에 `order-api-nest`에서 `npx prisma db seed`로 시드를 다시 넣습니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npx playwright test             # 6 passed
npm run lint
```

## 정리

```sh
cd order-api-nest
docker compose --profile app down                # 컨테이너만 내림
docker compose --profile app down -v --rmi local # 볼륨과 빌드한 이미지까지 삭제
docker image rm grafana/k6                       # k6 이미지가 더 필요 없으면
```
