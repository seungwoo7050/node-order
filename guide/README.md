# 서비스 워커: 네트워크가 끊겨도 마지막 화면 보여 주기

## 목표

이 프로젝트는 [`10-rls`](https://github.com/seungwoo7050/node-order/tree/10-rls)로부터 시작한다.

지금의 `order-console-next`는 네트워크가 끊기면 새로고침하는 순간 브라우저의 "인터넷 연결 없음" 화면이 뜬다.

이 문서는 서비스 워커를 붙여서, 한 번 본 상점 화면과 상품 목록을 오프라인에서도 보여 준다.

결제처럼 서버가 꼭 있어야 하는 기능은 막는다.

1. 서비스 워커를 등록하고, 언제부터 페이지를 맡는지 확인한다

2. 요청 종류마다 다른 캐시 전략을 쓴다(빌드 파일, 페이지, 공개 API)

3. 오프라인 표시와 결제 막기를 붙인다

4. 로그인이 필요한 응답을 캐시하면 다른 사용자에게 새는 것을 재현하고 막는다

5. 새 버전을 배포했을 때 옛 서비스 워커와 옛 캐시가 어떻게 바뀌는지 본다

```sh
온라인에서 /shop을 한 번 본 뒤 네트워크를 끊고 새로고침
→ 상품 목록이 그대로 보이고, 위에 "오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다"
→ 결제 버튼은 눌리지 않는다

캐시: pages-v1, static-v1, api-v1
```

> 시작 기준점:  
> `order-console-next`에 nonce CSP(`proxy.ts`)가 붙어 있고, 상점(`/shop`)·로그인·내 주문 화면과 Playwright e2e 테스트가 있다.  

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 되돌리는 일은 뒤따르는 `작업 N. [원복]`이다 |
| `진단 N.` | 8장(디버깅)에서 "어디서 틀어졌나"를 가르는 절차 | 친다(개발자 도구) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 8장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지 보여 준다. 섞이면 센 쪽 하나만 붙인다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드 작성·수정, 설정 파일 | 한다 |
| `[실행]` | 저장소 밖의 상태: 컨테이너, DB 시드, 무시되는 `.env.local`. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 빌드, 테스트, 콘솔 조회 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 8장 "진단 3"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 백엔드와 환경 파일을 갖추는 `[실행]`뿐이고 9·10장은 체크리스트라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | 서비스 워커를 `LD_PRELOAD` 같은 프록시로, 생명주기를 데몬 교체로 본다(작업 없음) |
| [1. 준비](#1-준비) | 백엔드를 띄우고, 새로 만들 파일 목록을 본다 |
| [2. 1단계: 등록](#2-1단계-등록) | `/sw.js`를 등록하고 응답 헤더와 CSP를 맞춘다 |
| [3. 2단계: 무엇을 어떻게 캐시하나](#3-2단계-무엇을-어떻게-캐시하나) | 빌드 파일은 cache-first, 페이지와 공개 API는 network-first로 캐시한다 |
| [4. 3단계: 오프라인 화면](#4-3단계-오프라인-화면) | 오프라인 배너를 띄우고 결제 버튼을 막는다 |
| [5. 4단계: 일부러 깨뜨려보기, 로그인 응답을 캐시하면](#5-4단계-일부러-깨뜨려보기-로그인-응답을-캐시하면) | 로그인 응답이 URL 키로 캐시돼 다른 사용자에게 새는 것을 재현하고 막는다 |
| [6. 5단계: 새 버전 배포](#6-5단계-새-버전-배포) | 새 버전이 대기하는 것을 보고, `skipWaiting`으로 바로 바꾸고 그 대가를 본다 |
| [7. 6단계: 테스트](#7-6단계-테스트) | Playwright를 운영 빌드로 띄워 오프라인 동작과 캐시 누출을 테스트한다 |
| [8. 디버깅](#8-디버깅) | Application 탭, 서비스 워커 콘솔, 증상별 원인 표 |
| [9. 완성 확인](#9-완성-확인) | 체크리스트 |
| [10. 다음 단계](#10-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | 서비스 워커는 브라우저 안의 프록시다.

C로 `LD_PRELOAD`를 써 봤다면 그림이 쉽다.

프로그램을 고치지 않고 `connect()`·`read()` 같은 호출을 가로채는 라이브러리를 끼워 넣으면, 프로그램은 평소처럼 호출하는데 실제 동작은 끼워 넣은 쪽이 정한다.

네트워크 대신 파일에서 읽어 돌려줄 수도 있다.

서비스 워커가 이 자리에 있다.

페이지의 JS가 `fetch()`를 부르거나 브라우저가 페이지·스크립트를 받으려 할 때, 요청이 네트워크로 가기 전에 서비스 워커의 `fetch` 이벤트로 들어온다.

서비스 워커는 세 가지 중 하나를 고른다.

- 아무것도 안 한다 → 원래대로 네트워크로 간다

- 네트워크로 보내고, 받은 응답을 저장해 둔다

- 네트워크로 보내지 않고 저장해 둔 응답을 돌려준다

저장소는 Cache Storage다. 요청(URL)을 키로, 응답(상태 코드, 헤더, 본문)을 값으로 저장하는 키-값 저장소라고 보면 된다.

**키가 URL뿐이라는 점이 4단계의 함정이다.** 같은 URL이면 누가 요청했든 같은 칸을 쓴다.

> 서비스 워커는 페이지와 다른 스레드에서 돈다. DOM에 손댈 수 없고, 페이지의 변수나 `process.env`도 못 읽는다. 페이지와는 메시지로만 이야기한다.

### 개념 2 | 생명주기: 실행 중인 데몬을 바꿔 끼우는 문제

서비스 워커 파일은 한 번 설치되면 페이지를 닫아도 브라우저에 남는다.

그래서 새 버전을 배포할 때 "지금 돌고 있는 옛 버전을 언제 내리고 새 버전을 올릴까"가 문제가 된다.

서버에서 데몬을 무중단으로 교체할 때와 같은 고민이다.

데몬은 터미널에 붙어 있지 않고 뒤에서 계속 도는 프로세스다. `sshd`, `nginx`, `cron`처럼 이름 끝에 `d`가 붙은 것이 많다.

셸에서 실행한 프로그램은 터미널을 닫으면 같이 끝나지만, 데몬은 띄운 사용자가 로그아웃해도 남아서 요청을 기다린다.

서비스 워커도 그렇다. 등록한 페이지를 닫아도 브라우저에 남아, 다음에 그 사이트의 요청이 오면 받는다.

데몬의 새 버전을 배포하면 옛 프로세스가 붙들고 있는 연결을 어떻게 할지 정해야 한다.

`nginx`의 reload는 옛 워커를 맡던 요청이 끝날 때까지 남겨 두고, 새 연결만 새 워커에 보낸다. 아래의 대기 단계가 같은 생각이다.

> 정확히는 서비스 워커가 늘 깨어 있지는 않다. 할 일이 없으면 브라우저가 멈췄다가 요청이 오면 다시 깨운다(8장 진단 2).  
> 요청이 올 때 프로세스를 띄워 주는 `systemd`의 소켓 활성화에 더 가깝다.

```text
설치(install) → 대기(waiting) → 활성화(activate) → 요청 가로채기(fetch)
```

- 설치: 새 파일을 내려받으면 일어난다. 캐시를 미리 채울 수 있다.

- 대기: 옛 버전이 아직 열린 탭을 맡고 있으면, 새 버전은 그 탭이 모두 닫힐 때까지 기다린다. 한 탭 안에서 옛 버전과 새 버전이 섞이지 않게 하려는 규칙이다.

- 활성화: 옛 버전이 내려가고 새 버전이 맡는다. 옛 캐시를 지우기 좋은 때다.

5단계에서 이 대기를 직접 보고, 기다리지 않게 바꾸는 방법과 그 대가를 본다.

## 1. 준비

`08`의 `order-console-next`에서 이어 간다. 새로 설치할 패키지는 없다.

### 작업 1. [실행] 백엔드 띄우기

백엔드는 `10`의 `order-api-nest` 폴더에서 따로 띄운다.

```sh
# order-api-nest 폴더에서
docker compose up -d db redis storage
npx prisma db seed
npm run start:dev # localhost:4000
```

### 작업 2. [실행] 프론트 폴더로 이동

```sh
cd order-console-next
# .env.local이 아직 없다면 예시 파일을 복사한다(NEXT_PUBLIC_API_URL=http://localhost:4000)
cp .env.example .env.local
```

이 문서에서 새로 만들거나 고치는 파일은 다음과 같다.

| 파일 | 역할 |
|---|---|
| `public/sw.js` | 서비스 워커 본체(새 파일) |
| `app/sw-register.tsx` | 브라우저에 서비스 워커를 등록(새 파일) |
| `app/online-banner.tsx` | 온라인/오프라인 상태와 배너(새 파일) |
| `app/layout.tsx` | 위 두 컴포넌트를 붙인다 |
| `app/shop/page.tsx` | 오프라인이면 결제 버튼을 막는다 |
| `next.config.ts` | `/sw.js` 응답 헤더 |
| `proxy.ts` | CSP에 `worker-src` |
| `playwright.config.ts`, `e2e/offline.spec.ts` | 운영 빌드로 띄우는 테스트 |

### 개념 | 서비스 워커는 운영 빌드에서만 켠다

개발 서버(`next dev`)에서 켜 두면 코드를 고쳐도 캐시된 옛 파일이 보여서 혼란스럽다.

그래서 이 문서의 확인은 전부 `npm run build && npm run start`로 한다.

> 서비스 워커는 HTTPS에서만 동작하는데, `localhost`는 예외로 허락된다.

## 2. 1단계: 등록

서비스 워커 파일은 `public/`에 둔다. 그러면 `/sw.js` 주소로 그대로 나간다.

### 개념 | 범위(scope): 파일 위치가 맡을 경로를 정한다

이 주소의 위치가 중요하다. 서비스 워커는 자기 파일이 있는 경로와 그 아래만 맡는다.

`/sw.js`면 사이트 전체(`/`), `/static/sw.js`였다면 `/static/` 아래만 맡는다.

### 작업 1. [커밋] 빈 `public/sw.js` 만들기

내용은 2단계에서 채운다.

지금은 빈 파일만 둔다. 빈 파일도 서비스 워커로 등록·설치는 되고, `fetch` 이벤트를 걸지 않았으니 아무 요청도 가로채지 않는다.

파일이 아예 없으면 아래 등록이 404로 실패한다.

```sh
touch public/sw.js
```

### 작업 2. [커밋] 등록 컴포넌트 만들기

등록은 클라이언트 컴포넌트에서 한다.

```tsx
// app/sw-register.tsx
"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/api-client";

// 브라우저에 서비스 워커를 등록한다. 개발 서버에서는 코드를 고칠 때마다 캐시가 방해가 되므로 운영 빌드에서만 켠다
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // 서비스 워커는 환경변수를 못 읽으므로 API 주소를 쿼리로 넘긴다
    navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(API_URL)}`).catch((err) => console.error("서비스 워커 등록 실패:", err));
  }, []);
  return null;
}
```

### 개념 | `sw.js`에는 환경변수가 들어가지 않는다

`API_URL`은 `lib/api-client.ts`에서 `process.env.NEXT_PUBLIC_API_URL`로 읽는다.

Next는 빌드할 때 번들에 들어가는 코드에서만 이 자리를 실제 값으로 바꿔 넣는다.

`public/` 아래 파일은 빌드를 거치지 않고 그대로 복사되어 나간다.

그래서 `sw.js` 안에 `process.env.NEXT_PUBLIC_API_URL`을 써도 값이 들어가지 않는다. 서비스 워커에는 `process` 자체가 없다.

그래서 등록할 때 쿼리로 넘기고, 서비스 워커 안에서 `self.location`으로 읽는다(2단계).

### 작업 3. [커밋] 레이아웃에 붙이기

`app/layout.tsx`에 import 한 줄을 넣고, `<Providers>` 안에 `<SwRegister />`를 넣는다.

```tsx
// app/layout.tsx
// import 한 줄과 <SwRegister />만 추가한다
import { SwRegister } from "./sw-register";
// ... 기존 import 그대로 ...

        <Providers>
          <Nav />
          <SwRegister />
          {children}
        </Providers>
```

`<OnlineBanner />`는 3단계에서 그 파일을 만든 뒤에 이 자리 바로 아래에 붙인다.

### 작업 4. [커밋] `/sw.js` 응답 헤더 정하기

`next.config.ts`의 기존 설정은 그대로 두고, `headers()`만 더한다.

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ... 기존 설정 그대로(cacheComponents, partialPrefetching, turbopack) ...
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
  // 여기부터 추가한다
  async headers() {
    return [
      {
        // 서비스 워커 파일 자체는 브라우저 캐시에 두지 않는다 → 새로 배포하면 브라우저가 바로 알아챈다(5단계)
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

`headers()`는 경로(`source`)마다 응답에 붙일 헤더를 정하는 Next 설정이다. 왜 이 파일만 캐시하지 않게 하는지는 5단계 "브라우저는 언제 새 버전을 알아채나"에서 다룬다.

`Cache-Control`의 세 값은 Next가 아니라 HTTP의 것이다. Next는 적힌 그대로 내보내고, 브라우저와 CDN이 읽는다.

- `no-store`: 어디에도 저장하지 않는다.

- `no-cache`: 저장은 해도 되지만, 쓸 때마다 서버에 바뀌었는지 묻는다.

- `must-revalidate`: 유효 기간이 지나면 서버에 묻기 전에는 쓰지 않는다.

`no-store` 하나로 충분하고, 나머지 둘은 `no-store`를 따르지 않는 옛 브라우저와 프록시를 위한 덧댐이다.

> 이름이 비슷한 Next의 `revalidate`(서버에 캐시한 페이지·데이터를 몇 초마다 다시 만들지)와는 관계가 없다. 같은 설정 객체에 `headers()`와 나란히 쓰는 `redirects()`(다른 주소로 보내기)도 이 문서에서는 쓰지 않는다.

### 작업 5. [커밋] CSP에 `worker-src` 추가

CSP에 한 줄을 더한다.

`worker-src`가 없으면 브라우저는 `child-src`, 그것도 없으면 `script-src`를 따른다. 이 CSP에는 `child-src`가 없으니 `script-src`로 간다.

지금 `script-src`에는 `'strict-dynamic'`이 있어 해석이 복잡해지므로, 서비스 워커는 우리 서버의 파일만 된다고 직접 적는다.

```ts
// proxy.ts
// csp 배열의 connect-src 다음 줄에 추가한다
    // 서비스 워커는 우리 서버의 /sw.js만. 없으면 script-src를 따르는데, 그 규칙을 브라우저마다 다르게 해석할 여지를 없앤다
    "worker-src 'self'",
```

### 작업 6. [확인] 빌드하고 헤더 확인

```sh
npm run build && npm run start

curl -sI localhost:3000/sw.js | grep -iE "content-type|cache-control"
Content-Type: application/javascript; charset=utf-8
Cache-Control: no-cache, no-store, must-revalidate

curl -sI localhost:3000/shop | grep -io "worker-src[^;]*"
worker-src 'self'
```

브라우저에서 `/shop`을 열고 콘솔에 `서비스 워커 등록 실패:`가 없으면 등록된 것이다.

여기서 콘솔은 `npm run start`를 띄운 터미널이 아니라 브라우저 개발자 도구의 Console 탭이다(Chrome에서 `Cmd + Option + J`, Windows는 `F12`). `SwRegister`는 클라이언트 컴포넌트라 그 `console.error`는 브라우저에서 돈다. 터미널에는 서버에서 돈 코드의 로그만 나온다.

등록됐다는 것을 직접 보려면 같은 개발자 도구의 Application 탭 → Service workers에서 `sw.js`가 `activated and is running`으로 나오는지 본다.

### 용어 | Service Worker API (등록)

- `"serviceWorker" in navigator`: 이 브라우저(와 이 주소)에서 서비스 워커를 쓸 수 있는지 확인한다.

- `navigator.serviceWorker.register(경로)`: 그 경로의 파일을 서비스 워커로 등록한다. 설치는 비동기로 진행되고, 결과는 Promise로 돌아온다. 이 Promise가 끝났다고 서비스 워커가 페이지를 맡은 것은 아니며, 아래 "`register()`가 끝난 시점과 페이지를 맡는 시점"에서 다룬다.

### 개념 | `register()`가 끝난 시점과 페이지를 맡는 시점

`register()`는 "이 파일을 서비스 워커로 쓰겠다"는 등록만 마치고 돌아온다. 그 시점에 새 서비스 워커는 아직 설치 중이다.

0장 개념 2의 생명주기(설치 → 대기 → 활성화)는 그 뒤에 비동기로 흘러가고, 이 페이지를 맡는 것은 다시 그 뒤의 일이다.

```js
const reg = await navigator.serviceWorker.register("/sw.js?api=...");
reg.installing; // ServiceWorker: 아직 설치 중이다
reg.active; // null
navigator.serviceWorker.controller; // null

const ready = await navigator.serviceWorker.ready; // 활성 버전이 생길 때까지 기다린다
ready.active.state; // 'activating'
navigator.serviceWorker.controller; // null: clients.claim()이 아직 이 탭에 닿기 전이다

// 잠시 뒤. activate의 clients.claim()이 이 탭을 넘겨받으면서 controllerchange 이벤트가 일어난다
navigator.serviceWorker.controller.state; // 'activated'
```

이 프로젝트의 `sw.js`는 2단계에서 `activate`에 `clients.claim()`을 넣으므로, 첫 방문 페이지도 활성화 직후 `controller`가 생긴다.

`clients.claim()`을 부르지 않는 서비스 워커라면(지금의 빈 `sw.js`가 그렇다) `controller`는 `null`로 남고, 새로고침해야 생긴다.

| 확인하는 것 | 참이 되는 때 |
|---|---|
| `register()`의 Promise가 끝남 | 등록 정보가 만들어졌을 때. 설치는 아직이다 |
| `navigator.serviceWorker.ready`가 끝남 | 이 페이지 범위에 활성화된 서비스 워커가 생겼을 때 |
| `navigator.serviceWorker.controller`가 `null`이 아님 | 이 페이지의 요청을 실제로 그 서비스 워커가 가로챌 때 |

- 오프라인 동작을 확인하려면 마지막 것(`controller`)을 봐야 한다. 6단계 테스트의 `waitForController`가 `ready`를 기다린 뒤 새로고침하고 `controller`까지 확인하는 이유다.

- 서비스 워커는 페이지를 맡은 뒤에 오간 요청만 볼 수 있다. 그래서 등록하던 페이지의 HTML과 JS는 캐시에 없다(아래 "첫 방문 페이지의 처음 요청은 캐시에 없다.").

> `register()`의 완료는 "신청 접수"일 뿐이다. 오프라인에서 페이지를 지켜 주는 것은 `controller`가 생긴 뒤부터다.

### 개념 | 첫 방문 페이지의 처음 요청은 캐시에 없다.

`/shop`을 처음 연 페이지에서 시점별로 찍으면 이렇다(2단계의 `sw.js`를 채운 뒤).

```js
// register()를 부르기 전과 직후
navigator.serviceWorker.controller // null
// 활성화되고 clients.claim()이 이 탭을 넘겨받은 뒤(controllerchange)
navigator.serviceWorker.controller // ServiceWorker {scriptURL: 'http://localhost:3000/sw.js?api=...', state: 'activated'}
```

처음 연 페이지의 HTML과 스크립트는 서비스 워커가 등록되기 전에 이미 받아졌다. 그 요청은 서비스 워커를 거치지 않았으니 캐시에도 들어 있지 않다.

2단계의 `clients.claim()` 덕분에 이 탭도 활성화 시점부터 서비스 워커가 맡는다. 하지만 맡는 것은 그 뒤에 나가는 요청뿐이다.

`clients.claim()`이 없다면 다음에 연 페이지(새로고침 포함)부터 맡는다.

> 그래서 이 문서의 확인과 테스트는 항상 한 번 새로고침한 뒤에 시작한다.

### 남길 것

- **찾아보면 되는 것**: `next.config.ts`의 `headers()` 모양, `Cache-Control` 값(`no-store`, `no-cache`, `must-revalidate`)의 뜻, `register()`의 반환값, CSP 지시어의 대체 순서(`worker-src` → `child-src` → `script-src`). 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 서비스 워커는 자기 파일이 있는 경로 아래만 맡는다. 사이트 전체를 맡기려면 `/sw.js`처럼 루트에 둔다.

  - `register()`가 끝난 것과 이 페이지를 맡은 것(`controller`)은 다르다. 맡기 전에 오간 요청은 캐시에 없다.

  - `public/`의 파일은 빌드를 거치지 않는다. 환경변수 같은 값은 등록할 때 쿼리로 넘기고, `sw.js`의 문법 오류도 빌드가 잡아 주지 않는다.

- **에러 신호**:

  - 콘솔에 `서비스 워커 등록 실패: TypeError: Failed to register a ServiceWorker ... A bad HTTP response code (404)` → `public/sw.js`가 있는지

  - 빌드에서 ``Route segment config "instant" requires `nextConfig.cacheComponents` to be enabled.``나 `Unknown at rule: @theme` → `next.config.ts`를 통째로 바꿔 기존 설정(`cacheComponents`, `turbopack`의 CSS 로더)이 지워졌는지

  - 개발 서버에서 아무 일도 안 일어난다 → 운영 빌드(`npm run build && npm run start`)로 띄웠는지

  - `navigator.serviceWorker`가 `undefined` → HTTPS나 `localhost`가 아닌 주소로 열었는지

  - 등록은 됐는데 `controller`가 `null` → `clients.claim()`이 이 탭에 닿았는지(`controllerchange`), 없다면 새로고침

## 3. 2단계: 무엇을 어떻게 캐시하나

### 개념 | 요청마다 다른 캐시 전략

요청마다 성격이 다르므로 전략도 다르게 쓴다.

| 요청 | 예 | 전략 | 이유 |
|---|---|---|---|
| 빌드 결과물 | `/_next/static/chunks/abc123.js` | 캐시 먼저(cache-first) | 파일 이름에 내용의 해시가 있다. 이름이 같으면 내용도 영원히 같다 |
| 페이지 이동 | `/shop` | 네트워크 먼저(network-first) | 최신 화면이 우선이고, 끊겼을 때만 마지막으로 본 화면 |
| 공개 API | `GET localhost:4000/products` | 네트워크 먼저 | 재고는 계속 바뀐다. 끊겼을 때만 마지막 목록 |
| 로그인이 필요한 API | `GET /me/orders` | 손대지 않는다 | 4단계 |
| 쓰기 요청 | `POST /orders/checkout` | 손대지 않는다 | 응답을 저장해 봐야 의미가 없고, 다시 보내면 주문이 또 생길 수 있다 |

### 작업 1. [커밋] `sw.js` 채우기

1단계에서 만든 빈 `public/sw.js`를 다음으로 채운다.

```js
// public/sw.js
// 서비스 워커: 브라우저와 네트워크 사이에서 요청을 가로채, 네트워크가 없을 때 저장해 둔 응답을 돌려준다
// 이 파일이 바뀌면(VERSION 등) 브라우저가 새 서비스 워커로 알아채고 다시 설치한다
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`; // 빌드 결과물(JS, CSS) - 파일 이름에 해시가 있어 내용이 바뀌면 이름도 바뀐다
const PAGE_CACHE = `pages-${VERSION}`;    // 마지막으로 본 페이지 HTML
const API_CACHE = `api-${VERSION}`;       // 공개 API 응답(상품 목록 등)
const CURRENT = [STATIC_CACHE, PAGE_CACHE, API_CACHE];

// 등록할 때 넘긴 API 주소(/sw.js?api=...) - 서비스 워커는 환경변수를 못 읽는다
const API_ORIGIN = new URL(self.location.href).searchParams.get("api");

self.addEventListener("install", () => {
  // 기다리지 않고 바로 활성화한다(5단계)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 이전 버전의 캐시를 지운다
    for (const name of await caches.keys()) if (!CURRENT.includes(name)) await caches.delete(name);
    // 이미 열려 있는 페이지도 지금부터 이 서비스 워커가 맡는다
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 결제 같은 쓰기 요청은 손대지 않는다(그냥 네트워크로)
  const url = new URL(req.url);

  // ① 빌드 결과물: 캐시에 있으면 그걸 쓴다(cache-first) - 해시가 붙은 파일은 내용이 절대 바뀌지 않는다
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, req));
    return;
  }
  // ② 페이지 이동: 네트워크 먼저, 실패하면 마지막으로 본 페이지(network-first)
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(PAGE_CACHE, req));
    return;
  }
  // ③ 공개 API: 네트워크 먼저, 실패하면 마지막 응답. 로그인이 필요한 요청(Authorization 헤더)은 절대 저장하지 않는다(4단계)
  if (API_ORIGIN && url.origin === API_ORIGIN && !req.headers.has("authorization")) {
    event.respondWith(networkFirst(API_CACHE, req));
  }
});

async function cacheFirst(cacheName, req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirst(cacheName, req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone()); // 응답 본문은 한 번만 읽을 수 있어서 복사본을 저장한다
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response("오프라인, 저장된 응답이 없습니다", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
```

`fetch` 함수는 위에서부터 조건을 보고 처음 맞는 하나만 처리한다.

①·②에 `return`이 있는 이유다. 셋 다 안 맞으면 `respondWith`를 부르지 않고 끝난다.

`public/sw.js`는 빌드를 거치지 않으므로(1단계 "`sw.js`에는 환경변수가 들어가지 않는다") 문법 오류가 있어도 `npm run build`는 성공한다. 브라우저가 이 파일을 실행하다 멈추고 등록이 실패할 뿐이다. 고친 뒤에는 문법만이라도 확인해 둔다.

```sh
node --check public/sw.js # 아무것도 안 나오면 통과
```

### 용어 | Service Worker API (가로채기·캐시)

`event.respondWith`를 부르지 않을 때와 `res.clone()`은 아래 "짚어 둘 것"에서 다룬다.

- `self`: 서비스 워커 파일 안에서 서비스 워커 자신을 가리킨다. 페이지의 `window`에 해당한다.

- `self.addEventListener("install" | "activate" | "fetch", 함수)`: 생명주기의 각 단계와 요청 가로채기에 함수를 건다.

- `self.skipWaiting()`: 대기 단계를 건너뛰고 바로 활성화한다(5단계).

- `event.respondWith(Promise)`: 이 요청의 응답을 서비스 워커가 정한다. Promise가 내놓는 `Response`가 페이지에 돌아간다. 언제 불러야 하는지는 아래 "`respondWith`와 `waitUntil`: 이벤트 함수가 돌아간 뒤의 일"에서 다룬다.

- `event.waitUntil(Promise)`: 그 Promise가 끝날 때까지 이 단계(여기서는 활성화)를 끝내지 말라고 브라우저에 알린다. 위와 같은 블록에서 다룬다.

- `self.clients.claim()`: 이미 열려 있는 페이지도 지금부터 이 서비스 워커가 맡는다.

- `req.mode === "navigate"`: 페이지 자체를 여는 요청이다. 아래 "`req.mode`: 요청이 어떤 경로로 만들어졌나"에서 다룬다.

- `caches.keys()` / `caches.open(이름)` / `caches.delete(이름)`: Cache Storage의 캐시 이름 목록을 얻고, 캐시를 열고, 지운다.

- `caches.match(req)`: 모든 캐시에서 이 요청에 저장된 응답을 찾는다. 없으면 `undefined`다. 아래 "Cache Storage: `caches`와 `cache`"에서 다룬다.

- `cache.put(req, res)`: 이 요청을 키로 응답을 저장한다. 위와 같은 블록에서 다룬다.

### 개념 | `respondWith`와 `waitUntil`: 이벤트 함수가 돌아간 뒤의 일

`addEventListener`에 건 함수가 `return`하면 브라우저는 그 이벤트가 끝났다고 본다.

그런데 캐시를 열고 네트워크에 묻는 일은 전부 비동기라서 함수가 돌아간 뒤에야 끝난다. 두 메서드는 "아직 끝나지 않았으니 이 Promise를 기다려라"를 브라우저에 알리는 방법이다.

- `respondWith`: `fetch` 이벤트에서 쓴다. 넘긴 Promise가 내놓는 `Response`가 이 요청의 응답이 된다.

- `waitUntil`: `install`, `activate`에서 쓴다. Promise가 끝날 때까지 그 단계를 끝내지 않는다. `activate`가 끝나야 `fetch` 이벤트가 들어오므로, 옛 캐시를 지우는 도중에 요청을 받는 일은 없다.

#### 흔한 실수: 기다린 뒤에 `respondWith` 부르기

브라우저는 함수가 돌아가는 순간 "이 요청을 서비스 워커가 맡았나"를 정한다. 그때까지 `respondWith`를 부르지 않았으면 요청을 이미 네트워크로 보낸다.

0장 개념 1의 `LD_PRELOAD` 비유로는, 가로챈 함수가 진짜 `connect()`로 넘겨 준 뒤에는 결과를 바꿀 수 없는 것과 같다.

```js
// 잘못: 캐시 조회를 기다린 뒤에 부르면 늦다
self.addEventListener("fetch", async (event) => {
  const cached = await caches.match(event.request);
  event.respondWith(cached ?? fetch(event.request));
  // InvalidStateError: Failed to execute 'respondWith' on 'FetchEvent': The event handler is already finished.
});

// 맞음: respondWith는 바로 부르고, 기다리는 일은 넘기는 Promise 안에 넣는다
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    return cached ?? fetch(event.request);
  })());
});
```

- 늦게 부른 `respondWith`는 예외를 던지고, 그 요청은 이미 서비스 워커 없이 네트워크로 간 뒤다. 오프라인이면 그대로 실패한다.

- 이 문서의 `fetch` 함수에 `async`가 없고 `respondWith(cacheFirst(...))`처럼 Promise를 바로 넘기는 이유다. `cacheFirst`, `networkFirst`가 `async` 함수라 부르는 즉시 Promise를 돌려준다.

> `respondWith`는 "이 요청은 내가 맡는다"는 선언이라 함수가 돌아가기 전에 해야 하고, 응답 내용은 나중에 채워도 된다.

### 개념 | `req.mode`: 요청이 어떤 경로로 만들어졌나

서비스 워커는 맡은 페이지의 요청을 전부 받는다. 주소창 입력, `<script>` 태그, 페이지 JS의 `fetch()`가 모두 같은 `fetch` 이벤트로 들어온다.

`req.mode`는 그 요청이 어떤 경로로 만들어졌는지 알려 준다.

| `req.mode` | 이런 요청 |
|---|---|
| `navigate` | 주소창 입력, 링크 클릭, 새로고침처럼 페이지(HTML) 자체를 여는 요청 |
| `cors` | 페이지 JS의 `fetch()`(기본값). 다른 출처면 CORS 규칙을 따른다 |
| `no-cors` | `crossorigin` 속성이 없는 `<img>`, `<script>` 등 |
| `same-origin` | `fetch(url, { mode: "same-origin" })`처럼 같은 출처만 허용한 요청 |

```js
// fetch 이벤트에서 url.pathname과 req.mode를 찍어 본 결과
// 주소창으로 페이지 열기 → "navigate"
// 그 페이지 JS의 fetch("/x") → "cors"
```

- ② 조건이 URL이 아니라 `mode`를 보는 이유: 페이지 주소는 `/shop`, `/me/orders`처럼 계속 늘어나지만 "페이지를 연다"는 성격은 `mode` 하나로 가를 수 있다.

- Next의 `<Link>`로 화면을 옮기면 HTML을 새로 받지 않고 JS가 `fetch`로 화면 데이터를 받는다. 그 요청은 `navigate`가 아니라 ②에 걸리지 않는다. 도전 과제 2에서 `<a>`를 쓴 이유다.

- 서비스 워커가 다시 `fetch(req)`할 때 이 모드가 그대로 유지된다는 이야기는 아래 "짚어 둘 것"의 "API 응답의 CORS"에 있다.

> `navigate` 요청이 실패하면 화면 전체가 "인터넷 연결 없음"이 된다. 그래서 페이지 캐시는 이 요청에만 건다.

### 개념 | Cache Storage: `caches`와 `cache`

0장 개념 1에서 Cache Storage를 요청(URL)을 키로 하는 키-값 저장소라고 했다. 정확히는 두 층이다.

전역 `caches`는 이름 붙은 캐시들의 목록이고, `caches.open(이름)`으로 연 `cache` 하나하나가 요청→응답 저장소다.

디렉터리(`caches`) 안에 파일(`pages-v1` 같은 캐시)이 여러 개 있다고 보면 된다.

```js
const api = await caches.open("api-v1"); // 없으면 새로 만든다
await api.put("/products", new Response("list"));

await caches.match("/products"); // 찾는다: 모든 캐시를 뒤진다
await (await caches.open("pages-v1")).match("/products"); // undefined: 그 캐시 안에서만 찾는다
await caches.match("/products?page=2"); // undefined: 쿼리 문자열도 키의 일부다
await caches.match("/products?page=2", { ignoreSearch: true }); // 찾는다

await api.put(new Request("/orders", { method: "POST" }), new Response("x"));
// TypeError: Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported
```

| 구분 | `caches.match(req)` | `cache.match(req)` / `cache.put(req, res)` |
|---|---|---|
| 대상 | 모든 캐시 | 연 캐시 하나 |
| 이 문서에서 | 꺼낼 때(`cacheFirst`, `networkFirst`) | 넣을 때(`put`) |

- 꺼낼 때는 어느 캐시에 있든 상관없으니 `caches.match`를 쓰고, 넣을 때는 넣을 곳을 정해야 하니 이름으로 연 캐시에 `put`한다.

- `put`은 GET 요청만 받는다. `fetch` 함수 첫 줄에서 GET이 아니면 손대지 않는 것과 맞물린다.

- 버전 교체(5단계)는 캐시 이름 단위로 한다. `activate`에서 `CURRENT`에 없는 이름을 통째로 `caches.delete`한다.

> 쿼리 문자열이 다르면 다른 칸이다. `/products?page=2`를 오프라인에서 보려면 온라인에서 그 주소를 한 번 받아 둬야 한다.

### 개념 | 짚어 둘 것

#### `event.respondWith`를 부르지 않으면

그 요청은 서비스 워커가 없을 때처럼 네트워크로 간다. ③의 조건에 안 맞는 요청이 그렇다.

#### `res.clone()`

응답 본문은 스트림이라 한 번 읽으면 끝이다. 페이지에 돌려줄 것과 캐시에 넣을 것, 두 벌이 필요하다.

#### `res.ok`일 때만 저장

500 에러 페이지를 저장하면 오프라인에서 그 에러를 계속 보게 된다.

#### `fetch`가 실패하는 경우

오프라인이거나 서버에 연결이 안 될 때 `fetch`는 예외를 던진다. 서버가 500을 돌려준 것은 실패가 아니라 응답이다.

그래서 `catch`는 "네트워크가 없을 때"만 탄다.

#### CSP와 캐시된 페이지

`08`의 nonce는 요청마다 바뀐다. 캐시된 HTML에는 옛 nonce가 들어 있다.

그래도 문제없는 이유는 Cache Storage가 응답 헤더까지 통째로 저장하기 때문이다. 캐시에서 나온 HTML과 함께 그때의 CSP 헤더(같은 옛 nonce)가 나온다.

#### API 응답의 CORS

API는 다른 출처(`localhost:4000`)다. 서비스 워커가 다시 `fetch(req)`를 해도 원래 요청의 모드(CORS)가 그대로 유지된다.

그래서 백엔드가 이미 CORS를 허락했다면 따로 할 일이 없다.

### 작업 2. [확인] 캐시 들여다보기

다시 빌드하고 띄운다. 브라우저에서 `/shop`을 연 뒤 한 번 새로고침한다.

```sh
npm run build && npm run start
```

개발자 도구 콘솔에서 캐시를 들여다본다.

```js
Object.fromEntries(await Promise.all((await caches.keys()).map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)])))
// {
//   "pages-v1": ["/shop"],
//   "static-v1": ["/_next/static/chunks/...js", "/_next/static/chunks/...css", ...],
//   "api-v1": ["/products"]
// }
```

`/shop`을 연 탭에서 Console 탭을 열고(`Cmd + Option + J`), 위 한 줄을 붙여 넣고 Enter를 누른다. 콘솔은 맨 바깥에서도 `await`를 쓸 수 있어서 함수로 감쌀 필요가 없다.

처음 붙여 넣을 때 Chrome이 "Don't paste code..." 경고와 함께 `allow pasting`을 입력하라고 하면, 그대로 입력한 뒤 다시 붙여 넣는다. 모르는 코드를 붙여 넣는 사고를 막는 장치다.

한 줄이 하는 일을 안쪽부터 풀면 이렇다.

- `caches.keys()`: 캐시 이름 목록(`pages-v1`, `static-v1`, `api-v1`)

- `caches.open(k)`로 캐시마다 열고, `.keys()`로 그 안에 저장된 요청들을 얻는다

- `new URL(r.url).pathname`: 요청의 전체 주소에서 경로만 남긴다

- `Object.fromEntries`: `{ 캐시 이름: [경로들] }` 객체로 모은다

`caches`는 서비스 워커 안이 아닌 페이지 콘솔에서도 쓸 수 있다. 같은 출처면 서비스 워커와 페이지가 같은 Cache Storage를 본다.

개발자 도구의 Application 탭 → Cache storage에서도 같은 내용이 보인다. 왼쪽 목록의 Storage 아래 Cache storage를 펼쳐 캐시 이름을 누르면, 오른쪽 표에 저장된 URL이 나오고 행을 누르면 저장된 응답이 보인다.

목록이 위보다 길 수 있다. 여러 페이지를 열어 봤다면 `pages-v1`에 그 페이지들이 다 들어가는데, network-first가 연 페이지마다 저장하니 정상이다.

하지만 이 프로젝트에 없는 경로(다른 프로젝트의 페이지·API)나 `hmr-client`, `react-dom_development` 같은 이름의 청크가 보이면 사정이 다르다.

서비스 워커는 프로젝트가 아니라 주소(출처: `http://localhost:3000`)에 등록된다. 한 번 등록되면, 같은 주소에 `next dev`나 다른 프로젝트를 띄워도 등록을 지우기 전까지 계속 요청을 가로채고 캐시에 넣는다. `hmr-client`는 개발 서버만 내보내는 파일이다.

"운영 빌드에서만 켠다"는 등록을 안 할 뿐, 이미 등록된 서비스 워커를 끄지는 않는다.

> Application 탭 → Storage → Clear site data로 서비스 워커와 캐시를 함께 지우고, 운영 빌드로 다시 띄워 `/shop`을 열고 한 번 새로고침하면 위 결과와 같아진다. 같은 포트에 개발 서버나 다른 프로젝트를 띄우기 전에도 이렇게 지우거나, Service workers의 Bypass for network를 켠다.

> 결과 줄(`{pages-v1: Array(7), ...}`)을 다시 콘솔에 붙여 넣으면 ``Uncaught SyntaxError: Unexpected token ':'``가 난다. 코드가 아니라 출력이라서이고, 앞의 명령은 이미 제대로 돌았다.

### 남길 것

- **찾아보면 되는 것**: `caches`·`cache`의 메서드 이름, `req.mode`의 값 목록, `ignoreSearch` 같은 옵션. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 이름에 해시가 붙은 빌드 파일은 cache-first, 계속 바뀌는 페이지와 API는 network-first다. 쓰기 요청과 로그인 요청은 손대지 않는다.

  - `respondWith`는 이벤트 함수가 돌아가기 전에 불러야 한다. 기다리는 일은 넘기는 Promise 안에 넣는다.

  - 캐시의 키는 URL(쿼리 포함)이다. 온라인에서 한 번 받아 둔 주소만 오프라인에서 나온다.

- **에러 신호**:

  - 콘솔에 `서비스 워커 등록 실패: TypeError: Failed to register a ServiceWorker ... ServiceWorker script evaluation failed` → `sw.js`에 문법 오류가 있는지(`node --check public/sw.js`). 빌드는 이 파일을 검사하지 않는다

  - `InvalidStateError: Failed to execute 'respondWith' on 'FetchEvent': The event handler is already finished.` → `respondWith` 앞에 `await`가 있는지

  - `TypeError: Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported` → GET이 아닌 요청을 캐시에 넣으려 했는지

  - 콘솔의 캐시 목록에 `api-v1`이 없다 → `sw.js?api=` 쿼리가 비었는지(`NEXT_PUBLIC_API_URL`), 등록 직후 새로고침했는지

  - 캐시 목록에 이 프로젝트에 없는 경로나 `hmr-client`·`react-dom_development` 청크가 있다 → 같은 주소(`localhost:3000`)에 `next dev`나 다른 프로젝트를 띄울 때 서비스 워커가 등록된 채였는지(Clear site data)

## 4. 3단계: 오프라인 화면

네트워크가 끊겼다는 것을 화면에 알리고, 서버가 꼭 있어야 하는 결제를 막는다.

브라우저는 `navigator.onLine` 값과 `online`/`offline` 이벤트를 준다. `05`의 Zustand가 쓰던 `useSyncExternalStore`로 구독한다.

### 작업 1. [커밋] 온라인 상태 훅과 배너 만들기

```tsx
// app/online-banner.tsx
"use client";

import { useSyncExternalStore } from "react";

// 브라우저의 온라인/오프라인 상태를 구독한다(Zustand처럼 useSyncExternalStore로 "서버용 값"을 따로 준다)
const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function OnlineBanner() {
  const online = useOnline();
  if (online) return null;
  return <p role="status" data-testid="offline-banner">오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다</p>;
}
```

### 개념 | `useSyncExternalStore`: React 밖의 값을 구독하는 세 인자

`navigator.onLine`은 React의 state가 아니다. 브라우저가 들고 있는 바깥 값이라, 바뀌어도 React는 다시 그려야 하는지 모른다.

`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`는 그 바깥 값을 React에 잇는 다리다.

| 인자 | 이 코드에서 | 하는 일 |
|---|---|---|
| `subscribe(cb)` | `online`·`offline` 이벤트에 `cb`를 건다 | 값이 바뀔 수 있을 때 React를 깨운다. 해제 함수를 돌려준다 |
| `getSnapshot()` | `() => navigator.onLine` | 지금 값을 읽는다. React가 이전 값과 비교해 다르면 다시 그린다 |
| `getServerSnapshot()` | `() => true` | 서버에서 렌더링할 때, 그리고 하이드레이션할 때 쓰는 값 |

C로 치면 `subscribe`는 콜백 등록 함수, `getSnapshot`은 현재 값을 읽는 getter다. React는 콜백이 불릴 때마다 getter를 다시 읽는다.

세 번째 인자 `() => true`는 서버에서 렌더링할 때 쓰는 값이다. 서버에는 `navigator`가 없으니 "온라인"으로 그려 두고, 브라우저에서 실제 값으로 바뀐다.

서버 HTML과 첫 브라우저 렌더링이 같아서 `05`에서 본 하이드레이션 불일치가 생기지 않는다.

세 번째 인자를 빼면 서버 렌더링 중에 `Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.` 에러가 난다.

> 이 훅은 `OnlineBanner`와 결제 버튼 두 곳에서 쓴다. 각자 이벤트를 따로 걸 필요 없이 같은 `subscribe`를 공유한다.

### 작업 2. [커밋] 레이아웃에 배너 붙이기

1단계에서 `<SwRegister />`를 넣은 `app/layout.tsx`에 배너도 붙인다.

```tsx
// app/layout.tsx
// import 한 줄과 <OnlineBanner />만 추가한다
import { SwRegister } from "./sw-register";
import { OnlineBanner } from "./online-banner";
// ... 기존 import 그대로 ...

        <Providers>
          <Nav />
          <SwRegister />
          <OnlineBanner />
          {children}
        </Providers>
```

레이아웃에 두었으니 어느 페이지에서든 오프라인이면 내비게이션 바로 아래에 배너가 뜬다.

### 작업 3. [커밋] 오프라인이면 결제 막기

```tsx
// app/shop/page.tsx
// import 한 줄을 추가하고, CartPanel 안에서 online을 읽어 결제 버튼의 disabled에 더한다
import { useOnline } from "../online-banner";
// ... 기존 import 그대로 ...

function CartPanel() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const online = useOnline(); // 오프라인이면 결제를 막는다 - 결제 요청은 서비스 워커가 저장해 둘 수 없다
  const queryClient = useQueryClient();
  // ... checkout(useMutation)과 장바구니 목록은 그대로 ...
      <button disabled={items.length === 0 || checkout.isPending || !online} onClick={() => checkout.mutate()}>
```

`navigator.onLine`이 `true`여도 실제로는 서버에 닿지 못할 수 있다(와이파이는 연결됐는데 인터넷이 없는 경우). 그래서 이 값은 화면 안내용으로만 쓴다.

> 결제 요청이 실패했을 때의 처리(`05`의 `Idempotency-Key`와 다시 시도)는 그대로 둔다.

### 작업 4. [확인] 오프라인으로 새로고침해 확인

다시 빌드하고 띄운 뒤 `/shop`을 열고 한 번 새로고침한다.

```sh
npm run build && npm run start
```

개발자 도구 Network 탭의 "Offline"(또는 Application 탭 → Service workers의 "Offline")을 켜고 새로고침한다.

```text
/shop 새로고침
→ 상품 목록(한정판 키보드, 마우스 ...)이 그대로 보인다  # 페이지는 pages-v1, 목록은 api-v1에서
→ "오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다"
→ 마우스를 담아도 결제 버튼이 비활성

주소창에 아직 한 번도 안 연 페이지(예: /me/orders)를 입력
→ 오프라인, 저장된 응답이 없습니다  # networkFirst의 마지막 줄(503)
```

서비스 워커가 없을 때(Application 탭에서 Unregister한 뒤)는 같은 새로고침에서 브라우저의 "인터넷 연결 없음" 화면이 뜬다.

### 남길 것

- **찾아보면 되는 것**: `useSyncExternalStore`의 인자 순서, `online`/`offline` 이벤트 이름, 개발자 도구의 Offline 체크 위치. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 서비스 워커가 화면을 살려도, 서버가 꼭 있어야 하는 쓰기(결제)는 화면에서 막는다. 캐시로 흉내 낼 수 없다.

  - `navigator.onLine`은 "네트워크 장치가 붙어 있다"일 뿐이라 안내용이다. 실제 실패는 요청의 에러로 처리한다.

- **에러 신호**:

  - `Missing getServerSnapshot, which is required for server-rendered content.` → `useSyncExternalStore`의 세 번째 인자

  - 오프라인에서 "오프라인, 저장된 응답이 없습니다" → 그 URL을 온라인에서 본 적이 없다. 정상 동작이다

  - 오프라인에서 페이지는 뜨는데 화면이 깨진다 → 그 페이지가 쓰는 JS/CSS가 `static-*` 캐시에 있는지, 온라인에서 그 페이지를 끝까지 본 적이 있는지

## 5. 4단계: 일부러 깨뜨려보기, 로그인 응답을 캐시하면

### 실험 | 로그인 응답까지 캐시해 본다

③의 조건에서 `!req.headers.has("authorization")`를 빼 본다. "API는 전부 캐시해 두면 오프라인에서 내 주문도 보이니 좋지 않나"라는 생각이다.

```js
// public/sw.js
// ③의 조건만 이렇게 바꾼다
  // 깨뜨려보기: 로그인이 필요한 응답도 저장한다
  if (API_ORIGIN && url.origin === API_ORIGIN) {
    event.respondWith(networkFirst(API_CACHE, req));
  }
```

이렇게 바꾼 파일은 `practice/break-auth-cache/order-console-next/public/sw.js`에 있다.

#### 무슨 일이 생기나

0장에서 본 대로 Cache Storage의 키는 URL이다. `Authorization` 헤더는 키에 들어가지 않는다.

그래서 이런 일이 생긴다(공용 PC에서 사용자가 바뀐 상황).

1. kim이 로그인해서 "내 주문"을 연다 → `GET /me/orders`의 응답(kim의 주문)이 `api-v1`에 저장된다

2. 같은 브라우저에서 lee가 로그인한다

3. 네트워크가 끊긴 상태에서 lee의 토큰으로 `GET /me/orders`를 요청한다

#### 콘솔에서 재현

빌드하고 다시 띄운 뒤, 개발자 도구 콘솔에서 재현한다(1을 마친 상태에서).

```js
// 2. lee의 토큰을 받는다
const lee = (await (await fetch("http://localhost:4000/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "lee", password: "1234" }), credentials: "include" })).json()).accessToken;
// 3. Network 탭에서 Offline을 켜고
const res = await fetch("http://localhost:4000/me/orders", { headers: { Authorization: `Bearer ${lee}` } });
res.status, await res.text()
// 200  '[{"id":1,"price":12000,"paid":true,...},{"id":3,"price":5000,"paid":true,...}]'
```

lee의 토큰으로 요청했는데 kim의 주문(#1, #3)이 나온다. 서버는 이 요청을 받지도 않았다.

#### 무엇을 건너뛰었나

`03`에서 IDOR를 막았고 `10`에서 DB까지 막았지만, 브라우저 안의 캐시가 그 모든 검사를 건너뛰었다.

토큰이 만료됐거나 로그아웃한 뒤여도 마찬가지다. 서비스 워커는 토큰이 유효한지 모른다.

`10`의 6단계(연결에 남은 설정이 다음 요청으로 샌 것)와 같은 모양의 버그다.

**누구의 데이터인지가 키에 없는 공유 저장소에 사용자별 데이터를 넣은 것이다.**

### 작업 1. [원복] 고치기

원래 조건으로 되돌린다. `Authorization` 헤더가 붙은 요청은 `respondWith`를 부르지 않으므로 서비스 워커가 없는 것처럼 네트워크로 간다.

```js
// public/sw.js
// ③의 조건을 원래대로
  if (API_ORIGIN && url.origin === API_ORIGIN && !req.headers.has("authorization")) {
```

다시 빌드하고 띄운다.

앞 실험에서 `api-v1`에 들어간 `/me/orders` 항목은 남아 있지만, 고친 조건에서는 그 요청에 `respondWith`를 부르지 않으니 꺼내 쓰이지 않는다. 남은 항목까지 지우려면 Application 탭 → Storage → Clear site data를 누른다.

같은 재현을 하면 이제 3에서 `TypeError: Failed to fetch`가 난다. 오프라인이니 실패하는 것이 맞다.

화면의 "내 주문"도 오프라인에서는 "불러오지 못했다: Failed to fetch"로 나온다.

### 개념 | 이 조건으로 충분한 이유와 한계

#### 헤더 유무로 가를 수 있는 이유

이 앱의 로그인 요청은 전부 `authFetch`를 거쳐 `Authorization` 헤더를 붙인다(`05`). 헤더 유무로 "로그인 응답인가"를 가를 수 있다.

#### 쿠키로 인증하는 API라면 이 조건은 통하지 않는다

쿠키는 브라우저가 붙이므로 서비스 워커가 보는 요청에서 구분되지 않는다. 그럴 때는 캐시할 URL을 허용 목록(예: `/products`만)으로 정하는 편이 안전하다.

> 이 문서의 조건은 "헤더가 없으면 캐시"라는 거부 목록이라, 새 API를 만들 때 실수할 여지가 남는다.

#### 페이지 캐시(②)도 같은 질문을 받는다

지금 페이지 HTML에는 사용자 데이터가 없다. 데이터는 화면이 뜬 뒤 `authFetch`로 받는다.

서버 컴포넌트가 사용자 데이터를 HTML에 넣는 구조라면 페이지 캐시도 같은 방식으로 샌다.

#### 로그아웃할 때 캐시를 비우면 되지 않나

로그아웃할 때 `caches.delete()`로 캐시를 비우는 방법도 있다.

하지만 "로그아웃을 안 하고 탭을 닫은 경우"가 남으므로 처음부터 저장하지 않는 것이 기본이다.

### 남길 것

- **찾아보면 되는 것**: `req.headers.has()`, Clear site data 버튼 위치. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 키에 "누구의 것인지"가 없는 공유 저장소(Cache Storage, 커넥션의 세션 설정)에 사용자별 데이터를 넣으면 다른 사용자에게 샌다. 서버의 인가 검사도 건너뛴다.

  - 캐시할 것을 고를 때는 거부 목록보다 허용 목록이 안전하다. 실수하면 "안 보인다"로 틀릴 뿐 새지 않는다.

- **에러 신호**:

  - 다른 사용자의 데이터가 보인다(오프라인에서 lee의 토큰에 kim의 주문, `200`) → Cache storage에 `/me/...`가 있는지, ③의 조건

## 6. 5단계: 새 버전 배포

### 개념 | 브라우저는 언제 새 버전을 알아채나

브라우저는 페이지를 열 때(그리고 주기적으로) `/sw.js`를 다시 받아서 한 바이트라도 다르면 새 버전으로 보고 설치한다.

그래서 캐시 이름에 쓰는 `VERSION`을 바꾸는 것만으로 새 버전이 된다.

1단계에서 `/sw.js`에 `Cache-Control: no-cache`를 단 이유가 여기 있다.

브라우저는 서비스 워커 파일을 확인할 때 기본적으로 HTTP 캐시를 건너뛰지만, 서버나 중간 CDN이 이 파일을 오래 캐시하면 새 버전이 늦게 퍼진다.

> 이 파일만은 항상 새로 받게 해 둔다.

### 실험 | 새 버전이 기다리기만 한다.

`install`의 `self.skipWaiting()`을 주석 처리하고, `VERSION`을 `"v2"`로 바꾼 뒤 빌드·재시작한다.

```js
// public/sw.js
// 두 곳만 바꾼다
const VERSION = "v2";
// ...
self.addEventListener("install", () => {
  // self.skipWaiting();
});
```

v1으로 띄워 `/shop`을 열어 둔 탭에서 확인한다.

```js
const s = async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: !!r.active, waiting: !!r.waiting, caches: (await caches.keys()).join(",") }; };
await (await navigator.serviceWorker.getRegistration()).update(); // 새 파일 확인을 지금 시킨다
await s()
// {active: true, waiting: true, caches: 'pages-v1,static-v1,api-v1'}
```

새 버전은 설치됐지만 대기(waiting) 중이다. 캐시도 여전히 v1이다.

새로고침해도 그대로다.

```js
// 새로고침 후
await s()
// {active: true, waiting: true, caches: 'pages-v1,static-v1,api-v1'}
```

새로고침하는 동안에도 옛 서비스 워커가 그 탭을 맡고 있기 때문이다. 이 사이트의 탭을 모두 닫고 다시 열어야 바뀐다.

```js
// 탭을 모두 닫고 /shop을 새로 연 뒤
// {waiting: false, caches: 'pages-v2,static-v2,api-v2'}
```

이제 `activate`가 돌아 옛 캐시(`*-v1`)가 지워졌다.

> 사용자는 보통 탭을 오래 열어 두므로, 이대로면 버그를 고쳐 배포해도 사용자에게 한참 동안 닿지 않는다.

### 용어 | Service Worker API (등록 정보)

- `navigator.serviceWorker.getRegistration()`: 이 페이지에 걸린 등록 정보를 얻는다. `active`는 지금 맡고 있는 버전, `waiting`은 대기 중인 새 버전이다. 아래 "등록 하나에 세 칸: `installing`, `waiting`, `active`"에서 다룬다.

- `registration.update()`: 브라우저가 주기적으로 하는 새 파일 확인을 지금 시킨다.

### 개념 | 등록 하나에 세 칸: `installing`, `waiting`, `active`

`getRegistration()`이 돌려주는 등록 정보(registration)는 서비스 워커 파일 하나가 아니라, 한 범위(여기서는 `/`)에 걸린 버전들을 담는 자리다.

0장 개념 2 생명주기의 단계마다 칸이 하나씩 있고, 위의 `s()`가 본 `active`·`waiting`이 그 칸이다.

| 칸 | 들어 있는 것 | 위 실험에서 |
|---|---|---|
| `installing` | 지금 설치 중인 새 버전 | 잠깐 들어갔다가 `waiting`으로 옮겨 간다 |
| `waiting` | 설치를 마치고 기다리는 새 버전 | v2 |
| `active` | 활성화되어 요청을 맡는 버전 | v1 |

```js
const r = await navigator.serviceWorker.getRegistration();
r.active.state; // 'activated' (v1)
r.waiting.state; // 'installed' (v2: 설치는 끝났고 차례를 기다린다)
r.installing; // null
```

- 빈 칸은 `null`이다. 처음 등록할 때는 `installing`만 차 있다(1단계 "`register()`가 끝난 시점과 페이지를 맡는 시점").

- `registration.active`와 `navigator.serviceWorker.controller`는 다르다. `active`는 이 범위의 활성 버전이고, `controller`는 이 페이지를 실제로 맡고 있는 버전이다.

- `ready` 직후처럼 `active`는 있는데 `controller`가 아직 `null`인 때가 있다. `clients.claim()`을 부르지 않으면 첫 방문 페이지는 새로고침 전까지 계속 그렇다.

- 칸은 하나씩이라, v2가 대기하는 동안 v3를 배포하면 v2는 버려지고 v3가 `waiting`에 들어간다.

> 도전 과제 3의 "새 버전이 있습니다" 안내는 이 `waiting` 칸이 찼는지를 보고 띄운다.

### 작업 1. [원복] `skipWaiting()` 되살리기

`skipWaiting()`을 되살린다(`VERSION`은 `"v2"` 그대로 둬도 된다).

```js
// public/sw.js
self.addEventListener("install", () => {
  // 기다리지 않고 바로 활성화한다(5단계)
  self.skipWaiting();
});
```

그러면 새 버전은 대기하지 않고 바로 활성화된다. `activate`의 `clients.claim()`이 열려 있는 탭까지 넘겨받는다.

같은 실험을 하면 `update()` 직후 대기 없이 v2가 탭을 맡고, 옛 캐시(`*-v1`)가 지워진다.

새 캐시는 요청이 오면서 채워지므로, 새로고침하면 `pages-v2,static-v2,api-v2`가 보인다.

확인이 끝나면 `VERSION`을 `"v1"`로 되돌려 이 문서의 나머지와 맞춘다.

### 개념 | `skipWaiting`의 대가

열려 있던 탭은 옛 버전의 JS로 돌고 있는데, 그 탭의 요청을 이제 새 서비스 워커가 처리한다.

옛 JS가 나중에 필요해서 부르는 파일(화면 전환 때 받는 청크 등)은 새 캐시에 없다.

온라인이면 네트워크에서 받아 오지만, 서버가 옛 빌드 파일을 이미 지웠다면 실패한다. 대기 규칙은 원래 이걸 막으려던 것이다.

> 이 앱처럼 화면이 단순하면 `skipWaiting`이 낫다. 복잡한 앱은 "새 버전이 있습니다" 안내와 새로고침 버튼을 띄우고, 사용자가 누를 때 `skipWaiting`을 하게 하기도 한다.

### 남길 것

- **찾아보면 되는 것**: `getRegistration()`, `update()`, `installing`/`waiting`/`active`의 `state` 값. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 새 서비스 워커는 옛 버전이 맡은 탭이 모두 닫힐 때까지 기다린다. 새로고침으로는 안 바뀐다.

  - `skipWaiting`은 배포를 바로 닿게 하는 대신, 옛 JS로 돌던 탭을 새 서비스 워커가 처리하게 만든다.

- **에러 신호**:

  - 코드를 고쳐 배포했는데 옛 화면이 보인다(`{active: true, waiting: true, ...}`) → 새 서비스 워커가 대기 중인지(Application 탭의 `waiting to activate`), cache-first로 옛 파일이 나가는지

## 7. 6단계: 테스트

### 작업 1. [커밋] Playwright가 운영 빌드로 띄우게 하기

서비스 워커는 운영 빌드에서만 등록되므로 Playwright가 띄우는 서버도 바꾼다.

`webServer`의 `npm run dev`를 아래처럼 바꾼다.

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e", // e2e 폴더의 *.spec.ts만 테스트로 본다
  // 백엔드(order-api-nest)는 미리 띄워 두어야 한다. 프론트만 여기서 띄운다
  // 서비스 워커는 production 빌드에서만 등록하므로(app/sw-register.tsx) dev가 아니라 build + start로 띄운다
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000, // 빌드 시간까지 기다린다
  },
  use: { baseURL: "http://localhost:3000" },
  workers: 1, // 같은 DB와 같은 사용자(kim)를 쓰므로 테스트를 하나씩 돌린다
});
```

`reuseExistingServer: true`이므로 이미 `next dev`가 3000번에서 돌고 있으면 그걸 쓴다. 그러면 서비스 워커가 등록되지 않아 `waitForController`에서 시간 초과로 실패한다.

> 테스트 전에 개발 서버를 끈다.

### 작업 2. [커밋] 오프라인 테스트 작성

Playwright는 `context.setOffline(true)`로 네트워크를 끊을 수 있다. 기본 브라우저인 Chromium에서는 서비스 워커의 `fetch`도 이 설정을 따른다.

```ts
// e2e/offline.spec.ts
import { test, expect, type Page } from "@playwright/test";

// 서비스 워커가 페이지를 제어할 때까지 기다린다.
// clients.claim() 덕분에 첫 방문 페이지도 곧 제어되지만, 그 페이지의 HTML·JS는 서비스 워커를 거치지 않아 캐시에 없다. 한 번 새로고침해서 서비스 워커를 거쳐 받게 한다
async function waitForController(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test("오프라인에서도 한 번 본 상품 목록이 보이고, 결제는 막힌다", async ({ page, context }) => {
  await page.goto("/shop");
  await waitForController(page);
  await expect(page.getByText("한정판 키보드")).toBeVisible(); // 온라인일 때 한 번 봐서 캐시에 들어간다

  await context.setOffline(true);
  try {
    await page.reload(); // 페이지(HTML)와 /products 둘 다 캐시에서 나온다
    await expect(page.getByText("한정판 키보드")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toBeVisible();

    await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
    await expect(page.getByRole("button", { name: "결제" })).toBeDisabled(); // 오프라인 결제는 시도조차 하지 않는다
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByTestId("offline-banner")).toBeHidden(); // 다시 연결되면 배너가 사라진다
});

test("로그인이 필요한 응답은 캐시하지 않는다 - 오프라인에서 다른 사용자 토큰으로 받아 볼 수 없다", async ({ page, context }) => {
  await page.goto("/shop");
  await waitForController(page);

  // kim으로 로그인해 내 주문을 온라인에서 한 번 본다
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.getByRole("link", { name: "내 주문" }).click();
  await expect(page.getByTestId("my-orders")).toBeVisible();

  // 같은 브라우저에서 lee의 액세스 토큰을 받는다(공용 PC에서 사용자가 바뀐 상황)
  const leeToken = await page.evaluate(async () => {
    const res = await fetch("http://localhost:4000/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "lee", password: "1234" }),
      credentials: "include",
    });
    return (await res.json()).accessToken as string;
  });

  await context.setOffline(true);
  try {
    const result = await page.evaluate(async (token) => {
      try {
        const res = await fetch("http://localhost:4000/me/orders", { headers: { Authorization: `Bearer ${token}` } });
        return `응답 ${res.status}`;
      } catch {
        return "요청 실패";
      }
    }, leeToken);
    // 서비스 워커가 Authorization 요청을 건너뛰므로 오프라인이면 그냥 실패해야 한다.
    // "응답 200"이 나오면 kim의 주문이 캐시에서 lee에게 나간 것이다
    expect(result).toBe("요청 실패");
  } finally {
    await context.setOffline(false);
  }
});
```

#### 테스트끼리 캐시가 섞이지 않는 이유

Playwright는 테스트마다 브라우저 컨텍스트를 새로 만든다. 그래서 서비스 워커와 캐시도 테스트마다 처음 상태에서 시작하고, 앞 테스트의 캐시가 뒤 테스트로 넘어가지 않는다.

#### `finally`로 연결을 되돌리는 이유

`setOffline(false)`를 `finally`에 둔 것은 첫 테스트처럼 오프라인 확인 뒤에 온라인 확인이 이어질 때, 중간 단계가 어떻게 끝나든 연결을 되돌리기 위해서다.

### 작업 3. [확인] 테스트 실행

백엔드를 띄우고 개발 서버는 끈 상태에서 돌린다. 기존 `shop.spec.ts`(4개), `upload.spec.ts`(2개)와 합쳐 8개다.

Playwright가 띄울 브라우저는 `npm install`로 받아지지 않고 컴퓨터마다 따로 내려받는다(`~/Library/Caches/ms-playwright/`). 이 컴퓨터에서 처음 돌리거나 Playwright 버전이 바뀌었다면 먼저 받는다.

```sh
npx playwright install chromium
```

받지 않고 돌리면 테스트 8개가 모두 1ms 남짓에 `browserType.launch: Executable doesn't exist at ...`으로 실패한다. 테스트 내용과 관계없이 브라우저를 못 띄운 것이다.

```sh
npm run test:e2e
...
Running 8 tests using 1 worker

  ✓  1 e2e/offline.spec.ts:9:5 › 오프라인에서도 한 번 본 상품 목록이 보이고, 결제는 막힌다 (397ms)
  ✓  2 e2e/offline.spec.ts:28:5 › 로그인이 필요한 응답은 캐시하지 않는다 - 오프라인에서 다른 사용자 토큰으로 받아 볼 수 없다 (584ms)
  ✓  3 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (413ms)
  ✓  4 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (421ms)
  ✓  5 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (527ms)
  ✓  6 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (762ms)
  ✓  7 e2e/upload.spec.ts:11:5 › 이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다 (341ms)
  ✓  8 e2e/upload.spec.ts:24:5 › 이미지가 아닌 파일은 확장자가 .png여도 거절된다 (303ms)

  8 passed (10.3s)
```

### 실험 | 4단계의 버그를 테스트가 잡는지 확인

4단계처럼 ③의 조건에서 `!req.headers.has("authorization")`를 빼고 돌리면 두 번째 테스트가 잡는다.

```text
  ✘  2 e2e/offline.spec.ts:30:5 › 로그인이 필요한 응답은 캐시하지 않는다 - ...
    Expected: "요청 실패"
    Received: "응답 200"
```

### 작업 4. [원복] ③의 조건 되살리기

확인한 뒤 조건을 되살린다.

### 용어 | Playwright API

- `page.waitForFunction(함수)`: 브라우저 안에서 그 함수의 결과가 참이 될 때까지 기다린다.

- `page.evaluate(함수, 인자)`: 함수를 브라우저 페이지 안에서 실행하고 결과를 테스트 쪽으로 돌려받는다. 두 번째 인자는 그 함수에 넘길 값이다. 왜 인자로 넘겨야 하는지는 아래 "`page.evaluate`: 함수가 브라우저로 넘어가 실행된다"에서 다룬다.

- `expect.poll(함수).toBe(값)`: 함수를 여러 번 다시 불러 결과가 그 값이 될 때까지 기다린다. `waitForFunction`과 어디서 반복하는지가 다르다(아래에서 다룬다).

- `context.setOffline(true | false)`: 이 브라우저 컨텍스트의 네트워크를 끊거나 되살린다.

### 개념 | `page.evaluate`: 함수가 브라우저로 넘어가 실행된다

테스트 코드는 Node에서 돌고, 페이지는 브라우저라는 다른 프로세스에서 돈다.

`page.evaluate(함수)`는 그 함수를 테스트 쪽에서 호출하는 게 아니라, 함수의 소스를 브라우저로 보내 거기서 실행하고 결과 값만 돌려받는다.

그래서 겉보기와 다르게 동작하는 곳이 두 군데 있다. 테스트 쪽 변수는 함수를 따라가지 않고, 돌려받는 값은 복사된다.

```ts
const leeToken = "...";

// 잘못: 함수 소스만 브라우저로 가므로 테스트 쪽 변수는 따라가지 않는다
await page.evaluate(() => leeToken);
// page.evaluate: ReferenceError: leeToken is not defined

// 맞음: 두 번째 인자로 값을 넘긴다(두 번째 테스트가 이 모양이다)
await page.evaluate((token) => token, leeToken); // "..."

// 돌려받는 값도 복사된다. Response 같은 브라우저 객체는 빈 객체가 된다
await page.evaluate(async () => await fetch("/x")); // {}
await page.evaluate(async () => (await fetch("/x")).status);
```

- 함수 안의 `fetch`, `navigator`, `caches`는 브라우저의 것이다. 그래서 테스트에서도 서비스 워커를 거치는 요청을 만들 수 있다.

- 넘기고 받는 값은 JSON처럼 복사할 수 있는 값이어야 한다. 두 번째 테스트가 `Response`를 그대로 돌려주지 않고 `` `응답 ${res.status}` `` 같은 문자열로 바꿔 돌려주는 이유다.

- `page.waitForFunction`도 같은 방식으로 함수를 브라우저에 보내 거기서 반복 실행한다. `expect.poll`은 반대로 테스트 쪽에서 함수를 반복 실행하고, 그 안의 `page.evaluate`가 매번 브라우저에 묻는다.

> C로 치면 다른 프로세스에 함수 포인터가 아니라 소스 문자열을 보내 실행시키는 것과 같다. 클로저가 붙든 변수는 프로세스 경계를 넘지 못하고, 값만 복사되어 오간다.

### 남길 것

- **찾아보면 되는 것**: `webServer`의 옵션, `context.setOffline`, `expect.poll`, 브라우저를 받는 `npx playwright install`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 서비스 워커 테스트는 운영 빌드로 띄우고, `controller`가 생긴 뒤(한 번 새로고침한 뒤)에 시작한다.

  - `page.evaluate`의 함수는 브라우저에서 돈다. 테스트 쪽 값은 인자로 넘기고, 돌려받는 것은 복사 가능한 값으로 만든다.

- **에러 신호**:

  - 테스트 전부가 `browserType.launch: Executable doesn't exist at ...`으로 실패 → `npx playwright install chromium`으로 브라우저를 받았는지

  - `waitForController`에서 시간 초과 → 3000번에 `next dev`가 떠 있어 `reuseExistingServer`가 그걸 썼는지. 아니라면 `sw.js`에 문법 오류가 있는지(`node --check public/sw.js`)

  - `Expected: "요청 실패"` / `Received: "응답 200"` → ③의 조건에서 `authorization` 검사가 빠졌는지

  - `page.evaluate: ReferenceError: leeToken is not defined` → 테스트 쪽 변수를 두 번째 인자로 넘겼는지

## 8. 디버깅

### 진단 1. 개발자 도구의 Application 탭

| 위치 | 보는 것 |
|---|---|
| Service workers | 지금 활성화된 버전, 대기 중인 버전(`waiting to activate`), Unregister·Update 버튼, Offline 체크 |
| Service workers → Update on reload | 새로고침할 때마다 서비스 워커를 새로 받고 바로 활성화한다. 서비스 워커 코드를 고치는 동안 켜 둔다 |
| Service workers → Bypass for network | 서비스 워커를 건너뛰고 항상 네트워크로 보낸다. "서비스 워커 때문인가"를 가를 때 |
| Cache storage | 캐시별로 저장된 URL과 응답. 지우기도 여기서 |
| Storage → Clear site data | 서비스 워커·캐시·localStorage를 한꺼번에 지운다. 처음 방문한 상태로 되돌린다 |

Network 탭에서 서비스 워커가 돌려준 응답은 Size 칸에 `(ServiceWorker)`로 나온다. 서비스 워커 안에서 다시 보낸 요청은 앞에 톱니바퀴 표시가 붙는다.

### 진단 2. 서비스 워커 쪽 콘솔

서비스 워커의 `console.log`는 페이지 콘솔에 나오지 않는다.

Application 탭 → Service workers에서 `sw.js` 옆의 inspect(또는 `chrome://serviceworker-internals`)로 서비스 워커 전용 개발자 도구를 연다.

서비스 워커는 할 일이 없으면 브라우저가 멈췄다가 이벤트가 오면 다시 깨운다. 그래서 전역 변수에 값을 두면 사라질 수 있다.

> 오래 둘 값은 Cache Storage나 IndexedDB에 둔다.

### 진단 3. 증상·에러로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `서비스 워커 등록 실패: TypeError: Failed to register a ServiceWorker ... A bad HTTP response code (404)` | `/sw.js`가 없다 | `public/sw.js`가 있는지 | 1단계 |
| 빌드에서 ``Route segment config "instant" requires `nextConfig.cacheComponents` to be enabled.`` / `Unknown at rule: @theme` | `next.config.ts`의 기존 설정이 지워졌다. `instant`는 `cacheComponents`가, `@theme`는 Tailwind 로더가 있어야 한다 | `next.config.ts`에 `cacheComponents`와 `turbopack.rules`가 남아 있는지 | 1단계 |
| `navigator.serviceWorker`가 `undefined` | HTTP(로컬호스트가 아닌 주소)로 열었다. 서비스 워커는 HTTPS와 `localhost`에서만 된다 | 접속한 주소 | 1단계 |
| 개발 서버에서 아무 일도 안 일어난다 | 이 문서는 운영 빌드에서만 등록한다 | `sw-register.tsx`의 `NODE_ENV` 검사, `npm run build && npm run start` | 1단계 |
| 등록은 됐는데 `controller`가 `null` | `clients.claim()`이 아직 이 탭을 넘겨받기 전이다 | `controllerchange`를 기다린다. `clients.claim()`이 없는 서비스 워커라면 새로고침 | 1단계 |
| CSP 위반으로 등록 실패 | `worker-src`(없으면 `child-src`, `script-src`)가 `/sw.js`를 허락하지 않는다 | `proxy.ts`의 `worker-src` | 1단계 |
| `서비스 워커 등록 실패: TypeError: Failed to register a ServiceWorker ... ServiceWorker script evaluation failed` | `sw.js`를 실행하다 멈췄다. `public/`은 빌드를 거치지 않아 문법 오류가 빌드에서 걸리지 않는다 | `node --check public/sw.js` | 2단계 |
| `InvalidStateError: Failed to execute 'respondWith' on 'FetchEvent': The event handler is already finished.` | 이벤트 함수가 돌아간 뒤에 `respondWith`를 불렀다 | `respondWith` 앞의 `await` | 2단계 |
| `TypeError: Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported` | GET이 아닌 요청은 캐시에 넣을 수 없다 | `fetch` 함수 첫 줄의 GET 검사 | 2단계 |
| 콘솔의 캐시 목록에 `api-v1`이 없다 | 서비스 워커가 API 출처를 모르거나, 페이지를 맡기 전에 오간 요청이다 | `sw.js?api=` 쿼리, 등록 뒤 새로고침했는지 | 2단계 |
| 캐시 목록에 이 프로젝트에 없는 경로나 `hmr-client`·`react-dom_development` 청크가 있다 | 서비스 워커는 프로젝트가 아니라 주소에 등록된다. 같은 주소에 띄운 개발 서버·다른 프로젝트의 요청까지 캐시했다 | Application 탭 → Clear site data 뒤 운영 빌드로 다시 확인 | 2단계 |
| `Missing getServerSnapshot, which is required for server-rendered content.` | 서버 렌더링에 쓸 값이 없다 | `useSyncExternalStore`의 세 번째 인자 | 3단계 |
| 오프라인에서 "오프라인, 저장된 응답이 없습니다" | 그 URL을 온라인에서 본 적이 없다. 정상 동작이다 | 온라인에서 그 주소를 한 번 열었는지 | 3단계 |
| 오프라인에서 페이지는 뜨는데 화면이 깨진다 | 그 페이지가 쓰는 JS/CSS가 캐시에 없다 | `static-*` 캐시, 온라인에서 그 페이지를 끝까지 본 적이 있는지 | 3단계 |
| 다른 사용자의 데이터가 보인다(오프라인에서 lee의 토큰에 kim의 주문, `200`) | 로그인 응답이 URL 키로 캐시됐다 | Cache storage에 `/me/...`가 있는지, ③의 조건 | 4단계 |
| 코드를 고쳐 배포했는데 옛 화면이 보인다(`{active: true, waiting: true, ...}`) | 새 서비스 워커가 대기 중이거나, cache-first로 옛 파일이 나간다 | Application 탭의 `waiting to activate` | 5단계 |
| 테스트 전부가 `browserType.launch: Executable doesn't exist at ...`으로 1ms 남짓에 실패 | Playwright가 띄울 브라우저가 이 컴퓨터에 없다. `npm install`로는 받아지지 않는다 | `npx playwright install chromium` | 6단계 |
| `waitForController`에서 시간 초과(`page.waitForFunction: Test timeout of 30000ms exceeded.`) | 서비스 워커가 등록되지 않았다. 개발 서버가 떠 있거나, `sw.js`에 문법 오류가 있다 | 3000번의 `next dev`·`reuseExistingServer`, 그다음 `node --check public/sw.js` | 6단계 |
| `Expected: "요청 실패"` / `Received: "응답 200"` | 로그인 응답이 캐시에서 다른 사용자 토큰에 나갔다 | ③의 조건의 `authorization` 검사 | 6단계 |
| `page.evaluate: ReferenceError: leeToken is not defined` | 테스트 쪽 변수는 브라우저로 넘어가지 않는다 | `page.evaluate`의 두 번째 인자 | 6단계 |

### 시험해보기

```sh
# 백엔드(order-api-nest)를 띄운 상태에서, 개발 서버는 끄고
npm run test:e2e # 8 passed
npm run build && npm run start
# 브라우저에서 /shop → 새로고침 → Network 탭 Offline → 새로고침 → 목록과 오프라인 배너
```

### 도전 과제

#### 1. 허용 목록으로 바꾸기

4단계의 거부 목록(`Authorization`이 없으면 캐시)을 허용 목록(캐시해도 되는 경로만)으로 바꿔 본다.

테스트 두 개가 그대로 통과하는지 확인한다.

무엇이 달라지는가?

**답**

`public/sw.js`에 캐시해도 되는 경로 목록을 두고, ③의 조건을 그 목록으로 바꾼다. 완성본은 `practice/challenge-allowlist/`에 있다.

```js
// public/sw.js
// API_ORIGIN 아래에 목록을 두고, ③의 조건을 바꾼다
const PUBLIC_API_PATHS = ["/products"];

// ③의 조건
  if (API_ORIGIN && url.origin === API_ORIGIN && PUBLIC_API_PATHS.includes(url.pathname)) {
```

1. `npm run test:e2e`가 8개 모두 통과한다. 오프라인 테스트 두 개도 그대로다.

2. `/products`는 목록에 있으니 전처럼 `api-v1`에 들어가고, 오프라인에서도 상품 목록이 보인다.

3. `/me/orders`는 목록에 없으니 `Authorization` 헤더를 보지 않고도 손대지 않는다. 오프라인에서 lee의 토큰으로 요청하면 전처럼 실패한다.

> 겉으로 보이는 동작은 같다. 달라지는 것은 실수했을 때의 방향이다. 새 API를 만들고 목록에 넣는 걸 잊으면 "오프라인에서 안 보인다"로 틀릴 뿐, 다른 사용자에게 새지는 않는다. 쿠키로 인증하는 API여도 마찬가지다.

#### 2. 오프라인 전용 페이지 만들기

오프라인 전용 페이지(`/offline`)를 만들어 `install`에서 미리 캐시해 둔다.

한 번도 안 본 페이지에서는 503 텍스트 대신 그 페이지를 돌려준다.

무엇이 달라지는가?

**답**

`app/offline/page.tsx`에 JS 없이도 읽히는 페이지를 만든다. 완성본은 `practice/challenge-offline-page/`에 있다.

```tsx
// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <main data-testid="offline-page">
      <h1>오프라인이다</h1>
      <p>이 페이지는 아직 받아 둔 적이 없어서 보여 줄 수 없다. 연결된 뒤 다시 열어 본다.</p>
      <p>
        <a href="/shop">상점으로 가기(마지막으로 본 목록)</a>
      </p>
    </main>
  );
}
```

`sw.js`에서는 `install`에서 이 페이지를 미리 받아 두고, `networkFirst`가 캐시에서도 못 찾았을 때 페이지 이동이면 그걸 돌려준다.

```js
// public/sw.js
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGE_CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

// networkFirst의 catch 안, 503을 돌려주기 전에
    if (req.mode === "navigate") {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
```

1. 서비스 워커가 설치될 때 `/offline`이 `pages-v1`에 들어간다. 사용자가 그 페이지를 연 적이 없어도 된다.

2. `/shop`만 본 뒤 오프라인에서 `/me/orders`를 주소로 열면, 503 텍스트 대신 "오프라인이다" 페이지가 나온다.

3. 그 페이지의 "상점으로 가기"를 누르면 받아 둔 `/shop`이 열리고 상품 목록이 보인다.

4. 이 확인을 `e2e/offline.spec.ts`에 테스트로 더하면 `npm run test:e2e`가 9개 통과한다.

> 링크를 `<Link>` 대신 `<a>`로 둔 것은 일반 페이지 이동으로 서비스 워커의 ②를 타게 하려는 것이다.

#### 3. "새 버전이 있습니다: 새로고침" 구현하기

5단계에서 말한 방식을 구현한다.

1. `skipWaiting()`을 지운다.

2. 페이지가 `registration.waiting`을 보면 안내를 띄운다.

3. 사용자가 누르면 `postMessage`로 서비스 워커에 `skipWaiting`을 시킨다.

4. `controllerchange` 이벤트에서 새로고침한다.

무엇이 달라지는가?

**답**

`sw.js`의 `install`을 지우고, 페이지가 보내는 메시지를 받는다. 완성본은 `practice/challenge-update-prompt/`에 있다.

```js
// public/sw.js
// install 대신
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
```

`app/sw-register.tsx`는 등록한 뒤 대기 중인 새 버전을 찾아 안내를 띄운다.

```tsx
// app/sw-register.tsx
"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api-client";

export function SwRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(`/sw.js?api=${encodeURIComponent(API_URL)}`)
      .then((reg) => {
        // 페이지를 열었을 때 이미 대기 중인 새 버전
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        // 페이지를 연 뒤 새 버전이 설치를 마쳤을 때
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            // controller가 없으면 첫 설치다. 바꿔 끼울 옛 버전이 없다
            if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
          });
        });
      })
      .catch((err) => console.error("서비스 워커 등록 실패:", err));
  }, []);

  if (!waiting) return null;
  const apply = () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage("skipWaiting");
  };
  return (
    <p role="status" data-testid="update-banner">
      새 버전이 있습니다 <button onClick={apply}>새로고침</button>
    </p>
  );
}
```

1. 처음 방문하면 맡고 있는 옛 버전이 없으니 대기 없이 활성화되고 안내도 뜨지 않는다.

2. `/shop`을 열어 둔 채 `VERSION`을 `"v2"`로 바꿔 배포하고 `update()`를 하면, 새 버전이 설치를 마치고 대기한다(`waiting: true`, 캐시는 v1 그대로). 이때 "새 버전이 있습니다 새로고침"이 뜬다.

3. 버튼을 누르면 새 버전이 `skipWaiting()`으로 활성화되고, `clients.claim()`으로 이 탭을 맡는 순간 `controllerchange`가 일어나 페이지가 새로고침된다.

4. 새로고침 뒤에는 `waiting: false`, 캐시는 `pages-v2,static-v2,api-v2`이고 안내는 사라진다.

5. `npm run test:e2e`는 8개 모두 통과한다.

> 새로고침을 `controllerchange`에서 하는 이유는, 버튼을 누른 순간에는 아직 옛 버전이 탭을 맡고 있기 때문이다. 새 버전이 넘겨받은 뒤에 새로고침해야 새 버전이 그 요청을 처리한다.

#### 용어 | Service Worker API (도전 과제 3)

- `registration.installing`: 지금 설치 중인 새 버전이다. `waiting`·`active`와 함께 5단계의 "등록 하나에 세 칸: `installing`, `waiting`, `active`"에서 다뤘다.

- `updatefound` / `statechange`: 새 버전을 받기 시작했을 때, 그 서비스 워커의 `state`(`installing` → `installed` → `activating` → `activated`)가 바뀔 때 일어난다.

- `worker.postMessage(값)` / `message` 이벤트: 페이지와 서비스 워커가 값을 주고받는다.

- `controllerchange`: 이 페이지를 맡는 서비스 워커(`navigator.serviceWorker.controller`)가 바뀔 때 일어난다.

### 남길 것

- **찾아보면 되는 것**: Application 탭의 각 버튼 위치, `chrome://serviceworker-internals`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - "서비스 워커 때문인가"는 Bypass for network로 먼저 가른다. 그다음 Cache storage에 무엇이 들어 있는지 본다.

  - 서비스 워커는 언제든 멈췄다 깨어난다. 전역 변수에 상태를 두지 않는다.

  - 서비스 워커는 프로젝트가 아니라 주소(`localhost:3000`)에 등록되고, 지우기 전까지 남는다. 같은 포트에 개발 서버나 다른 프로젝트를 띄우면 그 요청까지 가로챈다.

- **에러 신호**: 위 진단 3의 표에 모두 모았다.

## 9. 완성 확인

### 체크리스트

- [ ] 운영 빌드에서 서비스 워커가 등록되고, 첫 방문 뒤 새로고침부터 `controller`가 생긴다

- [ ] `pages-v1`, `static-v1`, `api-v1` 캐시에 각각 페이지, 빌드 파일, `/products`가 들어간다

- [ ] 오프라인 새로고침에서 상품 목록과 오프라인 배너가 보이고, 결제 버튼이 막힌다

- [ ] 로그인 응답을 캐시하면 다른 사용자 토큰으로 kim의 주문이 나오는 것을 재현했고, 고친 뒤에는 요청이 실패한다

- [ ] `skipWaiting` 없이 새 버전이 대기하는 것과, 있을 때 바로 바뀌고 옛 캐시가 지워지는 것을 확인했다

- [ ] `npm run test:e2e` 8개가 통과하고, 4단계의 버그를 테스트가 잡는다

## 10. 다음 단계

### 자가 점검

1. 서비스 워커가 요청을 "손대지 않는" 방법은? 이 문서에서 손대지 않는 요청은 어떤 것들이고, 왜 그런가?

2. 빌드 결과물은 cache-first, 페이지와 API는 network-first로 한 이유는?

3. `ready`가 끝났는데도 `controller`가 잠깐 `null`인 이유는? 첫 방문 페이지의 처음 요청이 캐시에 없는 이유는?

4. 로그인 응답을 캐시하면 왜 다른 사용자에게 새는가? Cache Storage의 키는 무엇인가? `10`의 어떤 버그와 같은 모양인가?

5. 쿠키로 인증하는 API라면 4단계의 조건이 왜 통하지 않는가? 대신 어떻게 해야 하나?

6. `skipWaiting` 없이 새 버전을 배포하면 사용자는 언제 새 버전을 받는가? `skipWaiting`의 대가는?

7. nonce CSP 아래에서 캐시된 HTML이 문제없이 동작하는 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 오프라인에서 한 쓰기 요청을 모아 두었다가 연결되면 보내기(Background Sync, IndexedDB 큐). 결제처럼 돈이 걸린 요청은 `02`의 멱등성 키 없이는 위험하다

- 푸시 알림(Push API)

- 홈 화면에 설치하는 웹 앱(웹 앱 매니페스트, PWA)

- 서비스 워커 라이브러리(Workbox)와 빌드 시 미리 캐시할 파일 목록 만들기(precache manifest)

- 페이지 이동 요청을 서비스 워커가 깨어나는 동안 미리 보내기(navigation preload)

- 캐시 용량 한도와 브라우저가 저장소를 지우는 규칙, 캐시 항목 개수·기간 제한
