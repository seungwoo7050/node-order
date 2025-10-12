# 프론트엔드 상태: TanStack Query와 Zustand로 만든 장바구니·결제 화면

## 목표

이 프로젝트는 아래 두 프로젝트의 소스코드를 기반으로 시작한다.

- node-workspace 저장소의 [`04-integration-and-auth`](https://github.com/seungwoo7050/node-workspace/tree/foundation/04-integration-and-auth) 브랜치의 `order-console-next`
- node-order 저장소의 [`04-redis`](https://github.com/seungwoo7050/node-order/tree/04-redis) 브랜치의 `order-api-nest`

지금까지 만든 API를 브라우저에서 쓰는 화면을 만든다.

1. 상품 목록과 내 주문처럼 서버에 있는 데이터는 TanStack Query로 가져오고 캐시한다

2. 장바구니처럼 브라우저에만 있는 데이터는 Zustand로 두고, 새로고침해도 남게 한다

3. 액세스 토큰은 메모리에만 두고, 만료되면 httpOnly 쿠키의 refresh token으로 한 번만 다시 받는다

4. 결제 API를 `Idempotency-Key`와 함께 불러서, 응답이 사라져 다시 눌러도 주문이 하나만 생기게 한다

```sh
npx playwright test --reporter=list

Running 4 tests using 1 worker

  ✓  1 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (849ms)
  ✓  2 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (572ms)
  ✓  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (938ms)
  ✓  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (962ms)
```

> 시작 기준점:  
> `04-redis`까지 마친 `order-api-nest`가 `http://localhost:4000`에서 한 대로 돌고 있고, 백엔드 `.env`의 `FRONTEND_URL`이 `http://localhost:3000`이다(CORS `credentials: true`).  
> 프론트는 Next.js 주문 콘솔(`order-console-next`)에서 이어 간다. 서버/클라이언트 컴포넌트 구분과 하이드레이션, Playwright를 다시 쓴다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 8장(디버깅)에서 "어느 층에서 틀어졌나"를 가르는 절차 | 브라우저 개발자 도구로 본다 |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 8장만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 8장 "진단 5"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 설치와 설정뿐이고 9·10장은 체크리스트라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 사전지식](#0-사전지식) | 서버 상태와 클라이언트 상태를 나누고, 액세스 토큰을 메모리에만 두는 이유를 본다(작업 없음) |
| [1. 준비](#1-준비) | 백엔드를 띄우고 TanStack Query·Zustand·Playwright를 설치한다 |
| [2. 1단계: TanStack Query로 상품 목록 가져오기](#2-1단계-tanstack-query로-상품-목록-가져오기) | `QueryClient`를 준비하고 `useQuery`로 `/products`를 받아 캐시한다 |
| [3. 2단계: Zustand로 장바구니](#3-2단계-zustand로-장바구니) | `persist`로 새로고침해도 남는 장바구니를 만들고, 하이드레이션 불일치를 일부러 일으킨다 |
| [4. 3단계: 로그인과 인증이 필요한 호출](#4-3단계-로그인과-인증이-필요한-호출) | 메모리 토큰 store, `authFetch`, 로그인·내 주문 화면을 만든다 |
| [5. 4단계: 새로고침하면 로그아웃된다(일부러 깨뜨려보기 ②)](#5-4단계-새로고침하면-로그아웃된다일부러-깨뜨려보기-②) | 동시 refresh로 세션이 회수되는 것을 보고 single-flight로 고친다 |
| [6. 5단계: 결제(useMutation, 무효화, Idempotency-Key)](#6-5단계-결제usemutation-무효화-idempotency-key) | `useMutation`으로 결제하고, 캐시를 무효화하고, 결제 시도마다 키 하나를 쓴다 |
| [7. 6단계: e2e 테스트로 고정하기](#7-6단계-e2e-테스트로-고정하기) | 브라우저에서만 드러나는 네 가지 동작을 Playwright로 고정한다 |
| [8. 7단계: 디버깅](#8-7단계-디버깅) | 캐시·쿠키·하이드레이션·refresh 횟수로 막힌 곳을 찾는다 |
| [9. 완성 확인](#9-완성-확인) | 체크리스트 |
| [10. 다음 단계](#10-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 사전지식

### 개념 1 | 서버 상태와 클라이언트 상태는 다른 물건이다.

앞의 React 실습에서는 모든 데이터를 `useState`에 넣었다. 그런데 화면의 데이터는 성격이 둘로 갈린다.

| | 서버 상태 | 클라이언트 상태 |
|---|---|---|
| 예 | 상품 목록, 재고, 내 주문 | 장바구니, 열린 탭, 입력 중인 값 |
| 원본이 있는 곳 | 서버. 화면에 있는 건 복사본이다 | 브라우저. 화면에 있는 게 원본이다 |
| 어려운 점 | 언제 다시 받아야 하는가, 같은 걸 두 번 받지 않으려면, 바꾼 뒤 낡은 복사본은 어떻게 하는가 | 여러 컴포넌트가 같이 쓰기, 새로고침해도 남기기 |

C로 비유하면 서버 상태는 원격 데이터의 캐시다.

CPU 캐시나 디스크 버퍼 캐시처럼 "원본은 저기 있고 나는 복사본을 들고 있다"는 구조라, **언제 무효화하느냐가 핵심 문제**가 된다.

앞에서 손으로 짠 로딩·에러 상태, 경쟁 상태 처리, 캐싱을 TanStack Query가 이 관점으로 대신 해 준다.

클라이언트 상태는 그냥 전역 변수다. 다만 값이 바뀌면 그 값을 쓰는 컴포넌트들이 다시 그려져야 하므로, "값 + 구독자 목록"이 필요하다.

C로 치면 전역 구조체 하나와, 값이 바뀔 때 호출할 함수 포인터 배열이다. Zustand는 정확히 그 구조를 작게 구현한 라이브러리다.

### 개념 2 | 액세스 토큰은 메모리에만 둔다.

앞서 refresh token은 httpOnly 쿠키에 넣어 JS가 읽지 못하게 했다.

액세스 토큰은 JS가 `Authorization` 헤더에 직접 붙여야 하므로 JS가 들고 있어야 한다.

이때 `localStorage`에 두면 XSS 한 번에 읽혀 나간다. 그래서 **메모리(자바스크립트 변수)에만** 둔다.

대가는 새로고침하면 사라진다는 점이다. 그때는 쿠키의 refresh token으로 새로 받는다.

> 이 "새로 받기"가 여러 곳에서 동시에 일어날 때 `03`의 5단계 문제가 터진다. 4단계에서 직접 본다.

## 1. 준비

### 작업 1. 백엔드 띄우기

백엔드를 띄워 둔다.

```sh
cd order-api-nest
docker compose up -d
npm run start:dev # :4000
```

### 작업 2. 패키지 설치

다른 터미널에서 프론트로 간다.

```sh
cd order-console-next
npm install @tanstack/react-query zustand
npm install -D @playwright/test
```

- `@tanstack/react-query`: 서버 상태(가져오기, 캐시, 다시 받기)를 관리한다.

- `zustand`: 작은 전역 상태 저장소다.

Playwright 브라우저를 이 컴퓨터에 받아 둔 적이 없다면 한 번 받는다. 이미 받아 두었으면 건너뛴다.

```sh
npx playwright install chromium
```

### 작업 3. 브라우저가 부를 백엔드 주소

`.env.local`에 브라우저가 부를 백엔드 주소를 추가한다.

앞에서 쓴 `API_URL`은 서버 액션(서버에서 도는 코드)용이라 브라우저 코드에서는 읽을 수 없다.

```sh
# .env.local
# 이 한 줄을 추가한다. NEXT_PUBLIC_ 이 붙어야 브라우저 코드에서 읽힌다
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`.env.local`은 `.gitignore`에 걸려 저장소에 올라가지 않는다. 다른 사람이 따라 할 수 있게 `.env.example`에도 같은 줄을 적어 둔다.

```sh
# .env.example
# 기존 두 줄(API_URL, DEMO_PASSWORD) 아래에 추가한다
# 브라우저에서 부르는 백엔드 주소. NEXT_PUBLIC_ 이 붙어야 브라우저 코드에서 읽힌다
NEXT_PUBLIC_API_URL=http://localhost:4000
```

> `NEXT_PUBLIC_`이 붙은 값은 빌드할 때 코드에 문자열로 박힌다. 그래서 비밀 값에는 절대 붙이지 않는다. 값을 바꾸면 `next dev`를 다시 켜야 한다.

이 작업을 마친 `.env.local`은 세 줄이다. 파일이 지워졌다면 `.env.example`을 복사해 값을 채우거나, 아래를 그대로 새로 만든다.

```sh
# .env.local
# 서버 액션(app/orders/actions.ts)이 부르는 백엔드 주소. 서버에서만 읽힌다
API_URL=http://localhost:4000
# 서버 액션이 데모 계정(kim)으로 로그인할 때 쓰는 비밀번호. 백엔드 .env의 DEMO_PASSWORD와 같은 값이어야 한다
DEMO_PASSWORD=1234
# 브라우저 코드가 부르는 백엔드 주소
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- `DEMO_PASSWORD`는 백엔드 시드(`prisma/seed.ts`)가 데모 계정 비밀번호를 만들 때 쓴 값이다. 다르면 서버 액션의 로그인이 401로 실패하니, `order-api-nest/.env`에서 그대로 옮겨 온다.

- `API_URL`이 없어도 코드가 `http://localhost:4000`으로 떨어지지만, 어디를 부르는지 보이도록 적어 둔다.

- 새로 만든 뒤에는 `next dev`를 다시 켠다. `.env.local`은 켤 때 한 번만 읽힌다.

## 2. 1단계: TanStack Query로 상품 목록 가져오기

### 작업 1. 앱 전체가 쓸 캐시(`QueryClient`) 준비

```tsx
// app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api-client";

let browserQueryClient: QueryClient | undefined;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30초 동안은 받은 데이터를 "신선하다"고 보고 다시 요청하지 않는다
        // 401은 몇 번을 다시 해도 같으므로 재시도하지 않는다. 그 밖의 실패는 한 번만 다시 해 본다
        retry: (failureCount, error) => !(error instanceof ApiError && error.status === 401) && failureCount < 1,
      },
    },
  });
}

function getQueryClient() {
  // 서버에서는 요청마다 새로 만들고, 브라우저에서는 하나를 계속 쓴다
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
```

`ApiError`는 작업 3에서 만드는 `lib/api-client.ts`에 있다. 그 전까지는 이 import가 풀리지 않으니, 작업 3까지 마친 뒤에 `next dev`를 켠다.

### 개념 | `QueryClient`를 서버와 브라우저에서 다르게 만드는 이유

`getQueryClient`가 서버와 브라우저를 나누는 이유는 앞에서 본 "하나의 소스 트리, 두 개의 실행 환경"과 같다.

`"use client"`가 붙은 파일도 첫 HTML을 만들 때 서버에서 한 번 실행된다. 그래서 `typeof window === "undefined"`로 지금 어디서 도는지 가른다.

#### 서버에서 모듈 전역 캐시를 두면

서버에서 모듈 전역 변수에 캐시를 두면, 그 서버 프로세스로 들어오는 **모든 사용자의 요청이 같은 캐시를 공유**한다.

남의 주문이 내 화면에 섞일 수 있다는 뜻이다. 그래서 서버에서는 렌더링할 때마다 새로 만든다.

C로 치면 여러 클라이언트를 받는 서버 프로세스에서 `static` 버퍼 하나에 요청별 결과를 담는 것과 같다. 요청마다 지역 변수로 만들어야 한다.

#### 브라우저에서 하나를 계속 쓰는 이유

브라우저에서는 탭 하나가 사용자 한 명이다. 여기서는 반대로 하나만 있어야 한다.

렌더링할 때마다 `new QueryClient()`를 하면 그때마다 빈 캐시가 되어, 캐시가 아무것도 기억하지 못한다. 그래서 모듈 전역 `browserQueryClient`에 한 번 만든 것을 계속 쓴다.

#### `Providers`를 따로 파일로 빼는 이유

`QueryClientProvider`는 React 컨텍스트로 캐시를 아래 컴포넌트에 나눠 준다. 컨텍스트는 클라이언트 컴포넌트에서만 쓸 수 있다.

`app/layout.tsx`는 서버 컴포넌트라 거기서 직접 쓸 수 없다. 그래서 `"use client"`를 붙인 `Providers`를 따로 만들고, 레이아웃은 그 안에 `children`을 넘기기만 한다.

서버 컴포넌트가 클라이언트 컴포넌트에 `children`으로 넘긴 부분은 여전히 서버 컴포넌트로 남는다. 앱 전체를 감싸도 앱 전체가 클라이언트 컴포넌트가 되지는 않는다.

`useQuery`를 쓰는 컴포넌트가 이 `Providers` 바깥에 있으면 `No QueryClient set, use QueryClientProvider to set one` 에러가 난다.

### 용어 | TanStack Query API (`QueryClient`)

- `new QueryClient(옵션)`: 앱 전체가 쓰는 캐시를 만든다. `defaultOptions.queries`는 모든 쿼리의 기본값이다.

- `staleTime`: 받아 온 데이터를 이 시간(ms) 동안 "신선하다"고 보고, 화면이 다시 그려져도 다시 요청하지 않는다. 상황별로 요청이 몇 번 나가는지는 아래 "캐시가 실제로 하는 일"에서 본다.

- `retry(failureCount, error)`: 실패했을 때 다시 시도할지 정한다. `true`를 반환하면 다시 시도한다. 첫 실패에서 `failureCount`는 0이라, `failureCount < 1`은 "한 번만 다시"가 된다.

- `<QueryClientProvider client={...}>`: 그 아래 컴포넌트들이 이 캐시를 쓰게 한다.

### 작업 2. 레이아웃을 `Providers`로 감싸기

`app/layout.tsx`의 `<body>` 안을 `<Providers>`로 감싼다.

앞에서 만든 `<nav>`는 아직 그대로 둔다. 2단계에서 만드는 `Nav` 컴포넌트로 바꾼다.

레이아웃에 `<nav>`가 없다면(`create-next-app`이 만든 그대로라면) 아래처럼 `<nav>`와 `import Link` 줄을 함께 넣는다. `<Link>`만 넣고 import를 빠뜨리면 `/shop`을 열 때 `ReferenceError: Link is not defined`로 500이 난다.

```tsx
// app/layout.tsx
// import에 Providers 한 줄을 더하고, body 안을 Providers로 감싼다
// <nav>가 처음이면 Link import도 함께 더한다
import Link from "next/link";
import { Providers } from "./providers";

// ...

      <body className="min-h-full flex flex-col">
        <Providers>
          <nav><Link href="/orders">주문 목록</Link></nav>
          {children}
        </Providers>
      </body>
```

### 작업 3. API를 부르는 함수 모으기

API를 부르는 함수는 한곳에 모은다. 3단계에서 로그인이 필요한 호출(`authFetch`)을 여기에 더한다.

```ts
// lib/api-client.ts
// 1단계 부분. 새 파일로 만든다
// NEXT_PUBLIC_ 접두사가 붙은 환경변수만 브라우저 번들에 들어간다
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// HTTP 상태 코드를 들고 다니는 에러. 화면과 TanStack Query가 401인지 보고 다르게 처리한다
export class ApiError extends Error {
  // public readonly status: 생성자 매개변수에 붙이면 같은 이름의 필드가 자동으로 만들어진다
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Nest의 검증 에러는 message가 배열이다 → 한 줄로 합친다
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// 로그인이 필요 없는 API 호출
export async function publicFetch<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`${API_URL}${path}`));
}
```

`fetch`는 4xx·5xx 응답에도 예외를 던지지 않는다. 네트워크가 끊겼을 때만 던진다.

그래서 `parse`가 `res.ok`를 보고 직접 `ApiError`를 던진다. 그래야 TanStack Query가 그 요청을 "실패"로 알아본다.

### 작업 4. 상품 목록 화면

장바구니(`useCartStore`)는 2단계에서 만든다.

```tsx
// app/shop/page.tsx
// 1단계 부분. 새 파일로 만든다
"use client";

import { useQuery } from "@tanstack/react-query";
import { publicFetch } from "@/lib/api-client";

type Product = { id: number; name: string; price: number; stock: number };

function ProductList() {
  const { data, isPending, error } = useQuery({
    queryKey: ["products"], // 이 데이터의 이름. 같은 이름을 쓰는 컴포넌트끼리 캐시와 요청을 공유한다
    queryFn: () => publicFetch<Product[]>("/products"),
  });

  if (isPending) return <p>상품을 불러오는 중…</p>;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.name} — {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
        </li>
      ))}
    </ul>
  );
}

export default function ShopPage() {
  return (
    <main>
      <h1>상품</h1>
      <ProductList />
    </main>
  );
}
```

#### 띄워서 확인

```sh
npm run dev # :3000
```

터미널이 `✓ Ready`에서 멈춘 것처럼 보이는 것이 정상이다. 개발 서버는 떠서 요청을 기다리는 중이고, 페이지는 브라우저가 처음 요청할 때 컴파일된다. 그래서 브라우저로 열기 전까지는 터미널에 아무것도 더 찍히지 않는다.

브라우저에서 `http://localhost:3000/shop`을 연다(아직 메뉴에 링크가 없으니 주소창에 직접 친다). 이때 터미널에 `GET /shop 200`이 한 줄 찍힌다.

시드 상품(한정판 키보드, 마우스)이 재고와 함께 나오면 된다.

`상품을 불러오지 못했습니다: Failed to fetch`가 나오면 요청이 응답을 받지 못한 것이다. 백엔드가 4000에서 떠 있는지, `.env.local`을 고친 뒤 `next dev`를 다시 켰는지 본다.

#### 앞의 손으로 짠 코드와 비교

앞의 React 실습에서 데이터를 받아 오던 코드와 비교해 본다. `useEffect`, `useState` 세 개(데이터·로딩·에러), cleanup의 `cancelled` 플래그가 모두 사라졌다.

응답이 순서를 바꿔 도착하는 경쟁 상태도 TanStack Query가 `queryKey` 단위로 처리한다.

### 용어 | TanStack Query API (`useQuery`)

- `useQuery({ queryKey, queryFn })`: 서버 데이터를 가져와 캐시에 두고, 그 상태를 돌려준다.

- `queryKey`: 이 데이터의 이름이다. 같은 이름을 쓰는 컴포넌트끼리 캐시와 요청을 공유한다. 왜 배열인지는 아래 "`queryKey`는 내용으로 비교하는 배열이다"에서 다룬다.

- `queryFn`: 실제로 데이터를 가져오는 함수다. Promise를 반환해야 한다.

- `data` / `isPending` / `error`: 받아 온 데이터, 아직 데이터가 없는지, 실패했다면 그 에러다. 아래 "`isPending`과 `isFetching`, 그리고 `data`의 타입"에서 다룬다.

### 개념 | `queryKey`는 내용으로 비교하는 배열이다

`queryKey`는 캐시라는 해시 테이블의 키다.

TanStack Query는 이 배열을 문자열로 직렬화해서 비교하므로, 렌더링마다 새로 만든 배열이어도 **내용이 같으면 같은 키**다.

C로 치면 포인터 주소가 아니라 내용을 직렬화한 문자열을 키로 쓰는 셈이다.

#### 배열인 이유

배열인 이유는 "무엇을"과 "어느 것을"을 나눠 적기 위해서다. 3단계의 주문 상세는 주문마다 따로 캐시해야 하므로 id를 키에 넣는다.

```ts
useQuery({ queryKey: ["products"], queryFn: ... }); // 상품 목록 하나
useQuery({ queryKey: ["my-order", id], queryFn: ... }); // 주문마다 하나씩: ["my-order", 1], ["my-order", 3], ...
```

키 안의 값(`id`)이 바뀌면 다른 캐시 항목이 되어 새로 요청한다. 그래서 `queryFn`이 쓰는 값은 전부 키에도 넣는다.

`id`를 빼고 `["my-order"]`로만 두면, 1번을 본 뒤 3번을 열어도 `staleTime` 안에서는 1번 캐시를 그대로 보여 준다.

#### 앞부분 일치

5단계의 `invalidateQueries`처럼 키로 캐시를 찾는 함수는 **앞부분이 일치하는** 항목을 전부 고른다.

| `invalidateQueries`에 넘긴 키 | `["my-order", 1]` | `["my-orders"]` |
|---|---|---|
| `["my-order"]` | 고른다 | 안 고른다 |
| `["my-orders"]` | 안 고른다 | 고른다 |

- 앞부분 일치는 배열의 원소 단위다. `"my-order"`와 `"my-orders"`는 다른 문자열이라 서로 걸리지 않는다.

- `["my-order"]` 하나로 모든 주문 상세를 한꺼번에 무효화할 수 있다. 키를 "종류 → 세부" 순서로 짓는 이유다.

> 키는 데이터의 이름이자 의존성 목록이다. `queryFn` 안에서 쓰는 값이 키에 없으면 캐시가 엉뚱한 데이터를 돌려준다.

### 개념 | `isPending`과 `isFetching`, 그리고 `data`의 타입

`useQuery`의 결과는 `status`가 `"pending"` / `"error"` / `"success"` 중 하나인 판별 유니온이다.

`isPending`은 "**아직 데이터가 한 번도 없다**"는 뜻이지 "요청 중이다"가 아니다. 요청 중인지는 `isFetching`이 따로 알려 준다.

| 때 | `status` | `isPending` | `isFetching` | `data` |
|---|---|---|---|---|
| 첫 요청 중 | `pending` | `true` | `true` | `undefined` |
| 받은 뒤 | `success` | `false` | `false` | 상품 배열 |
| `staleTime`이 지나 뒤에서 다시 받는 중 | `success` | `false` | `true` | 이전 상품 배열 |

그래서 `if (isPending) return <p>불러오는 중…</p>`은 첫 로딩에만 걸리고, 뒤에서 다시 받는 동안에는 이전 데이터를 그대로 보여 준다("캐시가 실제로 하는 일"의 마지막 항목).

#### `data.map`을 바로 쓸 수 있는 이유

`data`의 타입은 `Product[] | undefined`다. 위 코드가 `data.map`을 바로 쓸 수 있는 이유는 TS가 구조 분해한 판별 유니온도 좁혀 주기 때문이다.

```tsx
const { data, isPending, error } = useQuery({ queryKey: ["products"], queryFn: () => publicFetch<Product[]>("/products") });

data.map((p) => p.id); // 컴파일 에러: 'data' is possibly 'undefined'. (TS18048)
if (isPending) return <p>상품을 불러오는 중…</p>;
if (error) return <p role="alert">...</p>;
data.map((p) => p.id); // 통과: pending도 error도 아니면 success이고, data가 있다
```

- 로딩 표시를 뒤에서 다시 받을 때도 띄우고 싶으면 `isFetching`을 쓴다. 대신 화면이 자주 깜빡인다.

- 두 `if`는 순서를 바꿔도 되지만, `if (error)`를 빼면 다시 컴파일 에러다. 에러 상태에서도 `data`는 `undefined`일 수 있기 때문이다.

> `isPending`은 "보여 줄 데이터가 없는가", `isFetching`은 "네트워크 요청이 나가 있는가"를 묻는다.

### 개념 | 캐시가 실제로 하는 일

브라우저 개발자 도구의 Network 탭(또는 Playwright로 요청 수를 세어)에서 확인한다.

| 상황 | `/products` 요청 |
|---|---|
| `ProductList`를 일부러 두 번 렌더링했을 때 | 1번 |
| "내 주문"으로 갔다가 30초 안에 "상품"으로 돌아옴 | 0번 |
| 새로고침 | 1번 |

- 같은 `queryKey`를 쓰는 컴포넌트가 둘이어도 요청은 하나다. 진행 중인 요청을 같이 기다리기 때문이다.

- 화면을 떠났다 돌아와도 `staleTime`(30초) 안이면 캐시를 그대로 보여 준다.

- 새로고침하면 메모리가 비워지므로 다시 받는다.

- 30초가 지난 뒤 돌아오면 일단 캐시를 보여 주고 뒤에서 다시 받아 바꿔 끼운다.

### 남길 것

- **찾아보면 되는 것**: `QueryClient`의 옵션 이름(`staleTime`, `retry`), `useQuery`가 돌려주는 필드 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 서버 데이터는 원본이 서버에 있는 캐시다. `queryKey`가 그 캐시의 이름이고, `queryFn`이 쓰는 값은 전부 키에 들어가야 한다.

  - 서버에서 렌더링할 때 모듈 전역에 캐시를 두면 사용자끼리 캐시가 섞인다. 서버에서는 요청마다, 브라우저에서는 하나만 만든다.

- **에러 신호**:

  - `ReferenceError: Link is not defined`로 모든 페이지가 500 → `layout.tsx`에 `<Link>`만 넣고 `import Link from "next/link"`를 빠뜨렸는지

  - `No QueryClient set, use QueryClientProvider to set one` → 그 컴포넌트가 `layout.tsx`의 `<Providers>` 안에 있는지

  - `상품을 불러오지 못했습니다: Failed to fetch` → 백엔드가 4000에서 떠 있는지, `NEXT_PUBLIC_API_URL`을 고친 뒤 `next dev`를 다시 켰는지

  - `'data' is possibly 'undefined'. (TS18048)` → `isPending`과 `error`를 먼저 걸렀는지

## 3. 2단계: Zustand로 장바구니

### 작업 1. 장바구니 store 만들기

```ts
// lib/cart-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = { productId: number; name: string; price: number; quantity: number };

type CartState = {
  items: CartItem[];
  // 결제를 시작할 때 만든 Idempotency-Key. 결제가 성공할 때까지 같은 값을 다시 쓴다(5단계)
  checkoutKey: string | null;
  add: (item: Omit<CartItem, "quantity">) => void;
  remove: (productId: number) => void;
  beginCheckout: () => string;
  finishCheckout: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      checkoutKey: null,
      add: (item) =>
        set((state) => {
          const found = state.items.find((i) => i.productId === item.productId);
          // 장바구니가 바뀌면 "다른 결제"이므로 키를 버린다
          if (found) {
            return {
              checkoutKey: null,
              items: state.items.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i)),
            };
          }
          return { checkoutKey: null, items: [...state.items, { ...item, quantity: 1 }] };
        }),
      remove: (productId) =>
        set((state) => ({ checkoutKey: null, items: state.items.filter((i) => i.productId !== productId) })),
      beginCheckout: () => {
        const existing = get().checkoutKey;
        if (existing) return existing;
        const key = crypto.randomUUID(); // 브라우저 내장 UUID 생성기
        set({ checkoutKey: key });
        return key;
      },
      finishCheckout: () => set({ items: [], checkoutKey: null }),
    }),
    { name: "cart" }, // localStorage의 키 이름
  ),
);
```

앞의 React 실습에서 "state를 직접 바꾸면 화면이 안 바뀐다"를 봤다. 여기서도 `items.push(...)`가 아니라 새 배열을 만들어 `set`에 넘긴다.

Zustand도 React처럼 "참조가 바뀌었는가"로 변경을 알아채기 때문이다.

### 용어 | Zustand API (store 만들기)

- `create<State>()(초기화 함수)`: store를 만든다. 결과는 React 훅이면서, 컴포넌트 밖에서도 쓸 수 있는 객체다. 괄호가 두 번인 이유는 아래 "`create<State>()()`: 괄호가 두 번인 이유"에서 다룬다.

- `persist(초기화 함수, { name })`: 상태를 `localStorage`의 `name` 키에 저장하고, 다음에 열 때 되살리는 미들웨어다.

- `set(바꿀 값)` / `set((state) => 바꿀 값)`: 상태를 바꾼다. 바꾼 필드만 넘기면 나머지는 그대로 둔다. 어디까지 그대로 두는지는 아래 "`set`은 맨 위 한 단계만 합친다"에서 다룬다.

- `get()`: 지금 상태를 읽는다.

### 개념 | `create<State>()()`: 괄호가 두 번인 이유

`create<CartState>()(...)`는 오타처럼 보이지만, `create<CartState>()`가 먼저 함수를 돌려주고 그 함수에 초기화 함수를 넘기는 두 번의 호출이다.

TS의 제네릭은 "일부만 직접 적고 나머지는 추론"을 할 수 없다.

`create`는 상태 타입(`CartState`) 말고도 "어떤 미들웨어로 감쌌는지"를 타입 인자로 받는다. 상태 타입은 직접 적어야 하고 미들웨어 쪽은 넘긴 `persist(...)`에서 추론되어야 한다.

그래서 호출을 둘로 나눠, 첫 번째에서 상태 타입만 적고 두 번째에서 나머지를 추론하게 했다.

```ts
create<CartState>()(persist((set, get) => ({ ... }), { name: "cart" })); // 통과
create<CartState>(persist((set, get) => ({ ... }), { name: "cart" }));
// 컴파일 에러(TS2345): Argument of type 'StateCreator<CartState, [], [["zustand/persist", CartState]]>'
// is not assignable to parameter of type 'StateCreator<CartState, [], []>'.
```

- 미들웨어 없이 `create<AuthState>((set) => ({ ... }))`처럼 한 번만 써도 컴파일은 된다. 3단계의 `useAuthStore`처럼 미들웨어가 없어도 같은 모양으로 맞춰 두면 나중에 미들웨어를 붙일 때 고칠 곳이 없다.

- JS로만 쓴다면 타입 인자가 없으니 `create(...)` 한 번이면 된다. 두 번 호출은 TS 때문에 생긴 모양이다.

> 빈 괄호 `()`는 "여기서 타입 인자를 끊는다"는 표시로 읽으면 된다.

### 개념 | `set`은 맨 위 한 단계만 합친다

`useState` setter는 넘긴 값으로 state를 **통째로 바꾼다.** Zustand의 `set`은 넘긴 객체를 지금 상태에 **합친다.**

`beginCheckout`이 `set({ checkoutKey: key })`만 넘겨도 `items`가 사라지지 않는 이유다.

다만 합치는 것은 맨 위 필드뿐이다. 안쪽 객체는 합치지 않고 넘긴 값으로 갈아 끼운다.

```js
// 설명용 store: { items: [], checkoutKey: null, user: { name: "kim", age: 3 } }
set({ checkoutKey: "abc" });
console.log(get().items, get().checkoutKey); // 출력: [] abc. items는 그대로다
set({ user: { name: "lee" } });
console.log(get().user); // 출력: { name: 'lee' }. age가 사라졌다
```

안쪽 필드 하나만 바꾸려면 스프레드로 직접 합친다. `add`에서 `{ ...i, quantity: i.quantity + 1 }`로 쓴 것과 같다.

```js
set((state) => ({ user: { ...state.user, name: "lee" } }));
```

| | `useState` setter | Zustand `set` |
|---|---|---|
| 넘긴 값 | 새 state 전체 | 바꿀 필드만 |
| 맨 위 필드 | 통째로 교체 | 합친다 |
| 안쪽 객체 | 통째로 교체 | 통째로 교체 |

> 함수형(`set((state) => ...)`)을 쓰는 이유는 `useState`와 같다. 지금 상태를 읽어서 다음 상태를 만들 때는 `state` 인자로 받는다.

### 작업 2. "담기" 버튼과 장바구니 개수

상품 목록에 "담기" 버튼을 붙인다. 1단계에서 만든 `app/shop/page.tsx`에 세 군데를 더한다. `// 추가` 주석이 붙은 줄이 새로 넣는 곳이고, 나머지는 1단계 그대로다.

```tsx
// app/shop/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { publicFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store"; // 추가 ①

type Product = { id: number; name: string; price: number; stock: number };

function ProductList() {
  const { data, isPending, error } = useQuery({
    queryKey: ["products"],
    queryFn: () => publicFetch<Product[]>("/products"),
  });
  const add = useCartStore((s) => s.add); // 추가 ②: 아래 if (isPending) return 보다 위에 둔다

  if (isPending) return <p>상품을 불러오는 중…</p>;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.name} — {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
          {/* 추가 ③: 재고 괄호 뒤, </li> 앞 */}
          <button disabled={p.stock === 0} onClick={() => add({ productId: p.id, name: p.name, price: p.price })}>
            담기
          </button>
        </li>
      ))}
    </ul>
  );
}

// ShopPage는 1단계 그대로다
```

②의 `useCartStore(...)`는 훅이다. 훅은 렌더링마다 같은 순서로 같은 개수가 불려야 하므로, 조건에 따라 일찍 `return`하는 줄보다 **위에** 둔다. 아래에 두면 로딩 중에는 불리지 않다가 데이터가 오면 불려 `Rendered more hooks than during the previous render` 에러가 난다.

위쪽 내비게이션을 컴포넌트로 만들고 장바구니 개수를 붙인다.

```tsx
// app/nav.tsx
"use client";

import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";

export function Nav() {
  // 선택자(selector): store 전체가 아니라 필요한 값만 꺼낸다 → 그 값이 바뀔 때만 이 컴포넌트가 다시 그려진다
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));

  return (
    <nav style={{ display: "flex", gap: 12 }}>
      <Link href="/orders">주문 목록</Link>
      <Link href="/shop">상품</Link>
      <Link href="/me/orders">내 주문</Link>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
    </nav>
  );
}
```

레이아웃의 `<nav>`를 이 `Nav`로 바꾼다. 레이아웃에서 더는 `Link`를 쓰지 않으니 그 import도 지운다.

```tsx
// app/layout.tsx
// import Link 줄을 지우고 Nav를 import한다. body 안의 <nav>를 <Nav />로 바꾼다
import { Nav } from "./nav";
import { Providers } from "./providers";

// ...

      <body className="min-h-full flex flex-col">
        <Providers>
          <Nav />
          {children}
        </Providers>
      </body>
```

이것으로 `app/layout.tsx`는 최종 모양이 된다.

#### 확인

`/shop`에서 "담기"를 누르면 `Nav`의 숫자가 바로 바뀐다.

`ProductList`와 `Nav`는 부모-자식 관계가 아니다. 그런데도 숫자가 따라온다.

앞의 React 실습처럼 state를 공통 부모로 끌어올리고 props로 내려보낼 필요가 없다.

store는 컴포넌트 트리 **바깥**에 있는 전역 변수이고, 훅이 그 변수를 구독하기 때문이다.

### 용어 | Zustand API (선택자)

- `useCartStore((s) => 값)`(선택자): store 전체가 아니라 필요한 값만 꺼낸다. 그 값이 바뀔 때만 이 컴포넌트가 다시 그려진다. "바뀌었다"를 어떻게 판단하는지는 아래 "선택자가 새 객체를 돌려주면 안 된다"에서 다룬다.

### 개념 | 선택자가 새 객체를 돌려주면 안 된다

store가 바뀔 때마다 Zustand는 각 컴포넌트의 선택자를 다시 실행하고, 결과를 이전 결과와 `Object.is`(사실상 `===`)로 비교한다. 다르면 그 컴포넌트를 다시 그린다.

위에서 본 "참조가 바뀌었는가"가 여기서도 기준이다.

`Nav`의 선택자는 숫자를 돌려주므로 문제가 없다. 장바구니 내용이 바뀌어도 개수가 같으면 다시 그리지 않는다.

그런데 여러 값을 한 번에 꺼내려고 객체를 만들어 돌려주면, 선택자를 부를 때마다 **새 객체**가 되어 매번 "바뀌었다"로 판정된다.

```tsx
// 잘못: 호출할 때마다 새 객체 → 다시 그림 → 다시 호출 → 새 객체 → ...
const { items, remove } = useCartStore((s) => ({ items: s.items, remove: s.remove }));
```

Zustand 5에서는 이 코드가 렌더링 중에 무한 루프에 빠지고, React가 끊는다.

```text
The result of getSnapshot should be cached to avoid an infinite loop
Error: Maximum update depth exceeded. ...
```

#### 고치는 방법

```tsx
// 1. 값 하나씩 꺼낸다(5단계 CartPanel이 쓰는 방법)
const items = useCartStore((s) => s.items);
const remove = useCartStore((s) => s.remove);

// 2. useShallow로 감싸 "필드 하나하나가 같으면 같다"로 비교하게 한다
import { useShallow } from "zustand/react/shallow";
const { items, remove } = useCartStore(useShallow((s) => ({ items: s.items, remove: s.remove })));
```

- `s.items`처럼 store 안에 이미 있는 값을 그대로 돌려주는 것은 괜찮다. 바뀌지 않았으면 같은 참조다.

- `s.items.filter(...)`나 `s.items.map(...)`처럼 선택자 안에서 새 배열을 만드는 것도 같은 문제를 일으킨다. 계산은 숫자나 문자열로 끝내거나(`Nav`의 `reduce`), 꺼낸 뒤 컴포넌트 안에서 한다.

- 선택자 없이 `useCartStore()`로 전체를 꺼내면 루프는 없지만, store의 어떤 필드가 바뀌어도 다시 그려진다.

> 선택자의 반환값은 "이 컴포넌트가 다시 그려져야 하는가"를 가르는 비교 대상이다. 매번 새로 만들어지는 값을 돌려주면 비교가 의미를 잃는다.

### 작업 3. 새로고침해도 남는가

마우스를 두 번 담고 새로고침하면 `장바구니 2`가 그대로 나온다. `persist`가 `localStorage`의 `cart` 키에 저장했다가 되살렸기 때문이다.

> 개발자 도구 Application 탭의 Local Storage에서 `cart` 값을 직접 볼 수 있다.

### 개념 | 하이드레이션: 서버가 만든 HTML에 이벤트를 붙이는 일

Next.js는 페이지를 두 번 그린다.

1. **서버**가 컴포넌트를 한 번 실행해 HTML을 만들어 보낸다. 브라우저는 JS가 오기 전에도 이 HTML을 바로 보여 준다. 다만 이 HTML은 그림일 뿐이라 버튼을 눌러도 아무 일이 없다.

2. JS가 도착하면 **브라우저**가 같은 컴포넌트를 다시 한 번 실행한다. 이때 DOM을 새로 만들지 않고, 이미 있는 HTML을 자기 결과와 맞춰 보며 그 위에 `onClick` 같은 이벤트와 state를 붙인다.

2번이 하이드레이션이다. 말라 있는 HTML에 물(JS)을 부어 살아 움직이게 한다는 뜻이다.

React는 2번에서 "서버 결과와 내 결과가 같다"고 믿고 HTML을 재사용한다. 그래서 둘이 다르면 어느 쪽이 맞는지 알 수 없어 에러를 내고, 그 부분을 버리고 브라우저에서 새로 그린다. 이것이 **하이드레이션 불일치**다.

다르게 만드는 흔한 원인은 서버에 없는 것을 렌더링 중에 읽는 경우다. `localStorage`, `window`, 지금 시각(`Date.now()`), `Math.random()`이 그렇다.

> `"use client"`가 붙은 컴포넌트도 1번에서 서버에서 실행된다. "클라이언트 컴포넌트"는 "브라우저에서만 도는 컴포넌트"가 아니라 "브라우저에서도 도는 컴포넌트"다.

### 실험 | 일부러 깨뜨려보기 ①: 하이드레이션

그런데 이 페이지는 서버에서도 렌더링된다.

서버에는 `localStorage`가 없으니 서버가 만든 HTML에는 `장바구니 0`이 들어 있다. 브라우저에는 2가 저장돼 있다.

서버 결과(0)와 브라우저 첫 결과(2)가 다르니 하이드레이션 불일치가 나야 할 것 같은데, 위 코드에서는 나지 않는다.

확인하려고 `persist`를 거치지 않고 `localStorage`를 렌더링 중에 직접 읽게 바꿔 본다.

```tsx
// app/nav.tsx
// 깨뜨려보기용으로 cartCount 줄을 이 두 줄로 바꾼다
  const saved = typeof window === "undefined" ? null : localStorage.getItem("cart");
  const cartCount: number = saved ? JSON.parse(saved).state.items.reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0) : 0;
```

장바구니에 물건이 있는 상태에서 새로고침하면, 브라우저 개발자 도구 콘솔에 React가 이런 에러를 남긴다(화면 구석의 Next 개발 오버레이에도 뜬다).

> `next dev` 터미널에는 기본으로 찍히지 않는다. `next.config.ts`에 `logging: { browserToTerminal: true }`를 넣으면 브라우저 콘솔 출력이 `[browser]`를 붙여 터미널로도 넘어온다.

```text
Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:
- A server/client branch `if (typeof window !== 'undefined')`.
...
```

서버는 0을, 브라우저의 첫 렌더링은 2를 그렸으니 맞지 않는다. 원복한다.

### 개념 | `persist`는 왜 하이드레이션 에러가 없나

Zustand의 훅은 React의 `useSyncExternalStore`로 store를 구독한다. 이 API는 세 가지를 받는다.

| 인자 | Zustand가 넘기는 것 |
|---|---|
| 구독 함수 | store의 `subscribe` |
| 지금 값 | `선택자(store.getState())` |
| 서버용 값 | `선택자(store.getInitialState())`. `persist`가 되살리기 전의 초기 상태, 즉 빈 장바구니 |

하이드레이션 중에는 React가 "서버용 값"으로 그리고, 하이드레이션이 끝난 뒤에 실제 값(2)으로 다시 그린다.

그래서 첫 렌더링이 서버와 같아 불일치가 생기지 않는다. 실험 ①의 코드는 렌더링 중에 `localStorage`를 직접 읽어, 이 장치를 건너뛴 것이다.

> 대신 아주 잠깐 `장바구니 0`이 보였다가 `2`로 바뀐다. 이 깜빡임까지 없애려면 서버가 그 값을 알아야 한다(쿠키에 담는 식으로). 장바구니 개수 정도라면 받아들일 만하다.

### 남길 것

- **찾아보면 되는 것**: `create`·`persist`·`set`·`get`의 모양, `useShallow`의 import 경로. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - store는 컴포넌트 트리 밖의 전역 변수라, 부모-자식이 아니어도 같은 값을 본다. 선택자가 돌려준 값이 `===`로 바뀌었을 때만 다시 그린다. 그러니 선택자에서 새 객체·배열을 만들어 돌려주지 않는다.

  - 서버와 브라우저의 첫 렌더링은 같아야 한다. `"use client"` 컴포넌트도 첫 HTML을 만들 때 서버에서 한 번 돈다. 그래서 브라우저에만 있는 값(`localStorage`)을 렌더링 중에 직접 읽으면 하이드레이션이 깨진다.

  - 훅은 렌더링마다 같은 순서, 같은 개수로 불려야 한다. 그래서 일찍 `return`하는 줄보다 위에 둔다.

- **에러 신호**:

  - `The result of getSnapshot should be cached to avoid an infinite loop`, `Maximum update depth exceeded` → 선택자가 새 객체나 새 배열을 돌려주는지

  - `Rendered more hooks than during the previous render` → 훅(`useCartStore(...)` 등)이 `if (isPending) return`보다 아래에 있는지

  - `Hydration failed because the server rendered text didn't match the client` → 렌더링 중에 `window`·`localStorage`를 직접 읽는 곳

  - `TS2345` `... is not assignable to parameter of type 'StateCreator<CartState, [], []>'` → `create<CartState>()(...)`의 빈 괄호를 빠뜨렸는지

## 4. 3단계: 로그인과 인증이 필요한 호출

### 작업 1. 액세스 토큰 store

액세스 토큰을 담을 store다. 0장 개념 2대로 `persist`를 붙이지 않는다.

```ts
// lib/auth-store.ts
import { create } from "zustand";

type AuthState = {
  accessToken: string | null;
  setAccessToken: (token: string) => void;
  clear: () => void;
};

// 액세스 토큰은 메모리(이 store)에만 둔다. localStorage에 두면 XSS 한 번에 읽혀 나간다
// 새로고침하면 사라지지만, httpOnly 쿠키의 refresh token으로 다시 받으면 된다
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null }),
}));
```

### 작업 2. 로그인·로그아웃·refresh·`authFetch`

`api-client.ts`에 로그인, 로그아웃, refresh, 그리고 로그인이 필요한 호출을 더한다.

```ts
// lib/api-client.ts
// 맨 위에 import { useAuthStore } from "./auth-store"; 를 추가하고, 아래 함수들을 더한다
export async function login(id: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
    // 다른 출처(4000)로 보내는 요청에도 쿠키를 싣고, 응답의 Set-Cookie를 받아들인다(백엔드의 refresh token 쿠키)
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  useAuthStore.getState().clear();
}

// 4단계에서 고칠 첫 버전
export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
  if (!res.ok) {
    useAuthStore.getState().clear();
    return null;
  }
  const { accessToken } = (await res.json()) as { accessToken: string };
  useAuthStore.getState().setAccessToken(accessToken);
  return accessToken;
}

// 로그인이 필요한 API 호출. 토큰이 없거나 만료(401)면 refresh 후 한 번만 다시 시도한다
export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, ...(token && { Authorization: `Bearer ${token}` }) },
    });

  // 메모리에 토큰이 없으면(새로고침 직후) 먼저 refresh로 받아 온다
  let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
  let res = await send(token);
  if (res.status === 401 && token) {
    // 토큰이 있었는데 401 → 만료됐다 → 새로 받아 한 번만 다시 보낸다
    token = await refreshAccessToken();
    if (token) res = await send(token);
  }
  return parse<T>(res);
}
```

### 개념 | 출처가 다르면 쿠키는 기본으로 실리지 않는다(`credentials`)

브라우저에서 출처(origin)는 "스킴 + 호스트 + 포트"다. `http://localhost:3000`과 `http://localhost:4000`은 포트가 달라서 다른 출처다.

`fetch`의 기본값은 `credentials: "same-origin"`이다. 다른 출처로 가는 요청에는 쿠키를 싣지 않고, 응답의 `Set-Cookie`도 버린다.

그래서 쿠키가 오가야 하는 세 요청(`/auth/login`, `/auth/logout`, `/auth/refresh`)에만 `credentials: "include"`를 붙였다.

#### 서버 쪽 짝

`credentials: "include"`인 요청은 서버도 허락해야 받아들여진다.

응답에 `Access-Control-Allow-Origin: http://localhost:3000`(별표 `*`가 아니라 정확한 출처)과 `Access-Control-Allow-Credentials: true`가 있어야 한다.

`03`에서 CORS를 `origin: FRONTEND_URL`, `credentials: true`로 설정한 것이 이것이다. `FRONTEND_URL`이 지금 프론트 주소와 다르면 브라우저 콘솔에 `... has been blocked by CORS policy`가 찍히고, JS에는 `Failed to fetch`만 보인다.

#### `authFetch`에 `credentials`가 없는 이유

`authFetch`에는 `credentials: "include"`가 없다.

액세스 토큰은 헤더로 보내고, refresh token 쿠키는 `Path=/auth`(`03`)라 어차피 `/me/orders` 같은 요청에는 실리지 않는다.

> 쿠키는 브라우저가 알아서 붙이는 것이고, `credentials`는 "다른 출처에도 붙여도 된다"는 허락이다. 헤더(`Authorization`)는 JS가 직접 붙이므로 이 허락과 상관없다.

### 용어 | Zustand API (컴포넌트 밖에서 읽기)

- `useAuthStore.getState()`: 훅이 아니라 store 객체로 직접 읽고 쓴다. 그래서 React 컴포넌트 밖(이 함수들)에서도 쓸 수 있다. 훅으로 읽는 것과의 차이는 아래 "`getState()`는 구독하지 않는다"에서 다룬다.

### 개념 | `getState()`는 구독하지 않는다

`useAuthStore(선택자)`와 `useAuthStore.getState()`는 같은 store를 읽지만 하는 일이 다르다.

훅은 읽으면서 **구독**도 해서, 값이 바뀌면 컴포넌트를 다시 그린다. `getState()`는 그 순간의 값을 한 번 읽을 뿐 아무것도 등록하지 않는다.

0장 개념 1의 "값 + 구독자 목록"으로 말하면, 훅은 구독자 목록에 자기를 넣고 `getState()`는 값만 본다.

| | `useAuthStore((s) => ...)` | `useAuthStore.getState()` |
|---|---|---|
| 쓸 수 있는 곳 | 컴포넌트(와 훅) 안 | 어디서나 |
| 값이 바뀌면 | 컴포넌트를 다시 그린다 | 아무 일도 없다 |
| 쓰는 때 | 화면에 그릴 값 | 이벤트 처리나 비동기 함수에서 "지금 값" |

그래서 화면에 보이는 값을 `getState()`로 읽으면 화면이 따라오지 않는다.

```tsx
// 잘못: 로그인해도 Nav가 다시 그려지지 않아 "로그인" 링크가 그대로 남는다
const loggedIn = useAuthStore.getState().accessToken !== null;

// 맞음: accessToken이 바뀌면 Nav를 다시 그린다
const loggedIn = useAuthStore((s) => s.accessToken !== null);
```

- `authFetch`처럼 컴포넌트 밖에서 도는 함수는 훅을 부를 수 없으니 `getState()`를 쓴다. 이 함수들은 화면을 그리지 않으므로 구독할 필요도 없다.

- 컴포넌트 안이라도 이벤트 처리에서 한 번 부르기만 할 때는 `getState()`로 충분하다. 5단계의 `mutationFn`이 `useCartStore.getState().beginCheckout()`을 부르는 것이 그 예다. 키는 화면에 그리지 않으므로 구독할 이유가 없다.

> 화면에 그릴 값은 훅으로, 그 순간 한 번 쓸 값은 `getState()`로 읽는다.

### 작업 3. 로그인 화면

```tsx
// app/login/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    try {
      await login(String(formData.get("id")), String(formData.get("password")));
      router.push("/shop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인 실패");
    }
  }

  return (
    <main>
      <h1>로그인</h1>
      {/* action에 함수를 넘기면, 제출할 때 폼 값이 FormData로 들어온다(React 19) */}
      <form action={onSubmit}>
        <input name="id" placeholder="id" defaultValue="kim" />
        <input name="password" type="password" placeholder="password" />
        <button type="submit">로그인</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

시드 사용자 `kim`의 비밀번호는 `1234`다(6단계 테스트의 `loginAsKim`도 이 값을 쓴다).

### 작업 4. `Nav`에 로그인 상태 붙이기

2단계에서 만든 `app/nav.tsx`에 네 군데를 더한다. `// 추가` 주석이 붙은 줄이 새로 넣는 곳이고, 나머지는 2단계 그대로다.

```tsx
// app/nav.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation"; // 추가 ①
import { logout } from "@/lib/api-client"; // 추가 ①
import { useAuthStore } from "@/lib/auth-store"; // 추가 ①
import { useCartStore } from "@/lib/cart-store";

export function Nav() {
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const router = useRouter(); // 추가 ②
  const loggedIn = useAuthStore((s) => s.accessToken !== null); // 추가 ③

  return (
    <nav style={{ display: "flex", gap: 12 }}>
      <Link href="/orders">주문 목록</Link>
      <Link href="/shop">상품</Link>
      <Link href="/me/orders">내 주문</Link>
      <span data-testid="cart-count">장바구니 {cartCount}</span>
      {/* 추가 ④: 장바구니 개수 뒤, </nav> 바로 앞 */}
      {loggedIn ? (
        <button onClick={async () => { await logout(); router.push("/login"); }}>로그아웃</button>
      ) : (
        <Link href="/login">로그인</Link>
      )}
    </nav>
  );
}
```

- `useRouter`는 `"next/router"`가 아니라 `"next/navigation"`에서 가져온다. `next/router`는 예전 `pages/` 방식용이라 `app/`에서 쓰면 `NextRouter was not mounted` 에러가 난다.

- `loggedIn`은 토큰 자체가 아니라 "있는가"라는 boolean을 고른다. 토큰이 refresh로 새 값으로 바뀌어도 `true`는 그대로라 `Nav`가 다시 그려지지 않는다(앞의 "선택자" 개념).

이것으로 `app/nav.tsx`는 최종 모양이 된다.

### 작업 5. "내 주문" 목록과 상세

`03`에서 만든 `GET /me/orders`와 `GET /me/orders/:id`를 쓴다. 상세 화면은 그 주문 하나와 전체 목록을 함께 보여 준다.

```tsx
// app/me/orders/my-order-list.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch } from "@/lib/api-client";

export type MyOrder = { id: number; price: number; paid: boolean; createdAt: string };

export function MyOrderList() {
  const { data, isPending, error } = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => authFetch<MyOrder[]>("/me/orders"),
  });

  if (isPending) return <p>내 주문을 불러오는 중…</p>;
  if (error instanceof ApiError && error.status === 401) return <p role="alert">로그인이 필요합니다. <Link href="/login">로그인</Link></p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <ul data-testid="my-orders">
      {data.map((o) => (
        <li key={o.id}>
          <Link href={`/me/orders/${o.id}`}>#{o.id} — {o.price.toLocaleString()}원</Link>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// app/me/orders/page.tsx
// 서버 컴포넌트가 클라이언트 컴포넌트를 그대로 렌더링한다
import { MyOrderList } from "./my-order-list";

export default function MyOrdersPage() {
  return (
    <main>
      <h1>내 주문</h1>
      <MyOrderList />
    </main>
  );
}
```

```tsx
// app/me/orders/[id]/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ApiError, authFetch } from "@/lib/api-client";
import { MyOrderList, type MyOrder } from "../my-order-list";

function MyOrderDetail({ id }: { id: number }) {
  // 목록과 다른 이름(["my-order", id])이라 따로 요청한다 → 이 페이지를 열면 로그인이 필요한 요청 두 개가 동시에 나간다(4단계)
  const { data, isPending, error } = useQuery({
    queryKey: ["my-order", id],
    queryFn: () => authFetch<MyOrder>(`/me/orders/${id}`),
  });
  if (isPending) return <p>주문을 불러오는 중…</p>;
  if (error instanceof ApiError && error.status === 404) return <p>해당 주문은 없습니다</p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <p data-testid="order-detail">
      주문 #{data.id} — {data.price.toLocaleString()}원, {new Date(data.createdAt).toISOString().slice(0, 10)}
    </p>
  );
}

export default function MyOrderPage() {
  // 클라이언트 컴포넌트에서는 useParams로 URL의 [id]를 읽는다
  const { id } = useParams<{ id: string }>();
  return (
    <main>
      <h1>내 주문</h1>
      <MyOrderDetail id={Number(id)} />
      <h2>전체</h2>
      <MyOrderList />
    </main>
  );
}
```

`401`일 때만 따로 "로그인이 필요합니다"를 보여 주는 이유가 있다. `authFetch`가 refresh까지 해 보고도 401이면, 그건 쿠키도 없거나 회수된 것이라 다시 로그인하는 수밖에 없다.

`providers.tsx`의 `retry`가 401을 재시도하지 않게 한 것도 같은 이유다.

### 작업 6. 개발자 도구로 확인

`/login`에서 로그인한 뒤 "내 주문"을 누르면 목록이 나온다. 개발자 도구에서 다음을 확인한다.

- Network 탭: `/auth/login` 응답의 `Set-Cookie`와, `/me/orders` 요청의 `Authorization: Bearer ...` 헤더

- Application 탭의 Cookies: `refresh_token`의 HttpOnly 칸에 체크가 있는지

정상이면 이런 모양이다(값은 매번 다르다).

```text
# /auth/login 응답 헤더
Set-Cookie: refresh_token=okwa…yw; Max-Age=604800; Path=/auth; Expires=…; HttpOnly; SameSite=Strict

# /me/orders 요청 헤더
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJraW0i….hK2W…
```

- `Set-Cookie`에서 볼 것: `Max-Age=604800`(7일), `Path=/auth`(이 쿠키는 `/auth/*` 요청에만 실린다), `HttpOnly`(JS가 못 읽는다), `SameSite=Strict`. 값 자체는 무작위 문자열이라 볼 것이 없다.

- `Bearer` 뒤는 `.`으로 나뉜 세 덩어리(헤더.내용.서명)인 JWT다. 가운데 덩어리를 base64로 풀면 `{"sub":"kim","iat":…,"exp":…}`가 나오고, `exp - iat`가 900초(15분, 백엔드 `ACCESS_TOKEN_TTL`)다. 터미널에서 `echo <가운데 덩어리> | base64 -d`로 풀어 볼 수 있다.

- `/me/orders` 요청에는 `refresh_token` 쿠키가 실리지 않는 것이 정상이다. `Path=/auth`라 `/auth/*`가 아닌 요청에는 브라우저가 붙이지 않는다.

### 남길 것

- **찾아보면 되는 것**: `fetch`의 `credentials` 값 세 가지, CORS 응답 헤더 이름, `Set-Cookie` 속성(`Max-Age`·`Path`·`HttpOnly`·`SameSite`)의 뜻, `useParams`·`useRouter`의 import 경로. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 포트가 다르면 다른 출처다. 쿠키가 오가야 하는 요청에만 `credentials: "include"`를 붙이고, 서버는 정확한 출처와 `credentials: true`로 허락해야 한다.

  - 화면에 그릴 값은 훅(구독)으로, 이벤트·비동기 함수에서 한 번 쓸 값은 `getState()`로 읽는다.

- **에러 신호**:

  - 로그인은 되는데 새로고침하면 바로 "로그인이 필요합니다" → 로그인·refresh 요청에 `credentials: "include"`가 있는지

  - 콘솔에 `... has been blocked by CORS policy` → 백엔드 `.env`의 `FRONTEND_URL`, CORS의 `credentials: true`

  - 로그인했는데 `Nav`에 "로그인" 링크가 그대로 남는다 → 화면에 그릴 값을 `getState()`로 읽었는지

  - `NextRouter was not mounted` → `useRouter`를 `"next/router"`에서 가져왔는지(`app/`에서는 `"next/navigation"`)

## 5. 4단계: 새로고침하면 로그아웃된다(일부러 깨뜨려보기 ②)

### 실험 | 일부러 깨뜨려보기 ②: 같은 refresh token이 두 번 나간다

3단계의 `refreshAccessToken`(첫 버전) 그대로 진행한다.

로그인한 상태에서 `/me/orders/1`을 주소창에 직접 입력해 연다(링크 클릭이 아니라 페이지 전체를 새로 불러오는 이동). 메모리의 액세스 토큰은 사라진 상태로 시작한다.

한 번 더 같은 주소로 이동한다. Network 탭에서 `/auth/refresh` 응답을 본다.

```text
--- 1번째 이동: refresh 응답 = ["200", "401 이미 사용된 refresh token이다 - 이 로그인 세션 전체를 회수합니다"]
화면: 주문 #1 — 12,000원 | 전체 | 로그인이 필요합니다. 로그인
--- 2번째 이동: refresh 응답 = ["401 이미 사용된 ...", "401 이미 사용된 ..."]
화면: 불러오지 못했습니다: Unauthorized | 전체 | 로그인이 필요합니다. 로그인
```

페이지를 한 번 새로 열었을 뿐인데 **로그아웃됐다.**

#### 무슨 일이 일어났나

1. 이 페이지는 `MyOrderDetail`과 `MyOrderList`가 동시에 `authFetch`를 부른다.

2. 둘 다 메모리에 토큰이 없으니 각자 `refreshAccessToken()`을 불러, 같은 refresh token 쿠키로 `/auth/refresh`가 두 번 동시에 나간다.

3. 서버는 두 번째를 "이미 쓴 토큰의 재사용"으로 보고 세션 전체를 회수했다.

4. 첫 번째가 받은 새 토큰도 함께 회수됐으므로, 다음 이동에서는 아무것도 통하지 않는다.

`03`에서 이 상황을 "서버는 구별할 수 없으니 안전한 쪽으로 실패한다. 대신 클라이언트가 refresh를 한 번에 하나만 보내게 짠다"고 정리했다.

그 클라이언트 쪽이 바로 여기다.

### 작업 1. 고치기: single-flight

진행 중인 refresh가 있으면 새로 보내지 않고 그 Promise를 같이 기다린다.

```ts
// lib/api-client.ts
// refreshAccessToken을 이렇게 바꾼다(async가 빠지고, 위에 refreshing 변수가 생긴다)
// 진행 중인 refresh 요청. 있으면 새로 보내지 않고 이걸 같이 기다린다(4단계: single-flight)
let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  // ??=: 왼쪽이 null이나 undefined일 때만 오른쪽을 계산해 대입한다 → 이미 진행 중이면 그대로 둔다
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        useAuthStore.getState().clear();
        return null;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken;
    } finally {
      refreshing = null; // 끝나면 비워서, 다음 만료 때는 새로 refresh하게 한다
    }
  })();
  return refreshing;
}
```

이것으로 `lib/api-client.ts`는 최종 모양이 된다.

`refreshing`은 파일 맨 위가 아니라 `refreshAccessToken` 바로 위에 둔다. 위치는 동작에 영향이 없다. 모듈 최상위 변수는 파일이 처음 import될 때 한 번 만들어지고, 함수는 불릴 때 읽으므로 어디에 있든 같다. 다만 이 변수를 쓰는 함수가 하나뿐이라 붙여 두는 편이 읽기 쉽다. `API_URL`처럼 여러 함수가 같이 쓰는 값은 맨 위에 둔다.

#### 다시 돌려 확인

같은 순서(`/me/orders/1`을 주소창으로 두 번)로 다시 연다.

먼저 로그인을 다시 한다. 실험 ②에서 세션이 회수됐기 때문이다.

```text
--- 1번째 이동: refresh 응답 = ["200"]
화면: 주문 #1 — 12,000원 | 전체 | #1 — 12,000원 | #3 — 5,000원 | ...
--- 2번째 이동: refresh 응답 = ["200"]
화면: (같다)
```

### 개념 | single-flight가 mutex 없이 되는 이유

두 컴포넌트가 거의 동시에 불러도, 먼저 부른 쪽이 `refreshing`에 Promise를 넣고, 나중에 부른 쪽은 그 Promise를 받아 같이 기다린다. 요청은 하나만 나간다.

C로 치면 "이미 진행 중인 작업이 있으면 조건 변수에서 그 결과를 기다리는" 것과 같은 모양이다.

다만 JS는 스레드가 하나라서, `??=` 한 줄 사이에 다른 코드가 끼어들 수 없으므로 mutex가 필요 없다. 다른 코드는 `await`에서만 끼어든다.

#### 함수에서 `async`를 뺀 이유

첫 버전은 `async function`이었고, 고친 버전은 그냥 `function`이 Promise를 돌려준다.

`async function`은 부를 때마다 **새 Promise**로 감싸서 돌려준다. 같은 결과를 기다리게 되긴 하지만, "같은 Promise 하나를 나눠 갖는다"는 모양이 흐려진다.

여기서는 `refreshing`에 담긴 바로 그 Promise를 그대로 돌려준다.

#### `finally`에서 비우는 이유

성공하든 실패하든 끝나면 `refreshing`을 `null`로 돌린다.

비우지 않으면 다음 만료 때도 이미 끝난 옛 Promise(옛 토큰)를 계속 돌려준다. refresh가 실패한 경우라면 기다리던 쪽 모두가 `null`을 받고, 각자 401을 화면에 보여 준다.

> 같은 일을 여러 곳이 동시에 원할 때, 진행 중인 Promise 하나를 나눠 갖게 하면 일은 한 번만 일어난다.

### 남길 것

- **찾아보면 되는 것**: `??=` 연산자의 정의. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 한 번만 써야 하는 것(회전하는 refresh token)을 여러 컴포넌트가 동시에 쓰려 하면, 서버는 재사용으로 보고 세션을 회수한다. 클라이언트가 진행 중인 Promise를 나눠 가져 요청을 하나로 만든다. 그 Promise는 끝나면 `finally`에서 비운다. 비우지 않으면 다음 만료 때도 이미 끝난 옛 결과를 돌려준다.

  - 한 페이지에 `useQuery`가 둘이면 새로고침 직후 로그인이 필요한 요청이 동시에 나간다. "동시"는 서버만의 문제가 아니다.

- **에러 신호**:

  - `/auth/refresh` 응답이 `401 이미 사용된 refresh token이다 - 이 로그인 세션 전체를 회수합니다` → 한 번 열 때 refresh가 두 번 이상 나갔는지(single-flight)

  - 페이지를 새로 한 번 열었을 뿐인데 로그아웃된다 → Network 탭에서 `/auth/refresh` 개수

## 6. 5단계: 결제(useMutation, 무효화, Idempotency-Key)

### 작업 1. 장바구니 패널과 결제

장바구니 패널을 상품 화면에 붙인다.

```tsx
// app/shop/page.tsx
// import를 이렇게 바꾸고, ProductList 아래에 CartPanel 컴포넌트를 추가한다
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch, publicFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";

type Product = { id: number; name: string; price: number; stock: number };
type CheckoutResult = { id: number; price: number };

// ... ProductList는 그대로 ...

function CartPanel() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const queryClient = useQueryClient();

  const checkout = useMutation({
    mutationFn: () => {
      const key = useCartStore.getState().beginCheckout();
      return authFetch<CheckoutResult>("/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }),
      });
    },
    onSuccess: () => {
      useCartStore.getState().finishCheckout();
      // 결제로 재고와 내 주문이 바뀌었다 → 그 이름의 캐시를 "낡음"으로 표시해서 다시 받아 오게 한다
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    },
  });

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return (
    <section>
      <h2>장바구니</h2>
      {items.length === 0 && <p>비어 있습니다</p>}
      <ul>
        {items.map((i) => (
          <li key={i.productId}>
            {i.name} × {i.quantity} <button onClick={() => remove(i.productId)}>빼기</button>
          </li>
        ))}
      </ul>
      <p>합계 {total.toLocaleString()}원</p>
      {/* 요청이 진행 중인 동안 버튼을 막아 연타를 줄인다 */}
      <button disabled={items.length === 0 || checkout.isPending} onClick={() => checkout.mutate()}>
        {checkout.isPending ? "결제 중…" : "결제"}
      </button>
      {checkout.isSuccess && <p role="status">결제 완료: 주문 #{checkout.data.id}</p>}
      {checkout.error && (
        <p role="alert">
          결제 실패: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> — <Link href="/login">로그인</Link></>}
        </p>
      )}
    </section>
  );
}
```

`ShopPage`의 `<ProductList />` 아래에 `<CartPanel />`을 추가한다.

```tsx
// app/shop/page.tsx
// ShopPage에 CartPanel 한 줄을 더한다
export default function ShopPage() {
  return (
    <main>
      <h1>상품</h1>
      <ProductList />
      <CartPanel />
    </main>
  );
}
```

이것으로 `app/shop/page.tsx`는 최종 모양이 된다. 로그인한 뒤 마우스를 담고 "결제"를 누르면 `결제 완료: 주문 #...`이 뜨고, 마우스 재고 숫자가 줄어든다.

### 용어 | TanStack Query API (`useMutation`·무효화)

- `useQueryClient()`: `Providers`에서 만든 `QueryClient`(캐시)를 꺼낸다.

- `useMutation({ mutationFn, onSuccess })`: 서버의 데이터를 바꾸는 요청이다. 진행 중/성공/실패 상태를 대신 관리해 준다.

- `mutation.mutate()`: 요청을 실제로 보낸다.

- `mutation.isPending` / `isSuccess` / `data` / `error`: 진행 중인지, 성공했는지, 성공한 응답, 실패한 에러다.

- `queryClient.invalidateQueries({ queryKey })`: 그 이름의 캐시를 낡았다고 표시한다. 그 데이터를 보고 있는 화면이 있으면 다시 받아 온다. 보고 있는 화면이 없을 때는 아래 "`invalidateQueries`는 지금 보이는 것만 바로 다시 받는다"에서 다룬다.

`useQuery`와 달리 `useMutation`은 화면이 그려질 때 저절로 요청하지 않는다. `mutate()`를 불러야 나가고, 캐시에 저장하지도 않는다.

### 개념 | `invalidateQueries`는 지금 보이는 것만 바로 다시 받는다

`onSuccess`는 `["products"]`와 `["my-orders"]` 두 키를 무효화한다.

그런데 결제 버튼은 상품 화면에 있고, "내 주문" 목록은 지금 화면에 없다. 두 키에 일어나는 일이 다르다.

| 키 | 지금 쓰는 컴포넌트 | 무효화하면 |
|---|---|---|
| `["products"]` | 있다(`ProductList`) | 낡음으로 표시하고 바로 다시 요청한다 |
| `["my-orders"]` | 없다 | 낡음으로 표시만 한다. "내 주문"으로 가서 `MyOrderList`가 그려질 때 다시 요청한다 |

TanStack Query는 그 키를 쓰는 컴포넌트가 화면에 있는 캐시를 "활성(active)"이라 부른다.

무효화는 모든 일치하는 캐시를 낡음으로 바꾸지만, 요청은 활성인 것만 바로 보낸다. 보는 사람이 없는 데이터를 미리 받아 둘 필요가 없기 때문이다.

```ts
// 결제 성공 직후, 상품 화면에서
void queryClient.invalidateQueries({ queryKey: ["products"] }); // /products 요청이 바로 나간다
void queryClient.invalidateQueries({ queryKey: ["my-orders"] }); // 요청은 없다. 낡음 표시만 남는다
// "내 주문"으로 이동하면 그때 /me/orders 요청이 나간다(staleTime 30초가 남아 있어도)
```

- 낡음 표시는 `staleTime`보다 우선한다. 30초가 지나지 않았어도 무효화된 캐시는 다음에 그려질 때 다시 받는다. 무효화를 빼면 30초 동안 옛 재고가 보이는 "일부러 깨뜨려보기 ③"이 그 반대 경우다.

- 어느 캐시가 일치하는지는 1단계 "`queryKey`는 내용으로 비교하는 배열이다"의 앞부분 일치 규칙을 따른다.

- `invalidateQueries`는 다시 받기가 끝날 때 끝나는 Promise를 돌려준다. 여기서는 기다릴 필요가 없어서, 일부러 기다리지 않는다는 표시로 앞에 `void`를 붙였다.

> 무효화는 "다시 받아라"가 아니라 "이 사본은 믿지 마라"는 표시다. 실제로 언제 받을지는 그 데이터를 쓰는 화면이 있는지가 정한다.

### 실험 | 일부러 깨뜨려보기 ③: 무효화를 빼면

`onSuccess`에서 `["products"]` 무효화 줄을 지우고 결제한다.

결제는 성공하고 장바구니도 비워지지만, 화면의 재고 숫자는 그대로다. `staleTime`(30초) 동안 캐시를 신선하다고 보기 때문이다.

6단계의 테스트로 재면 `Expected: "88"`, `Received: "89"`로 실패한다.

서버 상태의 사본을 들고 있는 이상, **바꾼 쪽이 낡은 사본을 표시할 책임**이 있다. 0장 개념 1의 "캐시 무효화"가 이것이다.

확인했으면 원복한다.

### 개념 | Idempotency-Key를 어디서 만드는가

키를 `mutationFn` 안에서 매번 `crypto.randomUUID()`로 만들면 안 된다. 사용자가 다시 누를 때마다 새 키가 되어, `02`의 8단계가 막아 준 중복 결제가 그대로 일어난다.

키는 **"이 결제 시도"에 묶여야** 한다. 그래서 장바구니 store에 두었다.

- `beginCheckout()`은 키가 없을 때만 새로 만들고, 있으면 그대로 돌려준다 → 실패 후 다시 눌러도 같은 키다

- 장바구니 내용이 바뀌면(`add`, `remove`) 키를 버린다 → 다른 결제가 된다

- 성공하면(`finishCheckout`) 키를 버린다

- 키도 `persist`로 저장되므로, 응답을 못 받은 채 새로고침해도 같은 키로 다시 시도한다

장바구니가 바뀌었는데 같은 키를 쓰면, 서버는 `02`의 8단계대로 "같은 키, 다른 내용"으로 보고 422를 돌려준다. 키를 버리는 것은 그걸 피하려는 것이기도 하다.

### 실험 | 일부러 깨뜨려보기 ④: 응답이 사라졌을 때

`02`의 0장 개념 4처럼 "요청은 서버에 도착해 처리됐는데 응답이 사라진" 상황은 손으로 만들기 어렵다. 6단계의 Playwright 테스트가 `page.route`로 이 상황을 만든다.

1. 첫 결제 요청을 서버까지는 보내되 응답은 브라우저에 전달하지 않고 끊는다.

2. 화면에는 `결제 실패: Failed to fetch`가 뜨고, 사용자가 다시 누른다.

이때 `beginCheckout()` 대신 `crypto.randomUUID()`를 쓰도록 바꿔 두면 테스트가 이렇게 실패한다.

```text
✘ 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다
    Expected: 12
    Received: 13
```

주문이 두 개 생겼다.

원래대로 `beginCheckout()`을 쓰면 두 번째 요청이 같은 키를 달고 가서, 서버가 첫 요청의 응답을 그대로 돌려주고 주문은 하나만 생긴다. 확인했으면 원복한다.

### 남길 것

- **찾아보면 되는 것**: `useMutation`의 콜백 이름(`onSuccess` 등), `invalidateQueries`의 인자 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 서버 데이터를 바꾼 쪽이 그 데이터의 캐시를 무효화할 책임이 있다. 무효화는 "믿지 마라" 표시이고, 실제 요청은 그 데이터를 보는 화면이 있을 때 나간다.

  - 멱등성 키는 "버튼을 누른 횟수"가 아니라 "결제 시도 하나"에 묶는다. 다시 누르기·새로고침에도 같은 키, 장바구니가 바뀌면 새 키다.

- **에러 신호**:

  - 결제는 성공했는데 화면의 재고 숫자가 그대로다 → `onSuccess`의 `invalidateQueries`

  - 응답을 못 받고 다시 눌렀더니 주문이 두 개 생겼다 → 키를 `mutationFn` 안에서 매번 새로 만드는지

  - `결제 실패: Failed to fetch` → 응답이 브라우저에 오지 못했다. 서버에서는 처리됐을 수 있으니 같은 키로 다시 보낸다

## 7. 6단계: e2e 테스트로 고정하기

여기까지의 동작은 전부 브라우저에서만 드러난다(쿠키, `localStorage`, 하이드레이션, 동시 요청). 앞에서 쓴 Playwright로 고정한다.

### 작업 1. Playwright 설정

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e", // e2e 폴더의 *.spec.ts만 테스트로 본다
  // 백엔드(order-api-nest)는 미리 띄워 두어야 한다. 프론트만 여기서 띄운다
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
  use: { baseURL: "http://localhost:3000" },
  workers: 1, // 같은 DB와 같은 사용자(kim)를 쓰므로 테스트를 하나씩 돌린다
});
```

`reuseExistingServer: true`라서 `npm run dev`가 이미 켜져 있으면 그것을 쓰고, 없으면 테스트가 직접 띄운다.

### 작업 2. e2e 테스트 작성

테스트 네 개가 1~5단계의 네 가지 동작(장바구니 복원, 무효화, single-flight, 멱등성 키)을 하나씩 맡는다.

```ts
// e2e/shop.spec.ts
import { expect, test, type Page } from "@playwright/test";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message)); // 잡히지 않은 에러(하이드레이션 실패는 이쪽으로 온다)

  await loginAsKim(page);
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouse.getByRole("button", { name: "담기" }).click();
  await mouse.getByRole("button", { name: "담기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");

  await page.reload();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

test("결제하면 재고와 내 주문이 다시 받아 와진다", async ({ page }) => {
  await loginAsKim(page);
  const stock = page.getByTestId("stock-2");
  await expect(stock).not.toHaveText("");
  const before = Number(await stock.textContent());

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByRole("button", { name: "결제" }).click();
  await expect(page.getByRole("status")).toContainText("결제 완료");
  await expect(stock).toHaveText(String(before - 1)); // invalidateQueries로 다시 받아 온 재고
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 0");
});

test("새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다", async ({ page }) => {
  await loginAsKim(page);
  const refreshes: number[] = [];
  page.on("response", (res) => {
    if (res.url().endsWith("/auth/refresh")) refreshes.push(res.status());
  });

  for (let i = 0; i < 2; i++) {
    refreshes.length = 0;
    await page.goto("/me/orders/1"); // 전체 페이지 이동 → 메모리의 액세스 토큰이 사라진 상태로 시작한다
    await expect(page.getByTestId("order-detail")).toContainText("주문 #1");
    await expect(page.getByTestId("my-orders")).toBeVisible();
    expect(refreshes).toEqual([200]);
  }
});

test("결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders")).toBeVisible(); // count()는 기다리지 않으므로, 목록이 그려질 때까지 먼저 기다린다
  const countBefore = await page.getByTestId("my-orders").getByRole("listitem").count();
  await page.goto("/shop");

  // 첫 번째 결제 요청은 서버까지 보내되(route.fetch), 응답은 브라우저에 전달하지 않고 끊는다 → "타임아웃"과 같은 상황
  let first = true;
  await page.route("**/orders/checkout", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByRole("button", { name: "결제" }).click();
  await expect(page.getByText(/결제 실패/)).toBeVisible(); // role="alert"는 Next의 경로 안내 영역에도 있어서 글자로 찾는다
  await page.getByRole("button", { name: "결제" }).click(); // 사용자가 다시 누른다 — 같은 Idempotency-Key로
  await expect(page.getByRole("status")).toContainText("결제 완료");

  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders").getByRole("listitem")).toHaveCount(countBefore + 1);
});
```

### 작업 3. 스크립트 등록과 실행

```sh
npm pkg set scripts.test:e2e="playwright test"
npm run test:e2e -- --reporter=list

Running 4 tests using 1 worker

  ✓  1 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (849ms)
  ✓  2 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (572ms)
  ✓  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (938ms)
  ✓  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (962ms)
```

`npm pkg set`은 `package.json`의 `scripts`에 `"test:e2e": "playwright test"`를 넣는다. 손으로 고쳐도 같다.

`Executable doesn't exist at ...`으로 시작하는 에러가 나면 Playwright 브라우저를 받지 않은 것이다. 1장 작업 2의 `npx playwright install chromium`을 돌린다.

### 용어 | Playwright API

이 문서에서 처음 쓰는 것만 적는다.

- `page.on("pageerror", 함수)`: 페이지에서 잡히지 않은 에러가 날 때마다 함수를 부른다.

- `page.on("response", 함수)`: 브라우저가 응답을 받을 때마다 함수를 부른다.

- `page.route(주소 패턴, 함수)`: 그 주소로 가는 요청을 가로챈다.

- `route.fetch()`: 가로챈 요청을 실제 서버로 보낸다.

- `route.abort(이유)`: 브라우저에는 요청이 실패한 것처럼 끊는다.

- `route.continue()`: 가로채지 않은 것처럼 그대로 보낸다.

### 개념 | 테스트를 쓰다가 만난 함정

#### `getByRole("alert")`가 두 개에 걸린다

Next는 페이지를 이동할 때 화면 낭독기에 알려 주려고 `role="alert"`인 빈 영역(`__next-route-announcer__`)을 항상 둔다.

Playwright의 locator는 하나를 가리켜야 할 때 둘 이상에 걸리면 `strict mode violation`으로 실패한다. 그래서 내 에러 문구를 찾을 때는 역할 대신 글자로 찾았다.

#### `count()`는 기다리지 않는다

`toHaveCount` 같은 `expect`는 조건이 맞을 때까지 다시 확인하지만, `locator.count()`는 그 순간의 개수를 바로 돌려준다. 목록이 그려지기 전에 세면 0이 나온다.

> 처음 쓴 버전은 `countBefore`가 0이라 `Expected: 1, Received: 7`로 실패했다.

### 실험 | 깨뜨려보기와 테스트의 짝

각 깨뜨려보기를 다시 넣어 보면 해당 테스트가 실패하는지 확인할 수 있다. 확인한 뒤 원복한다.

| 깨뜨려보기 | 실패하는 테스트 |
|---|---|
| 4단계: `refreshing ??=`를 `refreshing =`로 바꾸기 | 3번 |
| 5단계: 무효화 빼기 | 2번 |
| 5단계: 키를 매번 새로 만들기 | 4번 |

### 남길 것

- **찾아보면 되는 것**: `page.route`·`route.fetch`·`route.abort`의 이름과 인자, `webServer` 설정 칸. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 쿠키·`localStorage`·하이드레이션·동시 요청은 브라우저에서만 드러나므로 브라우저 테스트로 고정한다. 깨뜨려보기 하나에 테스트 하나가 짝지어 실패해야 그 테스트가 쓸모 있다.

  - `expect(locator)`는 기다리고, `locator.count()`·`textContent()`는 그 순간 값을 바로 읽는다. 바로 읽기 전에는 기다리는 `expect`를 먼저 둔다.

- **에러 신호**:

  - `Expected: "88"`, `Received: "89"` (2번 테스트) → 결제 후 `["products"]` 무효화

  - 4번 테스트가 `Expected: 12`, `Received: 13` → 멱등성 키를 매번 새로 만드는지

  - `strict mode violation: getByRole('alert') resolved to 2 elements` → Next의 경로 안내 영역. 글자로 찾는다

  - `Expected: 1, Received: 7`처럼 처음 센 값이 0 → `count()` 전에 목록이 보일 때까지 기다렸는지

  - `Executable doesn't exist at ...` → `npx playwright install chromium`

## 8. 7단계: 디버깅

### 진단 1. 이 값은 서버에서 왔나, 캐시에서 왔나

Network 탭에서 그 API 요청이 **실제로 나갔는지**부터 본다.

요청이 없는데 화면이 바뀌지 않는다면 캐시를 보고 있는 것이다. `staleTime`이 남아 있거나 무효화를 빼먹었다.

> 캐시 안을 직접 보고 싶으면 공식 개발 도구(`@tanstack/react-query-devtools`)를 `Providers` 안에 넣는다. 화면 구석에 각 `queryKey`의 데이터와 상태(fresh, stale, fetching)를 보여 준다.

### 진단 2. 쿠키가 안 가는가

`03`의 디버깅 장 "쿠키가 실리지 않을 때 확인할 것"과 같은 순서로 본다. 브라우저에서 특히 자주 빠뜨리는 것은 두 가지다.

| 증상 | 원인 |
|---|---|
| 로그인은 되는데 새로고침하면 바로 "로그인이 필요합니다" | 로그인이나 refresh 요청에 `credentials: "include"`가 빠졌다. 쿠키를 받지도 보내지도 않는다 |
| 콘솔에 `... has been blocked by CORS policy` | 백엔드 `.env`의 `FRONTEND_URL`이 지금 프론트 주소와 다르거나, `credentials: true`가 빠졌다 |

Application 탭의 Cookies에서 `localhost` 아래에 `refresh_token`이 있는지, `Path`가 `/auth`인지 본다.

### 진단 3. 하이드레이션 에러가 나면

브라우저 콘솔(또는 Next 개발 오버레이)의 `Hydration failed ...` 메시지 아래에 어느 컴포넌트에서 어떤 값이 달랐는지가 나온다.

클라이언트 컴포넌트가 렌더링 중에 `window`, `localStorage`, `Date.now()`, `Math.random()`을 읽는지 찾는다.

> 브라우저에서만 알 수 있는 값은 `useEffect` 안에서 읽거나, 2단계처럼 `useSyncExternalStore`(Zustand가 쓰는 방식)로 "서버용 값"을 따로 준다.

### 진단 4. refresh가 몇 번 나가는가

Network 탭의 필터에 `refresh`를 넣고 페이지를 새로 연다. 한 번 열 때 `/auth/refresh`가 **두 번 이상** 나가면 single-flight가 깨진 것이다.

응답 중 하나라도 `이미 사용된 refresh token이다`면 그 순간 세션이 회수됐다. `03`의 디버깅 장 "refresh token 사슬 들여다보기"에서 그 사슬을 DB로 확인할 수 있다.

### 진단 5. 에러 메시지·증상으로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `ReferenceError: Link is not defined`(모든 페이지가 500) | 레이아웃에 `<Link>`를 넣고 import를 빠뜨렸다 | `layout.tsx`에 `import Link from "next/link"`가 있는지 | 1단계 |
| `No QueryClient set, use QueryClientProvider to set one` | `useQuery`를 쓰는 컴포넌트 위에 캐시를 나눠 주는 Provider가 없다 | `layout.tsx`가 `<Providers>`로 감싸는지 | 1단계 |
| `상품을 불러오지 못했습니다: Failed to fetch` | 요청이 응답을 받지 못했다(서버가 꺼졌거나 CORS로 막혔다) | 백엔드가 4000에서 떠 있는지, `NEXT_PUBLIC_API_URL`, `next dev` 재시작 | 1단계 |
| `'data' is possibly 'undefined'. (TS18048)` | 판별 유니온이 좁혀지지 않았다 | `isPending`과 `error`를 먼저 걸렀는지 | 1단계 |
| `The result of getSnapshot should be cached to avoid an infinite loop`, `Maximum update depth exceeded` | 선택자가 부를 때마다 새 값을 돌려줘 매번 "바뀌었다"로 판정된다 | 선택자가 새 객체·배열을 만드는지(`useShallow`) | 2단계 |
| `Rendered more hooks than during the previous render` | 훅을 조건부 `return`보다 아래에서 불러, 렌더링마다 불리는 훅 개수가 달라졌다 | `useCartStore(...)`·`useQuery(...)`가 `if (isPending) return`보다 위에 있는지 | 2단계 |
| `Hydration failed because the server rendered text didn't match the client` | 서버와 브라우저의 첫 렌더링 결과가 다르다 | 렌더링 중에 `window`·`localStorage`를 직접 읽는 곳(진단 3) | 2단계 |
| `TS2345` `... is not assignable to parameter of type 'StateCreator<CartState, [], []>'` | 미들웨어 타입이 추론되지 않았다 | `create<CartState>()(...)`의 빈 괄호 | 2단계 |
| 로그인은 되는데 새로고침하면 바로 "로그인이 필요합니다" | 쿠키를 받지도 보내지도 않는다 | 로그인·refresh 요청의 `credentials: "include"`(진단 2) | 3단계 |
| `... has been blocked by CORS policy` | 서버가 이 출처의 자격 증명 요청을 허락하지 않았다 | 백엔드 `FRONTEND_URL`, CORS `credentials: true`(진단 2) | 3단계 |
| 로그인했는데 `Nav`에 "로그인" 링크가 그대로 남는다 | 화면이 store를 구독하지 않는다 | 화면에 그릴 값을 `getState()`로 읽었는지 | 3단계 |
| `NextRouter was not mounted` | `pages/` 방식용 라우터를 `app/`에서 썼다 | `useRouter`의 import가 `"next/navigation"`인지 | 3단계 |
| `/auth/refresh`가 `401 이미 사용된 refresh token이다 - 이 로그인 세션 전체를 회수합니다` | 같은 refresh token이 두 번 쓰여 서버가 세션을 회수했다 | 한 번 열 때 refresh가 몇 번 나가는지(진단 4) | 4단계 |
| 페이지를 새로 한 번 열었을 뿐인데 로그아웃된다 | 동시 refresh로 세션이 회수됐다 | `refreshAccessToken`의 single-flight(`refreshing ??=`) | 4단계 |
| 결제는 성공했는데 재고 숫자가 그대로다 | 낡은 캐시를 `staleTime` 동안 신선하다고 본다 | `onSuccess`의 `invalidateQueries`(진단 1) | 5단계 |
| 응답을 못 받고 다시 눌렀더니 주문이 두 개 | 다시 누를 때 새 멱등성 키가 나갔다 | 키를 `beginCheckout()`으로 받는지 | 5단계 |
| `결제 실패: Failed to fetch` | 응답이 브라우저에 오지 못했다. 서버에서는 처리됐을 수 있다 | 같은 키로 다시 보내는지 | 5단계 |
| `Expected: "88"`, `Received: "89"` | 결제 후 재고를 다시 받지 않았다 | `["products"]` 무효화 | 6단계 |
| `Expected: 12`, `Received: 13` (4번 테스트) | 주문이 두 개 생겼다 | 멱등성 키를 매번 새로 만드는지 | 6단계 |
| `strict mode violation: getByRole('alert') resolved to 2 elements` | Next의 경로 안내 영역도 `role="alert"`다 | 역할 대신 글자로 찾는다 | 6단계 |
| `Expected: 1, Received: 7`처럼 처음 센 개수가 0 | `count()`가 목록이 그려지기 전에 셌다 | 먼저 `toBeVisible()`로 기다렸는지 | 6단계 |
| `Executable doesn't exist at ...` | Playwright 브라우저가 설치되지 않았다 | `npx playwright install chromium` | 6단계 |
| Network 탭에 요청이 없는데 화면이 그대로다 | 캐시를 보고 있다 | `staleTime`, `invalidateQueries`(진단 1) | 7단계 |
| `refresh_token` 쿠키가 없거나 `Path`가 `/auth`가 아니다 | 로그인 응답의 쿠키를 받지 못했거나 서버 쿠키 설정이 다르다 | 로그인 요청의 `credentials`, 백엔드 쿠키 설정(진단 2) | 7단계 |
| 한 번 열 때 `/auth/refresh`가 두 번 이상 | single-flight가 깨졌다 | `refreshing ??=`(진단 4) | 7단계 |

### 시험해보기

```sh
# 백엔드가 4000에서 돌고 있는 상태에서
npm run test:e2e -- --reporter=list
```

4개가 통과하는지 확인한다.

이어서 브라우저로 `/shop`에서 담기 → 새로고침 → 결제 → "내 주문"까지 손으로 한 번 따라가며 Network 탭의 요청 순서를 본다.

### 도전 과제

#### 1. 실시간 알림으로 "내 주문" 갱신하기

앞에서 `scratch-client.mjs`가 하던 일을 화면에 붙인다.

1. 로그인한 뒤 `socket.io-client`로 연결한다.

2. `order.created` 이벤트를 받으면 `queryClient.invalidateQueries({ queryKey: ["my-orders"] })`를 부른다.

다른 탭에서 결제하면 이 탭의 "내 주문"이 저절로 갱신되는지 확인한다. 연결할 때 넘기는 토큰이 만료되면 어떻게 해야 할지도 생각해 본다.

**답**

`npm install socket.io-client`로 설치하고, 화면에는 아무것도 그리지 않는 컴포넌트를 만들어 `app/layout.tsx`의 `<Nav />` 아래에 둔다.

```tsx
// app/order-notifications.tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

export function OrderNotifications() {
  const queryClient = useQueryClient();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);

  useEffect(() => {
    if (!loggedIn) return;
    // auth를 함수로 넘기면 연결(재연결 포함)할 때마다 불린다 → 그때 store에 있는 최신 토큰을 싣는다
    const socket = io(API_URL, { auth: (cb) => cb({ token: useAuthStore.getState().accessToken }) });
    socket.on("order.created", () => {
      void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    });
    // 서버가 토큰을 거절해 끊으면 socket.io는 다시 연결하지 않는다 → refresh로 새 토큰을 받고 직접 다시 연결한다
    socket.on("disconnect", async (reason) => {
      if (reason !== "io server disconnect") return;
      const token = await refreshAccessToken();
      if (token) socket.connect();
    });
    return () => {
      socket.disconnect();
    };
  }, [loggedIn, queryClient]);

  return null;
}
```

1. "내 주문"을 링크로 열어 둔 탭은 로그인한 상태라 소켓이 연결돼 있다. 같은 브라우저의 다른 탭에서 마우스를 결제하면, 이 탭은 아무것도 누르지 않았는데 목록이 2개에서 3개로 늘어난다.

2. 순서는 소켓으로 `order.created`를 받음 → `invalidateQueries(["my-orders"])` → `/me/orders`를 다시 요청이다. 위 컴포넌트를 빼면 같은 상황에서 목록은 2개 그대로다.

3. 토큰 만료: 서버는 연결할 때만 토큰을 검사한다. 연결된 뒤에 토큰이 만료돼도 소켓은 그대로 살아 있다. 문제는 다시 연결할 때다.

4. 백엔드의 `ACCESS_TOKEN_TTL`을 `5s`로 두고, 토큰이 만료된 뒤 백엔드를 재시작해 봤다. socket.io가 스스로 다시 연결하지만 만료된 토큰이라 서버가 바로 끊는다(`io server disconnect`). 위 코드는 여기서 `/auth/refresh`(200)로 새 토큰을 받아 다시 연결하고, 그 뒤 다른 탭의 결제 알림도 받는다.

5. `disconnect` 처리를 빼면 서버에 끊긴 뒤로 다시 연결하지 않는다. 그 뒤 다른 탭에서 결제해도 알림이 오지 않아 목록이 그대로다.

> 연결 중에 토큰이 만료되는 것은 괜찮고, 다시 연결할 때 새 토큰을 싣는 것이 핵심이다. 그래서 `auth`에 값 대신 함수를 넘겼다.

#### 2. 낙관적 업데이트 만들기

결제 버튼을 누르면 응답을 기다리지 않고 재고 숫자를 먼저 줄여 보여 주고, 실패하면 되돌린다. `useMutation`의 `onMutate`/`onError`로 만든다.

재고 부족(409)이 났을 때 숫자가 제대로 되돌아오는지 확인한다.

**답**

`CartPanel`의 `useMutation`에 두 콜백을 더한다(`onSuccess`는 그대로 둔다).

```tsx
// app/shop/page.tsx
// CartPanel의 useMutation 안에 두 콜백을 더한다
    onMutate: async () => {
      // 진행 중인 상품 목록 요청이 있으면 취소한다 → 늦게 도착한 옛 응답이 줄여 둔 숫자를 덮어쓰지 않게
      await queryClient.cancelQueries({ queryKey: ["products"] });
      const previous = queryClient.getQueryData<Product[]>(["products"]);
      queryClient.setQueryData<Product[]>(["products"], (old) =>
        old?.map((p) => {
          const item = items.find((i) => i.productId === p.id);
          return item ? { ...p, stock: p.stock - item.quantity } : p;
        }),
      );
      return { previous }; // 여기서 반환한 값이 onError의 세 번째 인자로 들어온다
    },
    onError: (_error, _variables, onMutateResult) => {
      if (onMutateResult?.previous) queryClient.setQueryData(["products"], onMutateResult.previous);
    },
```

1. 재고가 10인 한정판 키보드를 11개 담고 결제를 누른다(확인하려고 결제 응답을 1초 늦췄다).

2. 응답이 오기 전에 재고 숫자가 `-1`로 먼저 바뀐다. `onMutate`가 캐시를 직접 고쳤기 때문이다.

3. 서버가 409를 돌려주면 `결제 실패: 재고 부족: 한정판 키보드`가 뜨고, `onError`가 저장해 둔 `previous`로 캐시를 되돌려 숫자가 `10`으로 돌아온다.

4. `onMutate`/`onError`가 없는 원래 코드에서는 응답 전에도 숫자가 `10` 그대로다.

> `onMutate`에서 반환한 값이 되돌릴 때 쓰는 "결제 전 사본"이다. 사본을 남기지 않으면 실패했을 때 돌아갈 숫자가 없다.

### 남길 것

- **찾아보면 되는 것**: Network 탭 필터, Application 탭의 Cookies·Local Storage 위치, `@tanstack/react-query-devtools` 설치 방법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 화면이 이상하면 먼저 "요청이 실제로 나갔는가"를 본다. 안 나갔으면 캐시 문제(`staleTime`, 무효화), 나갔는데 실패했으면 네트워크·인증 문제(쿠키, CORS)다.

  - 새로고침 한 번에 `/auth/refresh`는 정확히 한 번이어야 한다. 두 번이면 세션이 회수된다.

- **에러 신호**:

  - Network 탭에 요청이 없는데 화면이 그대로다 → `staleTime`, `invalidateQueries`(진단 1)

  - `refresh_token` 쿠키가 없거나 `Path`가 `/auth`가 아니다 → 로그인 요청의 `credentials`, 백엔드 쿠키 설정(진단 2)

  - 한 번 열 때 `/auth/refresh`가 두 번 이상 → single-flight(진단 4)

## 9. 완성 확인

### 체크리스트

- [ ] 같은 `queryKey`를 쓰는 컴포넌트가 여럿이어도 요청은 하나이고, `staleTime` 안에는 다시 요청하지 않는다

- [ ] 장바구니가 새로고침해도 남고, 하이드레이션 에러가 없다. `localStorage`를 렌더링 중에 직접 읽으면 에러가 나는 것을 재현했다

- [ ] 액세스 토큰은 메모리에만 있고, 새로고침 뒤에는 refresh로 다시 받는다

- [ ] 로그인이 필요한 요청 두 개가 동시에 나가도 `/auth/refresh`는 한 번만 나간다

- [ ] 결제 후 재고와 내 주문이 다시 받아 와진다

- [ ] 결제 응답이 사라져 다시 눌러도 주문은 하나만 생긴다

- [ ] `npm run test:e2e`가 통과한다

## 10. 다음 단계

### 자가 점검

1. 서버 상태와 클라이언트 상태는 무엇이 다르고, 각각 무엇으로 다뤘는가?

2. 서버에서 렌더링할 때 `QueryClient`를 모듈 전역에 하나만 두면 어떤 일이 생기는가?

3. Zustand store를 쓰는 `Nav`와 `ProductList`가 부모-자식이 아닌데도 같은 값을 보는 이유는?

4. `persist`로 되살린 장바구니는 하이드레이션 에러가 안 나는데, `localStorage`를 직접 읽으면 나는 이유는?

5. 액세스 토큰에 `persist`를 붙이지 않은 이유와, 그 대가는?

6. single-flight 없이 새로고침하면 로그아웃되는 과정을 `03`의 재사용 감지와 연결해서 설명하면?

7. Idempotency-Key를 `mutationFn` 안에서 매번 만들면 안 되는 이유는? 장바구니가 바뀌면 키를 버리는 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 서버 컴포넌트에서 미리 가져온 데이터를 TanStack Query 캐시에 넘기기(prefetch와 hydration), Suspense와 `useSuspenseQuery`

- 무한 스크롤(`useInfiniteQuery`), 페이지네이션

- Zustand의 미들웨어(devtools, immer), store를 여러 개로 나누는 기준

- 폼 라이브러리와 클라이언트 검증(zod를 프론트에서도 같이 쓰기)

- 액세스 토큰 만료 직전에 미리 refresh하기, 여러 탭 사이에서 토큰 공유하기(BroadcastChannel)
