# 19: 화면 다듬기

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20Tailwind%20CSS%20%7C%20NestJS%20%7C%20Prisma%20%7C%20Playwright%20%7C%20Vitest-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [18-deploy](https://github.com/seungwoo7050/node-order/tree/18-deploy) 브랜치

주문 콘솔의 색·글자·간격을 토큰으로 정하고 상품·장바구니·내 주문·로그인 화면을 다시 그립니다. 사용자 역할(`user`·`admin`)과 관리자 전용 이미지 업로드, 주문 상세의 품목, 데모 로그인 API를 더하고, 장바구니 페이지와 관리자 페이지를 새로 만듭니다.

## 지원 범위

- 화면(`order-console-next`)
  - 색·글자·간격 토큰(`app/globals.css`의 `@theme inline`), 라이트·다크(`prefers-color-scheme`)
  - 상품 `/shop`: 담은 상품은 그 자리에서 수량 조절기로 바뀜, 재고 상한, 품절, 불러오는 중 표시, 결제 취소 뒤 남은 주문 안내. 휴대폰 폭에서는 화면 아래에 합계 줄
  - 장바구니 `/cart`: 수량 조절, 빼기, 합계, 결제
  - 내 주문 `/me/orders`: 최신순, 상태 표시. 주문 상세에 산 상품과 주문 때의 단가
  - 관리자 `/admin/products`: 상품 표와 이미지 올리기. 머리글의 "관리" 링크는 관리자에게만 보이고, 관리자가 아니면 "관리자만 볼 수 있는 화면입니다"를 보여 줌
  - 로그인 `/login`: label이 붙은 입력 칸, 401과 그 밖의 실패를 나눈 문구, 데모 로그인 버튼("일반 사용자로", "관리자로")
  - 로그아웃하면 React Query 캐시를 비움
- API(`order-api-nest`)
  - 사용자 역할: 마이그레이션 `0017_user_role`(enum `Role`, 기본값 `user`). 시드의 `kim`이 관리자
  - 액세스 토큰에 `role`을 담고, 상품 이미지 업로드(`/products/:id/image`)는 `AdminGuard`로 관리자만(그 밖은 403)
  - tRPC `me.profile`(id·이름·역할). `me.orders`와 `GET /me/orders`는 최신순, `me.order`와 `GET /me/orders/:id`는 품목(상품 id·이름, 수량, 단가)을 함께 돌려줌
  - Stripe 결제 취소 주소에 주문 번호: `/shop?checkout=canceled&order=<id>`
  - 데모 로그인: `GET /auth/demo`는 `{ "enabled": true|false }`, `POST /auth/demo`(`{ "as": "user" | "admin" }`)는 `lee`·`kim`으로 토큰과 refresh 쿠키를 줌. `DEMO_LOGIN=1`이 아니면 404
- 설정
  - `DEMO_LOGIN`: 개발 `compose.yaml`과 `order-api-nest/.env`는 `1`, 운영 `deploy/compose.yml`은 기본 `0`
- 로그인 화면의 "데모 데이터는 매일 초기화됩니다"를 지키는 예약 작업은 이 브랜치에 없습니다.

## 구성

`18`에서 바뀐 곳만 적습니다.

```text
.
├── compose.yaml                      # api에 DEMO_LOGIN: "1"
├── deploy/
│   ├── compose.yml                   # api에 DEMO_LOGIN: ${DEMO_LOGIN:-0}
│   └── .env.example                  # DEMO_LOGIN=0
├── package.json                      # test:web이 프론트 단위 테스트 뒤 e2e를 돎
├── order-api-nest/
│   ├── .env, .env.example            # DEMO_LOGIN=1
│   ├── prisma/
│   │   ├── schema.prisma             # enum Role, User.role
│   │   ├── migrations/0017_user_role/
│   │   └── seed.ts                   # kim을 관리자로
│   ├── src/auth/                     # admin.guard.ts, demo-login.dto.ts(새 파일), 토큰과 JwtStrategy에 역할
│   ├── src/me/                       # order-select.ts(orderDetailSelect), 최신순
│   ├── src/payments/stripe.gateway.ts  # cancel_url에 주문 번호
│   ├── src/products/product-images.controller.ts  # AdminGuard
│   ├── src/trpc/router.ts            # me.profile, 주문 상세 품목, 최신순
│   └── test/
│       ├── demo-login.e2e-spec.ts    # 새 파일
│       └── product-images.e2e-spec.ts  # 새 파일: 401·403·관리자
├── order-console-next/
│   ├── app/
│   │   ├── globals.css               # 토큰, 본문 기본값, 컴포넌트 클래스
│   │   ├── layout.tsx, nav.tsx       # 머리글: 현재 화면 표시, 관리 메뉴, 장바구니 링크
│   │   ├── shop/                     # page.tsx, stepper.tsx(수량 조절기, 새 파일)
│   │   ├── cart/page.tsx             # 새 파일
│   │   ├── admin/products/           # 새 폴더: page.tsx, product-image-uploader.tsx(옮겨 옴)
│   │   ├── me/orders/                # 목록, 상세, 상태 표시
│   │   └── login/page.tsx            # 오류 문구, 데모 버튼
│   ├── lib/
│   │   ├── api-client.ts             # demoLogin, demoEnabled
│   │   ├── cart-store.ts             # setQuantity
│   │   ├── cart-store.test.ts        # 새 파일(Vitest)
│   │   └── use-profile.ts            # 새 파일: useProfile, useIsAdmin
│   ├── e2e/                          # cart-quantity, demo-login 추가, 나머지는 새 화면에 맞춤
│   ├── vitest.config.ts              # 새 파일: lib/**/*.test.ts만
│   └── package.json                  # "test": "vitest run", vitest 추가
└── README.md
```

## 실행

필요한 도구(Node, Docker)와 운영 서버는 `18`과 같습니다.

### 로컬

```sh
# 저장소 루트에서
docker compose up -d db redis storage
npm ci
cd order-api-nest && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && cd ..
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:3000 (다른 터미널)
```

로그인 화면의 "일반 사용자로"·"관리자로"는 비밀번호 없이 `lee`·`kim`으로 들어갑니다. 비밀번호 로그인은 시드 사용자와 `order-api-nest/.env`의 `DEMO_PASSWORD`(`1234`)입니다.

### 배포

워크플로는 `18`과 같고, 저장소 변수 `DEPLOY_BRANCH`를 `19-design`으로 바꾼 뒤 푸시하면 배포됩니다. Environments의 `production`에 허용 브랜치를 정해 두었다면 그것도 `19-design`으로 바꿉니다. 역할 마이그레이션(`0017`)은 배포 스크립트가 적용합니다.

```sh
gh variable set DEPLOY_BRANCH -R <계정>/<저장소> -b 19-design
```

푸시하기 전에 서버의 값 두 가지를 맞춥니다(`deploy/aws`에서, `.local/`은 `18`의 폴더에서 옮겨 옴).

```sh
# 데모 로그인 켜기: 이 PC의 원본(60-server-env.sh가 올리는 파일)과 서버 .env에 같은 한 줄
grep -q '^DEMO_LOGIN=' .local/server.env || echo 'DEMO_LOGIN=1' >> .local/server.env
ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && (grep -q "^DEMO_LOGIN=" .env || echo "DEMO_LOGIN=1" >> .env)'

# 관리자 지정: 운영 DB에는 시드를 다시 돌리지 않고 SQL로 정함(GitHub 사용자의 id는 github-<GitHub 숫자 id>)
echo "UPDATE users SET role = 'admin' WHERE id IN ('github-<숫자 id>', 'kim');" \
  | ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && docker compose run --rm -T migrate npx prisma db execute --stdin'
```

이미 배포한 뒤에 서버 `.env`를 바꿨다면 `docker compose up -d api`로 api만 다시 만듭니다. 배포 뒤에는 `curl -s https://<API_HOST>/auth/demo`가 `{"enabled":true}`인지 봅니다.

## 테스트

```sh
npm run lint
npm run typecheck
npm run test:api    # 단위 + e2e. 테스트 DB order_api_test에 마이그레이션이 적용되어 있어야 함
npm run test:web    # 프론트 단위(Vitest) 뒤 e2e(Playwright). API를 띄워 둔 채로
```

- 테스트 DB 마이그레이션: `ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy`
- 프론트 단위 테스트는 `lib/cart-store.test.ts`의 4개(장바구니 store), e2e는 18개이고 그중 실제 Stripe 결제 1개는 `STRIPE_E2E=1`일 때만 돎
- 새 e2e: 수량 조절·재고 상한·결제 취소 안내(`cart-quantity.spec.ts`), 데모 로그인(`demo-login.spec.ts`), 관리 메뉴와 관리자 페이지는 관리자에게만(`upload.spec.ts`)
- API e2e: 데모 로그인 켜짐·꺼짐·잘못된 값 400(`demo-login.e2e-spec.ts`), 이미지 업로드 401·403·관리자(`product-images.e2e-spec.ts`)
- CI(`.github/workflows/ci.yml`)는 `18`과 같습니다. 린트·타입 검사, `test:api`, `test:web`, 경보 규칙 테스트를 돌리고, `DEPLOY_BRANCH` 브랜치에서는 이미지를 올려 배포합니다.

## 정리

```sh
docker compose down          # 개발 컨테이너 내리기(-v를 붙이면 DB·저장소 볼륨도 지움)
```

AWS 리소스 정리는 `18`과 같습니다(`deploy/aws/90-destroy.sh`, `99-leftovers.sh`).
