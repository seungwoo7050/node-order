# 공개 데모: 방문자별 계정, 읽기 전용 관리자, 요청 수 제한, 고정 카탈로그

## 목표

이 프로젝트는 [`20-operations`](https://github.com/seungwoo7050/node-order/tree/20-operations)으로부터 시작한다.

`18`에서 공개 URL에 띄우고 `20`에서 매일 초기화를 붙인 데모는, 리뷰어가 아니라 낯선 방문자도 들어올 수 있는 곳이다.

실제로 띄워 두고 써 보니 세 가지가 걸렸다.

- 모든 방문자가 같은 데모 계정(`lee`, `kim`)으로 들어간다. 한 방문자가 만든 주문이 다른 방문자의 "내 주문"에 보인다.

- "관리자로" 버튼이 진짜 관리자(`kim`)로 들여보낸다. 누구나 상품 사진을 바꿀 수 있다.

- 시드 주문에는 품목이 없다. 주문 상세를 열면 "상품" 칸이 비어 있어 데모가 죽어 보인다.

이 문서는 데모를 낯선 방문자로부터 지키면서, 리뷰어에게는 살아 있게 보이게 한다.

1. 데모 버튼을 누를 때마다 그 방문자만의 임시 사용자를 만들고, 품목이 든 견본 주문을 넣는다. 24시간 지나면 정리 작업이 지운다

2. 데모 관리자를 새 역할(`demo_admin`)로 나눈다. 관리 화면은 보이지만, 쓰기 API는 서버의 Guard가 403으로 막는다. 화면은 버튼을 끄고 이유를 글자로 보여 준다

3. IP마다 요청 수를 제한한다. 로그인 계열은 더 낮게 센다

4. 초기화 시점의 상품(이름·가격·재고·사진)을 저장소의 파일로 고정하고, 매일 초기화가 무엇을 되돌리고 무엇을 남기는지 정한다

이 문서를 마치면 이렇게 바뀐다.

**데모 버튼**

| 버튼 | 전 | 후 |
|---|---|---|
| 일반 사용자로 | 모두 `lee` | 누를 때마다 새 `demo-xxxxxxxx`(`user`), 견본 주문 1~2건 |
| 관리자로 | 모두 `kim`(진짜 `admin`) | 누를 때마다 새 `demo-xxxxxxxx`(`demo_admin`), 쓰기는 403 |

**요청 수 제한** (IP마다 1분)

| 구분 | 한도 |
|---|---|
| 로그인 계열(`/auth/login`, `/auth/demo`, `/auth/exchange`, `/auth/refresh`) | 20건 |
| 그 밖의 요청 | 300건 |
| `/health`, `/metrics`, `/payments/webhook` | 세지 않음 |

넘으면 429와 `Retry-After`를 받는다.

**매일 04:00 초기화**

| 되돌린다 | 남긴다 |
|---|---|
| 카테고리·상품(`prisma/seed/catalog.json`의 값으로) | GitHub로 가입한 사용자와 그 주문·로그인 |
| 시드 사용자의 주문(품목을 넣어 다시 만든다) | 진짜 관리자 역할 |
| 임시 사용자(모두 지운다) | 상품 사진 파일(`seed/…`) |

> 시작 기준점:  
> `20`까지의 코드(저장소 루트가 곧 통합본이다)와, `18`에서 만든 운영 서버(EC2·RDS·S3, `/opt/node-order`)가 있어야 한다.  
> 로컬에서는 `compose.yaml`의 `db`·`redis`·`storage`가 떠 있어야 한다(`docker compose up -d db redis storage`). 경로는 모두 저장소 루트 기준이다.  
> 이 단계의 브랜치는 `21-public-demo`다. 배포 브랜치는 `20`처럼 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 목록으로 바꾼다(4장 작업 7).  
> 새 마이그레이션 번호는 `0018`부터다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 옵션·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 뚫림이나 에러다 | 친다. 확인한 뒤 되돌린다 |
| `진단 N.` | 5장에서 "어디서 틀어졌나"를 가르는 절차 | 친다 |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 완성된다. 2장과 3장의 `실험`은 그 바로 뒤의 `[원복]` 작업까지 함께 한다. 1장의 `실험`은 지금 상태를 보기만 하므로 되돌릴 것이 없다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드, 마이그레이션, 시드 파일과 사진, 테스트, compose | 한다 |
| `[실행]` | 저장소 밖의 상태: DB의 데이터(시드, 관리자 역할), 서버, GitHub 저장소 변수. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 테스트, 조회, 브라우저로 보기 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`.

- 바꾸는 코드는 `diff` 블록 하나에 위치(앞뒤 문맥)와 내용(`-` 지금, `+` 바꾼 뒤)을 함께 싣는다. 새 파일은 전체를 싣고, 첫 줄의 경로 주석은 실제 파일에는 없다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 5장 "진단 3"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`과 `용어`만 있다. 5장은 진단 장이고, 6·7장은 체크리스트라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 공개 데모에 대한 사전지식](#0-공개-데모에-대한-사전지식) | 지금 데모에서 생긴 일, 인증과 인가, 화면은 안내일 뿐이라는 것(작업 없음) |
| [1. 1단계: 방문자마다 데모 계정](#1-1단계-방문자마다-데모-계정) | 임시 사용자 표시(`expires_at`), 견본 주문, 리더가 도는 정리 작업 |
| [2. 2단계: 데모 관리자는 읽기 전용](#2-2단계-데모-관리자는-읽기-전용) | `demo_admin` 역할, 쓰기 API 전수 점검, 화면의 비활성 표시, 화면만 막았을 때 뚫리는 것 |
| [3. 3단계: 요청 수 제한](#3-3단계-요청-수-제한) | Redis 고정 창, 로그인 계열 한도, 세지 않는 경로, `X-Forwarded-For`를 믿는 범위 |
| [4. 4단계: 데모 카탈로그 고정과 초기화 범위](#4-4단계-데모-카탈로그-고정과-초기화-범위) | `catalog.json`과 사진, 고정 키, 초기화가 되돌리는 것과 남기는 것, 배포와 진짜 관리자 |
| [5. 디버깅](#5-디버깅) | 역할·요청 수 카운터를 보고, 에러 신호 표로 원인을 가른다 |
| [6. 완성 확인](#6-완성-확인) | 시험해보기와 체크리스트 |
| [7. 다음 단계](#7-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 공개 데모에 대한 사전지식

### 작업 목표 | 지금 데모에서 실제로 생긴 일

| 겪은 일 | 원인(지금 코드) | 이 문서 |
|---|---|---|
| 다른 방문자의 주문이 내 주문에 보인다 | `AuthService.DEMO_ACCOUNTS = { user: "lee", admin: "kim" }`. 모든 방문자가 같은 행으로 로그인한다 | 1장 |
| 아무나 상품 사진을 바꾼다 | "관리자로"가 `kim`(`role = admin`)으로 들여보낸다 | 2장 |
| 로그인만 하면 카테고리를 옮기고 지운다. 로그인 없이 모든 주문과 사용자 목록이 보인다 | `PATCH`·`DELETE /categories/:id`는 `AuthGuard("jwt")`뿐이다. `GET /orders`·`/orders/:id`·`/orders/totals`·`GET /users`에는 Guard가 없다 | 2장 |
| 한 IP가 데모 버튼을 수천 번 누를 수 있다 | 요청 수를 세는 곳이 없다. 1장 뒤로는 누를 때마다 사용자 행이 생긴다 | 3장 |
| 주문 상세의 "상품" 칸이 비어 있다 | `prisma/seed.ts`가 `order.createMany`로 금액만 넣는다 | 4장 |
| 관리자가 올린 사진이 다음 날 사라진다 | 매일 초기화가 `products`를 TRUNCATE하고 사진 없이 다시 만든다. 사진은 고아가 되어 `06`의 정리 작업이 지운다 | 4장 |

- 공개 데모의 방문자는 둘이다. 데모를 둘러보러 온 리뷰어와, 무엇이든 눌러 보는 낯선 사람이다. 앞의 사람에게는 살아 있게 보여야 하고, 뒤의 사람이 남긴 것은 앞의 사람에게 보이면 안 된다.

### 개념 1 | 인증과 인가: 401과 403

인증(authentication)은 "누구인가"이고, 인가(authorization)는 "그 사람이 이것을 해도 되는가"다.

| 단계 | 이 저장소에서 하는 곳 | 실패하면 |
|---|---|---|
| 인증 | `AuthGuard("jwt")` → `JwtStrategy.validate()`가 토큰을 풀어 `req.user = { userId, role }`을 만든다 | 401 Unauthorized |
| 인가 | `AdminGuard`가 `req.user.role`을 본다 | 403 Forbidden |

- `@UseGuards(AuthGuard("jwt"), AdminGuard)`처럼 둘을 붙이면 왼쪽부터 돈다. 인증이 먼저 `req.user`를 채워야 인가가 역할을 볼 수 있다.

- 401은 "다시 로그인하면 될 수도 있다", 403은 "로그인해도 안 된다"다. 프론트의 `fetchWithAuth`가 401일 때만 refresh를 시도하는 이유다.

### 개념 2 | 화면은 안내일 뿐이다

관리 메뉴를 숨기고 버튼을 끄는 것은 "이 사람에게 이 기능은 없다"고 알려 주는 일이다. 막는 일이 아니다.

API는 브라우저 밖에서도 불린다. 개발자 도구의 Network 탭에서 요청을 복사하면(Copy as cURL) 같은 요청을 터미널에서 보낼 수 있다.

그래서 이 문서는 모든 쓰기를 서버에서 막고, 화면은 그 결과를 미리 보여 주는 쪽으로 둔다. 2장의 실험이 화면만 막았을 때 어떻게 되는지 보여 준다.

> C로 치면 함수 안에서 인자를 검사하지 않고, 부르는 쪽이 알아서 올바른 값을 줄 거라고 믿는 것과 같다. 부르는 쪽은 내가 쓴 화면만이 아니다.

### 용어 | 이 문서에서 처음 나오는 말

- 임시 사용자: 데모 버튼으로 만든 사용자. `users.expires_at`에 값이 있다(1장).

- 데모 관리자: 역할이 `demo_admin`인 임시 사용자. 관리 화면은 보지만 아무것도 바꾸지 못한다(2장).

- 진짜 관리자: 역할이 `admin`인 사용자. 데모 버튼으로는 될 수 없고, 서버에서 SQL로만 정한다(2장 개념, 4장 작업 8).

- 고정 창(fixed window): 시계를 1분 단위로 자르고, 그 칸 안의 요청 수를 센다(3장).

- 카탈로그: 초기화 시점의 카테고리와 상품. `order-api-nest/prisma/seed/catalog.json`에 고정한다(4장).

## 1. 1단계: 방문자마다 데모 계정

### 실험 | 지금은 두 방문자가 같은 주문을 본다.

일반 창과 시크릿 창(서로 쿠키를 나누지 않는다)에서 `http://localhost:3000/login`을 연다.

두 창 모두 "일반 사용자로"를 누른다. 한 창에서 상품을 담아 결제 버튼까지 누른 뒤(Stripe 키가 없으면 실패해도 된다), 다른 창의 "내 주문"을 새로 고친다.

두 창의 "내 주문" 목록이 같다. 둘 다 `lee`다.

> 개발자 도구 → Network에서 `/auth/demo` 응답의 `accessToken`을 [jwt.io](https://jwt.io)에 붙이면 두 창의 `sub`가 모두 `lee`다. jwt.io는 디코딩을 브라우저 안에서 하지만, 운영 토큰은 붙이지 않는다.

### 작업 1. [커밋] 임시 사용자를 데이터로 표시한다

`users`에 `expires_at`을 더한다. 값이 있으면 임시 사용자이고, 그 시각이 지나면 지운다.

```diff
--- a/order-api-nest/prisma/schema.prisma
+++ b/order-api-nest/prisma/schema.prisma
@@
 model User {
   id            String      @id
   name          String
   role          Role        @default(user)
   passwordHash  String?     @map("password_hash")
   githubId      String?     @unique @map("github_id")
   createdAt     DateTime    @default(now()) @map("created_at")
+  expiresAt     DateTime?   @map("expires_at")
   orders        Order[]
   refreshTokens RefreshToken[]
 
+  @@index([expiresAt])
   @@map("users")
 }
```

마이그레이션 파일을 만든다. 이름은 이 저장소의 규칙대로 번호로 바꾼다.

```sh
cd order-api-nest
npx prisma migrate dev --create-only --name demo_user_expiry
mv prisma/migrations/*_demo_user_expiry prisma/migrations/0018_demo_user_expiry
```

만들어진 SQL이 아래와 같은지 본다.

```sql
-- order-api-nest/prisma/migrations/0018_demo_user_expiry/migration.sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_expires_at_idx" ON "users"("expires_at");
```

개발 DB와 테스트 DB에 적용하고 클라이언트를 다시 만든다.

```sh
npx prisma migrate deploy
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npx prisma generate
```

세 명령은 하는 일이 다르다.

| 명령 | 하는 일 | 어느 DB에 | 이 문서에서 쓰는 곳 |
|---|---|---|---|
| `migrate dev --create-only` | `schema.prisma`와 지금까지의 마이그레이션 파일을 비교해 **새 SQL 파일을 만든다**. 적용은 하지 않는다 | 비교용 임시 DB(shadow DB)를 잠깐 만들었다 지운다 | 위의 파일 만들기. 마이그레이션을 쓸 때만 |
| `migrate deploy` | `prisma/migrations/`에서 아직 적용하지 않은 파일을 **순서대로 적용만 한다**. 파일을 만들지 않고, 스키마와 비교하지도 않는다 | 접속 주소의 DB(`ADMIN_DATABASE_URL`) | 적용 블록의 첫 줄(개발 DB)과 둘째 줄(테스트 DB) |
| `migrate dev` (옵션 없이) | 위의 "만들기"와 "적용"을 한 번에 한다. 기록과 DB가 어긋나면 DB를 지우고 다시 만들자고 묻는다 | 개발 DB + shadow DB | 쓰지 않는다 |

- 옵션 없이 `migrate dev`를 쓰지 않는 이유: 파일을 `20261017…_demo_user_expiry`라는 시각 이름으로 만들자마자 적용한다. 그 뒤에 폴더 이름을 `0018_…`로 바꾸면, DB의 적용 기록(`_prisma_migrations`)에 있는 이름과 파일 이름이 달라 Prisma가 "기록에 없는 마이그레이션"으로 본다. 그래서 `--create-only`로 파일만 만들고, 이름을 바꾼 뒤 `deploy`로 적용한다.

- 적용 블록의 첫 줄과 둘째 줄은 같은 명령이다. 다른 것은 DB뿐이다. 이 저장소의 `prisma7.config.ts`는 `ADMIN_DATABASE_URL`로 접속하고, 둘째 줄은 명령 앞에 그 값을 테스트 DB(`order_api_test`)로 바꿔 준다. 셸에서 준 값이 `.env`의 값보다 먼저다.

- 테스트 DB에도 따로 적용하는 이유: e2e는 개발 DB가 아니라 `order_api_test`에 붙는다(`test/setup-env.ts`). 개발 DB에만 적용하면 e2e가 `expires_at`이 없다고 실패한다.

- `deploy`는 운영과 CI가 쓰는 명령과 같다(`Dockerfile`의 `migrate` 단계, `deploy/deploy.sh`). 이미 적용한 파일은 건너뛰므로 여러 번 돌려도 된다.

- 셋째 줄의 `generate`는 DB에 닿지 않는다. `schema.prisma`로 TypeScript 클라이언트(`src/generated/prisma`)만 다시 만든다. 하지 않으면 코드에서 `expiresAt`을 쓸 때 `Unknown argument`가 난다.

- 인덱스는 정리 작업의 `WHERE expires_at < now()`를 위한 것이다. 임시 사용자가 아닌 행은 `NULL`이라 인덱스에서 빠지지는 않지만, 범위 조건으로 지난 행만 읽는다.

### 작업 2. [커밋] 데모 사용자와 견본 주문 만들기

새 파일 하나에 임시 사용자를 만들고 지우는 일을 모은다. 지우는 함수는 작업 3의 정리 작업과 4장의 시드가 함께 쓴다.

```ts
// order-api-nest/src/auth/demo-user.ts
import { randomBytes } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";

// 임시 사용자의 수명. 테스트에서 줄여 볼 수 있게 환경 변수로 둔다
export const DEMO_USER_TTL_MS = Number(process.env.DEMO_USER_TTL_SECONDS ?? 24 * 60 * 60) * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// "demo-" + 무작위 16진수 8자리. 접두사는 사람이 로그·DB에서 알아보라고 붙인다(지우는 기준은 expires_at)
export const newDemoUserId = () => `demo-${randomBytes(4).toString("hex")}`;

export async function createDemoUser(tx: Prisma.TransactionClient, id: string): Promise<void> {
  // 만료 시각을 행에 적어 둔다. 정리 작업은 이 값만 보고 지운다
  await tx.user.create({ data: { id, name: "데모 방문자", expiresAt: new Date(Date.now() + DEMO_USER_TTL_MS) } });
  await createSampleOrders(tx, id);
}

// 지난 주문처럼 보이게 하는 견본. 재고는 건드리지 않는다(방문자가 많아도 상점의 재고가 줄지 않게)
async function createSampleOrders(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const products = await tx.product.findMany({ where: { stock: { gt: 0 } }, select: { id: true, price: true } });
  // 상품을 섞어 최대 3개를 골라 두 주문(2개 + 1개)으로 나눈다
  const picked = products.sort(() => Math.random() - 0.5).slice(0, 3);
  const groups = [picked.slice(0, 2), picked.slice(2)].filter((g) => g.length > 0);
  for (const [i, group] of groups.entries()) {
    const items = group.map((p) => ({ productId: p.id, quantity: 1 + Math.floor(Math.random() * 2), unitPrice: p.price }));
    await tx.order.create({
      data: {
        userId,
        price: items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
        paid: i === 0,
        // 둘째는 취소됨. 결제 세션 없는 "결제 대기"는 영원히 대기로 보이기 때문
        canceledAt: i === 0 ? null : new Date(),
        createdAt: new Date(Date.now() - (groups.length - i) * DAY_MS),
        items: { create: items },
      },
    });
  }
}

// 사용자와 딸린 행을 지운다. 정리 작업(asAdmin 안)과 시드(소유자 연결)가 같이 쓴다
export async function deleteUsers(tx: Prisma.TransactionClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const pending = await tx.order.findMany({ where: { userId: { in: ids }, paid: false, canceledAt: null }, select: { id: true } });
  // 결제 대기 주문이 잡아 둔 재고를 먼저 돌려준다
  for (const o of pending) await cancelUnpaidOrder(tx, o.id);
  // 외래 키 때문에 자식부터: 품목 → 주문 → 토큰 → (외래 키 없는 것) → 사용자
  await tx.orderItem.deleteMany({ where: { order: { userId: { in: ids } } } });
  await tx.order.deleteMany({ where: { userId: { in: ids } } });
  await tx.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await tx.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
  await tx.outboxEvent.deleteMany({ where: { userId: { in: ids } } });
  const { count } = await tx.user.deleteMany({ where: { id: { in: ids } } });
  return count;
}
```

- `demo-` 뒤의 8글자는 무작위다(`randomBytes(4)` → 16진수 8자리). 경우의 수가 약 43억이라 하루에 만드는 수로는 겹칠 일이 거의 없고, 겹치면 기본 키 충돌로 그 요청만 실패한다.

- 견본 주문은 상품을 무작위로 골라 두 건(결제 완료 하나, 취소 하나)을 만든다. 상품이 셋보다 적으면 한 건이다. 날짜는 하루·이틀 전으로 둔다.

- 둘째 주문을 "결제 대기"가 아니라 "취소됨"으로 둔 이유: 결제 세션이 없는 대기 주문은 결제 버튼도 만료도 없이 영원히 "결제 대기"로 보인다.

로그인에서 "일반 사용자로"만 바꾼다. "관리자로"는 2장에서 바꾼다.

```diff
--- a/order-api-nest/src/auth/auth.service.ts
+++ b/order-api-nest/src/auth/auth.service.ts
@@
 import { AuthCodeStore } from "./auth-code.store.js";
 import { verifyGithubToken } from "./github.js";
+import { createDemoUser, newDemoUserId } from "./demo-user.js";
@@
-  static readonly DEMO_ACCOUNTS = { user: "lee", admin: "kim" } as const;
+  static readonly DEMO_ADMIN_ACCOUNT = "kim";
 
   demoEnabled(): boolean {
     return process.env.DEMO_LOGIN === "1";
   }
 
   async loginAsDemo(as: "user" | "admin"): Promise<IssuedTokens> {
     if (!this.demoEnabled()) throw new NotFoundException();
-    const user = await this.prisma.user.findUnique({ where: { id: AuthService.DEMO_ACCOUNTS[as] } });
+    if (as === "user") {
+      const id = newDemoUserId();
+      // orders의 RLS(WITH CHECK)를 통과하려면 app.user_id가 새 사용자여야 한다. 그래서 id를 먼저 정한다
+      await this.prisma.asUser(id, (tx) => createDemoUser(tx, id));
+      // 트랜잭션이 커밋된 뒤 발급한다. issueTokens가 DB에서 역할을 다시 읽는다
+      return this.issueTokens(this.prisma, id, randomUUID());
+    }
+    const user = await this.prisma.user.findUnique({ where: { id: AuthService.DEMO_ADMIN_ACCOUNT } });
     if (!user) throw new NotFoundException("데모 계정이 없다 - 시드를 확인한다");
     return this.issueTokens(this.prisma, user.id, randomUUID());
   }
```

- 사용자와 견본 주문을 `asUser(id, …)` 트랜잭션 하나로 만든다. 견본 주문을 넣다가 실패하면 사용자도 남지 않는다.

- `asUser`인 이유는 `orders`의 RLS다(`0013_enable_rls`). `app.user_id`가 그 주문의 `user_id`와 같아야 `WITH CHECK`를 통과한다. 그래서 id를 트랜잭션보다 먼저 정한다.

- 토큰은 트랜잭션이 커밋된 뒤에 발급한다. `issueTokens`가 DB에서 역할을 다시 읽는다.

### 작업 3. [커밋] 만든 지 24시간 지난 임시 사용자 정리

리더 한 대만 도는 정기 작업을 하나 더 만든다. `TokenCleanupJob`과 같은 모양이다.

```ts
// order-api-nest/src/leader/demo-user-cleanup.job.ts
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { deleteUsers } from "../auth/demo-user.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LeaderElection } from "./leader-election.js";

@Injectable()
export class DemoUserCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DemoUserCleanupJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.DEMO_CLEANUP_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    // 여러 대 중 리더 한 대만 돈다
    if (!this.leaderElection.isLeader) return;
    // 여러 사용자의 주문을 지우므로 RLS를 넘는 관리자 트랜잭션
    const deleted = await this.prisma.asAdmin(async (tx) => {
      // 한 번에 100명까지. 트랜잭션을 짧게 두고 남은 것은 다음 차례에
      const expired = await tx.user.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true }, take: 100 });
      return deleteUsers(tx, expired.map((u) => u.id));
    });
    if (deleted > 0) this.logger.log(`임시 사용자 정리: ${deleted}명 삭제`);
  }
}
```

```diff
--- a/order-api-nest/src/leader/leader.module.ts
+++ b/order-api-nest/src/leader/leader.module.ts
@@
 import { OrphanImageCleanupJob } from "./orphan-image-cleanup.job.js";
 import { TokenCleanupJob } from "./token-cleanup.job.js";
+import { DemoUserCleanupJob } from "./demo-user-cleanup.job.js";
 
-@Module({ providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob] })
+@Module({ providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob, DemoUserCleanupJob] })
 export class LeaderModule {}
```

- 10분마다, 한 번에 100명까지 지운다. 한 트랜잭션이 너무 길어지지 않게 하고, 남은 것은 다음 차례에 지운다. 하루 14,400명까지 따라간다. 그보다 많이 쌓이면 4장의 매일 초기화가 남은 임시 사용자를 모두 지운다.

- `asAdmin`인 이유: 지울 주문이 여러 사용자의 것이다. `orders`의 RLS는 `app.role = 'admin'`일 때만 남의 행을 보여 준다.

### 작업 4. [커밋] 테스트: 누를 때마다 새 사용자, 견본 주문, 정리

`order-api-nest/test/demo-login.e2e-spec.ts`를 아래처럼 고친다. 상품 셋을 넣어 두고, 일반 사용자 테스트는 "누를 때마다 새 사용자"로 바꾸고, 관리자 테스트는 따로 떼어 두고(2장에서 바뀐다), 견본 주문과 정리 작업 테스트를 더한다. 정리 작업은 리더 여부를 고정한 뒤 직접 부른다.

```diff
--- a/order-api-nest/test/demo-login.e2e-spec.ts
+++ b/order-api-nest/test/demo-login.e2e-spec.ts
@@
 import cookieParser from "cookie-parser";
 import { AppModule } from "../src/app.module.js";
+import { DemoUserCleanupJob } from "../src/leader/demo-user-cleanup.job.js";
+import { LeaderElection } from "../src/leader/leader-election.js";
 import { adminDb } from "./admin-db.js";
 
@@
     await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
     await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
+    // 견본 주문을 만들 상품. adminDb는 소유자 연결이라 RLS를 거치지 않는다
+    await adminDb.product.createMany({ data: [{ name: "가", price: 1000, stock: 5 }, { name: "나", price: 2000, stock: 5 }, { name: "다", price: 3000, stock: 5 }] });
   });
 
@@
   });
 
-  it("켜져 있으면 일반은 lee, 관리자는 kim으로 들어가고 refresh 쿠키도 받는다", async () => {
+  it("누를 때마다 새 임시 사용자를 만들고 refresh 쿠키도 준다", async () => {
     process.env.DEMO_LOGIN = "1";
     expect(await (await fetch(`${baseUrl}/auth/demo`)).json()).toEqual({ enabled: true });
 
-    const user = await demo("user");
-    expect(user.status).toBe(200);
-    expect(user.headers.get("set-cookie")).toMatch(/^refresh_token=/);
-    expect(await roleOf(user)).toMatchObject({ sub: "lee", role: "user" });
+    const first = await demo("user");
+    expect(first.status).toBe(200);
+    expect(first.headers.get("set-cookie")).toMatch(/^refresh_token=/);
+    const a = await roleOf(first);
+    const b = await roleOf(await demo("user"));
+    expect(a).toMatchObject({ sub: expect.stringMatching(/^demo-[0-9a-f]{8}$/), role: "user" });
+    expect(b.sub).not.toBe(a.sub);
+    const { expiresAt } = await adminDb.user.findUniqueOrThrow({ where: { id: a.sub } });
+    expect(expiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
+  });
 
+  it("관리자로 들어가면 시드의 kim이다", async () => {
+    process.env.DEMO_LOGIN = "1";
     expect(await roleOf(await demo("admin"))).toMatchObject({ sub: "kim", role: "admin" });
+  });
+
+  it("임시 사용자에게는 품목이 든 견본 주문이 1~2건 있고, 재고는 그대로다", async () => {
+    process.env.DEMO_LOGIN = "1";
+    const { sub } = await roleOf(await demo("user"));
+    const orders = await adminDb.order.findMany({ where: { userId: sub }, include: { items: true } });
+    expect(orders.length).toBeGreaterThanOrEqual(1);
+    expect(orders.length).toBeLessThanOrEqual(2);
+    for (const o of orders) expect(o.items.length).toBeGreaterThan(0);
+    expect((await adminDb.product.findMany({ orderBy: { id: "asc" } })).map((p) => p.stock)).toEqual([5, 5, 5]);
+  });
+
+  it("만료된 임시 사용자는 정리 작업이 주문·토큰과 함께 지우고, 결제 대기 주문의 재고는 돌려준다", async () => {
+    process.env.DEMO_LOGIN = "1";
+    const { sub } = await roleOf(await demo("user"));
+    await adminDb.order.create({ data: { userId: sub, price: 2000, paid: false, items: { create: [{ productId: 1, quantity: 2, unitPrice: 1000 }] } } });
+    await adminDb.product.update({ where: { id: 1 }, data: { stock: { decrement: 2 } } });
+    await adminDb.user.update({ where: { id: sub }, data: { expiresAt: new Date(Date.now() - 1000) } });
+
+    // 리더 선출은 2초 간격이라 테스트 시점에 정해져 있지 않다. 판단만 보려고 리더로 고정한다
+    const leader = vi.spyOn(app.get(LeaderElection, { strict: false }), "isLeader", "get").mockReturnValue(true);
+    await app.get(DemoUserCleanupJob, { strict: false }).run();
+    leader.mockRestore();
+
+    expect(await adminDb.user.count({ where: { id: sub } })).toBe(0);
+    expect(await adminDb.order.count({ where: { userId: sub } })).toBe(0);
+    expect(await adminDb.refreshToken.count({ where: { userId: sub } })).toBe(0);
+    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(5);
+    expect(await adminDb.user.count()).toBe(2);
   });
 
```

```sh
cd order-api-nest
npm run test:e2e -- demo-login

# 출력
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- 정리 작업 테스트에서 `isLeader`를 고정하는 이유: 테스트 앱도 부팅하면 리더 선출을 시도하지만, 2초 간격이라 첫 테스트 시점에 리더인지 정해져 있지 않다. 작업의 판단(누구를 지우나)만 보려는 것이라 리더 여부는 고정한다.

- `adminDb`는 소유자 연결이라 RLS를 거치지 않는다. 테스트가 남의 주문을 직접 만들고 셀 수 있는 이유다.

### 작업 5. [확인] 두 창으로 다시 보기

API를 다시 띄우고 맨 앞의 실험을 되풀이한다. 상품이 있어야 견본 주문이 생기므로, 개발 DB에 시드가 들어 있어야 한다(`npx prisma db seed`).

두 창의 "내 주문"이 서로 다르고, 각각 견본 주문 1~2건이 보인다. 주문을 열면 "상품" 칸에 품목이 있다.

DB에서도 본다.

```sh
docker compose exec db psql -U order -d order_api -c "SELECT id, role, expires_at FROM users WHERE expires_at IS NOT NULL ORDER BY created_at"

# 출력
      id       | role |       expires_at        
---------------+------+-------------------------
 demo-2e5e5778 | user | 2026-10-17 18:56:16.349
 demo-ac5298b3 | user | 2026-10-17 18:56:21.095
```

### 개념 | 임시 사용자를 데이터로 표시한다

임시인지 가르는 방법은 셋을 놓고 골랐다.

| 방법 | 장점 | 걸리는 점 |
|---|---|---|
| id 접두사(`demo-%`) + `created_at` | 마이그레이션이 없다 | `POST /users`가 열려 있으면 누구나 `demo-`로 시작하는 id를 만든다. "24시간"이 코드에 있다 |
| `is_demo` 불리언 + `created_at` | 표시가 분명하다 | 수명은 여전히 코드에 있다. 수명을 바꾸면 이미 만든 사용자에게도 바로 적용된다 |
| `expires_at` (이 문서) | 표시와 수명이 한 칸에 있다. 만들 때 정한 만료가 그대로 지켜진다 | 마이그레이션이 하나 는다 |

- `expires_at`은 "언제까지 살아 있나"를 행 자신이 들고 있다. 정리 작업은 수명 규칙을 몰라도 되고 `expires_at < now()`만 본다.

- id의 `demo-` 접두사는 사람이 로그와 DB에서 알아보라고 붙인 것이다. 지우는 기준으로는 쓰지 않는다.

### 개념 | 지우는 순서: 외래 키, RLS, 잡아 둔 재고

`deleteUsers`는 자식부터 지운다. `order_items → orders → users`, `refresh_tokens → users`가 외래 키로 묶여 있어 부모를 먼저 지우면 `Foreign key constraint violated`로 실패한다.

`outbox_events`와 `idempotency_keys`는 외래 키가 없지만 그 사용자의 것이라 함께 지운다. 남겨 두면 주인이 없는 행이 된다.

임시 사용자가 결제 화면까지 가서 그만두면 "결제 대기" 주문이 재고를 잡고 있다. 그대로 지우면 그 수량이 영영 돌아오지 않는다. 그래서 먼저 `cancelUnpaidOrder`(`14`의 결제 만료와 같은 함수)로 재고를 돌려준다.

지운 주문의 Stripe 웹훅이 나중에 오면, 웹훅 처리가 세션으로 주문을 찾지 못해 `ignored`를 돌려준다(`20`의 "초기화된 주문의 Stripe 웹훅"과 같다).

### 개념 | 지운 뒤에도 access token은 15분 산다

정리 작업은 refresh 토큰을 지우지만, 이미 발급한 access token은 JWT라 서버가 회수하지 못한다(`ACCESS_TOKEN_TTL=15m`).

그 사이 그 토큰으로 `/me/orders`를 부르면 빈 목록이 오고, 프로필(`me.profile`)은 사용자가 없어 서버 오류가 된다. 15분이 지나면 refresh가 401로 끝나 로그인 화면으로 간다.

24시간 데모 계정에서는 받아들인다. 더 짧게 끊으려면 Guard에서 매 요청 사용자 행을 확인해야 하는데, 그만큼 DB를 더 읽는다.

### 남길 것

- **찾아보면 되는 것**: `prisma migrate dev --create-only`, `deleteMany`의 관계 필터(`where: { order: { userId: { in } } }`), `vi.spyOn(obj, "prop", "get")`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 같은 계정을 여럿이 나눠 쓰면 데이터 격리는 없다. 방문자마다 사용자 행을 따로 만들어야 RLS와 `/me/*`가 제 역할을 한다.
  - 만든 데이터는 지우는 길까지 만들어야 끝난다. "언제 지우나"를 행에 적어 두면(`expires_at`) 지우는 쪽은 규칙을 몰라도 된다.
  - 행을 지울 때는 외래 키의 자식부터, 그리고 그 행이 잡고 있던 것(재고)을 먼저 돌려준다.

- **에러 신호**:
  - ``Unknown argument `expiresAt` `` → 스키마를 고친 뒤 `npx prisma generate`를 하지 않았다
  - ``The column `users.expires_at` does not exist in the current database.`` → 그 DB에 `0018`을 적용하지 않았다. e2e라면 테스트 DB(`order_api_test`)
  - `new row violates row-level security policy for table "orders"` → 견본 주문을 `asUser(id, …)` 밖에서 만들었다
  - 데모로 들어왔는데 견본 주문이 없다 → 재고가 있는 상품이 없다(시드 전)
  - 지난 임시 사용자가 남아 있다 → 이 인스턴스가 리더인지, `DEMO_CLEANUP_INTERVAL_MS`

## 2. 2단계: 데모 관리자는 읽기 전용

### 작업 1. [커밋] 역할 `demo_admin`을 더한다

```diff
--- a/order-api-nest/prisma/schema.prisma
+++ b/order-api-nest/prisma/schema.prisma
@@
 enum Role {
   user
   admin
+  demo_admin
 }
```

```sh
cd order-api-nest
npx prisma migrate dev --create-only --name demo_admin_role
mv prisma/migrations/*_demo_admin_role prisma/migrations/0019_demo_admin_role
```

```sql
-- order-api-nest/prisma/migrations/0019_demo_admin_role/migration.sql
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'demo_admin';
```

```sh
npx prisma migrate deploy
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npx prisma generate
```

- 프론트의 타입도 이 클라이언트에서 온다(`order-api-nest/trpc`). `generate`를 해야 프론트에서 `role === "demo_admin"`을 비교할 수 있다.

### 작업 2. [커밋] 토큰의 역할을 그대로 읽고, 데모 관리자에게는 이유를 말한다

`JwtStrategy`는 지금 `admin`이 아니면 모두 `user`로 접는다. 그러면 Guard가 데모 관리자와 일반 사용자를 가르지 못한다.

```diff
--- a/order-api-nest/src/auth/jwt.strategy.ts
+++ b/order-api-nest/src/auth/jwt.strategy.ts
@@
 import { ExtractJwt, Strategy } from "passport-jwt";
 
+// 모르는 역할은 가장 약한 user로 읽는다. demo_admin을 빠뜨리면 Guard가 데모 관리자를 가르지 못한다
+const ROLES = new Set(["user", "admin", "demo_admin"]);
+
 @Injectable()
 export class JwtStrategy extends PassportStrategy(Strategy) {
@@
   validate(payload: { sub: string; role?: string }) {
-    return { userId: payload.sub, role: payload.role === "admin" ? "admin" : "user" };
+    return { userId: payload.sub, role: payload.role && ROLES.has(payload.role) ? payload.role : "user" };
   }
 }
```

```diff
--- a/order-api-nest/src/auth/admin.guard.ts
+++ b/order-api-nest/src/auth/admin.guard.ts
@@
   canActivate(context: ExecutionContext): boolean {
     const user = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user;
+    // 판정은 그대로 "admin만 통과". 데모 관리자에게는 막는 이유를 따로 말한다
+    if (user?.role === "demo_admin") throw new ForbiddenException("데모 관리자는 볼 수만 있습니다");
     if (user?.role !== "admin") throw new ForbiddenException("관리자만 할 수 있습니다");
     return true;
   }
```

- 모르는 역할은 가장 약한 `user`로 읽는다. 토큰은 서명되어 있어 위조할 수 없지만, 옛 토큰이나 실수로 넣은 값이 관리자 권한이 되는 일을 막는다.

- `AdminGuard`의 판정은 그대로 "`admin`만 통과"다. 데모 관리자 줄은 막는 이유를 다르게 말할 뿐이다. 화면이 이 문장을 그대로 보여 줄 수 있다.

### 작업 3. [커밋] "관리자로"도 누를 때마다 임시 사용자

```diff
--- a/order-api-nest/src/auth/demo-user.ts
+++ b/order-api-nest/src/auth/demo-user.ts
@@
 const DAY_MS = 24 * 60 * 60 * 1000;
 
+export type DemoKind = "user" | "admin";
+
 // "demo-" + 무작위 16진수 8자리. 접두사는 사람이 로그·DB에서 알아보라고 붙인다(지우는 기준은 expires_at)
 export const newDemoUserId = () => `demo-${randomBytes(4).toString("hex")}`;
 
-export async function createDemoUser(tx: Prisma.TransactionClient, id: string): Promise<void> {
-  // 만료 시각을 행에 적어 둔다. 정리 작업은 이 값만 보고 지운다
-  await tx.user.create({ data: { id, name: "데모 방문자", expiresAt: new Date(Date.now() + DEMO_USER_TTL_MS) } });
+export async function createDemoUser(tx: Prisma.TransactionClient, id: string, as: DemoKind): Promise<void> {
+  // 만료 시각을 행에 적어 둔다. 정리 작업은 이 값만 보고 지운다
+  await tx.user.create({
+    data: {
+      id,
+      name: as === "admin" ? "데모 관리자" : "데모 방문자",
+      // 데모 버튼으로는 admin이 될 수 없다. 관리자로 눌러도 읽기 전용 역할이다
+      role: as === "admin" ? "demo_admin" : "user",
+      expiresAt: new Date(Date.now() + DEMO_USER_TTL_MS),
+    },
+  });
   await createSampleOrders(tx, id);
 }
```

```diff
--- a/order-api-nest/src/auth/auth.service.ts
+++ b/order-api-nest/src/auth/auth.service.ts
@@
-import { createDemoUser, newDemoUserId } from "./demo-user.js";
+import { createDemoUser, newDemoUserId, type DemoKind } from "./demo-user.js";
@@
-  static readonly DEMO_ADMIN_ACCOUNT = "kim";
-
   demoEnabled(): boolean {
     return process.env.DEMO_LOGIN === "1";
   }
 
-  async loginAsDemo(as: "user" | "admin"): Promise<IssuedTokens> {
+  async loginAsDemo(as: DemoKind): Promise<IssuedTokens> {
     if (!this.demoEnabled()) throw new NotFoundException();
-    if (as === "user") {
-      const id = newDemoUserId();
-      // orders의 RLS(WITH CHECK)를 통과하려면 app.user_id가 새 사용자여야 한다. 그래서 id를 먼저 정한다
-      await this.prisma.asUser(id, (tx) => createDemoUser(tx, id));
-      // 트랜잭션이 커밋된 뒤 발급한다. issueTokens가 DB에서 역할을 다시 읽는다
-      return this.issueTokens(this.prisma, id, randomUUID());
-    }
-    const user = await this.prisma.user.findUnique({ where: { id: AuthService.DEMO_ADMIN_ACCOUNT } });
-    if (!user) throw new NotFoundException("데모 계정이 없다 - 시드를 확인한다");
-    return this.issueTokens(this.prisma, user.id, randomUUID());
+    const id = newDemoUserId();
+    // orders의 RLS(WITH CHECK)를 통과하려면 app.user_id가 새 사용자여야 한다. 그래서 id를 먼저 정한다
+    await this.prisma.asUser(id, (tx) => createDemoUser(tx, id, as));
+    // 트랜잭션이 커밋된 뒤 발급한다. issueTokens가 DB에서 역할을 다시 읽는다
+    return this.issueTokens(this.prisma, id, randomUUID());
   }
```

- 이제 데모 버튼으로는 어떤 `admin`도 될 수 없다. `kim`은 시드 사용자로 남지만(로컬 e2e가 비밀번호로 쓴다), 운영의 `DEMO_PASSWORD`는 무작위라 아무도 그 비밀번호를 모른다(`18`의 `60-server-env.sh`).

### 작업 4. [커밋] 쓰기와 민감한 읽기 API 전수 점검

컨트롤러를 모두 열어 Guard를 표로 맞춘다. 화면이 부르는지가 아니라 "이 API가 무엇을 바꾸거나 보여 주나"로 정한다.

| API | 지금 | 바꾼 뒤 | 이유 |
|---|---|---|---|
| `GET /products`, tRPC `products.list`, `GET /categories/*` | 없음 | 그대로 | 공개 카탈로그 |
| `POST /orders/checkout`, `GET /me/*`, tRPC `me.*` | 로그인 | 그대로 | 자기 것만(RLS) |
| `POST /products/:id/image/*` | 로그인 + `AdminGuard` | 그대로 | 이미 막혀 있다. 데모 관리자는 이제 여기서 403 |
| `PATCH`·`DELETE /categories/:id` | 로그인 | 로그인 + `AdminGuard` | 카탈로그를 바꾼다 |
| `GET /orders`, `/orders/totals`, `/orders/:id` | **없음** | 로그인 + `AdminGuard` | 모든 사용자의 주문(`asAdmin`)을 보여 준다 |
| `POST /orders` | 로그인 | 로그인 + `AdminGuard` | 아무 `user` 명의로 주문을 넣는다(`asAdmin`) |
| `GET /users` | **없음** | 로그인 + `AdminGuard` | 모든 사용자와 그 주문 |
| `POST /users` | **없음** | 로그인 + `AdminGuard` | 누구나 비밀번호 계정을 만든다. 데모에는 가입 화면이 없다 |

```diff
--- a/order-api-nest/src/categories/categories.controller.ts
+++ b/order-api-nest/src/categories/categories.controller.ts
@@
 import { MoveCategoryDto } from "./move-category.dto.js";
 import { CategoriesService } from "./categories.service.js";
+import { AdminGuard } from "../auth/admin.guard.js";
@@
   @Patch(":id")
-  @UseGuards(AuthGuard("jwt"))
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   move(@Param("id", ParseIntPipe) id: number, @Body() dto: MoveCategoryDto) {
@@
   @Delete(":id")
   @HttpCode(204)
-  @UseGuards(AuthGuard("jwt"))
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   async remove(@Param("id", ParseIntPipe) id: number) {
```

```diff
--- a/order-api-nest/src/orders/orders.controller.ts
+++ b/order-api-nest/src/orders/orders.controller.ts
@@
 import { CheckoutDto } from "./dto/checkout.dto.js";
+import { AdminGuard } from "../auth/admin.guard.js";
@@
   @Get()
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   list(@Query("paid") paid?: string) {
@@
   @Get("totals")
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   totals() {
@@
   @Get(":id")
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   findOne(@Param("id", ParseIntPipe) id: number) {
@@
   @Post()
-  @UseGuards(AuthGuard("jwt"))
+  @UseGuards(AuthGuard("jwt"), AdminGuard)
   create(@Body() dto: CreateOrderDto, @Req() req: Request) {
```

```diff
--- a/order-api-nest/src/users/users.controller.ts
+++ b/order-api-nest/src/users/users.controller.ts
@@
-import { Body, Controller, Get, Post } from "@nestjs/common";
+import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
+import { AuthGuard } from "@nestjs/passport";
+import { AdminGuard } from "../auth/admin.guard.js";
 import { CreateUserDto } from "./dto/create-user.dto.js";
 import { UsersService } from "./users.service.js";
 
 @Controller("users")
+@UseGuards(AuthGuard("jwt"), AdminGuard)
 export class UsersController {
```

`/orders/checkout`은 `@Get(":id")`보다 위에 `@Post`로 따로 있어서 영향이 없다. `scripts/order-burst.mjs`와 `notify-check.mjs`는 `kim`(시드의 `admin`)으로 `POST /orders`를 부르므로 그대로 돈다. `scripts/traffic.mjs`의 `/orders/1`은 이제 401을 받는다. 트래픽을 만드는 용도라 그대로 둔다.

카테고리 테스트의 `kim`을 관리자로 만든다.

```diff
--- a/order-api-nest/test/categories.e2e-spec.ts
+++ b/order-api-nest/test/categories.e2e-spec.ts
@@
   beforeEach(async () => {
     await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
-    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
+    await adminDb.user.create({ data: { id: "kim", name: "김", role: "admin", passwordHash: await hashPassword("pw-for-test") } });
```

표를 그대로 테스트로 남긴다. 다음에 API를 더할 때 이 목록에 한 줄을 더하는 것이 점검이다.

```ts
// order-api-nest/test/admin-only.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";

// 관리자 전용 API 목록. 새 API를 더할 때 여기에 한 줄 더하는 것이 점검이다
const ADMIN_ONLY = [
  ["GET", "/orders"], ["GET", "/orders/totals"], ["GET", "/orders/1"], ["POST", "/orders"],
  ["GET", "/users"], ["POST", "/users"],
  ["PATCH", "/categories/1"], ["DELETE", "/categories/1"],
  ["POST", "/products/1/image/upload-url"], ["POST", "/products/1/image/confirm"],
] as const;

describe("관리자 전용 API", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenOf: (role: string) => string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
    // Guard는 토큰의 역할만 본다. DB의 사용자 행 없이 토큰만 만들어 시험한다
    tokenOf = (role) => app.get(JwtService, { strict: false }).sign({ sub: `someone-${role}`, role });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: string, path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === "GET" ? undefined : "{}",
    });

  it.each(ADMIN_ONLY)("%s %s: 로그인 없이 401, 일반 사용자 403, 데모 관리자도 403", async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
    expect((await call(method, path, tokenOf("user"))).status).toBe(403);
    const demoAdmin = await call(method, path, tokenOf("demo_admin"));
    expect(demoAdmin.status).toBe(403);
    expect(((await demoAdmin.json()) as { message: string }).message).toBe("데모 관리자는 볼 수만 있습니다");
  });
});
```

- 토큰을 `JwtService.sign`으로 바로 만든다. Guard는 토큰의 역할만 보고, DB의 사용자 행은 보지 않기 때문이다.

- 본문 검증(`ValidationPipe`)보다 Guard가 먼저 돈다. 그래서 본문이 `{}`여도 400이 아니라 401·403이 온다.

데모 로그인 테스트의 관리자 기대값을 바꾼다.

```diff
--- a/order-api-nest/test/demo-login.e2e-spec.ts
+++ b/order-api-nest/test/demo-login.e2e-spec.ts
@@
-  it("관리자로 들어가면 시드의 kim이다", async () => {
+  it("관리자로 들어가면 임시 데모 관리자다", async () => {
     process.env.DEMO_LOGIN = "1";
-    expect(await roleOf(await demo("admin"))).toMatchObject({ sub: "kim", role: "admin" });
+    expect(await roleOf(await demo("admin"))).toMatchObject({ sub: expect.stringMatching(/^demo-/), role: "demo_admin" });
   });
```

```sh
npm run test:e2e
# 출력
 Test Files  12 passed (12)
      Tests  51 passed (51)
```

### 작업 5. [커밋] 화면: 데모 관리자에게 관리 화면을 열고, 쓰기 조작은 끈다

메뉴를 보여 줄지 정하는 훅의 이름도 뜻에 맞게 바꾼다. "관리자인가"가 아니라 "관리 화면을 볼 수 있나"다.

```diff
--- a/order-console-next/lib/use-profile.ts
+++ b/order-console-next/lib/use-profile.ts
@@
-export function useIsAdmin() {
+export function useCanSeeAdmin() {
   const loggedIn = useAuthStore((s) => s.accessToken !== null);
   const { data } = useProfile();
-  return loggedIn && data?.role === "admin";
+  // 메뉴를 보여 줄지만 정한다. 막는 것은 서버의 AdminGuard다
+  return loggedIn && (data?.role === "admin" || data?.role === "demo_admin");
 }
```

```diff
--- a/order-console-next/app/nav.tsx
+++ b/order-console-next/app/nav.tsx
@@
-import { useIsAdmin } from "@/lib/use-profile";
+import { useCanSeeAdmin } from "@/lib/use-profile";
@@
-  const isAdmin = useIsAdmin();
+  const canSeeAdmin = useCanSeeAdmin();
@@
-        {isAdmin && <NavLink href="/admin/products">관리</NavLink>}
+        {canSeeAdmin && <NavLink href="/admin/products">관리</NavLink>}
```

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
-function ProductTable() {
+function ProductTable({ readOnly }: { readOnly: boolean }) {
   const trpc = useTRPC();
@@
-            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} /></td>
+            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} readOnly={readOnly} /></td>
@@
   else if (error) body = <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
-  else if (profile.role !== "admin") body = <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
+  else if (profile.role !== "admin" && profile.role !== "demo_admin") body = <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
   else
     body = (
       <>
-        <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
-        <ProductTable />
+        {profile.role === "demo_admin" ? (
+          <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
+            데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기는 진짜 관리자만 할 수 있어 버튼을 꺼 두었습니다.
+          </p>
+        ) : (
+          <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
+        )}
+        <ProductTable readOnly={profile.role === "demo_admin"} />
       </>
     );
```

```diff
--- a/order-console-next/app/admin/products/product-image-uploader.tsx
+++ b/order-console-next/app/admin/products/product-image-uploader.tsx
@@
-export function ProductImageUploader({ productId, hasImage }: { productId: number; hasImage: boolean }) {
+export function ProductImageUploader({ productId, hasImage, readOnly }: { productId: number; hasImage: boolean; readOnly: boolean }) {
@@
-      <label className="btn focus-within:outline-2 focus-within:outline-fg">
+      <label className="btn focus-within:outline-2 focus-within:outline-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
@@
           data-testid={`image-input-${productId}`}
-          disabled={upload.isPending}
+          // 끄기만 하고 숨기지 않는다. 데모 관리자도 어떤 기능이 있는지 보게
+          disabled={readOnly || upload.isPending}
+          // 화면 낭독기가 꺼진 버튼에서 이유 문장도 읽게 잇는다
+          aria-describedby={readOnly ? "read-only-note" : undefined}
           onChange={(e) => {
```

로그인 화면의 안내도 지금 동작에 맞춘다.

```diff
--- a/order-console-next/app/login/page.tsx
+++ b/order-console-next/app/login/page.tsx
@@
-            <p className="text-[0.78rem] text-muted">비밀번호 없이 들어갑니다. 데모 데이터는 매일 초기화됩니다.</p>
+            <p className="text-[0.78rem] text-muted">누를 때마다 나만의 데모 계정을 새로 만듭니다. 비밀번호 없이 들어가고, 24시간 뒤 지워집니다.</p>
```

- 버튼을 숨기지 않고 끄는 이유: 데모 관리자는 "관리자는 이런 화면을 쓴다"를 보러 온 사람이다. 숨기면 무엇이 있는지 모르고, 끄고 이유를 적으면 기능과 제한을 함께 본다.

- `aria-describedby`가 끈 입력과 이유 문장을 잇는다. 화면 낭독기는 꺼진 버튼에 닿을 때 이유도 읽는다.

- `has-[:disabled]:`는 Tailwind의 `has-*` 변형이다. 안에 꺼진 요소가 있는 `label`에 스타일을 준다.

프론트 e2e에 데모 관리자 화면을 더한다. 상품 id에 기대지 않게 첫 입력을 본다(4장에서 상품 id가 바뀐다).

```diff
--- a/order-console-next/e2e/demo-login.spec.ts
+++ b/order-console-next/e2e/demo-login.spec.ts
@@
   await expect(page.getByRole("link", { name: "관리" })).toHaveCount(0);
 });
+
+test("데모 관리자는 관리 화면을 볼 수 있지만 사진 올리기는 꺼져 있고, 이유가 글자로 보인다", async ({ page }) => {
+  await page.goto("/login");
+  await page.getByRole("button", { name: "관리자로" }).click();
+  await expect(page).toHaveURL(/\/shop$/);
+  await page.getByRole("link", { name: "관리" }).click();
+  await expect(page.getByTestId("read-only-note")).toContainText("볼 수만 있습니다");
+  await expect(page.getByTestId(/^image-input-/).first()).toBeDisabled();
+});
```

```sh
npm run typecheck
npm run test:web
```

### 실험 | 화면에서만 막으면 curl로 뚫린다.

"데모 관리자도 관리 화면에 들어가야 하니 Guard를 넓히고, 쓰기는 화면에서 끄면 되겠다"고 생각했다고 하자.

```diff
--- a/order-api-nest/src/auth/admin.guard.ts
+++ b/order-api-nest/src/auth/admin.guard.ts
@@
-    // 판정은 그대로 "admin만 통과". 데모 관리자에게는 막는 이유를 따로 말한다
-    if (user?.role === "demo_admin") throw new ForbiddenException("데모 관리자는 볼 수만 있습니다");
-    if (user?.role !== "admin") throw new ForbiddenException("관리자만 할 수 있습니다");
+    if (user?.role !== "admin" && user?.role !== "demo_admin") throw new ForbiddenException("관리자만 할 수 있습니다");
```

API를 다시 띄운다. 브라우저에서 "관리자로" 들어가면 화면은 그대로다. 버튼은 꺼져 있고 이유도 보인다.

터미널에서 같은 사람인 척 API를 부른다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/demo -H 'Content-Type: application/json' -d '{"as":"admin"}' | jq -r .accessToken)
curl -s -X POST localhost:4000/products/1/image/upload-url \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentType":"image/png","size":70}' | jq

# 출력
{
  "key": "products/1/<uuid>.png",
  "uploadUrl": "http://localhost:9000/product-images/products/1/<uuid>.png?X-Amz-...",
  "expiresIn": 60
}
```

업로드 주소가 나왔다. 이 주소로 PUT하고 `/confirm`을 부르면 상품 사진이 바뀐다. 화면의 꺼진 버튼은 아무것도 막지 않았다.

`npm run test:e2e -- admin-only`도 데모 관리자 줄에서 모두 실패한다.

### 작업 6. [원복] Guard를 되돌린다

실험의 diff를 거꾸로(`-`와 `+`를 바꿔) 적용해 작업 2의 모양으로 돌린다. 작업 2~5를 커밋해 두었다면 파일 하나만 되돌려도 된다.

```sh
git diff order-api-nest/src/auth/admin.guard.ts      # 실험에서 바꾼 줄만 보이는지 먼저 본다
git restore order-api-nest/src/auth/admin.guard.ts
```

API를 다시 띄우면 같은 `curl`이 이제 403이다.

```sh
{
  "message": "데모 관리자는 볼 수만 있습니다",
  "error": "Forbidden",
  "statusCode": 403
}
```

- 작업 2를 아직 커밋하지 않았다면 `git restore`는 작업 2의 변경까지 지운다. `git diff`에 실험 밖의 줄이 보이면 손으로 되돌린다.

### 개념 | 막는 곳은 서버 하나, 보여 주는 곳은 여럿

| 층 | 하는 일 | 빠뜨리면 |
|---|---|---|
| 서버의 Guard | 막는다. 유일하게 믿는 곳 | 뚫린다(실험) |
| 화면의 비활성·숨김 | 무엇이 안 되는지 미리 알린다 | 눌렀을 때 403 메시지를 보게 된다. 불편하지만 안전하다 |
| 테스트(`admin-only`) | 표가 코드와 맞는지 매번 확인한다 | 다음에 더한 API에서 Guard를 빠뜨려도 모른다 |

- 화면과 서버가 같은 규칙을 따로 들고 있다(`profile.role === "demo_admin"`과 `AdminGuard`). 둘이 어긋나면 서버 쪽이 이긴다. 그래서 어긋나도 안전한 쪽은 "화면이 더 많이 허용하는" 경우뿐이다.

### 개념 | 데모 관리자에게 보여 주지 않는 것

데모 관리자는 "볼 수만 있는 관리자"다. 그런데 `GET /orders`와 `GET /users`는 볼 수만 있는 API인데도 데모 관리자에게 열지 않았다.

그 목록에는 다른 방문자의 임시 계정과, GitHub로 가입한 사람의 이름(`github-<id>`, 로그인 이름)과 주문이 들어 있다. 데모 관리자는 아무나 될 수 있으므로, 열면 "아무나 모든 사용자의 데이터를 본다"가 된다.

"읽기 전용"은 "무엇이든 읽어도 된다"가 아니다. 읽기에도 "누구의 데이터인가"가 붙는다.

### 개념 | 역할은 토큰에 실려 있다

`issueTokens`가 발급할 때 DB에서 역할을 읽어 access token에 넣는다. Guard는 DB가 아니라 토큰의 역할을 본다.

그래서 DB에서 역할을 바꿔도 이미 받은 access token은 그대로다. 다음 refresh(최대 15분 뒤)에 새 역할이 실린다. 바로 바뀌게 하려면 그 사람이 로그아웃했다가 다시 로그인한다.

권한을 빼앗을 때도 같다. 진짜 관리자를 `user`로 내려도 최대 15분은 관리자 토큰이 산다. 급하면 그 사람의 refresh 토큰을 DB에서 회수해(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = '…'`) 다음 refresh를 막는다.

### 개념 | 진짜 관리자는 어디서 정하나

진짜 관리자는 화면이나 API로 될 수 없다. 서버의 DB에서 SQL 한 줄로 정한다.

```sql
UPDATE users SET role = 'admin' WHERE github_id = '<GitHub 숫자 id>';
```

- 먼저 GitHub로 한 번 로그인해 사용자 행(`github-<id>`)을 만든 뒤에 올린다. GitHub 숫자 id는 `https://api.github.com/users/<로그인 이름>`의 `id`다.

- 이 SQL은 DB에 직접 닿을 수 있는 사람(서버에 SSH할 수 있는 사람)만 칠 수 있다. 권한을 주는 길을 앱 밖에 두면, 앱에 구멍이 있어도 스스로 관리자가 되는 길은 없다.

- 지금 운영의 매일 초기화는 `users`를 TRUNCATE하므로 올린 역할이 다음 날 사라진다. 실제로 올리는 것은 초기화가 GitHub 사용자를 남기게 바꾼 뒤(4장 작업 8)에 한다.

### 남길 것

- **찾아보면 되는 것**: `ALTER TYPE … ADD VALUE`, Nest의 `@UseGuards` 순서, `it.each`, Tailwind `has-[…]:` 변형, `aria-describedby`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 권한은 서버에서만 막는다. 화면의 숨김·비활성은 안내다. 실험에서 꺼진 버튼 뒤의 API는 `curl` 한 줄로 열렸다.
  - Guard는 "화면이 부르는 API"가 아니라 "그 API가 무엇을 바꾸거나 누구의 데이터를 보여 주는가"로 정한다. 지금 코드에서 Guard가 없던 `GET /orders`·`/users`가 그 예다.
  - 읽기 전용 역할에도 "누구의 데이터인가"가 붙는다. 아무나 될 수 있는 역할에는 남의 데이터를 열지 않는다.
  - 역할은 토큰에 실린다. DB를 바꿔도 다음 발급까지는 옛 역할이다.

- **에러 신호**:
  - `invalid input value for enum "Role": "demo_admin"` → 그 DB에 `0019`를 적용하지 않았다
  - `This comparison appears to be unintentional because the types '"admin"' and '"demo_admin"' have no overlap.` → 스키마를 바꾼 뒤 `npx prisma generate`를 하지 않아 프론트가 옛 `Role` 타입을 본다
  - 데모 관리자의 403 메시지가 `관리자만 할 수 있습니다` → `JwtStrategy.validate`가 `demo_admin`을 `user`로 접고 있다
  - 데모 관리자로 들어왔는데 "관리" 메뉴가 없다 → 메뉴가 아직 `role === "admin"`만 본다(`useCanSeeAdmin`)
  - 카테고리 e2e가 403 → 테스트의 `kim`에 `role: "admin"`이 없다
  - 데모 관리자의 `curl`이 업로드 주소를 받는다 → `AdminGuard`가 `demo_admin`을 통과시킨다(실험 상태)
  - DB에서 역할을 올렸는데 관리 화면이 여전히 막힌다 → 토큰의 역할은 다음 refresh에 바뀐다. 다시 로그인한다

## 3. 3단계: 요청 수 제한

1장 뒤로 데모 버튼은 누를 때마다 DB에 사용자 행과 주문을 만든다. 한 IP가 이것을 끝없이 누르지 못하게 한다.

### 작업 1. [커밋] 거절한 요청을 세는 지표

```diff
--- a/order-api-nest/src/metrics/metrics.ts
+++ b/order-api-nest/src/metrics/metrics.ts
@@
 export const webhookEvents = new Counter({
   name: "stripe_webhook_events_total",
   help: "처리한 Stripe 웹훅 이벤트 수",
   labelNames: ["type", "result"] as const,
   registers: [registry],
 });
 
+export const rateLimited = new Counter({
+  name: "http_rate_limited_total",
+  help: "요청 수 제한으로 거절한 요청 수",
+  labelNames: ["bucket"] as const,
+  registers: [registry],
+});
+
 function routeOf(req: Request): string {
```

### 작업 2. [커밋] 요청 수 제한 미들웨어

```ts
// order-api-nest/src/rate-limit/rate-limit.middleware.ts
import { Injectable, Logger, NestMiddleware, OnModuleDestroy } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";
import { rateLimited } from "../metrics/metrics.js";

const WINDOW_SECONDS = 60;
// 로그인 계열: 비밀번호 대입과 데모 계정 대량 생성을 막으려고 따로 더 낮게 센다. /auth/github는 Next 서버가 부르므로 넣지 않는다
const AUTH_PATHS = new Set(["/auth/login", "/auth/demo", "/auth/exchange", "/auth/refresh"]);
// 세지 않는 경로: 헬스 체크·지표 수집·결제사 웹훅처럼 사람이 아닌 서버가 정기적으로 부르는 것
const SKIP_PREFIXES = ["/health", "/metrics", "/payments/webhook"];

// 값이 없거나 0이면 그 제한은 꺼진다(로컬·테스트 기본값)
const limitOf = (name: string) => Number(process.env[name] ?? 0) || 0;

@Injectable()
// 카운터용 Redis 연결. 미들웨어에는 종료 훅이 없으므로 provider로 두고 onModuleDestroy에서 닫는다
export class RateLimitStore implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor() {
    this.redis.on("error", () => {});
  }

  async hit(key: string, ttlSeconds: number): Promise<number> {
    // INCR과 EXPIRE를 한 번에. NX: 첫 요청에서만 만료를 건다 → 창이 끝나면 키가 저절로 사라진다
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
    return Number(results?.[0]?.[1] ?? 0);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly general = limitOf("RATE_LIMIT_PER_MINUTE");
  private readonly auth = limitOf("AUTH_RATE_LIMIT_PER_MINUTE");

  constructor(private readonly store: RateLimitStore) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split("?")[0];
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return next();
    const isAuth = req.method === "POST" && AUTH_PATHS.has(path);
    const bucket = isAuth ? "auth" : "all";
    const limit = isAuth ? this.auth : this.general;
    if (limit <= 0) return next();

    // 고정 창: 시계를 1분 칸으로 자른 칸 번호. req.ip는 TRUST_PROXY에 따라 접속 주소 또는 X-Forwarded-For의 주소
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rate:${bucket}:${req.ip}:${window}`;
    let count: number;
    try {
      count = await this.store.hit(key, WINDOW_SECONDS);
    } catch (err) {
      // Redis 장애 때는 막지 않고 통과(fail open). 장애는 /health/ready가 드러낸다
      this.logger.warn(`요청 수를 세지 못해 통과시킨다: ${(err as Error).message}`);
      return next();
    }

    const retryAfter = (window + 1) * WINDOW_SECONDS - Math.floor(Date.now() / 1000);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", Math.max(0, limit - count));
    if (count <= limit) return next();

    // 거절 수를 지표로 남긴다(http_rate_limited_total)
    rateLimited.inc({ bucket });
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ statusCode: 429, message: `요청이 너무 많습니다. ${retryAfter}초 뒤에 다시 시도하세요` });
  }
}
```

```ts
// order-api-nest/src/rate-limit/rate-limit.module.ts
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RateLimitMiddleware, RateLimitStore } from "./rate-limit.middleware.js";

@Module({ providers: [RateLimitStore] })
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 모든 경로에 건다. 건너뛸 경로는 미들웨어 안에서 가른다
    consumer.apply(RateLimitMiddleware).forRoutes("*");
  }
}
```

- 한도 값이 없거나 0이면 그 제한은 꺼진다. 로컬 개발과 기존 테스트는 그대로 두고, 운영 compose에서 켠다(작업 6).

- 카운터를 다루는 Redis 연결은 미들웨어와 따로 provider(`RateLimitStore`)로 둔다. 미들웨어에는 종료 훅이 돌지 않으므로, 앱이 끝날 때 연결을 닫으려면 provider여야 한다(`onModuleDestroy`).

- `/auth/github`는 `AUTH_PATHS`에 넣지 않는다. 브라우저가 아니라 Next 서버가 부르는 요청이다(작업 4).

### 작업 3. [커밋] 앱에 붙이고, 믿을 프록시를 정한다

```diff
--- a/order-api-nest/src/app.module.ts
+++ b/order-api-nest/src/app.module.ts
@@
 import { MetricsModule } from './metrics/metrics.module.js';
+import { RateLimitModule } from './rate-limit/rate-limit.module.js';
@@
   imports: [
     LoggerModule.forRoot(loggerOptions),
-    MetricsModule, PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule],
+    MetricsModule, RateLimitModule, PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule],
```

```diff
--- a/order-api-nest/src/main.ts
+++ b/order-api-nest/src/main.ts
@@
 import { HttpAdapterHost, NestFactory } from '@nestjs/core';
+import type { NestExpressApplication } from '@nestjs/platform-express';
 import { AppModule } from './app.module.js';
@@
-  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
+  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
+  // 믿을 프록시를 정해야 X-Forwarded-For의 원래 주소가 req.ip가 된다. 없으면 헤더를 믿지 않는다
+  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map((s) => s.trim()));
   app.useLogger(app.get(Logger));
```

- `RateLimitModule`을 `MetricsModule` 바로 뒤에 둔다. 모듈의 미들웨어는 import 순서대로 걸리므로, 429로 돌려보낸 요청도 처리 시간 지표에 남는다.

- `TRUST_PROXY`가 없으면 `X-Forwarded-For`를 믿지 않는다. `req.ip`는 접속한 주소다(아래 실험).

### 작업 4. [커밋] Next 서버가 대신 부르는 요청에 사용자 주소를 넘긴다

지금 코드에서 브라우저가 아니라 웹 컨테이너가 API를 부르는 곳은 GitHub 로그인의 `jwt` 콜백(`/auth/github`) 하나다. 그대로면 모든 사람의 GitHub 로그인이 웹 컨테이너 IP 하나로 세어진다.

```diff
--- a/order-console-next/auth.ts
+++ b/order-console-next/auth.ts
@@
 import NextAuth from "next-auth";
 import GitHub from "next-auth/providers/github";
+import { headers } from "next/headers";
@@
       if (account?.provider === "github" && account.access_token) {
+        // Caddy가 붙인 방문자 주소. 그대로 넘기지 않으면 모든 GitHub 로그인이 웹 컨테이너 주소 하나로 세어진다
+        const forwardedFor = (await headers()).get("x-forwarded-for");
         const res = await fetch(`${API_URL}/auth/github`, {
           method: "POST",
-          headers: { "Content-Type": "application/json" },
+          headers: { "Content-Type": "application/json", ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}) },
           body: JSON.stringify({ accessToken: account.access_token }),
         });
```

- Caddy가 웹 컨테이너로 넘길 때 `X-Forwarded-For`에 방문자 주소를 붙인다. 웹 서버는 그 값을 그대로 API에 넘기고, API는 웹 컨테이너를 믿는 프록시로 보고 그 안의 주소로 센다(작업 6의 `TRUST_PROXY`).

- `jwt` 콜백은 GitHub에서 돌아오는 요청(`/api/auth/callback/github`)을 처리하는 중에 돈다. 그래서 `headers()`가 그 요청의 헤더를 준다.

### 작업 5. [커밋] 테스트

```ts
// order-api-nest/test/rate-limit.e2e-spec.ts
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { Redis } from "ioredis";
import { io } from "socket.io-client";
import { AppModule } from "../src/app.module.js";

describe("요청 수 제한", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  const redis = new Redis(process.env.REDIS_URL!);
  const before = { all: process.env.RATE_LIMIT_PER_MINUTE, auth: process.env.AUTH_RATE_LIMIT_PER_MINUTE };

  beforeAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "5";
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = "2";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.use(cookieParser());
    // 테스트는 같은 PC에서 보내므로 loopback을 믿고, X-Forwarded-For를 바꿔 가며 다른 방문자처럼 보낸다
    app.set("trust proxy", "loopback");
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    const keys = await redis.keys("rate:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = before.all;
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = before.auth;
    await app.close();
    await redis.quit();
  });

  const get = (path: string, ip: string) => fetch(`${baseUrl}${path}`, { headers: { "X-Forwarded-For": ip } });
  const login = (ip: string) =>
    fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ id: "nobody", password: "wrong" }),
    });

  it("한도를 넘은 요청은 429와 Retry-After를 받고, 다른 IP는 영향받지 않는다", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await get("/products", "203.0.113.1")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);

    const blocked = await get("/products", "203.0.113.1");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await blocked.json()) as { message: string }).message).toMatch(/요청이 너무 많습니다/);

    expect((await get("/products", "203.0.113.2")).status).toBe(200);
  });

  it("로그인 계열은 더 낮은 한도를 따로 센다", async () => {
    const statuses = [(await login("198.51.100.7")).status, (await login("198.51.100.7")).status, (await login("198.51.100.7")).status];
    expect(statuses).toEqual([401, 401, 429]);
    expect((await get("/products", "198.51.100.7")).status).toBe(200);
  });

  it("헬스 체크와 결제사 웹훅은 세지 않는다", async () => {
    for (let i = 0; i < 8; i++) expect((await get("/health", "192.0.2.9")).status).toBe(200);
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.11" }, body: "{}",
      });
      expect(res.status).not.toBe(429);
    }
  });

  it("WebSocket 연결은 세지 않는다 — 한도 5에서 8번 붙어도 HTTP 한도는 그대로다", async () => {
    // WebSocket은 socket.io가 Express보다 먼저 받으므로 요청 수 제한을 거치지 않는다
    const token = app.get(JwtService, { strict: false }).sign({ sub: "kim" });
    for (let i = 0; i < 8; i++) {
      const socket = io(baseUrl, { transports: ["websocket"], auth: { token }, extraHeaders: { "X-Forwarded-For": "192.0.2.12" }, reconnection: false, forceNew: true });
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      socket.close();
    }
    expect(await redis.keys("rate:*:192.0.2.12:*")).toEqual([]);
    expect((await get("/products", "192.0.2.12")).headers.get("ratelimit-remaining")).toBe("4");
  });
});
```

```sh
cd order-api-nest
npm run test:e2e -- rate-limit
```

- 테스트는 `trust proxy`를 `loopback`으로 둔다. 테스트가 같은 PC에서 보내므로, `X-Forwarded-For`를 바꿔 가며 서로 다른 방문자처럼 보낼 수 있다. 앞의 IP들은 문서용으로 정해 둔 주소 범위(`203.0.113.0/24` 등)다.

- 한도 환경 변수는 앱을 만들기 전에 바꾼다. 미들웨어가 만들어질 때 한 번 읽는다.

- WebSocket은 socket.io가 Express보다 먼저 받으므로 이 미들웨어를 거치지 않는다. 토큰이 없으면 게이트웨이가 연결을 끊는다(`NotificationsGateway.handleConnection`).

### 작업 6. [커밋] 운영에서 켠다

```diff
--- a/deploy/compose.yml
+++ b/deploy/compose.yml
@@
   api:
@@
     environment:
       PORT: "4000"
       JWT_SECRET: ${JWT_SECRET:?}
       DEMO_LOGIN: ${DEMO_LOGIN:-0}
+      # IP마다 1분 한도. 로그인 계열은 아래 값으로 따로 센다
+      RATE_LIMIT_PER_MINUTE: "300"
+      AUTH_RATE_LIMIT_PER_MINUTE: "20"
+      # 사설망(Compose 네트워크)의 Caddy·웹 컨테이너만 믿는다
+      TRUST_PROXY: uniquelocal
       FRONTEND_URL: https://${WEB_HOST}
```

- `uniquelocal`은 사설 주소(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`)다. Compose 네트워크 안의 Caddy와 웹 컨테이너가 여기에 든다.

- 운영의 API 컨테이너는 포트를 밖으로 열지 않는다(`ports`가 없다). 밖에서 오는 요청은 모두 Caddy를 거친다. Caddy는 믿지 않는 곳에서 온 `X-Forwarded-For`를 버리고 접속한 주소로 새로 쓴다.

- 1분에 300건은 사람이 상점을 빠르게 넘겨 봐도 닿지 않는 수다. 로그인 계열 20건은 데모 버튼을 1분에 20번까지 누른다는 뜻이고, 한 IP가 하루에 만들 수 있는 임시 사용자는 많아야 28,800명이다.

### 실험 | 프록시를 넓게 믿으면 `X-Forwarded-For`로 한도를 피한다.

로컬에서 한도를 낮게 두고 API를 띄운다. 쉘의 환경 변수가 `.env`보다 먼저다.

```sh
cd order-api-nest
RATE_LIMIT_PER_MINUTE=5 npm run start:dev
```

다른 터미널에서 주소를 바꿔 가며 8번 부른다.

```sh
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " -H "X-Forwarded-For: 203.0.113.$i" localhost:4000/products; done; echo

200 200 200 200 200 429 429 429
```

`TRUST_PROXY`가 없으니 헤더를 믿지 않고 접속한 주소(이 PC) 하나로 센다. API를 끄고, 모든 주소를 믿게 해서 다시 띄운 뒤 같은 `for`를 다시 보낸다.

```sh
RATE_LIMIT_PER_MINUTE=5 TRUST_PROXY=0.0.0.0/0,::/0 npm run start:dev

200 200 200 200 200 200 200 200
```

요청마다 다른 사람처럼 세어져 한도에 닿지 않는다. 헤더는 보내는 쪽이 아무렇게나 적을 수 있다.

### 작업 7. [원복] 원래대로 띄운다

API를 끄고 `TRUST_PROXY` 없이 다시 띄운다(`npm run start:dev`). 커밋할 것은 없다. 로컬의 `.env`에는 한도도 `TRUST_PROXY`도 없으므로 제한은 꺼진 채다.

### 개념 | 누구의 주소로 세는가: `X-Forwarded-For`를 믿는 범위

| `TRUST_PROXY` | `req.ip` | 결과 |
|---|---|---|
| 없음 | 접속한 주소 | 운영에서는 모든 방문자가 Caddy 주소 하나로 세어진다. 300건을 모두가 나눠 쓴다 |
| `uniquelocal` (운영) | 사설망의 프록시를 건너뛴 첫 주소 = Caddy가 적은 방문자 주소 | 방문자마다 센다 |
| `0.0.0.0/0,::/0` (실험) | 헤더의 맨 왼쪽 주소 | 보내는 쪽이 정한다. 제한이 없는 것과 같다 |

- Express는 `X-Forwarded-For`를 오른쪽(가장 최근에 붙인 쪽)부터 읽으며, 믿는 프록시의 주소이면 하나씩 건너뛴다. 처음 만난 믿지 않는 주소가 `req.ip`다.

- 믿어도 되는 것은 "내가 띄운 프록시가 직접 붙인 값"뿐이다. 그래서 믿는 범위는 내 프록시가 있는 곳(Compose 네트워크)으로 좁힌다.

### 개념 | 고정 창과 그 경계

시계를 1분 칸으로 자르고(`Math.floor(Date.now() / 1000 / 60)`), 칸 번호를 키에 넣어 센다(`rate:all:<IP>:<칸 번호>`). 칸이 끝나면 키가 저절로 사라진다(`EXPIRE … NX`).

- `INCR`과 `EXPIRE`를 `MULTI`로 한 번에 보낸다. 따로 보내다 그 사이에 연결이 끊기면 만료 없는 키가 남아 그 IP가 영영 막힐 수 있다. `NX`는 첫 요청에서만 만료를 건다.

- 카운터를 Redis에 두므로 API를 여러 대 띄워도 한 IP를 같이 센다.

- 고정 창은 경계에서 두 배까지 통과한다. 0:59에 300건, 1:00에 300건을 보내면 2초 동안 600건이다. 데모의 남용 방지에는 충분하다. 더 고르게 하려면 미끄러지는 창이나 토큰 버킷을 쓴다.

### 개념 | Redis가 죽으면 막지 않는다(fail open)

`hit`이 실패하면 경고를 남기고 통과시킨다. 요청 수 제한은 남용을 줄이는 장치이지 서비스의 핵심이 아니다. 이것 때문에 서비스 전체가 멈추면 손해가 더 크다.

Redis가 죽은 것은 `/health/ready`가 503으로 드러낸다(`07`).

### 개념 | 세지 않는 경로, 그리고 지금 없는 경로

| 경로 | 세지 않는 이유 |
|---|---|
| `/health` | 컨테이너 헬스 체크가 10초마다 부른다 |
| `/metrics` | 지표 수집이 정해진 간격으로 부른다 |
| `/payments/webhook` | Stripe의 서버들이 같은 IP로 몰아 보낼 수 있다. 서명으로 이미 검증한다 |

- 지금 코드에는 이 셋만 있다. 사진을 API가 직접 내보내는 경로(`/media/...`)나 다른 결제사의 웹훅처럼, 나중 단계에서 "사용자가 아닌 서버가 몰아 부르는 경로"가 생기면 그때 이 목록과 테스트에 더한다.

- 앞으로 Next 서버가 API를 대신 부르는 곳(서버 렌더링, Server Action)이 생기면 작업 4처럼 `X-Forwarded-For`를 넘긴다. 넘기지 않으면 그 요청은 모두 웹 컨테이너 주소 하나로 세어진다.

### 남길 것

- **찾아보면 되는 것**: Express `trust proxy` 값의 형식(`loopback`, `uniquelocal`, CIDR), Redis `MULTI`·`INCR`·`EXPIRE NX`, `RateLimit-*`·`Retry-After` 헤더. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 요청을 보낸 사람이 적을 수 있는 값(`X-Forwarded-For`)은 내 프록시가 적은 경우에만 믿는다. 믿는 범위를 넓히면 실험처럼 제한이 사라진다.
  - "누가 이 요청을 보내는가"를 경로마다 본다. 브라우저가 아니라 서버가 대신 부르면 그 서버의 주소 하나로 세어진다.
  - 남용 방지 장치는 고장 나면 열어 둔다(fail open). 장애는 헬스 체크가 드러낸다.

- **에러 신호**:
  - 운영에서 방문자 모두가 함께 429를 받는다 → `TRUST_PROXY`가 없어 모두 Caddy 주소로 세어진다
  - 한도를 넘겨도 429가 안 난다 → 한도 환경 변수가 없거나 0이다. 또는 `TRUST_PROXY`가 너무 넓다
  - 로그에 `요청 수를 세지 못해 통과시킨다` → Redis에 닿지 않는다. `/health/ready`
  - GitHub 로그인만 모두 함께 429 → `auth.ts`가 `X-Forwarded-For`를 넘기지 않는다
  - 컨테이너가 unhealthy가 되고 `/health`가 429 → `SKIP_PREFIXES`에서 `/health`가 빠졌다

## 4. 4단계: 데모 카탈로그 고정과 초기화 범위

지금 시드는 상품 4개를 사진·설명 없이 만든다. 매일 초기화가 `products`를 TRUNCATE하고 다시 만들기 때문에, 관리자가 올린 사진은 다음 날 어느 상품도 가리키지 않아 `06`의 고아 이미지 정리가 지운다.

초기화 시점의 상품을 저장소의 파일로 고정한다. 사진도 저장소에 두고, 시드가 고정 키로 올린다.

### 작업 1. [커밋] 카탈로그 파일과 사진

사진은 `order-api-nest/prisma/seed/photos/`에 둔다. 상품마다 한 장, 긴 변 800px의 webp로 줄여 100KB 안팎이다. 직접 찍었거나, 출처가 CC0(저작권 포기)인 것만 쓴다.

```sh
# 원본에서 webp로(ImageMagick·cwebp). 파일마다 한 번
magick 원본.jpg -auto-orient -resize '800x800>' -strip /tmp/p.png
cwebp -quiet -size 100000 -pass 6 /tmp/p.png -o order-api-nest/prisma/seed/photos/<파일 이름>.webp
```

```text
order-api-nest/prisma/seed/
  catalog.json
  README.md
  photos/
    maker-card.webp  maker-photo-1.webp  maker-photo-2.webp  maker-photo-3.webp
    keyboard-limited.webp  mouse.webp  headphones.webp  kettle.webp
    keycaps.webp  usb-hub.webp  webcam.webp  trackball.webp
    headphones-wired.webp  radio.webp  moka-pot.webp  mug.webp
```

만든 사람의 사진 넷(`maker-*.webp`)은 저장소에 넣지 않는다. 명함에는 연락처가, 증명사진에는 얼굴이 있다. 공개 저장소에 한 번 커밋하면 파일을 지워도 git 기록에 남는다.

```diff
--- a/order-api-nest/.gitignore
+++ b/order-api-nest/.gitignore
@@
 /src/generated/prisma
+
+# 만든 사람의 사진: 공개 저장소에 남기지 않는다. 운영 S3에는 deploy/aws/62-seed-private-photos.sh로 올린다
+/prisma/seed/photos/maker-*
```

```sh
git check-ignore -v order-api-nest/prisma/seed/photos/maker-card.webp   # 걸리는 규칙이 찍혀야 한다
git status --short order-api-nest/prisma/seed/photos                     # maker-*가 보이지 않아야 한다
```

파일은 이 PC의 그 자리에 그대로 둔다. 로컬 시드는 이 파일을 읽어 로컬 저장소(RustFS)에 올린다. 운영에는 이 PC에서 S3로 한 번 올린다(작업 5).

```json
// order-api-nest/prisma/seed/catalog.json
{
  "categories": [
    { "id": 1, "name": "전자기기", "parentId": null },
    { "id": 2, "name": "컴퓨터", "parentId": 1 },
    { "id": 3, "name": "키보드", "parentId": 2 },
    { "id": 4, "name": "마우스", "parentId": 2 },
    { "id": 5, "name": "음향", "parentId": 1 },
    { "id": 6, "name": "헤드폰", "parentId": 5 },
    { "id": 7, "name": "생활", "parentId": null },
    { "id": 8, "name": "주방", "parentId": 7 },
    { "id": 9, "name": "만든 사람", "parentId": null }
  ],
  "products": [
    { "id": 1, "name": "네임 카드", "price": 1000, "stock": 100, "category": "만든 사람", "photo": "maker-card.webp" },
    { "id": 2, "name": "증명사진 20대", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-1.webp" },
    { "id": 3, "name": "증명사진 20대 중후반", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-2.webp" },
    { "id": 4, "name": "증명사진 30대 초", "price": 5000, "stock": 10, "category": "만든 사람", "photo": "maker-photo-3.webp" },
    { "id": 5, "name": "한정판 키보드", "price": 150000, "stock": 10, "category": "키보드", "photo": "keyboard-limited.webp" },
    { "id": 6, "name": "마우스", "price": 30000, "stock": 100, "category": "마우스", "photo": "mouse.webp" },
    { "id": 7, "name": "무선 헤드폰", "price": 90000, "stock": 30, "category": "헤드폰", "photo": "headphones.webp" },
    { "id": 8, "name": "전기 주전자", "price": 40000, "stock": 20, "category": "주방", "photo": "kettle.webp" },
    { "id": 9, "name": "키캡 세트", "price": 45000, "stock": 40, "category": "키보드", "photo": "keycaps.webp" },
    { "id": 10, "name": "USB 허브", "price": 25000, "stock": 50, "category": "컴퓨터", "photo": "usb-hub.webp" },
    { "id": 11, "name": "웹캠", "price": 60000, "stock": 25, "category": "컴퓨터", "photo": "webcam.webp" },
    { "id": 12, "name": "트랙볼", "price": 55000, "stock": 15, "category": "마우스", "photo": "trackball.webp" },
    { "id": 13, "name": "유선 헤드폰", "price": 35000, "stock": 40, "category": "헤드폰", "photo": "headphones-wired.webp" },
    { "id": 14, "name": "휴대용 라디오", "price": 28000, "stock": 20, "category": "음향", "photo": "radio.webp" },
    { "id": 15, "name": "모카포트", "price": 32000, "stock": 30, "category": "주방", "photo": "moka-pot.webp" },
    { "id": 16, "name": "머그컵", "price": 12000, "stock": 60, "category": "주방", "photo": "mug.webp" }
  ]
}
```

JSON에는 주석을 쓸 수 없다. 첫 줄의 경로 주석은 빼고 저장한다.

- 상품마다 `id`를 적는다. 초기화는 `id`로 "같은 상품"을 찾아 값을 덮어쓴다. 이름을 바꿔도 같은 상품이다.

- 원래의 네 상품(한정판 키보드, 마우스, 무선 헤드폰, 전기 주전자)은 이름·가격·재고를 그대로 두었다. 프론트 e2e가 이 이름과 값에 기댄다.

- 새 상품 이름에는 "마우스"와 "한정판 키보드"가 들어가지 않게 했다. e2e가 `getByRole("listitem").filter({ hasText: "마우스" })`로 찾으므로, 두 항목이 걸리면 어느 것을 누를지 몰라 실패한다. "트랙볼"이 "무선 마우스"가 아닌 이유다.

- 카테고리 `마우스` 안에 "트랙볼"이 있어도 괜찮다. 상점 목록은 카테고리 이름을 그리지 않는다.

- 저장소에서 빼도 데모 화면에는 보인다. 상점은 상품 사진을 누구나 볼 수 있는 주소로 내보낸다. 저장소에서 빼는 것이 막는 것은 "git 기록에 영원히 남는 것"과 "저장소를 받은 누구나 원본 파일을 갖는 것"이다.

- 데모에서도 보이면 안 되는 것(예: 명함의 연락처)이 있으면 사진 자체에서 가린다.

### 작업 2. [커밋] 저장소에 "없을 때만 올리기"

시드가 쓰도록 `StorageService`에 두 메서드를 더한다. 버킷을 만드는 부분은 `onModuleInit`에서 꺼낸다.

```diff
--- a/order-api-nest/src/storage/storage.service.ts
+++ b/order-api-nest/src/storage/storage.service.ts
@@
   async onModuleInit() {
-    try {
-      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
-    } catch {
-      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
-      this.logger.log(`버킷 생성: ${this.bucket}`);
-    }
+    await this.ensureBucket();
     await this.s3.send(new PutBucketCorsCommand({
@@
     }));
   }
 
+  // 시드가 API보다 먼저 돌 수 있으므로(CI) 버킷 만들기를 따로 꺼낸다
+  async ensureBucket(): Promise<void> {
+    try {
+      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
+    } catch {
+      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
+      this.logger.log(`버킷 생성: ${this.bucket}`);
+    }
+  }
+
+  // 고정 키 파일: 같은 크기로 이미 있으면 올리지 않는다. 지워졌거나 바뀌었으면 다시 올린다
+  async putIfAbsent(key: string, body: Buffer, contentType: string): Promise<boolean> {
+    if ((await this.head(key))?.size === body.length) return false;
+    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
+    return true;
+  }
+
   createUploadUrl(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
```

- CI의 프론트 e2e는 API를 띄우기 전에 시드를 돈다. 그때는 버킷이 아직 없으므로 시드가 `ensureBucket`을 먼저 부른다.

- "이미 있다"를 크기까지 보고 판단한다. 같은 이름으로 다른 사진을 넣었거나, 누가 그 키를 지웠으면 다시 올린다. 크기가 같은 다른 사진은 못 알아본다. 그래서 사진을 바꿀 때는 파일 이름을 바꾸는 규칙을 둔다(`seed/README.md`).

`scripts/list-objects.mjs`가 다른 접두사도 보게 한다.

```diff
--- a/order-api-nest/scripts/list-objects.mjs
+++ b/order-api-nest/scripts/list-objects.mjs
@@
-const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: "products/" }));
+const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: process.argv[2] ?? "products/" }));
```

### 작업 3. [커밋] 시드: TRUNCATE 대신 파일 값으로 되돌린다

`order-api-nest/prisma/seed.ts`를 고친다. 가져오기와 DB 연결은 남고, 그 아래 본문(TRUNCATE와 `createMany`들)은 모두 새 본문으로 바뀐다.

```diff
--- a/order-api-nest/prisma/seed.ts
+++ b/order-api-nest/prisma/seed.ts
@@
+import { readFile } from "node:fs/promises";
 import { PrismaPg } from "@prisma/adapter-pg";
 import { PrismaClient } from "../src/generated/prisma/client.js";
 import { hashPassword } from "../src/auth/password.js";
+import { deleteUsers } from "../src/auth/demo-user.js";
+import { StorageService } from "../src/storage/storage.service.js";
+
+type Catalog = {
+  categories: { id: number; name: string; parentId: number | null }[];
+  products: { id: number; name: string; price: number; stock: number; category: string; photo: string }[];
+};
 
 const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL! }) });
+const storage = new StorageService();
+// 이 파일 기준의 prisma/seed/ 폴더. 실행 위치와 상관없이 같은 곳을 가리킨다
+const dir = new URL("./seed/", import.meta.url);
+const catalog = JSON.parse(await readFile(new URL("catalog.json", dir), "utf8")) as Catalog;
 
-await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
-
-const users = [
-  { id: "kim", name: "김", role: "admin" as const },
-  { id: "lee", name: "이" },
-  { id: "park", name: "박" },
-  { id: "choi", name: "최" },
-];
-
-const tree: [string, number | null][] = [
-  ["전자기기", null], ["컴퓨터", 1], ["키보드", 2], ["마우스", 2], ["음향", 1], ["헤드폰", 5], ["생활", null], ["주방", 7],
-];
-for (const [name, parentId] of tree) await prisma.category.create({ data: { name, parentId } });
-
-await prisma.user.createMany({
-  data: await Promise.all(users.map(async (u) => ({ ...u, passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) }))),
-});
-
-await prisma.order.createMany({
-  data: [
-    { userId: "kim", price: 12000, paid: true },
-    { userId: "lee", price: 8000, paid: false },
-    { userId: "kim", price: 5000, paid: true },
-    { userId: "lee", price: 30000, paid: true },
-    { userId: "park", price: 7000, paid: true },
-  ],
-});
-
-await prisma.product.createMany({
-  data: [
-    { name: "한정판 키보드", price: 150000, stock: 10, categoryId: 3 },
-    { name: "마우스", price: 30000, stock: 100, categoryId: 4 },
-    { name: "무선 헤드폰", price: 90000, stock: 30, categoryId: 6 },
-    { name: "전기 주전자", price: 40000, stock: 20, categoryId: 8 },
-  ],
-});
-
-console.log("seed 완료: 사용자", await prisma.user.count(), "명, 주문", await prisma.order.count(), "건, 상품", await prisma.product.count(), "개");
+// 1. 임시 사용자
+const temp = await prisma.user.findMany({ where: { expiresAt: { not: null } }, select: { id: true } });
+const deletedTemp = await prisma.$transaction((tx) => deleteUsers(tx, temp.map((u) => u.id)));
+
+// 2. 사진
+await storage.ensureBucket();
+let uploaded = 0;
+const noPhoto = new Set<string>();
+for (const p of catalog.products) {
+  // 고정 키. 매번 같으므로 초기화가 몇 번 돌아도 같은 파일을 가리킨다(고아 정리는 products/만 본다)
+  const key = `seed/${p.photo}`;
+  const body = await readFile(new URL(`photos/${p.photo}`, dir)).catch((err: NodeJS.ErrnoException) => {
+    if (err.code === "ENOENT") return null;
+    throw err;
+  });
+  if (body) {
+    if (await storage.putIfAbsent(key, body, "image/webp")) uploaded++;
+  // 파일이 저장소에 없는 사진(maker-*)은 S3에 미리 올려 둔 키를 쓴다. 키도 없으면 사진 없이 둔다
+  } else if (!(await storage.head(key))) {
+    noPhoto.add(p.photo);
+  }
+}
+if (noPhoto.size > 0) console.warn(`사진 없음(파일도 저장소의 키도 없다): ${[...noPhoto].join(", ")}`);
+
+// 3. 카테고리·상품
+for (const c of catalog.categories) {
+  await prisma.category.upsert({ where: { id: c.id }, create: c, update: { name: c.name, parentId: c.parentId } });
+}
+const categoryIds = new Map(catalog.categories.map((c) => [c.name, c.id]));
+for (const p of catalog.products) {
+  const categoryId = categoryIds.get(p.category);
+  if (categoryId === undefined) throw new Error(`catalog.json: 없는 카테고리 "${p.category}" (${p.name})`);
+  const data = { name: p.name, price: p.price, stock: p.stock, categoryId, imageKey: noPhoto.has(p.photo) ? null : `seed/${p.photo}` };
+  // TRUNCATE 대신 id로 덮어쓴다. 남겨야 할 주문의 품목이 CASCADE로 지워지지 않는다
+  await prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
+}
+const productIds = catalog.products.map((p) => p.id);
+// 파일에서 뺀 상품: 주문에 없으면 지우고, 있으면 품절로 남긴다(지난 주문의 품목 이름 유지)
+await prisma.product.deleteMany({ where: { id: { notIn: productIds }, items: { none: {} } } });
+await prisma.product.updateMany({ where: { id: { notIn: productIds } }, data: { stock: 0 } });
+// id를 직접 넣었으므로 자동 증가 순번을 맞춘다. 안 하면 다음 자동 id가 겹친다
+await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT max(id) FROM categories))`;
+await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products))`;
+
+// 4. 시드 사용자와 그 주문
+const seedUsers = [
+  { id: "kim", name: "김", role: "admin" as const },
+  { id: "lee", name: "이", role: "user" as const },
+  { id: "park", name: "박", role: "user" as const },
+  { id: "choi", name: "최", role: "user" as const },
+];
+for (const u of seedUsers) {
+  const passwordHash = await hashPassword(process.env.DEMO_PASSWORD!);
+  // 없으면 만들고, 있으면 비밀번호만 맞춘다. 역할(진짜 관리자)은 덮어쓰지 않는다
+  await prisma.user.upsert({ where: { id: u.id }, create: { ...u, passwordHash }, update: { passwordHash } });
+}
+
+const seedOrders: { userId: string; paid: boolean; items: [productId: number, quantity: number][] }[] = [
+  { userId: "kim", paid: true, items: [[6, 1], [16, 2]] },
+  { userId: "lee", paid: false, items: [[8, 1]] },
+  { userId: "kim", paid: true, items: [[9, 1]] },
+  { userId: "lee", paid: true, items: [[7, 1], [13, 1]] },
+  { userId: "park", paid: true, items: [[15, 1], [16, 1]] },
+];
+const seedUserIds = seedUsers.map((u) => u.id);
+// 시드 사용자의 주문만 지우고 품목을 넣어 다시 만든다. GitHub 사용자의 주문은 남긴다
+await prisma.orderItem.deleteMany({ where: { order: { userId: { in: seedUserIds } } } });
+await prisma.order.deleteMany({ where: { userId: { in: seedUserIds } } });
+const priceOf = new Map(catalog.products.map((p) => [p.id, p.price]));
+for (const o of seedOrders) {
+  const items = o.items.map(([productId, quantity]) => ({ productId, quantity, unitPrice: priceOf.get(productId)! }));
+  await prisma.order.create({
+    data: { userId: o.userId, paid: o.paid, price: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0), items: { create: items } },
+  });
+}
+
+console.log(
+  `seed 완료: 상품 ${catalog.products.length}개(사진 새로 올림 ${uploaded}장, 사진 없음 ${noPhoto.size}개), 임시 사용자 ${deletedTemp}명 삭제,`,
+  `사용자 ${await prisma.user.count()}명, 주문 ${await prisma.order.count()}건`,
+);
+await prisma.$disconnect();
```

순서에 이유가 있다.

| 순서 | 무엇을 | 왜 이 자리인가 |
|---|---|---|
| 1 | 임시 사용자를 모두 지운다 | 결제 대기 주문이 잡은 재고를 먼저 돌려준다. 그다음 3에서 재고를 파일 값으로 덮어써야 값이 맞는다 |
| 2 | 사진을 올린다. 파일이 없으면 저장소에 그 키가 있는지만 본다 | 3에서 상품이 가리킬 키가 먼저 있어야 한다. 키도 없으면 그 상품은 사진 없이 둔다 |
| 3 | 카테고리·상품을 `id`로 덮어쓴다 | TRUNCATE하면 남겨야 할 주문의 품목까지 CASCADE로 지워진다 |
| 4 | 시드 사용자의 주문을 지우고 품목을 넣어 다시 만든다 | 3의 상품 id를 품목이 가리킨다 |

- 파일에서 뺀 상품은 주문에 걸려 있지 않으면 지우고, 걸려 있으면 재고 0(품절)으로 남긴다. 지난 주문의 "상품" 칸에 이름이 남아야 한다.

- `id`를 직접 넣었으므로 자동 증가 순번(`setval`)을 맞춘다. 맞추지 않으면 다음에 id 없이 만든 행이 1번을 받으려다 기본 키 충돌로 실패한다.

- 시드 사용자는 없으면 만들고, 있으면 비밀번호만 `DEMO_PASSWORD`로 맞춘다. 역할은 처음 만들 때만 정한다.

- 시드는 소유자 연결(`ADMIN_DATABASE_URL`)로 돈다. 테이블 소유자는 RLS를 거치지 않으므로 `asAdmin` 없이 모든 주문을 지운다.

- 파일이 없는 사진(운영의 `maker-*`)은 저장소에 누가 미리 올려 둔 키를 그대로 쓴다. 키마저 없으면 실패하지 않고 경고만 남긴다. 로컬 개발과 CI처럼 그 사진이 없는 곳에서도 시드가 끝까지 돈다(그 상품은 이름 첫 글자로 보인다).

- `readFile`의 `ENOENT`(파일 없음)만 "없다"로 본다. 권한 오류 같은 다른 실패는 그대로 던진다.

- 시드는 Nest 앱 밖의 스크립트다. 그래도 `StorageService`는 생성자에 의존성이 없어 `new`로 바로 만든다. `onModuleInit`(CORS 설정)은 부르지 않는다.

### 작업 4. [커밋] e2e가 기대는 상품 id를 바꾼다

원래의 네 상품이 1~4번에서 5~8번으로 옮겼다. 프론트 e2e의 `data-testid`가 상품 id를 담고 있다.

```diff
--- a/order-console-next/e2e/cart-quantity.spec.ts
+++ b/order-console-next/e2e/cart-quantity.spec.ts
@@
   const keyboard = page.getByRole("listitem").filter({ hasText: "한정판 키보드" });
-  const stock = Number(await keyboard.getByTestId("stock-1").textContent());
+  const stock = Number(await keyboard.getByTestId("stock-5").textContent());
```

```diff
--- a/order-console-next/e2e/shop.spec.ts
+++ b/order-console-next/e2e/shop.spec.ts
@@
-  const stock = page.getByTestId("stock-2");
+  const stock = page.getByTestId("stock-6");
@@
-  await expect(page.getByTestId("stock-2")).toHaveText(String(before - 1));
+  await expect(page.getByTestId("stock-6")).toHaveText(String(before - 1));
```

```diff
--- a/order-console-next/e2e/upload.spec.ts
+++ b/order-console-next/e2e/upload.spec.ts
@@
-  const confirm = page.waitForResponse((r) => r.url().endsWith("/products/2/image/confirm"));
-  await page.getByTestId("image-input-2").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));
+  const confirm = page.waitForResponse((r) => r.url().endsWith("/products/6/image/confirm"));
+  await page.getByTestId("image-input-6").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));
@@
-  const img = page.getByTestId("image-2").filter({ visible: true });
+  const img = page.getByTestId("image-6").filter({ visible: true });
@@
-  await page.getByTestId("image-input-2").setInputFiles({
+  await page.getByTestId("image-input-6").setInputFiles({
@@
-  await expect(page.getByTestId("image-error-2")).toContainText("이미지 파일이 아니다");
+  await expect(page.getByTestId("image-error-6")).toContainText("이미지 파일이 아니다");
```

- `shop.spec`과 `trpc.spec`의 `/me/orders/1`은 그대로다. 빈 DB에서 시드가 처음 만드는 주문이 `kim`의 것이라 1번이다.

- `upload.spec`은 마우스(6번)의 사진을 바꾼다. 업로드 확인(`confirm`)이 이전 사진 키 `seed/mouse.webp`를 저장소에서 지운다. 다음 시드가 크기 비교로 이것을 알아채고 다시 올린다(작업 6에서 본다).

### 작업 5. [커밋] 운영의 시드가 S3에 닿게 한다

매일 초기화는 `migrate` 컨테이너에서 시드를 돈다(`deploy/ops/reset-demo.sh`). 이 컨테이너에 저장소 값을 준다.

```diff
--- a/deploy/compose.yml
+++ b/deploy/compose.yml
@@
   migrate:
@@
     environment:
       DATABASE_URL: ${ADMIN_DATABASE_URL:?}
       DEMO_PASSWORD: ${DEMO_PASSWORD:-}
       NODE_EXTRA_CA_CERTS: /certs/rds-ca.pem
+      S3_ENDPOINT: ""
+      S3_REGION: ${AWS_REGION:?}
+      # 시드가 사진을 올릴 버킷. 키는 주지 않고 EC2의 IAM 역할을 쓴다
+      S3_BUCKET: ${S3_BUCKET:?}
     volumes:
       - ./rds-ca.pem:/certs/rds-ca.pem:ro
```

- 키는 주지 않는다. `api`처럼 EC2의 IAM 역할을 쓴다. 역할의 정책(`18`의 `30-storage.sh`)은 버킷 전체(`$BUCKET/*`)에 `PutObject`·`GetObject`를 허락하므로 `seed/` 접두사도 된다.

- `HeadObject`로 없는 키를 물으면, `s3:ListBucket` 권한이 있을 때 404(`NotFound`)가 오고 없으면 403이 온다. `head()`는 404만 "없다"로 본다. 역할에 `ListBucket`이 있어서 동작한다.

- 마이그레이션 이미지는 `order-api-nest/` 전체를 복사하므로(`Dockerfile`의 `build` 단계) `prisma/seed/`의 사진도 이미지에 들어간다. 약 1.5MB 늘어난다.

`deploy/ops/reset-demo.sh`는 고치지 않는다. 시드를 부르기만 하므로, 시드가 바뀌면 초기화가 하는 일도 바뀐다. 초기화 전에 그날 백업을 확인하는 조건도 그대로 둔다(`20`).

저장소에 넣지 않은 사진(`maker-*`)은 마이그레이션 이미지에도 없다. CI가 저장소에서 이미지를 만들기 때문이다. 이 PC에서 운영 S3로 한 번 올리는 스크립트를 `18`의 AWS 스크립트 옆에 둔다.

```sh
#!/usr/bin/env bash
# deploy/aws/62-seed-private-photos.sh
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)
PHOTOS="$(dirname "$0")/../../order-api-nest/prisma/seed/photos"

step "저장소에 넣지 않은 시드 사진 → s3://$BUCKET/seed/"
for f in "$PHOTOS"/maker-*.webp; do
  [ -e "$f" ] || { echo "$PHOTOS에 maker-*.webp가 없다"; exit 1; }
  # 시드와 같은 고정 키. content-type을 주지 않으면 binary/octet-stream으로 저장된다
  aws s3 cp "$f" "s3://$BUCKET/seed/$(basename "$f")" --content-type image/webp --only-show-errors
  echo "올림  seed/$(basename "$f")"
done
```

```sh
chmod +x deploy/aws/62-seed-private-photos.sh
```

- 커밋하는 것은 스크립트뿐이고, 사진은 이 PC에만 있다. 돌리는 것은 작업 7에서 한다.

- 키가 시드와 같은 `seed/<파일 이름>`이라, 올린 뒤에는 공개 사진과 똑같이 다뤄진다. 매일 초기화가 그 키를 가리키게 하고, 고아 정리는 보지 않는다.

- `--content-type`을 주지 않으면 S3가 `binary/octet-stream`으로 저장한다. 브라우저가 이미지로 그리지 않을 수 있다.

- 다시 돌려도 된다. 같은 키에 덮어쓴다.

### 작업 6. [확인] 로컬에서 시드를 두 번 돌린다

```sh
cd order-api-nest
npx prisma db seed
npx prisma db seed

seed 완료: 상품 16개(사진 새로 올림 16장, 사진 없음 0개), 임시 사용자 <N>명 삭제, 사용자 4명, 주문 5건
seed 완료: 상품 16개(사진 새로 올림 0장, 사진 없음 0개), 임시 사용자 0명 삭제, 사용자 4명, 주문 5건
```

두 번째에는 사진을 올리지 않는다. 1장에서 만든 임시 사용자는 첫 번째에 모두 지워진다. 로컬에는 `maker-*` 파일이 있으므로(커밋만 하지 않았다) 16장 모두 올라간다. CI처럼 그 파일이 없는 곳에서는 `사진 없음 4개`가 정상이다.

```sh
node scripts/list-objects.mjs seed/

┌─────────┬──────────────────────────────┬────────┬───────────────┬───────────────┐
│ (index) │ key                          │ size   │ 올라간 지(초) │ 가리키는 상품 │
├─────────┼──────────────────────────────┼────────┼───────────────┼───────────────┤
│ 0       │ 'seed/headphones-wired.webp' │ 98602  │ 37            │ 13            │
│ 1       │ 'seed/headphones.webp'       │ 40594  │ 37            │ 7             │
│ 2       │ 'seed/kettle.webp'           │ 71670  │ 37            │ 8             │
│ 3       │ 'seed/keyboard-limited.webp' │ 98454  │ 37            │ 5             │
│ 4       │ 'seed/keycaps.webp'          │ 97188  │ 37            │ 9             │
│ 5       │ 'seed/maker-card.webp'       │ 71730  │ 37            │ 1             │
│ 6       │ 'seed/maker-photo-1.webp'    │ 107604 │ 37            │ 2             │
│ 7       │ 'seed/maker-photo-2.webp'    │ 67996  │ 37            │ 3             │
│ 8       │ 'seed/maker-photo-3.webp'    │ 74964  │ 37            │ 4             │
│ 9       │ 'seed/moka-pot.webp'         │ 98326  │ 37            │ 15            │
│ 10      │ 'seed/mouse.webp'            │ 97098  │ 37            │ 6             │
│ 11      │ 'seed/mug.webp'              │ 101702 │ 37            │ 16            │
│ 12      │ 'seed/radio.webp'            │ 90832  │ 37            │ 14            │
│ 13      │ 'seed/trackball.webp'        │ 85978  │ 37            │ 12            │
│ 14      │ 'seed/usb-hub.webp'          │ 97432  │ 37            │ 10            │
│ 15      │ 'seed/webcam.webp'           │ 93204  │ 37            │ 11            │
└─────────┴──────────────────────────────┴────────┴───────────────┴───────────────┘
```

`http://localhost:3000/shop`에 사진이 붙은 상품 16개가 보이고, "내 주문"(`kim`)의 주문을 열면 품목이 있다.

관리 화면에서 `kim`으로 마우스 사진을 다른 파일로 바꾼 뒤 시드를 다시 돌린다.

```sh
npx prisma db seed
seed 완료: 상품 16개(사진 새로 올림 1장, 사진 없음 0개), …
```

마우스는 다시 `seed/mouse.webp`를 가리키고, 방금 올린 `products/6/<uuid>.*`는 `node scripts/list-objects.mjs`에서 "(없음 - 고아)"로 보인다. 1시간 뒤 고아 정리가 지운다.

### 작업 7. [실행] 운영에 배포한다

배포 브랜치를 이 브랜치로 바꾼다. `20`과 같은 방법이다.

```sh
gh variable set DEPLOY_BRANCH -R <계정>/<저장소> -b 21-public-demo
```

Settings → Environments → `production` → Deployment branches and tags에서 `20-operations`를 빼고 `21-public-demo`를 넣는다.

커밋해 푸시하면 CI가 배포한다. 배포 스크립트는 마이그레이션(`0018`, `0019`)만 적용하고 시드는 돌리지 않는다.

시드를 돌리기 전에, 저장소에 없는 사진을 이 PC에서 운영 S3에 올린다(작업 5의 스크립트).

```sh
./deploy/aws/62-seed-private-photos.sh

== 저장소에 넣지 않은 시드 사진 → s3://node-order-images-042449721455/seed/
올림  seed/maker-card.webp
올림  seed/maker-photo-1.webp
올림  seed/maker-photo-2.webp
올림  seed/maker-photo-3.webp
```

바뀐 시드를 한 번 돌린다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@3.106.98.215
cd /opt/node-order && FORCE=1 ops/reset-demo.sh
<시각> 데모 데이터 초기화 시작
...
<시각> 데모 데이터 초기화 끝
```

- 이미지에 있는 공개 사진 12장은 시드가 올리고, `maker-*` 넷은 방금 올린 키를 그대로 쓴다. 순서를 거꾸로 하면 `사진 없음 4개`가 찍히고 그 상품은 사진 없이 뜬다. 스크립트를 돌린 뒤 시드를 한 번 더 돌리면 된다.

- `FORCE=1`은 "오늘 백업이 성공했는가" 확인을 건너뛴다(`20`). 백업 타이머가 그날 이미 돌았으면 빼도 된다.

- 처음 한 번은 상품 1~4번의 뜻이 바뀐다(옛 한정판 키보드 등 → 만든 사람 항목). 옛 초기화가 매일 모든 주문을 지웠으므로, 영향을 받는 것은 마지막 초기화 뒤에 생긴 주문뿐이다. 그 주문의 품목 이름이 새 상품 이름으로 보인다.

### 작업 8. [실행] 진짜 관리자를 정한다

이제 초기화가 GitHub 사용자를 남기므로 역할도 남는다. 운영 화면에서 GitHub로 한 번 로그인해 사용자 행을 만든 뒤, 서버에서 SQL 한 줄로 올린다(2장 "진짜 관리자는 어디서 정하나").

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@3.106.98.215
cd /opt/node-order
echo "UPDATE users SET role = 'admin' WHERE github_id = '<GitHub 숫자 id>';" \
  | docker compose run --rm -T migrate npx prisma db execute --stdin
```

- `prisma db execute`는 결과 행을 보여 주지 않는다. 바뀌었는지는 다시 로그인한 뒤 "관리" 화면에서 사진 올리기 버튼이 켜져 있는지로 본다.

- 로그아웃했다가 다시 로그인해야 새 역할이 토큰에 실린다(2장 "역할은 토큰에 실려 있다").

### 개념 | 키가 매번 같아서 고아가 되지 않는다

고아 이미지 정리(`06`)는 `products/` 아래만 본다.

```ts
// order-api-nest/src/leader/orphan-image-cleanup.job.ts (지금 코드, 읽기만)
    const objects = await this.storage.list("products/");
    const rows = await this.prisma.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } });
    const used = new Set(rows.map((r) => r.imageKey));
    const cutoff = Date.now() - this.minAgeMs;
    const orphans = objects.filter((o) => !used.has(o.key) && o.lastModified.getTime() < cutoff);
```

| 키 | 누가 만드나 | 초기화 뒤 | 고아 정리 |
|---|---|---|---|
| `products/<id>/<uuid>.<확장자>` | 관리자 업로드. 올릴 때마다 새 UUID | 상품이 `seed/…`로 돌아가 아무도 가리키지 않는다 | 1시간 뒤 지운다 |
| `seed/<파일 이름>` | 시드. 언제 돌아도 같은 이름 | 상품이 다시 이 키를 가리킨다 | 보지 않는다(접두사가 다르다) |

- 키가 매번 같으므로 초기화가 몇 번 돌아도 같은 파일을 가리킨다. 옛 시드처럼 "새로 만든 상품 + 사진 없음"이 아니라 "같은 상품 + 같은 사진"이다.

- 접두사가 달라 고아 정리의 대상에서 아예 빠진다. 시드 사진이 지워지는 길은 관리자가 그 상품의 사진을 바꿀 때 하나뿐이다(`confirm`이 이전 키를 지운다). 그때도 다음 시드가 다시 올린다(작업 6). 단, 저장소에 파일이 없는 `maker-*`는 시드가 다시 올리지 못한다. 그 상품의 사진을 바꿨다가 되돌리려면 `62-seed-private-photos.sh`를 다시 돌린다.

- 한 사진을 두 상품이 같이 쓰면, 한 상품의 사진을 바꿀 때 다른 상품의 사진까지 지워진다. 그래서 상품마다 사진 파일을 따로 둔다.

### 개념 | 매일 초기화가 되돌리는 것과 남기는 것

| 대상 | 초기화 | 이유 |
|---|---|---|
| 카테고리 트리 | 되돌린다(`catalog.json`) | 데모의 첫인상. 진짜 관리자가 옮겨도 다음 날 돌아온다 |
| 상품의 이름·가격·재고·사진 키 | 되돌린다(`catalog.json`) | 방문자의 결제가 재고를 줄인다. 매일 같은 상태에서 시작한다 |
| `catalog.json`에서 뺀 상품 | 주문에 없으면 지우고, 있으면 품절 | 지난 주문의 품목 이름이 남아야 한다 |
| 시드 사진 `seed/…` | 남긴다(파일이 있는 것은 없거나 크기가 다르면 다시 올림) | 매일 다시 올릴 이유가 없다 |
| 저장소에 없는 사진 `seed/maker-*` | 남긴다. 시드는 올리지 않고 가리키기만 한다 | 원본은 만든 사람의 PC에만 있다. 버킷을 지우면(`90-destroy.sh`) 함께 사라지므로 다시 만들 때 스크립트를 다시 돌린다 |
| 관리자가 올린 사진 `products/…` | 상품이 가리키지 않게 된다 → 고아 정리가 지운다 | 상품 값은 파일이 정한다 |
| 임시 사용자와 그 주문·토큰 | 만료 전인 것까지 모두 지운다 | 정리 작업은 만료된 것만 지운다. 초기화는 하루에 한 번 0에서 시작하게 한다. 그 시각(04:00)에 둘러보던 방문자는 로그아웃된다 |
| 시드 사용자(`kim`, `lee`, `park`, `choi`)의 주문 | 지우고 품목을 넣어 다시 만든다 | 로컬 e2e와 데모 화면이 기대는 모양 |
| GitHub로 가입한 사용자, 그 주문·로그인 | 남긴다 | 사람이 직접 가입한 데이터다. 옛 초기화는 모두 지우고 모두 로그아웃시켰다 |
| 사용자의 역할(진짜 관리자) | 남긴다 | 지우면 매일 SQL을 다시 쳐야 한다 |
| `stripe_events` | 남긴다 | 같은 웹훅을 두 번 처리하지 않게 하는 기록이다 |
| 남는 사용자의 `outbox_events`, `idempotency_keys` | 남긴다 | 사용자를 지울 때만 함께 지운다 |

- 결제 대기인 GitHub 사용자의 주문은 재고를 잡은 채 남는다. 초기화가 재고를 파일 값으로 덮어쓴 뒤 그 주문이 만료되면(`14`) 잡았던 수량이 더해져 재고가 파일 값보다 조금 많아진다. 다음 초기화에서 맞춰진다.

### 개념 | 운영의 상품은 `catalog.json`을 커밋해서 바꾼다

진짜 관리자가 운영에서 바꾼 것(사진, 카테고리 위치)도 다음 날 04:00에 되돌아간다. 이것은 결함이 아니라 규칙이다.

| 바꾸고 싶은 것 | 하는 곳 |
|---|---|
| 상품 이름·가격·재고, 카테고리 | `catalog.json`을 고쳐 커밋한다 |
| 상품 사진 | `photos/`에 새 이름으로 넣고, `catalog.json`의 `photo`를 바꿔 커밋한다 |
| 오늘 하루만 보여 줄 변경 | 관리 화면에서 바꾼다. 다음 초기화에 사라진다 |

- 운영의 상품 값이 저장소에 있으므로 리뷰(PR)를 거치고, 기록이 남고, 서버를 새로 만들어도 같은 카탈로그가 나온다.

- `id`는 한 번 쓰면 다른 상품에 다시 주지 않는다. 그 id를 가리키는 지난 주문의 품목 이름이 바뀌어 보인다. 상품을 내릴 때는 파일에서 빼고(품절로 남는다), 새 상품은 새 id를 받는다.

#### 고친 뒤 운영에 반영되는 때

배포만으로는 바뀌지 않는다. 시드가 돌아야 바뀐다.

| 단계 | 일어나는 일 |
|---|---|
| 커밋·푸시 | CI가 새 마이그레이션 이미지를 만든다. 바뀐 `catalog.json`과 `photos/`가 이미지에 들어간다(`.json`은 문서만 바꾼 푸시처럼 건너뛰지 않는다) |
| 배포(`deploy.sh`) | 마이그레이션만 적용한다. 시드는 돌리지 않으므로 운영 DB의 상품은 아직 옛 값이다 |
| 다음 04:00 초기화 | 지금 배포된 이미지로 시드를 돈다. 여기서 바뀐다 |

바로 바꾸려면 배포가 끝난 뒤 초기화를 한 번 돌린다(작업 7과 같은 명령).

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@3.106.98.215
cd /opt/node-order && FORCE=1 ops/reset-demo.sh
```

- 그날 03:30 백업이 이미 성공했으면 `FORCE=1`은 빼도 된다.

- 문구·가격만 바꿨으면 출력이 `사진 새로 올림 0장, 사진 없음 0개`다. 공개 사진을 새 이름으로 더했으면 그 수만큼 올린다.

- 만든 사람의 사진(`maker-*`)을 바꿨으면, 새 이름의 파일로 `62-seed-private-photos.sh`를 먼저 돌린 뒤 초기화를 돌린다. 이 사진은 이미지에 없으므로 시드가 올리지 못한다.

- 손으로 돌려도 매일 초기화와 같은 일을 한다. 그 시각에 둘러보던 방문자의 임시 계정이 지워지고, 재고와 시드 사용자의 주문도 파일 값으로 돌아간다.

### 남길 것

- **찾아보면 되는 것**: Prisma `upsert`·`deleteMany`의 `items: { none: {} }`, `setval`·`pg_get_serial_sequence`, `import.meta.url`로 파일 경로 만들기, `cwebp -size`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 초기화는 "모두 지우고 다시"가 아니라 "무엇을 되돌리고 무엇을 남길지"의 표다. 표를 먼저 정하면 TRUNCATE를 쓸 수 있는지가 저절로 정해진다(CASCADE가 남길 것까지 지운다).
  - 고정할 값은 저장소의 파일에 둔다. 운영에서 바꾼 값은 사라지는 것이 규칙이고, 남기려면 커밋한다.
  - 저장소의 파일 키를 고정하면 몇 번을 돌려도 같은 결과다(멱등). 매번 새 키를 만들면 매번 고아가 생긴다.
  - id를 직접 정해 넣으면 자동 증가 순번도 직접 맞춘다.
  - 공개 저장소에 남기면 안 되는 파일은 커밋하지 않고 운영 저장소에 따로 올린다. 시드는 "파일이 있으면 올리고, 없으면 이미 있는 키를 쓴다"로 두면 두 경우 모두 돈다. 화면에 보이는 것까지 막지는 못한다.

- **에러 신호**:
  - `catalog.json: 없는 카테고리 "…"` → 상품의 `category`가 `categories`의 이름과 다르다
  - `ENOENT: no such file or directory, open '…/prisma/seed/photos/….webp'` → `catalog.json`의 `photo`와 파일 이름이 다르다
  - 운영의 초기화가 `required variable S3_BUCKET is missing a value` → 서버 `.env`에 `S3_BUCKET`이 없거나, 옛 `compose.yml`이다
  - 운영의 초기화가 `Could not load credentials from any providers` → 컨테이너에서 EC2 메타데이터에 닿지 않는다(`18`의 홉 제한)
  - 운영의 초기화가 `AccessDenied` → IAM 역할의 정책이 그 버킷·동작을 허락하는지(`30-storage.sh`)
  - 상품 사진이 깨져 보인다 → 그 상품의 사진을 관리자가 바꿔 `seed/` 키가 지워졌다. 다음 시드가 다시 올린다
  - 운영 시드가 `사진 없음(파일도 저장소의 키도 없다): maker-…` → `62-seed-private-photos.sh`를 돌리지 않았거나, 관리자가 그 상품 사진을 바꿔 키가 지워졌다
  - `git status`에 `maker-*.webp`가 보인다 → `order-api-nest/.gitignore`의 규칙이 없거나 경로가 다르다(`git check-ignore -v`)
  - 프론트 e2e에서 `stock-1`·`image-input-2`를 못 찾는다 → 상품 id가 바뀌었다(작업 4)
  - ``Unique constraint failed on the fields: (`id`)`` → id를 직접 넣은 뒤 순번(`setval`)을 맞추지 않았다
  - 초기화 뒤 GitHub 사용자가 사라지고 모두 로그아웃됐다 → 서버의 마이그레이션 이미지가 아직 옛 시드다(배포가 안 됐다)
  - `catalog.json`을 고쳐 배포했는데 상품이 그대로다 → 배포는 시드를 돌리지 않는다. 다음 04:00을 기다리거나 `ops/reset-demo.sh`를 손으로 돌린다

## 5. 디버깅

### 진단 1. 지금 누구로, 어떤 역할로 들어와 있나

브라우저 개발자 도구 → Network에서 아무 tRPC 요청을 골라 `Authorization` 헤더의 토큰을 jwt.io에 붙인다. `sub`와 `role`이 보인다.

DB의 역할과 다르면 토큰이 옛것이다(2장 "역할은 토큰에 실려 있다"). 같은 화면의 `me.profile` 응답은 DB의 역할이다.

| 토큰 `role` | `me.profile`의 `role` | 뜻 |
|---|---|---|
| `demo_admin` | `demo_admin` | 데모 관리자. 쓰기는 403이 맞다 |
| `user` | `admin` | 역할을 막 올렸다. 다시 로그인한다 |
| `user` 또는 `demo_admin` | (서버 오류) | 정리 작업이 지운 임시 사용자의 남은 access token이다(1장) |

### 진단 2. 429의 주인 찾기

서버에서 지금 칸의 카운터를 본다.

```sh
ssh … 'cd /opt/node-order && docker compose exec -T redis redis-cli --scan --pattern "rate:*"'

rate:all:<방문자 IP>:<칸 번호>
rate:auth:<방문자 IP>:<칸 번호>
```

- 키의 IP가 사설 주소(`172.…`) 하나뿐이면 `TRUST_PROXY`가 동작하지 않는다. 모두 Caddy나 웹 컨테이너로 세어진다.

- 값은 `redis-cli GET <키>`로 본다. 키는 1분 안에 사라진다.

거절이 얼마나 일어나는지는 지표로 본다.

```sh
curl -s localhost:4000/metrics | grep http_rate_limited_total
```

### 진단 3. 에러 신호로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다. 단계마다의 `남길 것` 셋째 줄을 모두 모았다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 단계 |
|---|---|---|---|
| ``Unknown argument `expiresAt` `` | Prisma 클라이언트가 옛 스키마다 | `npx prisma generate` | 1 |
| ``The column `users.expires_at` does not exist in the current database.`` | 그 DB에 `0018`이 없다 | 개발 DB·테스트 DB 각각 `migrate deploy` | 1 |
| `new row violates row-level security policy for table "orders"` | 견본 주문을 그 사용자의 `app.user_id` 없이 넣었다 | `asUser(id, …)` 안에서 만드는지 | 1 |
| 데모로 들어왔는데 견본 주문이 없다 | 재고 있는 상품이 없다 | 시드를 돌렸는지 | 1 |
| 지난 임시 사용자가 지워지지 않는다 | 이 인스턴스가 리더가 아니거나, 정리 간격이 길다 | 로그의 `리더가 됐다`, `DEMO_CLEANUP_INTERVAL_MS` | 1 |
| `invalid input value for enum "Role": "demo_admin"` | 그 DB에 `0019`가 없다 | `migrate deploy` | 2 |
| `This comparison appears to be unintentional because the types '"admin"' and '"demo_admin"' have no overlap.` | 프론트가 옛 `Role` 타입을 본다 | `npx prisma generate` | 2 |
| 데모 관리자의 403 메시지가 `관리자만 할 수 있습니다` | 토큰의 `demo_admin`이 `user`로 읽힌다 | `JwtStrategy.validate` | 2 |
| 데모 관리자인데 "관리" 메뉴가 없다 | 메뉴가 `admin`만 본다 | `useCanSeeAdmin` | 2 |
| 카테고리 e2e가 403 | 테스트의 `kim`이 관리자가 아니다 | `role: "admin"` | 2 |
| 데모 관리자의 `curl`이 업로드 주소를 받는다 | Guard가 `demo_admin`을 통과시킨다 | `AdminGuard`(2장 실험) | 2 |
| 역할을 올렸는데 관리 기능이 여전히 막힌다 | 토큰에 옛 역할이 실려 있다 | 다시 로그인 | 2 |
| 운영에서 방문자 모두가 함께 429 | 모두 프록시 주소 하나로 세어진다 | `TRUST_PROXY`, 진단 2 | 3 |
| 한도를 넘겨도 429가 안 난다 | 한도가 꺼졌거나 `X-Forwarded-For`를 너무 넓게 믿는다 | `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY` | 3 |
| `요청 수를 세지 못해 통과시킨다` | Redis에 닿지 않아 제한을 풀었다 | `/health/ready` | 3 |
| GitHub 로그인만 모두 함께 429 | 웹 컨테이너 주소로 세어진다 | `auth.ts`의 `X-Forwarded-For` | 3 |
| `/health`가 429, 컨테이너 unhealthy | 헬스 체크를 세고 있다 | `SKIP_PREFIXES` | 3 |
| `catalog.json: 없는 카테고리 "…"` | 상품의 카테고리 이름이 목록에 없다 | `catalog.json` | 4 |
| `ENOENT: no such file or directory, open '…/photos/….webp'` | 사진 파일 이름이 다르다 | `catalog.json`의 `photo` | 4 |
| `required variable S3_BUCKET is missing a value` | `migrate` 컨테이너에 줄 값이 없다 | 서버 `.env`, `deploy/compose.yml` | 4 |
| `Could not load credentials from any providers` | 컨테이너에서 IAM 역할에 닿지 않는다 | 인스턴스의 홉 제한(`18`) | 4 |
| `AccessDenied` (시드의 사진 올리기) | 역할의 정책이 허락하지 않는다 | `30-storage.sh`의 정책 | 4 |
| 상품 사진이 깨져 보인다 | `seed/` 사진이 지워졌다(관리자가 그 상품 사진을 바꿈) | 다음 시드가 다시 올린다 | 4 |
| `사진 없음(파일도 저장소의 키도 없다): maker-…` | 저장소에 없는 사진이 운영 S3에도 없다 | `62-seed-private-photos.sh`를 돌리고 시드를 다시 돈다 | 4 |
| `git status`에 `maker-*.webp`가 보인다 | 커밋하면 안 되는 사진이 추적 대상이다 | `order-api-nest/.gitignore`, `git check-ignore -v` | 4 |
| e2e가 `stock-1`·`image-input-2`를 못 찾는다 | 상품 id가 바뀌었다 | 4장 작업 4 | 4 |
| ``Unique constraint failed on the fields: (`id`)`` | 자동 증가 순번이 직접 넣은 id보다 작다 | `setval` | 4 |
| 초기화 뒤 GitHub 사용자가 사라졌다 | 서버가 아직 옛 시드다 | 배포된 `IMAGE_TAG` | 4 |
| `catalog.json`을 고쳐 배포했는데 상품이 그대로다 | 배포는 마이그레이션만 하고 시드는 돌리지 않는다 | 다음 04:00, 또는 `FORCE=1 ops/reset-demo.sh` | 4 |

## 6. 완성 확인

### 시험해보기

```sh
npm run lint && npm run typecheck && npm run test:api && npm run test:web
```

운영에서는 두 창(일반·시크릿)으로 공개 주소를 열어 "일반 사용자로"를 누르고, 서로의 "내 주문"이 다른지 본다. "관리자로"를 눌러 관리 화면에서 버튼이 꺼져 있고 이유가 보이는지 본다.

### 체크리스트

- [ ] 데모 버튼을 누를 때마다 다른 `demo-xxxxxxxx` 사용자가 생기고, 품목이 든 견본 주문이 1~2건 있다
- [ ] 만료된 임시 사용자는 정리 작업이 주문·토큰과 함께 지우고, 결제 대기 주문의 재고를 돌려준다
- [ ] 데모 관리자는 관리 화면을 보지만, 쓰기 API와 주문·사용자 목록 API에서 403을 받는다
- [ ] 화면만 막았을 때 `curl`로 뚫리는 것을 직접 봤고, Guard를 되돌렸다
- [ ] 로그인 계열은 1분 20건, 나머지는 300건에서 429와 `Retry-After`를 받는다. 헬스·지표·웹훅은 세지 않는다
- [ ] `X-Forwarded-For`를 넓게 믿으면 한도를 피하는 것을 봤고, 운영은 `uniquelocal`이다
- [ ] 시드를 두 번 돌려도 같은 결과이고, 두 번째는 사진을 올리지 않는다
- [ ] 초기화 뒤 GitHub 사용자와 진짜 관리자 역할이 남는다
- [ ] `prisma/seed/README.md`에 사진 출처가 있다
- [ ] 만든 사람의 사진은 git 기록에 없고(`git log --all -- '*maker-*'`가 비어 있다), 운영 S3의 `seed/`에만 있다

## 7. 다음 단계

공개 URL에 띄운 데모는 이제 방문자마다 따로 놀고, 아무도 남의 것을 바꾸지 못하며, 매일 같은 카탈로그로 돌아온다. 다음 단계에서 상품을 등록·수정하는 관리 기능이나 서버 렌더링을 더할 때, 이 문서의 표(관리자 전용 API, 세지 않는 경로, 초기화가 되돌리는 것)에 한 줄씩 더하는 것부터 한다.

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 모든 방문자가 `lee`로 들어가면 RLS가 있어도 왜 주문이 섞이는가?

2. 임시 사용자를 `expires_at`으로 표시한 이유는? id 접두사만으로 가르면 지금 코드에서 무엇이 문제인가?

3. 임시 사용자를 지울 때 결제 대기 주문을 먼저 취소하는 이유는?

4. 데모 관리자에게 `GET /orders`를 열지 않은 이유는? "읽기 전용"인데도.

5. 화면에서 버튼을 끄는 것과 Guard로 막는 것은 각각 무엇을 하는가? 둘이 어긋나면 어느 쪽이 이기는가?

6. DB에서 역할을 바꿨는데 바로 반영되지 않는 이유는?

7. `TRUST_PROXY`가 없을 때, `uniquelocal`일 때, 모든 주소일 때 운영에서 각각 무슨 일이 생기는가?

8. 요청 수 제한이 Redis 장애 때 통과시키는 이유는? 그때 장애는 어디서 알 수 있는가?

9. 시드가 상품을 TRUNCATE하지 않고 `id`로 덮어쓰는 이유는?

10. 시드 사진의 키가 고정이면 왜 고아가 되지 않는가? 관리자가 시드 상품의 사진을 바꾸면 무슨 일이 생기는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 사람인지 확인하는 장치(CAPTCHA, Cloudflare Turnstile)와, 앞단의 WAF·CDN이 하는 요청 수 제한

- 계정마다의 요청 수 제한, 미끄러지는 창·토큰 버킷

- 관리자가 한 일을 남기는 감사 기록(audit log)

- 데모의 Stripe 결제를 테스트 모드로만 제한하는 장치와, 결제 시도 수 제한

- 오래된 `outbox_events`·`idempotency_keys`·`stripe_events`의 정리 주기
