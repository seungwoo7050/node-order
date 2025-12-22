# 16: 배포 준비

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Docker%20%7C%20Docker%20Compose-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [15-monitoring](https://github.com/seungwoo7050/node-order/tree/15-monitoring) 브랜치

웹(Next)에도 standalone 출력으로 만드는 컨테이너 이미지를 더하고, 백엔드 폴더에 있던 compose 파일과 모니터링 설정을 루트로 옮겨 `compose.yaml` 하나로 인프라·앱·모니터링을 띄웁니다. 루트 `package.json`에 lint·타입 검사·테스트 명령을 모았고, 학습 초기의 데모 화면과 템플릿 파일을 걷어 냈습니다.

## 지원 범위

- `15-monitoring`까지의 기능: JWT 로그인과 refresh 회전, GitHub 로그인, Stripe Checkout 결제와 웹훅, outbox와 BullMQ 메일, socket.io 알림(백엔드만, 웹 화면은 구독하지 않음), presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC, 서비스 워커 오프라인 화면, `/metrics`와 경보 규칙
- 웹 이미지 `order-console-next/Dockerfile`
  - deps → build → runtime. `output: "standalone"`으로 만든 `server.js`와 정적 파일만 runtime에 담는다
  - `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL`은 빌드 인자로 받아 브라우저용 JS에 들어가므로, 바꾸려면 다시 빌드한다
  - 이미지 빌드에서는 `SKIP_TYPECHECK=1`로 Next 빌드의 타입 검사를 건너뛴다. 타입 검사는 루트 `npm run typecheck`가 한다
- 루트 `compose.yaml`
  - 프로필 없음: db(`5433`), redis(`6380`), storage(`9000`/`9001`), jaeger(`16686`, `4318`)
  - `app` 프로필: migrate(마이그레이션 후 종료), api(`4000`), web(`3000`). web 서버는 API를 `http://api:4000`으로 부르고, 브라우저용 주소는 빌드 인자로 정한다
  - `monitoring` 프로필: Prometheus(`9090`), Alertmanager(`9093`), Grafana(`3001`). Prometheus는 컨테이너의 `api:4000`을 수집한다
- 루트 `.env`(커밋하지 않음): `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`을 compose가 api·web에 나눠 준다(GitHub 값은 web에 `AUTH_GITHUB_ID`·`AUTH_GITHUB_SECRET`으로). 비워 두면 GitHub 로그인과 Stripe 결제는 동작하지 않는다
- 이미지마다 전용 `.dockerignore`(`<Dockerfile 경로>.dockerignore`). 두 이미지가 루트를 빌드 컨텍스트로 쓰면서 상대 프로젝트 폴더를 뺀다
- 루트 `package.json` 명령: `dev:api`, `dev:web`, `lint`, `typecheck`, `test:api`, `test:web`, `test:rules`
- 정리
  - 데모 화면 `/orders`와 `lib/api.ts`, `create-next-app` 템플릿 이미지, 하위 프로젝트 README, `scratch-client.mjs`를 지웠다. `/`는 `/shop`으로 보낸다
  - `no-floating-promises` 린트 에러(`socket.join`)와 `supertest/types` import 경로(`.js`)를 고쳤다
  - 컨테이너에서 시드(`tsx prisma/seed.ts`)를 돌리도록 `tsx`를 백엔드 개발 의존성에 넣었다
  - 백엔드 `order-api-nest/.env`(로컬 개발용 값)를 다시 커밋했다

## 구성

`15`에서 바뀐 곳만 적습니다.

```text
.
├── package.json                      # 확인 명령(dev:*, lint, typecheck, test:*)
├── compose.yaml                      # order-api-nest/docker-compose.yml에서 옮김, web 서비스와 프로필
├── .env.example                      # compose가 읽는 비밀 값 견본
├── .gitignore                        # .env → /.env (하위 프로젝트 .env는 커밋)
├── monitoring/                       # order-api-nest/monitoring에서 옮김
│   └── prometheus.yml                # 수집 대상 api:4000
├── scripts/                          # order-api-nest/scripts에서 옮김
│   ├── alert-receiver.mjs
│   └── traffic.mjs
├── order-api-nest/
│   ├── .env                          # 로컬 개발용 값
│   ├── Dockerfile.dockerignore       # 루트 .dockerignore에서 옮김, order-console-next 등 제외
│   ├── package.json                  # tsx
│   ├── src/notifications/notifications.gateway.ts # void socket.join
│   └── test/app.e2e-spec.ts          # supertest/types.js
└── order-console-next/
    ├── .env.example                  # DEMO_PASSWORD 삭제
    ├── Dockerfile                    # deps → build → runtime(standalone)
    ├── Dockerfile.dockerignore       # order-api-nest 등 제외
    ├── next.config.ts                # output: "standalone", outputFileTracingRoot, SKIP_TYPECHECK
    └── app/
        ├── page.tsx                  # /shop으로 보냄
        ├── layout.tsx                # 제목 "주문 콘솔", lang="ko"
        └── nav.tsx                   # "주문 목록" 링크 삭제
```

지운 파일: `order-console-next/app/orders/`, `order-console-next/lib/api.ts`, `order-console-next/public/*.svg`, `order-api-nest/README.md`, `order-console-next/README.md`, `order-api-nest/scratch-client.mjs`.

## 실행

### 전체를 컨테이너로

Docker만 있으면 됩니다. 결제·GitHub 로그인을 쓰지 않으면 `.env`는 비워 둡니다.

```sh
cp .env.example .env
docker compose --profile app up -d --build
docker compose --profile app run --rm migrate npx prisma db seed # 표를 비우고 시드 데이터를 다시 넣음
```

| 대상 | 주소 |
|---|---|
| 웹 | http://localhost:3000 (시드 사용자 `kim` / `1234`) |
| API | http://localhost:4000 |
| 저장소 콘솔 | http://localhost:9001 |
| Jaeger | http://localhost:16686 |

모니터링까지 띄우려면 프로필을 더합니다.

```sh
docker compose --profile app --profile monitoring up -d
```

| 대상 | 주소 |
|---|---|
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3001/d/order-api |

로컬이 아닌 주소로 띄울 때는 `.env`에 `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `PUBLIC_STORAGE_URL`, `JWT_SECRET`을 더하고 `--build`로 다시 빌드합니다. 비워 두면 `http://localhost:3000`·`4000`·`9000`과 `JWT_SECRET=change-me`를 씁니다.

### 개발 모드

인프라만 컨테이너로 띄우고 API와 웹은 PC에서 띄웁니다(Node.js와 루트 `npm ci` 필요). 포트가 겹치므로 `app` 프로필은 내려 둡니다. PC에서 띄우면 루트 `.env`가 아니라 API는 `order-api-nest/.env`를, 웹은 `order-console-next/.env.local`을 읽습니다.

```sh
npm ci
cp order-console-next/.env.example order-console-next/.env.local
docker compose up -d
npm exec -w order-api-nest -- prisma generate
npm exec -w order-api-nest -- prisma migrate deploy
npm exec -w order-api-nest -- prisma db seed
npm run dev:api # :4000
npm run dev:web # :3000 (다른 터미널)
```

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다(db 볼륨을 지우면 다시).

```sh
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
```

```sh
npm run lint       # oxlint(API) + eslint(웹)
npm run typecheck  # API tsc, 웹 next typegen + tsc
npm run test:api   # API 단위 + e2e(테스트 DB)
npm run test:web   # 웹 Playwright e2e
npm run test:rules # promtool 경보 규칙 테스트(Docker)
```

`test:web`은 API가 `4000`에 떠 있어야 하고, `3000`에 이미 떠 있는 웹이 있으면 그것을 대상으로 합니다(`reuseExistingServer: true`). 없으면 `order-console-next`에서 운영 빌드를 띄웁니다.

실제 Stripe 결제 e2e는 `.env`에 Stripe 테스트 키를 넣고 웹훅을 넘겨 받는 동안만 돕니다. `STRIPE_WEBHOOK_SECRET`은 같은 키로 `stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret`이 보여 주는 값이어야 합니다(`STRIPE_SECRET_KEY`는 셸에 따로 내보냄).

```sh
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:4000/payments/webhook
cd order-console-next
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
```

## 정리

```sh
docker compose --profile app --profile monitoring down    # 컨테이너만 내림
docker compose --profile app --profile monitoring down -v # DB·저장소 볼륨까지 삭제(테스트 DB 포함)
```
