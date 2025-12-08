# 결제를 결제 대행사(Stripe)에 맡기고 웹훅으로 확인하기

## 목표

이 프로젝트는 [`13-authjs`](https://github.com/seungwoo7050/node-order/tree/13-authjs)로부터 시작한다.

결제 버튼은 재고를 줄이고 주문을 바로 `paid: true`로 저장하지만 실제로는 돈이 오가지 않는다.

이 프로젝트는 결제를 Stripe(테스트 모드)에 맡긴다.

결제를 누르면 Stripe가 호스팅하는 결제 화면으로 가고, **Stripe가 웹훅으로 알려 줘야** 주문이 결제 완료가 된다.

1. 결제를 누르면 재고를 예약하고 주문을 결제 대기로 만든 뒤 Stripe 결제 화면으로 보낸다

2. Stripe의 웹훅을 받아 서명을 검증하고 주문을 결제 완료로 바꾼다

3. 같은 웹훅이 두 번 와도, 결제 화면에서 돌아온 뒤에 웹훅이 늦게 와도 결과가 맞게 한다

4. 결제하지 않고 끝난 주문은 취소하고 예약한 재고를 되돌린다

> 국내 PG(토스페이먼츠)를 함께 붙이는 일은 이 문서에서 하지 않는다. 미루는 이유와 다룰 곳은 12장 "선택 과정: 토스페이먼츠를 함께 붙이기"에 적었다.

```text
결제 → Stripe 결제 화면(테스트 카드 4242 4242 4242 4242) → 돌아와서 "결제 대기" → 웹훅 도착 → "결제 완료"

stripe listen
--> checkout.session.completed [evt_1UN4fGIMAlkapI16fbguMbFl]
<--  [200] POST http://localhost:4000/payments/webhook [evt_1UN4fGIMAlkapI16fbguMbFl]

Nest 로그
웹훅 처리: evt_1UN4fGIMAlkapI16fbguMbFl checkout.session.completed → 주문 #11
```

> 시작 기준점:  
> `order-api-nest`와 `order-console-next`가 한 워크스페이스에 있고, 백엔드는 RLS 아래에서 `asUser`·`asAdmin`으로 DB를 쓴다.  
> 결제는 재고 잠금·`Idempotency-Key`·outbox를 거치고, 프론트의 결제 버튼은 결제 시도마다 `Idempotency-Key`를 만든다.  
> 컨테이너 실행과 커밋하지 않는 `.env.local`도 그대로 쓴다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 10장에서 "어디서 틀어졌나"를 가르는 절차 | 친다(`stripe`, `psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 10장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지 알려 준다. 섞이면 센 쪽 하나만 붙였다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일: 코드, 설정, 마이그레이션, 패키지 설치(`package.json`·lock) | 한다 |
  | `[실행]` | 저장소 밖의 상태: 켜 둔 `stripe listen` 같은 것. 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다: 요청을 보내 보고 결과를 읽는다(그때 생긴 주문은 다음 작업이 기대지 않는다) | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린 상태. 실험 전과 같아진다 | 안 한다 |

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 10장 "진단 2"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 11·12장은 체크리스트라서 `남길 것`을 두지 않았다.

- Stripe 계정(샌드박스)의 Secret key(`sk_test_...`)와 Stripe CLI가 필요하다. 키를 받는 과정은 1장 작업 2, CLI 설치와 로그인은 1장 작업 3에 있다.

| 단계 | 하는 일 |
|---|---|
| [0. 결제 대행에 대한 사전지식](#0-결제-대행에-대한-사전지식) | 카드 번호·돌아오는 주소·웹훅·재고 예약의 관계를 본다(작업 없음) |
| [1. 준비](#1-준비) | Stripe SDK를 설치하고, `stripe listen`으로 웹훅을 로컬까지 받는다 |
| [2. 1단계: 스키마](#2-1단계-스키마) | 주문에 세션 id·취소 시각을, 처리한 웹훅을 적을 표를 만든다 |
| [3. 2단계: 결제 세션 만들기](#3-2단계-결제-세션-만들기) | 결제를 누르면 주문(결제 대기)과 Stripe 결제 화면 주소를 돌려준다 |
| [4. 3단계: 웹훅 받기](#4-3단계-웹훅-받기) | 서명을 받은 바이트 그대로 검증하고, 결제 완료·만료를 처리한다 |
| [5. 4단계: 같은 웹훅이 두 번 와도](#5-4단계-같은-웹훅이-두-번-와도) | 중복 웹훅으로 알림이 쌓이는 것을 보고, 두 겹으로 막는 이유를 본다 |
| [6. 5단계: 결제하지 않고 끝나면](#6-5단계-결제하지-않고-끝나면) | 세션을 만료시켜 주문 취소와 재고 복구를 확인한다 |
| [7. 6단계: 프론트](#7-6단계-프론트) | 결제 버튼이 Stripe로 보내고, 돌아온 뒤 웹훅을 기다리며 다시 묻는다 |
| [8. 7단계: 컨테이너](#8-7단계-컨테이너) | 컨테이너에도 Stripe 값을 넘긴다 |
| [9. 8단계: 테스트](#9-8단계-테스트) | Mock Stripe와 직접 서명한 웹훅으로 백엔드를, Stripe 이동으로 프론트를 테스트한다 |
| [10. 디버깅](#10-디버깅) | 웹훅을 따라가고, 증상으로 원인을 가른다 |
| [11. 완성 확인](#11-완성-확인) | 체크리스트 |
| [12. 다음 단계](#12-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 결제 대행에 대한 사전지식

### 개념 1 | 카드 번호는 우리 서버를 지나가지 않는다.

결제를 직접 처리하려면 카드 번호를 받아 카드사와 통신해야 한다.

카드 번호를 다루는 서버는 보안 규정(PCI DSS)의 심사 대상이 된다.

Stripe Checkout은 Stripe가 호스팅하는 결제 화면이다.

우리 서버는 "이 주문을 이 금액으로 결제받아 줘"라고 세션을 만들고, 브라우저를 그 화면으로 보낸다. **카드 번호는 브라우저와 Stripe 사이에서만 오간다.**

### 개념 2 | "돌아왔다"는 결제의 증거가 아니다.

결제가 끝나면 Stripe는 브라우저를 우리가 정한 주소(`success_url`)로 돌려보낸다. 이 주소를 결제 완료의 근거로 쓰면 안 된다.

- 그 주소는 누구나 주소창에 직접 칠 수 있다. 돌아왔다고 결제 완료로 처리하면 결제 없이 완료가 된다.

- 결제는 됐는데 돌아오기 전에 사용자가 창을 닫을 수도 있다. 그러면 결제는 됐는데 주문은 영원히 결제 대기다.

결제가 끝났다는 사실은 Stripe가 서버끼리 알려 준다. 이게 **웹훅**이다.

Stripe가 우리 서버의 주소(`POST /payments/webhook`)로 "이 결제 세션이 완료됐다"는 이벤트를 보낸다.

HTTP는 요청한 쪽이 응답을 받으면 한 번의 주고받기가 끝난다. 그리고 주고받기를 시작할 수 있는 것은 언제나 요청하는 쪽(클라이언트)이다. 응답하는 쪽(서버)이 나중에 먼저 말을 걸 방법은 HTTP 안에 없다.

결제는 이 한 번의 주고받기 안에 끝나지 않는다. 우리 서버가 Stripe에 세션을 만들어 달라고 요청하면, 그 응답은 "세션을 만들었다"까지다. 사용자가 결제 화면에서 카드를 넣는 것은 몇 분 뒤일 수도 있고, 아예 안 할 수도 있다. 응답을 그때까지 붙잡아 둘 수는 없다.

그래서 일이 끝난 쪽이 **반대 방향으로 새 HTTP 요청을 보낸다.** 이게 웹훅이다. 결제가 끝난 순간 Stripe가 클라이언트가 되어 우리 서버에 요청하고, 우리 서버는 그 요청을 받는 서버가 된다.

보낼 곳은 요청마다 알려 주는 것이 아니라 **미리 등록해 둔다.** Stripe 계정에 "이 계정에서 일어난 일은 이 주소로 보내라"를 한 번 적어 두는 것이다. 그래서 웹훅은 "내 요청에 대한 늦은 답장"이라기보다 "이 계정에서 일어난 일의 알림"이다. 어떤 요청에서 시작된 일인지는 알림 안의 값으로 우리가 이어 붙인다. 이 문서에서는 세션 id로 주문을 찾는다(3단계 "주문은 세션 id로 찾는다").

웹훅은 새로운 프로토콜이 아니다. 평범한 HTTPS `POST`에 JSON 본문을 실은 것이고, 받는 쪽도 평범한 POST 컨트롤러다(3단계의 `@Post("webhook")`). 다른 것은 누가 언제 어느 방향으로 요청하느냐뿐이다. 웹소켓(`ws://`)처럼 연결을 열어 두는 방식도 아니다. 보낼 때마다 새 요청이고, 응답을 받으면 끝난다.

HTTP를 그대로 쓰므로 HTTP의 성질도 그대로 따라온다. 그 주소는 누구나 부를 수 있고, 응답은 중간에 끊길 수 있다. 서명과 개념 3이 이 두 가지 때문에 필요하다.

C로 치면 콜백이다. 라이브러리에 함수 포인터를 넘겨 두면, 일이 생겼을 때 라이브러리가 그 함수를 부른다. 웹훅에서는 함수 포인터 자리에 URL이, 함수 호출 자리에 HTTP POST가 들어간다. 주소를 알려 두는 방법은 대시보드에 엔드포인트를 등록하거나, 개발 중에는 `stripe listen --forward-to`로 대신 받게 하는 것이다(1장).

웹훅이 없으면 폴링을 해야 한다. 우리가 "결제됐나?"를 몇 초마다 Stripe에 묻는 것이다. 결제가 언제 끝날지 모르니 계속 물어야 하고, 대부분은 "아직"이라는 답만 돌아온다. 폴링이 busy-wait라면 웹훅은 인터럽트에 가깝다. 일이 생겼을 때만 알림이 온다.

웹훅 요청 하나는 평범한 HTTP 요청이다.

```text
POST /payments/webhook
Content-Type: application/json
Stripe-Signature: t=...,v1=...

{ "id": "evt_...", "object": "event", "type": "checkout.session.completed", "data": { "object": { "object": "checkout.session", "id": "cs_test_...", ... } } }
```

`type`은 무슨 일이 일어났는지, `data.object`는 그 일이 일어난 대상(여기서는 결제 세션)의 그때 모습이다. `id`는 이 알림 자체의 번호다. 같은 알림이 다시 오면 같은 `id`로 온다.

받는 쪽이 지킬 약속은 하나다. **받았으면 빨리 2xx로 답한다.** 보낸 쪽은 응답 코드만 보고 전달에 성공했는지 판단한다. 처리 결과를 돌려주는 통로가 아니라 "받았다"는 확인일 뿐이다.

반대로 웹훅이 보증하지 않는 것도 있다. 누가 보냈는지, 한 번만 오는지, 순서대로 오는지다. 아래의 서명과 개념 3이 이것을 하나씩 메운다.

"반드시 도착한다"도 보증하지 않는다. 보낸 쪽은 2xx를 받을 때까지 정해진 기간 동안 다시 보낼 뿐이라, 그동안 우리 서버가 받지 못하면 알림은 끝내 오지 않는다. 등록한 주소가 틀렸거나 다른 계정에 등록돼 있으면 처음부터 오지 않는다(1장 "겪은 문제").

그런데 이 주소도 누구나 부를 수 있다.

그래서 Stripe는 요청마다 서명(`Stripe-Signature` 헤더)을 붙이고, 우리는 공유한 비밀(`whsec_...`)로 그 서명을 검증한다. C로 치면 메시지 뒤에 HMAC을 붙여 보내는 것과 같다.

### 개념 3 | 웹훅은 "최소 한 번" 오고, 순서도 보장하지 않는다.

Stripe는 우리가 성공 응답(2xx)을 돌려줄 때까지 웹훅을 다시 보낸다.

우리가 처리는 했는데 응답이 중간에 끊기면 **같은 이벤트가 또 온다**.

또, 브라우저가 돌아오는 것과 웹훅이 오는 것 중 무엇이 먼저일지 보장하지 않는다.

`02`에서 같은 결제 요청이 두 번 오는 문제를 `Idempotency-Key`로 풀었다. 웹훅도 같은 문제이므로, 이벤트 id를 키로 같은 방식으로 푼다.

### 개념 4 | 재고는 결제를 누를 때 예약한다.

결제 화면에 있는 동안 재고가 다른 사람에게 팔리면 곤란하다.

그래서 `02`처럼 결제를 누르는 순간 재고를 줄이고(예약), 주문은 결제 대기로 둔다. 결제하지 않고 세션이 끝나면(만료) 예약을 되돌린다.

```text
결제 클릭 ─▶ 재고 예약 + 주문(결제 대기) + Stripe 세션 ─▶ 결제 화면
                                                      ├─ 결제함   ─▶ 웹훅 completed ─▶ 결제 완료
                                                      └─ 안 함    ─▶ 웹훅 expired   ─▶ 취소 + 재고 복구
```

주문 한 건은 세 상태 중 하나다. 이 문서의 칸으로 쓰면 이렇다.

| 상태 | `paid` | `canceledAt` | 누가 바꾸나 |
|---|---|---|---|
| 결제 대기 | `false` | NULL | 결제 버튼(주문을 만들 때) |
| 결제 완료 | `true` | NULL | `checkout.session.completed` 웹훅 |
| 취소됨 | `false` | 시각 | `checkout.session.expired` 웹훅, 또는 세션을 못 만들었을 때의 보상 |

결제 대기에서만 다른 두 상태로 갈 수 있고, 한 번 정해지면 되돌아가지 않는다. 4단계의 조건부 UPDATE가 이 규칙을 지킨다.

## 1. 준비

### 작업 1. [커밋] 폴더를 복사하고 Stripe SDK 설치

```sh
rm -rf node_modules order-api-nest/dist order-console-next/.next
npm install
npm install stripe -w order-api-nest
```

`stripe` 23.0.0을 썼다. 이 SDK는 Stripe API 버전에 맞춰져 있다.

### 작업 2. [커밋] 비밀 값 두 개를 `.env.local`에 더하기

백엔드 `.env.local`에 두 값을 더한다. 견본 파일 `.env.example`에도 같은 두 줄을 값 없이 더해 둔다.

```sh
# order-api-nest/.env.local
# Stripe 테스트 모드. sk_test_ 로 시작하는 Secret key
STRIPE_SECRET_KEY=
# 웹훅 서명 비밀. stripe listen이 처음에 보여 주는 whsec_... (stripe listen --print-secret 로도 볼 수 있다)
STRIPE_WEBHOOK_SECRET=
```

`main.ts`가 시작할 때 `.env.local`이 있으면 읽어 들이므로, 서버를 다시 켜면 `process.env.STRIPE_SECRET_KEY`로 보인다.

두 값은 채우는 때가 다르다.

- `STRIPE_SECRET_KEY`는 지금 채운다. 받는 방법은 아래 "비밀 키 받기"에 있다.

- `STRIPE_WEBHOOK_SECRET`은 지금은 비워 둔다. 이 값은 다음 작업에서 `stripe listen`을 처음 실행해야 알 수 있다.

둘 다 비어 있어도 서버는 뜬다. `StripeGateway`가 키를 쓰는 순간에야 읽기 때문이다(2단계 작업 1). 비밀 키는 2단계 작업 4에서 결제 세션을 처음 만들 때, 웹훅 비밀은 3단계에서 웹훅을 처음 검증할 때 필요하다. 그 전까지 채우지 않으면 그때 `STRIPE_SECRET_KEY 환경변수가 없습니다`, `STRIPE_WEBHOOK_SECRET 환경변수가 없습니다`가 난다.

#### 비밀 키 받기

1. Stripe 계정을 만들고([dashboard.stripe.com/register](https://dashboard.stripe.com/register)) 대시보드에 들어간다. 실제 결제(라이브 모드)를 켜기 전까지는 사업자 정보를 넣지 않아도 테스트용 키를 쓸 수 있다.

2. 대시보드 왼쪽 위의 계정 메뉴에서 샌드박스를 고른다. 샌드박스는 실제 돈이 오가지 않는 테스트 환경이고, Stripe 문서는 새 연동에 다른 데이터와 섞이지 않는 별도의 샌드박스를 쓰라고 권한다. 샌드박스가 없으면 같은 메뉴에서 하나 만든다.

3. 그 샌드박스의 API 키 화면([dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys))에서 Standard keys의 **Secret key**를 눌러 복사한다. 샌드박스에서는 비밀 키를 언제든 다시 볼 수 있다(라이브 모드는 처음 한 번만 보여 준다).

4. 앞머리를 확인하고 `.env.local`의 `STRIPE_SECRET_KEY=` 뒤에 붙여 넣는다.

| 앞머리 | 무엇인가 | 이 문서에서 |
|---|---|---|
| `sk_test_` | 샌드박스의 비밀 키. 모든 API를 부를 수 있다 | 이것을 쓴다 |
| `pk_test_` | 공개 키. 브라우저에 넣는 키라 결제 세션을 만들 수 없다 | 쓰지 않는다 |
| `rk_test_` | 권한을 골라 만든 제한 키 | 쓰지 않는다(아래) |
| `sk_live_` | 라이브 모드의 비밀 키. 실제 돈이 오간다 | 넣으면 안 된다 |

어느 샌드박스에서 복사했는지 기억해 둔다. 작업 3의 `stripe login`에서 **같은 샌드박스**를 골라야 웹훅이 온다(아래 "겪은 문제").

비밀 키는 커밋하지 않는 `.env.local`에만 둔다. 견본 파일 `.env.example`에는 이름만 적는다.

> Stripe 문서는 새 연동에 비밀 키 대신 필요한 권한만 준 제한 키(`rk_...`)를 권한다. 이 문서는 학습을 위해 비밀 키를 쓴다. 제한 키로 바꾸려면 Checkout Sessions 쓰기 권한이 필요하다.

### 작업 3. [실행] Stripe CLI로 웹훅을 로컬까지 받기

Stripe CLI가 없으면 먼저 설치하고 로그인한다.

```sh
brew install stripe # 또는 npm install -g @stripe/cli
stripe login
```

`stripe login`은 페어링 코드를 보여 주고 브라우저로 대시보드를 연다. 대시보드에서 같은 코드인지 확인하고, CLI가 쓸 계정과 샌드박스를 고른다. **작업 2에서 비밀 키를 복사한 샌드박스를 고른다.**

로그인은 한 번만 하면 된다. CLI가 자격 증명을 저장하고 세션을 알아서 갱신한다. 지금 어디에 로그인돼 있는지는 `stripe login list`로 보고, 다른 샌드박스로 바꿀 때는 `stripe switch`를 쓴다.

> CLI v1.50.0보다 새 버전은 계정 관리자가 대시보드의 Settings → Team and security → MCP and CLI access에서 CLI 접근을 켜 두어야 로그인된다. 혼자 만든 계정이면 본인이 관리자다.

Stripe는 인터넷에서 우리 PC의 `localhost:4000`으로 직접 들어올 수 없다.

Stripe CLI의 `stripe listen`이 Stripe에서 이벤트를 받아 로컬 주소로 넘겨준다.

```sh
stripe listen --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
# Ready! You are using Stripe API Version [dahlia]. Your webhook signing secret is whsec_... (^C to quit)
```

여기 나오는 `whsec_...`가 `STRIPE_WEBHOOK_SECRET`이다. CLI가 로그인한 계정과 기기마다 정해진 값이라 다시 실행해도 같다.

작업 2에서 비워 둔 `STRIPE_WEBHOOK_SECRET`에 이 값을 넣는다. 서버가 켜져 있었다면 `.env.local`을 다시 읽도록 서버를 다시 켠다.

`stripe listen`은 켜 둔 동안에만 이벤트를 넘겨준다. 서버(`npm run start:dev`)와 다른 터미널 탭에 띄워 두고, Ctrl+C로 끈다.

- 켜 두어야 하는 때: 3단계부터, 브라우저나 `curl`로 결제를 끝내거나 세션을 만료시켜 웹훅이 오는 것을 볼 때다. 4~6단계, 8단계의 실제 결제 테스트(`stripe-payment.spec.ts`)가 그렇다.

- 꺼 두어도 되는 때: 2단계(아직 웹훅을 받는 곳이 없다), 백엔드 e2e(테스트가 직접 서명한 웹훅을 보낸다), 실제 결제를 하지 않는 프론트 e2e.

꺼져 있는 동안 생긴 이벤트는 다시 켜도 저절로 오지 않는다. 결제가 끝났는데 주문이 계속 결제 대기라면 `stripe events resend <evt_id>`로 그 이벤트를 다시 보내 달라고 한다(아래 "놓친 이벤트 다시 받기"). 다시 켜도 `whsec_...`는 같으므로 `.env.local`은 고칠 필요가 없다.

`--events`로 이 문서가 처리하는 두 종류만 받는다. 빼면 결제 하나에 `charge.succeeded`, `payment_intent.succeeded` 같은 이벤트가 여럿 함께 온다.

`API Version [dahlia]`는 계정의 기본 API 버전이다. 웹훅으로 오는 이벤트 본문의 모양은 이 버전을 따른다.

> SDK의 버전(`endive`)과 다를 수 있으므로, 웹훅에서는 오래 바뀌지 않은 칸(`id`, `type`, `payment_status`, `metadata`)만 쓴다.

### 용어 | Stripe CLI

- `stripe login`: 브라우저로 계정과 샌드박스를 골라 CLI를 로그인시킨다. `stripe login list`는 로그인한 곳을 보여 주고, `stripe switch`는 다른 샌드박스로 바꾼다.

- `stripe listen --forward-to <주소>`: Stripe에서 이벤트를 받아 로컬 주소로 넘긴다.

- `--events <종류,...>`: 넘겨받을 이벤트 종류를 고른다.

- `--print-secret`: 이벤트를 듣지 않고 웹훅 서명 비밀(`whsec_...`)만 출력한다.

- `--api-key <키>`: CLI의 로그인 상태 대신 이 Secret key의 계정으로 명령을 실행한다(아래 "겪은 문제").

- `stripe events list --limit <N>`: 최근 이벤트를 조회한다. 맨 위에 어느 계정에서 실행했는지 찍힌다.

- `stripe events resend <evt_id>`: 이미 생긴 이벤트를 다시 보내 달라고 한다. 같은 계정을 듣는 `stripe listen`이 켜져 있어야 그쪽으로 다시 온다.

### 개념 | 겪은 문제: 결제는 됐는데 웹훅이 안 온다

처음 확인할 때 테스트 카드 결제는 성공했는데 `stripe listen`에 아무것도 찍히지 않았다.

#### 양쪽 계정 비교

백엔드와 CLI 양쪽에서 최근 이벤트를 조회해 비교했다.

```sh
# 백엔드의 Secret key로(SDK)
# 계정: acct_1UMq...
# evt_1UN4ZIIMAl... checkout.session.completed

stripe events list --limit 4 # CLI로
# ▸ Running in <다른 프로젝트> · sandbox (acct_1UJj...)
```

원인은 **CLI가 다른 샌드박스에 로그인돼 있었다**는 것이다.

Stripe 계정 하나에 샌드박스(테스트 환경)가 여럿일 수 있다. CLI는 마지막으로 `stripe login`한 곳을 듣는다.

Secret key의 계정과 CLI의 계정이 다르면, 결제 이벤트는 다른 곳에서 생기고 CLI는 조용히 기다리기만 한다.

웹훅 비밀도 CLI 쪽 계정 것이라 서명도 맞지 않는다.

#### `--api-key`로 계정 맞추기

CLI의 로그인 상태를 바꾸지 않고 이 명령만 같은 계정을 쓰게 하려면 `--api-key`를 붙인다.

```sh
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret # 이 계정용 whsec_...를 STRIPE_WEBHOOK_SECRET에 넣는다
```

`$STRIPE_SECRET_KEY`는 셸 변수다. `.env.local`은 Nest가 읽는 파일이라 셸에는 따로 `export STRIPE_SECRET_KEY=sk_test_...`로 넣어 둔다.

`--api-key`를 붙여도 출력 맨 위의 `▸ Running in <이름> · sandbox (acct_...)` 줄은 바뀌지 않는다. 이 줄은 **CLI가 로그인한 샌드박스**를 알려 줄 뿐이고, `--api-key`를 붙인 명령의 요청은 그 키의 샌드박스로 간다. 줄에 다른 샌드박스 이름이 찍혀도 명령은 맞는 곳에서 실행된 것이다.

실제로 어느 샌드박스에서 실행됐는지는 돌려받은 id로 확인한다. 이벤트 id에는 계정 id의 끝부분이 들어 있다. `acct_1UMqEGIMAlkapI16`의 이벤트는 `evt_1UQWmF`**`IMAlkapI16`**`77K5is2B`처럼 가운데에 `IMAlkapI16`이 보인다. 확실히 하려면 위의 `curl https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:"`로 키의 계정을 직접 묻는다(5단계). 세션 본문의 `branding_settings.display_name`에도 그 샌드박스의 이름이 들어 있다.

매번 `--api-key`를 붙이기 번거로우면 CLI의 로그인 샌드박스를 이 문서의 샌드박스로 바꾼다. 그 뒤로는 `▸ Running in` 줄도 맞는 이름을 보여 주고, `--api-key` 없이 쳐도 같은 곳에서 실행된다.

```sh
stripe login list # CLI가 로그인한 계정과 샌드박스
stripe switch     # 다른 샌드박스로 바꾼다. 목록에 없으면 stripe reauth로 샌드박스를 더한다
```

샌드박스 이름은 대시보드에서 바꿔도 된다. 이름은 화면에 보이는 표시일 뿐이라 계정 id(`acct_...`)와 키는 그대로이고, `.env.local`도 고칠 것이 없다.

#### 놓친 이벤트 다시 받기

놓친 이벤트는 `stripe events resend`로 다시 보내 달라고 할 수 있다.

이게 4단계의 "같은 이벤트가 또 오는" 상황을 손으로 만드는 방법이기도 하다.

```sh
stripe events resend evt_1UN4ZIIMAlkapI16VYVBM2kD --api-key "$STRIPE_SECRET_KEY"
# --> checkout.session.completed [evt_1UN4ZIIMAlkapI16VYVBM2kD]
# <--  [200] POST http://localhost:4000/payments/webhook [evt_1UN4ZIIMAlkapI16VYVBM2kD]
```

### 개념 | 키, 샌드박스, CLI 로그인은 서로 다른 것이다

Stripe 계정 하나로 프로젝트 A와 B를 함께 개발하는 경우를 생각한다. 보통 프로젝트마다 샌드박스를 하나씩 둔다(샌드박스 A, 샌드박스 B).

이때 "어느 샌드박스를 쓰는가"를 정하는 것이 세 가지 있고, 서로 따로 움직인다.

| | 무엇인가 | 어디에 있나 | 누구에게 영향을 주나 |
|---|---|---|---|
| 샌드박스 | 데이터가 따로 있는 테스트 환경. A의 세션·이벤트·결제는 B에서 보이지 않는다 | Stripe 계정 안 | - |
| 비밀 키(`sk_test_...`) | 한 샌드박스에 속한 열쇠. 키를 보면 어느 샌드박스인지 정해진다 | 프로젝트의 `.env.local` | 그 프로젝트의 **백엔드** |
| CLI 로그인 | `stripe` 명령이 `--api-key` 없이 실행될 때 쓰는 샌드박스. 기본값일 뿐이다 | PC의 Stripe CLI 설정 하나 | 이 PC에서 치는 **모든 `stripe` 명령** |

그래서 이렇게 된다.

- A의 백엔드는 A의 키를, B의 백엔드는 B의 키를 쓴다. CLI 로그인을 무엇으로 바꿔도 백엔드는 영향을 받지 않는다.

- CLI 로그인은 프로젝트마다 따로 있지 않다. PC에 하나뿐이라 모든 터미널이 같은 값을 쓴다. B를 개발하다 A로 오면, CLI는 여전히 B를 가리키고 있다.

- `stripe listen`을 `--api-key` 없이 켜면 CLI 로그인 샌드박스를 듣는다. CLI가 B를 가리킨 채 A의 `stripe listen`을 켜면, A의 결제 이벤트는 A 샌드박스에서 생기고 CLI는 B를 듣는다. 이 장의 "겪은 문제"가 정확히 이것이다.

- `stripe switch`로 CLI 로그인을 바꾸면 그 뒤에 켜는 명령부터 적용된다. 이미 실행 중인 `stripe listen`은 켤 때의 샌드박스를 계속 듣는다.

맞추는 방법은 두 가지다.

1. **프로젝트를 옮길 때마다 `stripe switch`로 CLI 로그인을 바꾼다.** 명령이 짧아지고 `▸ Running in` 줄도 맞는 이름을 보여 준다. 대신 바꾸는 것을 잊으면 조용히 다른 샌드박스를 쓴다.

2. **`stripe` 명령마다 그 프로젝트의 키로 `--api-key`를 붙인다.** CLI 로그인이 무엇이든 키의 샌드박스로 간다. 명령은 길어지지만 프로젝트를 오가도 틀리지 않는다. 이 문서의 명령이 `--api-key`를 붙이는 이유다.

어느 쪽이든, 웹훅이 오지 않으면 "백엔드 키의 샌드박스"와 "`stripe listen`이 듣는 샌드박스"가 같은지부터 본다. 키의 샌드박스는 `curl https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:"`의 `id`로, CLI 로그인 샌드박스는 `stripe login list`로 확인한다.

### 남길 것

- **찾아보면 되는 것**: `stripe listen`의 `--forward-to`·`--events`·`--print-secret`·`--api-key`, `stripe events list`·`resend`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - Stripe는 인터넷에서 `localhost`로 들어올 수 없다. 개발 중의 웹훅은 `stripe listen`이 대신 받아 넘겨 주는 것이고, `stripe listen`이 듣는 샌드박스와 백엔드 키의 샌드박스가 같아야 이벤트가 온다. 백엔드의 샌드박스는 키가, `stripe` 명령의 샌드박스는 PC에 하나뿐인 CLI 로그인(또는 `--api-key`)이 정하므로 프로젝트를 오가면 둘이 쉽게 엇갈린다.
  
  - 웹훅 서명 비밀(`whsec_...`)은 "누가 웹훅을 받는가"마다 다르다. CLI로 받을 때는 CLI가 알려 준 값을 쓴다.

- **에러 신호**:
  - 결제는 성공했는데 `stripe listen`에 아무것도 안 온다 → `stripe listen`이 듣는 샌드박스(`--api-key`가 없으면 `stripe login list`의 것)와 Secret key의 계정(`curl https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:"`의 `id`)이 같은지. `▸ Running in ...` 줄은 CLI 로그인만 보여 준다

## 2. 1단계: 스키마

주문에는 "어느 Stripe 세션의 주문인가"와 "언제 취소됐나"를 적고, 처리한 웹훅 이벤트를 적을 표를 따로 둔다.

### 작업 1. [커밋] Order에 두 칸, StripeEvent 표 추가

```prisma
// prisma/schema.prisma
// Order 모델에 두 칸을 더하고, 맨 아래에 StripeEvent 모델을 새로 만든다
model Order {
  // ... 기존 필드 그대로 ...
  createdAt DateTime    @default(now()) @map("created_at")
  // 이 주문의 Stripe Checkout 세션. 웹훅이 오면 이 값으로 주문을 찾는다
  stripeSessionId String?   @unique @map("stripe_session_id")
  // 결제하지 않고 세션이 만료돼 취소된 시각. 취소되면 예약했던 재고를 되돌린다
  canceledAt      DateTime? @map("canceled_at")
  items     OrderItem[]

  @@index([userId])
  @@map("orders")
}

// 처리한 Stripe 웹훅 이벤트. Stripe는 같은 이벤트를 두 번 이상 보낼 수 있다 → id(PK)로 한 번만 처리한다
model StripeEvent {
  id          String   @id // evt_...
  type        String
  processedAt DateTime @default(now()) @map("processed_at")

  @@map("stripe_events")
}
```

```sh
npx prisma migrate dev --name stripe-checkout
npx prisma generate
```

Prisma 7의 `migrate dev`는 클라이언트를 다시 만들어 주지 않는다. `generate`를 빠뜨리면 다음 단계에서 `tx.stripeEvent`, `stripeSessionId`가 없다는 타입 에러가 난다.

`migrate dev`가 바꾸는 것은 개발 DB(`order_api`) 하나뿐이다. e2e 테스트가 쓰는 테스트 DB(`order_api_test`)에는 같은 마이그레이션을 따로 적용한다.

```sh
# 테스트 DB에 아직 적용하지 않은 마이그레이션을 적용한다
ADMIN_DATABASE_URL=$(grep '^TEST_ADMIN_DATABASE_URL=' .env | cut -d= -f2-) npx prisma migrate deploy
```

`prisma7.config.ts`는 `ADMIN_DATABASE_URL`이 가리키는 DB에 마이그레이션한다. `.env`를 읽을 때 이미 셸에 있는 값은 덮어쓰지 않으므로, 이 명령에서만 테스트 DB의 주소로 바꿔 넣는 것이다. `deploy`는 `dev`와 달리 새 마이그레이션을 만들지 않고, 아직 적용하지 않은 것만 적용한다.

빠뜨리면 지금은 아무 일도 없다가 8단계의 `npm run test:e2e`에서 테스트가 무더기로 실패한다(8단계 "남길 것").

만들어진 SQL은 이렇다.

```sql
-- prisma/migrations/20261005070000_stripe_checkout/migration.sql
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "canceled_at" TIMESTAMP(3),
ADD COLUMN     "stripe_session_id" TEXT;

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_session_id_key" ON "orders"("stripe_session_id");
```

두 칸 모두 NULL을 허용하므로, 이미 있는 주문 행에 값을 채울 필요 없이 마이그레이션이 바로 통과한다.

### 용어 | Prisma 스키마 문법 (NULL 허용·unique)

- `String?`, `DateTime?`: 비어 있을 수 있는(NULL 허용) 칸이다. 결제 세션이 생기기 전의 주문, 취소되지 않은 주문은 값이 없다.

- `@unique`: 이 칸의 값이 테이블 안에서 겹치지 않게 한다. 세션 id 하나로 주문 하나를 찾을 수 있다. `String?`과 함께 쓸 때 NULL이 어떻게 되는지는 아래 "NULL 허용 칸의 `@unique`"에서 다룬다.

- `@id`(문자열): `StripeEvent`의 기본키는 자동 증가 번호가 아니라 Stripe가 붙인 이벤트 id(`evt_...`)다. 같은 이벤트를 두 번 넣으면 기본키가 막는다.

### 개념 | NULL 허용 칸의 `@unique`

`stripeSessionId`는 `String?`이면서 `@unique`다.

그런데 세션이 아직 없는 주문, `02`~`13`에서 만든 예전 주문은 전부 이 칸이 NULL이다.

"겹치면 안 된다"는 규칙이 NULL 여러 개를 막지 않을까 싶지만, 막지 않는다.

`@unique`는 위 SQL의 `CREATE UNIQUE INDEX`가 된다.

PostgreSQL의 UNIQUE는 NULL을 "모르는 값"으로 보고 **NULL끼리는 서로 같다고 치지 않는다.** 그래서 NULL은 몇 개든 들어가고, 실제 값만 겹치지 않게 막는다.

```sql
INSERT INTO orders (stripe_session_id) VALUES (NULL), (NULL), ('cs_test_a'); -- 통과: NULL 두 개는 겹친 것이 아니다
INSERT INTO orders (stripe_session_id) VALUES ('cs_test_a');
-- ERROR:  duplicate key value violates unique constraint "orders_stripe_session_id_key"
-- DETAIL:  Key (stripe_session_id)=(cs_test_a) already exists.
```

| 넣는 값 | 이미 있는 값 | 결과 |
|---|---|---|
| NULL | NULL | 통과 |
| `cs_test_a` | NULL | 통과 |
| `cs_test_a` | `cs_test_a` | 거절(겹침) |

- 그래서 "세션이 붙은 주문만 하나씩"이라는 이 문서의 의도를 칸 하나로 표현할 수 있다.

- `@unique` 칸은 Prisma에서 `findUnique({ where: { stripeSessionId } })`로 찾을 수 있다. 3단계의 웹훅이 주문을 찾는 방법이다. 인덱스가 있으니 주문이 많아도 한 번에 찾는다.

> C에서는 `NULL == NULL`이 참이지만, SQL에서 `NULL = NULL`은 참이 아니라 NULL(모름)이다. UNIQUE가 NULL 여러 개를 받아 주는 것도 이 규칙에서 나온다.

### 개념 | 새 표에 권한과 RLS를 따로 주지 않아도 되는 이유

`10`부터 앱은 소유자가 아닌 `order_app` 역할로 DB에 붙는다. 새로 만든 `stripe_events`에 `GRANT`를 따로 적지 않았는데도 앱이 쓸 수 있다.

`10`의 `app_role` 마이그레이션이 `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO order_app`을 해 두었기 때문이다.

이 설정은 그 뒤에 소유자가 만드는 표에 같은 권한을 자동으로 준다. 마이그레이션은 소유자 연결(`ADMIN_DATABASE_URL`)로 돌기 때문에 이 조건에 맞는다.

`stripe_events`에는 RLS를 켜지 않았다. 사용자의 데이터가 아니라 "이 이벤트를 처리했다"는 시스템의 기록이기 때문이다.

반면 `orders`의 새 두 칸은 원래 있던 `orders_owner` 정책을 그대로 받는다. 그래서 웹훅이 주문을 찾을 때는 `asAdmin`으로 들어가야 한다(3단계).

### 남길 것

- **찾아보면 되는 것**: `String?`, `@unique`, `@id`의 문법, 마이그레이션 SQL의 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - "외부 시스템의 id로 우리 행을 찾는다"면 그 칸에 `@unique`를 건다. NULL 허용이어도 PostgreSQL은 NULL끼리 겹친다고 보지 않으므로, 값이 있는 행만 하나씩으로 막힌다.
  - 처리한 이벤트를 따로 표에 적고 그 id를 기본키로 두면, "두 번 처리"를 DB의 제약이 막아 준다(`02`의 `idempotency_keys`와 같은 생각).

- **에러 신호**:
  - `npx prisma migrate dev` 뒤에 `Property 'stripeEvent' does not exist on type ...` 같은 타입 에러 → `npx prisma generate`를 돌렸는지

## 3. 2단계: 결제 세션 만들기

### 작업 1. [커밋] Stripe를 부르는 곳을 한 클래스에

```ts
// src/payments/stripe.gateway.ts
import { Injectable } from "@nestjs/common";
import Stripe from "stripe";

export type CheckoutSession = { id: string; url: string };

// Stripe를 부르는 곳을 이 클래스 하나에 모은다. 테스트는 이 클래스를 테스트용으로 바꿔 끼운다(8단계)
@Injectable()
export class StripeGateway {
  private client?: Stripe;

  // 키가 필요한 순간에 만든다. 결제를 쓰지 않는 테스트와 스크립트는 키 없이도 앱이 뜬다
  private get stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY 환경변수가 없습니다");
    return (this.client ??= new Stripe(key));
  }

  // 결제 화면을 하나 만든다. 금액은 브라우저가 아니라 DB의 주문에서 온다
  // attemptKey: 이 결제 시도를 가리키는 값(orders.service.ts가 만든다). 없으면 Stripe 멱등 키를 쓰지 않는다
  async createCheckoutSession(order: { id: number; price: number }, attemptKey?: string): Promise<CheckoutSession> {
    const frontend = process.env.FRONTEND_URL!;
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: "krw", unit_amount: order.price, product_data: { name: `주문 #${order.id}` } } }],
        client_reference_id: String(order.id),
        metadata: { orderId: String(order.id) },
        // 여기로 돌아왔다고 결제가 끝난 것은 아니다(0장 개념 2)
        success_url: `${frontend}/me/orders/${order.id}?checkout=success`,
        cancel_url: `${frontend}/shop?checkout=canceled`,
      },
      // 키는 Stripe 계정 전체에서 유일해야 한다. 주문 번호(DB마다 1부터)로 만들면 다른 DB의 주문과 부딪힌다(이 단계의 실험)
      attemptKey ? { idempotencyKey: `checkout-${attemptKey}` } : undefined,
    );
    return { id: session.id, url: session.url! };
  }

  // 웹훅 본문이 정말 Stripe가 보낸 것인지 서명(Stripe-Signature 헤더)으로 확인한다
  // 서명은 "받은 바이트 그대로"에 대해 계산된다. 파싱했다 다시 만든 JSON으로는 검증할 수 없다(3단계)
  constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET 환경변수가 없습니다");
    return Stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
  }
}
```

`private get stripe()`는 게터(getter)다. `this.stripe`라고 필드처럼 읽을 때마다 이 함수가 불린다.

`??=`는 "왼쪽이 비어 있을 때만 오른쪽을 넣는다"는 연산자라서, `new Stripe(key)`는 처음 한 번만 실행되고 그 뒤로는 만들어 둔 것을 돌려준다.

생성자에서 바로 만들지 않는 이유는 `StripeGateway`가 앱이 켜질 때 Nest에 의해 만들어지기 때문이다. 생성자에서 키를 요구하면, 결제와 상관없는 테스트도 키가 없다는 이유로 앱이 뜨지 않는다.

### 용어 | Stripe API (세션 만들기·서명 검증)

- `stripe.checkout.sessions.create(params, options)`: Checkout 세션(결제 화면)을 만든다. 돌려받은 `session.url`로 브라우저를 보낸다.

- `mode: "payment"`: 한 번 결제하는 세션이다(구독이 아니다).

- `line_items[].price_data`: 미리 등록한 상품 없이 그 자리에서 통화(`currency`), 금액(`unit_amount`), 이름(`product_data.name`)을 정한다.

- `client_reference_id`, `metadata`: 세션에 붙여 두는 우리 쪽 표시다. 웹훅 이벤트에 그대로 실려 온다.

- `success_url`, `cancel_url`: 결제를 마치거나 취소했을 때 브라우저를 돌려보낼 주소다.

- `{ idempotencyKey }`(두 번째 인자): Stripe의 멱등 키다. 같은 키로 다시 부르면 세션을 새로 만들지 않고 처음 것을 돌려준다. 왜 두 겹으로 두는지는 아래 "멱등이 두 겹이다", 키를 무엇으로 만드는지는 이 단계의 실험에서 다룬다.

- `Stripe.webhooks.constructEvent(본문, 서명, 비밀)`: 서명을 검증하고 이벤트 객체를 돌려준다. 서명이 틀리면 예외를 던진다. 무엇을 어떻게 검증하는지는 아래 "웹훅 서명 검증이 하는 일"에서 다룬다.

### 개념 | 웹훅 서명 검증이 하는 일

0장 개념 2에서 웹훅 서명을 "메시지 뒤에 HMAC을 붙여 보내는 것"이라고 했다. Stripe가 보내는 `Stripe-Signature` 헤더는 이렇게 생겼다.

```text
t=1760000000,v1=581931135b9af93d8f0d99772be022597ea9bebe17266864d2cb6606a5ef1b21
```

- `t`: Stripe가 서명한 시각(유닉스 초)

- `v1`: `"<t>.<받은 본문 바이트>"`를 웹훅 비밀(`whsec_...`)로 HMAC-SHA256한 값(16진수)

#### 직접 계산해 보기

`constructEvent`는 같은 계산을 우리 쪽에서 다시 해 보고 `v1`과 비교한다. 직접 계산해도 같은 값이 나온다.

```js
import Stripe from "stripe";
import { createHmac } from "node:crypto";

const secret = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed" }, null, 2);
const header = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1760000000 });
const [t, v1] = header.split(",").map((p) => p.split("=")[1]);
console.log(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex") === v1); // 출력: true
```

#### 검증이 실패하는 경우

검증이 실패하는 경우는 둘이다. 둘 다 `StripeSignatureVerificationError`를 던지고, 3단계의 컨트롤러가 400으로 바꾼다.

| 경우 | 에러 메시지 |
|---|---|
| 본문 바이트나 비밀이 다르다 | `No signatures found matching the expected signature for payload. ...` |
| `t`가 지금보다 5분(300초) 넘게 지났다 | `Timestamp outside the tolerance zone` |

- 시각까지 서명에 넣는 이유: 누가 예전 웹훅 요청을 통째로 녹화해 두었다가 다시 보내도(재전송 공격), 5분이 지나면 받지 않는다.

- 비밀을 모르면 `v1`을 만들 수 없으므로, 서명이 맞으면 "Stripe가 보냈고 본문이 바뀌지 않았다"가 증명된다. 본문을 한 바이트라도 바꾸면 값이 달라진다(3단계 실험 ①에서 직접 깨뜨린다).

- `stripe events resend`로 다시 보낸 이벤트는 그 순간 새로 서명되어 오므로 5분 제한에 걸리지 않는다.

> 서명은 "누가 보냈는가"만 증명한다. 같은 이벤트가 두 번 오는 것(0장 개념 3)은 서명으로 막을 수 없어서 4단계에서 따로 막는다.

### 개념 | 짚어 둘 것: 금액과 통화

- 금액은 DB의 주문에서 온다(`order.price`). 브라우저가 보낸 금액을 쓰면 브라우저에서 금액을 바꿔 결제할 수 있다. `02`에서 가격을 DB에서 읽은 것과 같은 이유다.

- 원화는 소수점이 없는 통화다. 달러는 `unit_amount: 1000`이 10달러(센트 단위)지만, 원화는 1000원이다.

- 품목을 하나하나 Stripe에 넘기지 않고 "주문 #N" 한 줄로 넘긴다. 품목과 단가는 이미 우리 DB의 `order_items`에 있고, Stripe에는 받을 금액만 정확하면 된다.

- Stripe에도 멱등 키를 준다. 무엇으로 만드는지가 이 단계 실험의 주제다.

### 작업 2. [커밋] 결제 취소 함수와 PaymentsModule 먼저 만들기

다음 작업의 `OrdersService`는 세션을 못 만들면 주문을 취소하고 재고를 되돌린다. 그 함수와, `StripeGateway`를 내보낼 모듈을 먼저 만든다.

취소 함수는 3단계의 만료 웹훅도 그대로 쓴다.

```ts
// src/payments/cancel-unpaid-order.ts
import type { Prisma } from "../generated/prisma/client.js";

// 결제되지 않은 주문을 취소하고 예약했던 재고를 되돌린다. 취소했으면 true
// 쓰는 곳: 세션 만료 웹훅(payments.service.ts), 결제 세션을 못 만들었을 때의 보상(orders.service.ts)
// 조건부 UPDATE라 두 번 불려도 재고는 한 번만 돌아온다
export async function cancelUnpaidOrder(tx: Prisma.TransactionClient, orderId: number): Promise<boolean> {
  const { count } = await tx.order.updateMany({ where: { id: orderId, paid: false, canceledAt: null }, data: { canceledAt: new Date() } });
  if (count === 0) return false;
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  return true;
}
```

`tx`를 매개변수로 받는 이유는 부르는 쪽의 트랜잭션 안에서 돌기 위해서다. 웹훅은 "이벤트 기록 + 취소"를, 보상은 "취소 + `Idempotency-Key` 기록 삭제"를 한 트랜잭션으로 묶는다.

아래 `payments.module.ts`는 실제 저장소의 커밋에는 없는 중간 모양이다. 3단계에서 완성본으로 바꾼다.

```ts
// src/payments/payments.module.ts
// 지금은 StripeGateway만 담는다. 컨트롤러와 PaymentsService는 3단계에서 더한다
import { Module } from "@nestjs/common";
import { StripeGateway } from "./stripe.gateway.js";

@Module({
  providers: [StripeGateway],
  exports: [StripeGateway], // OrdersService가 결제 세션을 만들 때 쓴다
})
export class PaymentsModule {}
```

`exports`에 적어야 이 모듈을 `imports`한 다른 모듈(`OrdersModule`)이 `StripeGateway`를 주입받을 수 있다.

### 작업 3. [커밋] 결제 버튼의 일: checkout을 둘로 나누기

기존 `checkout`(재고 예약 + 주문 저장 + outbox, `02`·`05`)은 이름을 `placeOrReplay`로 바꿔 `private`으로 감추고, 앞에 새 `checkout`을 둔다.

새 `checkout`은 `placeOrReplay`로 주문을 만든 뒤 Stripe 세션을 붙인다.

#### import와 생성자

```ts
// src/orders/orders.service.ts
// import 두 줄, 응답 타입 하나, 생성자의 StripeGateway를 더한다
import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { CheckoutItemDto } from "./dto/checkout.dto.js";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js"; // 추가
import { StripeGateway } from "../payments/stripe.gateway.js"; // 추가
import { PrismaService } from "../prisma/prisma.service.js";

// ... Order, orderSelect, CheckoutResult 그대로 ...
// 결제 화면(Stripe Checkout) 주소를 함께 돌려준다
export type CheckoutResponse = CheckoutResult & { checkoutUrl: string };

// ... toOrder 그대로 ...

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly stripe: StripeGateway, // 추가
  ) {}
```

#### 새 checkout

```ts
// src/orders/orders.service.ts
// 기존 checkout의 이름을 placeOrReplay로 바꾸고(private), 앞에 새 checkout을 둔다
  // 주문(결제 대기)을 만들고 Stripe 결제 화면 주소를 돌려준다. "결제 완료"는 웹훅이 정한다(payments/)
  async checkout(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResponse> {
    const placed = await this.placeOrReplay(userId, items, idempotencyKey);
    // 결제 세션은 트랜잭션이 끝난 뒤에 만든다(재고 행의 잠금을 쥐고 Stripe를 기다리지 않게)
    // Stripe 멱등 키의 재료: 사용자 + Idempotency-Key + 주문 번호를 해시한 값(이 단계의 실험)
    const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");
    try {
      const session = await this.stripe.createCheckoutSession(placed, attemptKey);
      // 취소되지 않은 주문에만 세션을 붙인다. 같은 키의 다른 요청이 그사이 이 주문을 보상으로 취소했을 수 있다
      const { count } = await this.prisma.asUser(userId, (tx) =>
        tx.order.updateMany({ where: { id: placed.id, canceledAt: null }, data: { stripeSessionId: session.id } }),
      );
      if (count === 0) throw new ConflictException("결제 시도가 취소됐습니다 - 다시 결제합니다");
      return { ...placed, checkoutUrl: session.url };
    } catch (err) {
      // 보상: 세션 없는 주문을 취소하고 재고를 되돌린 뒤, Idempotency-Key 기록도 지운다
      await this.prisma.asUser(userId, async (tx) => {
        await cancelUnpaidOrder(tx, placed.id);
        if (idempotencyKey) await tx.idempotencyKey.deleteMany({ where: { userId, key: idempotencyKey } });
      });
      this.logger.warn(`결제 세션 생성 실패 → 주문 #${placed.id} 취소, 재고 복구: ${(err as Error).message}`);
      throw err;
    }
  }

  // 앞에서 만든 결제 본체: Idempotency-Key 기록 + 재고 예약 + 주문 저장 + outbox. 같은 키로 다시 오면 처음 응답을 돌려준다
  private async placeOrReplay(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResult> {
    // ... 본문은 기존 checkout 그대로 ...
```

#### placeOrReplay 안에서 바꿀 두 줄

`placeOrReplay` 안의 로그 문구와, `placeOrder`가 주문을 만들 때의 `paid`를 바꾼다.

```ts
// src/orders/orders.service.ts
// placeOrReplay의 트랜잭션이 끝난 뒤의 로그
      this.logger.log(`주문 접수(결제 대기): #${result.id} (${result.user}) ${result.price}원`);
```

```ts
// src/orders/orders.service.ts
// placeOrder의 tx.order.create 안
        userId, price: total, paid: false, // 결제는 Stripe 웹훅이 확인한 뒤에 true가 된다
```

#### OrdersModule에 PaymentsModule 가져오기

```ts
// src/orders/orders.module.ts
// import 한 줄과 imports 배열의 PaymentsModule을 더한다
import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

@Module({
  imports: [NotificationsModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
```

`PaymentsModule`은 `PrismaModule`처럼 `@Global()`이 아니다. 쓰는 쪽 모듈의 `imports`에 적지 않으면 서버가 뜨기 전에 `Nest can't resolve dependencies of the OrdersService (PrismaService, NotificationsGateway, ?)`로 멈춘다.

컨트롤러(`OrdersController`)는 고칠 것이 없다. 이미 `this.ordersService.checkout(...)`의 반환값을 그대로 응답하므로, `checkoutUrl`이 붙은 객체가 그대로 나간다.

### 개념 | checkout이 이렇게 생긴 이유

#### 세션을 못 만들면 되돌린다

주문 트랜잭션은 이미 커밋됐는데 Stripe 호출(또는 세션 id 저장)이 실패하면, 그 주문은 세션 없는 결제 대기로 남는다.

세션이 없으니 만료 웹훅도 오지 않아 예약한 재고가 영영 묶인다.

그래서 `catch`에서 만료 웹훅과 같은 함수(`cancelUnpaidOrder`)로 취소하고 재고를 되돌린 뒤 에러를 그대로 던진다.

같은 `Idempotency-Key` 기록도 지워, 사용자가 다시 누르면 취소된 주문을 재응답하지 않고 새 주문으로 시작한다.

새 주문에는 새 세션이 필요하므로 Stripe 멱등 키에 주문 번호도 넣는다(이 단계의 실험).

이렇게 "이미 커밋한 일을 반대 동작으로 되돌리는 것"을 보상(compensation)이라고 한다. DB 트랜잭션과 Stripe 호출은 한 트랜잭션으로 묶을 수 없으므로(`02`의 outbox와 같은 사정), 롤백 대신 보상을 쓴다.

#### 왜 트랜잭션 밖에서 세션을 만드나

`placeOrReplay`의 트랜잭션은 `FOR UPDATE`로 상품 행을 잠근다.

그 안에서 Stripe를 부르면 Stripe가 응답할 때까지(보통 수백 ms) 같은 상품을 사려는 다른 결제가 모두 기다린다.

> `08`에서 잰 것처럼, 잠금을 쥔 시간이 곧 처리량의 한계다.

게다가 Prisma의 대화형 트랜잭션에는 기본 5초 상한이 있다. Stripe가 느리면 주문 트랜잭션 자체가 상한을 넘겨 롤백된다.

#### 멱등이 두 겹이다

사용자가 응답을 못 받고 결제를 다시 누르면(`05`의 상황) 같은 `Idempotency-Key`로 요청이 온다.

1. 우리 쪽: `placeOrReplay`가 새 주문을 만들지 않고 처음 주문을 돌려준다(`02`)

2. Stripe 쪽: 같은 결제 시도면 같은 멱등 키가 되어, Stripe가 세션을 새로 만들지 않고 처음 세션을 돌려준다

둘 중 하나라도 없으면 주문 하나에 결제 화면이 둘 생긴다. 사용자가 두 화면에서 각각 결제하면 **한 주문에 돈이 두 번** 나간다.

### 작업 4. [확인] 같은 키로 두 번 결제해 보기

`npm run start:dev`로 서버를 켜고, 로그인해 받은 액세스 토큰을 `TOKEN`에 담아 둔다. 시드의 사용자(`kim`)와 `.env`의 `DEMO_PASSWORD`(`1234`)로 로그인한다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
echo $TOKEN # eyJ... 로 시작하는 값이 보여야 한다
```

`TOKEN`은 그 터미널에만 있는 셸 변수다. 새 터미널 탭을 열었으면 다시 담는다. 액세스 토큰은 15분(`ACCESS_TOKEN_TTL`)이 지나면 만료되므로, 중간에 시간이 지났어도 다시 담는다.

`TOKEN`이 비었거나 만료됐으면 결제 요청은 `{"message":"Unauthorized","statusCode":401}`로 끝난다. 결제 버튼(`POST /orders/checkout`)은 로그인한 사용자만 부를 수 있기 때문이다.

```sh
curl -s -X POST localhost:4000/orders/checkout -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-21-a' -d '{"items":[{"productId":2,"quantity":1}]}'
# {"id":6,"price":30000,"paid":false, ..., "checkoutUrl":"https://checkout.stripe.com/c/pay/cs_test_a12zbBQA7Uordrm..."}


# 같은 명령을 같은 키(demo-21-a)로 한 번 더
# {"id":6,"paid":false, ..., "price":30000,"checkoutUrl":"https://checkout.stripe.com/c/pay/cs_test_a12zbBQA7Uordrm..."}
```

두 응답에서 비교할 것은 `paid`가 아니라 **`id`와 `checkoutUrl`**이다. 둘 다 처음과 같으면 성공이다. 같은 결제 시도를 다시 보내도 새 주문이 생기지 않았고(우리 쪽 멱등), Stripe도 새 결제 화면을 만들지 않고 처음 세션을 돌려줬다(Stripe 쪽 멱등, 위 "멱등이 두 겹이다").

`paid`는 몇 번을 다시 보내도 `false`가 맞다. 이 요청은 주문을 결제 대기로 만들고 결제 화면 주소를 주는 것까지만 한다. `true`로 바꾸는 것은 결제가 끝난 뒤 Stripe가 보내는 웹훅이다(3단계).

두 번째 응답은 칸의 순서가 처음과 다를 수 있다. 처음 응답을 DB(`idempotency_keys.response`, `jsonb`)에 저장했다가 돌려준 것이라, PostgreSQL이 정한 순서로 나온다. 값은 같다.

`checkoutUrl`을 브라우저로 열면 Stripe의 결제 화면이 나온다. 왼쪽에 "주문 #6 ₩30,000", 오른쪽에 이메일과 결제 방식(카드, 간편결제 등)이 있다.

> 테스트 모드라 실제 돈은 나가지 않는다. 테스트 카드 번호 `4242 4242 4242 4242`, 만료일은 미래의 아무 날짜, CVC는 아무 세 자리로 결제할 수 있다.

아직 웹훅을 받는 곳이 없으므로, 여기서 결제해도 주문은 결제 대기로 남는다. 3단계에서 받는다.

### 실험 | 일부러 깨뜨려보기: 주문 번호로 멱등 키를 만들면

처음에는 Stripe 멱등 키를 `checkout-order-<주문 번호>`로 만들었다. "주문 하나에 세션 하나"를 그대로 옮긴 것이라 자연스러워 보인다.

이 문제는 나중에 새 DB로 같은 Stripe 테스트 계정을 쓸 때 드러났다. 결제를 누르자 500이 났고 API 로그는 이랬다.

```text
StripeIdempotencyError: Keys for idempotent requests can only be used with the same parameters they were first used with.
Try using a key other than 'checkout-order-7' if you meant to execute a different request.
```

주문 번호는 DB마다 1부터 다시 센다. 그런데 **Stripe 멱등 키는 Stripe 계정 전체에서 하나다**(24시간 보관).

이 문서의 DB에서 만든 "주문 #7"(키보드 2개)의 키가 Stripe에 남아 있는데, 새 DB의 "주문 #7"(다른 금액)이 같은 키로 세션을 요청했다.

개발 DB, 테스트 DB, CI, 다른 개발자가 같은 테스트 계정을 쓰면 반드시 겪는다. 운영에서도 DB를 다시 만들거나 다른 서비스가 같은 계정을 쓰면 마찬가지다.

#### 고치기

키를 "이 결제 시도"를 가리키는 값으로 만든다.

`05`에서 프론트가 결제 시도마다 만드는 `Idempotency-Key`(UUID)가 바로 그 값이다. 사용자 id, 주문 번호와 합쳐 해시한다.

```ts
// src/orders/orders.service.ts
// checkout 안
    const attemptKey = idempotencyKey && createHash("sha256").update(`${userId}:${idempotencyKey}:${placed.id}`).digest("hex");
    const session = await this.stripe.createCheckoutSession(placed, attemptKey);
```

```ts
// src/payments/stripe.gateway.ts
// createCheckoutSession(order, attemptKey?)의 두 번째 인자
      attemptKey ? { idempotencyKey: `checkout-${attemptKey}` } : undefined,
```

- 같은 결제 시도(같은 Idempotency-Key)로 다시 오면 같은 키, 그래서 같은 세션이다("멱등이 두 겹이다"의 성질은 그대로다).

- UUID라서 다른 DB·환경의 주문과 겹치지 않는다(주문 번호는 UUID와 함께 들어가므로 겹치지 않는다).

- 주문 번호를 함께 넣는 이유: 세션 생성이 실패해 보상으로 주문을 취소하면, 같은 Idempotency-Key의 재시도는 새 주문이 된다. 키가 같으면 Stripe가 "처음 요청과 내용이 다르다"며 거절한다.

- 해시하는 이유: 헤더 값은 클라이언트가 마음대로 보낸다. 길이(Stripe 키는 최대 255자)와 내용을 고정된 모양으로 바꾼다.

- 키 없이 온 요청은 Stripe 멱등 키도 쓰지 않는다. 키 없는 요청은 다시 보내면 어차피 새 주문이 된다.

이 문서의 코드(작업 1, 작업 3)는 고친 뒤의 것이다.

> 이 실수는 Mock Stripe를 쓰는 테스트로는 잡히지 않는다. 실제 Stripe 계정을 여러 환경이 함께 쓸 때만 드러난다.

### 남길 것

- **찾아보면 되는 것**: `checkout.sessions.create`의 인자 이름(`line_items`, `price_data`, `success_url`...), 두 번째 인자 `{ idempotencyKey }`의 위치. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 금액은 언제나 서버의 DB에서 정한다. 외부 결제를 부르는 일은 잠금을 쥔 트랜잭션 밖에서 하고, 실패하면 이미 커밋한 일을 보상으로 되돌린다.
  
  - 멱등 키는 "그 키를 보관하는 쪽"의 범위에서 유일해야 한다. Stripe 멱등 키는 Stripe 계정 전체가 범위라서, DB마다 다시 세는 주문 번호만으로는 겹친다.

- **에러 신호**:
  
  - 결제 버튼이 500, Nest 로그에 `STRIPE_SECRET_KEY 환경변수가 없습니다`와 `결제 세션 생성 실패 → 주문 #N 취소, 재고 복구` → 백엔드 `.env.local`에 키가 있는지, 서버를 다시 켰는지
  
  - `curl` 결제 요청이 `{"message":"Unauthorized","statusCode":401}` → `echo $TOKEN`이 비었거나 15분이 지났다. 작업 4의 로그인 명령으로 다시 담는다
  
  - `Nest can't resolve dependencies of the OrdersService (PrismaService, NotificationsGateway, ?)` → `orders.module.ts`의 `imports`에 `PaymentsModule`이 있는지, `PaymentsModule`의 `exports`에 `StripeGateway`가 있는지
  
  - `StripeIdempotencyError: Keys for idempotent requests can only be used with the same parameters ...` → 멱등 키를 주문 번호처럼 DB마다 겹치는 값으로 만들지 않았는지
  
  - 409 `결제 시도가 취소됐습니다 - 다시 결제합니다` → 같은 키의 다른 요청이 보상으로 이 주문을 취소했다. 다시 결제하면 새 주문이 된다

## 4. 3단계: 웹훅 받기

### 작업 1. [커밋] 받은 바이트를 그대로 남겨 두기

```ts
// src/main.ts
// NestFactory.create의 옵션에 rawBody: true를 더한다
  // 웹훅 서명 검증에 쓸 원래 바이트를 남겨 둔다
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
```

Nest는 JSON 요청 본문을 파싱해 `req.body`(객체)로 만들고 원래 바이트는 버린다.

서명은 **Stripe가 보낸 바이트 그대로**에 대해 계산된 것이라, 원래 바이트가 필요하다.

`rawBody: true`면 파싱 전의 본문을 `req.rawBody`(Buffer)에 남겨 준다. `req.body`도 그대로 쓸 수 있다.

### 작업 2. [커밋] 웹훅 컨트롤러와 처리

#### 컨트롤러

```ts
// src/payments/payments.controller.ts
import { BadRequestException, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { PaymentsService } from "./payments.service.js";
import { StripeGateway } from "./stripe.gateway.js";

@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly stripe: StripeGateway,
    private readonly payments: PaymentsService,
  ) {}

  // Stripe가 결제 결과를 알려 주는 곳(웹훅). 로그인 Guard 대신 서명으로 "Stripe가 보낸 것"을 확인한다
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    let event: Stripe.Event;
    try {
      // req.body(파싱된 객체)가 아니라 req.rawBody(받은 바이트 그대로)로 검증한다
      event = this.stripe.constructWebhookEvent(req.rawBody!, signature);
    } catch (err) {
      throw new BadRequestException(`웹훅 서명 검증 실패: ${(err as Error).message}`);
    }
    // 200을 돌려줘야 Stripe가 "전달 성공"으로 본다. 500이면 Stripe가 나중에 다시 보낸다
    return { received: true, result: await this.payments.handle(event) };
  }
}
```

#### 서비스

```ts
// src/payments/payments.service.ts
import { Injectable, Logger } from "@nestjs/common";
import type Stripe from "stripe";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cancelUnpaidOrder } from "./cancel-unpaid-order.js";

export type WebhookResult = "processed" | "duplicate" | "ignored";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 같은 이벤트가 몇 번 와도 결과는 한 번 처리한 것과 같아야 한다("최소 한 번", 0장 개념 3)
  async handle(event: Stripe.Event): Promise<WebhookResult> {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return "ignored";
    const session = event.data.object;

    try {
      // 웹훅은 어떤 사용자의 요청도 아니다. 시스템으로서(asAdmin) 처리한다
      const result = await this.prisma.asAdmin(async (tx): Promise<WebhookResult> => {
        // 주문은 metadata의 번호가 아니라 우리가 저장해 둔 세션 id로 찾는다(아래 "주문은 세션 id로 찾는다")
        const order = await tx.order.findUnique({ where: { stripeSessionId: session.id }, select: { id: true, userId: true } });
        if (!order) return "ignored";

        // ① 이벤트 id를 먼저 기록한다. 이미 있으면 PK 위반(P2002)으로 트랜잭션 전체가 취소된다
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });

        if (event.type === "checkout.session.completed") {
          if (session.payment_status !== "paid") return "ignored"; // 나중에 확정되는 결제 수단은 이 문서에서 다루지 않는다
          // ② 아직 결제 전이고 취소되지 않은 주문만 바꾼다(조건부 UPDATE)
          const { count } = await tx.order.updateMany({ where: { id: order.id, paid: false, canceledAt: null }, data: { paid: true } });
          // ③ 결제 완료 알림은 outbox로
          if (count === 1) await tx.outboxEvent.create({ data: { type: "order.paid", userId: order.userId, payload: { orderId: order.id } } });
        } else {
          // 결제하지 않고 세션이 만료됐다. 주문을 취소하고 예약했던 재고를 되돌린다
          await cancelUnpaidOrder(tx, order.id);
        }
        this.logger.log(`웹훅 처리: ${event.id} ${event.type} → 주문 #${order.id}`);
        return "processed";
      });
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.log(`이미 처리한 웹훅: ${event.id} (${event.type})`);
        return "duplicate";
      }
      throw err;
    }
  }
}
```

#### 모듈 완성과 AppModule 등록

2단계에서 `StripeGateway`만 담았던 모듈에 컨트롤러와 서비스를 더한다.

```ts
// src/payments/payments.module.ts
// controllers와 PaymentsService를 더해 완성한다
import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { StripeGateway } from "./stripe.gateway.js";

@Module({
  controllers: [PaymentsController],
  providers: [StripeGateway, PaymentsService],
  exports: [StripeGateway], // OrdersService가 결제 세션을 만들 때 쓴다
})
export class PaymentsModule {}
```

```ts
// src/app.module.ts
// import 한 줄과 imports 배열 끝의 PaymentsModule만 더한다
import { PaymentsModule } from "./payments/payments.module.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [
    // ... LoggerModule.forRoot(...) 그대로 ...
    PrismaModule, StorageModule, HealthModule, CategoriesModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, TrpcModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

엄밀히는 `OrdersModule`이 이미 `PaymentsModule`을 가져오므로, 여기서 빠뜨려도 Nest는 모듈 그래프를 따라가 `PaymentsController`를 등록한다.

그래도 `AppModule`에 적어 둔다. 웹훅은 주문 기능의 부속이 아니라 앱의 독립된 입구이고, 나중에 `OrdersModule`이 `PaymentsModule`을 쓰지 않게 바뀌어도 웹훅 경로가 사라지지 않게 하려는 것이다.

#### 확인

서버와 `stripe listen`을 켠 채, 2단계 작업 4에서 받은 `checkoutUrl`을 브라우저로 열어 테스트 카드로 결제한다.

`stripe listen`에 `--> checkout.session.completed`와 `<--  [200] POST http://localhost:4000/payments/webhook`이, Nest 로그에 `웹훅 처리: evt_... checkout.session.completed → 주문 #<번호>`가 찍히면 된다.

### 용어 | Stripe API (웹훅 이벤트)

- `Stripe.Event`: 웹훅 이벤트다. `id`(`evt_...`), `type`(이벤트 종류), `data.object`(이벤트의 대상, 여기서는 Checkout 세션)를 쓴다. `data.object`의 타입이 정해지는 방식은 아래 "`event.type`으로 좁혀지는 `data.object`"에서 다룬다.

- `checkout.session.completed` / `checkout.session.expired`: 결제 화면에서 결제를 마쳤을 때 / 결제하지 않고 세션 기한이 지났을 때 오는 이벤트다. 아래 "세션의 `status`와 `payment_status`"에서 다룬다.

- `session.payment_status`: `"paid"`면 돈이 들어왔다. completed와 무엇이 다른지는 아래 "세션의 `status`와 `payment_status`"에서 다룬다.

### 용어 | Nest API (웹훅 컨트롤러)

- `NestFactory.create(AppModule, { rawBody: true })`: JSON·폼 본문을 파싱할 때 원래 바이트를 `req.rawBody`에도 남긴다. 테스트 앱은 `createNestApplication({ rawBody: true })`로 따로 켠다.

- `RawBodyRequest<Request>`: `req.rawBody?: Buffer` 칸이 붙은 Express 요청 타입이다. `rawBody: true`를 안 켜면 값이 `undefined`라서 코드에서 `!`로 "있다"고 단정한다.

- `@Req()`: Express의 요청 객체 전체를 받는다. 보통은 `@Body()`로 파싱된 본문만 받지만, 여기서는 `rawBody`가 필요해서 전체를 받는다.

- `@Headers("stripe-signature")`: 요청 헤더 하나를 꺼낸다. HTTP 헤더 이름은 대소문자를 가리지 않아서 Express가 소문자로 바꿔 둔다.

- `@HttpCode(200)`: 응답 코드를 바꾼다. `@Post()`의 기본은 201이다.

### 개념 | `event.type`으로 좁혀지는 `data.object`

`Stripe.Event`는 하나의 모양이 아니라, 이벤트 종류마다 하나씩 있는 모양을 `type`을 태그로 묶은 판별 유니온이다.

그래서 `type`을 확인하기 전의 `event.data.object`는 "Stripe의 어떤 객체든 될 수 있는 값"이라 세션의 필드를 읽을 수 없다.

```ts
async handle(event: Stripe.Event) {
  event.data.object.payment_status;
  // 컴파일 에러(TS2339): Property 'payment_status' does not exist on type 'Application | BankAccount | Card | Account | ApplicationFee | FeeRefund | Install | Balance | ... 74 more ... | ReceivedDebit'.

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") return "ignored";
  const session = event.data.object; // 여기부터 타입: Stripe.Checkout.Session
  session.payment_status; // 통과
}
```

`payments.service.ts`의 첫 줄이 이벤트 종류를 거르는 이유가 여기 있다.

처리하지 않을 이벤트를 `return`으로 먼저 내보내면, 그 아래에서 `event.data.object`는 Checkout 세션으로 좁혀지고 `session.id`, `session.payment_status`를 그대로 쓸 수 있다.

C로 치면 `struct { enum Type type; union { ... } data; }`에서 `type`을 `switch`로 확인한 뒤에야 `data.session`을 읽는 것과 같다. 차이는 TypeScript가 확인 전의 접근을 컴파일 에러로 막아 준다는 점이다.

- `as Stripe.Checkout.Session`으로 강제로 바꿔도 컴파일은 통과한다. 하지만 `charge.succeeded`처럼 다른 이벤트가 오면 엉뚱한 객체를 세션으로 읽게 된다. `type`을 확인하는 쪽이 안전하다.

- 이 타입은 SDK 버전(`endive`)의 것이다. 웹훅 본문의 모양은 계정의 API 버전(`dahlia`)을 따르므로, 1장 작업 3에서 본 것처럼 오래 바뀌지 않은 칸만 쓴다.

> 타입 검사는 "우리 코드가 세션 필드를 세션에서만 읽는가"를 보장할 뿐, Stripe가 정말 그 모양을 보냈는지는 서명 검증과 Stripe를 믿는 것으로 대신한다.

### 개념 | 세션의 `status`와 `payment_status`

Checkout 세션에는 상태 칸이 둘 있다. `status`는 결제 화면이 아직 열려 있는지, `payment_status`는 돈이 들어왔는지를 말한다.

| 칸 | 값 | 뜻 |
|---|---|---|
| `status` | `"open"` | 결제 화면을 쓸 수 있다. `session.url`로 들어갈 수 있다 |
| `status` | `"complete"` | 사용자가 결제 화면에서 결제를 마쳤다. 이때 `checkout.session.completed`가 온다 |
| `status` | `"expired"` | 결제하지 않고 기한이 지났거나 만료시켰다. 이때 `checkout.session.expired`가 온다(5단계의 `"status": "expired"`) |
| `payment_status` | `"paid"` | 돈이 들어왔다 |
| `payment_status` | `"unpaid"` | 아직 돈이 들어오지 않았다 |
| `payment_status` | `"no_payment_required"` | 결제할 금액이 없는 세션이다 |

카드는 결제를 마치는 순간 승인되므로 `complete`와 `paid`가 함께 온다.

계좌이체처럼 나중에 확정되는 수단은 `complete`인데 아직 `unpaid`일 수 있다. 그래서 completed 이벤트만 보지 않고 `payment_status`도 확인한다.

```ts
if (event.type === "checkout.session.completed") {
  if (session.payment_status !== "paid") return "ignored"; // 결제 화면은 끝났지만 돈은 아직이다
  // ...
}
```

- `open`인 세션은 만료시킬 수 있지만, 이미 `complete`인 세션은 만료시킬 수 없다. 도전 과제 2에서 "만료에 실패하면 결제가 끝난 것"으로 보는 근거다.

- 나중에 확정되는 수단의 결제 완료 이벤트는 이 문서에서 다루지 않는다(12장 "이 문서에서 다루지 않은 것").

> 이벤트 이름의 "completed"는 "결제 화면에서 할 일을 마쳤다"이지 "돈이 들어왔다"가 아니다.

### 개념 | 웹훅 컨트롤러가 다른 컨트롤러와 다른 점

#### 로그인 Guard가 없다

웹훅을 보내는 것은 Stripe이지 사용자가 아니다. 대신 서명이 "Stripe가 보냈다"를 증명한다.

RLS 아래에서는 시스템으로서(`asAdmin`) 처리한다.

`asAdmin`을 빠뜨리고 `this.prisma.order.findUnique(...)`로 바로 찾으면 에러가 나지 않는다. `app.user_id`도 `app.role`도 설정되지 않은 연결에는 `orders_owner` 정책이 행을 하나도 보여 주지 않으므로, 주문을 못 찾아 조용히 `"ignored"`가 된다.

#### 주문은 세션 id로 찾는다

`stripe listen`은 계정의 이벤트를 전부 넘겨준다. 테스트 DB에서 만든 주문, 다른 개발자가 만든 주문의 이벤트도 내 서버로 온다.

`metadata.orderId`(주문 번호)로 찾으면 다른 DB의 "주문 #6" 이벤트가 내 DB의 주문 #6을 결제 완료로 만든다. **세션 id는 전 세계에서 하나뿐이다.**

#### 처리 순서와 트랜잭션

`handle`의 순서는 "주문 찾기 → 이벤트 기록 → 상태 바꾸기 → 알림 기록"이고, 전부 `asAdmin`의 한 트랜잭션 안이다.

- 이벤트 기록이 상태 바꾸기보다 먼저인 이유: 두 번째로 온 같은 이벤트는 기록 단계의 기본키 위반으로 바로 끝나서, 그 아래의 부수 효과가 한 줄도 실행되지 않는다.

- 한 트랜잭션인 이유: 이벤트는 기록했는데 상태 바꾸기에서 실패하면, 기록까지 함께 롤백돼야 Stripe가 다시 보냈을 때 다시 처리된다. 기록만 남으면 그 이벤트는 "처리했다"고 거짓으로 남는다.

- 주문을 못 찾은 이벤트는 기록하지 않고 `"ignored"`로 끝낸다. 남의 DB의 이벤트까지 `stripe_events`에 쌓을 이유가 없다.

#### 응답 코드

처리했든, 이미 처리했든, 우리와 상관없는 이벤트든 200을 돌려준다.

Stripe는 2xx가 아니면 실패로 보고 계속 다시 보낸다. 서명이 틀리면 400이다.

`@HttpCode(200)`이 없으면 `@Post()`의 기본인 201이 나간다. 201도 2xx라 Stripe는 성공으로 보지만, "새로 만든 것이 있다"는 뜻의 코드라서 "받았다"는 뜻의 200으로 고정한다.

처리 중에 예상하지 못한 에러(DB 연결 끊김 등)가 나면 `throw err`로 그대로 올라가 500이 된다. 이때는 Stripe가 다시 보내 주는 것이 오히려 맞는 동작이다.

### 실험 | 일부러 깨뜨려보기 ①: 파싱한 본문으로 검증하면

`rawBody`를 모르면 흔히 이렇게 쓴다.

```ts
// src/payments/payments.controller.ts
// webhook의 constructWebhookEvent 줄을 잠깐 이렇게 바꾼다
      event = this.stripe.constructWebhookEvent(Buffer.from(JSON.stringify(req.body)), signature); // 깨뜨려보기
```

이미 처리한 이벤트를 `stripe events resend`로 다시 보내 보면 이렇게 된다.

```text
<--  [400] POST http://localhost:4000/payments/webhook [evt_1UN4ZIIMAlkapI16VYVBM2kD]
```

응답 본문은 `웹훅 서명 검증 실패: No signatures found matching the expected signature for payload. Are you passing the raw request body you received from Stripe? ...`이다.

Stripe가 보내는 본문은 들여쓰기와 줄바꿈이 있는 JSON이다.

`JSON.stringify`로 다시 만들면 내용은 같아도 **바이트가 다르다**. HMAC은 바이트 하나만 달라도 완전히 다른 값이 된다.

> 확인했으면 되돌린다.

### 남길 것

- **찾아보면 되는 것**: `rawBody: true`, `RawBodyRequest`, `@Headers(...)`, `@HttpCode(...)`, Stripe 이벤트 종류의 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 서명은 "받은 바이트 그대로"에 대한 것이다. 프레임워크가 본문을 파싱하기 전의 바이트를 따로 남겨 두지 않으면 검증할 방법이 없다.
  
  - 외부 시스템이 보내는 웹훅에서 우리 행을 찾을 때는 우리가 저장해 둔, 전 세계에서 하나뿐인 id(세션 id)로 찾는다. 상대가 실어 보낸 우리 쪽 번호(`metadata`)는 다른 DB의 것일 수 있다.
  
  - 웹훅은 "처리했다", "이미 처리했다", "상관없다" 모두 2xx로 답한다. 2xx가 아닌 응답은 "다시 보내 달라"는 뜻이 된다.

- **에러 신호**:
  
  - 웹훅이 400, `웹훅 서명 검증 실패: No signatures found matching the expected signature for payload` → `req.rawBody`로 검증하는지, `main.ts`에 `rawBody: true`가 있는지, `STRIPE_WEBHOOK_SECRET`이 지금 `stripe listen`의 것인지
  
  - 웹훅이 400, `No stripe-signature header value was provided` → `Stripe-Signature` 헤더가 없다. Stripe가 아닌 곳에서 보낸 요청이다
  
  - 웹훅이 400, `웹훅 서명 검증 실패: STRIPE_WEBHOOK_SECRET 환경변수가 없습니다` → 1장 작업 3의 `whsec_...`를 `.env.local`에 넣고 서버를 다시 켰는지
  
  - 웹훅이 400, `Timestamp outside the tolerance zone` → 서명한 지 5분이 지난 요청이다. 녹화해 둔 요청을 다시 보냈거나 서버 시계가 틀렸다
  
  - 웹훅은 200인데 주문이 그대로, 응답의 `result`가 `"ignored"` → 세션 id가 이 DB의 주문에 없다(다른 DB의 주문, 세션 저장 전에 실패), 또는 `asAdmin` 없이 조회했다
  
  - 웹훅이 500이고 같은 이벤트가 계속 온다 → 처리 중 에러다. Nest 로그의 에러를 본다
  
  - `TS2339: Property 'payment_status' does not exist on type 'Application | BankAccount | ...'` → `event.type`을 확인하기 전에 `data.object`를 읽었다

## 5. 4단계: 같은 웹훅이 두 번 와도

### 실험 | 일부러 깨뜨려보기 ②: 받는 대로 처리하면

이벤트 기록(①)과 조건부 UPDATE(②)를 빼고, 받을 때마다 결제 완료로 바꾸고 알림을 기록하게 해 본다.

```ts
// src/payments/payments.service.ts
// handle의 asAdmin 안을 잠깐 이렇게 바꾼다
        // 깨뜨려보기: 이벤트 기록 없이
        ...
          await tx.order.update({ where: { id: order.id }, data: { paid: true } }); // 깨뜨려보기: 조건 없이
          await tx.outboxEvent.create({ data: { type: "order.paid", userId: order.userId, payload: { orderId: order.id } } });
```

같은 이벤트를 두 번 다시 보낸다(`stripe events resend`).

```text
order.paid 알림(주문 #6): 전 1 → 후 3
```

결제는 한 번인데 "결제 완료" 알림이 세 번 나간다. 알림이 아니라 포인트 적립이나 배송 요청이었다면 세 번 적립, 세 번 배송이다.

> 확인했으면 되돌린다.

### 개념 | 두 겹으로 막는 이유

원래 코드는 두 가지로 막는다.

1. 이벤트 id 기록(`stripe_events`의 PK): 같은 이벤트의 두 번째 처리는 `INSERT`에서 P2002로 끝난다. 동시에 두 번 와도 PK가 하나만 통과시킨다(`02`의 Idempotency-Key와 같은 원리).

2. 조건부 UPDATE(`paid: false, canceledAt: null`일 때만): 다른 이벤트지만 같은 주문에 대한 것(예: 결제 완료 뒤에 늦게 온 만료)이 상태를 뒤집지 못하게 한다.

이 경우에는 둘 중 하나만 있어도 알림은 한 번이다. 그래도 둘 다 둔다.

①은 "이 이벤트를 처리했는가"라는 일반적인 답이라, 상태 전이로 표현하기 어려운 부수 효과(메일, 적립)도 막는다.

②는 이벤트가 달라도 주문 상태가 거꾸로 가지 않게 한다.

#### 동시에 두 번 오면

같은 이벤트 둘이 거의 동시에 오면, 두 트랜잭션이 같은 `evt_...`를 `INSERT`하려 한다.

먼저 넣은 쪽이 아직 커밋하지 않았으면, 뒤에 온 쪽의 `INSERT`는 에러를 내지 않고 기다린다. 같은 기본키 값이 들어올지 아직 모르기 때문이다.

먼저 넣은 쪽이 커밋하면 뒤의 쪽은 그제야 `duplicate key value violates unique constraint "stripe_events_pkey"`로 실패하고, Prisma는 이를 P2002로 바꿔 던진다.

먼저 넣은 쪽이 롤백하면 뒤의 쪽이 통과해 처리한다. 어느 쪽이든 처리는 정확히 한 번이다.

#### P2002가 트랜잭션 전체를 취소하는 이유

PostgreSQL에서는 트랜잭션 안의 한 문장이 실패하면 그 트랜잭션 전체가 실패 상태가 된다.

Prisma의 `$transaction(async (tx) => ...)`은 콜백에서 예외가 올라오면 롤백한다. 그래서 P2002 뒤의 코드는 실행되지 않고, `catch`에서 `"duplicate"`로 바꿔 200을 돌려준다.

### 작업 1. [원복] 원래 코드로 같은 이벤트 다시 보내기

실험 ②를 되돌린 코드에서 같은 이벤트를 `stripe events resend`로 다시 보낸다.

```text
# 원래 코드에서 같은 이벤트를 다시 보내면
이미 처리한 웹훅: evt_1UN4ZIIMAlkapI16VYVBM2kD (checkout.session.completed)
order.paid 알림: 1
```

`stripe listen`에는 `<--  [200]`이 찍힌다. 중복이어도 200이라 Stripe는 더 보내지 않는다.

### 남길 것

- **찾아보면 되는 것**: `stripe events resend`, Prisma의 P2002 코드. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - "최소 한 번" 오는 메시지는 받는 쪽이 멱등하게 만든다. 이벤트 id를 기본키로 먼저 기록하면, 동시에 와도 DB가 하나만 통과시킨다.
  
  - 이벤트 중복 막기(같은 이벤트)와 상태 전이 조건(다른 이벤트, 같은 대상)은 막는 것이 다르다. 둘 다 둔다.

- **에러 신호**:
  
  - Nest 로그에 `이미 처리한 웹훅: evt_... (checkout.session.completed)` → 정상이다. 같은 이벤트가 다시 왔고 한 번만 처리됐다
  
  - `order.paid` 알림이 웹훅을 받은 횟수만큼 쌓인다 → 이벤트 기록(①)과 조건부 UPDATE(②)가 둘 다 빠졌는지

## 6. 5단계: 결제하지 않고 끝나면

결제 화면을 열고 결제하지 않으면 세션은 기한(기본 24시간)이 지나 만료된다. 이때 `checkout.session.expired`가 온다.

만료 웹훅의 처리(`cancelUnpaidOrder`)는 3단계에서 이미 만들었다. 기다리지 않고 `stripe checkout sessions expire`로 바로 만료시켜 확인한다.

### 작업 1. [확인] 세션을 바로 만료시켜 재고 복구 확인

세션 id는 `checkoutUrl`의 `/c/pay/` 뒤에 있는 `cs_test_...`이다(`#` 앞까지). DB의 `orders.stripe_session_id`에서도 볼 수 있다.

서버(`npm run start:dev`)와 `stripe listen`을 각자의 터미널에 켜 둔 채, 세 번째 터미널의 `order-api-nest` 폴더에서 차례로 친다. `TOKEN`은 2단계 작업 4의 로그인 명령으로 담아 둔다.

```sh
# 0) stripe 명령이 백엔드와 같은 계정을 쓰도록 비밀 키를 셸에도 담는다(1장 "겪은 문제")
export STRIPE_SECRET_KEY=$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2-)

# 1) 결제 전 재고(상품 1: 한정판 키보드)
curl -s localhost:4000/products | jq '.[] | select(.id == 1) | .stock'
# 10

# 2) 키보드 2개로 결제를 시작하고, 주문 번호와 세션 id를 변수에 담는다. 멱등 키는 매번 새로 만든다
RES=$(curl -s -X POST localhost:4000/orders/checkout -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"items":[{"productId":1,"quantity":2}]}')
ORDER_ID=$(echo "$RES" | jq -r .id)
SESSION_ID=$(echo "$RES" | jq -r .checkoutUrl | sed -E 's|.*/c/pay/([^#]+).*|\1|')
echo "$ORDER_ID $SESSION_ID"
# 7 cs_test_...

# 3) 주문을 만든 뒤 재고: 결제 전인데도 이미 줄었다(예약)
curl -s localhost:4000/products | jq '.[] | select(.id == 1) | .stock'
# 8

# 4) 결제하지 않고 세션을 바로 만료시킨다
stripe checkout sessions expire "$SESSION_ID" --api-key "$STRIPE_SECRET_KEY" | jq -r .status
# expired
# (stripe listen 터미널)
# --> checkout.session.expired [evt_1UN4btIMAlkapI16uibdBem8]
# <--  [200] POST http://localhost:4000/payments/webhook [evt_1UN4btIMAlkapI16uibdBem8]

# 5) 웹훅이 처리될 틈을 잠깐 두고, 재고와 주문 상태를 본다
sleep 2
curl -s localhost:4000/products | jq '.[] | select(.id == 1) | .stock'
# 10
docker compose exec -T db psql -U order -d order_api -Atc "SELECT id, paid, canceled_at IS NOT NULL FROM orders WHERE id = $ORDER_ID"
# 7|f|t   ← paid=false, 취소됨
```

- `jq`는 JSON에서 칸 하나를 꺼내는 명령이다. `.[] | select(.id == 1) | .stock`은 "배열에서 `id`가 1인 것의 `stock`"이다.

- `uuidgen`은 매번 새 UUID를 만든다. 2단계처럼 `demo-21-a` 같은 고정 키를 쓰면 두 번째 실행부터는 처음 주문을 재응답하므로, 이미 만료시킨 세션이 돌아온다.

- `psql`은 PC에 없어도 된다. `docker compose exec -T db psql ...`은 DB 컨테이너 안의 `psql`을 소유자 계정(`order`)으로 실행한다. RLS를 거치지 않고 모든 주문을 본다.

- 번호와 `evt_...`는 실행할 때마다 다르다.

5)에서 재고가 8에 머물러 있으면 만료 웹훅이 우리 서버까지 오지 않은 것이다. `stripe listen` 터미널에 `checkout.session.expired`가 찍혔는지부터 본다.

아무것도 찍히지 않았다면 1장 "겪은 문제"와 같다. 세션은 백엔드 비밀 키의 샌드박스에서 만료됐는데, `--api-key` 없이 켠 `stripe listen`은 CLI가 로그인한 다른 샌드박스를 듣고 있다.

4)의 `▸ Running in ...` 줄에 속지 않는다. 이 줄은 CLI가 로그인한 샌드박스를 보여 줄 뿐이다. `--api-key`를 붙인 명령은 그 키의 샌드박스로 간다. 그래서 다른 샌드박스 이름이 찍혀도 만료는 성공하고, 웹훅만 오지 않는다.

```sh
# 어느 샌드박스의 키인지: 백엔드 키로 계정을 조회한다
curl -s https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:" | jq -r .id
# acct_1UMq...  ← 4)의 "Running in ... (acct_1UJj...)"와 다르면 계정이 엇갈린 것이다

# stripe listen 터미널: Ctrl+C로 끄고, 그 터미널에서도 키를 담은 뒤 백엔드 키의 샌드박스를 듣게 다시 켠다
cd order-api-nest
export STRIPE_SECRET_KEY=$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2-)
echo ${STRIPE_SECRET_KEY:0:8}   # sk_test_ 가 보여야 한다. 비어 있으면 --api-key가 빈 값이 되어 다시 CLI 로그인 샌드박스를 듣는다
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
# 첫 줄의 whsec_...가 .env.local의 STRIPE_WEBHOOK_SECRET과 다르면 바꾸고 서버를 다시 켠다(계정이 바뀌면 웹훅 비밀도 바뀐다)

# 원래 터미널: 놓친 만료 이벤트 중 가장 최근 것을 찾아 다시 보낸다
EVT=$(stripe events list --limit 5 --api-key "$STRIPE_SECRET_KEY" | jq -r '[.data[] | select(.type == "checkout.session.expired")][0].id')
echo "$EVT"
stripe events resend "$EVT" --api-key "$STRIPE_SECRET_KEY"
# (stripe listen 터미널) <--  [200] POST http://localhost:4000/payments/webhook [evt_...]
```

`stripe events resend`는 그 계정에서 **지금 켜져 있는 `stripe listen`**에게만 다시 보낸다. 같은 계정을 듣는 `stripe listen`이 없으면 `No CLI endpoints found to retry delivery. Run 'stripe listen' and retry the request ...`로 거절된다. 그래서 `stripe listen`을 먼저 맞게 켜고, 그다음에 다시 보낸다.

`export`는 그 터미널에만 적용된다. `stripe listen`을 띄운 터미널과 명령을 치는 터미널이 다르면 양쪽에서 각각 담는다. `ps`로 보면 키가 빈 채로 켜진 `stripe listen`은 `--api-key --forward-to ...`처럼 `--api-key` 뒤에 값이 없다.

다시 보낸 뒤 5)를 다시 치면 재고 10, 주문은 `7|f|t`가 된다.

`cancelUnpaidOrder`가 조건부 UPDATE라서, 같은 만료 이벤트를 다시 보내도 재고는 한 번만 돌아온다.

이미 결제된 주문에 만료가 늦게 와도 `paid: false` 조건에 걸려 아무것도 바뀌지 않는다.

### 남길 것

- **찾아보면 되는 것**: `stripe checkout sessions expire <id>`, 세션 기한의 기본값(24시간). 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 재고를 "예약"했다면 예약을 푸는 길이 반드시 있어야 한다. 여기서는 만료 웹훅과 세션 생성 실패의 보상, 두 길이 같은 함수를 쓴다.
  - 결제 화면을 닫는 것만으로는 아무 이벤트도 오지 않는다. 재고는 세션이 만료될 때까지 묶인다.

- **에러 신호**:
  - 결제 화면을 닫았는데 재고가 안 돌아온다 → 세션이 아직 만료 전이다(기본 24시간). 도전 과제 1
  - `stripe events resend`가 `No CLI endpoints found to retry delivery` → 그 계정을 듣는 `stripe listen`이 지금 없다. `stripe listen` 터미널에서 `STRIPE_SECRET_KEY`를 담고 `--api-key`로 다시 켰는지(`echo ${STRIPE_SECRET_KEY:0:8}`)
  - `zsh: no such file or directory: evt_...` → 명령에 `<evt_...>`처럼 꺾쇠를 그대로 쳤다. 셸은 `<`를 파일 입력으로 읽는다. 꺾쇠를 빼거나 변수(`"$EVT"`)를 쓴다
  - `stripe checkout sessions expire`는 `expired`를 돌려줬는데 재고가 그대로다 → `stripe listen`이 다른 샌드박스를 듣고 있다. `▸ Running in ...`의 `acct_`와 백엔드 키의 계정을 비교하고, `stripe listen`에 `--api-key`를 붙인다

## 7. 6단계: 프론트

### 작업 1. [커밋] 결제 버튼이 Stripe로 보내게

```tsx
// app/shop/page.tsx
// CheckoutResult 타입, CartPanel의 onSuccess, 성공 문구를 바꾼다
// 결제를 누르면 주문(결제 대기)과 Stripe 결제 화면 주소가 온다
type CheckoutResult = { id: number; price: number; checkoutUrl: string };
...
    onSuccess: (data) => {
      // 주문이 만들어지고 재고가 예약됐다. 장바구니를 비우고 Stripe 결제 화면으로 간다
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
      window.location.assign(data.checkoutUrl); // 다른 사이트로 가는 이동이라 Next의 router가 아니라 브라우저 이동을 쓴다
    },
...
      {checkout.isSuccess && <p role="status">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중...</p>}
```

`08`의 CSP는 고칠 것이 없다. 다른 사이트로 가는 페이지 이동은 CSP가 막지 않는다.

`connect-src`는 스크립트가 여는 연결(`fetch`, WebSocket 등)만, `form-action`은 폼 제출만 본다.

### 작업 2. [커밋] 주문 상태 칸과 "돌아온 뒤" 다시 묻기

#### 응답에 canceledAt 더하기

tRPC와 REST가 함께 쓰는 `orderSelect`에 `canceledAt`을 더한다. 프론트 타입은 `12`처럼 저절로 따라온다.

```ts
// order-api-nest/src/me/order-select.ts
// canceledAt: true 하나만 더한다
export const orderSelect = { id: true, price: true, paid: true, canceledAt: true, createdAt: true } as const; // canceledAt(만료로 취소)
```

#### 상태 글자

```tsx
// app/me/orders/order-status.tsx
// 주문 상태 글자. 결제는 Stripe 웹훅이 확인해야 "완료"가 된다
export function orderStatus(o: { paid: boolean; canceledAt: string | null }) {
  if (o.paid) return "결제 완료";
  if (o.canceledAt) return "취소됨(결제 기한 지남)";
  return "결제 대기";
}
```

`canceledAt`이 `Date`가 아니라 `string`인 이유: DB에서는 `DateTime`이지만 tRPC 응답은 JSON을 거쳐 오므로 문자열이 된다. 프론트에서 추론되는 타입도 `string | null`이다.

#### 주문 상세: 결제 대기인 동안 다시 묻기

```tsx
// app/me/orders/[id]/page.tsx
// import 두 곳, MyOrderDetail의 useQuery, 상태 글자 칸을 바꾼다
import { useParams, useSearchParams } from "next/navigation";
// ...
import { orderStatus } from "../order-status";

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  // Stripe 결제 화면에서 돌아왔다(?checkout=success). 그래도 웹훅이 아직 안 왔을 수 있다 → 결제 대기인 동안 1초마다 다시 묻는다
  const fromCheckout = useSearchParams().get("checkout") === "success";
  // 목록과 다른 프로시저라 따로 요청된다. 같은 순간에 나가므로 httpBatchLink가 HTTP 요청 하나로 묶는다
  const { data, isPending, error } = useQuery({
    ...trpc.me.order.queryOptions({ id }),
    refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
  });
  // ... 로딩·에러 처리 그대로 ...
  return (
    <p data-testid="order-detail">
      주문 #{data.id} - {data.price.toLocaleString()}원, {new Date(data.createdAt).toISOString().slice(0, 10)} ·{" "}
      <span data-testid="order-status">{orderStatus(data)}</span>
    </p>
  );
}
```

#### 목록에도 상태

```tsx
// app/me/orders/my-order-list.tsx
// import 한 줄을 더하고, Link 안에 상태 글자를 붙인다
import { orderStatus } from "./order-status";
// ...
          <Link href={`/me/orders/${o.id}`}>#{o.id} - {o.price.toLocaleString()}원 · {orderStatus(o)}</Link>
```

### 개념 | 돌아온 뒤 다시 묻는 조건

`refetchInterval`에 숫자 대신 함수를 주면, 받아 온 데이터를 보고 다시 물을지 매번 정할 수 있다. 숫자(ms)를 돌려주면 그만큼 뒤에 다시 묻고, `false`면 멈춘다.

조건은 세 개가 모두 맞을 때만 1초다.

1. 결제 화면에서 막 돌아왔다(`?checkout=success`). 그냥 주문 상세를 연 사람에게까지 1초마다 묻지 않는다.

2. 데이터를 이미 한 번 받았다(`query.state.data`가 있다).

3. 아직 결제 대기다. 완료나 취소가 되면 더 바뀔 일이 없으므로 멈춘다.

`?checkout=success`는 화면이 "기다려 볼 만하다"를 판단하는 데만 쓴다. 상태 글자는 언제나 서버가 돌려준 `paid`·`canceledAt`으로 정한다(0장 개념 2).

`window.location.assign`을 쓰는 이유: Next의 `router.push`는 같은 앱 안의 화면 전환이다. Stripe의 결제 화면은 다른 사이트이므로 브라우저가 페이지를 통째로 바꾸게 한다.

### 실험 | 실제로 결제해 보기: 웹훅이 늦게 오면

8단계의 `e2e/stripe-payment.spec.ts`로 실제 Stripe 결제 화면에서 테스트 카드로 결제하고, 돌아온 직후의 상태와 웹훅 처리 시각을 찍었다.

```text
# 두 번 실행
돌아온 직후: 결제 완료  05:42:49.358(UTC)   웹훅 처리: 14:42:47.697(KST)
돌아온 직후: 결제 완료  05:43:04.768(UTC)   웹훅 처리: 14:43:03.116(KST)
```

이 환경에서는 웹훅이 화면보다 1.6초쯤 먼저 처리됐다. 하지만 0장 개념 3대로 순서는 보장되지 않는다.

`stripe listen`을 끈 채 결제하고, 잠시 뒤에 켜서 그 이벤트를 다시 보내면 웹훅이 늦게 오는 상황이 된다.

```text
돌아온 직후: 결제 대기
5초 동안 다시 물은 횟수: 4 | 상태: 결제 대기
(stripe listen을 켜고 stripe events resend)
웹훅이 늦게 온 뒤: 결제 완료
```

화면은 1초 간격으로 다시 묻다가, 웹훅이 주문을 바꾸자 결제 완료를 보여 줬다.

> 돌아온 주소를 근거로 "결제 완료"를 띄웠다면, 이 사이에 화면과 DB가 달랐을 것이다.

### 남길 것

- **찾아보면 되는 것**: `refetchInterval`에 함수를 주는 모양, `useSearchParams`, `window.location.assign`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 돌아온 주소(`?checkout=success`)는 "다시 물어볼 만하다"는 힌트로만 쓰고, 화면의 상태는 언제나 서버의 값으로 그린다.
  
  - 결제 완료는 비동기로 확정된다. 화면은 "결제 대기"를 정상 상태로 보여 줄 수 있어야 하고, 확정될 때까지 다시 묻거나 알림을 받는다.

- **에러 신호**:
  
  - 결제하고 돌아왔는데 계속 `결제 대기` → 웹훅이 오지 않았다. `stripe listen`이 켜져 있는지, 1장의 계정 문제인지

## 8. 7단계: 컨테이너

### 작업 1. [커밋] compose로 Stripe 값 넘기기

GitHub 값과 같은 방식으로 넘긴다. compose 프로젝트 이름은 compose 파일이 있는 폴더 이름(`order-api-nest`)이라 따로 적지 않는다.

```yaml
# order-api-nest/docker-compose.yml
# api 서비스의 environment에 두 줄을 더한다
services:
  # ...
  api:
    environment:
      # ... 기존 값 그대로 ...
      # Stripe 테스트 모드. GitHub 값과 같이 --env-file .env.local로 넘긴다
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}
```

`${이름:-}`는 "셸이나 `--env-file`에 그 값이 없으면 빈 문자열"이라는 compose 문법이다. 값이 비면 결제 버튼만 500이 되고(2단계의 보상으로 주문은 취소된다) 나머지는 정상으로 뜬다.

```sh
docker compose --env-file .env.local --profile app up -d --build
# 결제 시작 → {"id":15,"paid":false,"checkoutUrl":"https://checkout.stripe.com/c/pay/cs_tes..."}
# 그 세션을 만료시키면 → <--  [200] POST http://localhost:4000/payments/webhook ...  → 15|f|t
```

`stripe listen`의 전달 주소(`localhost:4000`)는 컨테이너가 PC의 4000번에 열려 있으므로 그대로 쓴다.

### 남길 것

- **찾아보면 되는 것**: `${이름:-}` 문법, `--env-file`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 비밀 값은 이미지나 compose 파일에 적지 않고 실행할 때 넘긴다. 컨테이너 안에는 `.env.local` 파일이 없으므로 `main.ts`의 파일 읽기는 건너뛰고 환경변수만 본다.

- **에러 신호**:
  
  - 컨테이너에서만 결제 버튼이 500, `STRIPE_SECRET_KEY 환경변수가 없습니다` → `docker compose`에 `--env-file .env.local`을 빠뜨렸는지

## 9. 8단계: 테스트

### 작업 1. [커밋] 백엔드: Mock Stripe로 바꿔 끼우기

테스트가 실제 Stripe를 부르면 느리고, 키가 필요하고, `02`의 동시 결제 테스트는 세션을 20개씩 만든다. `StripeGateway`를 테스트용으로 바꿔 끼운다.

```ts
// test/fake-stripe.ts
import { StripeGateway, type CheckoutSession } from "../src/payments/stripe.gateway.js";

// 테스트용 Stripe: 결제 세션을 만들 때 Stripe를 부르지 않고 주문 번호로 정해진 값을 돌려준다.
// 웹훅 서명 검증(constructWebhookEvent)은 진짜 것을 그대로 쓴다. 네트워크가 필요 없는 계산이다
export class FakeStripeGateway extends StripeGateway {
  override async createCheckoutSession(order: { id: number; price: number }, _attemptKey?: string): Promise<CheckoutSession> {
    const id = `cs_test_fake_${order.id}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }
}
```

동시성 테스트도 Mock Stripe로 돌게 바꾼다.

```ts
// test/checkout.e2e-spec.ts
// import 두 줄을 더하고, beforeAll의 모듈 만들기에 overrideProvider를 붙인다
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { FakeStripeGateway } from "./fake-stripe.js";
// ...
  beforeAll(async () => {
    // 동시 요청 20개가 실제 Stripe를 부르지 않게
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeGateway).useClass(FakeStripeGateway).compile();
```

### 개념 | `overrideProvider`로 바꿔 끼우는 원리

Nest의 컨테이너는 프로바이더를 "클래스 이름표(토큰)"로 찾는다.

`OrdersService`의 생성자에 적힌 `StripeGateway`도, `PaymentsController`의 생성자에 적힌 `StripeGateway`도 "이 토큰에 등록된 인스턴스를 달라"는 뜻이다.

`.overrideProvider(StripeGateway).useClass(FakeStripeGateway)`는 그 토큰에 등록할 클래스를 바꾼다.

주입받는 쪽 코드는 한 줄도 바뀌지 않고, `this.stripe`에 `FakeStripeGateway` 인스턴스가 들어온다. C로 치면 함수 포인터 테이블의 한 칸만 테스트용 함수로 바꿔 끼우는 것과 같다.

- `extends StripeGateway`로 만든 이유: `createCheckoutSession`만 덮어쓰고 `constructWebhookEvent`는 진짜를 물려받는다. 서명 검증은 네트워크 없이 비밀만으로 하는 계산이라 진짜를 그대로 시험할 수 있다.

- Fake의 `createCheckoutSession`은 `this.stripe` 게터를 건드리지 않는다. 그래서 테스트에 `STRIPE_SECRET_KEY`가 없어도 된다. 작업 1의 "키가 필요한 순간에 만든다"가 여기서 쓰인다.

- `checkout.e2e-spec.ts`에 Fake를 안 붙이면 테스트 DB의 결제가 실제 Stripe를 부르려 한다. 키가 없으면 결제가 전부 보상으로 취소되고, 동시성 테스트의 "정확히 N건 성공"이 깨진다.

### 작업 2. [커밋] 백엔드: 서명한 테스트 웹훅으로 결제 테스트

웹훅은 테스트 안에서 직접 서명해 보낸다. 네트워크가 필요 없다.

```ts
// test/payments.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import Stripe from "stripe";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { adminDb } from "./admin-db.js";
import { FakeStripeGateway } from "./fake-stripe.js";

const WEBHOOK_SECRET = "whsec_test_secret";

describe("Stripe 결제 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeGateway).useClass(FakeStripeGateway).compile();
    // main.ts와 같이 rawBody: true - 웹훅 서명은 받은 바이트 그대로에 대해 검증한다
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw") } });
    await adminDb.product.create({ data: { name: "마우스", price: 30000, stock: 10 } }); // id 1
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "pw" }),
    });
    token = (await res.json()).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  const checkout = async (quantity = 1) => {
    const res = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: 1, quantity }] }),
    });
    return (await res.json()) as { id: number; paid: boolean; checkoutUrl: string };
  };

  // Stripe가 보내는 모양의 웹훅. 본문은 Stripe처럼 들여쓰기한 JSON이고, 서명은 그 바이트 그대로에 대해 만든다
  const sendWebhook = (event: { id: string; type: string; session: Record<string, unknown> }, secret = WEBHOOK_SECRET) => {
    const payload = JSON.stringify({ id: event.id, object: "event", type: event.type, data: { object: { object: "checkout.session", ...event.session } } }, null, 2);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(`${baseUrl}/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
  };
  const paidEvent = (orderId: number, eventId = "evt_paid_1") =>
    ({ id: eventId, type: "checkout.session.completed", session: { id: `cs_test_fake_${orderId}`, payment_status: "paid" } });
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;
  const paidNotices = () => adminDb.outboxEvent.count({ where: { type: "order.paid" } });

  it("결제를 누르면 주문은 결제 대기, 재고는 예약되고, 결제 화면 주소가 온다", async () => {
    const order = await checkout(2);
    expect(order.paid).toBe(false);
    expect(order.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/cs_test_fake_${order.id}`);
    expect(await stock()).toBe(8);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).stripeSessionId).toBe(`cs_test_fake_${order.id}`);
  });

  it("서명이 맞는 completed 웹훅이 오면 결제 완료가 되고 알림이 한 번 기록된다", async () => {
    const order = await checkout();
    const res = await sendWebhook(paidEvent(order.id));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("processed");
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).paid).toBe(true);
    expect(await paidNotices()).toBe(1);
  });

  it("같은 이벤트가 다시 와도(순서대로든 동시에든) 한 번만 처리한다", async () => {
    const order = await checkout();
    await sendWebhook(paidEvent(order.id));
    expect((await (await sendWebhook(paidEvent(order.id))).json()).result).toBe("duplicate");
    const results = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(paidEvent(order.id)).then((r) => r.status)));
    expect(results.every((s) => s === 200)).toBe(true); // 중복이어도 200 - 아니면 Stripe가 계속 다시 보낸다
    expect(await paidNotices()).toBe(1);
  });

  it("서명이 틀리면 400이고 주문은 그대로다", async () => {
    const order = await checkout();
    const res = await sendWebhook(paidEvent(order.id), "whsec_wrong");
    expect(res.status).toBe(400);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).paid).toBe(false);
  });

  it("결제하지 않고 세션이 만료되면 주문이 취소되고 재고가 돌아온다", async () => {
    const order = await checkout(3);
    expect(await stock()).toBe(7);
    await sendWebhook({ id: "evt_expired_1", type: "checkout.session.expired", session: { id: `cs_test_fake_${order.id}`, payment_status: "unpaid" } });
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).canceledAt).not.toBeNull();
    expect(await stock()).toBe(10);
  });

  it("우리가 만들지 않은 세션의 이벤트는 무시한다(200)", async () => {
    const res = await sendWebhook({ id: "evt_other", type: "checkout.session.completed", session: { id: "cs_test_someone_else", payment_status: "paid" } });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("ignored");
  });
});
```

```sh
npm run test:e2e
#  Test Files  8 passed (8)
#       Tests  28 passed (28)
```

여러 파일이 한꺼번에 실패하고 Nest 로그에 `DriverAdapterError: ColumnNotFound`가 보이면, 테스트 코드가 아니라 테스트 DB가 옛 스키마인 것이다. 테스트는 `setup-env.ts`가 `TEST_DATABASE_URL`로 바꿔 끼운 테스트 DB에서 돈다. 1단계에서 개발 DB에만 마이그레이션했다면 그 DB에는 `canceled_at`, `stripe_session_id`, `stripe_events`가 없다.

```sh
# 테스트 DB의 마이그레이션 상태: 적용하지 않은 것이 보이면 1단계의 deploy 명령을 친다
ADMIN_DATABASE_URL=$(grep '^TEST_ADMIN_DATABASE_URL=' .env | cut -d= -f2-) npx prisma migrate status
# Following migration have not yet been applied:
# 0016_stripe_checkout
```

#### 이 테스트가 깨뜨려보기를 잡는지

깨뜨려보기 ①(파싱한 본문으로 검증)은 서명이 필요한 테스트 4개가 잡고, ②(받는 대로 처리)는 세 번째 테스트가 잡는다.

```text
× 같은 이벤트가 다시 와도(순서대로든 동시에든) 한 번만 처리한다
AssertionError: expected 'processed' to be 'duplicate'
```

`createNestApplication({ rawBody: true })`를 빠뜨려도 서명이 맞는 웹훅이 전부 400이 된다. 테스트 앱은 `main.ts`를 거치지 않으므로 `main.ts`의 옵션을 따로 똑같이 켜야 한다.

### 용어 | Stripe API (테스트 헤더)

- `Stripe.webhooks.generateTestHeaderString({ payload, secret })`: 주어진 본문과 비밀로 `Stripe-Signature` 헤더 값을 만든다. 테스트에서 Stripe가 보낸 것과 같은 웹훅을 흉내 낼 때 쓴다. 만드는 헤더(`t=...,v1=...`)의 모양과 검증 방식은 2단계 "웹훅 서명 검증이 하는 일"에서 본 것과 같다.

### 작업 3. [커밋] 프론트: Stripe로 가는 이동만 확인

프론트 e2e는 진짜 백엔드를 부르고, 결제를 누르면 백엔드가 **실제 Stripe(테스트 모드)에 세션을 만든다.** Mock Stripe는 백엔드 테스트에만 있다.

그래서 결제 화면 이동만 확인하는 테스트도 백엔드 `.env.local`에 `STRIPE_SECRET_KEY`가 있어야 하고(없으면 결제가 500이라 실패한다), 돌릴 때마다 테스트 계정에 세션이 생긴다.

> `stripe listen`은 실제 결제 테스트에만 필요하다.

결제 버튼이 Stripe로 이동하게 바뀌었으므로, `05`의 테스트 두 개("결제하면 재고와 내 주문이 다시 받아 와진다", "결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다")를 고친다.

`13`의 GitHub 테스트처럼 `checkout.stripe.com`으로 가는 이동을 가로채고, 가려던 주소만 확인한다.

첫 번째 테스트는 고치는 것이 아니라 **통째로 바꾼다.** `e2e/shop.spec.ts`에서 아래 테스트를 `test(`부터 닫는 `});`까지 지운다. 결제 뒤 "결제 완료" 문구를 기다리는 테스트라, 남겨 두면 버튼이 Stripe로 이동하면서 문구가 끝내 나오지 않아 시간 초과로 실패한다.

```ts
// e2e/shop.spec.ts - 지운다
test("결제하면 재고와 내 주문이 다시 받아 와진다", async ({ page }) => {
  // ...
  await expect(page.getByRole("status")).toContainText("결제 완료");
  // ...
});
```

지운 자리에 이 테스트를 넣는다.

```ts
// e2e/shop.spec.ts - 지운 테스트 자리에 넣는다
test("결제를 누르면 재고를 예약하고 Stripe 결제 화면으로 간다", async ({ page }) => {
  // Stripe 결제 화면에는 가지 않는다 - 가는 주소만 확인한다. 세션은 백엔드가 실제 Stripe에 만든다(STRIPE_SECRET_KEY 필요). 실제 결제까지는 e2e/stripe-payment.spec.ts
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }));
  await loginAsKim(page);
  const stock = page.getByTestId("stock-2");
  await expect(stock).not.toHaveText("");
  const before = Number(await stock.textContent());

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await Promise.all([
    page.waitForURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\//),
    page.getByRole("button", { name: "결제" }).click(),
  ]);

  // 돌아와서 보면: 재고는 결제 전인데도 이미 줄었고(예약), 주문은 결제 대기다
  await page.goto("/shop");
  await expect(page.getByTestId("stock-2")).toHaveText(String(before - 1));
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 0");
  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders").getByRole("listitem").last()).toContainText("결제 대기");
});
```

중복 결제 테스트는 두 곳을 고친다. Stripe로 가는 이동을 가로채는 줄을 더하고, 마지막은 `"결제 완료"` 문구 대신 Stripe로 가는 이동을 기다린다.

고친 뒤의 테스트 전체다. `// ① 추가`와 `// ② 바꿈` 표시가 붙은 곳만 달라졌고, 나머지 줄은 `05`의 테스트 그대로다.

```ts
// e2e/shop.spec.ts
test("결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  const countBefore = await page.getByTestId("my-orders").getByRole("listitem").count();
  await page.goto("/shop");
  // ① 추가: Stripe 결제 화면으로 가는 이동을 가로챈다(바로 위 테스트의 첫 줄과 같다)
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }));

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
  await expect(page.getByText(/결제 실패/)).toBeVisible();
  // ② 바꿈: 성공하면 "결제 완료" 문구 대신 Stripe 결제 화면으로 간다
  await Promise.all([
    page.waitForURL(/^https:\/\/checkout\.stripe\.com\//),
    page.getByRole("button", { name: "결제" }).click(), // 사용자가 다시 누른다 - 같은 Idempotency-Key로
  ]);

  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders").getByRole("listitem")).toHaveCount(countBefore + 1);
});
```

②에서 지우는 것은 이 두 줄이다. 결제 버튼이 이제 "결제 완료"를 띄우지 않고 Stripe로 이동하므로, 남겨 두면 문구를 기다리다 시간 초과로 실패한다.

```ts
  await page.getByRole("button", { name: "결제" }).click();
  await expect(page.getByRole("status")).toContainText("결제 완료");
```

`Promise.all`로 묶는 이유: 클릭이 끝나기 전에 이동이 일어날 수 있다. 클릭 다음 줄에서 `waitForURL`을 시작하면 이미 지나간 이동을 놓칠 수 있으므로, 기다리기를 먼저 걸어 두고 클릭한다.

### 작업 4. [커밋] 프론트: 실제 결제 테스트

실제 결제 화면에서 결제하는 테스트는 따로 두고, 원할 때만 돌린다.

```ts
// e2e/stripe-payment.spec.ts
import { expect, test } from "@playwright/test";

// 실제 Stripe(테스트 모드) 결제 화면에서 테스트 카드로 결제한다. 다음이 있어야 하므로 평소에는 건너뛴다:
// - 백엔드 .env.local의 STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
// - stripe listen --forward-to localhost:4000/payments/webhook (이 문서 1장)
// 실행: STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts
test.skip(!process.env.STRIPE_E2E, "STRIPE_E2E=1 일 때만 실제 Stripe로 결제한다");
test.use({ locale: "ko-KR" }); // Stripe 결제 화면의 글자(버튼 이름 등)가 브라우저 언어를 따른다

test("테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await Promise.all([page.waitForURL(/^https:\/\/checkout\.stripe\.com\//), page.getByRole("button", { name: "결제" }).click()]);

  // Stripe가 호스팅하는 결제 화면. 카드를 고르면 카드 입력칸이 열린다
  await page.locator("#email").fill("test@example.com");
  await page.locator("#payment-method-accordion-item-title-card").click({ force: true });
  await page.locator("#cardNumber").fill("4242 4242 4242 4242"); // Stripe의 테스트 카드 - 항상 승인된다
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test User");
  await page.getByRole("button", { name: "결제", exact: true }).click();

  // 돌아왔다(success_url). 그러나 "돌아왔다"가 결제 완료의 증거는 아니다 - 화면은 웹훅이 주문을 바꿀 때까지 다시 묻는다
  await page.waitForURL(/\/me\/orders\/\d+\?checkout=success$/, { timeout: 60_000 });
  await expect(page.getByTestId("order-status")).toHaveText("결제 완료", { timeout: 30_000 });
});
```

```sh
npm run test:e2e
#   11 passed, 1 skipped   ← 테스트는 모두 12개다. 13개가 보이고 "결제하면 재고와 내 주문이 다시 받아 와진다"가 실패하면 옛 테스트를 지우지 않은 것이다
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts # stripe listen을 켜 둔 상태로
#   ✓ 테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다 (7.4s)
```

이 테스트는 Stripe의 화면 구조(`#cardNumber` 같은 입력칸 id, 카드를 고르는 버튼)에 기댄다. Stripe가 화면을 바꾸면 깨질 수 있다.

> 그래서 평소 테스트에서는 빼고, 우리 코드의 규칙은 백엔드 테스트(Mock Stripe, 서명한 웹훅)가 지킨다.

### 남길 것

- **찾아보면 되는 것**: `overrideProvider(...).useClass(...)`, `generateTestHeaderString`, Playwright의 `page.route`·`waitForURL`, `test.skip(조건, 이유)`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 외부 서비스는 "부르는 곳 한 클래스"로 모아 두면 테스트에서 그 클래스만 바꿔 끼울 수 있다. 네트워크가 필요 없는 부분(서명 검증)은 진짜를 그대로 쓴다.
  
  - 웹훅 테스트는 비밀을 아는 쪽이 직접 서명해서 보내면 된다. 실제 Stripe가 없어도 "서명 검증 → 처리 → 중복"을 전부 시험할 수 있다.
  
  - 실제 외부 화면을 거치는 테스트는 그쪽 화면이 바뀌면 깨진다. 평소에는 건너뛰고 원할 때만 돌린다.

- **에러 신호**:
  
  - `AssertionError: expected 'processed' to be 'duplicate'` → 이벤트 id 기록(①)이 빠졌는지
  
  - 백엔드 e2e에서 서명이 맞는 웹훅까지 전부 400 → 테스트 앱의 `createNestApplication({ rawBody: true })`를 빠뜨렸는지
  
  - 백엔드 e2e가 여러 파일에서 한꺼번에 실패하고 로그에 `DriverAdapterError: ColumnNotFound` → 테스트 DB에 마이그레이션을 안 했다. 1단계의 `migrate deploy`(테스트 DB)
  
  - 프론트 e2e에서 `결제하면 재고와 내 주문이 다시 받아 와진다`가 실패하고 테스트가 13개다 → 작업 3의 옛 테스트를 지우지 않고 새 테스트를 더하기만 했다
  
  - 프론트 e2e가 시작하자마자 `Error: duplicate test title "결제를 누르면 재고를 예약하고 Stripe 결제 화면으로 간다"` → 새 테스트가 파일에 두 번 들어갔다. 하나를 지운다
  
  - 프론트 e2e의 결제 테스트가 `결제 실패`로 끝난다 → 백엔드 `.env.local`에 `STRIPE_SECRET_KEY`가 있는지(프론트 e2e는 실제 Stripe에 세션을 만든다)

## 10. 디버깅

### 진단 1. 웹훅 따라가기

웹훅은 "Stripe → `stripe listen` → 우리 서버 → DB" 순서로 지나간다. 앞에서부터 하나씩 본다.

| 확인할 곳 | 보는 것 |
|---|---|
| `stripe listen` 출력 | `-->` 받은 이벤트, `<--` 우리 서버의 응답 코드. 아무것도 없으면 이벤트가 이 CLI의 계정에서 안 생겼다(1장 "겪은 문제") |
| Nest 로그 | `웹훅 처리: ...`, `이미 처리한 웹훅: ...`, 400이면 `웹훅 서명 검증 실패: ...` |
| `stripe events list --limit 5` | CLI 계정에서 최근 생긴 이벤트(맨 위 `▸ Running in ...`이 어느 계정인지 알려 준다) |
| `stripe events resend <evt_id>` | 같은 이벤트를 다시 보내 본다 |
| `SELECT * FROM stripe_events ORDER BY processed_at DESC` | 처리한 이벤트 |
| Stripe 대시보드(테스트 모드) → 이벤트, 결제 | 결제와 세션의 실제 상태 |

### 진단 2. 증상으로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| 결제는 성공했는데 `stripe listen`에 아무것도 안 온다 | `stripe listen`이 듣는 샌드박스와 Secret key의 샌드박스가 다르다 | `stripe login list`와 `curl https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:"`의 `id`를 비교, `--api-key`를 붙이거나 `stripe switch`(1장) |
| `Property 'stripeEvent' does not exist on type ...` | 스키마는 바꿨는데 Prisma 클라이언트가 옛것이다 | `npx prisma generate`(1단계) |
| 결제 버튼이 500, `STRIPE_SECRET_KEY 환경변수가 없습니다` | Secret key가 서버에 없다. 만들어진 주문은 보상으로 취소되고 재고는 돌아온다(Nest 로그의 `결제 세션 생성 실패`) | 백엔드 `.env.local`, 컨테이너면 `--env-file .env.local`(2단계, 7단계) |
| `curl` 결제 요청이 `{"message":"Unauthorized","statusCode":401}` | `TOKEN`이 비었거나 액세스 토큰이 만료됐다(15분) | `echo $TOKEN`, 로그인 명령으로 다시 담는다(2단계 작업 4) |
| `Nest can't resolve dependencies of the OrdersService (PrismaService, NotificationsGateway, ?)` | `OrdersModule`에서 `StripeGateway`가 안 보인다 | `orders.module.ts`의 `imports: [PaymentsModule]`, `PaymentsModule`의 `exports`(2단계) |
| `StripeIdempotencyError: Keys for idempotent requests can only be used with the same parameters ...` | 같은 멱등 키로 다른 내용의 세션을 만들려 했다 | 키를 주문 번호처럼 DB마다 겹치는 값으로 만들지 않았는지(2단계 실험) |
| 409 `결제 시도가 취소됐습니다 - 다시 결제합니다` | 같은 키의 다른 요청이 보상으로 주문을 취소했다 | 다시 결제하면 새 주문이 된다(2단계) |
| 웹훅이 400, `No signatures found matching the expected signature for payload` | 받은 바이트가 아니라 파싱한 본문으로 검증했거나, 비밀이 다르다 | `rawBody: true`, `req.rawBody`(3단계 실험 ①), `STRIPE_WEBHOOK_SECRET`이 지금 `stripe listen`의 것인지 |
| 웹훅이 400, `No stripe-signature header value was provided` | `Stripe-Signature` 헤더가 없다. Stripe가 아닌 곳에서 보낸 요청이다 | 요청을 보낸 쪽(3단계) |
| 웹훅이 400, `웹훅 서명 검증 실패: STRIPE_WEBHOOK_SECRET 환경변수가 없습니다` | 웹훅 비밀이 서버에 없다 | 백엔드 `.env.local`의 `STRIPE_WEBHOOK_SECRET`, 서버를 다시 켰는지(1장, 3단계) |
| 웹훅이 400, `Timestamp outside the tolerance zone` | 서명한 지 5분이 지났다 | 녹화한 요청을 다시 보냈는지, 서버 시계(3단계) |
| 웹훅이 500이고 같은 이벤트가 계속 온다 | 처리 중 에러. Stripe는 2xx를 받을 때까지 다시 보낸다 | Nest 로그의 에러(3단계) |
| 웹훅은 200인데 주문이 그대로, `result`가 `"ignored"` | 세션 id가 이 DB의 주문에 없다(다른 DB의 주문이거나, 세션 저장 전에 실패했다), 또는 RLS에 막혀 안 보인다 | `orders.stripe_session_id`, `asAdmin`으로 조회하는지(3단계) |
| `TS2339: Property 'payment_status' does not exist on type 'Application \| BankAccount \| ...'` | `event.type`으로 좁히기 전에 `data.object`를 읽었다 | `handle` 첫 줄의 종류 거르기(3단계) |
| Nest 로그에 `이미 처리한 웹훅: evt_...` | 정상. 같은 이벤트가 다시 와서 한 번만 처리했다 | 할 일 없음(4단계) |
| `order.paid` 알림이 웹훅을 받은 횟수만큼 쌓인다 | 이벤트 기록과 조건부 UPDATE가 빠졌다 | `stripeEvent.create`, `updateMany`의 `paid: false` 조건(4단계) |
| `stripe events resend`가 `No CLI endpoints found to retry delivery` | 그 계정을 듣는 `stripe listen`이 지금 없다 | `stripe listen` 터미널의 `STRIPE_SECRET_KEY`와 `--api-key`(5단계) |
| `zsh: no such file or directory: evt_...` | 꺾쇠(`<...>`) 자리 표시를 그대로 쳤다 | 꺾쇠를 빼거나 변수로(5단계) |
| `stripe checkout sessions expire`는 `expired`인데 재고가 그대로다 | 만료는 백엔드 키의 샌드박스에서 됐는데 `stripe listen`은 CLI 로그인 샌드박스를 듣는다 | `curl https://api.stripe.com/v1/account -u "$STRIPE_SECRET_KEY:"`의 `id`, `stripe listen --api-key`(5단계, 1장) |
| 결제 화면을 닫았는데 재고가 안 돌아온다 | 세션이 아직 만료 전이다(기본 24시간) | 도전 과제 1(5단계) |
| 결제하고 돌아왔는데 계속 `결제 대기` | 웹훅이 아직 안 왔다 | `stripe listen`이 켜져 있는지, 1장의 계정 문제(6단계) |
| `AssertionError: expected 'processed' to be 'duplicate'` | 테스트가 중복 처리를 잡았다 | 이벤트 id 기록(8단계) |
| 백엔드 e2e에서 서명이 맞는 웹훅까지 전부 400 | 테스트 앱에 `rawBody`가 없다 | `createNestApplication({ rawBody: true })`(8단계) |
| 백엔드 e2e가 무더기로 실패, 로그에 `DriverAdapterError: ColumnNotFound` | 테스트 DB가 옛 스키마다(개발 DB에만 마이그레이션했다) | 테스트 DB의 `migrate status`, `migrate deploy`(1단계, 8단계) |
| 프론트 e2e가 `Error: duplicate test title ...`로 바로 멈춘다 | 같은 제목의 테스트가 한 파일에 둘 있다. Playwright는 제목으로 테스트를 구분한다 | 메시지의 두 줄 번호를 보고 하나를 지운다(8단계 작업 3) |
| 프론트 e2e에서 `결제하면 재고와 내 주문이 다시 받아 와진다`가 실패(테스트 13개) | 옛 테스트가 남아 "결제 완료" 문구를 기다린다 | `e2e/shop.spec.ts`에서 그 테스트를 지웠는지(8단계 작업 3) |
| 프론트 e2e의 결제 테스트가 `결제 실패`로 끝난다 | 백엔드가 실제 Stripe에 세션을 못 만들었다 | 백엔드 `.env.local`의 `STRIPE_SECRET_KEY`(8단계) |

### 시험해보기

```sh
# 백엔드
cd order-api-nest && npm run start:dev
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:4000/payments/webhook --events checkout.session.completed,checkout.session.expired
npm run test:e2e # 28 passed

# 프론트
cd ../order-console-next
npm run test:e2e # 11 passed, 1 skipped
STRIPE_E2E=1 npx playwright test e2e/stripe-payment.spec.ts # 실제 테스트 결제
```

### 도전 과제

#### 1. 세션 기한 줄이기

결제 화면을 닫아 버리면 재고가 24시간 묶인다. 세션의 `expires_at`을 30분으로 줄여 본다.

2단계의 Stripe 멱등 키와 부딪히는 점을 어떻게 풀 것인가? 같은 키로 다시 부를 때 `expires_at`이 달라진다.

**답**

1. `expires_at`을 "지금 + 30분"으로 계산하면, 같은 결제 시도로 다시 부를 때마다 값이 달라진다. 멱등 키는 같은데 내용이 다르니 2단계 실험에서 본 `Keys for idempotent requests can only be used with the same parameters ...`의 경우가 된다.

2. 그래서 기준을 "지금"이 아니라 **주문을 만든 시각**(`orders.created_at`)으로 잡는다. `checkout`이 세션을 만들기 전에 주문의 `createdAt`을 읽고, `expires_at = createdAt(초) + 35분`을 `createCheckoutSession`에 넘긴다. 같은 `Idempotency-Key`로 다시 오면 `placeOrReplay`가 같은 주문을 돌려주므로 `createdAt`도 같고, `expires_at`도 같다.

3. 30분이 아니라 35분인 이유: SDK 타입 설명대로 `expires_at`은 세션을 만든 때로부터 30분~24시간이어야 한다. 주문을 만든 뒤 세션을 만들기까지 걸린 시간만큼 30분보다 짧아지지 않게 여유를 둔다.

4. 테스트용 Stripe가 받은 값을 기록하게 하고, 같은 `Idempotency-Key`로 1.5초 간격을 두고 두 번 결제하면 같은 주문, 같은 멱등 키, 같은 `expires_at`이 나온다. `expires_at`과 주문 생성 시각의 차이는 2100초(35분)다. 백엔드 e2e는 이 테스트를 더해 29개가 통과한다.

> 보상으로 주문이 취소된 뒤의 재시도는 새 주문이라 `createdAt`도 멱등 키(주문 번호가 들어간다)도 새로 정해진다. 그래서 이 경우에도 부딪히지 않는다.

#### 2. 취소하면 바로 재고 돌려주기

Stripe 결제 화면에서 "뒤로"를 누르면 `cancel_url`(`/shop?checkout=canceled`)로 온다.

이때 세션을 바로 만료시켜(`stripe.checkout.sessions.expire`) 재고를 즉시 돌려주는 엔드포인트를 만든다. 남의 주문을 만료시키지 못하게 하는 조건도 넣는다.

어떤 순서로 처리하고, 남의 주문은 어떻게 막는가?

**답**

1. 프론트가 어느 주문인지 알 수 있게 `cancel_url`에 주문 번호를 붙인다(`/shop?checkout=canceled&order=<주문 번호>`).

2. `POST /orders/:id/cancel-checkout`(로그인 필요)을 만든다. 주문은 `asUser`로, `id`와 `userId`를 함께 조건으로 찾는다. RLS가 남의 행을 숨기고 조건이 한 번 더 막아서, 남의 주문이면 404다.

3. 이미 결제된 주문이면 409, 이미 취소된 주문이면 아무것도 하지 않고 `canceled: false`를 돌려준다.

4. 먼저 Stripe에서 세션을 만료시킨다(`stripe.checkout.sessions.expire`). 재고를 돌려준 뒤에 그 결제 화면으로 결제되는 일이 없게 하려는 순서다. 만료에 실패하면(다른 탭에서 결제를 마쳐 세션이 열려 있지 않다) 409로 끝내고 취소하지 않는다. 결제 완료는 웹훅이 정한다.

5. 만료에 성공하면 만료 웹훅과 같은 `cancelUnpaidOrder`로 주문을 취소하고 재고를 돌려준다. 뒤늦게 Stripe의 만료 웹훅이 와도 조건부 UPDATE라 재고는 한 번만 돌아온다.

6. 프론트의 `/shop`은 `checkout=canceled`와 `order`를 읽으면 이 엔드포인트를 부르고, 성공하면 상품 목록과 내 주문 쿼리를 다시 읽는다. `useSearchParams`를 쓰는 부분은 `Suspense`로 감싼다.

7. 백엔드 e2e(테스트용 Stripe)에 세 경우를 더하면 31개가 통과한다. 내 주문은 재고 7에서 10이 되고, 두 번째 호출과 나중에 온 만료 웹훅 뒤에도 10이다. 남의 주문은 404, 결제된 주문과 결제가 끝난 세션은 409이고 재고는 그대로다.

8. 브라우저에서 `/shop?checkout=canceled&order=9`로 돌아오면 `주문 #9 결제를 취소했다 - 재고를 돌려놓았다`가 뜨고 마우스 재고가 98에서 100으로 바뀐다. 남의 주문 번호로 오면 `결제 취소 실패: order 10 not found`다.

#### 3. 결제 완료를 WebSocket으로 알리기

결제 완료 알림(`order.paid`)을 앞에서 만든 WebSocket으로 보낸다. 주문 상세 화면이 1초마다 묻지 않고, 알림을 받으면 다시 읽게 바꾼다.

무엇이 달라지는가?

**답**

1. 백엔드는 고칠 것이 없다. 웹훅이 기록한 `order.paid` outbox를 `OutboxRelay`가 이미 `notifyUser`로 그 사용자의 방(`user:<id>`)에 보낸다. 받는 값은 `{ eventId, orderId }`다. 주문 번호는 `id`가 아니라 `orderId`에 있다.

2. 프론트의 `dependencies`에 `socket.io-client`를 더한다. 백엔드 개발용으로 이미 잠금 파일에 있는 4.8.4다.

3. 주문 상세 화면은 결제 대기인 동안만 `io(API_URL, { auth: { token } })`로 붙는다. 토큰은 메모리의 액세스 토큰이라, 새로고침 직후에는 주문 조회가 refresh로 토큰을 받은 뒤에 붙는다.

4. `order.paid`의 `orderId`가 이 화면의 주문이면 `me.order`와 `me.orders`를 `invalidateQueries`로 다시 읽는다. 붙은 직후(`connect`)에도 한 번 다시 읽는다. 붙기 전에 웹훅이 먼저 처리됐으면 그 알림은 받지 못하기 때문이다. `refetchInterval`은 지운다.

5. 그대로 띄우면 콘솔에 `Connecting to 'ws://localhost:4000/socket.io/...' violates the following Content Security Policy directive: "connect-src ..."`가 찍힌다. `connect-src`에 `http://` 주소만 있어 WebSocket 연결이 막히고, socket.io는 HTTP 롱 폴링으로만 동작한다. `proxy.ts`의 `connect-src`에 API 주소의 `ws://` 판을 더하면 WebSocket으로 붙는다.

6. 결제 대기 화면을 열어 두고 5초 동안 보면 tRPC 요청이 0번이다. 서명한 `checkout.session.completed` 웹훅을 보내면 약 0.4~1초 뒤 `결제 완료`로 바뀌고, 그때 나간 요청은 `me.order,me.orders`를 묶은 1번뿐이다.

> 알림은 0.5초마다 도는 `OutboxRelay`를 거쳐 나간다. 웹훅이 오기 전에는 요청이 하나도 나가지 않는다.

## 11. 완성 확인

- [ ] 결제를 누르면 재고가 예약되고 주문은 결제 대기, 브라우저는 Stripe 결제 화면으로 간다
- [ ] 같은 Idempotency-Key로 다시 누르면 같은 주문, 같은 결제 화면이 나온다
- [ ] 테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾸고 `order.paid` 알림이 한 번 기록된다
- [ ] 파싱한 본문으로 서명을 검증하면 400이 되는 것을 재현했고, `rawBody`로 고쳤다
- [ ] 같은 웹훅을 다시 받으면 알림이 쌓이는 것을 재현했고, 이벤트 기록과 조건부 UPDATE로 막았다
- [ ] 세션이 만료되면 주문이 취소되고 재고가 돌아온다
- [ ] 웹훅이 늦게 와도 주문 화면이 결제 대기에서 결제 완료로 바뀐다
- [ ] 백엔드 e2e 28개, 프론트 e2e 11개(실제 결제 1개는 선택)가 통과한다

## 12. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. Stripe Checkout을 쓰면 카드 번호는 어디를 지나가는가? 그게 왜 중요한가?

2. `success_url`로 돌아온 것을 결제 완료의 근거로 쓰면 안 되는 이유 두 가지는?

3. 웹훅 서명은 무엇을 증명하는가? 왜 `req.body`가 아니라 `req.rawBody`로 검증해야 하는가?

4. Stripe 세션 생성을 결제 트랜잭션 밖에서 하는 이유는?

5. 우리 쪽 Idempotency-Key와 Stripe 쪽 멱등 키는 각각 무엇을 막는가? 하나만 있으면 어떤 일이 생기는가?

6. Stripe 멱등 키를 주문 번호로 만들면 어떤 상황에서 깨지는가? 결제 시도 키로 바꾸면 왜 괜찮은가?

7. 같은 웹훅이 두 번 올 때를 이벤트 id 기록과 조건부 UPDATE 두 겹으로 막았다. 각각이 막는 것은?

8. 웹훅에서 주문을 `metadata.orderId`가 아니라 세션 id로 찾은 이유는?

9. 결제는 됐는데 `stripe listen`이 조용하다면 무엇부터 확인하는가?

### 선택 과정: 토스페이먼츠를 함께 붙이기

이 문서는 Stripe 하나로 마감한다. 국내 PG인 토스페이먼츠를 함께 붙여 사용자가 결제사를 고르게 하는 일은 30단계 다음의 선택 과정으로 미뤄 둔다.

여기서 하지 않는 이유는 두 가지다.

1. **결제를 확정하는 흐름이 다르다.** Stripe는 결제가 끝나면 웹훅이 알려 준다. 토스는 브라우저가 SDK로 결제창을 열고, `successUrl`로 돌아온 뒤 **우리 서버가 승인 API를 불러야** 확정된다(인증 뒤 10분 안). 돌아온 금액도 서버가 DB의 주문과 대조해야 한다. 그래서 `StripeGateway`를 바꿔 끼우는 것으로 끝나지 않는다. 확정 시점과 주체가 다른 두 흐름을 같은 주문 상태(0장 개념 4)로 받도록 결제 계층을 나눠야 한다.

2. **이후 단계가 이 문서의 이름을 그대로 쓴다.** `orders.stripe_session_id`, `stripe_events`가 이후 단계의 코드와 마이그레이션 이력에 이어진다. 여기서 이름을 바꾸면 이후 단계가 모두 달라진다. 대신 배포된 서비스에서 이 이름을 결제사와 상관없는 이름으로 무중단 전환하는 일 자체가 그 과정의 주제가 된다.

그 과정에서 다룰 것(예정):

- 결제사 인터페이스(결제 시작·상태 조회)와 결제사별 승인·웹훅

- 결제사와 상관없는 스키마(`payment_provider`, `payment_ref`, `payment_events`)로의 무중단 전환

- 토스 결제창과 승인 API, 돌아온 금액 검증, 승인 실패와 응답 없음의 구분

- 알림이 오지 않는 결제 대기를 결제사에 물어 정리하는 작업(토스는 결제창을 닫아도 아무 알림이 없다)

- 토스용 테스트 대역과 결제사별 E2E

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 환불과 부분 환불, 분쟁(차지백) 웹훅

- 결제가 나중에 확정되는 수단(계좌이체 등)과 `checkout.session.async_payment_succeeded`

- 운영용 웹훅 엔드포인트 등록(대시보드에서 등록하고 그 엔드포인트의 서명 비밀을 쓰기)과 엔드포인트의 IP 제한

- 구독(정기 결제), 쿠폰, 세금 계산

- 결제 화면을 우리 페이지 안에 넣는 방식(Payment Element, 공개 키 `pk_test_...` 사용)

- 국내 PG와 결제사 여러 개(위 "선택 과정: 토스페이먼츠를 함께 붙이기")
