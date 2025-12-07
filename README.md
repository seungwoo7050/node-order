# 14: Stripe 결제와 웹훅

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Stripe%20%7C%20PostgreSQL%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [13-authjs](https://github.com/seungwoo7050/node-order/tree/13-authjs) 브랜치

결제를 Stripe Checkout(테스트 모드)으로 옮깁니다. `13`까지는 결제 버튼이 재고를 줄이고 주문을 바로 결제 완료로 저장했지만, 이제는 재고를 예약하고 주문을 결제 대기로 만든 뒤 Stripe 결제 화면으로 보냅니다. 주문은 서명을 검증한 Stripe 웹훅이 와야 결제 완료가 됩니다.

## 지원 범위

- `13-authjs`까지의 기능: JWT 로그인과 refresh 회전, GitHub 로그인(Auth.js), outbox와 BullMQ 메일, socket.io 알림, presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC(`/trpc`), 서비스 워커 오프라인 화면
- `POST /orders/checkout`
  - 재고를 예약하고 주문을 결제 대기(`paid: false`)로 만든 뒤 Stripe Checkout 세션을 만들어 `checkoutUrl`을 돌려준다
  - `Idempotency-Key`가 있으면 사용자·키·주문 id로 Stripe 멱등성 키를 만들어 같은 시도가 세션을 두 번 만들지 않게 한다
  - 세션 생성이 실패하면 주문을 취소하고 재고를 되돌리고 멱등성 키를 지운다
- `POST /payments/webhook`
  - 받은 바이트 그대로(`rawBody`) Stripe 서명을 검증하고, 틀리면 400
  - `checkout.session.completed`이고 `payment_status`가 `paid`면 주문을 결제 완료로 바꾸고 outbox에 `order.paid`를 남긴다
  - `checkout.session.expired`면 결제되지 않은 주문을 취소(`canceled_at`)하고 재고를 되돌린다
  - 이벤트 id를 같은 트랜잭션에서 `stripe_events`에 기록하므로, 같은 이벤트가 다시 오거나 동시에 와도 한 번만 처리한다
  - 우리가 만든 세션이 아니거나 다른 종류의 이벤트는 처리하지 않고 200을 돌려준다
- 프론트
  - 결제 버튼이 `checkoutUrl`로 이동한다
  - 내 주문 목록과 상세에 결제 대기·결제 완료·취소됨을 표시한다
  - 결제 화면에서 돌아온 상세(`?checkout=success`)는 결제 완료나 취소가 될 때까지 1초마다 다시 조회한다
- `orders`에 `stripe_session_id`(unique), `canceled_at` 칸, `stripe_events` 표 추가(마이그레이션 `0016_stripe_checkout`)
- compose의 `api` 서비스에 `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 전달

## 구성

`13`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── .env.example                      # STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
│   ├── docker-compose.yml                # api 서비스에 Stripe 값 전달
│   ├── package.json                      # stripe
│   ├── prisma/
│   │   ├── schema.prisma                 # Order.stripeSessionId·canceledAt, StripeEvent
│   │   └── migrations/0016_stripe_checkout/
│   ├── src/
│   │   ├── main.ts                       # rawBody: true
│   │   ├── app.module.ts                 # PaymentsModule
│   │   ├── me/order-select.ts            # canceledAt 포함
│   │   ├── orders/
│   │   │   ├── orders.module.ts          # PaymentsModule 가져옴
│   │   │   └── orders.service.ts         # 주문 접수 → Stripe 세션 생성, 실패 시 되돌림
│   │   └── payments/
│   │       ├── payments.module.ts
│   │       ├── stripe.gateway.ts         # 결제 세션 생성, 웹훅 서명 검증
│   │       ├── payments.controller.ts    # POST /payments/webhook
│   │       ├── payments.service.ts       # 결제 완료, 만료 취소, 중복 무시
│   │       └── cancel-unpaid-order.ts    # 결제 대기 주문 취소와 재고 복구
│   └── test/
│       ├── fake-stripe.ts                # Stripe를 부르지 않는 가짜 게이트웨이
│       ├── payments.e2e-spec.ts          # 서명한 가짜 웹훅으로 결제 흐름 확인
│       └── checkout.e2e-spec.ts          # 가짜 게이트웨이로 교체
├── order-console-next/
│   ├── app/
│   │   ├── shop/page.tsx                 # 결제 성공 시 Stripe 결제 화면으로 이동
│   │   └── me/orders/
│   │       ├── order-status.tsx          # 결제 대기·결제 완료·취소됨
│   │       ├── my-order-list.tsx         # 목록에 상태 표시
│   │       └── [id]/page.tsx             # 상태 표시, 돌아온 뒤 1초마다 다시 조회
│   └── e2e/
│       ├── shop.spec.ts                  # Stripe 결제 화면 이동과 결제 대기 확인
│       └── stripe-payment.spec.ts        # 실제 테스트 카드 결제(STRIPE_E2E=1일 때만)
└── package-lock.json
```

## 실행

필요한 도구, 포트, 백엔드·프론트를 띄우는 순서는 `13`과 같습니다. 새로 Stripe 테스트 모드(샌드박스)의 Secret key와 Stripe CLI가 필요합니다.

```sh
npm ci

cd order-api-nest
cp .env.example .env
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

Stripe 값은 커밋하지 않는 `order-api-nest/.env.local`에 둡니다. 백엔드는 `--env-file .env`로 먼저 읽은 값을 `.env.local`이 덮어쓰지 않으므로, `.env`에 복사된 `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 줄은 지웁니다. GitHub 로그인 값은 `13`과 같습니다.

- `STRIPE_SECRET_KEY`: `sk_test_...`
- `STRIPE_WEBHOOK_SECRET`: 아래 `stripe listen`이 처음에 보여 주는 `whsec_...`

웹훅을 로컬로 받도록 다른 터미널에서 Stripe CLI를 띄웁니다. Secret key를 받은 샌드박스로 `stripe login`이 되어 있어야 합니다.

```sh
stripe listen --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
```

프론트는 `13`과 같이 띄웁니다.

```sh
cd order-console-next
cp .env.example .env.local
npm run build
npm run start # :3000
```

http://localhost:3000/shop 에서 확인합니다. 시드 계정은 `kim`, `lee`, `park`, `choi`(비밀번호 `1234`)이고, Stripe 결제 화면에서는 테스트 카드 `4242 4242 4242 4242`(만료일은 미래 날짜, CVC는 세 자리 아무 숫자)를 씁니다.

`STRIPE_SECRET_KEY`가 없으면 `POST /orders/checkout`만 실패하고 나머지 기능은 그대로 동작합니다. `stripe listen`이 꺼져 있으면 웹훅이 오지 않아 주문이 결제 대기에 머뭅니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

백엔드 e2e는 `FakeStripeGateway`와 Stripe SDK로 서명한 가짜 웹훅을 쓰므로 Stripe 값 없이 돕니다. `payments.e2e-spec.ts`는 결제 대기와 재고 예약, 서명이 틀리면 400, 같은 이벤트를 순서대로·동시에 보내도 한 번만 처리, 만료 시 취소와 재고 복구, 우리가 만들지 않은 세션의 이벤트 무시를 확인합니다.

프론트 e2e는 백엔드가 `4000`에 떠 있어야 하고, 결제 버튼이 실제 Stripe에 세션을 만들므로 백엔드에 `STRIPE_SECRET_KEY`가 있어야 합니다. Playwright가 운영 빌드를 띄우고, `3000`에 이미 떠 있는 서버가 있으면 그것을 씁니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

`shop.spec.ts`는 Stripe 결제 화면 주소로 이동하는 것까지만 보고(그 페이지는 가짜 응답으로 막음), 재고가 예약되고 내 주문에 결제 대기로 보이는지 확인합니다.

실제 테스트 카드 결제는 `STRIPE_E2E=1`일 때만 돕니다. 웹훅이 와야 결제 완료로 바뀌므로 `stripe listen`을 켜 둡니다.

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
