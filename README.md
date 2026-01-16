# 19: 화면 다듬기

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Next.js%20%7C%20Tailwind%20CSS%20%7C%20NestJS%20%7C%20Prisma%20%7C%20Playwright%20%7C%20Vitest-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [18-deploy](https://github.com/seungwoo7050/node-order/tree/18-deploy) 브랜치의 전체 워크스페이스(`order-api-nest`, `order-console-next`, `monitoring`, `deploy`, `compose.yaml`, `.github/workflows/ci.yml`)

`18`에서 배포한 주문 콘솔은 기능은 되지만 브라우저 기본 스타일 그대로였습니다.

이 단계에서는 시안을 먼저 정하고, 색·글자·간격을 토큰으로 옮겨 화면을 다시 그립니다. 시안이 요구하는 API(관리자 역할, 주문 상세의 상품, 결제 취소 안내)를 더하고, 배포한 화면을 써 보며 데모 로그인·관리자 페이지·장바구니 페이지를 더합니다.

과정 전체(막힌 곳, 개념, 에러 신호)는 [guide/README.md](guide/README.md)에 있습니다. 이 문서는 무엇이 있고 어떻게 돌리는지만 적습니다.

## 지원 범위

- 화면

  - 색·글자·간격 토큰(`globals.css`의 `@theme inline`), 라이트·다크. 보조 글자는 바탕 위 명암비 4.5:1 이상

  - 상품: 담으면 그 자리가 수량 조절기, 재고 상한, 품절, 불러오는 중, 결제 취소 안내. 휴대폰 폭에서는 화면 아래 합계 줄

  - 장바구니 페이지 `/cart`: 수량 조절, 빼기, 합계, 결제

  - 내 주문: 최신순, 상태 표시, 주문 상세에 산 상품과 그때의 가격

  - 관리자 페이지 `/admin/products`: 상품 표와 이미지 올리기. 머리글의 "관리"는 관리자에게만 보임

  - 로그인: label 붙은 입력 칸, 401과 그 밖의 실패를 나눈 문구, 데모 로그인 버튼

- API

  - 사용자 역할(`user`·`admin`, 마이그레이션 `0017_user_role`). 역할은 액세스 토큰에 담고, 이미지 업로드는 `AdminGuard`로 관리자만

  - tRPC `me.profile`(이름·역할), 주문 상세의 품목, 내 주문 최신순

  - 결제 취소 주소에 주문 번호(`/shop?checkout=canceled&order=<id>`)

  - 데모 로그인 `GET`·`POST /auth/demo`. `DEMO_LOGIN=1`일 때만 열리고, 일반은 `lee`, 관리자는 `kim`으로 들어감

- 테스트

  - 프론트 단위 테스트(Vitest, 장바구니 store). `npm run test:web`이 단위 테스트와 e2e를 차례로 돎

  - e2e: 수량 조절, 데모 로그인, 관리자 메뉴·페이지, 로그아웃 뒤 이전 사용자의 캐시가 남지 않는지

- 운영의 관리자는 시드가 아니라 SQL 한 줄로 정함. 운영 DB에는 시드를 다시 돌리지 않음

- 화면의 "데모 데이터는 매일 초기화됩니다"를 지키는 예약 작업은 다루지 않습니다.

## 구성

`18`에서 바뀐 곳만 적습니다.

```text
.
├── compose.yaml                      # api에 DEMO_LOGIN: "1"
├── deploy/
│   ├── compose.yml                   # api에 DEMO_LOGIN: ${DEMO_LOGIN:-0}
│   └── .env.example                  # DEMO_LOGIN=0
├── order-api-nest/
│   ├── .env                          # DEMO_LOGIN=1 (CI의 프론트 e2e도 이 파일을 씀)
│   ├── prisma/
│   │   ├── migrations/0017_user_role/
│   │   └── seed.ts                   # kim을 관리자로
│   ├── src/auth/                     # admin.guard.ts, demo-login.dto.ts, 토큰에 역할
│   ├── src/me/order-select.ts        # 주문 상세의 품목
│   ├── src/trpc/router.ts            # me.profile
│   └── test/demo-login.e2e-spec.ts
├── order-console-next/
│   ├── app/
│   │   ├── globals.css               # 토큰, 본문 기본값, 컴포넌트 클래스
│   │   ├── nav.tsx                   # 머리글: 현재 화면 표시, 관리 메뉴, 장바구니 링크
│   │   ├── shop/                     # 상품 화면, stepper.tsx(수량 조절기)
│   │   ├── cart/page.tsx             # 장바구니 페이지
│   │   ├── admin/products/           # 관리자 페이지와 이미지 업로더
│   │   ├── me/orders/                # 내 주문, 주문 상세
│   │   └── login/page.tsx            # 오류 문구, 데모 버튼
│   ├── lib/
│   │   ├── cart-store.ts             # setQuantity
│   │   ├── cart-store.test.ts        # Vitest
│   │   └── use-profile.ts            # useProfile, useIsAdmin
│   ├── e2e/                          # cart-quantity, demo-login 추가, 나머지는 새 화면에 맞춤
│   └── vitest.config.ts              # lib/**/*.test.ts만
└── README.md
```

## 실행

### 준비

- `18`의 실행 환경(Node, Docker)과 운영 서버. `deploy/aws/.local/`은 커밋되지 않으므로 `18`의 폴더에서 옮겨 옴

```sh
# 저장소 루트에서
docker compose up -d db redis storage
npm ci
cd order-api-nest && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && cd ..
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
```

### 로컬

```sh
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:3000 (다른 터미널)
```

로그인 화면의 "데모로 둘러보기"로 비밀번호 없이 일반 사용자(`lee`)·관리자(`kim`)로 들어갑니다. 비밀번호 로그인은 시드 사용자와 `1234`입니다.

### 테스트

```sh
npm run test:api
npm run test:web    # API를 띄워 둔 채로. 단위 4개, e2e 17개(실제 Stripe 결제 1개는 건너뜀)
```

### 배포

워크플로는 바꾸지 않고 저장소 변수만 바꿉니다.

```sh
R=<계정>/<저장소>
gh variable set DEPLOY_BRANCH -R $R -b 19-design
```

Environments의 `production`에 허용 브랜치를 정해 두었다면 `19-design`으로 바꿉니다(`gh api repos/$R/environments/production --jq .deployment_branch_policy`가 `null`이면 할 일 없음).

푸시하기 전에 서버의 값 두 가지를 맞춥니다(`deploy/aws`에서).

```sh
# 데모 로그인 켜기: 이 PC의 원본과 서버 .env에 같은 한 줄
grep -q '^DEMO_LOGIN=' .local/server.env || echo 'DEMO_LOGIN=1' >> .local/server.env
ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && (grep -q "^DEMO_LOGIN=" .env || echo "DEMO_LOGIN=1" >> .env)'

# 관리자 지정: 내 GitHub 계정(gh api user --jq .id)과 데모 관리자
echo "UPDATE users SET role = 'admin' WHERE id IN ('github-<숫자 id>', 'kim');" \
  | ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && docker compose run --rm -T migrate npx prisma db execute --stdin'
```

```sh
git push
gh run watch
```

역할 마이그레이션(`0017`)은 배포 스크립트가 적용합니다. 이미 배포한 뒤에 `.env`를 바꿨다면 `docker compose up -d api`로 api만 다시 만듭니다.

## 결과 보기

```sh
curl -s https://api.<IP를 -로 이은 것>.sslip.io/auth/demo     # {"enabled":true}

# 운영 DB의 역할(deploy/aws에서)
ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && docker run --rm \
  -v ./rds-ca.pem:/certs/rds-ca.pem:ro -e PGSSLROOTCERT=/certs/rds-ca.pem \
  postgres:17 psql "$(sed -n "s/^ADMIN_DATABASE_URL=//p" .env)" -At -c "SELECT id, role FROM users ORDER BY id"'
```

브라우저에서는 `https://shop.<IP를 -로 이은 것>.sslip.io/login`의 "관리자로"로 들어가 머리글에 "관리"가 있는지, 관리자 페이지에서 이미지를 올릴 수 있는지, 상품을 담고 장바구니 페이지에서 테스트 카드(`4242 4242 4242 4242`)로 결제되는지 봅니다.

데스크톱·휴대폰 폭과 라이트·다크는 개발자 도구의 기기 툴바와 Rendering 탭으로 바꿔 봅니다.
