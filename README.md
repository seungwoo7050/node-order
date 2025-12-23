# 16: 배포 준비

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Docker%20%7C%20Docker%20Compose-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [15-monitoring](https://github.com/seungwoo7050/node-order/tree/15-monitoring) 브랜치의 `order-api-nest`, `order-console-next`

지금까지는 API만 컨테이너 이미지가 있었고, 프론트는 PC에서 `npm run dev`로 띄웠습니다. compose 파일과 모니터링 설정도 백엔드 폴더 안에 있었습니다.

이 단계에서는 웹(Next)도 운영과 같은 이미지로 만들고, 루트의 compose 파일 하나로 인프라 → 앱 → 모니터링을 띄웁니다. 그 상태에서 지금까지의 테스트를 다시 통과시킵니다.

## 지원 범위

- 웹 이미지 `order-console-next/Dockerfile`

  - Next의 standalone 출력으로 `server.js`와 실제로 쓰는 파일만 담음(이미지 안의 `node_modules` 38MB)

  - `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL`은 빌드할 때 브라우저용 JS에 박히므로 빌드 인자로 넘김. 실행할 때 환경변수로 바꿔도 반영되지 않음

  - 이미지 빌드에서는 타입 검사를 건너뜀(`SKIP_TYPECHECK=1`). 타입 검사는 백엔드 소스까지 있는 루트에서 함

- 루트 `compose.yaml` 하나로 단계별 실행

  - 프로필 없이: db, redis, storage, jaeger (개발할 때)

  - `app` 프로필: migrate(한 번 실행), api, web. 웹 서버는 API를 서비스 이름(`http://api:4000`)으로, 브라우저는 `http://localhost:4000`으로 부름

  - `monitoring` 프로필: Prometheus, Alertmanager, Grafana. Prometheus는 컨테이너의 API(`api:4000`)를 수집

- 비밀 값은 루트 `.env` 하나에 두고 compose가 서비스마다 나눠 줌(GitHub 값 하나를 api와 web에 다른 이름으로). 비우면 GitHub 로그인과 Stripe 결제만 동작하지 않음

- Dockerfile마다 전용 `.dockerignore`(`<이름>.dockerignore`). 두 이미지가 같은 빌드 컨텍스트(루트)를 쓰면서 상대 폴더를 통째로 뺌

- 루트 `package.json`의 확인 명령: `lint`, `typecheck`, `test:api`, `test:web`, `test:rules`, `dev:api`, `dev:web`

- 정리

  - 학습 초기의 데모 화면(`/orders`), `create-next-app` 템플릿, 실험 파일을 걷어 냄. 첫 화면은 `/shop`

  - 린트 에러(`no-floating-promises`)와 타입 에러(`supertest/types`의 ESM 확장자)를 고쳐 `lint`·`typecheck`가 종료 코드 0

  - 시드(`tsx prisma/seed.ts`)가 컨테이너에서도 돌도록 `tsx`를 백엔드 개발 의존성에 추가

- `15-monitoring`까지의 기능은 그대로입니다. 웹 화면은 WebSocket 알림을 구독하지 않고, 알림은 백엔드 기능으로만 있습니다.

## 구성

```text
.
├── package.json                      # 워크스페이스 루트, 확인 명령(lint, typecheck, test:*)
├── compose.yaml                      # 인프라 + app·monitoring 프로필
├── .env.example                      # compose가 읽는 비밀 값 견본(.env는 커밋하지 않음)
├── monitoring/                       # Prometheus·Alertmanager·Grafana 설정(백엔드 폴더에서 옮김)
│   └── prometheus.yml                # 수집 대상이 컨테이너의 api:4000
├── scripts/
│   ├── alert-receiver.mjs            # 경보 수신 서버(5001)
│   └── traffic.mjs                   # 꾸준한 요청 발생
├── order-api-nest/                   # NestJS API
│   ├── Dockerfile                    # deps → build → migrate / prod-deps → runtime
│   ├── Dockerfile.dockerignore       # API 이미지용(프론트 폴더를 뺌)
│   └── test/app.e2e-spec.ts          # supertest/types.js (ESM 확장자)
├── order-console-next/               # Next.js 프론트
│   ├── Dockerfile                    # deps → build → runtime(standalone)
│   ├── Dockerfile.dockerignore       # 웹 이미지용(백엔드 폴더를 뺌)
│   ├── next.config.ts                # output: "standalone", outputFileTracingRoot
│   └── app/page.tsx                  # /shop으로 보냄
└── README.md
```

## 실행

### 전체를 컨테이너로

의존성은 루트에서 한 번 설치합니다. 결제·GitHub 로그인을 쓰지 않으면 `.env`를 비워 둬도 나머지는 동작합니다.

```sh
npm ci
cp .env.example .env
docker compose --profile app up -d --build
docker compose --profile app run --rm migrate npx prisma db seed # 데모 데이터. 표를 비우고 다시 채움
```

| 도구 | 주소 |
|---|---|
| 웹 | http://localhost:3000 (데모 사용자 `kim` / `1234`) |
| API | http://localhost:4000 |
| 저장소 콘솔 | http://localhost:9001 |
| Jaeger | http://localhost:16686 |

모니터링까지 띄우려면 프로필을 더합니다.

```sh
docker compose --profile app --profile monitoring up -d
```

| 도구 | 주소 |
|---|---|
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3001/d/order-api |

배포 주소로 띄울 때는 `.env`에 `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `PUBLIC_STORAGE_URL`(그리고 긴 무작위 `JWT_SECRET`)을 더하고 `--build`로 다시 빌드합니다. 비워 두면 로컬 주소를 씁니다. `PUBLIC_API_URL`은 웹 이미지에 빌드할 때 박히기 때문입니다.

### 개발 모드

인프라만 컨테이너로 띄우고, API와 웹은 PC에서 띄웁니다. 컨테이너의 api·web과 포트가 겹치므로 `app` 프로필은 내려 둡니다.

PC에서 띄우면 루트 `.env`가 아니라 프로젝트마다의 파일을 읽습니다. API는 커밋된 `order-api-nest/.env`(학습용 데모 값)를, 웹은 `order-console-next/.env.example`을 복사한 `.env.local`을 씁니다.

```sh
cp order-console-next/.env.example order-console-next/.env.local
docker compose up -d
npm exec -w order-api-nest -- prisma generate
npm exec -w order-api-nest -- prisma migrate deploy
npm exec -w order-api-nest -- prisma db seed
npm run dev:api # :4000
npm run dev:web # :3000 (다른 터미널)
```

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다(compose의 db 볼륨을 지우면 다시).

```sh
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
```

```sh
npm run lint
npm run typecheck
npm run test:api   # 단위 + e2e(PC에서 테스트 DB로)
npm run test:web   # 프론트 e2e. 3000에 떠 있는 web을 대상으로 돎
npm run test:rules # 경보 규칙 단위 테스트(promtool)
```

`test:web`은 3000번에 이미 떠 있는 서버를 씁니다(`reuseExistingServer: true`). 전체를 컨테이너로 띄운 상태면 컨테이너의 web·api를, 내린 상태면 PC에서 빌드해 띄운 웹을 테스트합니다.

실제 Stripe 결제 e2e는 `.env`에 Stripe 테스트 키를 채우고, 다른 터미널에서 웹훅을 넘겨 받을 때만 돕니다. `.env`의 `STRIPE_WEBHOOK_SECRET`은 `stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret`의 값이어야 합니다.

```sh
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:4000/payments/webhook
cd order-console-next
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
```

## 정리

```sh
docker compose --profile app --profile monitoring down    # 컨테이너만 내림
docker compose --profile app --profile monitoring down -v # DB·저장소 볼륨까지 삭제(테스트 DB도 지워짐)
```
