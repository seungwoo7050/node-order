# tRPC: 백엔드의 타입을 프론트가 그대로 쓰기

## 목표

이 프로젝트는 [`11-service-worker`](https://github.com/seungwoo7050/node-order/tree/11-service-worker)로부터 시작한다.

지금까지 프론트는 백엔드 응답의 모양을 손으로 다시 적었다(`type MyOrder = { id: number; price: number; ... }`).

백엔드가 응답을 바꿔도 프론트의 타입 검사는 모른다. 화면이 실제로 깨져야 알게 된다.

이 문서는 tRPC로 백엔드 함수의 타입을 프론트가 직접 가져다 쓰게 만든다.

1. REST에서 백엔드 응답이 바뀌면 프론트가 실행 중에야 깨지는 것을 재현한다

2. 백엔드(Nest)에 tRPC를 붙이고, 프론트(Next)를 같은 저장소의 워크스페이스로 묶는다

3. 같은 변경을 tRPC로 하면 프론트의 타입 검사가 빌드 전에 잡는 것을 본다

4. 입력 검증(zod), 에러 감추기, Nest 예외 변환, 묶음 요청(batching)을 차례로 붙인다

5. 저장소 구조가 바뀌면서 깨지는 Docker 빌드를 고친다

```sh
백엔드가 "내 주문" 응답을 배열에서 { items, total }로 바꿨습니다

REST : 프론트 tsc 에러 없음 → 화면에서 "e.map is not a function"
tRPC : 프론트 tsc
       app/me/orders/my-order-list.tsx(17,13): error TS2339: Property 'map' does not exist on type
       '{ items: { price: number; id: number; paid: boolean; createdAt: string; }[]; total: number; }'.
```

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 원복은 뒤에 `[원복]` 작업이 있으면 그때, 없으면 확인한 바로 뒤에 한다 |
| `진단 N.` | 10장에서 "어느 층에서 틀어졌나"를 가르는 절차 | 친다(`curl`, `tsc`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 10장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 뒤의 대괄호는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가를 수 있다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드 작성·수정, 설정 파일, 패키지 설치(`package.json`·잠금 파일) | 한다 |
| `[실행]` | 저장소 밖의 상태: 컨테이너, DB 데이터(시드), `.gitignore`에 걸린 `.env.local`. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 타입 검사, 빌드, `curl`, 화면·로그 읽기 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

  한 작업에 여러 성격이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 10장 "진단 3"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`과 `용어`만 있다. 11·12장은 확인 명령과 체크리스트, 자가 점검이라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | 헤더 파일을 공유하는 C 프로그램에 빗대 tRPC가 무엇을 넘기는지 보고, RPC·gRPC·REST 사이에서 tRPC의 자리를 잡는다(작업 없음) |
| [1. 준비: 두 프로젝트를 워크스페이스로 묶기](#1-준비-두-프로젝트를-워크스페이스로-묶기) | 백엔드와 프론트를 npm 워크스페이스 하나로 묶고 백엔드를 띄운다 |
| [2. 1단계: 일부러 깨뜨려보기 ①, REST에서 응답 모양이 바뀌면](#2-1단계-일부러-깨뜨려보기-①-rest에서-응답-모양이-바뀌면) | REST 응답 모양을 바꿔 타입 검사는 통과하고 화면만 깨지는 것을 본다 |
| [3. 2단계: 백엔드에 tRPC 붙이기](#3-2단계-백엔드에-trpc-붙이기) | 컨텍스트·라우터를 만들고 Nest 미들웨어로 `/trpc`에 붙인다 |
| [4. 3단계: 프론트에서 백엔드 타입 쓰기](#4-3단계-프론트에서-백엔드-타입-쓰기) | `AppRouter` 타입을 가져와 화면을 tRPC로 바꾸고, 같은 변경이 빌드 전에 잡히는 것을 본다 |
| [5. 4단계: 입력 검증과 에러 응답](#5-4단계-입력-검증과-에러-응답) | 내부 에러를 감추고 zod로 입구에서 검증한다 |
| [6. 5단계: 일부러 깨뜨려보기 ⑤, Nest 예외는 tRPC가 모른다](#6-5단계-일부러-깨뜨려보기-⑤-nest-예외는-trpc가-모른다) | 서비스가 던진 Nest 예외를 tRPC 에러로 바꾸는 미들웨어를 붙인다 |
| [7. 6단계: 묶음 요청과 링크 나누기](#7-6단계-묶음-요청과-링크-나누기) | 요청 두 개가 HTTP 하나로 묶이는 것과, 링크를 둘로 나눈 이유(207)를 본다 |
| [8. 7단계: 모노레포가 바꾸는 Docker 빌드](#8-7단계-모노레포가-바꾸는-docker-빌드) | 빌드 컨텍스트를 워크스페이스 루트로 넓혀 이미지를 다시 만든다 |
| [9. 8단계: 테스트](#9-8단계-테스트) | `createCaller` 회귀 테스트와 묶음 요청 e2e를 붙인다 |
| [10. 디버깅](#10-디버깅) | 프로시저를 손으로 부르고, 증상으로 원인을 가른다 |
| [11. 완성 확인](#11-완성-확인) | 한 번에 확인하는 명령과 체크리스트 |
| [12. 다음 단계](#12-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | 지금은 헤더 파일 없이 구조체를 주고받고 있다.

C로 서버와 클라이언트를 따로 짜면서 구조체를 소켓으로 주고받는다고 하자.

두 프로그램이 같은 헤더 파일을 `#include`하면, 서버 쪽 구조체에 칸을 바꿨을 때 클라이언트를 다시 컴파일하는 순간 에러가 난다.

반대로 헤더를 공유하지 않고 양쪽에 구조체를 따로 적어 두면 컴파일은 둘 다 통과한다. 그리고 실행하면 엉뚱한 값을 읽는다.

지금의 REST + JSON이 두 번째 경우다.

백엔드는 Prisma 타입에서 응답을 만들고, 프론트는 `type MyOrder = {...}`를 따로 적는다. 둘을 이어 주는 것이 없다.

tRPC는 첫 번째 경우를 만든다. **백엔드의 라우터 타입이 공유 헤더 역할을 한다.**

프론트가 그 타입을 `import type`으로 가져오면, 백엔드 함수의 입력·출력 타입이 프론트의 타입 검사에 그대로 들어간다.

### 개념 2 | 프로시저는 이름이 붙은 함수다.

REST는 "메서드 + 경로"(`GET /me/orders`)로 기능을 부른다. tRPC는 이름(`me.orders`)으로 부른다.

원격 함수 호출(RPC)이다. 그래도 밑에서는 그냥 HTTP다(RPC 자체와 gRPC는 개념 3).

| 종류 | 용도 | HTTP |
|---|---|---|
| `query` | 읽기 | `GET /trpc/me.orders?input=...` |
| `mutation` | 쓰기 | `POST /trpc/orders.checkout` |

그래서 `curl`로도 부를 수 있고, 브라우저 Network 탭에도 보인다.

이 문서는 읽기(`query`)만 tRPC로 옮기고, 결제·로그인·업로드 같은 쓰기는 지금의 REST를 그대로 둔다.

둘은 한 서버에서 함께 돈다.

### 개념 3 | RPC는 원격 함수를 내 함수처럼 부르는 방식이고, gRPC와 tRPC는 그 구현이다.

#### RPC: 함수 호출을 네트워크 너머로 늘린다

C에서 `int n = count_orders(user_id);`를 부르면 인자가 스택에 올라가고, 같은 프로세스 안의 함수로 점프했다가 반환값을 들고 돌아온다.

RPC(Remote Procedure Call)는 그 함수가 다른 기계에 있어도 부르는 쪽 코드를 똑같이 쓰게 하려는 생각이다. 1980년대부터 있던 오래된 생각이다.

부르는 쪽에는 진짜 함수 대신 가짜 함수(스텁, stub)가 있어서 그 사이를 대신 처리한다.

```text
클라이언트                                   서버
count_orders(7)                              count_orders(7)   ← 진짜 함수
  └ 스텁: 함수 이름과 인자를 바이트로 바꾼다    ↑ 스텁: 바이트를 인자로 되돌려 진짜 함수를 부른다
      └──────────────── 네트워크 ───────────────┘
  ← 반환값도 같은 길을 거꾸로 온다
```

RPC라면 어떤 것이든 네 가지를 정한다.

| 정할 것 | 질문 |
|---|---|
| 계약 | 어떤 함수가 있고, 인자와 반환값의 모양은 무엇인가 |
| 이름 | 서버에게 "어느 함수"를 부르는지 어떻게 알리나 |
| 직렬화 | 인자와 반환값을 어떤 바이트로 바꾸나 |
| 전송 | 그 바이트를 무엇에 실어 보내나 |

개념 1의 "공유 헤더 파일"이 첫 줄, 계약이다. 실제로 C 시절의 RPC(Sun RPC. NFS가 이것으로 돈다)는 `.x`라는 계약 파일을 `rpcgen`에 넣으면 양쪽이 `#include`할 헤더와 스텁 C 코드를 만들어 냈다.

#### 스텁은 왜 필요한가: 네트워크는 함수가 아니라 바이트만 나른다

같은 프로세스 안의 함수 호출은 CPU의 `call` 명령 하나다. 인자는 같은 메모리(스택·레지스터)에 있고, 포인터도 그대로 통한다. 그리고 함수는 반드시 돌아온다.

다른 기계에 있는 함수에는 이 중 어느 것도 통하지 않는다. 두 프로그램 사이에 있는 것은 소켓 하나이고, 소켓이 하는 일은 바이트 배열을 보내고(`send`) 받는(`recv`) 것뿐이다.

그래서 "함수를 부른다"를 "바이트를 주고받는다"로 바꿔 줄 코드가 필요하다. 스텁이 없으면 부르는 곳마다 그 코드를 직접 적어야 한다.

```c
// 스텁 없이 count_orders(7)을 부르려면(읽기만 하는 코드. put_string·recv_all은 설명용으로 지어낸 도우미다)
int fd = socket(AF_INET, SOCK_STREAM, 0);
connect(fd, (struct sockaddr *)&server, sizeof server);   // ① 어디로: 서버의 IP와 포트

uint8_t buf[64];
size_t n = put_string(buf, "count_orders");               // ② 어느 함수: 이름을 바이트로
uint32_t arg = htonl(7);                                  // ③ 인자: 바이트 순서(엔디언)까지 정해서
memcpy(buf + n, &arg, 4); n += 4;

uint32_t len = htonl(n);
send(fd, &len, 4, 0);                                     // ④ 경계: 메시지 길이를 먼저 보낸다
send(fd, buf, n, 0);

recv_all(fd, &len, 4);                                    // ⑤ 응답 길이를 읽고, 그만큼 다 올 때까지 기다린다
recv_all(fd, buf, ntohl(len));
uint32_t r; memcpy(&r, buf, 4);
int result = ntohl(r);                                    // ⑥ 반환값: 바이트를 다시 int로
// ⑦ 연결이 끊기면? 응답이 영영 안 오면? 서버가 "그런 함수 없다"고 답하면?
```

번호마다 "함수 호출에서는 공짜였던 것"이 하나씩 문제가 된다.

| | 같은 프로세스의 함수 호출 | 네트워크 너머 | 누가 맡나 |
|---|---|---|---|
| ① 어디로 | 함수 주소(메모리) | 다른 기계의 IP와 포트 | IP, TCP |
| ②③⑥ 이름·인자·반환값 | 같은 메모리에 그대로 있다 | 바이트로 바꿔야 한다. 엔디언, 구조체 패딩이 기계마다 다르고 포인터는 상대 기계에서 아무 뜻이 없다 | 직렬화 형식(JSON, protobuf) |
| ④⑤ 메시지 경계 | 없다(인자 개수가 정해져 있다) | TCP는 바이트의 흐름이다. `send` 두 번이 `recv` 한 번에 붙어 오거나, 한 번이 둘로 쪼개져 온다. 어디서 끝나는지 따로 표시해야 한다 | HTTP(`Content-Length` 헤더 등), gRPC(메시지마다 길이 접두) |
| ⑦ 실패 | 함수는 반드시 돌아온다 | 끊김, 시간 초과, "요청은 갔는데 응답만 잃음" | 스텁이 에러로 바꿔 준다. 타임아웃과 재시도는 부르는 쪽이 정한다 |

스텁은 ①~⑦을 한곳에 모아 둔 함수다. 부르는 쪽은 `count_orders(7)`만 적고, 바이트 이야기는 스텁 안에 갇힌다.

이 문서의 tRPC 호출 하나도 같은 층을 지나간다.

```text
층          이 문서에서                                                 맡는 일
tRPC 스텁   trpc.me.orders  →  GET /trpc/me.orders?input=...            이름·인자
JSON        응답 객체  ↔  {"result":{"data":[...]}} 라는 글자 바이트       직렬화
HTTP/1.1    요청 줄, 헤더(Authorization 등), Content-Length              메시지 경계, 부가 정보
TCP         바이트를 순서대로, 빠짐없이 나른다. 메시지 경계는 모른다         전송
IP          localhost:4000 으로                                          주소
```

gRPC는 JSON 자리에 protobuf, HTTP/1.1 자리에 HTTP/2가 들어간다. 아래 TCP·IP는 같다.

> 이 문서의 REST 코드에도 스텁이 있다. `authFetch<MyOrder[]>("/me/orders")`가 ①~⑥을 한다(`fetch`가 HTTP를 만들고, 응답을 JSON으로 읽어 돌려준다). 다만 사람이 손으로 쓴 스텁이라, 반환 타입 `MyOrder[]`도 사람이 적은 약속일 뿐이다. 2장에서 깨지는 곳이 여기다. tRPC의 `trpc.me.orders`는 라이브러리가 만든 스텁이고, 반환 타입을 서버 라우터에서 가져온다. **RPC 도구들의 차이는 결국 "스텁을 누가 만들고, 스텁의 타입이 어디서 오나"다.**

#### REST는 함수가 아니라 자원으로 부른다

REST는 함수 이름("무엇을 할까") 대신 자원 경로("무엇에 대해")와 HTTP 메서드로 부른다. `GET /me/orders`, `POST /orders/1/checkout`처럼.

계약은 규격에 들어 있지 않다. 문서로 따로 적거나(OpenAPI), 이 문서의 2장처럼 아예 없다.

#### gRPC: 계약 파일에서 양쪽 코드를 만들어 낸다

gRPC는 구글이 사내에서 쓰던 RPC를 2015년에 공개한 것이다. 네 칸을 이렇게 채운다.

- 계약: `.proto` 파일(Protocol Buffers 문법). 여기서 각 언어의 스텁 코드를 생성한다(`protoc`)

- 이름: `/패키지.서비스/메서드` 경로

- 직렬화: Protocol Buffers(protobuf). JSON 같은 글자가 아니라 바이너리다

- 전송: HTTP/2

이 문서의 `me.orders`를 gRPC로 적으면 이런 모양이다(이 저장소에는 없는 파일이다. 읽기만 한다).

```proto
// order.proto
syntax = "proto3";

service MeService {
  rpc ListOrders (ListOrdersRequest) returns (ListOrdersResponse);
}

message ListOrdersRequest {}

message Order {
  int32 id = 1;          // "= 1"은 기본값이 아니라 필드 번호다. 바이트에는 이름 대신 이 번호가 실린다
  int32 price = 2;
  bool paid = 3;
  string created_at = 4;
}

message ListOrdersResponse {
  repeated Order items = 1;   // repeated = 배열
}
```

`protoc`이 이 파일 하나에서 Go 서버용 코드와 TypeScript 클라이언트용 코드를 따로 만든다. 서버와 클라이언트의 언어가 달라도 된다.

응답 모양을 바꾸고 코드를 다시 생성하면, 클라이언트 컴파일에서 에러가 난다. 개념 1의 첫 번째 경우(헤더 공유)다.

#### tRPC: 계약 파일 없이 TypeScript 타입을 그대로 쓴다

| | REST | gRPC | tRPC |
|---|---|---|---|
| 계약 | 없음, 또는 OpenAPI 문서 | `.proto` 파일 | 백엔드 라우터의 TypeScript 타입(`AppRouter`) |
| 계약을 클라이언트에 넘기는 법 | 사람이 읽고 다시 적는다(OpenAPI면 생성도 된다) | 코드 생성 | `import type`(생성 없음) |
| 부르는 단위 | HTTP 메서드 + 자원 경로 | 서비스.메서드 | 프로시저 이름(`me.orders`) |
| 직렬화 | 대개 JSON | protobuf(바이너리) | JSON |
| 전송 | HTTP | HTTP/2 | HTTP |
| 양쪽 언어 | 아무거나 | 생성기가 있는 언어 거의 전부 | 둘 다 TypeScript |
| 브라우저에서 직접 | 된다 | 안 된다(gRPC-Web과 프록시가 필요) | 된다 |
| 주로 쓰는 곳 | 공개 API, 프론트↔백엔드 | 백엔드↔백엔드(마이크로서비스) | 한 저장소의 TS 프론트↔TS 백엔드 |

tRPC는 네 칸 중 계약과 이름만 RPC답게 바꾸고, 직렬화와 전송은 REST와 똑같이 JSON over HTTP로 둔다. 그래서 `curl`로 부를 수 있고 Network 탭에 글자로 보인다.

gRPC는 네 칸을 전부 자기 것으로 채운다. 바이너리라 작고, HTTP/2 연결 하나에 여러 호출과 스트리밍을 함께 흘려보낸다.

대신 `curl`로 손쉽게 부를 수 없어 `grpcurl` 같은 전용 도구를 쓴다. 브라우저는 자바스크립트에 HTTP/2를 그만큼 낮은 수준으로 열어 주지 않아서 직접 부르지 못한다.

#### 채용 공고에서 gRPC를 보면

"서비스 간 통신에 gRPC"라는 문장은 대개 이런 구성을 뜻한다.

```text
브라우저 ──REST/JSON(또는 GraphQL)──▶ API 게이트웨이·BFF ──gRPC──▶ 주문 서비스(Go)
                                                        └──gRPC──▶ 결제 서비스(Java)
```

브라우저 쪽은 REST, 안쪽 서버끼리는 gRPC다. 언어가 서로 다른 팀들이 `.proto` 파일 하나를 계약으로 나눠 갖는다.

tRPC가 공고에 덜 보이는 것도 같은 이유다. 양쪽이 TypeScript이고 한 저장소에 있어야 장점이 살아서, 프론트와 그 프론트 전용 백엔드 사이에 주로 놓인다.

#### 이 문서에 남은 RPC의 흔적

tRPC 에러 응답에는 `"code":-32004` 같은 숫자가 붙는다(3장 작업 5, 10장 진단 2).

JSON-RPC 2.0이라는 JSON 기반 RPC 규격의 에러 번호다. `-32600`·`-32603`은 규격에 정해진 번호이고, `-32001`·`-32004`는 규격이 구현에 맡겨 둔 칸(`-32000`~`-32099`)에 tRPC가 정한 번호다.

> RPC가 함수 호출처럼 보여도 함수 호출은 아니다. 네트워크는 늦거나 끊긴다. 부르는 쪽에는 늘 타임아웃과 에러 처리가 필요하고, 실패했을 때 다시 보내도 되는지(읽기 `query`는 된다, 결제 같은 쓰기는 조심한다)를 따로 따져야 한다.

### 용어 | RPC 계열 단어 (채용 공고에서 보이는 것)

| 단어 | 뜻 |
|---|---|
| RPC | Remote Procedure Call. 다른 프로세스·기계의 함수를 함수 호출처럼 부르는 방식 |
| 스텁(stub) | 부르는 쪽에 있는 가짜 함수. 인자를 직렬화해 보내고 결과를 받아 돌려준다 |
| 직렬화(serialization, marshalling) | 메모리의 값을 보낼 바이트로 바꾸기. 반대는 역직렬화 |
| 소켓(socket) | 운영체제가 주는 네트워크 연결의 끝. 프로그램이 할 수 있는 것은 바이트를 보내고 받는 것뿐이다 |
| TCP | 바이트를 순서대로, 빠짐없이 나르는 전송 방식. 메시지가 어디서 끝나는지는 모른다 |
| 프레이밍(framing) | 바이트 흐름 위에 메시지 경계를 표시하는 방법. 길이를 앞에 붙이거나(`Content-Length`, gRPC 길이 접두) 구분자를 둔다 |
| 엔디언(endianness) | 여러 바이트로 된 수를 어느 쪽 바이트부터 적는가. 네트워크에서는 큰 쪽부터(빅 엔디언)가 관례라 C에서 `htonl`·`ntohl`로 바꾼다 |
| HTTP/2 | 연결 하나에 여러 요청·응답을 프레임으로 잘게 섞어 보내는 HTTP. gRPC가 이 위에서 돈다 |
| IDL | Interface Definition Language. 언어와 무관하게 계약을 적는 문법. `.proto`, Sun RPC의 `.x`, Thrift IDL |
| Protocol Buffers(protobuf) | 구글의 IDL이자 바이너리 직렬화 형식. gRPC의 기본 |
| gRPC | protobuf + HTTP/2로 된 RPC 프레임워크. 단건 호출과 스트리밍을 지원한다 |
| 스트리밍 RPC | 한 호출에 메시지를 여러 개 주고받기. gRPC는 서버→클라이언트, 클라이언트→서버, 양방향 세 가지가 있다 |
| gRPC-Web | 브라우저에서 gRPC를 부르기 위한 변형. 중간 프록시(Envoy 등)가 gRPC로 바꿔 준다 |
| JSON-RPC | JSON으로 된 단순한 RPC 규격(`{"method": ..., "params": ..., "id": ...}`). LSP(편집기↔언어 서버), MCP, 이더리움 노드 API가 쓴다 |
| Thrift | 페이스북에서 나온, gRPC와 비슷한 IDL + RPC |
| GraphQL | RPC는 아니지만 같이 자주 나온다. 스키마(계약) 하나를 두고 클라이언트가 필요한 필드를 골라 묻는 질의 언어. `query`/`mutation`이라는 이름을 tRPC와 같이 쓴다 |
| OpenAPI(Swagger) | REST API의 계약을 적는 문서 형식. 여기서 클라이언트 코드를 생성할 수도 있다 |
| BFF | Backend For Frontend. 특정 프론트 하나를 위한 백엔드. tRPC가 주로 놓이는 자리 |

### 개념 4 | 넘어가는 것은 타입뿐이다.

프론트는 `import type { AppRouter } from ...`로 타입만 가져온다.

`import type`은 컴파일할 때 지워진다. 그래서 백엔드 코드(Prisma, Nest, 비밀 값을 읽는 코드)는 프론트 번들에 한 줄도 들어가지 않는다.

> 다만 타입을 계산하려면 프론트의 TypeScript가 백엔드 소스 파일을 읽고 검사해야 한다. 이 점이 3단계의 함정이 된다.

프론트가 백엔드 소스를 읽으려면 두 프로젝트가 한 저장소 안에서 서로를 찾을 수 있어야 한다.

그래서 둘을 워크스페이스(모노레포)로 묶는다.

## 1. 준비: 두 프로젝트를 워크스페이스로 묶기

### 작업 1. [커밋] 두 프로젝트를 한 폴더로 가져오기

각자 설치했던 의존성과 잠금 파일, 빌드 결과는 지운다. 이제 루트에서 한 번에 설치한다.

```sh
rm -rf order-api-nest/node_modules order-api-nest/dist order-api-nest/package-lock.json \
       order-console-next/node_modules order-console-next/.next order-console-next/package-lock.json
```

루트에 `.gitignore`를 둔다. 각 프로젝트 폴더에도 자기 `.gitignore`가 있지만, 루트에 생기는 `node_modules`는 루트의 것이 막는다.

```text
# .gitignore
# 이 브랜치 공통(각 프로젝트 폴더에도 자기 .gitignore가 있다)
node_modules/
dist/
.next/
test-results/
playwright-report/
*.tsbuildinfo
.env.local
.DS_Store
```

### 작업 2. [커밋] 루트 package.json 만들고 설치하기

```jsonc
// package.json
{
  "name": "node-order",
  "private": true,
  "workspaces": ["order-api-nest", "order-console-next"]
}
```

첫 줄의 `// package.json`은 어느 파일인지 보이려고 적은 것이다. JSON에는 주석이 없으니 파일에는 넣지 않는다.

이 파일은 명령으로 만들지 않고 편집기로 직접 쓴다. `npm init -y`로 만들어도 되지만, 그러면 루트에서는 쓸 일이 없는 칸(`version`, `main`, `scripts.test`, `license` 등)이 따라와 다시 지우게 된다. 루트에 필요한 것은 위의 세 칸뿐이다.

루트의 `name`은 이름표일 뿐이라 저장소 이름(`node-order`)과 맞춰 두었다. 다른 이름으로 바꾸려면 이 줄만 고치고 `npm install`을 한 번 더 하면 `package-lock.json` 맨 위의 이름도 따라 바뀐다. 그 밖에 이 이름으로 무언가를 찾는 곳은 없다.

워크스페이스의 이름(`order-api-nest`, `order-console-next`)은 다르다. 이것은 이름표가 아니라 주소다. 바꾸려면 그 이름으로 찾는 곳을 모두 같이 고쳐야 한다(아래 `용어 | npm 워크스페이스 설정`).

```sh
npm install

ls -la node_modules/order-api-nest
node_modules/order-api-nest -> ../order-api-nest
```

> npm 11 이후라면 설치 끝에 `install-scripts` 경고(설치 스크립트를 허락하지 않았다는 안내)가 나올 수 있다. 이 문서의 모든 확인은 그 경고가 나온 상태 그대로 했다.

### 작업 3. [실행] 백엔드 띄우기

`order-api-nest`에서 지금까지와 동일한 방식으로 백엔드를 띄운다

```sh
# order-api-nest/
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npm run start:dev
```

`npm run start:dev`, `npx prisma ...`, `npm run test:e2e`는 지금까지처럼 각 프로젝트 폴더에서 실행한다. 루트의 `node_modules/.bin`도 함께 찾아 준다.

### 작업 4. [실행] 프론트 환경변수 만들기

`.env.local`은 `.gitignore`에 들어 있어서 복사해 온 폴더에 없을 수 있다. 없으면 예시 파일에서 만든다.

```sh
# order-console-next/
cp .env.example .env.local
```

`NEXT_PUBLIC_API_URL=http://localhost:4000`이 들어 있는지 본다. tRPC 클라이언트도 이 주소 뒤에 `/trpc`를 붙여 요청한다.

### 용어 | npm 워크스페이스 설정

- `"workspaces": [폴더, ...]`: 이 폴더들을 한 저장소의 패키지로 묶는다. 설치는 루트에서 한 번 한다.

- 호이스팅: 두 프로젝트의 의존성을 루트의 `node_modules` 하나에 모은다. 잠금 파일(`package-lock.json`)도 루트에 하나다. 각 프로젝트가 루트에 있는 의존성을 어떻게 찾는지는 아래 "호이스팅과 심볼릭 링크로 패키지를 찾는 길"에서 다룬다.

- 심볼릭 링크: 각 프로젝트를 `node_modules` 안에 링크로 걸어 둔다. 그래서 프론트에서 `order-api-nest`라는 패키지 이름으로 백엔드를 찾을 수 있다.

- 링크 이름은 폴더 이름이 아니라 그 폴더 `package.json`의 `name`에서 온다. 폴더가 `b`이고 `name`이 `bee`면 `node_modules/bee -> ../b`가 생긴다. 이 문서는 둘을 같게 두었다. 그래서 워크스페이스의 `name`을 바꾸면 프론트의 `import type ... from "order-api-nest/trpc"`와 8장 Docker의 `npm ci -w order-api-nest`까지 같이 바꿔야 한다.

- `"name"`(루트): 루트의 이름표. `package-lock.json` 맨 위와 `npm ls` 첫 줄에 찍힐 뿐이다.

- `"private": true`: 이 패키지를 실수로 `npm publish`하지 못하게 막는다. 루트는 올릴 패키지가 아니라 묶음이라서 넣는다.

### 개념 | 호이스팅과 심볼릭 링크로 패키지를 찾는 길

#### 위로 올라가며 찾는다

`import "zod"`처럼 경로 없이 패키지 이름만 적으면, Node와 TypeScript는 지금 파일이 있는 폴더부터 **위로 한 칸씩 올라가며** `node_modules/zod`를 찾는다.

C 컴파일러가 `-I`로 준 include 경로를 차례로 뒤지는 것과 비슷하다. 다만 경로 목록을 따로 주지 않고 폴더 구조 자체가 목록이 된다.

```sh
node -e 'console.log(require("module")._nodeModulePaths("/app/order-api-nest/dist"))'
[
  '/app/order-api-nest/dist/node_modules',
  '/app/order-api-nest/node_modules',
  '/app/node_modules',
  '/node_modules'
]
```

`order-api-nest/node_modules`에 없으면 한 칸 위의 루트 `node_modules`에서 찾는다.

호이스팅이 의존성을 루트에 모아도 각 프로젝트가 그대로 찾을 수 있는 이유다. 8장의 Dockerfile이 `node_modules`를 `/app`에 두고 `/app/order-api-nest`에서 실행하는 이유이기도 하다.

#### 워크스페이스 패키지는 링크로 찾는다

워크스페이스 패키지 자신도 같은 길로 찾는다.

루트 `node_modules/order-api-nest`가 `../order-api-nest`를 가리키는 링크라서, 프론트의 `import type { AppRouter } from "order-api-nest/trpc"`는 npm에 올린 적 없는 백엔드 폴더로 바로 이어진다.

그 폴더 안의 어느 파일로 이어지는지는 3단계 작업 1에서 `exports`로 정한다.

| 찾는 것 | 실제 위치 | 어떻게 닿는가 |
|---|---|---|
| `zod`, `@trpc/server` 같은 외부 패키지 | 루트 `node_modules/` | 위로 올라가며 찾는다(호이스팅) |
| `order-api-nest` | `order-api-nest/` 폴더 그 자체 | 루트 `node_modules/order-api-nest` 링크를 따라간다 |

- 링크라서 복사본이 없다. 백엔드 파일을 고치면 프론트의 타입 검사가 다음 실행부터 바로 바뀐 내용을 본다(3단계에서 확인한다).

- 루트에서 `npm install`을 하지 않으면 링크가 없어 `Cannot find module 'order-api-nest/trpc'`가 난다(10장 진단 3의 표).

> 두 프로젝트가 서로를 "설치된 패키지"처럼 부를 수 있게 해 주는 것이 링크이고, 의존성을 한 벌로 줄여 주는 것이 호이스팅이다.

### 남길 것

- **찾아보면 되는 것**: `workspaces` 칸의 문법, `_nodeModulePaths` 같은 확인용 명령, compose의 `name`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 패키지 이름만 적은 `import`는 지금 폴더에서 위로 올라가며 `node_modules`를 찾는다. 의존성을 루트에 모아도 각 프로젝트가 찾을 수 있는 것은 이 규칙 덕분이다.

  - 워크스페이스 패키지는 복사본이 아니라 링크다. 백엔드를 고치면 프론트가 보는 타입도 바로 바뀐다. 링크 이름은 폴더가 아니라 `package.json`의 `name`에서 오므로, 워크스페이스의 `name`은 이름표가 아니라 주소다.

- **에러 신호**:

  - `Cannot find module 'order-api-nest/trpc'` → 루트에서 `npm install`을 했는지, `node_modules/order-api-nest` 링크가 있는지

  - 프로젝트 폴더 안에 `node_modules`나 `package-lock.json`이 다시 생겼다 → 그 폴더에서 `npm install`을 따로 돌렸다. 루트에서 설치한다

## 2. 1단계: 일부러 깨뜨려보기 ①, REST에서 응답 모양이 바뀌면

아직 tRPC를 붙이기 전이다.

백엔드 개발자가 "내 주문"에 페이지 정보를 붙이려고 응답을 배열에서 객체로 바꿨다고 하자.

### 실험 | "내 주문" 응답을 배열에서 객체로 바꾼다

```ts
// order-api-nest/src/me/me.controller.ts
// 깨뜨려보기: myOrders만 이렇게 바꾼다
  @Get("orders")
  async myOrders(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const items = await this.prisma.asUser(userId, (tx) => tx.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "asc" } }));
    return { items, total: items.length }; // 응답 모양을 바꿨다
  }
```

백엔드는 타입 검사와 빌드를 통과한다. 응답 모양을 정해 둔 곳이 없으니 무엇을 돌려줘도 맞다.

이 변경은 되돌리지 않은 채 작업 1·2로 간다. 되돌리기는 작업 2 끝에서 한다.

### 작업 1. [확인] 프론트 타입 검사 돌리기

```sh
# order-console-next/
# 1장에서 .next를 지웠으므로 LayoutProps 같은 경로 타입을 먼저 만든다
npx next typegen
npx tsc --noEmit
# 출력 없음. 에러가 없다
```

프론트도 통과한다. 프론트는 `authFetch<MyOrder[]>("/me/orders")`라고 자기가 적은 타입을 믿기 때문이다.

> `next typegen` 없이 바로 `tsc`를 돌리면 `app/layout.tsx(25,56): error TS2304: Cannot find name 'LayoutProps'.`가 난다. 이 타입은 Next가 `.next/types`에 만들어 두는 것이라(`next dev`·`next build`도 만든다), 막 지운 상태에서는 없다.

### 작업 2. [원복] 운영 빌드로 띄워 "내 주문" 열기

프론트를 운영 빌드로 띄운다. e2e 테스트(`playwright.config.ts`)가 띄우는 방식과 같다.

```sh
npm run build && npm run start
```

`localhost:3000`에서 로그인하고 "내 주문"을 열면 화면이 통째로 깨진다.

```text
This page couldn't load
Reload to try again, or go back.

브라우저 콘솔: TypeError: e.map is not a function
```

`data.map`을 불렀는데 `data`가 배열이 아니라 객체다.

운영 빌드라 변수 이름이 줄여져(`e`) 어디서 났는지도 바로 안 보인다. 테스트가 이 화면을 지나가지 않았다면 사용자가 먼저 발견한다.

`me.controller.ts`를 원래대로 되돌린다.

### 남길 것

- **찾아보면 되는 것**: `next typegen`, `tsc --noEmit`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 프론트에 손으로 적은 응답 타입은 백엔드와 아무 연결이 없다. 백엔드가 바뀌어도 타입 검사는 통과하고, 실행해야 깨진다.

- **에러 신호**:

  - 운영 빌드 화면에서 `TypeError: e.map is not a function` → 백엔드 응답 모양과 프론트가 적은 타입이 어긋났다

  - `error TS2304: Cannot find name 'LayoutProps'` → `.next/types`가 없다. `npx next typegen`을 먼저

## 3. 2단계: 백엔드에 tRPC 붙이기

### 작업 1. [커밋] tRPC와 zod 설치

```sh
# order-api-nest/
npm install @trpc/server zod
```

워크스페이스라 이 명령도 루트의 `node_modules`와 잠금 파일에 설치된다. `order-api-nest/package.json`의 `dependencies`에는 두 줄이 생긴다.

파일 세 개를 만든다.

| 파일 | 역할 | 프론트가 타입 검사하는가 |
|---|---|---|
| `src/trpc/trpc.ts` | tRPC 초기화, 컨텍스트 타입, 공개/로그인 필요 프로시저 | 예 |
| `src/trpc/router.ts` | 프로시저 목록과 `AppRouter` 타입 | 예 |
| `src/trpc/trpc.module.ts` | Nest 앱에 `/trpc` 경로로 붙이기, 토큰 검증 | 아니요 |

### 작업 2. [커밋] 초기화와 컨텍스트

```ts
// src/trpc/trpc.ts
import { HttpException } from "@nestjs/common";
import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
// 타입만 가져온다. 이 파일과 router.ts는 프론트의 타입 검사도 함께 받으므로, 메서드·매개변수 데코레이터가 있는 파일(컨트롤러)을 끌어오면 안 된다(3단계)
import type { CategoriesService } from "../categories/categories.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";

// 프로시저가 받는 "요청마다의 값". Nest의 req.user와 주입된 서비스를 한데 모은 것
export interface Context {
  userId: string | null; // 토큰이 없거나 유효하지 않으면 null
  prisma: PrismaService;
  storage: StorageService;
  categories: CategoriesService;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Nest의 AuthGuard("jwt") 자리. 로그인하지 않았으면 여기서 끝난다(HTTP 401)
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
  // 여기서부터 userId의 타입이 string(null 아님)이 된다
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
```

`HttpException`과 `TRPC_ERROR_CODE_KEY`는 지금은 쓰지 않는다. 5단계에서 쓴다.

`create()`의 옵션과 `publicProcedure`는 4·5단계에서 더 채운다.

### 용어 | tRPC API (초기화·미들웨어)

- 컨텍스트(`initTRPC.context<Context>()`): 요청마다 만들어져 모든 프로시저에 들어가는 값의 타입을 정한다. Nest에서는 Guard가 `req.user`를 채우고 생성자 주입으로 서비스를 받았다. tRPC는 Nest의 의존성 주입 밖에서 돌기 때문에, 둘 다 컨텍스트에 담아 넘긴다.

- `t.procedure`: 프로시저를 만드는 출발점이다. 여기에 미들웨어와 입력 검증을 이어 붙인다.

- `.use(미들웨어)`: 프로시저 앞에서 도는 함수를 붙인다. `protectedProcedure`는 로그인을 확인하는 미들웨어가 붙은 프로시저다.

- `next({ ctx })`: 바꾼 컨텍스트를 뒤로 넘긴다. 그 뒤에서는 `ctx.userId`의 타입이 `string`으로 좁혀진다. 아래 "미들웨어의 `next({ ctx })`와 컨텍스트 타입"에서 다룬다.

- `new TRPCError({ code, message })`: tRPC 에러를 던진다. `code`(`"UNAUTHORIZED"` 등)가 HTTP 상태 코드(401 등)로 바뀐다.

### 개념 | 미들웨어의 `next({ ctx })`와 컨텍스트 타입

TS의 좁히기(`if (!ctx.userId) throw ...` 뒤에서 `string`이 되는 것)는 **그 함수 안에서만** 통한다.

미들웨어와 프로시저 본문은 서로 다른 함수라서, 미들웨어에서 확인했다는 사실이 본문의 `ctx` 타입까지 저절로 넘어가지 않는다.

그래서 tRPC는 "좁힌 값을 담은 새 컨텍스트"를 `next({ ctx })`로 넘겨받고, **그 값의 타입을 뒤쪽 프로시저의 `ctx` 타입으로 쓴다.**

확인하는 코드와 타입이 바뀌는 지점이 한 줄에 묶인다.

```ts
// 확인만 하고 ctx를 넘기지 않으면
const loose = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next(); // 원래 컨텍스트 타입(userId: string | null)이 그대로 간다
});
loose.query(({ ctx }) => ctx.prisma.asUser(ctx.userId, ...));
// error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'.

// 좁힌 값을 다시 담아 넘기면(이 문서의 protectedProcedure)
return next({ ctx: { ...ctx, userId: ctx.userId } }); // 여기서 ctx.userId는 string이다
// 뒤의 프로시저에서 ctx.userId: string
```

- `{ ...ctx, userId: ctx.userId }`는 값으로는 같은 객체를 다시 만드는 것뿐이다. 이 줄의 목적은 **타입**을 바꾸는 데 있다.

- `.use()`를 이어 붙이면 앞 미들웨어가 넘긴 컨텍스트 타입이 다음 미들웨어의 입력이 된다. 5단계에서 `protectedProcedure`를 `publicProcedure.use(...)`로 바꿔도 같은 원리로 이어진다.

> 런타임 확인(`if`)과 타입 바꾸기(`next({ ctx })`)를 함께 해야 `asUser(ctx.userId, ...)`가 `null` 확인 없이 통과한다.

### 작업 3. [커밋] 라우터

#### 프로시저 목록

```ts
// src/trpc/router.ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { orderSelect } from "../me/order-select.js";
import { protectedProcedure, publicProcedure, router } from "./trpc.js";

// 프로시저 = 이름이 붙은 함수 하나. REST의 "메서드 + 경로" 대신 이름(products.list)으로 부른다
export const appRouter = router({
  products: router({
    // query : 읽기(HTTP GET). REST의 GET /products와 같은 내용
    list: publicProcedure.query(async ({ ctx }) => {
      const products = await ctx.prisma.product.findMany({ orderBy: { id: "asc" } });
      return Promise.all(
        products.map(async ({ imageKey, ...p }) => ({
          ...p,
          imageUrl: imageKey ? await ctx.storage.createDownloadUrl(imageKey, 600) : null,
        })),
      );
    }),
  }),

  categories: router({
    // input : 들어오는 값의 모양을 zod로 선언한다. 런타임 검사(4단계)와 타입이 한 줄에서 나온다
    products: publicProcedure
      .input(z.object({ categoryId: z.number().int().positive() }))
      .query(({ ctx, input }) => ctx.categories.productsInSubtree(input.categoryId)),
  }),

  me: router({
    orders: protectedProcedure.query(({ ctx }) =>
      ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "asc" } }),
      ),
    ),
    order: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const order = await ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findFirst({ where: { id: input.id, userId: ctx.userId }, select: orderSelect }),
      );
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: `order ${input.id} not found` });
      return order;
    }),
  }),
});

// 프론트가 가져가는 것은 이 "타입"뿐이다. 값(appRouter)과 서버 코드는 프론트 번들에 들어가지 않는다
export type AppRouter = typeof appRouter;
```

프로시저마다 반환 타입을 적지 않았다. Prisma의 `findMany({ select })`가 돌려주는 타입이 그대로 `AppRouter`에 들어간다.

#### orderSelect를 따로 파일로 빼기

`orderSelect`는 REST의 `me.controller.ts` 안에 있던 상수다.

두 곳이 같은 칸을 내보내도록 따로 파일로 뺀다. 왜 컨트롤러에서 바로 가져오지 않는지는 3단계에서 직접 깨뜨려 본다.

```ts
// src/me/order-select.ts
// "내 주문" 응답에 내보낼 칸. REST(me.controller.ts)와 tRPC(trpc/router.ts)가 함께 쓴다
// 데코레이터가 없는 파일로 따로 둔다 - tRPC 라우터가 끌어오는 파일은 프론트의 타입 검사도 받기 때문이다(3단계)
export const orderSelect = { id: true, price: true, paid: true, createdAt: true } as const;
```

`me.controller.ts`에서는 상수 정의를 지우고 이 파일에서 가져온다.

```ts
// src/me/me.controller.ts
// const orderSelect = {...} 줄을 지우고 import 한 줄을 넣는다
import { PrismaService } from "../prisma/prisma.service.js";
import { orderSelect } from "./order-select.js";
```

### 용어 | tRPC API (라우터)

- `router({ ... })`: 프로시저를 이름별로 묶는다. 안에 `router`를 또 넣으면 `me.orders`처럼 점으로 이어진 이름이 된다.

- `.query(함수)`: 읽기 프로시저를 만든다. HTTP `GET`으로 불린다.

- `.input(스키마)`: 들어오는 값의 모양을 정한다. 검사를 통과한 값만 `input`으로 들어온다(4단계).

- `export type AppRouter = typeof appRouter`: 값 `appRouter`에서 타입을 뽑아 이름을 붙인다. 아래 "`typeof appRouter`: 값에서 타입을 뽑는다"에서 다룬다.

### 개념 | `typeof appRouter`: 값에서 타입을 뽑는다

타입 자리(`type X = ...`의 오른쪽)에 쓴 `typeof 변수`는 "그 변수에 TS가 추론해 둔 타입"을 꺼낸다.

JS의 `typeof x`(실행 중에 `"object"` 같은 문자열을 돌려주는 연산자)와 철자는 같지만 다른 것이다. 타입 자리의 `typeof`는 검사 때만 쓰이고 컴파일하면 사라진다(0장 개념 4).

```ts
const orderSelect = { id: true, price: true } as const;
type S = typeof orderSelect; // { readonly id: true; readonly price: true }

export type AppRouter = typeof appRouter;
// 프로시저 이름, 각 .input()의 스키마, 각 .query() 함수가 돌려주는 값의 타입이 전부 이 안에 들어 있다
```

`appRouter`에는 반환 타입을 하나도 적지 않았다.

`.query(({ ctx }) => ctx.prisma...findMany({ select: orderSelect }))`의 반환 타입은 Prisma가 `select`를 보고 계산하고, 그 결과가 추론으로 `appRouter`의 타입에 쌓인다. `typeof`는 그렇게 쌓인 것을 한 번에 꺼낼 뿐이다.

| 방법 | 백엔드를 바꾸면 |
|---|---|
| 프론트에 `type MyOrder = {...}`를 손으로 적는다(1단계) | 프론트 타입은 그대로다. 실행해야 깨진다 |
| 프론트가 `typeof appRouter`를 가져온다 | 프론트 타입도 같이 바뀐다. 타입 검사가 잡는다(3단계 "같은 변경을 다시 해 보기") |

- 백엔드 쪽에서 반환 타입을 손으로 적으면(`(): Promise<MyOrder[]>`) 그 순간 다시 "손으로 적은 타입"이 생긴다. 추론에 맡기는 것이 이 구조의 핵심이다.

- 타입은 JSON으로 오가는 모양으로 바뀌어 넘어간다. Prisma의 `Date`는 프론트에서 `string`으로 보인다(3단계 "같은 변경을 다시 해 보기"의 끝).

> C의 헤더 파일은 사람이 적고 컴파일러가 대조한다. `typeof appRouter`는 구현에서 헤더를 자동으로 만들어 내는 셈이라, 둘이 어긋날 틈이 없다.

### 용어 | Zod API

- `z.object({ ... })`: 객체 모양을 선언한다. 런타임 검사와 TypeScript 타입이 이 한 줄에서 함께 나온다. 아래 "스키마 하나에서 검사와 타입이 함께 나온다"에서 다룬다.

- `z.number().int().positive()`: 숫자이면서 정수이고 0보다 큰 값만 통과시킨다.

### 개념 | 스키마 하나에서 검사와 타입이 함께 나온다

zod 스키마는 실행 중에 값을 검사하는 **객체**다.

그런데 TS는 이 객체의 타입을 보고 "검사를 통과한 값의 타입"도 계산해 낸다. tRPC의 `.input(스키마)`는 이 계산 결과를 `input`의 타입과 프론트가 보는 입력 타입으로 쓴다.

```ts
const OrderInput = z.object({ id: z.number().int().positive() });
type OrderInput = z.infer<typeof OrderInput>; // { id: number }

const x: OrderInput = { id: "1" };
// error TS2322: Type 'string' is not assignable to type 'number'.
```

`.int()`와 `.positive()`는 타입에 나타나지 않는다. TS에는 "양의 정수"라는 타입이 없어서 그냥 `number`가 된다.

그래서 `{ id: -1.5 }`는 프론트의 타입 검사를 통과하고, 서버의 zod가 실행 중에 막는다(4단계에서 400으로 확인한다).

| 규칙 | 타입 검사(빌드 전) | zod 검사(실행 중) |
|---|---|---|
| `id`가 숫자여야 한다 | 잡는다 | 잡는다 |
| `id`가 양의 정수여야 한다 | 못 잡는다 | 잡는다 |
| `curl`처럼 TS를 거치지 않은 요청 | 해당 없음 | 잡는다 |

- 스키마를 적고 타입을 따로 또 적지 않는다. 둘을 따로 적으면 다시 어긋날 수 있다.

- `.input()`에 스키마가 아닌 "타입만 선언하는 함수"를 넣으면 타입은 생기지만 검사가 사라진다. 4단계의 깨뜨려보기 ④에서 직접 깨뜨린다.

> 타입은 정직한 클라이언트를 돕고, 런타임 검사는 아무나 보내는 HTTP 요청을 막는다. zod 스키마 하나가 두 일을 함께 한다.

### 실험 | 일부러 깨뜨려보기 ②: `main.ts`에서 `app.use`로 붙이면

tRPC의 express 어댑터(`createExpressMiddleware`)는 Express 미들웨어 하나를 만들어 준다. Nest는 안에서 Express를 쓰므로 붙일 방법은 두 가지다.

가장 짧은 방법은 `main.ts`에서 `app.use("/trpc", ...)`를 하는 것이다.

#### main.ts에 바로 붙이기

서비스는 `app.get(...)`으로 꺼내 컨텍스트에 넣는다. `cookieParser()` 다음, `enableCors()` 앞에 넣는다.

```ts
// src/main.ts
// 깨뜨려보기: app.use(cookieParser()); 아래, app.enableCors(...) 위에 넣는다(import는 생략)
  const jwt = app.get(JwtService, { strict: false });
  const services = { prisma: app.get(PrismaService), storage: app.get(StorageService), categories: app.get(CategoriesService, { strict: false }) };
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req }): Context => {
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        let userId: string | null = null;
        if (token) {
          try {
            userId = jwt.verify<{ sub: string }>(token).sub;
          } catch {
            userId = null;
          }
        }
        return { userId, ...services };
      },
    }),
  );
```

#### tRPC 요청이 로그에서 사라진다

curl로 불러 보면 잘 된다. 그런데 서버 로그를 보면 이상하다.

```sh
curl -s -o /dev/null localhost:4000/trpc/products.list
curl -s -o /dev/null localhost:4000/products
# 서버 로그(pino)의 request completed 줄에서 url만 보면 REST 요청 것 하나뿐이다
# "url":"/products"
```

tRPC 요청은 **요청 로그도, 요청 ID(`X-Request-Id`)도 남지 않는다.**

`07`에서 붙인 요청 로그는 Nest의 미들웨어(`LoggerModule`)다. Nest는 자기 미들웨어를 앱이 뜰 때(`app.listen` 안에서) Express에 등록한다.

`main.ts`의 `app.use`는 그보다 먼저 등록된다. 그래서 tRPC가 요청을 받아 응답까지 끝내 버리고, Nest의 미들웨어는 돌 기회가 없다.

> 장애가 났을 때 tRPC 요청만 로그에서 사라진다.

#### preflight도 tRPC가 먼저 받는다

같은 이유로 등록 순서에도 예민하다.

`app.use`를 `app.enableCors()`보다 앞에 두면, 브라우저가 다른 출처 요청 전에 보내는 확인 요청(preflight, `OPTIONS`)도 tRPC가 먼저 받는다.

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS localhost:4000/trpc/me.orders \
  -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization"
415  # tRPC가 OPTIONS를 모른다. CORS 허락 헤더도 없다 → 브라우저에서 CORS 에러
```

이 블록을 `enableCors()` 아래로 옮기면 `OPTIONS`는 204가 된다. 하지만 요청 로그는 여전히 없다.

확인했으면 `main.ts`에 넣은 블록을 지운다.

### 작업 4. [커밋] 고치기: Nest 미들웨어로 등록한다

Nest 모듈의 `configure()`에서 미들웨어로 등록하면, `LoggerModule` 같은 다른 Nest 미들웨어와 같은 줄에 서서 그 뒤에 돈다.

`enableCors()`는 Nest가 미들웨어를 등록하기 전에 Express에 들어가므로 순서 걱정도 없다.

#### TrpcModule

```ts
// src/trpc/trpc.module.ts
import { Logger, MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { CategoriesService } from "../categories/categories.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { appRouter } from "./router.js";
import type { Context } from "./trpc.js";

// /trpc 아래 요청을 tRPC가 처리하게 한다. main.ts에서 app.use로 붙이지 않고 Nest 미들웨어로 등록한다 -
// 그래야 요청 로그(pino)·요청 ID 같은 Nest의 다른 미들웨어를 거친 뒤에 tRPC가 받는다
@Module({})
export class TrpcModule implements NestModule {
  constructor(private readonly moduleRef: ModuleRef) {}

  configure(consumer: MiddlewareConsumer) {
    // strict: false : 다른 모듈(AuthModule, CategoriesModule ...) 안에 있는 것도 꺼내 온다
    const get = <T>(type: new (...args: never[]) => T) => this.moduleRef.get(type, { strict: false });
    const jwt = get(JwtService);
    const prisma = get(PrismaService);
    const storage = get(StorageService);
    const categories = get(CategoriesService);
    const logger = new Logger("tRPC");

    const handler = createExpressMiddleware({
      router: appRouter,
      // 예상하지 못한 에러만 서버 로그에 원문 그대로 남긴다(응답에서는 trpc.ts의 errorFormatter가 감춘다)
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") logger.error(`${path}: ${error.message}`);
      },
      // 요청마다 한 번 불린다. jwt.strategy.ts가 하던 일(Bearer 토큰 검증)을 여기서 한다
      createContext: ({ req }): Context => {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        let userId: string | null = null;
        if (token) {
          try {
            userId = jwt.verify<{ sub: string }>(token).sub; // 서명이 틀리거나 만료면 예외
          } catch {
            userId = null; // 보호된 프로시저에서 UNAUTHORIZED가 된다
          }
        }
        return { userId, prisma, storage, categories };
      },
    });

    // 프로시저 이름은 경로의 마지막 조각에서 읽으므로(/trpc/me.orders → me.orders) 어느 경로 패턴에 붙여도 된다
    consumer.apply(handler).forRoutes({ path: "trpc/*path", method: RequestMethod.ALL });
  }
}
```

`onError`는 4단계에서 쓴다. 지금 넣어 두어도 된다.

#### app.module.ts에 등록하기

`app.module.ts`의 `imports` 끝에 `TrpcModule`을 넣는다. `main.ts`는 고칠 것이 없다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열 끝의 TrpcModule만 추가한다
import { TrpcModule } from "./trpc/trpc.module.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [
    LoggerModule.forRoot({ /* ... 기존 요청 로그 설정 그대로 ... */ }),
    PrismaModule, StorageModule, HealthModule, CategoriesModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, TrpcModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

빠뜨리면 서버는 멀쩡히 뜨는데 `/trpc/...`만 404가 난다. `imports`에 없는 모듈은 `configure()`가 불리지 않는다.

#### 로그와 preflight 다시 확인

```sh
curl -s -o /dev/null localhost:4000/trpc/products.list
# 서버 로그:
# request completed {"req":{"id":"6af4defd-5ebd-410e-aac4-32f3e966ac16","method":"GET","url":"/trpc/products.list", ...}, ... "statusCode":200 ...}

curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS localhost:4000/trpc/me.orders -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization"
204
```

### 용어 | tRPC API (Express 어댑터)

- `createExpressMiddleware({ router, createContext, onError })`: 라우터를 Express 미들웨어 하나로 만든다. `createContext`는 요청마다 한 번 불려 컨텍스트를 만들고, `onError`는 프로시저에서 에러가 날 때 불린다.

### 용어 | NestJS API (ModuleRef·미들웨어)

- `ModuleRef.get(타입, { strict: false })`: 다른 모듈에 등록된 서비스까지 찾아 꺼낸다.

- `consumer.apply(미들웨어).forRoutes(경로)`: 모듈의 `configure()`에서 Express 미들웨어를 Nest 미들웨어로 등록한다.

- `"trpc/*path"`: `trpc/` 아래 모든 경로. `*` 뒤에 이름(`path`)을 붙이는 것이 지금 Nest의 와일드카드 문법이다.

### 개념 | TrpcModule이 생성자 주입 대신 `ModuleRef`를 쓰는 이유

`TrpcModule`은 `@Module({})`로 비어 있고, 필요한 서비스를 생성자에 적지 않는다. 대신 `ModuleRef`로 꺼낸다.

#### 생성자로 받으려면 보여야 한다

Nest의 생성자 주입은 "그 모듈에서 보이는 것"만 넣어 준다. 같은 모듈의 `providers`, `imports`한 모듈이 `exports`한 것, `@Global()` 모듈이 `exports`한 것이다.

이 프로젝트에서 넷의 처지는 이렇다.

| 서비스 | 등록된 곳 | `TrpcModule`에서 보이는가 |
|---|---|---|
| `PrismaService` | `PrismaModule`(`@Global()`, `exports`) | 보인다 |
| `StorageService` | `StorageModule`(`@Global()`, `exports`) | 보인다 |
| `CategoriesService` | `CategoriesModule`의 `providers`(`exports` 없음) | 안 보인다 |
| `JwtService` | `AuthModule` 안의 `JwtModule.register(...)`(다시 내보내지 않음) | 안 보인다 |

생성자에 `CategoriesService`를 적으면, 서버가 뜨는 단계에서 `Nest can't resolve dependencies of the TrpcModule (...)` 꼴의 에러로 멈춘다.

생성자로 받으려면 `CategoriesModule`과 `AuthModule`에 `exports`를 더하고 `TrpcModule`이 두 모듈을 `imports`해야 한다.

#### `strict: false`는 그 경계를 건너뛴다

`moduleRef.get(타입, { strict: false })`는 모듈 경계를 무시하고 앱 전체에서 그 타입의 인스턴스를 찾는다. 다른 모듈의 `exports`를 고치지 않고 꺼낼 수 있다.

`configure()`는 Nest가 모든 프로바이더를 만든 뒤 미들웨어를 등록할 때 불린다. 그래서 이 안에서 꺼내면 인스턴스가 이미 있다.

9장의 테스트가 `app.get(CategoriesService, { strict: false })`, `app.get(JwtService, { strict: false })`로 꺼내는 것도 같은 이유다.

- 대가는 의존 관계가 `@Module`에 드러나지 않는다는 것이다. `TrpcModule`이 무엇에 기대는지는 `configure()` 본문을 읽어야 안다.

- `strict: false`를 빼면 `TrpcModule` 안에서만 찾는다. 다른 모듈의 서비스는 `Nest could not find CategoriesService element (this provider does not exist in the current context)` 같은 에러로 못 찾는다.

> tRPC 핸들러는 Nest가 만드는 클래스가 아니라서 생성자 주입을 받을 수 없다. 그래서 Nest 쪽에서 서비스를 꺼내 컨텍스트에 담아 넘기는 다리가 필요하고, `TrpcModule`이 그 다리다.

### 작업 5. [확인] curl로 불러 보기

```sh
curl -s localhost:4000/trpc/products.list
# {"result":{"data":[{"id":1,"name":"한정판 키보드","price":150000,"stock":10,"categoryId":3,"imageUrl":null}, ...]}}

curl -s localhost:4000/trpc/me.orders
# {"error":{"message":"로그인이 필요합니다","code":-32001,"data":{"code":"UNAUTHORIZED","httpStatus":401,"stack":"TRPCError: 로그인이 필요합니다\n    at file:///.../order-api-nest/dist/trpc/trpc.js:7:15\n ...","path":"me.orders"}}}

TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/trpc/me.orders
# {"result":{"data":[{"id":1,"price":12000,"paid":true,"createdAt":"2025-10-14T03:30:48.098Z"},{"id":3,"price":5000,"paid":true,"createdAt":"2025-10-14T03:30:48.098Z"}]}}

# 입력은 input 쿼리 파라미터에 JSON으로 싣는다. lee의 주문(2번)은 RLS와 userId 조건 때문에 없다
curl -s -G -H "Authorization: Bearer $TOKEN" localhost:4000/trpc/me.order --data-urlencode 'input={"id":2}'
# {"error":{"message":"order 2 not found","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404,"stack":"TRPCError: order 2 not found\n ...","path":"me.order"}}}
```

에러 응답에 `stack`(서버의 파일 경로와 줄 번호)이 그대로 나간다. 4단계에서 막는다.

### 남길 것

- **찾아보면 되는 것**: `initTRPC`·`router`·`.query()`·`.input()`의 모양, `createExpressMiddleware`의 옵션, `forRoutes`의 경로 문법, zod 메서드 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 반환 타입을 손으로 적지 않고 추론에 맡긴다. `typeof appRouter`가 그 추론을 그대로 프론트에 넘기는 헤더다.

  - Express 미들웨어를 `main.ts`의 `app.use`로 붙이면 Nest 미들웨어(요청 로그)보다 먼저 돌아 요청을 끝내 버린다. Nest 안에 붙일 때는 모듈의 `configure()`에서 등록한다.

- **에러 신호**:

  - tRPC 요청만 서버 로그에 없다 → tRPC를 `main.ts`의 `app.use`로 붙였는지

  - 브라우저에서 CORS 에러, `OPTIONS`가 415 → `app.use`가 `enableCors()`보다 앞에 있는지

  - 서버는 뜨는데 `/trpc/...`가 404 → `app.module.ts`의 `imports`에 `TrpcModule`이 있는지

  - `error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'` → 미들웨어가 좁힌 `ctx`를 `next({ ctx })`로 넘겼는지

  - `Nest could not find ... element (this provider does not exist in the current context)` → `moduleRef.get`에 `{ strict: false }`가 있는지

## 4. 3단계: 프론트에서 백엔드 타입 쓰기

### 작업 1. [커밋] 타입을 내보내는 입구

백엔드 `package.json`에 "이 경로로 들어오면 이 파일"을 적는다. `"type": "module"` 바로 아래에 넣는다.

```jsonc
// order-api-nest/package.json
// "type": "module" 아래에 exports를 추가한다
  "type": "module",
  "exports": {
    "./trpc": {
      "types": "./src/trpc/router.ts"
    }
  },
```

`types` 조건만 있으므로 타입 검사에서만 찾을 수 있다.

실수로 프론트에서 `import { appRouter }`(값)를 하면 번들러가 찾지 못해 빌드가 멈춘다(`Module not found: Can't resolve 'order-api-nest/trpc'`). 서버 코드가 번들에 섞여 들어갈 길이 처음부터 없다.

### 개념 | `exports`의 `types` 조건: 타입 검사기만 열 수 있는 문

`package.json`의 `exports`는 "바깥에서 이 패키지의 어느 경로를 열 수 있고, 그 경로가 실제로 어느 파일인지"를 적는 표다.

여기에 없는 경로는 바깥에서 아예 열 수 없다. `order-api-nest/src/main.ts`처럼 파일 경로를 직접 적어도 막힌다.

#### 조건은 "누가 찾는가"로 고른다

한 경로 안에 조건을 여러 개 둘 수 있다. 찾는 쪽이 자기가 아는 조건 이름을 위에서부터 보고 처음 맞는 것을 쓴다.

| 찾는 쪽 | 보는 조건 | `"./trpc": { "types": ... }`에서 |
|---|---|---|
| 프론트의 TypeScript(`moduleResolution: "bundler"`) | `types`, `import`, `default` 등 | `types`가 맞아 `src/trpc/router.ts`를 읽는다 |
| Next의 번들러(실제 실행 코드를 모으는 쪽) | `import`, `browser`, `default` 등. `types`는 보지 않는다 | 맞는 조건이 없다. `Module not found` |

#### `import type`은 번들러에 닿기 전에 지워진다

프론트의 `import type { AppRouter } from "order-api-nest/trpc"`는 타입 검사가 끝나면 지워진다(0장 개념 4). 번들러는 이 줄을 아예 보지 못하니 찾을 일도 없다.

값을 가져오는 `import { appRouter }`는 지워지지 않고 번들러에 넘어간다. 그 순간 번들러가 맞는 조건을 못 찾아 멈춘다.

#### `.d.ts`가 아니라 `.ts` 소스를 가리킨다

보통 라이브러리는 `types`에 빌드해 둔 `.d.ts`를 적는다. 여기서는 백엔드 소스(`router.ts`)를 바로 적었다.

그래서 백엔드를 빌드하지 않아도 프론트가 최신 타입을 본다.

대신 프론트의 TypeScript가 백엔드 소스를 **프론트의 설정으로** 검사하게 된다. 아래 "일부러 깨뜨려보기 ③"의 원인이 이것이다.

> `exports`의 조건은 문마다 붙은 자물쇠다. `types`만 단 문은 타입 검사기만 열 수 있고, 실행 코드를 모으는 번들러는 열지 못한다.

### 작업 2. [커밋] tRPC 클라이언트 설치와 `fetchWithAuth`

#### 설치

```sh
# order-console-next/
npm install @trpc/client @trpc/server @trpc/tanstack-react-query
```

`@trpc/server`는 `@trpc/client`가 함께 설치되기를 요구하는 짝 패키지(peer dependency)다. 프론트 코드가 직접 가져오는 것은 없지만 `@trpc/client`가 실행 중에도 가져다 쓰고(`@trpc/server/observable` 등), `AppRouter` 타입을 계산할 때도 필요하다.

워크스페이스라 백엔드와 같은 한 벌을 쓴다.

#### 토큰 붙이기를 `fetchWithAuth`로 떼어 내기

`05`의 `authFetch`에서 "토큰 붙이기 + 401이면 refresh 후 한 번 더" 부분을 떼어, `Response`를 그대로 돌려주는 함수로 만든다.

tRPC 링크가 이걸 `fetch` 대신 쓴다.

```ts
// lib/api-client.ts
// authFetch를 이 두 함수로 바꾼다. login·logout·refreshAccessToken은 그대로다
// 로그인이 필요한 요청을 보낸다. 토큰이 없거나 만료(401)면 refresh 후 한 번만 다시 시도한다
// 응답(Response)을 해석하지 않고 그대로 돌려준다 - 아래 authFetch와 tRPC 링크(lib/trpc.ts)가 함께 쓴다
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers); // 객체든 Headers든 같은 모양으로 맞춘다
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
  let res = await send(token);
  if (res.status === 401 && token) {
    token = await refreshAccessToken();
    if (token) res = await send(token);
  }
  return res;
}

// 로그인이 필요한 REST API 호출(결제 등)
export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse<T>(await fetchWithAuth(`${API_URL}${path}`, init));
}
```

헤더를 `new Headers(init.headers)`로 받는 것은 tRPC 링크가 넘기는 `init.headers`가 일반 객체가 아닐 수 있어서다. 예전처럼 `{ ...init.headers }`로 펼치면 `Headers` 객체의 내용은 펼쳐지지 않는다.

상품 목록을 tRPC로 옮기면 `publicFetch`는 쓰는 곳이 없어지므로 지운다.

### 작업 3. [커밋] tRPC 클라이언트와 Provider

#### lib/trpc.ts

```ts
// lib/trpc.ts
import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
// 백엔드 라우터의 "타입"만 가져온다. import type은 빌드 때 지워지므로 서버 코드가 번들에 들어가지 않는다
import type { AppRouter } from "order-api-nest/trpc";
import { API_URL, fetchWithAuth } from "./api-client";

// 컴포넌트에서 useTRPC()로 꺼내 쓰는 것과, 그걸 넣어 주는 Provider
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      // 요청마다 어느 링크로 보낼지 고른다: me.* 는 로그인이 필요하므로 토큰을 붙이고 refresh까지 하는 쪽으로
      splitLink({
        condition: (op) => op.path.startsWith("me."),
        // httpBatchLink : 같은 순간에 나온 요청 여러 개를 HTTP 요청 하나로 묶는다(6단계)
        true: httpBatchLink({ url: `${API_URL}/trpc`, fetch: (url, init) => fetchWithAuth(String(url), init as RequestInit) }),
        false: httpBatchLink({ url: `${API_URL}/trpc` }),
      }),
    ],
  });
}
```

#### app/providers.tsx

`05`의 `Providers`에 tRPC를 끼운다. 401은 재시도하지 않는 규칙도 tRPC 에러까지 보게 넓힌다.

```tsx
// app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { makeTrpcClient, TRPCProvider } from "@/lib/trpc";

// 401은 몇 번을 다시 해도 같다. REST(ApiError)와 tRPC(TRPCClientError) 둘 다 본다
function isUnauthorized(error: unknown) {
  if (error instanceof ApiError) return error.status === 401;
  if (error instanceof TRPCClientError) return error.data?.httpStatus === 401;
  return false;
}

let browserQueryClient: QueryClient | undefined;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 받아 온 데이터를 30초 동안은 "신선하다"고 보고, 화면이 다시 그려져도 다시 요청하지 않는다
        staleTime: 30_000,
        // 401은 재시도하지 않는다. 그 밖의 실패는 한 번만 다시 해 본다
        retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 1,
      },
    },
  });
}

function getQueryClient() {
  // 서버에서 렌더링할 때는 요청마다 새로 만든다(사용자끼리 캐시가 섞이지 않게). 브라우저에서는 하나를 계속 쓴다
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  // tRPC 클라이언트는 컴포넌트가 처음 그려질 때 한 번만 만든다
  const [trpcClient] = useState(makeTrpcClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
```

### 용어 | tRPC 클라이언트 API

- `createTRPCContext<AppRouter>()`: 컴포넌트에서 쓸 `useTRPC`와, 그것을 넣어 주는 `TRPCProvider`를 만든다.

- 링크(`links`): tRPC 클라이언트가 요청을 내보내는 통로다. 배열 순서대로 지나가며 마지막은 실제로 요청을 보내는 링크여야 한다. 아래 "링크는 요청이 지나가는 사슬이다"에서 다룬다.

- `splitLink({ condition, true, false })`: 요청마다 `condition` 결과에 따라 링크를 고른다. 여기서는 로그인이 필요한 `me.*`와 공개 프로시저를 다른 링크로 보낸다. 이유는 6단계에서 본다.

- `httpBatchLink({ url, fetch })`: 같은 순간에 나온 요청 여러 개를 HTTP 요청 하나로 묶는다(6단계). `fetch`를 넘기면 그 함수로 요청을 보낸다.

### 개념 | 링크는 요청이 지나가는 사슬이다

`trpc.me.orders.queryOptions()`가 만든 요청 하나(op: 종류, 프로시저 이름, 입력)는 `links` 배열을 앞에서부터 차례로 지나간다.

각 링크는 op를 보고 `next(op)`로 다음 링크에 넘기거나, 직접 요청을 보내고 사슬을 끝낸다. Express 미들웨어의 `next()`와 같은 모양이 클라이언트 쪽에 있는 것이다.

| 링크 | 하는 일 | 위치 |
|---|---|---|
| `loggerLink` 같은 중간 링크 | op를 보고(로그 등) `next(op)`로 넘긴다 | 앞쪽 |
| `splitLink` | `condition`으로 갈림길을 고르고, 고른 쪽 링크로 넘긴다 | 끝(갈래 안에 끝 링크가 있다) |
| `httpBatchLink`, `httpLink` | 실제로 HTTP 요청을 보낸다(끝 링크) | 맨 끝 |

끝 링크가 없으면 요청이 나갈 곳이 없다. 실행 중에 에러가 난다.

```ts
createTRPCClient<AppRouter>({ links: [loggerLink()] }); // 끝 링크가 없다
// 호출하면: TRPCClientError: No more links to execute - did you forget to add an ending link?
```

이 문서는 `splitLink`의 두 갈래에 각각 `httpBatchLink`를 두었다. 두 갈래는 **서로 다른 묶음**을 만든다.

`me.*`끼리, 공개 프로시저끼리만 한 HTTP 요청으로 묶이고, 갈래를 넘어서는 묶이지 않는다. 6단계의 "왜 링크를 둘로 나눴나"에서 이 점을 쓴다.

- 링크 사슬은 `createTRPCClient`를 부를 때 한 번 만들어진다. `Providers`가 `useState(makeTrpcClient)`로 클라이언트를 한 번만 만드는 것도 그래서다.

- 토큰 붙이기와 refresh는 링크가 아니라 끝 링크에 넘긴 `fetch`(`fetchWithAuth`)에서 한다. 링크는 "어디로, 어떻게 묶어서" 보낼지를 정한다.

> 링크 배열은 위에서 아래로 읽히는 요청의 경로다. 마지막 칸에 HTTP를 보내는 링크가 있는지 먼저 본다.

### 작업 4. [커밋] 화면 바꾸기

#### 내 주문 목록

손으로 적었던 `type MyOrder`를 지운다.

```tsx
// app/me/orders/my-order-list.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc";

export function MyOrderList() {
  const trpc = useTRPC();
  // queryOptions()가 queryKey와 queryFn을 만들어 준다. data의 타입은 백엔드 프로시저의 반환 타입에서 온다
  const { data, isPending, error } = useQuery(trpc.me.orders.queryOptions());

  if (isPending) return <p>내 주문을 불러오는 중...</p>;
  if (error?.data?.code === "UNAUTHORIZED") return <p role="alert">로그인이 필요합니다. <Link href="/login">로그인</Link></p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <ul data-testid="my-orders">
      {data.map((o) => (
        <li key={o.id}>
          <Link href={`/me/orders/${o.id}`}>#{o.id} - {o.price.toLocaleString()}원</Link>
        </li>
      ))}
    </ul>
  );
}
```

`05`에서 쓰던 `useQuery`는 그대로다. `queryOptions()`가 `queryKey`와 `queryFn`을 대신 만든다.

`error.data.code`도 타입이 있어서 `"UNAUTHORIZED"`를 잘못 적으면 타입 검사가 잡는다.

#### 주문 상세

`MyOrder`를 가져오던 import와 `authFetch` 호출을 지우고 `me.order` 프로시저로 바꾼다.

```tsx
// app/me/orders/[id]/page.tsx
// import 두 줄과 MyOrderDetail의 useQuery·404 확인만 바꾼다
import { useTRPC } from "@/lib/trpc";
import { MyOrderList } from "../my-order-list";

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  // 목록과 다른 프로시저라 따로 요청된다. 같은 순간에 나가므로 httpBatchLink가 HTTP 요청 하나로 묶는다(6단계)
  const { data, isPending, error } = useQuery(trpc.me.order.queryOptions({ id }));
  if (isPending) return <p>주문을 불러오는 중...</p>;
  if (error?.data?.code === "NOT_FOUND") return <p>해당 주문은 없습니다</p>;
  if (error) return <p role="alert">불러오지 못했습니다: {error.message}</p>;
  return (
    <p data-testid="order-detail">
      주문 #{data.id} - {data.price.toLocaleString()}원, {new Date(data.createdAt).toISOString().slice(0, 10)}
    </p>
  );
}
```

#### 상점

상점(`app/shop/page.tsx`)은 이렇게 바꾼다. 프론트에 따로 적었던 `type Product`를 지운다.

```diff
// app/shop/page.tsx
@@ import: publicFetch를 빼고 useTRPC를 더한다 @@
-import { ApiError, authFetch, publicFetch } from "@/lib/api-client";
+import { ApiError, authFetch } from "@/lib/api-client";
 import { useCartStore } from "@/lib/cart-store";
 import { useAuthStore } from "@/lib/auth-store";
 import { useOnline } from "../online-banner";
+import { useTRPC } from "@/lib/trpc";
 import { ProductImageUploader } from "./product-image-uploader";
 
-type Product = { id: number; name: string; price: number; stock: number; imageUrl: string | null };
 type CheckoutResult = { id: number; price: number };
 
@@ ProductList: queryKey는 프로시저 이름에서 만들어진다(products.list). 상품 타입을 프론트에서 따로 적지 않는다 @@
 function ProductList() {
-  const { data, isPending, error } = useQuery({
-    queryKey: ["products"],
-    queryFn: () => publicFetch<Product[]>("/products"),
-  });
+  const trpc = useTRPC();
+  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
 
@@ CartPanel: 결제 성공 뒤 "낡음" 표시도 프로시저의 queryKey로 @@
 function CartPanel() {
+  const trpc = useTRPC();
   const items = useCartStore((s) => s.items);
   ...
     onSuccess: () => {
       useCartStore.getState().finishCheckout();
-      void queryClient.invalidateQueries({ queryKey: ["products"] });
-      void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
+      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
+      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
     },
```

#### 이미지 업로더

`product-image-uploader.tsx`의 `invalidateQueries({ queryKey: ["products"] })`도 `trpc.products.list.queryKey()`로 바꾼다.

```diff
// app/shop/product-image-uploader.tsx
@@ import 한 줄, useTRPC 한 줄, onSuccess 한 줄을 바꾼다 @@
 import { useMutation, useQueryClient } from "@tanstack/react-query";
 import { authFetch } from "@/lib/api-client";
+import { useTRPC } from "@/lib/trpc";
 
@@ ProductImageUploader @@
 export function ProductImageUploader({ productId }: { productId: number }) {
+  const trpc = useTRPC();
   const queryClient = useQueryClient();
   ...
-    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["products"] }),
+    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() }),
   });
```

문자열 `["products"]`로 남겨 두면 이름이 달라서 업로드 뒤 목록이 갱신되지 않는다.

> 이건 타입 검사가 잡지 못한다(둘 다 올바른 배열이다). 그래서 문자열 키를 남기지 않는다.

### 실험 | 같은 변경을 다시 해 보기

1단계의 변경을 이번에는 tRPC 프로시저에 한다.

```ts
// order-api-nest/src/trpc/router.ts
// 깨뜨려보기: me.orders만 이렇게 바꾼다
    orders: protectedProcedure.query(async ({ ctx }) => {
      const items = await ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "asc" } }),
      );
      return { items, total: items.length };
    }),
```

프론트 코드는 한 글자도 안 바꾸고 타입 검사를 한다.

```sh
cd order-console-next
npx tsc --noEmit
app/me/orders/my-order-list.tsx(17,13): error TS2339: Property 'map' does not exist on type '{ items: { price: number; id: number; paid: boolean; createdAt: string; }[]; total: number; }'.
app/me/orders/my-order-list.tsx(17,18): error TS7006: Parameter 'o' implicitly has an 'any' type.

npm run build
# (같은 에러)
Failed to type check.
```

백엔드의 변경이 **프론트의 어느 파일 몇째 줄**을 깨뜨리는지 빌드 전에 나온다. `next build`도 타입 검사를 하므로 깨진 채로 배포되지 않는다.

되돌린다.

`createdAt`의 타입이 `Date`가 아니라 `string`인 점도 보자.

Prisma는 `Date`를 돌려주지만, HTTP로는 JSON 문자열이 되어 넘어온다.

tRPC는 이 변환까지 타입에 반영한다. 그래서 상세 화면의 `new Date(data.createdAt)`이 맞는 코드다.

### 실험 | 일부러 깨뜨려보기 ③: 컨트롤러에서 가져오면

2단계 작업 3에서 `orderSelect`를 따로 파일로 뺐다. "이미 `me.controller.ts`에 있으니 `export`해서 가져다 쓰면 되지 않나"를 해 본다.

```ts
// order-api-nest/src/me/me.controller.ts
// 깨뜨려보기: 컨트롤러 파일에 상수를 다시 두고 export한다
export const orderSelect = { id: true, price: true, paid: true, createdAt: true } as const;

// order-api-nest/src/trpc/router.ts
import { orderSelect } from "../me/me.controller.js"; // 이미 있는 걸 가져다 쓰자
```

#### 백엔드는 통과, 프론트는 실패

```sh
cd order-api-nest && npx tsc --noEmit
# 에러 없음
cd ../order-console-next && npx tsc --noEmit
../order-api-nest/src/me/me.controller.ts(14,3): error TS1241: Unable to resolve signature of method decorator when called as an expression.
  The runtime will invoke the decorator with 2 arguments, but the decorator expects 3.
../order-api-nest/src/me/me.controller.ts(15,12): error TS1206: Decorators are not valid here.
# ... (7개)
```

**백엔드에서는 멀쩡한 파일이 프론트의 타입 검사에서 에러가 난다.**

#### 왜 프론트에서만 깨지나

0장 개념 4에서 말한 대로, 프론트의 TypeScript는 `AppRouter` 타입을 계산하려고 라우터가 끌어오는 파일을 전부 읽는다. 그리고 프론트의 `tsconfig.json` 설정으로 검사한다.

Nest의 `@Get()`, `@Req()` 같은 메서드·매개변수 데코레이터는 백엔드 `tsconfig.json`의 `experimentalDecorators: true`가 있어야 통과한다. 프론트 설정에는 그게 없다.

`@Injectable()`처럼 클래스에만 붙은 데코레이터는 프론트 설정에서도 통과한다. 그래서 `PrismaService`, `StorageService`, `CategoriesService`는 컨텍스트 타입에 써도 괜찮았다.

정리하면 다음과 같다.

- 라우터(`router.ts`, `trpc.ts`)가 가져오는 파일은 "프론트에서도 검사받는 코드"다

- 컨트롤러는 가져오지 않는다. 공유할 값은 데코레이터 없는 파일로 뺀다(`order-select.ts`)

- 프론트 `tsconfig.json`에 `experimentalDecorators`를 켜서 넘어가지 않는다. 프론트가 백엔드의 설정에 묶이게 된다

되돌린다(`order-select.ts`를 쓰는 상태로).

### 남길 것

- **찾아보면 되는 것**: `exports`의 조건 이름, `createTRPCContext`·`queryOptions()`·`queryKey()`의 모양, 링크 종류. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 프론트는 백엔드의 타입만 가져가지만, 그 타입을 계산하려고 백엔드 소스를 **프론트의 설정으로** 읽는다. 라우터가 끌어오는 파일은 프론트에서도 검사받는 코드다.

  - `exports`에 `types`만 열어 두면 값을 가져오는 실수는 빌드에서 막힌다. 서버 코드가 번들에 섞일 길이 없다.

  - 캐시 키를 문자열로 남기면 타입 검사가 못 잡는다. 프로시저의 `queryKey()`를 쓴다.

- **에러 신호**:

  - 프론트 tsc에서 백엔드 파일의 `TS1241`·`TS1206 Decorators are not valid here` → 라우터가 컨트롤러 같은 데코레이터 파일을 끌어왔는지

  - `Module not found: Can't resolve 'order-api-nest/trpc'` → 프론트에서 `import type`이 아니라 값으로 가져왔는지

  - 프론트 tsc의 `TS2339: Property 'map' does not exist on type` → 백엔드 프로시저의 반환 모양이 바뀌었다. 프론트를 맞추거나 백엔드를 되돌린다

  - 업로드·결제 뒤 목록이 안 바뀐다 → `invalidateQueries`에 문자열 키(`["products"]`)가 남아 있는지

## 5. 4단계: 입력 검증과 에러 응답

### 실험 | 일부러 깨뜨려보기 ④: 검증 없이 타입만 적으면

zod 대신 "타입만 선언"해 본다.

```ts
// src/trpc/router.ts
// 깨뜨려보기: categories.products의 .input()만 바꾼다
    products: publicProcedure
      .input((raw) => raw as { categoryId: number }) // 타입만 선언하고 검사는 안 한다
      .query(({ ctx, input }) => ctx.categories.productsInSubtree(input.categoryId)),
```

프론트에서 tRPC 클라이언트로 부르면 타입 검사가 `categoryId: "abc"`를 막는다. 하지만 HTTP는 누구나 보낼 수 있다.

```sh
curl -s -w " %{http_code}\n" -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":"abc"}'
{"error":{"message":"\nInvalid `prisma.category.findUnique()` invocation:\n\n{\n  where: {\n    id: \"abc\"\n        ~~~~~\n  },\n  select: {\n    id: true\n  }\n}\n\nArgument `id`: Invalid value provided. Expected Int, provided String.","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500,"stack":"...",...}} 500
```

두 가지가 잘못됐다.

1. 잘못된 입력인데 500(서버 잘못)이 나왔다. 클라이언트가 고쳐야 하는 400이어야 한다.

2. 에러 메시지에 Prisma 쿼리와 스키마가 그대로 나갔다. 테이블 구조를 남에게 알려 주는 셈이다. `stack`에는 서버의 파일 경로까지 있다.

Nest REST 쪽은 `ValidationPipe`(DTO 검증)와 `01`의 `PrismaExceptionFilter`가 이 일을 했다.

그런데 tRPC는 Express 미들웨어로 붙었으므로 **Nest의 파이프·필터를 거치지 않는다.**

> tRPC 쪽에서 따로 해 줘야 한다.

`.input()`은 이 상태로 둔 채 작업 1로 간다. 작업 1은 이 500을 감추는 일이라, 검증이 살아 있으면 요청이 400으로 먼저 끝나 감출 500이 생기지 않는다. 되돌리기는 작업 2에서 한다.

### 작업 1. [커밋] 고치기 ①: 내부 에러는 감추고 로그로

`trpc.ts`의 `create()`에 에러 모양을 정하는 함수를 넣는다.

```ts
// order-api-nest/src/trpc/trpc.ts
// const t = ... 한 줄을 이렇게 바꾼다
const t = initTRPC.context<Context>().create({
  // 에러 응답의 모양을 정한다. 기본값은 NODE_ENV가 production이 아니면 stack(서버 파일 경로와 줄 번호)까지 내보낸다
  errorFormatter({ shape, error }) {
    // 500(예상하지 못한 에러)의 메시지에는 Prisma 쿼리 같은 내부 정보가 들어 있다 → 응답에는 일반 문구만. 원문은 trpc.module.ts의 onError가 로그로 남긴다
    const internal = error.code === "INTERNAL_SERVER_ERROR";
    return { ...shape, message: internal ? "서버 오류" : shape.message, data: { ...shape.data, stack: undefined } };
  },
});
```

같은 요청을 다시 보낸다.

```sh
curl -s -w " %{http_code}\n" -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":"abc"}'

# {"error":{"message":"서버 오류","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500,"path":"categories.products"}}} 500
```

원문은 2단계 작업 4에서 넣은 `onError`가 서버 로그로 남긴다(`07`의 pino로 나간다).

```text
[12:59:05.128] ERROR (3705): categories.products:
Invalid `prisma.category.findUnique()` invocation:
...
Argument `id`: Invalid value provided. Expected Int, provided String. {"context":"tRPC"}
```

### 용어 | tRPC API (에러 응답)

- `errorFormatter({ shape, error })`: 에러 응답의 모양을 정한다. `shape`는 기본 응답이고, 돌려준 값이 그대로 나간다. 기본값은 `NODE_ENV`가 `production`이 아니면 `stack`(서버 파일 경로와 줄 번호)까지 내보낸다. 2단계의 `onError`와 무엇이 다른지는 아래 "`errorFormatter`와 `onError`"에서 다룬다.

### 개념 | `errorFormatter`와 `onError`

둘 다 "에러가 났을 때 불리는 함수"라서 헷갈린다. 차이는 **누구에게 보이는가**다.

`errorFormatter`가 돌려준 값은 HTTP 응답으로 클라이언트에게 가고, `onError`는 응답에 아무 영향도 주지 않고 서버 안에서 끝난다.

| 구분 | `errorFormatter` | `onError` |
|---|---|---|
| 어디에 적나 | `initTRPC...create({ ... })`(`trpc.ts`) | `createExpressMiddleware({ ... })`(`trpc.module.ts`) |
| 돌려준 값 | 응답 본문의 `error`가 된다 | 쓰이지 않는다 |
| 보는 사람 | 클라이언트(누구나) | 서버 운영자 |
| 이 문서에서 하는 일 | 500 메시지와 `stack`을 감춘다 | 500의 원문 메시지를 로그로 남긴다 |

- 두 함수가 받는 `error`는 같은 원문이다. 감추는 일은 `errorFormatter`에서만 하므로, `onError`에서는 원문을 그대로 남길 수 있다.

- 400·404처럼 클라이언트 잘못인 에러는 둘 다 손대지 않는다. 메시지가 사용자에게 필요한 정보이고, 서버 장애도 아니기 때문이다.

> 응답에서 지운 정보는 `onError`로 로그에 남겨야 나중에 원인을 찾을 수 있다. 둘 중 하나만 하면 원인을 잃거나 내부 정보가 샌다.

### 작업 2. [원복] 고치기 ②: 입구에서 검증

`.input(z.object({ categoryId: z.number().int().positive() }))`로 되돌린다.

zod 스키마는 런타임 검사와 타입을 함께 만든다. 프론트가 보는 입력 타입도 여기서 나온다.

```sh
curl -s -w " %{http_code}\n" -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":"abc"}'
# {"error":{"message":"[\n  {\n    \"expected\": \"number\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"categoryId\"\n    ],\n    \"message\": \"Invalid input: expected number, received string\"\n  }\n]","code":-32600,"data":{"code":"BAD_REQUEST","httpStatus":400,"path":"categories.products"}} 400

curl -s -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":-1}'
# ... "message": "Too small: expected number to be >0" ... "code":"BAD_REQUEST","httpStatus":400 ...
```

이제 잘못된 입력은 프로시저가 실행되기 전에 400으로 끝난다. 메시지에는 어느 칸이 왜 틀렸는지만 있다.

### 남길 것

- **찾아보면 되는 것**: `errorFormatter`의 인자(`shape`, `error`), zod 에러 메시지 문구, JSON-RPC 숫자 코드. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - tRPC는 Express 미들웨어로 붙어 Nest의 `ValidationPipe`·예외 필터를 거치지 않는다. 검증과 에러 감추기는 tRPC 쪽에서 따로 한다.

  - 응답에서는 감추고(`errorFormatter`), 원문은 로그로 남긴다(`onError`). 둘이 짝이다.

- **에러 신호**:

  - 잘못된 입력에 500과 `Invalid \`prisma....\` invocation` → `.input()`이 zod 스키마인지

  - 응답에 `stack`이나 서버 파일 경로가 보인다 → `errorFormatter`가 `stack: undefined`로 지우는지

  - 응답은 `"서버 오류"`뿐이고 원인을 모른다 → 서버 로그의 `{"context":"tRPC"}` 줄(`onError`)

## 6. 5단계: 일부러 깨뜨려보기 ⑤, Nest 예외는 tRPC가 모른다

### 실험 | 없는 카테고리를 REST와 tRPC로 요청한다

둘 다 같은 `CategoriesService.productsInSubtree`를 부른다.

```sh
curl -s -w " %{http_code}\n" localhost:4000/categories/999/products
{"message":"category 999 not found","error":"Not Found","statusCode":404} 404

curl -s -w " %{http_code}\n" -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":999}'
{"error":{"message":"서버 오류","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500,"path":"categories.products"}}} 500
```

서비스는 `09`에서 만든 대로 Nest의 `NotFoundException`을 던진다. REST에서는 Nest가 이걸 404로 바꿔 준다.

tRPC는 `NotFoundException`이 무엇인지 모른다. 그래서 "예상하지 못한 에러", 즉 500으로 처리한다.

서버 로그에는 `categories.products: category 999 not found`가 ERROR로 찍힌다. 사용자 실수(없는 id)가 서버 장애처럼 기록되는 것이다.

REST와 tRPC가 서비스를 **공유**하는 구조라 생기는 문제다.

서비스를 tRPC 전용으로 다시 짜는 대신, 프로시저 앞에 "Nest 예외를 tRPC 에러로 바꾸는" 미들웨어를 둔다.

### 작업 1. [커밋] Nest 예외를 tRPC 에러로 바꾸는 미들웨어

```diff
// order-api-nest/src/trpc/trpc.ts
@@ export const router = t.router; 아래. protectedProcedure의 본문은 그대로다 @@
 export const router = t.router;
-export const publicProcedure = t.procedure;
+
+// Nest의 HTTP 상태 → tRPC 에러 코드
+const CODE_BY_STATUS: Record<number, TRPC_ERROR_CODE_KEY> = {
+  400: "BAD_REQUEST",
+  401: "UNAUTHORIZED",
+  403: "FORBIDDEN",
+  404: "NOT_FOUND",
+  409: "CONFLICT",
+  429: "TOO_MANY_REQUESTS",
+};
+
+// REST와 같이 쓰는 서비스는 Nest 예외(NotFoundException 등)를 던진다. tRPC는 그걸 모르므로 그대로 두면 전부 500이 된다(5단계)
+// → 프로시저가 끝난 뒤 결과를 보고, Nest 예외였으면 같은 뜻의 tRPC 에러로 바꿔 던진다
+const nestExceptions = t.middleware(async ({ next }) => {
+  const result = await next();
+  if (!result.ok && result.error.cause instanceof HttpException) {
+    const code = CODE_BY_STATUS[result.error.cause.getStatus()];
+    if (code) throw new TRPCError({ code, message: result.error.cause.message, cause: result.error.cause });
+  }
+  return result;
+});
+
+export const publicProcedure = t.procedure.use(nestExceptions);
 
 // Nest의 AuthGuard("jwt") 자리. 로그인하지 않았으면 여기서 끝난다(HTTP 401)
-export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
+export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
   if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다" });
   // 여기서부터 userId의 타입이 string(null 아님)이 된다
   return next({ ctx: { ...ctx, userId: ctx.userId } });
 });
```

`cause`가 Nest의 `HttpException`이면 상태 코드를 보고 바꿔 던진다.

`protectedProcedure`도 `t.procedure`가 아니라 `publicProcedure`에서 이어 만들어 같은 변환을 받게 한다.

```sh
curl -s -w " %{http_code}\n" -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":999}'
# {"error":{"message":"category 999 not found","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404,"path":"categories.products"}}} 404
```

`trpc.ts`가 `@nestjs/common`에서 값(`HttpException`)을 가져와도 프론트 타입 검사는 괜찮다.

프론트는 이 파일을 타입 검사만 하고 번들에 넣지 않는다. `@nestjs/common`은 이미 빌드된 패키지(`.d.ts`)라 데코레이터 문제도 없다.

### 용어 | tRPC API (미들웨어 결과)

- `t.middleware(함수)`: 여러 프로시저에 붙일 미들웨어를 따로 만든다.

- `await next()`: 뒤의 미들웨어와 프로시저를 실행하고 결과를 돌려준다. 성공이면 `result.ok`가 `true`다. 프로시저가 던진 에러도 여기서 `throw`되지 않고 결과로 돌아온다. 아래 "`next()` 앞뒤로 도는 미들웨어와 `cause`"에서 다룬다.

- `result.error.cause`: 프로시저가 던진 에러는 tRPC가 `TRPCError`로 감싸고, 원래 에러를 `cause`에 넣는다.

### 개념 | `next()` 앞뒤로 도는 미들웨어와 `cause`

#### 앞에서 일하는 미들웨어, 뒤에서 일하는 미들웨어

2단계 작업 2의 `protectedProcedure`는 `next()` **앞에서** 일하는 미들웨어였다(확인하고 넘긴다). `nestExceptions`는 `next()` **뒤에서** 일한다.

`await next()`가 뒤쪽 미들웨어와 프로시저 본문을 다 실행하고 돌아오므로, 그 아래 줄에서 결과를 보고 고칠 수 있다.

```ts
const log = t.middleware(async ({ path, next }) => {
  console.log("앞:", path);
  const result = await next(); // 여기서 프로시저 본문이 돈다
  console.log("뒤:", path, result.ok);
  return result;
});
// 본문이 NotFoundException을 던지는 프로시저에 붙여 부르면
// 출력:
// 앞: categories.products
// 뒤: categories.products false
```

#### 에러는 throw가 아니라 결과로 돌아온다

본문이 에러를 던져도 `await next()`는 **throw하지 않는다.** tRPC가 에러를 잡아 `{ ok: false, error }`로 돌려준다.

그래서 `try/catch`가 아니라 `if (!result.ok)`로 확인한다.

이때 `result.error`는 원래 에러가 아니다. tRPC가 모르는 에러(`NotFoundException`)를 `TRPCError`(`code: "INTERNAL_SERVER_ERROR"`)로 감싸고, 원래 에러는 `cause`에 넣어 둔다.

`cause`는 tRPC만의 것이 아니라 JS `Error`의 표준 속성이다.

```js
const e = new Error("바깥", { cause: new RangeError("안쪽") });
console.log(e.cause instanceof RangeError, e.cause.message); // 출력: true 안쪽
```

| 값 | 이 문서의 예에서 |
|---|---|
| `result.ok` | `false` |
| `result.error` | `TRPCError`, `code`는 `"INTERNAL_SERVER_ERROR"` |
| `result.error.cause` | 서비스가 던진 `NotFoundException`(`getStatus()`는 404) |

- 미들웨어가 `result`를 그대로 `return`하면 500이 나간다. `cause`를 보고 새 `TRPCError`를 던져야 404가 된다.

- `.use()`로 붙인 순서가 실행 순서다. `nestExceptions`가 맨 앞에 있어야 그 뒤에 붙은 미들웨어와 본문에서 난 Nest 예외를 모두 본다. 그래서 `protectedProcedure`를 `publicProcedure.use(...)`로 이어 만든다.

- `CODE_BY_STATUS`에 없는 상태(예: 422)는 바꾸지 않고 그대로 500으로 나간다. 도전 과제 1에서 이 경우를 만난다.

> C로 치면 함수 포인터로 다음 단계를 부르고, 돌아온 반환값(에러 코드)을 보고 바꿔서 위로 올려 주는 래퍼 함수다.

### 남길 것

- **찾아보면 되는 것**: `TRPC_ERROR_CODE_KEY`의 이름들, HTTP 상태와 tRPC 코드의 대응. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - REST와 tRPC가 같은 서비스를 쓰면, 서비스가 던지는 Nest 예외를 tRPC는 모른다. 경계에서 한 번 번역해 준다.

  - `await next()`는 에러를 throw하지 않고 결과(`ok: false`)로 돌려준다. 원래 에러는 `cause`에 있다.

- **에러 신호**:

  - 서비스의 404·409가 tRPC에서 500 `"서버 오류"`로 나온다 → 프로시저에 `nestExceptions` 미들웨어가 붙어 있는지

  - 서버 로그에 사용자 실수(`category 999 not found`)가 ERROR로 찍힌다 → 같은 곳. 변환되지 않은 Nest 예외다

## 7. 6단계: 묶음 요청과 링크 나누기

### 작업 1. [확인] 주문 상세 화면에서 묶음 요청 보기

주문 상세 화면(`/me/orders/1`)은 상세(`me.order`)와 목록(`me.orders`)을 동시에 요청한다.

백엔드(`npm run start:dev`, 4000번)를 띄운 채로 프론트도 띄운다.

```sh
cd order-console-next
npm run dev
```

1. `localhost:3000`에서 `kim` / `1234`로 로그인한다(비밀번호는 `.env.local`의 `DEMO_PASSWORD`).

2. 개발자 도구(Chrome은 맥에서 `⌥⌘I`)를 열고 Network 탭을 고른다. 필터 칸에 `trpc`를 넣고 `Fetch/XHR`을 누르면 tRPC 요청만 남는다. 아래 `refresh`까지 보려면 필터를 비워 둔다.

3. Network 탭을 연 채로 `localhost:3000/me/orders/1`을 열거나 새로고침한다. 탭이 열려 있어야 요청이 기록된다.

Network 탭의 표는 이런 모양이다. `Name` 칸에는 경로의 마지막 조각과 쿼리만 나오고, `input`은 URL 인코딩된 글자로 나온다.

```text
Name                                                                  Status  Type
refresh                                                               200     fetch
me.order,me.orders?batch=1&input=%7B%220%22%3A%7B%22id%22%3A1%7D%7D   200     fetch
```

읽기 편하게 바꿔 보는 방법은 셋이다.

- 메서드: 표의 머리줄을 오른쪽 클릭해 `Method`를 켜면 `POST`/`GET` 칸이 생긴다.

- 전체 경로: 줄을 눌러 Headers 탭의 `Request URL`을 본다(여기도 인코딩된 채다).

- 입력: 같은 창의 Payload 탭을 보면 `batch: 1`, `input: {"0":{"id":1}}`로 풀려 있다.

필터를 비워 두면 같은 주소의 `OPTIONS` 줄(Type이 `preflight`)이 더 보일 수 있다. 3000번 화면이 4000번 API에 `Authorization` 헤더를 붙여 보내기 전에 브라우저가 허락을 묻는 요청(CORS preflight)이다. 묶음 요청과는 상관없다.

세 방법으로 풀어서 메서드와 경로만 남기면 이렇다. tRPC 요청은 하나다.

```text
POST /auth/refresh
GET  /trpc/me.order,me.orders?batch=1&input={"0":{"id":1}}
```

`/auth/refresh`가 먼저 나가는 것은 새로고침으로 메모리의 액세스 토큰이 사라져서, refresh 쿠키로 다시 받기 때문이다.

`httpBatchLink`가 같은 순간(같은 이벤트 루프 차례)에 나온 요청을 모아 하나의 HTTP 요청으로 보낸다.

경로에 프로시저 이름이 쉼표로 이어지고, `input`은 순서 번호(`"0"`)별로 담긴다. 응답은 배열이고, 클라이언트가 다시 나눠 각 `useQuery`에 돌려준다.

`05`의 4단계에서 "로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번"을 single-flight로 해결했다. tRPC 요청끼리는 애초에 하나로 묶여 나가므로 refresh도 한 번이다.

> REST 요청(결제 등)은 여전히 따로 나가므로 single-flight는 그대로 필요하다.

확인이 끝나면 프론트 개발 서버(`npm run dev`)는 끈다. 켜 둔 채로 9장의 프론트 e2e를 돌리면 Playwright가 3000번의 개발 서버를 그대로 써서, 서비스 워커 테스트가 깨진다.

### 실험 | 왜 링크를 둘로 나눴나

묶음의 HTTP 상태 코드는 묶인 결과들로 정해진다. 공개 프로시저와 로그인 필요 프로시저를 일부러 한 묶음에 섞어 보낸다.

```sh
# 공개(products.list)와 로그인 필요(me.orders)를 한 묶음에, 토큰 없이
curl -s -o /dev/null -w "%{http_code}\n" -G "localhost:4000/trpc/products.list,me.orders" --data-urlencode 'batch=1' --data-urlencode 'input={}'
207

# 로그인 필요한 것끼리만
curl -s -o /dev/null -w "%{http_code}\n" -G "localhost:4000/trpc/me.order,me.orders" --data-urlencode 'batch=1' --data-urlencode 'input={"0":{"id":1}}'
401
```

결과가 섞이면 207(여러 상태)이 된다. `fetchWithAuth`는 `res.status === 401`일 때만 refresh하고 다시 보낸다.

링크를 하나만 쓰면, 액세스 토큰이 만료된 순간 공개 프로시저와 같이 묶인 `me.*` 요청은 207 속의 401이 된다.

그러면 refresh가 일어나지 않아, refresh 쿠키가 살아 있는데도 "로그인이 필요합니다"가 뜬다.

`splitLink`로 `me.*`만 `fetchWithAuth` 링크로 보내면, 그 링크의 묶음은 전부 로그인 필요 프로시저다. 토큰이 만료되면 전부 401이 되므로 refresh가 정상으로 돈다.

> 로그인하지 않은 사용자가 상품 목록만 볼 때 쓸데없이 `/auth/refresh`를 부르지 않는 효과도 있다.

### 남길 것

- **찾아보면 되는 것**: 묶음 요청의 URL 모양(`a,b?batch=1&input={"0":...}`), 207의 이름(Multi-Status). 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 묶음 요청의 상태 코드는 묶인 결과 전체로 정해진다. 상태 코드로 판단하는 코드(401이면 refresh)가 있으면, 같은 판단을 받는 것끼리만 묶는다.

- **에러 신호**:

  - 로그인했는데 가끔 "로그인이 필요합니다", Network 탭의 묶음 응답이 207 → 공개 프로시저와 `me.*`가 한 링크로 묶였는지(`splitLink`의 `condition`)

  - 로그인하지 않았는데 상품 목록을 볼 때마다 `/auth/refresh`가 나간다 → 공개 프로시저가 `fetchWithAuth` 링크로 가고 있는지

## 8. 7단계: 모노레포가 바꾸는 Docker 빌드

저장소 구조를 바꿨으니 `07`의 컨테이너 구성도 확인한다.

### 실험 | 백엔드 폴더를 빌드 컨텍스트로 둔 채 빌드하면

```sh
cd order-api-nest
docker compose --profile app build api
```

출력은 단계마다 `=>` 줄이 쌓여 길다. 필요한 줄만 남기면 이렇다(가운데는 줄였다).

```text
 => [api internal] load build context                                  0.0s
 => => transferring context: 86.86kB                                   0.0s
 ...
 => CACHED [api deps 2/4] WORKDIR /app                                 0.0s
 => ERROR [api deps 3/4] COPY package.json package-lock.json ./        0.0s
------
 > [api deps 3/4] COPY package.json package-lock.json ./:
------
failed to solve: failed to compute cache key: failed to calculate checksum of ref ...: "/package-lock.json": not found
```

읽는 순서는 아래에서 위로다.

1. 맨 끝 줄이 이유다. 앞부분 문구는 Docker 버전마다 다르다(`ERROR: failed to calculate checksum ...`로 시작하기도 한다). 끝의 `"/package-lock.json": not found`만 보면 된다.

2. `=> ERROR [...]` 줄이 어느 단계에서 멈췄는지다. `[api deps 3/4]`는 `api` 서비스의 `deps` 단계에서 네 번째 중 세 번째 명령이라는 뜻이다.

3. `transferring context`는 빌더에 넘긴 컨텍스트의 크기다. 백엔드 폴더만 넘어가서 작다.

나머지 줄은 넘겨도 된다. 맨 위의 `COMPOSE_BAKE=true` 안내는 빌드 방식을 바꿀 수 있다는 광고라 결과와 상관없다. `CANCELED` 줄은 에러가 나자 함께 돌던 단계를 멈춘 것이다.

`07`의 Dockerfile은 백엔드 폴더를 빌드 컨텍스트로 쓰고 `COPY package.json package-lock.json ./`로 시작한다.

이제 잠금 파일은 워크스페이스 루트에 하나뿐이다. 빌드 컨텍스트(도커가 볼 수 있는 폴더)를 루트로 넓혀야 한다.

### 개념 | 빌드 컨텍스트: 도커가 볼 수 있는 폴더

`docker build`는 Dockerfile을 읽기 전에 빌드 컨텍스트로 정한 폴더를 통째로 빌더에 넘긴다. Dockerfile의 `COPY`는 **그 폴더 안에서만** 파일을 고를 수 있다.

C로 치면 `chroot`한 프로세스와 같다. 넘겨받은 폴더가 `/`가 되므로, 그 바깥은 `../`로도 닿지 않는다.

| | 컨텍스트 = `order-api-nest/` | 컨텍스트 = 워크스페이스 루트 |
|---|---|---|
| `package-lock.json` | 없다(루트에 있다). `not found` | 있다 |
| `COPY` 경로 | `package.json`, `src/` | `order-api-nest/package.json`, `order-api-nest/` |
| `.dockerignore`를 찾는 곳 | `order-api-nest/.dockerignore` | 루트 `.dockerignore` |
| 넘어가는 양 | 백엔드 폴더 | 프론트까지 전부. `.dockerignore`로 줄인다 |

- 컨텍스트를 넓히면 Dockerfile의 모든 `COPY` 경로가 루트 기준으로 바뀐다. 그래서 아래 Dockerfile의 `COPY`가 전부 `order-api-nest/`로 시작한다.

- `.dockerignore`는 컨텍스트의 루트에 있는 것 하나만 읽는다. 백엔드 폴더에 남겨 두면 아무 효과가 없어서 `node_modules`까지 빌더로 넘어간다.

> Dockerfile 위치와 컨텍스트는 따로 정한다. `docker build -f order-api-nest/Dockerfile .`에서 `-f`가 Dockerfile이고, 마지막 `.`이 컨텍스트다.

### 작업 1. [커밋] Dockerfile을 루트 컨텍스트로 바꾸기

Dockerfile은 옮기지 않는다. 그 자리(`order-api-nest/Dockerfile`)에 둔 채 내용을 고친다.

Dockerfile의 위치와 빌드 컨텍스트는 따로 정하기 때문이다(위 개념의 마지막 줄). 파일은 백엔드 폴더에 있어도, compose가 컨텍스트를 루트로 넘기고 `dockerfile:`로 이 파일을 가리키면 된다(작업 3). 반대로 작업 2의 `.dockerignore`는 컨텍스트의 루트에서만 읽히므로 옮겨야 한다.

다섯 단계(`deps` → `build` → `migrate`, `prod-deps` → `runtime`)의 구조는 그대로이고, 바뀌는 것은 세 가지다.

- `COPY`의 원본 경로가 루트 기준이 된다. 백엔드 파일은 `order-api-nest/`로 시작하고, `COPY . .`는 `COPY order-api-nest/ order-api-nest/`가 된다.

- `npm ci`가 `npm ci -w order-api-nest`가 된다. 루트 잠금 파일로 백엔드 워크스페이스 것만 설치한다.

- 빌드와 실행이 `/app/order-api-nest`에서 일어난다. 의존성은 `/app/node_modules`에 남는다.

`③ migrate` 단계와 `USER`·`EXPOSE`·`CMD`는 그대로다. 고칠 곳만 보이면 이렇다.

```diff
# order-api-nest/Dockerfile
@@ 맨 위: 컨텍스트가 루트라는 것을 적어 둔다 @@
 # syntax=docker/dockerfile:1
+# 빌드 컨텍스트는 워크스페이스 루트다 - 잠금 파일(package-lock.json)이 루트에 하나만 있기 때문이다
+# docker compose가 context: .. 로 넘겨 준다. 직접 빌드할 때: docker build -f order-api-nest/Dockerfile .  (루트에서)
 
@@ ① deps: 루트 잠금 파일로 백엔드 워크스페이스 것만 설치한다 @@
 FROM node:24-slim AS deps
 WORKDIR /app
 COPY package.json package-lock.json ./
-RUN npm ci
+# 설치는 백엔드 워크스페이스 것만 한다. 다른 워크스페이스(프론트)의 package.json은 없어도 된다
+COPY order-api-nest/package.json order-api-nest/
+RUN npm ci -w order-api-nest
 
@@ ② build: 백엔드 폴더만 복사하고 그 안에서 빌드한다 @@
 FROM deps AS build
-COPY . .
+COPY order-api-nest/ order-api-nest/
+WORKDIR /app/order-api-nest
 RUN npx prisma generate && npm run build
 
@@ ④ prod-deps: ①과 같은 방식으로, 개발 의존성만 뺀다 @@
 FROM node:24-slim AS prod-deps
 WORKDIR /app
 COPY package.json package-lock.json ./
-RUN npm ci --omit=dev
+COPY order-api-nest/package.json order-api-nest/
+RUN npm ci -w order-api-nest --omit=dev
 
@@ ⑤ runtime: 의존성은 /app에, 앱은 /app/order-api-nest에 둔다 @@
 FROM node:24-slim AS runtime
 ENV NODE_ENV=production
+# 워크스페이스는 의존성을 루트의 node_modules에 모은다(호이스팅). Node는 /app/order-api-nest에서 위로 올라가며 찾으므로 그대로 둔다
 WORKDIR /app
 COPY --from=prod-deps /app/node_modules ./node_modules
-COPY --from=build /app/dist ./dist
-COPY package.json ./
+COPY --from=build /app/order-api-nest/dist ./order-api-nest/dist
+# "type": "module"을 Node가 읽어야 dist의 import 문을 ESM으로 실행한다
+COPY order-api-nest/package.json ./order-api-nest/
+WORKDIR /app/order-api-nest
 USER node
```

`③ migrate`는 `build`에서 이어 가므로 작업 폴더(`/app/order-api-nest`)도 물려받는다. 그래서 고칠 것이 없다.

`WORKDIR`는 없는 폴더를 가리키면 에러 없이 빈 폴더를 새로 만든다. 경로 철자가 틀려도(`/app/order-api-test`) 그 줄은 통과하고, 다음 `RUN npx prisma generate`가 빈 폴더에서 `Could not find Prisma Schema`로 멈춘다. 이 에러가 나면 `COPY`로 넣은 폴더 이름과 `WORKDIR` 경로가 글자까지 같은지부터 본다.

`COPY order-api-nest/package.json order-api-nest/`의 끝 `/`도 빼면 안 된다. `/`가 있으면 "이 폴더 안에" 넣고, 없으면 "이 이름의 파일로" 넣는다. `/`를 빼면 `/app/order-api-nest`가 폴더가 아니라 `package.json` 내용을 담은 파일 하나가 된다. 그러면 npm이 그 워크스페이스를 찾지 못해 다음 `npm ci -w order-api-nest`가 `npm error No workspaces found: --workspace=order-api-nest`로 멈춘다.

> 같은 출력의 `prisma:warn Prisma failed to detect the libssl/openssl version` 경고는 `node:24-slim`에 OpenSSL이 없어서 나는 것이다. 빌드 실패와는 상관없다.

첫 줄 `# order-api-nest/Dockerfile`은 어느 파일인지 보이려고 적은 것이다. 파일에서는 `# syntax=docker/dockerfile:1`이 맨 첫 줄이어야 하므로 넣지 않는다.

최종 이미지는 `/app/node_modules`(호이스팅된 의존성)와 `/app/order-api-nest/dist`를 두고 `/app/order-api-nest`에서 실행한다. 1장에서 본 "위로 올라가며 찾는다" 규칙 그대로다.

### 작업 2. [커밋] `.dockerignore`를 루트로 옮기기

`.dockerignore`는 빌드 컨텍스트의 루트에 있어야 한다.

백엔드 폴더의 것을 워크스페이스 루트로 옮긴 뒤, 경로를 루트 기준으로 고친다.

```sh
mv order-api-nest/.dockerignore .dockerignore
```

```text
# .dockerignore
# 빌드 컨텍스트가 워크스페이스 루트이므로 여기에 둔다. 이미지에 들어가면 안 되는 것: 의존성·빌드 결과(다시 만든다), 비밀 값, 테스트·실험 파일
**/node_modules
**/dist
**/.next
**/*.tsbuildinfo
**/.env
**/.env.*
order-api-nest/src/generated
order-api-nest/test
order-api-nest/scripts
order-api-nest/scratch-client.mjs
order-api-nest/Dockerfile*
# 백엔드 이미지는 프론트 파일을 하나도 쓰지 않는다(npm ci -w order-api-nest는 프론트 package.json 없이도 된다)
order-console-next
.git
**/README.md
```

옮겨 온 파일을 위 내용으로 고친다. 고치는 규칙은 세 가지다.

- 어느 폴더에 있든 막을 것(`node_modules`, `.env`, `README.md` 등)은 `**/`를 붙인다. 앞에 아무것도 없는 `node_modules`는 컨텍스트 루트의 것 하나만 막는다.

- 백엔드에만 있는 것(`src/generated`, `test` 등)은 `order-api-nest/`를 붙인다.

- 프론트 폴더(`order-console-next`)와 프론트의 빌드 결과(`**/.next`)를 새로 막는다. `.dockerignore` 줄은 지운다. Dockerfile의 `COPY`가 `order-api-nest/` 안만 가져가므로 루트의 이 파일은 이미지에 들어갈 일이 없다.

### 작업 3. [커밋] compose의 build 바꾸고 `Dockerfile.naive` 지우기

`docker-compose.yml`의 두 `build`도 바꾼다. compose 파일이 `order-api-nest/`에 있으므로 `..`이 워크스페이스 루트다.

```yaml
# order-api-nest/docker-compose.yml
# migrate와 api의 build 한 줄씩만 바꾼다
  migrate:
    build: { context: .., dockerfile: order-api-nest/Dockerfile, target: migrate } # 워크스페이스 루트에서 빌드한다
  ...
  api:
    build: { context: .., dockerfile: order-api-nest/Dockerfile, target: runtime }
```

### 작업 4. [확인] 컨테이너로 확인하기

`docker compose`는 지금 폴더에서 compose 파일을 찾는다. 작업 2의 `mv`는 워크스페이스 루트에서 했으므로, compose 파일이 있는 `order-api-nest`로 들어가서 실행한다. 루트에는 compose 파일이 없어서 `no configuration file provided: not found`가 난다.

compose 파일 안의 `context: ..`는 실행한 폴더가 아니라 compose 파일이 있는 폴더를 기준으로 푼다. 그래서 어디서 실행하든 컨텍스트는 워크스페이스 루트다.

백엔드 개발 서버(`npm run start:dev`)가 아직 4000번을 잡고 있으면 먼저 끈다. 컨테이너의 `api`도 4000번을 쓴다.

```sh
cd order-api-nest
docker compose --profile app up -d --build

curl -s localhost:4000/health/ready
# {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}

curl -s -G localhost:4000/trpc/categories.products --data-urlencode 'input={"categoryId":999}'
# {"error":{"message":"category 999 not found","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404,"path":"categories.products"}}}

time docker compose stop api
# ... 0.6 total   (zsh. bash면 real 0m0.6s)

docker compose ps -a api
# NAME                   ...  STATUS
# order-api-nest-api-1   ...  Exited (143) 3 seconds ago
```

마지막 두 명령은 `07`에서 본 "종료 신호가 node에 바로 가는가"를 다시 확인하는 것이다. 실행 위치가 `/app/order-api-nest`로 바뀌어도 `CMD`가 그대로 `node`를 직접 띄우는지 본다.

- 걸린 시간은 `time`이 잰다. `docker compose stop`은 `SIGTERM`을 보내고 기본 10초를 기다린 뒤, 그때까지 안 끝나면 `SIGKILL`로 죽인다. 1초도 안 걸렸다면 node가 신호를 받고 바로 끝난 것이다.

- 끝난 모양은 `ps -a`의 `STATUS` 칸이 알려 준다. 신호로 끝난 프로세스의 종료 코드는 128 + 신호 번호다. `143`(128 + 15)은 `SIGTERM`으로 끝났다는 뜻이고, `137`(128 + 9)이 보이면 10초를 다 채우고 `SIGKILL`로 죽은 것이다.

### 용어 | npm 워크스페이스 명령

- `npm ci -w order-api-nest`: 루트의 잠금 파일을 기준으로, 지정한 워크스페이스에 필요한 의존성만 설치한다. 다른 워크스페이스의 `package.json`은 없어도 된다.

- `--omit=dev`: `devDependencies`를 빼고 설치한다.

### 남길 것

- **찾아보면 되는 것**: `npm ci -w`, `--omit=dev`, compose의 `build: { context, dockerfile, target }`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `COPY`는 빌드 컨텍스트 안의 파일만 볼 수 있다. 필요한 파일(잠금 파일)이 위 폴더로 옮겨 가면 컨텍스트를 넓히고, 넓힌 만큼 `.dockerignore`로 줄인다.

  - `.dockerignore`는 컨텍스트의 루트에 있는 것만 읽힌다.

  - Dockerfile의 경로 실수는 그 줄이 아니라 다음 `RUN`에서 터진다. `WORKDIR`는 없는 폴더를 새로 만들고, 끝 `/`가 없는 `COPY`는 폴더 대신 파일을 만든다. 실패한 `RUN`의 바로 위 줄들부터 본다.

- **에러 신호**:

  - Docker 빌드에서 `"/package-lock.json": not found` → 빌드 컨텍스트가 아직 백엔드 폴더인지(compose의 `context: ..`)

  - Docker 빌드의 `RUN npx prisma generate`에서 `Could not find Prisma Schema` → `WORKDIR` 경로가 `COPY`한 폴더(`/app/order-api-nest`)와 글자까지 같은지

  - Docker 빌드의 `npm ci -w order-api-nest`에서 `No workspaces found` → 바로 위 `COPY ... order-api-nest/`의 끝에 `/`가 있는지

  - 컨테이너가 `Cannot find module`로 바로 죽는다 → `node_modules`가 `/app`에, 실행 위치가 `/app/order-api-nest`인지

  - 빌드가 느리고 컨텍스트 전송량이 크다 → `.dockerignore`가 루트에 있는지

## 9. 8단계: 테스트

### 작업 1. [커밋] 백엔드: 프로시저를 함수처럼 부르기

백엔드(`order-api-nest`, Nest) 쪽이다. 지금까지 쓰던 백엔드 e2e 테스트(vitest, `test/` 폴더)에 파일 하나를 더한다.

`createCaller`로 HTTP 없이 프로시저를 부를 수 있다. 컨텍스트를 직접 넘기므로 "kim이 요청했다"를 토큰 없이 만든다.

```ts
// order-api-nest/test/trpc.e2e-spec.ts
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { TRPCError } from "@trpc/server";
import { AppModule } from "../src/app.module.js";
import { CategoriesService } from "../src/categories/categories.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { StorageService } from "../src/storage/storage.service.js";
import { appRouter } from "../src/trpc/router.js";
import { adminDb } from "./admin-db.js";

describe("tRPC - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  // createCaller : HTTP 없이 프로시저를 함수처럼 부른다. ctx를 직접 넘기므로 "누가 요청했는가"를 바로 정할 수 있다
  let callerAs: (userId: string | null) => ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
    const deps = {
      prisma: app.get(PrismaService),
      storage: app.get(StorageService),
      categories: app.get(CategoriesService, { strict: false }),
    };
    callerAs = (userId) => appRouter.createCaller({ userId, ...deps });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김" }, { id: "lee", name: "이" }] });
    await adminDb.order.createMany({ data: [{ userId: "kim", price: 1000, paid: true }, { userId: "lee", price: 2000, paid: true }] });
    await adminDb.category.create({ data: { name: "주변기기" } });
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  // 에러의 tRPC 코드만 꺼낸다
  const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: unknown) => (e instanceof TRPCError ? e.code : String(e)));

  it("로그인하지 않으면 me.orders는 UNAUTHORIZED", async () => {
    expect(await codeOf(callerAs(null).me.orders())).toBe("UNAUTHORIZED");
  });

  it("kim은 자기 주문만 받고, lee의 주문은 NOT_FOUND", async () => {
    const kim = callerAs("kim");
    expect((await kim.me.orders()).map((o) => o.price)).toEqual([1000]);
    expect(await codeOf(kim.me.order({ id: 2 }))).toBe("NOT_FOUND");
  });

  it("입력이 스키마에 맞지 않으면 프로시저가 실행되기 전에 BAD_REQUEST", async () => {
    // @ts-expect-error - 타입으로도 막히지만, 런타임 검사(zod)를 확인하려고 일부러 문자열을 넣는다
    expect(await codeOf(callerAs(null).categories.products({ categoryId: "abc" }))).toBe("BAD_REQUEST");
  });

  it("서비스가 던진 Nest 예외(NotFoundException)는 NOT_FOUND로 바뀐다 - 500이 아니다", async () => {
    expect(await codeOf(callerAs(null).categories.products({ categoryId: 999 }))).toBe("NOT_FOUND");
  });

  it("HTTP: 토큰을 실으면 그 사용자로, 잘못된 토큰이면 401이고 응답에 stack이 없다", async () => {
    const token = app.get(JwtService, { strict: false }).sign({ sub: "kim" });
    const ok = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.data).toHaveLength(1);

    const bad = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: "Bearer not-a-token" } });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.data.stack).toBeUndefined();
  });
});
```

`@ts-expect-error`는 "다음 줄에 타입 에러가 있어야 한다"는 표시다.

> 누군가 스키마를 느슨하게 바꿔 에러가 사라지면, 이번엔 이 표시 자체가 에러가 된다.

`createCaller`는 2단계 작업 4의 `createContext`를 거치지 않는다. 컨텍스트를 직접 만들어 넘기므로, 토큰 검증까지 확인하는 다섯 번째 테스트만 진짜 HTTP로 보낸다.

```sh
# order-api-nest에서
npm run test:e2e
 Test Files  6 passed (6)
      Tests  17 passed (17)
   Start at  14:48:16
   Duration  5.61s (transform 177ms, setup 27ms, import 2.56s, tests 2.44s, environment 0ms)
```

### 실험 | 이 테스트가 정말 잡는지 확인한다

5단계의 미들웨어를 빼면(`publicProcedure = t.procedure`) 네 번째 테스트가 잡는다.

```text
× 서비스가 던진 Nest 예외(NotFoundException)는 NOT_FOUND로 바뀐다 - 500이 아니다
AssertionError: expected 'INTERNAL_SERVER_ERROR' to be 'NOT_FOUND'
```

`errorFormatter`에서 `stack: undefined`를 빼면 다섯 번째 테스트가 잡는다.

```text
× HTTP: 토큰을 실으면 그 사용자로, 잘못된 토큰이면 401이고 응답에 stack이 없다
AssertionError: expected 'TRPCError: 로그인이 필요합니다\n    at /Users/w...' to be undefined
```

확인했으면 둘 다 되돌린다.

### 작업 2. [커밋] 프론트: 묶음 요청 e2e

프론트(`order-console-next`, Next) 쪽이다. Playwright 테스트(`e2e/` 폴더)에 파일 하나를 더한다.

이름은 둘 다 e2e지만 보는 것이 다르다. 작업 1은 HTTP 없이 프로시저를 함수로 부르고, 이 작업은 브라우저로 화면을 열어 실제로 나가는 HTTP 요청을 센다.

프론트는 `playwright.config.ts`가 빌드해서 띄우지만, 백엔드는 띄워 주지 않는다. 8장에서 컨테이너를 멈췄다면 백엔드(`npm run start:dev`)를 4000번에 다시 띄워 둔다.

반대로 프론트 개발 서버(`npm run dev`)는 꺼 둔다. `playwright.config.ts`는 `reuseExistingServer: true`라서 3000번에 무엇이든 떠 있으면 새로 빌드하지 않고 그것을 쓴다. 개발 서버에서는 서비스 워커가 등록되지 않으므로(`app/sw-resgister.tsx`가 운영 빌드에서만 등록한다) `11`의 오프라인 테스트 두 개가 `navigator.serviceWorker.ready`를 30초 기다리다 실패한다.

```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN   # 아무것도 안 나와야 한다. 나오면 그 프로세스(next dev)를 끈다
```

```ts
// order-console-next/e2e/trpc.spec.ts
import { expect, test } from "@playwright/test";

test("주문 상세 화면의 tRPC 요청 두 개(me.order, me.orders)가 HTTP 요청 하나로 묶인다", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/trpc/me.")) calls.push(url.pathname);
  });

  await page.goto("/me/orders/1");
  await expect(page.getByTestId("order-detail")).toContainText("주문 #1");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  // 프로시저 이름이 쉼표로 이어진 요청 하나 - httpBatchLink가 같은 순간에 나온 요청을 묶었다
  expect(calls).toEqual(["/trpc/me.order,me.orders"]);
});
```

```sh
npm run test:e2e
  9 passed
```

`05`~`11`의 테스트(장바구니, 결제, 멱등성, 업로드, 오프라인)도 그대로 통과한다. 화면은 같고 데이터를 받는 길만 바뀌었기 때문이다.

`11`의 서비스 워커는 tRPC의 공개 프로시저(`GET /trpc/products.list?...`)도 URL로 캐시한다. `me.*`는 `Authorization` 헤더가 붙으므로 캐시하지 않는다.

### 남길 것

- **찾아보면 되는 것**: `createCaller`의 모양, `@ts-expect-error`, Playwright의 `page.on("request")`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `createCaller`는 컨텍스트를 직접 넘겨 "누가 요청했나"를 토큰 없이 정한다. 대신 `createContext`(토큰 검증)는 거치지 않으니, 그 부분은 HTTP로 한 번 확인한다.

  - 고친 것은 그 고침을 빼면 실패하는 테스트로 남긴다. 미들웨어를 빼고, `stack: undefined`를 빼서 실제로 빨간불이 켜지는지 본다.

  - Playwright는 3000번에 이미 떠 있는 서버를 그대로 쓴다. 코드와 상관없는 테스트가 깨지면 코드보다 먼저 "무엇을 상대로 돌았나"를 본다.

- **에러 신호**:

  - `AssertionError: expected 'INTERNAL_SERVER_ERROR' to be 'NOT_FOUND'` → `publicProcedure`에 `nestExceptions`가 붙어 있는지

  - `AssertionError: expected 'TRPCError: ...' to be undefined` → `errorFormatter`가 `stack`을 지우는지

  - e2e에서 `calls`가 `["/trpc/me.order", "/trpc/me.orders"]`처럼 둘로 나뉜다 → 끝 링크가 `httpBatchLink`인지

  - 프론트 e2e의 `offline.spec.ts`가 `page.waitForFunction: Test timeout of 30000ms exceeded`(`navigator.serviceWorker.ready`) → 3000번에 개발 서버(`next dev`)가 떠 있는지

## 10. 디버깅

### 진단 1. 프로시저를 손으로 부르기

| 하고 싶은 것 | 방법 |
|---|---|
| 입력 없는 query | `curl localhost:4000/trpc/products.list` |
| 입력 있는 query | `curl -G localhost:4000/trpc/me.order --data-urlencode 'input={"id":1}'` |
| 로그인 필요 | `-H "Authorization: Bearer $TOKEN"` |
| mutation | `curl -X POST localhost:4000/trpc/<이름> -H 'Content-Type: application/json' -d '<입력 JSON>'` |
| 브라우저의 묶음 요청 | Network 탭에서 `/trpc/a,b?batch=1` 요청의 Response가 배열이다. 순서는 경로의 이름 순서와 같다 |

### 진단 2. 응답 읽기

```text
{"error":{"message":"...","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404,"path":"me.order"}}}
```

`data.code`(문자열)와 `data.httpStatus`를 본다. 앞의 숫자 `code`는 JSON-RPC 규격의 번호라 거의 볼 일이 없다.

`data.path`는 어느 프로시저에서 난 에러인지 알려 준다. 묶음 요청이면 응답 배열의 각 칸에 따로 붙는다.

### 진단 3. 에러 코드·증상으로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `Cannot find module 'order-api-nest/trpc'` | 워크스페이스 링크가 없거나 `exports` 경로가 틀렸다 | 루트에서 `npm install`, 백엔드 `package.json`의 `exports` (1장·3단계) |
| 프로젝트 폴더 안에 `node_modules`·`package-lock.json`이 다시 생겼다 | 그 폴더에서 따로 설치했다 | 루트에서 설치 (1장) |
| 운영 빌드 화면에서 `TypeError: e.map is not a function` | 백엔드 응답 모양과 프론트가 손으로 적은 타입이 어긋났다 | 백엔드 응답, 프론트의 손으로 적은 타입 (1단계) |
| `error TS2304: Cannot find name 'LayoutProps'` | `.next/types`가 없다 | `npx next typegen` (1단계) |
| tRPC 요청만 서버 로그에 없다 | tRPC가 Nest 미들웨어(요청 로그)보다 먼저 돈다 | `main.ts`의 `app.use` (2단계) |
| 브라우저에서 CORS 에러, `OPTIONS`가 415 | preflight를 tRPC가 먼저 받았다 | `app.use`가 `enableCors()`보다 앞인지 (2단계) |
| 서버는 뜨는데 `/trpc/...`가 404 | `TrpcModule`의 `configure()`가 불리지 않았다 | `app.module.ts`의 `imports` (2단계) |
| `TS2345: Argument of type 'string \| null' is not assignable to parameter of type 'string'` | 미들웨어에서 좁힌 타입이 본문에 안 넘어왔다 | `next({ ctx })` (2단계) |
| `Nest could not find ... element (this provider does not exist in the current context)` | 다른 모듈의 서비스를 `strict` 모드로 찾았다 | `moduleRef.get`의 `{ strict: false }` (2단계) |
| 프론트 tsc에서 백엔드 파일의 `TS1241`·`TS1206 Decorators are not valid here` | 라우터가 데코레이터 파일을 끌어왔다 | 라우터의 import, 컨트롤러 대신 별도 파일 (3단계) |
| `Module not found: Can't resolve 'order-api-nest/trpc'` | 프론트가 값을 가져와 번들러가 찾으려 했다 | `import type`인지 (3단계) |
| 프론트 tsc의 `TS2339: Property 'map' does not exist on type` | 백엔드 프로시저의 반환 모양이 바뀌었다 | 백엔드 라우터, 프론트 화면 (3단계) |
| 프론트에서 `data`가 `any` | `import type { AppRouter }`가 실패했는데 다른 에러에 묻혔다 | `npx tsc --noEmit`로 전체 에러 (3단계) |
| 업로드·결제 뒤 목록이 안 바뀐다 | 문자열 캐시 키가 남아 있다 | `invalidateQueries`의 `["products"]` (3단계) |
| 잘못된 입력에 500과 ``Invalid `prisma....` invocation`` | 입력이 검사 없이 Prisma까지 갔다 | `.input()`이 zod 스키마인지 (4단계) |
| 응답에 `stack`이나 서버 파일 경로가 보인다 | 기본 에러 모양 그대로다 | `errorFormatter`의 `stack: undefined` (4단계) |
| 응답은 `"서버 오류"`뿐이고 원인을 모른다 | 원문은 로그에만 있다 | 서버 로그의 `{"context":"tRPC"}` 줄 (4단계) |
| 서비스의 404·409가 500 `"서버 오류"`로 나온다 | Nest 예외가 tRPC 에러로 바뀌지 않았다 | `nestExceptions` 미들웨어 (5단계) |
| 서버 로그에 `category 999 not found`가 ERROR로 찍힌다 | 사용자 실수가 서버 장애로 기록됐다 | `nestExceptions` 미들웨어 (5단계) |
| 로그인했는데 가끔 "로그인이 필요합니다", 묶음 응답이 207 | 공개 프로시저와 `me.*`가 한 묶음으로 나갔다 | `splitLink`의 `condition` (6단계) |
| 로그인하지 않았는데 `/auth/refresh`가 계속 나간다 | 공개 프로시저가 `fetchWithAuth` 링크로 간다 | `splitLink`의 `condition` (6단계) |
| `No procedure found on path "..."` (404) | 그런 이름의 프로시저가 없다 | 프로시저 이름 오타, 백엔드를 다시 빌드·재시작했는지 |
| `Missing content-type header` (415) | 요청 방식이 프로시저 종류와 안 맞는다 | `query`를 POST로 불렀는지, `mutation`에 `Content-Type: application/json`이 있는지 |
| Docker 빌드에서 `"/package-lock.json": not found` | 빌드 컨텍스트가 아직 백엔드 폴더다 | compose의 `context: ..` (7단계) |
| Docker 빌드에서 `Could not find Prisma Schema` | `WORKDIR`가 소스가 없는 빈 폴더다(경로 오타면 새로 만든다) | Dockerfile의 `WORKDIR` 철자 (7단계) |
| Docker 빌드에서 `npm error No workspaces found` | 워크스페이스 자리에 `package.json`이 든 폴더가 없다 | `COPY ... order-api-nest/`의 끝 `/` (7단계) |
| 컨테이너가 `Cannot find module`로 바로 죽는다 | 의존성을 찾는 길이 끊겼다 | `/app/node_modules`와 실행 위치 `/app/order-api-nest` (7단계) |
| 빌드가 느리고 컨텍스트 전송량이 크다 | `.dockerignore`가 읽히지 않는다 | 루트에 `.dockerignore`가 있는지 (7단계) |
| `expected 'INTERNAL_SERVER_ERROR' to be 'NOT_FOUND'` | Nest 예외 변환이 빠졌다 | `nestExceptions` (8단계) |
| `expected 'TRPCError: ...' to be undefined` | 응답에 `stack`이 나간다 | `errorFormatter` (8단계) |
| e2e의 `calls`가 둘로 나뉜다 | 요청이 묶이지 않았다 | 끝 링크가 `httpBatchLink`인지 (8단계) |
| 오프라인 e2e가 `navigator.serviceWorker.ready`에서 30초 timeout | Playwright가 3000번의 개발 서버를 재사용했다. 서비스 워커는 운영 빌드에서만 등록된다 | `lsof -iTCP:3000`, `next dev`를 끈다 (8단계) |

### 도전 과제

#### 1. 결제를 `mutation`으로 옮기기

결제(`POST /orders/checkout`)를 tRPC `mutation`으로 옮겨 본다.

`05`의 `Idempotency-Key`는 HTTP 헤더였다. tRPC에서는 입력 칸으로 넣을지, 링크의 `headers`로 넣을지 정하고 이유를 적는다.

5단계의 미들웨어가 `02`의 `ConflictException`(409)을 어떻게 바꾸는지도 확인한다.

**답**

1. 라우터에 `orders.checkout`을 `protectedProcedure.input(...).mutation(...)`으로 만들고, 안에서는 REST와 같은 `OrdersService.checkout`을 부른다. 서비스는 컨텍스트에 `orders`로 넣는다.

2. `Idempotency-Key`는 입력 칸(`idempotencyKey: z.string().min(1)`)으로 넣는다. `httpBatchLink`의 `headers`는 묶음 HTTP 요청 하나에 붙는다. 같은 순간에 나간 다른 요청과 묶이면 헤더 하나를 나눠 써야 한다. 입력 칸이면 요청마다 따로 실리고, zod 검증과 타입, `createCaller` 테스트까지 함께 받는다.

3. 프론트는 `useMutation(trpc.orders.checkout.mutationOptions({ onSuccess }))`로 만들고 `checkout.mutate({ idempotencyKey, items })`로 부른다. 손으로 적었던 `type CheckoutResult`는 지운다. `splitLink`의 `condition`에 `orders.checkout`도 넣어야 토큰이 붙는다.

4. 재고보다 많이 사면 `{"message":"재고 부족: 한정판 키보드","code":-32009,"data":{"code":"CONFLICT","httpStatus":409,...}}`가 409로 온다. 5단계의 미들웨어가 `ConflictException`의 상태 409를 `CONFLICT`로 바꾸고 메시지는 그대로 둔다.

5. 같은 키로 다른 내용을 보내면 서비스가 `UnprocessableEntityException`(422)을 던진다. 그런데 `CODE_BY_STATUS`에 422가 없어서 `INTERNAL_SERVER_ERROR`(500 "서버 오류")가 된다. `422: "UNPROCESSABLE_CONTENT"`를 더하면 422로 나간다.

> 함정이 하나 더 있다. 컨텍스트 타입에 `OrdersService`를 넣는 순간 프론트 tsc가 `checkout.dto.ts`에서 `TS1240`(속성 데코레이터)을 낸다. 서비스가 DTO 클래스를 `import type`으로 가져오기 때문이다. 3단계의 깨뜨려보기 ③과 같은 이유이므로, 서비스 파일에 `{ productId: number; quantity: number }` 타입을 직접 적어 DTO 파일을 끌어오지 않게 한다.

#### 2. 카테고리 필터 붙이기

`categories.tree`를 추가하고, 상점 화면에서 카테고리를 고르면 `categories.products`로 목록이 바뀌는 필터를 붙인다.

입력 타입이 프론트에서 어떻게 보이는지 확인한다.

**답**

1. 라우터에 `tree: publicProcedure.query(({ ctx }) => ctx.categories.tree())`를 더한다. 반환 타입 `CategoryNode[]`(`id`, `name`, `children`)가 그대로 프론트로 넘어와, 트리를 펼치는 코드도 타입을 따로 적지 않는다.

2. 상점 화면은 고른 카테고리를 `useState`에 두고 `useQuery(trpc.categories.products.queryOptions(categoryId === null ? skipToken : { categoryId }))`로 부른다. `skipToken`이면 요청하지 않는다. "컴퓨터"를 고르면 키보드·마우스 두 개, "생활"은 전기 주전자 하나만 남는다.

3. 입력 타입은 `{ categoryId: number }`로 보인다. `{ categoryId: "1" }`은 `Type 'string' is not assignable to type 'number'`, `{}`는 `Property 'categoryId' is missing`, 입력이 없는 `categories.tree.queryOptions({ x: 1 })`은 `parameter of type 'void'`로 tsc가 잡는다.

4. `.int().positive()`는 타입에 나타나지 않는다. `1.5`나 `-1`은 tsc를 통과하고, 서버의 zod가 400으로 막는다(`1.5`는 `expected int, received number`).

> `categories.products`는 `{ id, name, price, category }`만 돌려주고 재고·이미지가 없다. 화면은 전체 목록(`products.list`)에서 그 id만 골라 보여 주면 담기·업로드 버튼을 그대로 쓸 수 있다.

#### 3. 손으로 적은 응답 타입 찾기

프론트의 `MyOrder`처럼 손으로 적은 응답 타입이 저장소에 더 남아 있는지 찾아본다.

```sh
grep -rn "type .* = {" app lib
```

REST로 남겨 둔 것은 왜 남겼는지 적는다.

**답**

1. 백엔드 응답을 손으로 적은 것은 둘이다. `app/shop/page.tsx`의 `CheckoutResult`(결제)와 `app/shop/product-image-uploader.tsx`의 `UploadUrl`(업로드 URL)이다. 둘 다 쓰기 요청이라 REST로 남겼으므로, tRPC에서 가져올 타입이 없다.

2. 나머지는 응답 타입이 아니다. `lib/api.ts`의 `Order`는 주문 관리 화면(`app/orders`)이 쓰는 프론트 안의 가짜 데이터, `lib/cart-store.ts`의 `CartItem`·`CartState`와 `lib/auth-store.ts`의 `AuthState`는 프론트 자신의 상태다.

> 이 grep은 `type X = {` 꼴만 찾는다. `lib/api-client.ts`의 `parse<{ accessToken: string }>`처럼 그 자리에 바로 적은 타입(로그인·refresh 응답)은 걸리지 않는다.

### 남길 것

- **찾아보면 되는 것**: tRPC 요청의 URL 모양, JSON-RPC 숫자 코드, `curl -G --data-urlencode`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - tRPC 에러는 응답의 `data.code`·`data.httpStatus`·`data.path` 세 칸으로 읽는다.

  - 타입 에러는 "백엔드 파일인데 프론트 tsc에서 났는가"를 먼저 본다. 그렇다면 라우터가 끌어온 파일 문제다.

- **에러 신호**:

  - `No procedure found on path "..."` (404) → 프로시저 이름, 백엔드를 다시 빌드·재시작했는지

  - `Missing content-type header` (415) → `query`를 POST로 불렀는지, `mutation`에 `Content-Type`이 있는지

## 11. 완성 확인

### 시험해보기

```sh
# 백엔드
cd order-api-nest && npm run start:dev
curl -s localhost:4000/trpc/products.list | head -c 100
npm run test:e2e # 17 passed

# 프론트(개발 서버는 끈 상태로)
cd ../order-console-next && npm run test:e2e # 9 passed
```

프론트 e2e는 `playwright.config.ts`가 `npm run build && npm run start`로 직접 띄운다. 그래서 개발 서버가 3000번을 잡고 있으면 그쪽을 그대로 쓰게 되니 꺼 둔다.

### 체크리스트

- [ ] REST에서 백엔드 응답 모양을 바꾸면 프론트 tsc는 통과하고 화면이 깨지는 것을 재현했다

- [ ] 두 프로젝트가 워크스페이스로 묶였고, 프론트가 `order-api-nest/trpc`에서 타입만 가져온다

- [ ] 같은 변경을 tRPC로 하면 프론트 tsc와 `next build`가 파일과 줄 번호를 짚어 멈춘다

- [ ] 라우터가 컨트롤러를 끌어오면 프론트 타입 검사가 깨지는 이유를 설명할 수 있다

- [ ] 잘못된 입력은 400, 내부 에러는 "서버 오류"(원문은 로그), 응답에 `stack`이 없다

- [ ] Nest 예외가 tRPC에서 500이 되는 것을 재현했고, 미들웨어로 404가 된다

- [ ] 주문 상세의 두 요청이 HTTP 하나로 묶이고, 링크를 나눈 이유(207)를 설명할 수 있다

- [ ] Docker 이미지가 워크스페이스 루트에서 빌드되고 컨테이너로 정상 동작한다

- [ ] 백엔드 `npm run test:e2e` 17개, 프론트 `npm run test:e2e` 9개가 통과한다

## 12. 다음 단계

### 자가 점검

1. REST에서 백엔드 응답이 바뀌어도 프론트 타입 검사가 통과하는 이유는? C의 헤더 파일로 비유하면 무엇이 빠져 있는가?

2. 프론트는 백엔드 코드를 번들에 넣지 않는데, 어떻게 백엔드 함수의 반환 타입을 아는가?

3. 백엔드에서는 문제없는 `me.controller.ts`가 프론트 타입 검사에서 에러가 나는 이유는? `PrismaService`는 왜 괜찮은가?

4. tRPC 경로에는 Nest의 `ValidationPipe`와 예외 필터가 적용되지 않는다. 왜 그런가? 그래서 무엇을 따로 했는가?

5. 서비스가 던진 `NotFoundException`이 tRPC에서 500이 되는 것은 어떤 점에서 문제인가?

6. 묶음 요청의 상태 코드가 207이 되는 경우는? 그게 `fetchWithAuth`의 refresh와 어떻게 부딪히는가?

7. 워크스페이스로 바꾼 뒤 Docker 빌드 컨텍스트를 루트로 넓힌 이유는? 백엔드 이미지에 프론트의 `package.json`을 넣지 않는 이유는?

8. tRPC 대신 REST를 남겨 두는 것이 나은 경우는?(힌트: 이 API를 쓰는 쪽이 TypeScript가 아닐 때)

9. gRPC와 tRPC는 둘 다 RPC다. 계약을 어디에 적고 클라이언트에 어떻게 넘기는지로 둘을 구분하면? 채용 공고의 "서비스 간 통신에 gRPC"가 브라우저↔서버가 아니라 서버↔서버인 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- `Date`·`Map` 같은 값을 JSON 너머로 그대로 보내는 변환기(transformer, 예: superjson)

- 실시간 구독(subscription). 앞에서 만든 WebSocket 알림을 tRPC로 옮기기

- 서버 컴포넌트에서 프로시저를 직접 부르거나 미리 받아 두기(prefetch, hydration)

- 외부 클라이언트(모바일 앱, 다른 언어)를 위해 tRPC 라우터에서 OpenAPI 문서 만들기

- Nest의 모듈·데코레이터 방식으로 tRPC를 감싸는 통합 라이브러리

- Turborepo·pnpm 같은 모노레포 도구, 워크스페이스 사이의 빌드 순서와 캐시

- gRPC 직접 붙이기(`.proto` 작성과 코드 생성, Nest `@nestjs/microservices`의 gRPC 전송)
