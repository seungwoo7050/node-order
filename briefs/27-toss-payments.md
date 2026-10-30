```
상태: 확정(오케스트레이터)
브랜치: 27-toss-payments (앞 브랜치: 26-search)
문제: 결제는 Stripe 하나에 묶여 있다(`StripeGateway`, `orders.stripe_session_id`, Stripe 웹훅). 국내 개인 판매자는 Stripe에 가맹할 수 없어서 이 상점으로 실제 판매를 할 수 없다. 결제 뒤 돈을 돌려줄 방법(취소·부분 환불)도 없어서, 다음 단계의 반품이 환불을 부를 곳이 없다.
결정:
  - `PaymentGateway` 인터페이스(`id`, `isConfigured`, `startCheckout`, `confirm`, `fetchPayment`, `refund`)를 두고 Stripe와 토스페이먼츠를 구현한다. 같은 계약 테스트를 두 구현에 대해 시뮬레이터로 돌린다 / 대안: 포트원 같은 통합 결제. 판매자가 포트원과 PG에 이중으로 계약해야 하고, 추상화 경계를 직접 설계하는 학습이 사라진다 / 바꿀 신호: PG가 셋을 넘거나 간편결제마다 따로 붙여야 하면 통합 결제로 바꾼다
  - 결제는 `payments` 테이블(주문, provider, provider 결제 키, 금액, 상태 ready·paid·partial_refunded·refunded·canceled, 승인 시각)로, 환불은 `refunds` 테이블(결제, 금액, 사유, 멱등 키 unique, provider 환불 키, 상태 requested·succeeded·failed)로 옮긴다. 기존 `orders.paid`와 `stripe_session_id`는 이번에 지우지 않는다(expand). 새 마이그레이션이 기존 주문을 payments로 백필하고, 앱은 payments를 쓰면서 `orders.paid`도 같이 맞춘다 / 대안: orders 칸을 늘린다. 부분 환불이 여러 번이면 칸으로 담을 수 없다 / 바꿀 신호: 다음 릴리스가 안정되면 contract 마이그레이션으로 옛 칸을 지운다(24의 expand-contract 순서)
  - 토스 결제 흐름: 콘솔이 토스 결제 위젯 SDK를 띄움 → 성공 리다이렉트(`paymentKey`, `orderId`, `amount`)를 받은 콘솔 페이지가 API `POST /payments/toss/confirm` 호출 → API가 금액을 DB의 주문 금액과 비교(다르면 400을 내고 PG를 부르지 않음) → 토스 승인 API를 멱등 키와 함께 부름 → 한 트랜잭션에서 paid로 바꾸고 outbox `order.paid` 기록(Stripe와 같은 경로). 토스 주문번호는 주문 id에서 만든 provider 주문번호로 한다(6~64자 규칙) / 대안: 리다이렉트만 믿고 paid로 바꾼다. 금액 위조와 승인 누락을 막지 못한다
  - 웹훅은 본문을 믿지 않는다. 토스 결제 상태 웹훅은 서명이 없으므로 받으면 `fetchPayment`로 PG에 다시 조회해 그 결과를 반영한다(웹훅 재조회). 같은 결제의 승인 요청과 웹훅이 동시에 와도 상태 전이는 조건부 update(`WHERE status = 'ready'`)로 한 번만 일어난다. Stripe는 기존 서명 검증을 유지한다 / 대안: IP 허용 목록. 운영 중 바뀌고 로컬에서 검증할 수 없다
  - 환불: 관리자 API `POST /admin/orders/:id/refunds {amount, reason}`와 `Idempotency-Key` 헤더. 결제 행을 `FOR UPDATE`로 잠그고 누적 환불액이 결제액을 넘는지 확인한 뒤 refunds에 requested로 커밋한다 → PG 환불 호출(같은 멱등 키를 PG에도 넘김) → succeeded·failed로 갱신한다. PG 호출이 시간 초과로 끝나면 requested로 남긴다. `npm run payments:resolve-refunds`가 오래된 requested를 PG 재조회로 확정한다(29의 대사 배치가 이것을 정기 작업으로 만든다) / 대안: PG 호출을 DB 트랜잭션 안에서 한다. 외부 호출 동안 잠금을 쥐고, 롤백해도 돈은 이미 나갔다
  - 이번 단계의 환불은 돈만 다룬다. 주문 취소 상태, 재고 복구, 반품과의 연결은 28-fulfillment의 상태 기계가 이 API를 불러서 한다 / 대안: 여기서 재고까지 복구. 28의 상태 기계와 중복되고 한 번만 일어남을 두 곳에서 지켜야 한다
  - 기능 목록: `GET /features`가 켜진 결제 수단(`payments: ["toss", "stripe"]` 중 키가 있는 것)을 돌려주고, 콘솔 결제 화면은 그것만 보인다. 둘 다 없으면 결제 버튼을 끄고 이유를 글로 보인다. 키는 환경변수(`TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`)에만 둔다(설정 DB와 비밀값 분리는 29)
  - 테스트 대역: 25의 Stripe 시뮬레이터처럼 토스 시뮬레이터(confirm, 결제 조회, cancel, 웹훅 보내기)를 두고, 실패 주입(시간 초과, 이미 처리된 결제, 금액 불일치)을 할 수 있게 한다. 웹 e2e는 키가 없으면 시뮬레이터 경로로 토스 결제를 끝까지 돈다. 위젯 SDK 스크립트는 e2e에서 시뮬레이터가 주는 가짜 SDK로 바꾼다
  - CSP: 토스 SDK와 결제창 도메인을 콘솔 CSP의 script-src·frame-src·connect-src에 필요한 만큼만 더한다(08의 CSP 테스트가 같이 통과해야 한다)
  - 토스 문서에 공개된 문서용 테스트 키가 확인되면 `.env.example`에 주석과 함께 둔다. 확인되지 않으면 비워 두고 blocked에 적는다. 키 모양 값은 공개 경계 검사에 걸리지 않는지 확인한다
완료 기준:
  1. 계약 테스트: 시작 → 승인(paid) → 조회 → 부분 환불 두 번 → 남은 금액보다 큰 환불 거부(409)가 Stripe·토스 두 구현에 대해 시뮬레이터로 통과한다
  2. 금액 위조: 주문 10,000원에 `amount=1000`으로 승인을 요청하면 400이고, 주문은 미결제로 남으며 시뮬레이터에 승인 호출이 가지 않는다
  3. 중복 승인: 같은 승인 요청 두 번, 승인과 웹훅 동시 도착에서 paid 전이와 `order.paid` outbox 행이 각각 한 번이다
  4. 웹훅 재조회: 본문은 DONE인데 PG 조회 결과가 다르면 PG 조회 결과를 따른다. 웹훅 응답은 본문 내용과 관계없이 200이다
  5. 부분 환불: 10,000원 결제에 3,000원 두 번이면 partial_refunded이고 남은 금액은 4,000원이다. 5,000원 요청은 409다. 같은 멱등 키로 다시 보내면 환불 행은 하나이고 PG 호출도 한 번이다
  6. 환불 시간 초과: PG가 시간 초과면 환불 행이 requested로 남고 다시 요청해도 이중 환불이 되지 않는다. `payments:resolve-refunds`가 PG 재조회로 succeeded를 확정한다
  7. 기능 목록: 토스 키만 있으면 토스만, Stripe 키만 있으면 Stripe만, 둘 다 없으면 꺼진 버튼과 이유가 보인다(웹 e2e). 웹 e2e로 토스 결제가 시뮬레이터 경로로 끝까지(주문 → 결제 → 결제 완료 표시) 간다
  8. 기존 Stripe e2e가 그대로 통과한다. 백필 마이그레이션 뒤 기존 결제 완료 주문마다 paid인 payments 행이 하나씩 있다
  9. `npm run verify` 통과. 테스트 수가 26 끝보다 늘고 줄지 않는다
범위 밖: 가상계좌·정기결제·간편결제 단독 연동, 정산, 정기 대사 배치(29), 반품·재고 복구(28), 옛 칸 삭제(contract), 결제 수단별 수수료
외부 의존: 토스 문서용 공개 테스트 키(선택. 실제 위젯 확인에만 씀. 없으면 blocked)
```
