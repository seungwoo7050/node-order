# 배포 준비: 하나의 프로젝트로 정리하고, 운영과 같은 이미지로 띄우기

## 목표

이 프로젝트는 [`15-monitoring`](https://github.com/seungwoo7050/node-order/tree/15-monitoring)으로부터 시작한다.

이 프로젝트는 마지막 상태(`15`)를 출발점으로, 공개/배포 가능한 **하나의 프로젝트**로 정리한다.

1. 학습 중에 남은 데모 코드와 템플릿 파일을 걷어 내고, 남아 있던 린트·타입 에러를 고친다

2. 웹(Next)도 컨테이너 이미지로 만든다. 빌드할 때 정해지는 값과 실행할 때 읽는 값을 가른다

3. 루트의 compose 파일 하나로 인프라 → 앱 → 모니터링을 단계별로 띄운다

4. 전체를 컨테이너로 띄운 상태에서 지금까지의 테스트(실제 Stripe 결제 포함)를 다시 통과시킨다

5. 처음 보는 사람을 위한 README를 쓴다

```sh
# 전체를 운영과 같은 이미지로 띄우고, 컨테이너의 web·api를 대상으로 프론트 e2e를 돌린다
docker compose --profile app up -d --build
npm run test:web
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
```

```text
✔ api  Healthy    ✔ web  Started
11 passed, 1 skipped
✓ 테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다 (6.7s)
```

> 시작 기준점:  
> `15-monitoring`까지 마친 워크스페이스(루트에 `package.json`·`package-lock.json`, 그 아래 `order-api-nest`·`order-console-next`)에서 시작한다.  

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 8장에서 "어느 층에서 틀어졌나"를 가르는 절차 | 친다(`docker compose`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 완성본이 만들어진다. 8장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 대괄호는 그 작업이 **무엇을 남기는지**다. 제목만 보고 커밋할 변경이 있는지 가를 수 있다.

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일: 코드·설정 파일 작성과 수정, 파일 삭제·이동, 패키지 설치(`package.json`·잠금 파일) | 한다 |
  | `[실행]` | 저장소 밖의 상태: 빌드한 이미지, 띄운 컨테이너, DB 데이터(시드). 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다: 테스트, 조회, 결과 읽기 | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다 | 안 한다 |

  한 작업에 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`. 이 문서에는 `[원복]` 작업이 없다. 실험 ①은 실험 안에서 컨테이너를 멈추고, 실험 ②는 바로 다음 작업 4가 `.gitignore`를 고친다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 8장 "진단 4"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 9·10장은 체크리스트와 자가 점검이라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 컨테이너로 띄우기 전에 알아둘 것](#0-컨테이너로-띄우기-전에-알아둘-것) | 빌드 때 박히는 값과 실행 때 읽는 값, 컨테이너 안의 `localhost`(작업 없음) |
| [1. 준비: 구조 바꾸기](#1-준비-구조-바꾸기) | `15`의 워크스페이스를 복사하고 compose·모니터링을 루트로 올린다 |
| [2. 1단계: 정리](#2-1단계-정리) | 데모 화면·템플릿 파일을 지우고, 남아 있던 린트·타입 에러를 고친다 |
| [3. 2단계: 웹 이미지](#3-2단계-웹-이미지) | Next를 standalone 이미지로 만들고, `NEXT_PUBLIC_` 값이 빌드 때 박히는 것을 확인한다 |
| [4. 3단계: compose 하나로](#4-3단계-compose-하나로) | 루트 `compose.yaml` 하나로 인프라·앱·모니터링을 띄우고, 비밀 값을 루트 `.env`로 모은다 |
| [5. 4단계: 컨테이너를 대상으로 e2e, 새 DB와 같은 Stripe 계정](#5-4단계-컨테이너를-대상으로-e2e-새-db와-같은-stripe-계정) | 컨테이너의 web·api를 대상으로 프론트 e2e를 돌리고, 새 DB에서도 Stripe 멱등 키가 겹치지 않는 이유를 본다 |
| [6. 5단계: 전체 확인](#6-5단계-전체-확인) | 루트 `package.json`에 확인 명령을 모으고 전체를 다시 통과시킨다 |
| [7. 6단계: README](#7-6단계-readme) | 다른 `node-order` 브랜치와 같은 틀로 루트 README를 쓴다 |
| [8. 디버깅](#8-디버깅) | 어느 컨테이너·어느 값에서 틀어졌는지 가르고, 에러 신호를 한 표로 본다 |
| [9. 완성 확인](#9-완성-확인) | 체크리스트 |
| [10. 다음 단계](#10-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 컨테이너로 띄우기 전에 알아둘 것

### 개념 1 | 빌드할 때 정해지는 값, 실행할 때 읽는 값

C로 치면 `#define API "http://localhost:4000"`과 `getenv("API")`의 차이다.

앞의 것은 컴파일할 때 실행 파일 안에 문자열로 박혀서, 실행할 때 환경변수를 바꿔도 소용없다. 뒤의 것은 실행할 때마다 읽는다.

Next에서 `NEXT_PUBLIC_`으로 시작하는 값이 앞의 것이다.

브라우저에서 도는 JS에는 환경변수라는 것이 없으므로, Next가 빌드할 때 코드 속의 `process.env.NEXT_PUBLIC_API_URL`을 문자열로 바꿔 넣는다.

나머지 환경변수(`AUTH_SECRET`, `API_URL` 등)는 Next 서버가 실행할 때 읽는다.

| 값 | 언제 정해지나 | 이미지에 어떻게 넘기나 |
|---|---|---|
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL` | 빌드 | `docker build --build-arg` |
| `API_URL`, `AUTH_URL`, `AUTH_SECRET`, `AUTH_GITHUB_*` | 실행 | `docker run -e`, compose의 `environment` |

같은 이미지를 개발·운영에 함께 쓰고 싶어도, **브라우저가 부를 API 주소가 다르면 이미지를 따로 빌드해야 한다.**

> 2단계의 실험 ①에서 직접 확인한다.

### 개념 2 | 브라우저의 주소와 서버의 주소

컨테이너 안에서 `localhost`는 **그 컨테이너 자신**이다.

웹 컨테이너의 Next 서버가 `http://localhost:4000`을 부르면 웹 컨테이너의 4000번을 찾는데, 거기에는 아무것도 없다.

컨테이너끼리는 compose의 서비스 이름(`api`)으로 찾는다. compose가 프로젝트마다 네트워크를 하나 만들고, 그 안에서 서비스 이름을 DNS 이름처럼 풀어 주기 때문이다.

브라우저는 PC에 있으므로 여전히 `http://localhost:4000`이다. compose의 `ports: "4000:4000"`이 PC의 4000번을 api 컨테이너의 4000번으로 이어 준다.

| 누가 부르나 | 어디서 도나 | API 주소 |
|---|---|---|
| 브라우저의 JS | PC | `http://localhost:4000` (`NEXT_PUBLIC_API_URL`) |
| Next 서버(`auth.ts`의 `jwt` 콜백 등) | web 컨테이너 | `http://api:4000` (`API_URL`) |

`13`에서 `API_URL`(서버용)과 `NEXT_PUBLIC_API_URL`(브라우저용)을 나눠 둔 것이 여기서 쓰인다.

## 1. 준비: 구조 바꾸기

### 작업 1. [커밋] `15`의 워크스페이스를 복사

`15`의 워크스페이스 루트(`15-monitoring` 폴더로 받아 뒀다고 한다)를 현재 프로젝트 폴더의 루트에 복사해서 시작한다.

```sh
# 복사해 온 설치물·빌드 결과는 지우고 새로 만든다
rm -rf node_modules order-api-nest/dist order-console-next/.next
```

### 작업 2. [커밋] compose와 모니터링 설정을 루트로 올리기

compose와 모니터링 설정은 백엔드 한 프로젝트의 것이 아니라 전체의 것이므로 루트로 올린다.

```sh
mv order-api-nest/docker-compose.yml compose.yaml # 3단계에서 필요한 곳만 고친다
mv order-api-nest/monitoring monitoring
mkdir scripts && mv order-api-nest/scripts/alert-receiver.mjs order-api-nest/scripts/traffic.mjs scripts/
```

`order-api-nest/scripts/`에 남는 것(`stampede.mjs`, `lock-race.mjs` 등)은 백엔드의 동시성 실험이라 그대로 둔다.

옮긴 두 개는 경보 수신기와 트래픽 생성기로, 백엔드 코드가 아니라 모니터링을 확인하는 도구다.

### 남길 것

- **찾아보면 되는 것**: `cp -R`, `mv`의 인자 순서. 외울 필요 없다.

- **감각으로 남겨야 할 것**: 여러 프로젝트를 함께 띄우는 설정(compose, 모니터링)은 한 프로젝트 폴더가 아니라 그 위의 루트에 둔다. 한 프로젝트 안에 두면 다른 프로젝트를 빌드할 때 컨텍스트와 경로가 꼬인다.

- **에러 신호**: 이 단계에서는 나오지 않았다. 파일을 옮기기만 한다.

## 2. 1단계: 정리

### 작업 1. [커밋] 데모 화면과 템플릿 파일 걷어 내기

| 걷어 낸 것 | 이유 |
|---|---|
| `order-console-next/app/orders/`, `lib/api.ts` | 학습 초기의 데모 화면. Mock 데이터와 테스트 주문 버튼 |
| `app/page.tsx`의 템플릿, `public/*.svg` | `create-next-app` 기본 화면. 첫 화면은 `/shop`으로 보낸다 |
| 두 프로젝트의 템플릿 `README.md` | 루트 README 하나로 모은다(6단계) |
| `order-api-nest/scratch-client.mjs` | WebSocket 실험 파일 |
| 프론트 `.env.example`의 `DEMO_PASSWORD` | 데모 화면에서만 썼다 |

```sh
# 저장소 루트에서
rm -rf order-console-next/app/orders
rm order-console-next/lib/api.ts order-console-next/public/*.svg
rm order-console-next/README.md order-api-nest/README.md
rm order-api-nest/scratch-client.mjs
```

`public/`에는 `sw.js`(서비스 워커) 하나만 남는다. `public/*.svg`만 지우므로 `sw.js`는 그대로다.

### 작업 2. [커밋] 첫 화면을 `/shop`으로

```tsx
// order-console-next/app/page.tsx
// 템플릿 내용을 모두 지우고 이것으로 바꾼다
import { redirect } from "next/navigation";

// 첫 화면은 상점이다
export default function Home() {
  redirect("/shop");
}
```

### 작업 3. [커밋] 내비게이션·`layout.tsx`·프론트 `.env.example` 고치기

내비게이션에서 지운 화면(`/orders`)으로 가는 링크를 뺀다.

```tsx
// order-console-next/app/nav.tsx
// "주문 목록" 링크 한 줄을 지운다
    <nav className="flex gap-3">
      <Link href="/shop">상품</Link>
      <Link href="/me/orders">내 주문</Link>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
```

```tsx
// order-console-next/app/layout.tsx
// metadata의 제목·설명과 <html>의 lang만 바꾼다
export const metadata: Metadata = {
  title: "주문 콘솔",
  description: "상품 주문·결제와 실시간 알림을 다루는 학습용 서비스",
};

// ... RootLayout 안 ...
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
```

```sh
# order-console-next/.env.example
# DEMO_PASSWORD=1234 줄을 지운다

# 서버(Next)가 부르는 백엔드 주소(auth.ts에서 쓴다). 브라우저용 NEXT_PUBLIC_API_URL과 따로 둔다
API_URL=http://localhost:4000
# ... 나머지 줄 그대로 ...
```

### 작업 4. [커밋] 린트 에러 하나 고치기

WebSocket 알림을 붙인 뒤로 `npm run lint`(oxlint)에 에러가 하나 있었다.

```text
src/notifications/notifications.gateway.ts:14:7: error typescript(no-floating-promises): Promises must be awaited, add void operator to ignore.
```

기다릴 필요는 없으므로 "일부러 기다리지 않는다"고 `void`로 표시한다.

```ts
// order-api-nest/src/notifications/notifications.gateway.ts
// handleConnection 안의 socket.join 한 줄 앞에 void를 붙인다
      // 이 소켓을 "그 사용자 전용 방"에 넣는다. 기다릴 필요가 없으므로 void로 표시한다
      void socket.join(`user:${payload.sub}`);
```

```sh
# 루트에서. -w로 백엔드 워크스페이스의 lint를 부른다(루트의 npm run lint는 5단계에서 만든다)
npm run lint -w order-api-nest # 종료 코드 0
```

### 개념 | 린트는 실행 결과가 아니라 타입을 본다

`no-floating-promises`는 "Promise를 만들어 놓고 기다리지도, 에러를 받지도 않는 줄"을 잡는 규칙이다.

그런 Promise가 실패하면 에러가 어디에도 잡히지 않고 사라지거나, Node가 `unhandledRejection`으로 프로세스를 끝낸다.

이 규칙은 코드를 실행해 보지 않는다. 반환 **타입**만 본다.

socket.io의 타입 정의에서 `socket.join()`의 반환 타입은 `Promise<void> | void`다. 어댑터에 따라 Promise를 돌려줄 수도 있다는 뜻이다.

그래서 기본(메모리) 어댑터를 쓰던 때부터 이 줄은 린트 에러였고, `04`의 Redis 어댑터로 바꾼 뒤에도 그대로였다.

| 쓰는 법 | 뜻 |
|---|---|
| `await socket.join(...)` | 끝날 때까지 기다리고, 실패하면 이 함수가 에러를 던진다 |
| `void socket.join(...)` | 결과를 일부러 버린다. 기다리지 않는다는 것을 린트와 읽는 사람에게 알린다 |
| `socket.join(...)` | 같은 동작이지만, 실수로 `await`를 빠뜨린 것과 구별되지 않는다 |

> C에서 반환값을 일부러 버릴 때 `(void)write(fd, buf, n);`이라고 쓰는 것과 같은 표시다.

### 작업 5. [커밋] 타입 검사 통과시키기

타입 검사 스크립트는 아직 어디에도 없다. 루트의 `npm run typecheck`는 5단계 작업 1에서 만든다. 지금은 그 스크립트가 할 일을 워크스페이스마다 직접 친다.

```sh
# 루트에서. 백엔드 폴더에서 tsc를 실행한다
npm exec -w order-api-nest -- tsc --noEmit
test/app.e2e-spec.ts(4,21): error TS2307: Cannot find module 'supertest/types' or its corresponding type declarations.
```

백엔드는 `"type": "module"`에 `moduleResolution: "nodenext"`라서 import를 ESM 규칙으로 푼다. ESM에서는 패키지의 하위 경로도 파일 확장자까지 적어야 한다.

`@types/supertest`에는 `types.d.ts`가 있지만, `supertest/types`처럼 확장자 없이 적으면 찾지 않는다. Nest 템플릿의 e2e 테스트에서 온 줄이고, vitest는 타입을 검사하지 않으므로 e2e는 그동안 통과해 왔다.

```ts
// order-api-nest/test/app.e2e-spec.ts
// 넷째 줄의 경로 끝에 .js를 붙인다
import { App } from 'supertest/types.js';
```

```sh
# 루트에서
npm exec -w order-api-nest -- tsc --noEmit # 종료 코드 0
# next typegen은 지금 폴더에서 app/을 찾으므로 프론트 폴더로 들어가서 친다. 라우트 타입을 먼저 만든다(5단계의 용어 참고)
(cd order-console-next && npx next typegen && npx tsc --noEmit) # 종료 코드 0
```

### 남길 것

- **찾아보면 되는 것**: `metadata`의 필드 이름, `redirect()`의 import 경로, oxlint 규칙 이름, `tsc --noEmit`. 외울 필요 없다.

- **감각으로 남겨야 할 것**: 남에게 보일 프로젝트는 "학습 흔적"(데모 화면, 템플릿, 실험 스크립트)을 걷어 내고, 린트·타입 검사가 종료 코드 0인 상태에서 시작한다. 에러가 하나라도 남아 있으면 나중에 생긴 진짜 에러가 그 속에 묻힌다.

- **에러 신호**:
  - `typescript(no-floating-promises): Promises must be awaited, add void operator to ignore.` → 그 줄의 Promise를 `await`할지, `void`로 버릴지 정한다
  - 파일을 지운 뒤 프론트 타입 검사(`npx tsc --noEmit`)가 `Cannot find module` → 지운 파일(`lib/api.ts`, `app/orders/`)을 아직 import하는 곳이 있는지
  - 백엔드 타입 검사가 `error TS2307: Cannot find module 'supertest/types'` → ESM이라 하위 경로에 확장자(`.js`)가 있어야 한다
  - `next typegen`이 ``Couldn't find any `pages` or `app` directory`` → 프론트 폴더(`order-console-next/`) 밖에서 쳤다

## 3. 2단계: 웹 이미지

### 작업 1. [커밋] standalone 출력 켜기

```ts
// order-console-next/next.config.ts
// path import와 output·outputFileTracingRoot·typescript 세 항목을 더한다
// cacheComponents·partialPrefetching·turbopack·headers()는 15의 것을 그대로 둔다(지우면 빌드가 깨진다)
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 컨테이너 이미지용. server.js와 실제로 쓰는 파일만 .next/standalone에 모은다
  output: "standalone",
  // 워크스페이스라 의존성이 한 단계 위(루트의 node_modules)에 있다 → 파일을 고를 때 루트부터 본다
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // 이미지 빌드에서는 타입 검사를 건너뛴다(Dockerfile의 SKIP_TYPECHECK)
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
  // ── 여기부터 15 그대로 ──
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // 서비스 워커 파일은 브라우저 캐시에 두지 않는다
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

`output: "standalone"`이면 `next build`가 `.next/standalone/`에 `server.js`와, 실행에 실제로 쓰는 파일만 골라 담은 `node_modules`를 만든다.

워크스페이스라 의존성이 루트의 `node_modules`에 있으므로 `outputFileTracingRoot`를 루트로 준다. 파일을 고를 때 루트부터 보라는 뜻이다.

### 개념 | standalone 출력이 담는 것

`next build`는 빌드하면서 서버 코드가 실제로 `import`·`require`하는 파일을 따라가 목록을 만든다(파일 추적).

standalone은 그 목록에 든 파일만 `.next/standalone/` 아래에 복사하고, `next start` 대신 쓸 `server.js`를 만든다.

추적의 출발점이 `outputFileTracingRoot`다. 그래서 `.next/standalone/` 안의 폴더 구조가 루트 기준으로 만들어진다.

```text
.next/standalone/
├── node_modules/          # 루트 node_modules 중 서버가 실제로 쓰는 것만
└── order-console-next/
    ├── server.js          # 실행 진입점
    ├── package.json
    └── .next/             # 서버 쪽 빌드 결과
```

여기에 들어가지 않는 것이 둘 있다. 브라우저가 받아 갈 `.next/static/`(JS·CSS 청크)과 `public/`이다.

이 둘은 서버 코드가 `import`하는 파일이 아니라 파일 추적에 걸리지 않는다. 그래서 Dockerfile에서 직접 옮긴다(작업 2).

> 실행 진입점이 `order-console-next/server.js`인 것도 이 구조 때문이다. 워크스페이스가 아니었다면 `server.js`가 바로 standalone 맨 위에 생긴다.

### 개념 | 왜 이미지 빌드에서 타입 검사를 건너뛰나

`12`부터 프론트의 타입 검사는 백엔드 소스(tRPC 라우터)와 Prisma 생성 코드까지 읽는다.

웹 이미지에서 타입 검사를 하려면 백엔드 의존성 설치와 `prisma generate`까지 해야 한다.

그래서 타입 검사는 모든 소스가 갖춰진 곳(루트의 `npm run typecheck`(5단계에서 만든다), CI)에서 하고, 이미지 빌드는 번들만 만든다.

> `import type`은 번들에서 지워지므로 백엔드 소스가 없어도 빌드는 된다.

### 작업 2. [커밋] 웹 Dockerfile

```dockerfile
# order-console-next/Dockerfile
# syntax=docker/dockerfile:1
# 웹(Next) 이미지. 빌드 컨텍스트는 워크스페이스 루트다(잠금 파일이 루트에 하나뿐)

# ① 의존성(빌드 도구 포함)
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY order-console-next/package.json order-console-next/
RUN npm ci -w order-console-next

# ② 빌드
FROM deps AS build
COPY order-console-next/ order-console-next/
WORKDIR /app/order-console-next
# NEXT_PUBLIC_ 값은 이 단계에서 브라우저용 JS에 문자열로 박힌다(0장 개념 1)
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_STORAGE_URL=http://localhost:9000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    SKIP_TYPECHECK=1
# SKIP_TYPECHECK: 타입 검사는 백엔드 타입까지 갖춘 곳에서 한다(작업 1). 이미지에는 백엔드 소스를 넣지 않는다
RUN npm run build

# ③ 실행: standalone 출력은 server.js와 "실제로 쓰는 파일만" 골라 둔 node_modules를 담는다
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/order-console-next/.next/standalone ./
# 정적 파일(빌드 결과 JS·CSS)과 public은 standalone에 들어가지 않는다 → 직접 옮긴다
COPY --from=build /app/order-console-next/.next/static ./order-console-next/.next/static
COPY --from=build /app/order-console-next/public ./order-console-next/public
USER node
EXPOSE 3000
CMD ["node", "order-console-next/server.js"]
```

`# syntax=`는 주석처럼 생긴 파서 지시어라서, 그 앞에 다른 주석이 한 줄이라도 있으면 그냥 주석으로 취급된다.

#### ARG와 ENV

`ARG`는 빌드하는 동안에만 있는 값이고, `docker build --build-arg`로 덮어쓴다.

`ARG`로 선언한 값은 그 단계의 `RUN`에서도 환경변수로 보인다. 그래도 `ENV`로 한 번 더 옮겨 둔 것은, 이 단계에서 `npm run build`(곧 `next build`)가 읽을 값을 다른 빌드 설정(`NEXT_TELEMETRY_DISABLED`, `SKIP_TYPECHECK`)과 함께 한곳에 고정해 두기 위해서다.

| | 있는 동안 | 바꾸는 법 | 최종 이미지에 남나 |
|---|---|---|---|
| `ARG` | 그 단계의 빌드 중 | `--build-arg`, compose의 `build.args` | 남지 않는다 |
| `ENV` | 그 단계와, 그 단계를 `FROM`으로 이어받는 단계 | `docker run -e`, compose의 `environment`로 덮어쓴다 | 그 단계가 최종 단계면 남는다 |

`runtime` 단계는 `FROM node:24-slim`으로 새로 시작하므로 `build` 단계의 `ENV`는 넘어오지 않는다.

`NEXT_PUBLIC_API_URL`은 `runtime` 이미지의 환경변수에는 없고, `.next/static`의 JS 파일 안에 문자열로만 남는다. 실험 ①에서 그 문자열을 직접 찾아본다.

#### 멀티 스테이지로 나눈 이유

`FROM`이 나올 때마다 새 단계가 시작되고, 최종 이미지는 **마지막 단계**(`runtime`)뿐이다.

`deps`·`build` 단계에 있던 빌드 도구, 전체 `node_modules`, 소스는 `COPY --from=build`로 골라 옮긴 것 말고는 최종 이미지에 들어가지 않는다.

C로 치면 컴파일러와 헤더가 있는 빌드 머신에서 실행 파일을 만든 뒤, 실행 파일과 필요한 `.so`만 배포 서버에 올리는 것과 같다.

#### `runtime` 단계의 환경변수

- `PORT=3000`: standalone의 `server.js`가 이 포트로 듣는다.

- `HOSTNAME=0.0.0.0`: `server.js`가 들을 주소다. 0.0.0.0은 "이 컨테이너의 모든 네트워크 인터페이스"라는 뜻이다. Docker는 컨테이너마다 `HOSTNAME` 환경변수를 컨테이너 ID로 채워 두므로, 덮어쓰지 않으면 `server.js`가 그 이름에 해당하는 주소만 듣게 된다.

- `USER node`: `node` 이미지에 기본으로 있는 일반 사용자로 실행한다. 웹 서버가 root일 이유가 없다.

### 작업 3. [커밋] Dockerfile마다 전용 `.dockerignore`

`12`처럼 빌드 컨텍스트는 루트다. 그런데 API 이미지와 웹 이미지는 컨텍스트에서 필요한 것이 반대다(API는 백엔드 폴더만, 웹은 프론트 폴더만).

루트의 `.dockerignore` 하나로는 둘을 다 만족시킬 수 없다.

`npm ci -w order-console-next`는 잠금 파일에 적힌 다른 워크스페이스(`order-api-nest`)의 `package.json`이 없어도 된다. 그래서 상대 폴더는 `package.json`까지 통째로 뺀다.

상대의 `package.json`을 넣으면 그 파일이 바뀔 때마다(예: `scripts` 수정) 의존성 층의 캐시가 깨진다.

Docker(BuildKit)는 **Dockerfile 옆의** `<Dockerfile 이름>.dockerignore` 파일이 있으면 그것을 쓴다.

```text
# order-console-next/Dockerfile.dockerignore
# 웹 이미지 빌드용(Dockerfile 옆의 <이름>.dockerignore가 루트의 .dockerignore 대신 쓰인다)
**/node_modules
**/.next
**/*.tsbuildinfo
**/.env
**/.env.*
.git
monitoring
scripts
# 백엔드 폴더는 통째로 뺀다(npm ci -w order-console-next는 백엔드의 package.json이 없어도 된다)
order-api-nest
order-console-next/e2e
order-console-next/test-results
order-console-next/playwright-report
order-console-next/Dockerfile*
```

`12`의 루트 `.dockerignore`는 `order-api-nest/Dockerfile.dockerignore`로 옮기고 같은 방식으로 고친다.

```sh
mv .dockerignore order-api-nest/Dockerfile.dockerignore
```

```text
# order-api-nest/Dockerfile.dockerignore
# 루트에서 옮겨 온 내용에서 .git·monitoring·scripts·loadtest를 더하고, 프론트 폴더를 통째로 뺀다
# API 이미지 빌드용(Dockerfile 옆의 <이름>.dockerignore가 루트의 .dockerignore 대신 쓰인다)
**/node_modules
**/dist
**/.next
**/*.tsbuildinfo
**/.env
**/.env.*
.git
monitoring
scripts
order-api-nest/src/generated
order-api-nest/test
order-api-nest/scripts
order-api-nest/loadtest
order-api-nest/Dockerfile*
# 프론트 폴더는 통째로 뺀다(npm ci -w order-api-nest는 프론트의 package.json이 없어도 된다)
order-console-next
```

API Dockerfile은 고칠 것이 없다. `15`에서 이미 `deps`·`prod-deps` 단계가 백엔드의 `package.json`만 가져오므로, 위처럼 프론트 폴더를 통째로 빼도 된다.

### 개념 | 빌드 컨텍스트와 `.dockerignore`

`docker build ... .`의 마지막 `.`이 빌드 컨텍스트다. Docker는 이 폴더를 통째로 빌드 엔진에 넘기고, Dockerfile의 `COPY`는 그 안에서만 파일을 가져온다.

`.dockerignore`는 "넘기기 전에 뺄 것"의 목록이다. 빠진 파일은 `COPY`로 가져올 수 없고, 빌드 캐시의 비교 대상에서도 빠진다.

| 빼야 하는 이유 | 예 |
|---|---|
| 컨테이너 안에서 다시 만든다. 넣으면 넘기는 데 오래 걸리고 PC의 OS용 파일이 섞인다 | `**/node_modules`, `**/.next`, `**/dist` |
| 이미지에 들어가면 안 된다 | `**/.env`, `**/.env.*` |
| 바뀔 때마다 `COPY order-console-next/` 층의 캐시를 깨지만 실행에는 쓰지 않는다 | `e2e`, `test-results`, `Dockerfile*` |

두 Dockerfile이 같은 컨텍스트(루트)를 쓰면서 서로 다른 목록이 필요하므로, 루트의 `.dockerignore` 대신 Dockerfile마다 옆에 `<이름>.dockerignore`를 둔다.

### 작업 4. [실행] 이미지 빌드와 크기 확인

웹 이미지 하나만 빌드한다(루트에서). 이름은 3단계의 compose가 붙이는 것과 같게 `node-order-web`으로 준다.

```sh
docker build -t node-order-web -f order-console-next/Dockerfile .
```

빌드한 이미지의 크기와, 그 안에 무엇이 들었는지 본다. 컨테이너를 띄워 두지 않고 `docker run --rm`으로 명령 하나만 실행하고 지운다.

```sh
docker images node-order-web --format '{{.Repository}} {{.Size}}'
node-order-web 406MB

docker run --rm node-order-web sh -c 'ls /app /app/order-console-next; du -sh /app/node_modules'
/app:
node_modules
order-console-next

/app/order-console-next:
package.json
public
server.js
38M	/app/node_modules
```

`.next`도 있다(숨김 폴더라 `ls`에 안 보인다). 웹 이미지의 `node_modules`는 38MB다. standalone이 실제로 쓰는 파일만 골랐기 때문이다.

### 실험 | 일부러 깨뜨려보기 ①: 실행할 때 `NEXT_PUBLIC_` 값을 바꾸면

배포할 주소로 바꾸려고 같은 이미지를 환경변수만 바꿔 띄운다.

```sh
docker run --rm -d -p 3002:3000 -e NEXT_PUBLIC_API_URL=https://api.example.com node-order-web
curl -sI localhost:3002/shop | grep -io "connect-src[^;]*"
connect-src 'self' http://localhost:4000 http://localhost:9000  # 그대로다
docker exec <컨테이너> sh -c 'grep -rl "localhost:4000" /app/order-console-next/.next/static/chunks; grep -rl "api.example.com" /app/order-console-next/.next/static/chunks | wc -l'
/app/order-console-next/.next/static/chunks/3tqd-buvio2x9.js
0
```

브라우저가 받는 JS 파일 안에 `localhost:4000`이 **문자열로** 들어 있다.

`08`의 CSP(`proxy.ts`)도 같은 값을 쓰므로 빌드할 때 값으로 고정됐다.

빌드 인자로 넘겨야 한다.

```sh
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t node-order-web:example -f order-console-next/Dockerfile .
docker run --rm -d -p 3002:3000 node-order-web:example
# 위와 같은 curl과 grep으로 다시 확인한다
connect-src 'self' https://api.example.com http://localhost:9000
1  # api.example.com이 든 청크 파일 수
```

확인했으면 띄운 컨테이너를 멈춘다(`docker stop <컨테이너>`). `--rm`으로 띄웠으므로 멈추면 지워진다.

compose에서는 `build.args`로 넘긴다(3단계).

> 배포 주소가 정해지면 이 값으로 다시 빌드한다.

### 남길 것

- **찾아보면 되는 것**: `output: "standalone"`과 `outputFileTracingRoot`의 철자, Dockerfile의 `ARG`·`ENV`·`COPY --from` 문법, `<이름>.dockerignore` 규칙. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - `NEXT_PUBLIC_` 값은 빌드할 때 JS 파일 안에 문자열로 박힌다. 주소를 바꾸려면 `docker run -e`가 아니라 `--build-arg`로 **다시 빌드**한다.
  - standalone은 서버가 `import`하는 파일만 담는다. 브라우저가 받아 가는 `.next/static`과 `public`은 직접 옮긴다.

- **에러 신호**:
  - 이미지 빌드가 ``Route segment config "instant" requires `nextConfig.cacheComponents` to be enabled.`` → `next.config.ts`를 고치다 `15`의 `cacheComponents`를 지웠는지
  - 빌드 경고 `Unknown at rule: @theme` → `turbopack.rules`의 `@tailwindcss/turbopack`을 지웠는지. 경고뿐이라 빌드는 되지만 화면에 Tailwind 스타일이 없다
  - 웹 컨테이너가 `Cannot find module` → `CMD`의 경로. 워크스페이스에서는 `order-console-next/server.js`다
  - 화면은 뜨는데 CSS·JS가 404 → `.next/static`과 `public`을 standalone 옆으로 옮겼는지
  - 배포 주소로 바꿨는데 브라우저가 `localhost:4000`을 부른다(CSP `connect-src`도 그대로) → `NEXT_PUBLIC_` 값을 실행할 때 넘겼다. 빌드 인자로 다시 빌드한다

## 4. 3단계: compose 하나로

### 작업 1. [커밋] 루트 `compose.yaml`

1장에서 옮겨 온 `compose.yaml`은 `15`의 백엔드 폴더에 있던 것이다. 바뀌는 곳은 셋이다.

- 파일이 루트로 올라왔으므로 빌드 컨텍스트가 `..`이 아니라 `.`이다.

- 배포 주소와 비밀 값을 루트 `.env`(작업 3)에서 받도록 api의 값 몇 개를 `${...}`로 바꾼다.

- web 서비스를 더한다.

db·redis·storage·jaeger, 모니터링 셋(prometheus·alertmanager·grafana), `volumes`는 그대로 둔다.

```yaml
# compose.yaml - migrate: 컨텍스트와 시드 비밀번호(작업 7)
  migrate:
    build: { context: ., dockerfile: order-api-nest/Dockerfile, target: migrate }
    # ... profiles 그대로 ...
    environment:
      DATABASE_URL: postgresql://order:order@db:5432/order_api
      DEMO_PASSWORD: "1234" # 데모 시드의 비밀번호(작업 7)
```

```yaml
# compose.yaml - api: 컨텍스트와 environment의 세 줄
  api:
    build: { context: ., dockerfile: order-api-nest/Dockerfile, target: runtime }
    # ... profiles·init·ports 그대로 ...
    environment:
      JWT_SECRET: ${JWT_SECRET:-change-me} # 학습용 기본값. 배포할 때는 .env에 긴 무작위 값
      FRONTEND_URL: ${PUBLIC_WEB_URL:-http://localhost:3000} # CORS와 Stripe가 돌려보낼 주소
      S3_PUBLIC_ENDPOINT: ${PUBLIC_STORAGE_URL:-http://localhost:9000} # 브라우저 → 저장소(presigned URL 안의 주소)
      # ... 나머지 environment·depends_on·healthcheck 그대로 ...
```

```yaml
# compose.yaml - web: api 다음에 새로 더한다
  web:
    build:
      context: .
      dockerfile: order-console-next/Dockerfile
      # NEXT_PUBLIC_ 값은 빌드할 때 넘긴다(2단계 실험 ①)
      args:
        NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL:-http://localhost:4000}
        NEXT_PUBLIC_STORAGE_URL: ${PUBLIC_STORAGE_URL:-http://localhost:9000}
    profiles: ["app"]
    init: true
    ports:
      - "3000:3000"
    environment:
      # 아래는 서버(Next)가 "실행할 때" 읽는 값
      API_URL: http://api:4000 # Next 서버 → API(컨테이너 안의 주소, jwt 콜백에서 쓴다)
      AUTH_URL: ${PUBLIC_WEB_URL:-http://localhost:3000}
      AUTH_SECRET: ${AUTH_SECRET:-}
      AUTH_GITHUB_ID: ${GITHUB_CLIENT_ID:-} # 같은 OAuth 앱이라 .env에 한 번만 적는다
      AUTH_GITHUB_SECRET: ${GITHUB_CLIENT_SECRET:-}
    depends_on:
      api: { condition: service_healthy }
```

고친 뒤 파일 전체가 올바른지는 띄우지 않고 확인한다.

```sh
docker compose --profile app --profile monitoring config --services
# db, redis, storage, jaeger, migrate, api, web, prometheus, alertmanager, grafana (순서는 다를 수 있다)
```

| 명령 | 뜨는 것 |
|---|---|
| `docker compose up -d` | db, redis, storage, jaeger. 개발할 때(앱은 PC에서 npm으로) |
| `docker compose --profile app up -d --build` | + migrate(한 번 실행), api, web |
| `docker compose --profile app --profile monitoring up -d` | + prometheus, alertmanager, grafana |

### 작업 2. [커밋] Prometheus가 컨테이너의 API를 보게 하기

`15`의 `monitoring/prometheus.yml`은 PC의 API(`host.docker.internal:4000`)를 보고 있었다.

완성본에서는 컨테이너의 API를 보도록 `api:4000`으로 바꾼다.

```yaml
# monitoring/prometheus.yml
# scrape_configs의 targets 한 줄을 바꾼다
scrape_configs:
  - job_name: order-api
    static_configs:
      # compose의 --profile app으로 띄운 API. PC에서 npm으로 띄운 API를 보려면 "host.docker.internal:4000"
      - targets: ["api:4000"]
```

prometheus도 같은 compose 프로젝트의 네트워크에 있으므로 서비스 이름 `api`로 닿는다(0장 개념 2).

### 용어 | Compose 문법

`profiles`, `depends_on`의 `condition`, `extra_hosts`는 `07`·`15`에서 다뤘다.

- 프로젝트 이름: 파일에 `name:` 줄이 없으므로 compose 파일이 있는 폴더 이름이 프로젝트 이름이다(`node-order/compose.yaml`이면 `node-order`). 빌드한 이미지와 볼륨 이름 앞에 붙는다(`node-order-web` 등). 아래 "프로젝트 이름이 정하는 것"에서 다룬다.

- `${이름:-기본값}`: `.env`나 셸의 환경변수 값을 넣고, 값이 없거나 비어 있으면 기본값을 쓴다. `${이름:-}`은 없으면 빈 값이다. 값이 어디서 오는지는 아래 "`${...}`는 compose가 파일을 읽을 때 채운다"에서 다룬다.

- `build.args`: Dockerfile의 `ARG`에 넘기는 빌드 인자다. `docker build --build-arg`와 같다. `environment`와 달리 빌드할 때만 쓰이는 값이다(0장 개념 1, 2단계 작업 2).

- `build.target`: 멀티 스테이지 Dockerfile에서 어느 단계까지 빌드할지 고른다. `migrate`와 `api`는 같은 Dockerfile의 다른 단계(`migrate`/`runtime`)다.

### 개념 | 이 파일의 시작 순서

`--profile app`으로 띄우면 `depends_on`의 `condition`이 순서를 정한다.

```text
db (healthy: pg_isready)
 └─▶ migrate (끝까지 실행하고 종료 코드 0)
      └─▶ api (healthy: /health/ready가 2xx)   ◀── redis, storage (started)
           └─▶ web
```

| condition | 기다리는 것 |
|---|---|
| `service_started` | 컨테이너가 시작되기만 하면 된다 |
| `service_healthy` | 그 서비스의 `healthcheck`가 통과할 때까지 |
| `service_completed_successfully` | 그 서비스가 **끝나고** 종료 코드가 0일 때까지 |

앞 칸이 막히면 뒤는 하나도 뜨지 않는다.

마이그레이션이 실패하면 api가 뜨지 않고, api의 `/health/ready`가 계속 실패하면(`retries: 6`번) web도 뜨지 않는다. 8장 진단 1이 이 순서를 거꾸로 따라간다.

`init: true`는 컨테이너의 1번 프로세스로 작은 init을 두어, `docker stop`의 종료 신호가 node까지 전달되게 한다(`07`에서 다룬 것).

### 개념 | 프로젝트 이름이 정하는 것

compose는 이 파일로 만드는 모든 것(컨테이너, 이미지, 네트워크, 볼륨)에 프로젝트 이름을 앞에 붙인다.

이 파일에는 `name:` 줄이 없으므로 compose 파일이 있는 **폴더 이름**이 프로젝트 이름이 된다. `node-order/compose.yaml`이면 `node-order`다.

`docker compose config`는 컨테이너를 띄우지 않고, compose가 파일을 해석한 최종 결과만 보여 준다.

```sh
docker compose config | grep -E '^name:|name: node-order_'
name: node-order
    name: node-order_default
    name: node-order_pgdata
    name: node-order_storagedata
```

같은 파일을 `15-monitoring` 폴더에 두면 이름이 폴더를 따라간다.

```sh
docker compose config | grep -E '^name:|_pgdata'
name: 15-monitoring
    name: 15-monitoring_pgdata
```

| 바뀌는 것 | 결과 |
|---|---|
| 폴더 이름(또는 `name:`, `-p`) | 다른 프로젝트가 된다 |
| 볼륨 `pgdata` | 실제로는 `<프로젝트>_pgdata`라서 새 이름의 빈 볼륨이 생긴다 |
| 네트워크 `default` | `<프로젝트>_default`. 서비스 이름(`api`)은 이 네트워크 안에서 찾는다(0장 개념 2) |

- 그래서 compose 파일이 있는 폴더 이름(`node-order`)을 바꾸지 않아야 같은 볼륨·이미지 이름이 이어진다.

- 반대로 이름이 바뀌면 이전 DB 볼륨은 지워지지 않고 남아 있을 뿐, 새 프로젝트에서는 보이지 않는다.

> 폴더 이름을 바꾸거나 저장소를 다른 이름으로 받은 뒤 데이터가 사라진 것처럼 보이면, 먼저 `docker volume ls`로 다른 프로젝트 이름의 볼륨이 남아 있는지 본다.

### 개념 | `${...}`는 compose가 파일을 읽을 때 채운다

`${이름:-기본값}`은 컨테이너 안에서 풀리는 것이 아니다.

**compose가 이 파일을 읽는 순간** 문자열로 바뀌고, 컨테이너는 바뀐 결과만 받는다. 값을 찾는 순서는 다음과 같다.

1. `docker compose`를 실행한 셸의 환경변수

2. compose 파일과 같은 폴더의 `.env`

3. `:-` 뒤의 기본값

`.env`가 없을 때, 있을 때, 셸 변수까지 줄 때를 `docker compose config`로 비교했다.

`.env`에는 `GITHUB_CLIENT_ID=abc`, `STRIPE_SECRET_KEY=sk_test_x`, `PUBLIC_API_URL=https://api.example.com`, 그리고 compose 파일 어디에서도 쓰지 않는 `UNUSED=1`을 넣었다.

```sh
docker compose --profile app config | grep -E 'STRIPE_SECRET_KEY|NEXT_PUBLIC_API_URL|AUTH_GITHUB_ID|UNUSED'
# .env 없음
      STRIPE_SECRET_KEY: ""
        NEXT_PUBLIC_API_URL: http://localhost:4000
      AUTH_GITHUB_ID: ""
# .env 있음
      STRIPE_SECRET_KEY: sk_test_x
        NEXT_PUBLIC_API_URL: https://api.example.com
      AUTH_GITHUB_ID: abc

PUBLIC_API_URL=https://shell.example.com docker compose --profile app config | grep NEXT_PUBLIC_API_URL
        NEXT_PUBLIC_API_URL: https://shell.example.com
```

- 셸 변수가 `.env`보다 앞선다. 셸에 예전 값이 남아 있으면 `.env`를 고쳐도 반영되지 않는다.

- `.env`의 값이 컨테이너에 저절로 들어가지는 않는다. `UNUSED`는 어느 서비스에도 나타나지 않았다. `environment`나 `build.args`에 `${...}`로 적은 것만 들어간다.

- 그래서 `.env`의 `GITHUB_CLIENT_ID` 하나를 api에는 같은 이름으로, web에는 `AUTH_GITHUB_ID`라는 다른 이름으로 나눠 줄 수 있다.

- 무엇이 들어갔는지 헷갈리면 띄우기 전에 `docker compose config`로 최종 결과를 본다. 비밀 값도 그대로 찍히므로 화면 공유나 로그에 남기지 않는다.

> C의 전처리기가 컴파일 전에 `#define`을 펼쳐 놓듯, compose는 실행 전에 `${...}`를 펼쳐 놓는다. 펼친 결과는 `docker compose config`가 보여 준다.

### 작업 3. [커밋] 비밀 값은 루트 `.env` 하나에

compose는 **같은 폴더의** `.env`를 자동으로 읽어 `${...}` 자리에 넣는다.

`13`·`14`에서는 비밀 값이 백엔드와 프론트의 `.env.local`에 나뉘어 있었고, GitHub 값은 양쪽에 두 번 적혀 있었다.

완성본에서는 루트 `.env` 하나에 적고, compose가 각 서비스에 나눠 준다(`AUTH_GITHUB_ID: ${GITHUB_CLIENT_ID:-}`).

견본 `.env.example`을 루트에 만든다.

```sh
# .env.example
# compose.yaml이 읽는 값. cp .env.example .env 로 만들어 채운다. .env는 커밋하지 않는다
# 비워 두면 그 기능만 동작하지 않는다(GitHub 로그인, Stripe 결제). 나머지는 정상이다

# Auth.js 세션 쿠키 암호화 키 - openssl rand -base64 32
AUTH_SECRET=
# GitHub OAuth 앱(콜백: <PUBLIC_WEB_URL>/api/auth/callback/github) - API와 웹이 같은 값을 쓴다
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
# Stripe 테스트 모드. 웹훅 비밀은 stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# 배포할 때만 바꾼다. 비우면 로컬 주소를 쓴다
# JWT_SECRET=
# PUBLIC_WEB_URL=https://shop.example.com
# PUBLIC_API_URL=https://api.example.com
# PUBLIC_STORAGE_URL=https://files.example.com
```

```sh
cp .env.example .env # 가진 값만 채운다. 비워 둬도 GitHub 로그인·결제만 빼고 뜬다
```

### 실험 | 일부러 깨뜨려보기 ②: `.gitignore`의 `.env` 한 줄

루트 `.env`를 커밋하지 않으려고, 루트 `.gitignore`에 `.env`를 적었다.

```text
# .gitignore
node_modules
# 비밀 값
.env
```

```sh
git check-ignore -v order-api-nest/.env
.gitignore:3:.env	order-api-nest/.env
```

`/`가 없는 패턴은 **모든 깊이**에 걸린다. 지금까지 커밋해 온 `order-api-nest/.env`(학습용 데모 값, `JWT_SECRET=change-me` 등)까지 빠진다.

그러면 저장소를 새로 받은 사람은 `.env` 없이 시작하고, 백엔드 테스트는 설정 단계에서 바로 멈춘다.

`test/setup-env.ts`의 첫 줄 `process.loadEnvFile()`이 읽을 파일이 없기 때문이다(`Error: ENOENT: no such file or directory, open '.env'`).

이 실험을 적용한 `.gitignore`는 `practice/break-gitignore-env/node-order/.gitignore`에 있다.

### 작업 4. [커밋] 루트 `.gitignore`는 `/.env`로

이 폴더의 `.env`만 뜻하려면 앞에 `/`를 붙인다. 1장에서 복사해 온 루트 `.gitignore`의 내용을 이것으로 바꾼다.

```text
# .gitignore
node_modules
# 비밀 값(이 문서). 맨 앞의 / : 이 폴더의 .env만 - order-api-nest/.env(학습용 데모 값)는 그대로 커밋한다
/.env
```

```sh
git check-ignore -v order-api-nest/.env || echo "커밋 대상"
커밋 대상
git check-ignore -q .env && echo "무시됨"
무시됨
```

| 패턴 | 걸리는 것 |
|---|---|
| `.env` | 이 폴더와 그 아래 모든 폴더의 `.env` |
| `/.env` | 이 `.gitignore`가 있는 폴더의 `.env`만 |
| `**/.env` | `.env`와 같다(모든 깊이) |

각 프로젝트 폴더(`order-api-nest`, `order-console-next`)에는 자기 `.gitignore`가 따로 있어서 `.env.local` 같은 것은 거기서 뺀다.

### 작업 5. [실행] 앱 띄우기

```sh
docker compose --profile app up -d --build
✔ api  Healthy    ✔ web  Started
```

처음에는 이미지 셋(migrate, api, web)을 빌드하느라 오래 걸린다. api가 `Healthy`가 될 때까지 web은 기다린다(위 "이 파일의 시작 순서").

### 작업 6. [확인] 서버끼리는 서비스 이름으로 닿는지 확인

웹 서비스의 `API_URL: http://api:4000`이 0장 개념 2의 내용이다. 웹 컨테이너 안에서 확인한다.

```sh
docker compose --profile app exec -T web node -e 'fetch(process.env.API_URL + "/health/ready").then(async r => console.log(r.status, await r.text()))'
# 200 {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}

docker compose --profile app exec -T web node -e 'fetch("http://localhost:4000/health").catch(e => console.log(e.cause?.code))'
# ECONNREFUSED
```

`13`의 GitHub 로그인에서 Next 서버가 Nest의 `/auth/github`를 부르는 곳(`auth.ts`의 `jwt` 콜백)이 이 주소를 쓴다.

> `localhost`로 두었다면 로그인할 때마다 이 연결 거부가 났을 것이다.

### 작업 7. [커밋] 데모 데이터 넣기

시드는 표를 비우고 다시 채운다(`TRUNCATE`). 배포 흐름(`migrate` 서비스의 기본 명령)에는 넣지 않고, 로컬에서 손으로 실행한다.

`migrate` 이미지는 `build` 단계를 이어받아 prisma CLI가 들어 있으므로, 명령만 바꿔 시드를 돌릴 수 있다.

시드는 데모 사용자의 비밀번호를 `DEMO_PASSWORD`에서 읽는다(`prisma/seed.ts`의 `hashPassword(process.env.DEMO_PASSWORD!)`). 이미지에는 `.env`가 들어가지 않으므로(`Dockerfile.dockerignore`의 `**/.env`) 작업 1에서 `migrate`의 `environment`에 넣어 두었다.

```sh
docker compose --profile app run --rm migrate npx prisma db seed
Running seed command `tsx prisma/seed.ts` ...
Error: Command failed with ENOENT: tsx prisma/seed.ts
spawn tsx ENOENT
```

시드 명령(`prisma7.config.ts`의 `seed: "tsx prisma/seed.ts"`)이 쓰는 `tsx`가 `package.json`에 없다.

PC에서는 전역으로 깔린 `tsx`(`which tsx`)가 대신 잡혀서 돌았지만, 이미지에는 `package-lock.json`에 적힌 것만 설치된다. 백엔드의 개발 의존성으로 더한다.

```sh
# 루트에서. order-api-nest/package.json의 devDependencies와 package-lock.json이 바뀐다
npm install -D tsx -w order-api-nest
```

`migrate` 이미지를 다시 빌드해야 새 의존성이 들어간다(`--build`).

```sh
docker compose --profile app run --rm --build migrate npx prisma db seed
seed 완료: 사용자 4 명, 주문 5 건, 상품 4 개
```

### 남길 것

- **찾아보면 되는 것**: `depends_on`의 세 가지 `condition`, `${이름:-기본값}` 문법, `.gitignore`의 `/` 규칙, `docker compose config`·`run --rm`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 컨테이너 안의 `localhost`는 그 컨테이너 자신이다. 서버끼리는 서비스 이름(`api`), 브라우저는 PC의 포트(`localhost:4000`)로 부른다.
  - `${...}`는 compose가 파일을 읽을 때 펼친다. 셸 변수가 `.env`보다 앞서고, `environment`·`build.args`에 적은 것만 컨테이너에 들어간다. 헷갈리면 `docker compose config`로 펼친 결과를 본다.

- **에러 신호**:
  - 웹 로그에 `ECONNREFUSED`, GitHub 로그인 직후 실패 → `API_URL`이 `localhost`인지. 컨테이너에서는 `http://api:4000`
  - 새로 받은 저장소에서 백엔드 테스트가 `ENOENT: no such file or directory, open '.env'` → `.gitignore`의 `.env`가 `order-api-nest/.env`까지 뺐는지(`git check-ignore -v`)
  - `migrate`로 시드가 `spawn tsx ENOENT` → `tsx`가 백엔드 `package.json`에 있는지(PC의 전역 `tsx`는 이미지에 없다), 더한 뒤 `--build`로 다시 빌드했는지
  - `.env`를 고쳤는데 반영이 안 된다 → 셸에 같은 이름의 변수가 남아 있는지, compose 파일과 같은 폴더의 `.env`인지(다른 폴더에서 `-f`로 실행했다면 `--env-file`)
  - 폴더 이름을 바꾼 뒤 DB가 빈 것처럼 보인다 → `docker volume ls`로 옛 프로젝트 이름의 볼륨이 남아 있는지

## 5. 4단계: 컨테이너를 대상으로 e2e, 새 DB와 같은 Stripe 계정

### 작업 1. [확인] 컨테이너를 대상으로 프론트 e2e 돌리기

전체를 컨테이너로 띄운 채(3단계 작업 5) 루트에서 프론트 e2e를 돌린다.

```sh
# 루트에서. -w로 프론트 워크스페이스의 test:e2e를 부른다(루트의 npm run test:web은 5단계에서 만든다)
npm run test:e2e -w order-console-next
```

```text
Running 12 tests using 1 worker
  ...
  ✓   8 e2e/shop.spec.ts:64:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (1.8s)
  -   9 e2e/stripe-payment.spec.ts:6:5 › 테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다
  ...
  1 skipped
  11 passed (7.9s)
```

건너뛴 하나는 실제 Stripe로 결제하는 테스트다. `STRIPE_E2E=1`일 때만 돈다(5단계에서 돌린다).

### 개념 | 프론트 e2e가 컨테이너를 대상으로 도는 이유

`playwright.config.ts`의 `webServer`는 `reuseExistingServer: true`다.

```ts
// order-console-next/playwright.config.ts (읽기만 한다)
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000, // 빌드 시간까지 기다린다
  },
```

Playwright는 테스트 전에 `url`에 요청을 보내 본다. 이미 응답하는 서버가 있으면 `command`를 실행하지 않고 그 서버를 쓴다.

compose의 web이 PC의 3000번을 쥐고 있으므로, 테스트는 컨테이너의 web을 상대하고, 그 web은 컨테이너의 api(`API_URL: http://api:4000`)를 부른다.

반대로 compose를 내린 상태라면 Playwright가 PC에서 `npm run build && npm run start`로 직접 띄운다. 어느 쪽을 테스트했는지는 3000번에 무엇이 떠 있었느냐로 정해진다.

### 개념 | Stripe 멱등 키는 계정 전체에서 하나다

완성본은 새 DB라서 주문 번호가 다시 1부터 시작한다. 그래도 위의 결제 테스트(8번)가 통과하는 것은 Stripe 멱등 키를 주문 번호만으로 만들지 않기 때문이다.

Stripe 멱등 키는 DB가 아니라 **Stripe 계정 전체**에서 하나다. 같은 테스트 키(`STRIPE_SECRET_KEY`)를 쓰는 환경은 모두 같은 키 공간을 나눠 쓴다.

키가 `checkout-order-7`처럼 주문 번호뿐이었다면, 새 DB의 주문 #7이 이전 DB에서 이미 쓴 키를 다른 금액으로 다시 요청해 `StripeIdempotencyError`가 난다.

`15`의 코드는 주문 번호 대신 결제 시도 키를 쓴다. 결제 시도 키는 사용자, 프론트가 만든 `Idempotency-Key`, 주문 번호를 함께 해시한 값이다.

```ts
// order-api-nest/src/orders/orders.service.ts (checkout 안, 읽기만 한다)
    const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");

// order-api-nest/src/payments/stripe.gateway.ts (createCheckoutSession 안)
      attemptKey ? { idempotencyKey: `checkout-${attemptKey}` } : undefined,
```

- 같은 결제 시도(같은 사용자, 같은 `Idempotency-Key`)면 같은 주문이 돌아오므로 키도 같다. Stripe는 처음 만든 결제 화면을 그대로 돌려준다.

- 다른 DB·환경의 주문 #7과는 `Idempotency-Key`(프론트가 만든 UUID)가 달라 겹치지 않는다.

- 주문 번호를 함께 넣는 것은, 결제 세션 생성이 실패해 주문을 취소하면 같은 `Idempotency-Key`의 재시도가 새 주문이 되고 새 주문에는 새 세션이 필요하기 때문이다.

Mock Stripe를 쓰는 테스트로는 이 문제가 잡히지 않는다. **여러 환경이 실제 외부 서비스 계정 하나를 함께 쓸 때만 드러난다.**

> 완성본을 운영과 같은 구성으로 띄워 실제 서비스까지 이어 본 이유가 여기에 있다.

### 남길 것

- **찾아보면 되는 것**: Playwright `webServer`의 옵션 이름, Stripe SDK의 `idempotencyKey` 위치. 외울 필요 없다.

- **감각으로 남겨야 할 것**: 외부 서비스의 멱등 키·식별자는 그 서비스의 계정 전체에서 유일해야 한다. DB마다 1부터 다시 세는 번호(주문 id)만으로 만들면 새 DB, 다른 환경, 테스트 DB의 같은 번호와 부딪힌다.

- **에러 신호**:
  - 결제가 500, API 로그에 `StripeIdempotencyError: Keys for idempotent requests can only be used with the same parameters they were first used with.` → Stripe 멱등 키를 무엇으로 만드는지(주문 번호만이면 다른 환경과 겹친다). 이때 결제 e2e는 `page.waitForURL: Test timeout of 30000ms exceeded.`로 보이므로 화면이 아니라 API 로그부터 본다

## 6. 5단계: 전체 확인

### 작업 1. [커밋] 루트 `package.json`에 확인 명령 모으기

```json
// package.json
// `15`에서 가져온 파일(name은 node-order 그대로)에 scripts를 더한다
{
  "name": "node-order",
  "private": true,
  "workspaces": [
    "order-api-nest",
    "order-console-next"
  ],
  "scripts": {
    "dev:api": "npm run start:dev -w order-api-nest",
    "dev:web": "npm run dev -w order-console-next",
    "lint": "npm run lint -w order-api-nest && npm run lint -w order-console-next",
    "typecheck": "npm exec -w order-api-nest -- tsc --noEmit && cd order-console-next && npx next typegen && npx tsc --noEmit",
    "test:api": "npm run test -w order-api-nest && npm run test:e2e -w order-api-nest",
    "test:web": "npm run test:e2e -w order-console-next",
    "test:rules": "docker run --rm -v \"$PWD/monitoring:/m\" --entrypoint promtool prom/prometheus:latest test rules /m/alert-rules.test.yml"
  }
}
```

### 용어 | npm 워크스페이스 명령

- `npm run <스크립트> -w <워크스페이스>`: 그 워크스페이스의 `package.json`에 있는 스크립트를, 그 폴더에서 실행한다.

- `npm exec -w <워크스페이스> -- <명령>`: 그 워크스페이스 폴더에서 `node_modules/.bin`의 명령을 실행한다(`npx`의 워크스페이스판).

- `next typegen`: Next가 라우트 타입(`LayoutProps<"/">` 같은 것)을 만든다. `next build` 없이 `tsc`만 돌리면 이 타입이 없어서 먼저 만든다.

### 작업 2. [실행] 전체 확인 돌리기

`npm run test:api`의 e2e는 컨테이너가 아니라 PC에서 돌고, 개발 DB를 지우지 않도록 테스트 전용 DB(`order_api_test`)를 쓴다(`order-api-nest/.env`의 `TEST_DATABASE_URL`).

compose의 db는 3단계에서 새 볼륨으로 떴으므로 이 DB가 아직 없다. 처음 한 번 만들고 마이그레이션을 적용한다.

```sh
# 루트에서
docker compose exec db createdb -U order order_api_test
# prisma7.config.ts는 ADMIN_DATABASE_URL을 먼저 읽으므로 이 값을 테스트 DB로 바꿔 실행한다
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
All migrations have been successfully applied.
```

그다음 전체를 확인한다.

```sh
npm run lint # 종료 코드 0
npm run typecheck # 종료 코드 0
npm run test:api # 단위 1 passed / e2e Test Files 9 passed, Tests 30 passed
docker compose --profile app up -d --build
npm run test:web # 컨테이너의 web·api를 대상으로 11 passed, 1 skipped
# order-console-next에서, 다른 터미널에 stripe listen을 켜고
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
  ✓ 테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다 (6.7s)
# stripe listen 터미널
<--  [200] POST http://localhost:4000/payments/webhook [evt_...]
docker compose --profile app --profile monitoring up -d
# Prometheus 대상: http://api:4000/metrics up
# 규칙: ApiDown=inactive, HighErrorRate=inactive, OutboxBacklog=inactive
# Grafana 대시보드: "order-api"
curl -s localhost:16686/api/v3/services
{"services":["order-api","jaeger"]}
npm run test:rules # SUCCESS
```

`npm run test:web`의 `1 skipped`는 `e2e/stripe-payment.spec.ts`다. 이 파일은 `test.skip(!process.env.STRIPE_E2E, ...)`로 `STRIPE_E2E=1`일 때만 돈다.


### 개념 | 확인하지 못한 것: GitHub 승인 흐름

GitHub 로그인의 실제 승인 흐름은 사람이 GitHub에서 눌러야 해서 컨테이너 구성에서는 하지 않았다.

`13`에서 PC 실행으로 확인한 흐름과 달라지는 곳은 서버 간 주소(`API_URL`)뿐이고, 그 경로는 3단계 작업 6에서 확인했다.

GitHub로 보내는 주소는 프론트 e2e(`github-login.spec.ts`)가 컨테이너 대상으로 통과했다.

> 확인하지 못한 것은 확인하지 못했다고 적는다. 무엇이 확인됐고 무엇이 남았는지가 분명해야 다음 사람이 남은 부분만 확인한다.

### 남길 것

- **찾아보면 되는 것**: `-w`, `npm exec --`, `promtool test rules`의 인자. 외울 필요 없다.

- **감각으로 남겨야 할 것**: "다 된다"는 말 대신, 루트에서 한 줄로 돌릴 수 있는 확인 명령을 남긴다. 그리고 그 명령이 무엇을 상대로 도는지(PC인지 컨테이너인지)를 안다.

- **에러 신호**:
  - `npm run test:api`의 e2e가 거의 다 실패하고 ``database "order_api_test" does not exist`` → 테스트 DB를 만들고 마이그레이션을 적용했는지(compose의 db가 새 볼륨이면 다시 만든다)
  - `npm run test:web`이 기대와 다른 코드를 테스트한다 → 3000번에 무엇이 떠 있는지(`reuseExistingServer: true`라 이미 떠 있는 서버를 쓴다)
  - 실제 Stripe e2e에서 웹훅이 안 온다 → `stripe listen`이 켜져 있고 `--forward-to localhost:4000/payments/webhook`인지, `.env`의 `STRIPE_WEBHOOK_SECRET`이 그 `stripe listen`의 비밀인지

## 7. 6단계: README

### 작업 1. [커밋] 루트 `README.md` 쓰기

이 프로젝트는 `node-order` 저장소의 다음 브랜치가 되므로, README도 다른 브랜치(`15-monitoring` 등)와 같은 틀로 쓴다. 저장소를 처음 보는 사람은 브랜치를 옮겨 다니며 같은 자리에서 같은 것을 찾는다.

| 절 | 담은 것 |
|---|---|
| 제목·배지·시작 브랜치·한 문단 | `# 16: 배포 준비`, 이 단계의 스택, 출발한 `15-monitoring` 링크, 전에는 어땠고 이 단계에서 무엇이 바뀌는지 |
| 지원 범위 | 이 브랜치가 `15`에 더한 것(웹 이미지, 루트 compose와 프로필, 루트 `.env`, 전용 `.dockerignore`, 확인 명령, 정리). 맨 끝에 `15`까지의 기능은 그대로라는 것과 아직 안 되는 것 |
| 구성 | 이 브랜치에서 생기거나 바뀐 파일만 담은 폴더 트리 |
| 실행 | 전체를 컨테이너로(주소 표 포함) / 개발 모드 |
| 테스트 | 테스트 DB 준비, `npm run lint`부터 `test:rules`까지, 실제 Stripe e2e |
| 정리 | `down`과 `down -v` |

지원 범위의 한 항목은 이렇게 쓴다. 기능 이름만이 아니라 그 기능이 어떻게 동작하는지(성질)까지 적는다.

```md
<!-- README.md -->
- 웹 이미지 `order-console-next/Dockerfile`

  - `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL`은 빌드할 때 브라우저용 JS에 박히므로 빌드 인자로 넘김. 실행할 때 환경변수로 바꿔도 반영되지 않음
```

다 쓴 뒤 README의 "실행"과 "테스트" 명령을 위에서부터 그대로 쳐 본다. 이 문서의 단계에서 이미 띄워 둔 상태에 기대는 명령(띄운 컨테이너, 만들어 둔 테스트 DB)이 README에 빠져 있지 않은지 여기서 드러난다.

### 개념 | 기능 이름 대신 동작과 그 확인

"standalone 이미지, compose 프로필, 루트 `.env`"처럼 이름만 늘어놓으면 읽는 사람은 그게 어떻게 동작하는지 알 수 없다.

"`NEXT_PUBLIC_` 값은 빌드할 때 박히므로 실행할 때 바꿔도 반영되지 않음"처럼 **동작**을 적고, "테스트" 절에서 무엇으로 확인하는지 적으면 직접 돌려 볼 수 있는 주장이 된다.

README에는 아직 안 되는 것도 적는다. 예를 들어 이 프로젝트의 웹 화면은 WebSocket 알림을 구독하지 않고, 백엔드 기능으로만 있다.

> 쓰지 않으면 읽는 사람은 화면에서 알림을 찾다가 README를 믿지 않게 된다.

### 남길 것

- **찾아보면 되는 것**: Markdown 표 문법, shields.io 배지 주소. 외울 필요 없다.

- **감각으로 남겨야 할 것**: 같은 저장소의 브랜치는 README의 틀을 맞춘다. 그리고 그 안의 주장은 "돌려 볼 수 있는 것"으로 쓴다. 동작을 적고 확인 명령을 짝지어 두고, 아직 안 되는 것도 적는다.

- **에러 신호**:
  - README대로 따라 했는데 띄우는 순서에서 막힌다 → README의 명령을 새로 받은 폴더에서 처음부터 다시 돌려 봤는지(`cp .env.example .env`부터)

## 8. 디버깅

메시지를 외우는 게 아니라, 증상이 어느 칸(어느 컨테이너, 어느 값)으로 가는지만 익히면 된다.

### 진단 1. 어느 컨테이너에서 멈췄나

3단계의 시작 순서(db → migrate → api → web)를 거꾸로 따라간다.

```sh
docker compose --profile app ps -a # 각 서비스의 상태. migrate는 끝나면 Exited (0)이 정상이다
docker compose --profile app logs migrate
docker compose --profile app logs api
docker compose --profile app logs web
```

| 보이는 상태 | 먼저 볼 곳 |
|---|---|
| web이 없거나 `Created`에 머문다 | api가 `healthy`가 아니다. api 로그와 `/health/ready` |
| api가 없다 | migrate가 0이 아닌 코드로 끝났다. migrate 로그 |
| api가 `unhealthy` | `/health/ready`가 db·redis·storage 중 하나에 닿지 못한다. 응답의 `checks` |
| web이 `Exited`, 로그에 `Cannot find module` | Dockerfile의 `CMD` 경로(2단계) |

### 진단 2. compose가 실제로 넘긴 값 보기

값이 이상하면 컨테이너 안이 아니라 compose가 펼친 결과부터 본다.

```sh
docker compose --profile app config | grep -E 'API_URL|AUTH_URL|DEMO_PASSWORD'
docker compose --profile app exec -T web printenv API_URL
http://api:4000
```

`config` 결과에 기대한 값이 없으면 `.env`의 위치와 셸 변수를, 결과는 맞는데 동작이 이상하면 그 값을 읽는 코드를 본다.

### 진단 3. 브라우저용 JS에 박힌 값 보기

브라우저가 엉뚱한 주소를 부르면 `NEXT_PUBLIC_` 값이 빌드 때 무엇으로 박혔는지 본다(2단계 실험 ①).

```sh
docker compose --profile app exec -T web sh -c 'grep -rl "localhost:4000" /app/order-console-next/.next/static/chunks'
```

여기에 옛 주소가 나오면 실행 환경변수가 아니라 빌드 인자(`PUBLIC_API_URL`, `build.args`)를 고치고 `--build`로 다시 빌드한다.

### 진단 4. 에러 신호 표

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `typescript(no-floating-promises): Promises must be awaited, add void operator to ignore.` | 기다리지도 버리지도 않은 Promise | 그 줄을 `await`할지 `void`로 버릴지 (1단계) |
| 파일을 지운 뒤 `Cannot find module`(타입 검사) | 지운 파일을 아직 import한다 | `lib/api.ts`, `app/orders/`를 쓰는 곳 (1단계) |
| 백엔드 타입 검사가 `error TS2307: Cannot find module 'supertest/types'` | ESM에서 확장자 없는 하위 경로를 찾지 못한다 | import 경로 끝의 `.js` (1단계 작업 5) |
| `next typegen`이 ``Couldn't find any `pages` or `app` directory`` | 지금 폴더에 `app/`이 없다. 다른 폴더에서 쳤다 | `order-console-next/`에서 쳤는지 (1단계 작업 5) |
| 이미지 빌드가 `Route segment config "instant" requires ... cacheComponents ...` | `next.config.ts`에서 `cacheComponents`가 빠졌다 | `15`의 설정을 남겼는지 (2단계 작업 1) |
| 빌드 경고 `Unknown at rule: @theme` | Tailwind가 CSS를 처리하지 않았다 | `turbopack.rules`의 `@tailwindcss/turbopack` (2단계 작업 1) |
| 웹 컨테이너가 `Cannot find module` | standalone의 `server.js` 위치 | `CMD`가 `order-console-next/server.js`인지 (2단계) |
| 화면은 뜨는데 CSS·JS가 404 | `.next/static`과 `public`이 이미지에 없다 | Dockerfile의 두 `COPY --from=build` (2단계) |
| 배포 주소로 바꿨는데 브라우저가 `localhost:4000`을 부른다 | `NEXT_PUBLIC_` 값을 실행할 때 넘겼다 | 빌드 인자로 다시 빌드 (2단계 실험 ①) |
| GitHub 로그인 직후 실패, 웹 로그에 `ECONNREFUSED` | 웹 컨테이너가 자기 자신의 4000번을 불렀다 | `API_URL`이 `http://api:4000`인지 (3단계 작업 6) |
| 새로 받은 저장소에서 백엔드 테스트가 `ENOENT: no such file or directory, open '.env'` | `.gitignore`의 `.env`가 `order-api-nest/.env`까지 뺐다 | `git check-ignore -v order-api-nest/.env` (3단계 실험 ②) |
| `migrate`로 시드가 `spawn tsx ENOENT` | 시드 명령의 `tsx`가 이미지에 없다. PC에서는 전역 `tsx`가 대신 돌았다 | 백엔드 `devDependencies`의 `tsx`, `--build` (3단계 작업 7) |
| `.env`를 고쳤는데 compose가 안 쓴다 | 셸 변수가 앞서거나, 다른 폴더의 `.env`다 | `docker compose config`, `-f`로 실행했다면 `--env-file` (3단계) |
| 폴더 이름을 바꾼 뒤 DB가 빈 것처럼 보인다 | 프로젝트 이름이 바뀌어 새 볼륨이 생겼다 | `docker volume ls` (3단계) |
| 결제가 500, `StripeIdempotencyError: Keys for idempotent requests can only be used with the same parameters ...` | 다른 환경과 Stripe 멱등 키가 겹쳤다. 결제 e2e에는 `page.waitForURL` 타임아웃으로 보인다 | 키를 무엇으로 만드는지(`14`의 결제 시도 키) (4단계) |
| `npm run test:api`의 e2e가 거의 다 실패, `database "order_api_test" does not exist` | compose의 db에 테스트 DB가 없다 | `createdb`와 `ADMIN_DATABASE_URL=...order_api_test` 마이그레이션 (5단계 작업 2) |
| `npm run test:web`이 기대와 다른 코드를 테스트한다 | 3000번에 이미 떠 있던 서버를 썼다 | `reuseExistingServer: true`, 3000번의 주인 (5단계) |
| 실제 Stripe e2e에서 웹훅이 안 온다 | 웹훅이 로컬로 넘어오지 않는다 | `stripe listen`의 `--forward-to`와 `STRIPE_WEBHOOK_SECRET` (5단계) |
| README대로 했는데 띄우는 순서에서 막힌다 | README의 명령을 새 폴더에서 돌려 보지 않았다 | `cp .env.example .env`부터 다시 (6단계) |

### 시험해보기

```sh
cp .env.example .env # 값 채우기
npm install
docker compose --profile app up -d --build
docker compose --profile app run --rm migrate npx prisma db seed
npm run lint && npm run typecheck && npm run test:web
```

### 도전 과제

#### 1. API 이미지 줄이기

API 이미지(1.07GB)를 줄인다. `npm ci --omit=dev` 뒤에도 무엇이 큰지 아래 명령으로 찾아본다.

```sh
du -sh node_modules/* | sort -h | tail
```

웹처럼 번들러로 한 파일로 묶는 방법도 생각해 본다.

> Prisma처럼 실행 파일이나 네이티브 모듈을 쓰는 의존성에 주의한다.

무엇이 크고, 어떻게 줄이는가?

**답**

1. API 이미지의 `node_modules`는 563MB다. 큰 순서로 `@prisma` 172MB(`client` 72MB, `studio-core` 43MB, `engines` 29MB, `dev` 19MB), `@opentelemetry` 46MB, `prisma` 41MB, `effect` 34MB, `@electric-sql` 26MB, `typescript` 24MB다.

2. `prisma`(CLI)와 그것이 끌고 오는 `@prisma/studio-core`·`@prisma/engines`·`@prisma/dev`·`effect`·`@electric-sql/pglite`는 실행에 쓰지 않는데 들어 있다. `order-api-nest`의 개발 의존성이면서 `@prisma/client`의 선택적 peer 의존성이라, 잠금 파일에 `"devOptional": true`로 적혀 있기 때문이다.

3. `devOptional`은 dev와 optional을 **둘 다** 빼야 빠진다. `prod-deps` 단계를 `npm ci -w order-api-nest --omit=dev --omit=optional`로 바꾸면 `node_modules`가 310MB, 이미지가 1.07GB → 733MB로 준다.

4. 줄인 이미지도 같은 DB·Redis·저장소에 붙여 띄우면 `/health/ready`가 `200 {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}`이고, 로그인 요청도 원래 이미지와 같은 응답(`401`)을 돌려준다.

> 남은 것 중 가장 큰 `@prisma/client`(72MB)는 PostgreSQL 말고 MySQL·SQLite 등 모든 DB용 쿼리 컴파일러를 함께 담고 있다. `typescript`는 `@trpc/server`가 선택적이 아닌 peer 의존성으로 요구해서 남는다.

답을 적용한 Dockerfile은 `practice/challenge-api-image-size/node-order/order-api-nest/Dockerfile`에 있다.

#### 2. 웹 화면에서 알림 구독하기

웹 화면에서 WebSocket 알림을 구독한다. 결제 완료(`order.paid`)를 받으면 주문 상세를 다시 읽게 해서, `14`의 1초 재조회를 대신한다.

무엇이 달라지는가?

**답**

1. 프론트의 `dependencies`에 `socket.io-client`를 더한다. 백엔드 테스트용으로 이미 잠금 파일에 있던 같은 버전이라 새로 받는 패키지는 없다.

2. 주문 상세 화면에서 `io(API_URL, { auth: (cb) => cb({ token }) })`로 API에 붙는다. 토큰은 메모리의 액세스 토큰이고, 새로고침 직후라 없으면 refresh로 먼저 받는다. 서버는 이 토큰으로 사용자를 알아내 `user:<id>` 방에 넣는다.

3. `order.paid`(`{ eventId, orderId }`)를 받고 `orderId`가 이 화면의 주문이면 `me.order`와 `me.orders` 쿼리를 `invalidateQueries`로 다시 읽는다. `refetchInterval`은 지운다.

4. 그대로 띄우면 콘솔에 `Connecting to 'ws://localhost:4000/socket.io/...' violates the following Content Security Policy directive: "connect-src ..."`가 찍힌다. `08`의 CSP `connect-src`에 `http://` 주소만 있어서 브라우저가 WebSocket 연결을 막고, socket.io는 HTTP 롱 폴링으로만 동작한다. `connect-src`에 API 주소의 `ws://` 판을 더하면 WebSocket으로 붙는다.

5. 결제 대기 화면을 열어 둔 채 웹훅이 결제를 확인하면, 0.2~0.3초 안에 `결제 완료`로 바뀐다. 그동안 `me.order` 요청은 처음 1번과 알림 뒤 1번뿐이다.

> 원래 코드는 `?checkout=success`로 돌아왔을 때만 1초마다 다시 물었다(웹훅 전 3초 동안 4번, 바뀌기까지 약 1.3초). 그 표시 없이 주문 상세를 열어 두면 웹훅이 와도 `결제 대기`에서 바뀌지 않았다.

답을 적용한 프론트는 `practice/challenge-web-notifications/node-order/order-console-next/`에 있다(`lib/notifications.ts`, `proxy.ts`).

#### 3. 이미지 하나로 합치기

`migrate` 서비스와 `api` 서비스는 같은 Dockerfile의 다른 단계(`migrate`/`runtime`)에서 나온다.

둘을 한 이미지로 합치고 실행 명령만 다르게 하는 방식과 비교해 장단점을 적는다.

**답**

1. Dockerfile의 `migrate`·`prod-deps`·`runtime` 단계를 지우고 `build` 단계에서 이어 가는 `app` 단계 하나를 둔다. compose에서는 `api`가 `target: app`으로 빌드해 `image: node-order-api`라는 이름을 붙이고, `migrate`는 그 이미지에 `command: ["npx", "prisma", "migrate", "deploy"]`만 준다.

2. 합친 이미지 하나로 `prisma migrate deploy`, `prisma db seed`, API 실행이 모두 된다(API의 `/health/ready` 200, `kim`/`1234` 로그인 200).

3. 크기는 지금이 API 1.07GB + migrate 1.66GB, 합치면 1.66GB 하나다.

| | 단계를 나눈다(지금) | 이미지 하나 |
|---|---|---|
| 장점 | API 이미지에 실행에 필요한 것만 있다. 받는 시간이 짧고, 운영 컨테이너 안에 prisma CLI·tsx·TypeScript 같은 도구가 없다 | 빌드하고 올리는 이미지가 하나다. 마이그레이션과 API가 항상 같은 코드·같은 스키마에서 나온다 |
| 단점 | 이미지가 둘이라 빌드·태그·배포 때 짝을 맞춰야 한다 | 계속 떠 있는 API 이미지가 1.07GB → 1.66GB로 커지고, 개발 의존성이 운영 컨테이너에 그대로 들어간다 |

> 마이그레이션은 배포마다 한 번 돌고 끝나지만 API는 계속 떠 있고 여러 대로 늘어난다. 크기와 안에 든 도구의 비용은 API 쪽에서 계속 치르게 된다.

답을 적용한 Dockerfile과 compose는 `practice/challenge-single-image/node-order/`에 있다.

## 9. 완성 확인

### 체크리스트

- [ ] 데모 화면·템플릿 파일이 없고, `npm run lint`와 `npm run typecheck`가 통과한다

- [ ] 웹 이미지가 standalone으로 빌드되고, `NEXT_PUBLIC_` 값은 빌드 인자로만 바뀌는 것을 확인했다

- [ ] 루트 `compose.yaml` 하나로 인프라 / 앱 / 모니터링을 단계별로 띄운다

- [ ] 비밀 값은 루트 `.env` 하나에 있고, `order-api-nest/.env`(데모 값)는 커밋 대상으로 남아 있다

- [ ] 웹 컨테이너가 서비스 이름(`api`)으로 API에 닿는다

- [ ] 컨테이너 구성에서 백엔드 e2e 30개, 프론트 e2e 11개, 실제 Stripe 결제 e2e가 통과한다

- [ ] Prometheus가 컨테이너 API를 수집하고, Jaeger에 추적이 들어온다

- [ ] README가 다른 브랜치와 같은 틀(지원 범위 / 구성 / 실행 / 테스트 / 정리)이고, README의 명령을 그대로 쳐서 띄우고 확인할 수 있다

## 10. 다음 단계

### 자가 점검

1. `NEXT_PUBLIC_API_URL`을 실행할 때 바꿔도 반영되지 않는 이유는? C의 무엇과 같은가?

2. 웹 이미지 빌드에서 타입 검사를 건너뛰어도 되는 이유와, 그 대신 어디서 하는가?

3. API 이미지와 웹 이미지가 같은 빌드 컨텍스트(루트)를 쓰면서 서로 다른 `.dockerignore`를 쓰는 방법은?

4. 컨테이너 안에서 `localhost:4000`이 연결 거부인 이유는? 브라우저에서는 왜 괜찮은가?

5. `.gitignore`에서 `.env`와 `/.env`의 차이는?

6. Stripe 멱등 키를 주문 번호만으로 만들면 새 DB에서 무엇과 부딪히는가? Mock Stripe 테스트로는 왜 잡히지 않는가?

7. README의 지원 범위에 기능 이름만이 아니라 동작까지 적는 이유는? 아직 안 되는 것은 왜 적는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 이미지 레지스트리에 올리기와 이미지 태그 전략(커밋 해시, 버전)

- 운영용 HTTPS, 도메인, 리버스 프록시

- 여러 환경(개발·스테이징·운영)의 설정을 나누는 방법, 비밀 관리 도구

- 이미지 취약점 검사, 이미지 서명