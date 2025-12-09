# 14: Stripe 결제와 웹훅

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Stripe%20%7C%20PostgreSQL%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [13-authjs](https://github.com/seungwoo7050/node-order/tree/13-authjs) 브랜치의 `order-api-nest`, `order-console-next`

지금까지 결제 버튼은 재고를 줄이고 주문을 바로 결제 완료로 저장했지만 실제로 돈이 오가지는 않았습니다. 

이 단계에서는 결제를 Stripe Checkout(테스트 모드)에 맡깁니다. 결제 버튼은 재고를 예약하고 주문을 결제 대기로 만들 뿐이고, 서명을 검증한 Stripe 웹훅이 와야 주문이 결제 완료가 됩니다.

## 지원 범위

- `13-authjs`까지의 기능 전부

  - JWT 로그인과 refresh 회전, GitHub 로그인(Auth.js), outbox와 BullMQ 메일, socket.io 알림

  - presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC(`/trpc`), 서비스 워커 오프라인 화면

- 결제 시작 `POST /orders/checkout`

  - 재고를 예약하고 주문을 결제 대기(`paid: false`)로 만든 뒤, Stripe Checkout 세션을 만들어 결제 화면 주소(`checkoutUrl`)를 돌려줌

  - `Idempotency-Key`는 그대로이고, 이 키로 Stripe 쪽 멱등성 키도 만들어 같은 결제 시도가 세션을 두 번 만들지 않음

  - 세션 생성이 실패하면 주문을 취소하고 재고를 되돌리고 멱등성 키를 지워, 다시 눌러 처음부터 시도할 수 있음

- 웹훅 `POST /payments/webhook`

  - 받은 바이트 그대로(`rawBody`) Stripe 서명을 검증하고, 틀리면 400

  - `checkout.session.completed`(`payment_status: paid`)면 결제 완료로 바꾸고 outbox에 `order.paid`를 남김

  - `checkout.session.expired`면 결제되지 않은 주문을 취소(`canceled_at`)하고 재고를 되돌림

  - 같은 이벤트가 두 번(동시에) 와도 한 번만 처리. 이벤트 id를 `stripe_events`에 같은 트랜잭션으로 기록하고 조건부 UPDATE를 씀

  - 우리가 만들지 않은 세션의 이벤트는 무시(200)

- 프론트

  - 결제 버튼이 Stripe 결제 화면으로 이동

  - 내 주문 목록과 상세에 결제 대기·결제 완료·취소됨 표시

  - 결제 화면에서 돌아온 상세(`?checkout=success`)는 웹훅이 반영될 때까지 1초마다 다시 조회

- 그 밖의 변경

  - `orders`에 `stripe_session_id`(unique), `canceled_at` 칸과 `stripe_events` 표 추가(마이그레이션 `0016_stripe_checkout`)

  - compose의 `api` 컨테이너에 `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 전달

## 구성

```text
.
├── package.json                          # npm 워크스페이스 루트
├── order-api-nest/                       # NestJS API
│   ├── src/
│   │   ├── payments/
│   │   │   ├── stripe.gateway.ts         # Stripe 호출(결제 세션 생성, 웹훅 서명 검증)
│   │   │   ├── payments.controller.ts    # POST /payments/webhook
│   │   │   ├── payments.service.ts       # 웹훅 처리(결제 완료, 만료 취소, 중복 무시)
│   │   │   └── cancel-unpaid-order.ts    # 결제 대기 주문 취소와 재고 복구
│   │   ├── orders/orders.service.ts      # checkout: 주문 접수 → Stripe 세션 생성
│   │   └── main.ts                       # rawBody: true
│   ├── prisma/                           # schema.prisma, migrations/0016_stripe_checkout
│   ├── test/
│   │   ├── fake-stripe.ts                # Stripe를 부르지 않는 가짜 게이트웨이
│   │   └── payments.e2e-spec.ts          # 서명한 가짜 웹훅으로 결제 흐름 확인
│   ├── docker-compose.yml
│   └── .env.example
├── order-console-next/                   # Next.js(App Router) 주문 콘솔
│   ├── app/
│   │   ├── shop/page.tsx                 # 결제 버튼 → Stripe 결제 화면으로 이동
│   │   └── me/orders/                    # 주문 상태(order-status.tsx), 상세의 돌아온 뒤 다시 조회
│   └── e2e/
│       ├── shop.spec.ts                  # Stripe 결제 화면으로 이동까지 확인
│       └── stripe-payment.spec.ts        # 실제 테스트 카드 결제(STRIPE_E2E=1일 때만)
└── README.md
```

## 실행

의존성은 루트에서 한 번 설치합니다.

```sh
npm ci
```

백엔드를 `4000`에 띄웁니다. 처음이면 마이그레이션과 시드까지 합니다. PostgreSQL은 `5433`, Redis는 `6380`, 저장소는 `9000`/`9001`을 씁니다.

```sh
cd order-api-nest
cp .env.example .env
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

결제에는 Stripe 테스트 모드(샌드박스)의 Secret key와 Stripe CLI가 필요합니다. 값을 얻는 방법은 [guide](guide/README.md)의 "1. 준비"를 따릅니다.

비밀 값은 커밋되지 않는 `.env.local`에 둡니다. 이미 있는 환경 변수는 `.env.local`이 덮어쓰지 않으므로, 백엔드 `.env`에 복사된 `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 줄은 지웁니다.

- 백엔드 `order-api-nest/.env.local`: `STRIPE_SECRET_KEY`(`sk_test_...`), `STRIPE_WEBHOOK_SECRET`(`whsec_...`)

- GitHub 로그인 값은 `13-authjs`와 같습니다

웹훅을 로컬까지 받도록 다른 터미널에서 Stripe CLI를 띄웁니다. 비밀 키를 복사한 샌드박스로 `stripe login`이 되어 있어야 합니다. 처음에 보여 주는 `whsec_...`가 `STRIPE_WEBHOOK_SECRET`입니다.

```sh
stripe listen --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
```

다른 터미널에서 프론트를 운영 빌드로 띄웁니다(`3000`).

```sh
cd order-console-next
cp .env.example .env.local
npm run build
npm run start
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim`, `lee`, `park`, `choi` / `1234`이고, Stripe 결제 화면에서는 테스트 카드 `4242 4242 4242 4242`(만료일은 미래 아무 날, CVC 아무 세 자리)를 씁니다.

`STRIPE_SECRET_KEY`가 없으면 결제(`POST /orders/checkout`)만 실패하고, 조회·로그인 등 나머지 기능은 그대로 동작합니다. `stripe listen`을 띄우지 않으면 결제는 되지만 주문이 결제 대기에 머뭅니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

백엔드 테스트는 가짜 Stripe 게이트웨이와 SDK로 서명한 가짜 웹훅을 쓰므로 비밀 값 없이 돕니다.

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

백엔드 e2e는 결제 대기와 재고 예약, 서명이 틀리면 400인지, 같은 이벤트가 순서대로든 동시에든 한 번만 처리되는지, 만료되면 취소되고 재고가 돌아오는지, 우리가 만들지 않은 세션의 이벤트를 무시하는지 확인합니다.

프론트 e2e는 백엔드가 `4000`에 떠 있어야 합니다. Playwright가 운영 빌드를 직접 띄우므로 개발 서버는 꺼 둡니다(이미 `3000`에 떠 있으면 그것을 씁니다).

결제 버튼을 누르면 백엔드가 실제 Stripe에 세션을 만들므로, 백엔드에 `STRIPE_SECRET_KEY`가 채워져 있어야 합니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

프론트 e2e는 브라우저가 Stripe 결제 화면으로 가는 것까지만 보고(이동한 페이지는 가짜 응답으로 막음), 재고가 예약되고 내 주문에 결제 대기로 보이는지 확인합니다.

실제 테스트 카드 결제는 `STRIPE_E2E=1`일 때만 돕니다. `stripe listen`을 켠 상태여야 웹훅이 와서 주문이 결제 완료로 바뀝니다.

```sh
cd order-console-next
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
```

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
