```
상태: 확정(사람)
브랜치: 33-member-guest (앞 브랜치: 32-production-prep @ a64d564)
문제: 일반 손님이 스스로 가입할 경로(/signup)가 없고(POST /users는 관리자 전용), DB의 User 모델에 연락처와 기본 배송지가 없어 로그인한 회원도 브라우저 localStorage에만 기대며 다른 기기나 재로그인 때 배송지를 불러오지 못한다. 우편번호와 주소도 검색 없이 빈 텍스트 칸에 직접 치는 형태다. 비회원은 POST /orders/checkout이 JWT를 요구해 주문조차 할 수 없고(401), 관리자 화면에도 회원 주문과 비회원 주문을 가르는 표시가 없다. 여기에 31에서 찾은 결함 두 건(토큰 갱신 예외 시 배송지 checking 잠김, Sentry 주소 마스킹 누락)과 반품 배송비 스냅샷 누락이 남아 있다.
결정:
  - 회원가입은 최소 입력(아이디, 비밀번호, 이름, 연락처)으로 받고 가입 즉시 접근 토큰과 refresh 쿠키를 발급한다 / 대안: 가입 때 배송지까지 필수로 받기. 가입 이탈이 늘고 첫 주문 때 받아도 충분하다 / 바꿀 신호: 가입 직후 배송지 미입력으로 고객 문의가 생길 때
  - 회원의 기본 배송지는 users 테이블 컬럼(recipient_name, recipient_phone, postal_code, address1, address2, delivery_memo)으로 둔다. 기본 배송지가 비어 있는 회원이 첫 주문을 하면 그 배송지를 기본 배송지로 자동 저장하고, 이미 있는 회원은 장바구니에서 요약 카드로 불러오며 "배송지 변경"을 누를 때만 입력 폼을 연다 / 대안: 별도 shipping_addresses 1:N 주소록 테이블. 1인 상점 초기에는 기본 배송지 하나와 주문별 배송지 사본으로 충분하다 / 바꿀 신호: 한 손님이 여러 배송지를 번갈아 쓰는 비중이 커질 때
  - 주소 입력은 도로명·우편번호 검색 모달(카카오 Daum 우편번호 위젯 + 키 없이도 동작하는 내장 한국 도로명 주소 사전 및 행안부 JUSO_API_KEY 선택 연동)로만 우편번호와 기본주소를 채우게 하고(readOnly), 상세주소만 손으로 치게 한다 / 대안: 수기 입력 유지. 오타와 없는 우편번호로 오배송이 난다 / 바꿀 신호: 해외 배송 주소를 받아야 할 때
  - 비회원 주문(POST /orders/guest-checkout)은 주문마다 격리된 비회원 소유자 행(users.id = "guest-<uuid>", is_guest = true)과 주문(orders.is_guest = true, guest_password_hash)을 함께 만들고, 그 소유자 sub를 담은 단기 JWT(guestAccessToken)를 돌려준다 / 대안: orders.user_id를 nullable로 바꾸고 RLS 정책을 고치기. 13~32에서 쌓은 모든 RLS 정책(orders, payments, returns 등)과 IdempotencyKey 복합키(userId_key), 토스 결제 확인 가드를 다 뜯어고쳐야 하고 비회원 주문끼리 섞일 위험이 생긴다 / 바꿀 신호: 비회원 행이 수백만 건 쌓여 정리 배치가 따로 필요해질 때
  - 비회원 주문 조회(/guest/orders)는 주문번호 + 비회원 주문 비밀번호(scrypt 검증)로 확인해 단기 토큰과 주문 상세를 돌려주고, 같은 토큰으로 결제·취소·구매확정·반품 신청을 처리한다. 관리자 주문 목록(/admin/orders)과 상세(/admin/orders/[id])에는 [비회원] 배지(data-testid="guest-badge")와 회원·비회원 필터(?guest=true|false)를 둔다
  - 주문 생성 시점의 반품 왕복 배송비를 orders.return_shipping_fee에 스냅샷으로 저장하고, 같은 주문에서 단순변심 반품 배송비는 한 번만 차감한다. 손님 반품 화면의 하드코딩 "6,000원"도 주문 스냅샷 값으로 바꾼다
  - 31에서 기록한 두 결함(doRefresh 네트워크 예외 시 checking 영구 잠김, scrub.ts의 시·구 없는 도로명 주소 및 객체·배열 주소값 마스킹)을 고치고 단위 테스트를 더한다. 메일은 SMTP_HOST가 있으면 실제 SMTP로 보내고 없으면 FakeMailer로 폴백한다
완료 기준:
  1. 회원가입(POST /auth/signup, /signup 화면)으로 가입하면 곧바로 로그인되고, 중복 아이디나 예약 접두사(guest-, demo-, github-, admin)는 400/409로 거부된다
  2. 기본 배송지가 없는 회원이 주문하면 입력한 배송지가 회원 기본 배송지로 자동 저장되고, 다음 장바구니 진입 시 요약 카드(data-testid="member-shipping-summary")로 불러와진다. 내 정보(/me/profile)에서 이름·연락처·기본 배송지·비밀번호를 고칠 수 있다
  3. 도로명 주소 검색 API(GET /addresses/search?q=...)와 우편번호 찾기 모달(data-testid="open-address-search")로 주소를 고르면 우편번호와 기본주소가 채워진다
  4. 로그인하지 않은 비회원이 장바구니에서 배송지와 비회원 주문 비밀번호를 넣어 주문·토스 결제를 끝낼 수 있고, /guest/orders에서 주문번호와 비밀번호로 조회·구매확정·반품 신청을 할 수 있다(틀린 비밀번호는 401)
  5. 관리자 주문 목록(/admin/orders)과 상세(/admin/orders/[id])에 비회원 주문은 [비회원] 배지(data-testid="guest-badge")가 표시되고, ?guest=true|false로 걸러 볼 수 있다
  6. 상점 설정의 반품 배송비를 바꿔도 이미 만든 주문의 반품 환불 차감액과 손님 안내 문구는 주문 시점의 return_shipping_fee를 따르고, 한 주문에서 단순변심 반품을 두 번 나눠 신청해도 왕복 배송비는 한 번만 빠진다
  7. refreshAccessToken이 fetch 예외로 실패해도 authStore.status가 anonymous로 바뀌어 배송지 칸이 잠기지 않고, scrubEvent가 객체형 주소와 도로명 주소를 [Filtered]/[주소]로 가린다
  8. npm run verify 통과. 테스트 수가 32 끝보다 늘고 줄지 않는다
범위 밖: 소셜 로그인 추가(카카오·네이버), 휴대폰 SMS 본인인증, 다중 배송지 주소록(1:N)
외부 의존: JUSO_API_KEY, SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (모두 선택, 없으면 내장 도로명 사전과 FakeMailer로 동작)
```

## 구현 세부 명세 (Flash Worker 지침)

1. **마이그레이션**: `order-api-nest/prisma/migrations/0037_member_and_guest_checkout/migration.sql` 생성 (기존 `0001`~`0036` 수정 절대 금지).
   - `users`: `is_guest BOOLEAN NOT NULL DEFAULT false`, `phone TEXT`, `recipient_name TEXT`, `recipient_phone TEXT`, `postal_code TEXT`, `address1 TEXT`, `address2 TEXT`, `delivery_memo TEXT`
   - `orders`: `is_guest BOOLEAN NOT NULL DEFAULT false`, `guest_password_hash TEXT`, `return_shipping_fee INTEGER NOT NULL DEFAULT 6000` + 인덱스 `orders_is_guest_created_at_id_idx`
2. **ESM import 규칙**: `order-api-nest/src` 내 모든 상대 경로 import는 `.js` 확장자를 붙인다. Prisma는 `../generated/prisma/client.js`에서 가져온다.
3. **기존 E2E 호환성 필수 보존**:
   - `order-console-next/e2e/shipping.ts`의 `fillShipping(page)`는 `page.getByTestId("shipping-form")` 안의 `getByLabel("받는 분")`, `getByLabel("연락처")`, `getByLabel("우편번호")`, `getByLabel("주소", { exact: true })`, `getByLabel("상세주소")`에 값을 채운다.
   - 따라서:
     - 기본 배송지가 아직 없는 계정(시드 계정 `kim` 등)이나 비회원, 또는 `[배송지 변경]`을 누른 상태에서는 `data-testid="shipping-form"` 안의 위 input들이 그대로 열려 있고 편집 가능해야 기존 E2E가 단 하나도 깨지지 않는다!
     - 우편번호 찾기 모달 버튼(`data-testid="open-address-search"`)으로 선택해도 채워지고, E2E나 키보드로 직접 input에 값을 넣는 것도 막지 않도록(또는 모달 선택 시 자동 입력 + 직접 입력 허용) 구성해 기존 `fillShipping` 헬퍼와 100% 호환되게 한다.
     - 기본 배송지가 이미 저장된 회원이 장바구니를 열었을 때는 요약 카드(`data-testid="member-shipping-summary"`)와 `[배송지 변경]` 버튼(`data-testid="edit-shipping-button"`)을 보여 주되, 배송지 값은 이미 `cartStore.shipping`에 채워져 있어 바로 결제할 수 있게 한다.
