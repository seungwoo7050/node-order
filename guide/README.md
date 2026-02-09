# 페이지네이션과 잠금: 30만 건을 나눠 읽고, 같은 재고를 동시에 판다

## 목표

[`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)까지 만든 주문 서비스는 목록을 한 번에 다 돌려준다. 주문이 다섯 건일 때는 문제가 없었다. 이 문서는 주문을 30만 건으로 늘려 그 목록이 어떻게 무너지는지 재고, 고친다.

그다음 [`02`](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency)에서 `FOR UPDATE`로 막았던 초과 판매를 다른 잠금 두 가지로도 막아 보고, 부하에서 셋을 비교한다. 끝으로 관리자의 재고 입고가 같은 재고를 덮어쓰지 않게 한다.

1. 상품, 전체 주문(관리자), 내 주문 목록이 전체 행을 돌려준다. 내 주문 하나가 7MB를 넘는다. cursor 방식으로 한 페이지씩 나눈다. REST와 tRPC를 함께 바꾼다

2. offset 방식과 cursor 방식의 실행 계획과 HTTP 지연을 깊은 페이지에서 비교한다. 페이지를 넘기는 사이에 주문이 생기거나 결제되면 offset이 같은 주문을 두 번 보여 주거나 건너뛰는 것을 재현한다

3. 내 주문·상점·관리자 상품 화면을 무한 스크롤로 바꾼다. 키보드와 화면 낭독기로도 넘길 수 있게 하고, 상태가 바뀐 주문과 새 주문을 목록 캐시에서 어떻게 고치는지 정한다

4. 재고 차감을 비관적 잠금, 낙관적 잠금(`version` 칸), `SERIALIZABLE`로 바꿔 가며 정합성과 처리량을 잰다. 결과를 보고 하나를 고른다

5. 관리자의 재고 입고를 "재고 = 50"이 아니라 "40개 더하기"로 받는다. 덮어쓰면 그사이 팔린 수량이 사라지는 것을 재현하고 고친다

6. REST API 문서를 `/docs`에 띄운다

```text
목록(주문 30만 건)            바꾸기 전                 바꾼 뒤(20건씩)
  GET /me/orders              7,337,581B  0.54s          2,015B  0.007s
  GET /orders                 16,044,491B 0.72s          1,892B  0.006s

깊이별 HTTP 지연(중앙값)       offset      cursor
  0번째 행부터                 3.4ms       3.2ms
  250,000번째 행부터           75.3ms      4.9ms

k6 20 VU 20초, 성공한 결제 수   상품 50개에 흩어짐    인기 상품 하나에 몰림
  비관적 잠금(FOR UPDATE)       8,897 (100%)          5,129 (100%)
  낙관적 잠금(version)          8,554 (100%)          2,782 (55.4%)
  SERIALIZABLE                  3,655 (64.7%)         2,351 (51.6%)

입고 40개와 결제 5건이 겹칠 때   맞는 재고    실제 재고
  재고를 숫자로 덮어쓰기(PUT)    45           50
  증가량으로 더하기(delta)       45           45
```

> 전제: [`21-public-demo`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)까지의 코드가 있다.  이 브랜치 `22-pagination-locking`은 `21-public-demo`의 소스를 그대로 가져온 커밋에서 시작한다. 경로는 모두 저장소 루트 기준이다.  
> 배포한 서버는 쓰지 않는다. 모두 이 PC에서 compose와 `npm`으로 띄운다. 배포 브랜치는 저장소 변수 `DEPLOY_BRANCH`로 정하고 여기서 바꾸지 않으므로, 이 브랜치를 푸시하면 검사·테스트만 돈다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 측정 결과를 읽는 법 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨리거나 바꿔 보는 것. 결과가 에러이거나 버릴 코드다 | 친다. 바로 뒤의 `[원복]` 작업이나 다음 작업에서 되돌린다 |
| `진단 N.` | 11장에서 증상으로 원인을 가르는 절차 | 친다 |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. `실험`은 건너뛰어도 되고, 따라갔다면 바로 뒤의 `[원복]` 작업이나 실험 파일을 통째로 바꾸는 다음 작업에서 되돌린다. 실험과 그 원복 사이에는 `[커밋]` 작업을 두지 않았다. 8장은 실험 두 개를 쌓은 뒤 작업 1에서 한 번에 원복한다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가른다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드·테스트, 마이그레이션, `scripts/`의 측정 스크립트, `loadtest/`, 패키지 설치(`package.json`·lock) | 한다 |
| `[실행]` | 저장소 밖의 상태: 띄운 컨테이너와 API, DB의 시드·결제 데이터. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 응답 크기·시간 재기, 실행 계획, 테스트, 부하 결과 읽기 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`. 측정 스크립트를 만들어 바로 돌리는 작업은 `[커밋]`이다.

- 코드 블록은 두 모양이다. 이 단계에서 새로 만드는 파일은 전체를 싣고, 첫 줄에 경로 주석(`// order-api-nest/...`, `-- order-api-nest/...`)을 둔다. 이 경로 주석은 실제 파일에 넣지 않는다. 이미 있는 파일은 `diff` 블록으로 싣는다. `-` 줄을 지우고 `+` 줄을 넣으며, 앞뒤의 문맥 줄로 자리를 찾는다. `@@`는 덩어리의 경계다.

- 스니펫의 주석은 학습용이다. 왜 그 줄이 필요한지를 적었다. 저장소의 다른 코드보다 주석이 많은 것은 의도한 차이다.

- 출력의 숫자와 시각, 번호는 이 PC에서 다시 재면 달라진다. 모양(무엇이 몇 배인가, 어느 쪽이 실패하는가)을 본다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 11장 "진단 9"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 11~13장은 디버깅·체크리스트·자가 점검이라 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 페이지네이션과 잠금에 대한 사전지식](#0-페이지네이션과-잠금에-대한-사전지식) | 인덱스와 실행 계획, offset과 cursor, `count(*)`, 격리 수준과 세 가지 잠금, 재시도와 Write Skew, 결과와 변화, Stripe 시뮬레이터, 21의 장치(작업 없음) |
| [1. 준비](#1-준비) | 인프라와 시드, Stripe 시뮬레이터, 결제 하나, 요청 수 제한 확인 |
| [2. 1단계: 주문을 30만 건으로 늘리고 지금 목록을 잰다](#2-1단계-주문을-30만-건으로-늘리고-지금-목록을-잰다) | 30만 건을 넣고 지금 목록의 크기·시간·실행 계획을 잰다 |
| [3. 2단계: 정렬 순서대로 인덱스를 만들고 실행 계획을 본다](#3-2단계-정렬-순서대로-인덱스를-만들고-실행-계획을-본다) | 복합 인덱스를 만들고, 깊은 자리에서 offset·cursor·OR 조건의 실행 계획을 비교한다 |
| [4. 3단계: 목록 API를 cursor 페이지로 바꾼다](#4-3단계-목록-api를-cursor-페이지로-바꾼다) | 세 목록을 `{ items, nextCursor }`로 바꾸고 쿼리 문자열을 DTO로 받는다 |
| [5. 4단계: 일부러 깨뜨려보기 ①, 넘기는 사이에 목록이 바뀐다](#5-4단계-일부러-깨뜨려보기-①-넘기는-사이에-목록이-바뀐다) | offset이 겹치고 건너뛰는 것을 재현하고, 깊이별 지연과 RLS의 영향을 본다 |
| [6. 5단계: 목록 화면을 무한 스크롤로](#6-5단계-목록-화면을-무한-스크롤로) | 무한 쿼리와 "더 보기", 장바구니의 `pathKey`, 결제 뒤 목록 캐시의 한 줄 고치기 |
| [7. 6단계: 같은 재고를 비관적 잠금으로 판다](#7-6단계-같은-재고를-비관적-잠금으로-판다) | 비관적 잠금으로 동시 결제 50건과 k6 흩어짐·몰림 기준선을 잰다 |
| [8. 7단계: 일부러 바꿔보기, 낙관적 잠금과 SERIALIZABLE](#8-7단계-일부러-바꿔보기-낙관적-잠금과-serializable) | 낙관적·`SERIALIZABLE`을 실험으로 같은 부하에 걸고, 원복한 뒤 하나를 고른다 |
| [9. 8단계: 관리자의 재고 입고를 증가량으로 받는다](#9-8단계-관리자의-재고-입고를-증가량으로-받는다) | "재고 = 50"이 판매를 지우는 것을 재현하고, 증가량 API와 관리자 입력칸을 만든다 |
| [10. 9단계: API 문서](#10-9단계-api-문서) | `/docs`에 Swagger 문서를 띄운다 |
| [11. 디버깅](#11-디버깅) | 증상별 진단과 에러 신호 표 |
| [12. 완성 확인](#12-완성-확인) | 테스트와 체크리스트 |
| [13. 다음 단계](#13-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 페이지네이션과 잠금에 대한 사전지식

이 장은 뒤 단계가 기대는 개념을 모았다. 작업은 없고, 각 개념이 이 서비스의 어느 코드에서 드러나는지를 함께 적었다. 측정과 재현은 1장부터 한다.

### 개념 1 | 인덱스는 정렬된 사본이고, 복합 인덱스는 앞 칸부터 쓴다

PostgreSQL의 기본 인덱스(B-tree)는 고른 칸의 값을 정렬해 두고, 값마다 그 행이 테이블의 어디에 있는지를 적어 둔 별도의 구조다. 정렬돼 있으므로 "이 값의 자리"를 찾는 데 행 수의 로그만큼만 내려가면 되고, 찾은 자리에서 앞뒤로 차례대로 읽을 수 있다. 그래서 인덱스는 두 가지에 쓰인다. 조건으로 범위를 좁히는 것과, 정렬 순서대로 읽어 정렬을 생략하는 것이다. 이 문서의 목록은 둘 다 쓴다.

복합 인덱스 `(user_id, created_at, id)`는 전화번호부처럼 정렬된다. 먼저 `user_id`로, 같은 `user_id` 안에서 `created_at`으로, 그 안에서 `id`로. 그래서 앞 칸부터 차례로 조건을 걸 때만 범위가 된다.

| 쿼리 | 이 인덱스로 |
|---|---|
| `WHERE user_id = 'kim' ORDER BY created_at DESC, id DESC` | kim의 구간으로 내려가 뒤에서부터 읽는다. 정렬이 필요 없다 |
| `WHERE user_id = 'kim'` | 앞 칸만 써도 범위가 된다. 그래서 3장에서 `(user_id)` 하나짜리 인덱스를 지운다 |
| `ORDER BY created_at DESC` (사용자 조건 없음) | 첫 칸을 건너뛸 수 없어 쓰지 못한다. 그래서 `(created_at, id)`를 따로 만든다 |

(이 저장소의 `compose.yaml`은 PostgreSQL 17이다. 18부터는 앞 칸을 건너뛰는 "skip scan"이 일부 경우를 돕지만, 앞 칸부터 쓴다는 원칙은 그대로다.)

인덱스는 공짜가 아니다. 행을 넣고 고칠 때마다 인덱스도 고쳐야 하고, 디스크를 차지한다. 그래서 목록이 실제로 쓰는 정렬 순서에 맞춘 것만 만든다.

DB가 인덱스를 쓸지는 플래너가 정한다. 플래너는 테이블 통계(행 수, 값의 분포)로 방법마다 비용을 어림하고 가장 싼 것을 고른다. `EXPLAIN`은 고른 방법(실행 계획)을 보여 주고, `EXPLAIN ANALYZE`는 실제로 실행해 단계마다 걸린 시간과 행 수를 붙인다. 어림이 틀리면 계획도 틀린다. 2장에서 30만 건을 넣은 뒤 `ANALYZE`로 통계를 새로 모으는 이유이고, 5장의 RLS가 플래너를 속이는 장면이 그 예다.

### 개념 2 | offset은 건너뛸 행을 모두 읽는다

`LIMIT 20 OFFSET 200000`은 "20만 행을 건너뛰고 20행"이다. DB는 건너뛸 행이 어디서 끝나는지 모른다. 그래서 정렬 순서대로 20만 행을 실제로 읽어 버린 뒤 20행을 돌려준다. C의 연결 리스트에서 `n`번째 노드로 가려면 `next`를 `n`번 따라가야 하는 것과 같다.

### 개념 3 | cursor는 "이 행 다음"을 값으로 가리킨다

cursor 방식(keyset 방식)은 앞 페이지의 마지막 행의 정렬 키를 기억했다가 "그 값보다 작은 것부터 20행"을 묻는다. 정렬 키에 인덱스가 있으면 DB는 그 값의 자리로 바로 내려가 20행만 읽는다. 연결 리스트를 세는 대신 정렬된 배열에서 이진 탐색으로 자리를 찾는 것과 같다.

대신 "37쪽으로 건너뛰기"가 안 되고, 정렬 키가 행마다 유일해야 한다. 주문은 `createdAt`이 같을 수 있으므로 `(createdAt, id)` 두 칸을 정렬 키로 쓴다.

### 개념 4 | `count(*)`는 행을 다 센다

PostgreSQL은 테이블의 행 수를 어디에도 정확히 적어 두지 않는다. 같은 순간에도 트랜잭션마다 보이는 행이 다르기 때문이다(아래 개념 5의 MVCC). 그래서 `SELECT count(*)`는 조건에 맞는 행을 실제로 하나씩 찾아 센다. 인덱스만 읽는 경우에도 30만 항목을 다 지난다. "전체 3,742쪽 중 1쪽" 같은 표시는 매 요청마다 전체를 읽는다는 뜻이다. 그래서 4장의 목록은 개수를 세지 않고, 한 행 더 읽어 "다음이 있는가"만 안다.

### 개념 5 | 격리 수준과 Lost Update

PostgreSQL은 행을 고칠 때 덮어쓰지 않고 새 판을 만든다(MVCC). 트랜잭션은 자기가 볼 수 있는 판만 읽는다. 그래서 읽는 쪽은 쓰는 쪽을 기다리지 않는다. 어느 시점의 판을 보는지가 격리 수준이다.

| 격리 수준 | 문장마다 보는 것 | 같은 행을 다른 트랜잭션이 먼저 고쳤으면 |
|---|---|---|
| `READ COMMITTED`(기본값) | 그 문장이 시작한 순간까지 커밋된 것 | `UPDATE`는 그 트랜잭션이 끝나길 기다린 뒤 새 판에 적용한다 |
| `REPEATABLE READ` | 트랜잭션의 첫 문장 때의 스냅숏 | 실패한다(`40001`) |
| `SERIALIZABLE` | `REPEATABLE READ`와 같은 스냅숏 | 실패한다. 서로 다른 행이라도, 어느 순서로 차례대로 실행했어도 나올 수 없는 결과면 실패한다 |

Lost Update는 기본값인 `READ COMMITTED`에서 생긴다. 두 결제가 재고 10을 동시에 읽고, 각자 앱에서 9를 계산해 `SET stock = 9`로 쓰면 둘 다 성공하고 재고는 9다. 하나가 사라졌다. 읽은 값으로 계산해 덮어쓰는 모양이 문제다. 막는 길은 셋이다.

- 읽을 때 잠근다(`SELECT … FOR UPDATE`). 둘째 결제는 첫째가 끝날 때까지 기다렸다가 8을 읽는다. 지금 `placeOrder`의 방식이다

- 쓸 때 확인한다(`WHERE version = 읽은 값`). 둘째는 0행을 고치고 다시 한다. 8장의 낙관적 실험이다

- 계산을 DB에 맡긴다(`SET stock = stock - 1`). 한 문장 안에서 읽고 쓰므로 틈이 없다. 9장의 재고 조정이 이 모양이다

### 개념 6 | 잠금은 기다리게 하거나, 나중에 확인해 다시 하게 한다

비관적 잠금(`SELECT … FOR UPDATE`)은 읽을 때 행을 잠가 다른 트랜잭션을 기다리게 한다. 낙관적 잠금은 잠그지 않고 읽은 뒤, 쓸 때 "그사이 누가 고쳤는가"를 `version` 칸으로 확인하고 고쳤으면 처음부터 다시 한다. `SERIALIZABLE`은 DB가 그 확인을 대신 해 주고, 겹치면 트랜잭션 하나를 실패시킨다(SQLSTATE `40001`). 뒤의 둘은 다시 하는 코드를 앱이 가져야 한다.

### 개념 7 | 직렬화 실패와 재시도, Write Skew

낙관적 잠금의 충돌과 `SERIALIZABLE`의 실패(`40001`)는 둘 다 "다시 하면 성공할 수 있는 실패"다. 다시 할 때는 실패한 문장 하나가 아니라 트랜잭션 전체를 처음부터 한다. 앞에서 읽은 값이 이미 낡았기 때문이다. 그래서 재시도는 트랜잭션을 여는 쪽(`placeOrReplay`)에서 감싼다.

곧바로 다시 하면 안 된다. 같이 부딪힌 트랜잭션들이 같은 순간에 다시 시작해 또 부딪친다. 그래서 기다렸다 한다. 기다리는 시간은 시도마다 두 배로 늘리고(지수 백오프), 그 범위 안에서 무작위로 고른다(지터). 8장 낙관적 실험의 `withRetry`는 `attempt`번째에 0~`10 × 2^attempt`ms 사이를 기다린다. 두 배로 늘리는 것은 붐비는 동안 시도 횟수를 줄이려는 것이고, 무작위로 흩는 것은 같이 실패한 쪽끼리 다시 줄을 맞추지 않게 하려는 것이다. 다섯 번까지만 하고 409로 돌려준다. 끝없이 다시 하면 붐빌수록 일이 늘어 더 붐빈다.

`SERIALIZABLE`이 따로 있는 이유는 Write Skew 때문이다. 두 트랜잭션이 같은 조건을 읽고, 각자 다른 행을 고쳐, 합치면 그 조건이 깨지는 경우다. 당직 의사가 둘일 때 둘이 동시에 "다른 한 명이 남아 있다"를 확인하고 각자 자기 행을 "퇴근"으로 바꾸면 당직이 0명이 된다. 같은 행을 고치지 않았으니 `FOR UPDATE`도 `version`도 걸리지 않는다. `SERIALIZABLE`은 각 트랜잭션이 읽은 범위를 기록해 두었다가(`SIReadLock`) 이런 엇갈림을 찾아 하나를 실패시킨다. 이 기록은 행 단위로 시작하지만 많아지면 페이지나 테이블 단위로 뭉뚱그린다. 8장에서 서로 다른 상품을 산 결제가 실패하는 이유가 이것이다.

### 개념 8 | 재고는 결과가 아니라 변화로 고친다

잠금은 한 트랜잭션 안의 "읽고 → 계산하고 → 쓰기"를 지킨다. 관리자 화면은 그보다 훨씬 길다. 관리자가 상품 관리 화면을 열어 재고 10을 보고, 입고된 40개를 더해 "50"을 저장하기까지 몇 분이 걸린다. 그사이 결제 5건이 재고를 5로 줄였다면, "재고 = 50"은 그 5건을 지운다. 판 물건이 장부에서 되살아난다.

HTTP 요청 두 개에 걸친 행 잠금은 걸 수 없다. 길은 둘이다. "내가 본 값이 그대로일 때만 저장"(낙관적 잠금, 8장)으로 거절하거나, 처음부터 결과(50)가 아니라 변화(+40)를 보내 DB가 지금 값에 더하게 한다. 입고는 관리자가 아는 것이 "40개가 들어왔다"이므로 변화로 보내는 쪽이 맞다. 9장에서 다룬다.

### 개념 9 | 결제는 Stripe 시뮬레이터로 한다

[`14`](https://github.com/seungwoo7050/node-order/tree/14-stripe)부터 결제를 누르면 Stripe에 결제 세션을 만든다. 키가 없으면 세션을 만들지 못해 보상 처리로 주문을 바로 취소한다. 동시 결제 실험을 하려면 Stripe 계정이 필요했고, 수천 건을 보내면 테스트 모드의 요청 수 제한에 걸린다. 그래서 Stripe의 세션 만들기와 결제 완료 웹훅만 흉내 내는 시뮬레이터를 4100번 포트에 둔다.

### 개념 10 | 21의 요청 수 제한과 임시 계정은 이 실험에 끼어드는가

[`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)은 공개 데모를 위해 세 가지를 더했다. 이 문서의 대량 시드·k6·동시 요청 실험과 어떻게 만나는지 코드로 확인해 두면 측정이 흔들릴 때 원인에서 뺄 수 있다.

- **요청 수 제한**(`src/rate-limit/rate-limit.middleware.ts`): 한도는 `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`에서 읽고, 값이 없거나 0이면 세지 않고 통과시킨다. 켜는 곳은 배포용 `deploy/compose.yml`(분당 300·20)뿐이고 `order-api-nest/.env`에는 없다. 그래서 이 PC의 실험은 걸리지 않는다. k6는 한 IP에서 초당 200건 넘게 보내므로, 켜 둔 채 재면 결과가 429로 채워진다. 1장 작업 4에서 꺼져 있는지 확인한다.

- **방문자별 임시 계정**: `POST /auth/demo`가 `demo-…` 사용자를 만들고 그 사용자에게 견본 주문 두 건을 붙인다. 실험은 시드 사용자(`kim`, `lee` 등)로만 하고, 시드(`npx prisma db seed`)는 맨 먼저 임시 사용자와 그 주문을 지운다. 측정 전에 시드를 다시 돌리면 임시 계정이 장부(남은 재고 + 팔린 수량)에 섞이지 않는다.

- **읽기 전용 데모 관리자**(`demo_admin`): `AdminGuard`가 관리자 경로를 GET까지 403(`데모 관리자는 볼 수만 있습니다`)으로 막는다. 전체 주문 목록(`GET /orders`)은 다른 방문자의 주문이 다 보이는 경로라 이 문서에서도 진짜 관리자만 본다. 측정 스크립트는 시드의 관리자 `kim`으로 로그인한다. 9장의 재고 조정 API도 같은 가드 뒤에 둔다. 상품 목록은 누구나 보는 경로라 그대로 공개다.

## 1. 준비

### 작업 1. [실행] 인프라를 띄우고 마이그레이션과 시드

인프라를 띄우고, 마이그레이션과 시드를 한다. `21`과 같다.

```sh
# 저장소 루트에서
npm ci
docker compose up -d
cd order-api-nest
npx prisma generate && npx prisma migrate deploy && npx prisma db seed
```

### 작업 2. [커밋] Stripe 시뮬레이터를 붙인다

`StripeGateway`는 `STRIPE_SIMULATOR_URL`이 있으면 Stripe SDK가 그 주소를 부르게 한다. SDK의 `host`·`port`·`protocol` 설정만 바꾸므로 결제 세션을 만드는 코드는 그대로다.

```diff
--- a/order-api-nest/src/payments/stripe.gateway.ts
+++ b/order-api-nest/src/payments/stripe.gateway.ts
@@
 
 export type CheckoutSession = { id: string; url: string };
 
+// 시뮬레이터가 웹훅에 서명할 때 쓰는 값. 학습용이라 비밀이 아니다
+export const SIMULATOR_WEBHOOK_SECRET = "whsec_simulator";
+
+// 실행할 때 주소를 준 프로세스만 시뮬레이터로 간다. 운영 이미지(NODE_ENV=production)에서는 실수로 줘도 무시한다
+function simulatorUrl(): URL | undefined {
+  const url = process.env.STRIPE_SIMULATOR_URL;
+  return url && process.env.NODE_ENV !== "production" ? new URL(url) : undefined;
+}
+
 @Injectable()
 export class StripeGateway {
   private client?: Stripe;
 
   private get stripe(): Stripe {
+    const sim = simulatorUrl();
+    // SDK가 부를 주소만 바꾼다. 결제 세션을 만드는 아래 코드는 그대로다
+    if (sim) return (this.client ??= new Stripe("sk_test_simulator", { protocol: "http", host: sim.hostname, port: sim.port }));
     const key = process.env.STRIPE_SECRET_KEY;
     if (!key) throw new Error("STRIPE_SECRET_KEY 환경변수가 없습니다");
     return (this.client ??= new Stripe(key));
@@
   }
 
   constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
-    const secret = process.env.STRIPE_WEBHOOK_SECRET;
+    const secret = simulatorUrl() ? SIMULATOR_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET;
     if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET 환경변수가 없습니다");
     return Stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
   }
```

시뮬레이터로 갈지는 키가 있는지가 아니라 "실행할 때 주소를 줬는가"로 정한다. `order-api-nest/.env.local`에는 [`14`](https://github.com/seungwoo7050/node-order/tree/14-stripe)에서 넣은 진짜 테스트 키가 있고, `main.ts`가 이 파일을 읽는다. "키가 없을 때만 시뮬레이터"로 두면 실험할 때마다 키를 지워야 한다. 그래서 `.env`에 주소를 적지 않고, 시뮬레이터가 필요한 실행에만 `STRIPE_SIMULATOR_URL=…`을 앞에 붙인다. 운영 이미지는 `NODE_ENV=production`이라 주소가 잘못 들어가도 무시한다.

시뮬레이터(`scripts/stripe-sim.mjs`)는 세 경로만 안다. Stripe SDK가 부르는 `POST /v1/checkout/sessions`, 브라우저가 가는 결제 화면 `GET /c/pay/:id`, 그 화면의 버튼이 부르는 `POST /c/pay/:id/complete`·`/cancel`이다. 결제 완료를 누르면 브라우저를 가게로 먼저 돌려보내고, 1초 뒤에 Stripe와 같은 방식(타임스탬프 + HMAC-SHA256)으로 서명한 웹훅을 API에 보낸다. 진짜 Stripe도 둘의 순서를 보장하지 않는다.

```js
// order-api-nest/scripts/stripe-sim.mjs
// Stripe 시뮬레이터: 결제 세션 만들기, 결제 화면, 결제 완료 웹훅만 흉내 낸다
//   node scripts/stripe-sim.mjs
//   SIM_LATENCY_MS=300 node scripts/stripe-sim.mjs     세션 만들기에 Stripe만큼 시간이 걸리게
//   SIM_WEBHOOK_DELAY_MS=0 node scripts/stripe-sim.mjs 웹훅을 가게로 돌려보내기 전에 보낸다
import { createServer } from "node:http";
import Stripe from "stripe";

const PORT = Number(process.env.SIM_PORT ?? 4100);
const API = process.env.SIM_API_URL ?? "http://localhost:4000";
const LATENCY_MS = Number(process.env.SIM_LATENCY_MS ?? 0);
// 웹훅은 브라우저를 가게로 돌려보낸 "뒤에" 보낸다. 진짜 Stripe도 둘의 순서를 보장하지 않는다
const WEBHOOK_DELAY_MS = Number(process.env.SIM_WEBHOOK_DELAY_MS ?? 1000);
const SECRET = "whsec_simulator"; // API의 SIMULATOR_WEBHOOK_SECRET과 같은 값

const sessions = new Map(); // 메모리에만 있다. 껐다 켜면 예전 결제 화면 주소는 404
let seq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stripe SDK는 본문을 폼 형식(line_items[0][price_data][unit_amount]=...)으로 보낸다
async function readForm(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

async function sendCompleted(session) {
  const payload = JSON.stringify({
    id: `evt_sim_${session.id}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: session.id, object: "checkout.session", payment_status: "paid", client_reference_id: session.orderId, metadata: { orderId: session.orderId } } },
  });
  // Stripe와 같은 방식(타임스탬프 + HMAC-SHA256)으로 서명한다 → API의 검증 코드를 그대로 통과한다
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(`${API}/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
  console.log(`웹훅 checkout.session.completed ${session.id} → ${res.status}`);
}

const page = (s) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>결제 시뮬레이터</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">결제 시뮬레이터</h1>
<p>주문 #${s.orderId} · ${s.amount.toLocaleString("ko-KR")}원</p>
<form method="post" action="/c/pay/${s.id}/complete"><button>결제 완료</button></form>
<form method="post" action="/c/pay/${s.id}/cancel" style="margin-top:.5rem"><button>취소하고 돌아가기</button></form>
</body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const form = await readForm(req);
    await sleep(LATENCY_MS);
    const id = `cs_test_sim_${Date.now()}_${++seq}`;
    sessions.set(id, {
      id,
      orderId: form.get("client_reference_id"),
      amount: Number(form.get("line_items[0][price_data][unit_amount]")),
      successUrl: form.get("success_url"),
      cancelUrl: form.get("cancel_url"),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id, object: "checkout.session", url: `http://localhost:${PORT}/c/pay/${id}` }));
  }
  const m = url.pathname.match(/^\/c\/pay\/(\w+)(?:\/(complete|cancel))?$/);
  const session = m && sessions.get(m[1]);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `시뮬레이터에 없는 경로나 세션: ${url.pathname}` } }));
  }
  if (req.method === "GET" && !m[2]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page(session));
  }
  if (req.method === "POST" && m[2] === "complete") {
    const send = () => sendCompleted(session).catch((err) => console.error(`웹훅 실패: ${err.message}`));
    if (WEBHOOK_DELAY_MS > 0) setTimeout(send, WEBHOOK_DELAY_MS);
    else await send();
  }
  // 완료도 취소도 Stripe처럼 가게로 돌려보낸다. 취소는 웹훅을 보내지 않는다(만료 웹훅은 24시간 뒤에 온다)
  res.writeHead(303, { Location: m[2] === "complete" ? session.successUrl : session.cancelUrl });
  res.end();
}).listen(PORT, () => console.log(`Stripe 시뮬레이터: http://localhost:${PORT} (API ${API}, 세션 지연 ${LATENCY_MS}ms, 웹훅 지연 ${WEBHOOK_DELAY_MS}ms)`));
```

`sk_test_simulator`와 `whsec_simulator`는 시뮬레이터끼리만 쓰는 값이다. 진짜 키가 아니고 비밀도 아니다.

### 작업 3. [실행] 시뮬레이터와 API를 띄우고 결제 하나 해 보기

터미널 셋에 시뮬레이터, API, 확인용 셸을 둔다. 측정을 하므로 API는 watch 모드가 아니라 빌드해서 띄운다.

```sh
# 터미널 1(저장소 루트에서)
cd order-api-nest && node scripts/stripe-sim.mjs
# 출력
Stripe 시뮬레이터: http://localhost:4100 (API http://localhost:4000, 세션 지연 0ms, 웹훅 지연 1000ms)

# 터미널 2(저장소 루트에서)
cd order-api-nest && npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js
```

결제를 하나 만들고, 결제 화면의 "결제 완료"를 누른 것처럼 부른다. `kim`은 시드의 관리자이고, 물건도 산다.

```sh
# 터미널 3(저장소 루트에서)
T=$(curl -s -XPOST localhost:4000/auth/login -H 'content-type: application/json' -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
ORDER=$(curl -s -XPOST localhost:4000/orders/checkout -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"items":[{"productId":6,"quantity":1}]}')
echo "$ORDER"
# 출력
# {"id":73,"user":"kim","price":30000,"paid":false,"items":[{"productId":6,"quantity":1,"unitPrice":30000}],"checkoutUrl":"http://localhost:4100/c/pay/cs_test_sim_1769577167014_1"}

# 결제 화면 주소는 매번 달라진다 → 응답에서 꺼내 그 뒤에 /complete를 붙인다
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -XPOST "$(echo "$ORDER" | jq -r .checkoutUrl)/complete"
# 출력
# 303 http://localhost:3000/me/orders/73?checkout=success
```

1초 뒤 시뮬레이터 터미널에 `웹훅 checkout.session.completed cs_test_sim_… → 200`이 찍히고, 그 주문은 `paid: true`가 된다. 주문 번호는 이 DB에서 지금까지 만든 주문 수에 따라 다르다. 시드 직후의 새 DB라면 시드 주문 1~5번 다음인 6번이다.

`checkoutUrl`을 손으로 옮길 때 `cs_test_sim_…`처럼 줄임표가 들어가면 시뮬레이터는 그런 세션을 모르므로 `{"error":{"message":"시뮬레이터에 없는 경로나 세션: /c/pay/cs_test_sim_%e2%80%a6_1/complete"}}`와 함께 404를 돌려준다. 시뮬레이터를 껐다 켠 뒤 예전 주소로 불러도 같은 404다.

> 브라우저에서는 장바구니의 결제하기를 누르면 `localhost:4100`의 결제 화면으로 간다. "결제 완료"와 "취소하고 돌아가기" 두 버튼이 있다.

### 작업 4. [확인] 요청 수 제한이 꺼져 있는지 본다

요청 수 제한이 켜져 있으면 응답마다 `RateLimit-Limit` 헤더가 붙는다(`21`). 이 PC의 API에는 없어야 한다.

```sh
curl -si localhost:4000/products | grep -i '^ratelimit' || echo "요청 수 제한 꺼짐"
# 출력
# 요청 수 제한 꺼짐
```

헤더가 보이면 이 셸이나 `.env.local`에 `RATE_LIMIT_PER_MINUTE`가 들어 있다. 실험하는 동안 빼고 API를 다시 띄운다. 기본값이 0(끔)이라 따로 끄는 값을 둘 필요는 없다.

### 남길 것

- **찾아보면 되는 것**: Stripe SDK 생성자의 `host`·`port`·`protocol`, `Stripe.webhooks.generateTestHeaderString`, curl의 `-w '%{http_code} %{redirect_url}'`, `jq -r`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 외부 결제를 흉내 낼 때는 진짜로 갈지 가짜로 갈지를 "그 실행에서 명시했는가"로 정한다. 설정 파일에 숨은 키 하나가 부하 실험을 진짜 Stripe로 보내지 않게 하고, 운영에서는 가짜 길을 막아 둔다.

  - 결제 완료 뒤 브라우저가 돌아오는 것과 웹훅이 오는 것은 순서가 없다. 시뮬레이터도 브라우저를 먼저 돌려보내고 1초 뒤에 웹훅을 보낸다.

  - 측정 전에 지난 단계가 더한 장치(요청 수 제한, 임시 계정)가 측정에 끼어드는지 코드로 확인한다. 이 단계에서는 제한이 꺼져 있고, 시드가 임시 계정을 지운다.

- **에러 신호**:

  - 결제하기를 누르면 연결할 수 없다는 화면 → 시뮬레이터(`node scripts/stripe-sim.mjs`)가 떠 있는지

  - 시뮬레이터를 다시 켠 뒤 예전 결제 화면 주소가 404 → 세션 기록은 시뮬레이터 메모리에만 있다. 결제를 새로 만든다

  - `/complete`가 404 `시뮬레이터에 없는 경로나 세션: /c/pay/cs_test_sim_%e2%80%a6_…` → 주소에 줄임표(`…`, `%e2%80%a6`)가 들어갔다. 응답의 `checkoutUrl`을 그대로 쓴다

  - `POST /orders/checkout`이 500, API 로그에 `결제 세션 생성 실패 → 주문 #N 취소, 재고 복구` → API는 시뮬레이터 모드인데 4100번에 시뮬레이터가 없다. 터미널 1을 다시 띄운다. 그 주문은 이미 취소됐으므로 결제를 새로 만든다

  - 결제가 `checkout.stripe.com`으로 간다 → API를 `STRIPE_SIMULATOR_URL=…` 없이 띄웠다

  - 응답에 `RateLimit-Limit` 헤더가 있거나 429 `요청이 너무 많습니다` → 셸이나 `.env.local`의 `RATE_LIMIT_PER_MINUTE`

## 2. 1단계: 주문을 30만 건으로 늘리고 지금 목록을 잰다

### 작업 1. [커밋] 대량 주문 SQL로 30만 건 넣기

`scripts/bulk-orders.sql`은 지난 2년에 걸쳐 약 3.5분마다 한 건씩, 시드 사용자 넷이 돌아가며 주문한 30만 건을 시드 위에 더한다. 주문마다 주문 상품 한 줄도 넣는다. 상품은 시드 카탈로그의 5~8번(한정판 키보드, 마우스, 무선 헤드폰, 전기 주전자)이다. 1~4번은 [`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)에서 더한 사진 상품이라 쓰지 않는다.

```sql
-- order-api-nest/scripts/bulk-orders.sql
-- 페이지네이션 실험용 주문 30만 건. 시드 위에 더한다(시드를 다시 돌리면 사라진다)
--   docker compose exec -T db psql -U order -d order_api < order-api-nest/scripts/bulk-orders.sql
-- 지난 2년에 걸쳐 약 3.5분마다 한 건, 시드 사용자 넷이 돌아가며 주문했다고 친다
WITH inserted AS (
  INSERT INTO orders (user_id, price, paid, created_at)
  SELECT (ARRAY['kim', 'lee', 'park', 'choi'])[1 + i % 4],
         (ARRAY[150000, 30000, 90000, 40000])[1 + i % 4],
         i % 10 <> 0,                                         -- 열에 하나는 결제 대기
         now() - interval '2 years' + i * interval '210 seconds'
  FROM generate_series(1, 300000) AS i
  RETURNING id, price                                         -- 방금 넣은 주문만 받는다
)
-- 주문마다 상품 한 줄. 5~8번 상품(키보드, 마우스, 무선 헤드폰, 전기 주전자)은 가격이 서로 달라 가격으로 짝짓는다
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT inserted.id, p.id, 1, inserted.price
FROM inserted JOIN products p ON p.price = inserted.price AND p.id BETWEEN 5 AND 8;

-- 행 수가 크게 바뀌었다. 옛 통계로 실행 계획을 세우지 않게 새로 모은다
ANALYZE orders;
ANALYZE order_items;
SELECT user_id, count(*) AS orders FROM orders GROUP BY user_id ORDER BY user_id;
```

`WITH … RETURNING`으로 방금 넣은 주문만 받아 주문 상품을 붙인다. `orders` 전체에서 상품 줄이 없는 주문을 고르면, 시드 주문 중 가격이 같은 주문에도 상품 줄이 붙는다. psql은 테이블 소유자(`order`)로 붙으므로 RLS를 거치지 않고 남의 주문도 넣는다.

```sh
docker compose exec -T db psql -U order -d order_api < order-api-nest/scripts/bulk-orders.sql
# 출력
INSERT 0 300000
ANALYZE
ANALYZE
 user_id | orders
---------+--------
 choi    |  75000
 kim     |  75003
 lee     |  75002
 park    |  75001
```

kim의 3건은 시드 주문 2건과 1장 작업 3에서 결제한 주문이다. 30만 건의 번호는 그 주문(73번) 다음인 74번부터 300073번이다. 시드를 다시 돌리면 시드 사용자의 주문을 지우므로 30만 건도 사라진다. 그때는 이 SQL을 다시 넣는다.

### 작업 2. [확인] 지금 목록의 크기와 실행 계획 재기

지금 목록 경로는 전체 행을 돌려준다. 전체 주문(`GET /orders`)은 관리자 경로라 kim의 토큰을 싣는다.

```sh
curl -s -o /dev/null -w 'me/orders %{http_code} %{size_download}B %{time_total}s\n' localhost:4000/me/orders -H "authorization: Bearer $T"
# me/orders 200 7337581B 0.538133s

curl -s -o /dev/null -w 'orders %{http_code} %{size_download}B %{time_total}s\n' localhost:4000/orders -H "authorization: Bearer $T"
# orders 200 16044491B 0.719070s
```

화면은 내 주문 7.3MB를 받아 7만 5천 줄을 그린다. 정렬 순서대로 읽을 인덱스도 없다. psql에서 첫 페이지와 깊은 페이지의 실행 계획을 본다.

```sh
docker compose exec -T db psql -U order -d order_api <<'EOF'
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 20;
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 200000;
EOF
# 출력(줄임)
                                          QUERY PLAN                                           
-----------------------------------------------------------------------------------------------
 Limit (actual time=36.894..38.126 rows=20 loops=1)
   ->  Gather Merge (actual time=36.893..38.123 rows=20 loops=1)
         Workers Planned: 1
         Workers Launched: 1
         ->  Sort (actual time=35.465..35.466 rows=15 loops=2)
               Sort Key: created_at DESC, id DESC
               Sort Method: top-N heapsort  Memory: 27kB
               Worker 0:  Sort Method: top-N heapsort  Memory: 27kB
               ->  Parallel Seq Scan on orders (actual time=0.008..14.934 rows=150003 loops=2)
 Planning Time: 0.335 ms
 Execution Time: 38.171 ms
(11 rows)

                                   QUERY PLAN                                   
--------------------------------------------------------------------------------
 Limit (actual time=85.329..85.331 rows=20 loops=1)
   ->  Sort (actual time=69.621..80.660 rows=200020 loops=1)
         Sort Key: created_at DESC, id DESC
         Sort Method: external merge  Disk: 10008kB
         ->  Seq Scan on orders (actual time=0.008..23.796 rows=300006 loops=1)
 Planning Time: 0.047 ms
 Execution Time: 85.916 ms
```

첫 페이지 20행을 위해서도 30만 행을 모두 읽고 정렬한다. 깊은 페이지는 정렬할 행이 메모리에 다 들어가지 않아 디스크로 넘친다(`external merge`).

### 남길 것

- **찾아보면 되는 것**: `generate_series`, `WITH … RETURNING`, `EXPLAIN (ANALYZE, COSTS OFF)`, curl의 `%{size_download}`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 20행만 돌려주는 쿼리도 정렬 순서에 맞는 인덱스가 없으면 전체를 읽고 정렬한다. 데이터가 다섯 건일 때는 보이지 않으므로 실제 규모로 늘려 잰다.

- **에러 신호**:

  - 실행 계획에 `Seq Scan`과 `Sort Method: external merge  Disk:` → 정렬 순서에 맞는 인덱스가 없다

  - `GET /orders`가 401이나 403 → 관리자 경로다. kim의 토큰을 실었는지

## 3. 2단계: 정렬 순서대로 인덱스를 만들고 실행 계획을 본다

### 작업 1. [커밋] 정렬 순서대로 복합 인덱스 만들기

정렬 순서가 인덱스에 그대로 있으면 DB는 정렬하지 않고 인덱스를 앞(또는 뒤)에서부터 읽다가 필요한 만큼에서 멈춘다.

```diff
--- a/order-api-nest/prisma/schema.prisma
+++ b/order-api-nest/prisma/schema.prisma

model Order {
@@
   canceledAt        DateTime?   @map("canceled_at")
   items             OrderItem[]
 
-  @@index([userId])
+  // 목록의 정렬 순서 그대로. 전체 주문은 (createdAt, id), 내 주문은 userId로 좁힌 뒤 같은 순서
+  @@index([createdAt, id])
+  @@index([userId, createdAt, id])
   @@map("orders")
 }
```

전체 주문은 `(createdAt, id)`, 내 주문은 `userId`로 좁힌 뒤 같은 순서로 읽으므로 `(userId, createdAt, id)`다. 뒤의 것이 `userId`로 시작하므로 `userId`만 찾는 쿼리도 이 인덱스를 쓴다. 그래서 예전부터 있던 `@@index([userId])`를 지운다(`@@index` 한 줄을 지우고 두 줄로 바꾼다).

```sh
cd order-api-nest
npx prisma migrate dev --name order_list_indexes --create-only
```

`--create-only`가 만든 폴더는 날짜시각으로 시작한다. 이 저장소는 `0001_init`부터 네 자리 번호를 쓰고 `21`의 `0019_demo_admin_role` 다음이므로, 폴더 이름을 `0020_order_list_indexes`로 바꾼다.

Prisma가 만든 SQL은 `DROP INDEX "orders_user_id_idx"`를 맨 앞에 두고, 그 뒤에 `CREATE INDEX` 두 줄을 둔다. 스키마에서 사라진 것을 먼저 지우고 새로 생긴 것을 만드는 순서일 뿐, 운영 중인 테이블을 생각한 순서가 아니다. 순서를 바꿔 새 것을 먼저 만든다.

순서가 문제가 되는 이유는 두 가지 사실에서 나온다.

- **Prisma는 마이그레이션 파일을 한 트랜잭션으로 감싸지 않는다.** 문장마다 따로 확정된다. 첫 줄에 `CREATE TABLE`, 둘째 줄에 일부러 실패하는 `SELECT 1/0`을 둔 마이그레이션을 `migrate deploy`로 넣어 보면, 마이그레이션은 `P3018`(`division by zero`)로 실패하는데 표는 만들어진 채 남는다. 그래서 `DROP INDEX`가 끝나는 순간 인덱스는 다른 연결에게도 정말로 없다.
- **`CREATE INDEX`는 다 만들 때까지 시간이 걸린다.** 표 전체를 읽어 정렬해야 하므로 행 수에 비례한다. 그동안 표에 `ShareLock`을 쥔다. 읽기(`SELECT`)는 통과시키지만, 쓰기(`INSERT`·`UPDATE`·`DELETE`)는 다 만들 때까지 기다리게 한다. `DROP INDEX`는 짧지만 가장 센 `AccessExclusiveLock`을 잡는다. 이 둘은 임시 DB에서 `BEGIN; DROP INDEX …;`와 `BEGIN; CREATE INDEX …;` 뒤에 `pg_locks`를 보면 확인된다.

이 두 사실을 순서별로 놓으면 차이가 보인다.

| 시점 | Prisma 순서(DROP → CREATE → CREATE) | 바꾼 순서(CREATE → CREATE → DROP) |
|---|---|---|
| 첫 문장 직후 | `user_id` 인덱스가 없다 | 옛 인덱스와 첫 새 인덱스가 다 있다 |
| 인덱스를 만드는 동안 | 내 주문 목록(`WHERE user_id = …`)이 30만 행 전체를 읽고 정렬한다. 쓰기는 기다린다 | 내 주문 목록은 옛 `(user_id)` 인덱스를 그대로 쓴다. 쓰기는 기다린다 |
| 둘째 `CREATE`가 실패하면 | 옛 인덱스는 이미 지워졌고 새 인덱스도 없다. 고칠 때까지 계속 전체를 읽는다 | 옛 인덱스가 그대로 있다. 실패 전과 같은 속도다 |
| 마지막 문장 | — | `DROP INDEX`가 `AccessExclusiveLock`을 잠깐 잡는다. 이미 새 인덱스가 있으므로 바로 그것으로 넘어간다 |

인덱스가 없는 시간은 짧아 보여도 그 사이의 요청이 모두 느려진다. 그동안 내 주문 요청은 2장의 실행 계획처럼 `Seq Scan`과 정렬로 바뀐다. 30만 건에서 수십 ms이고, 행이 늘수록 비례해서 늘어난다. 요청이 몰리면 DB 연결이 그 느린 쿼리들로 차서, 인덱스와 상관없는 요청까지 줄을 선다. 표가 수천만 행이면 "짧은 틈"이 몇 분이 된다. 더 나쁜 것은 실패했을 때다. 마이그레이션 도중 실패는 디스크 부족이나 문장 시간 제한 같은 이유로 실제로 일어난다. 그때 지우기를 먼저 했다면 인덱스가 하나도 없는 상태가 남는다. 사람이 `prisma migrate resolve`로 정리할 때까지 그대로다.

원칙은 하나다. **대신할 것을 먼저 만들고, 옛것은 마지막에 지운다.** 지우는 일은 되돌릴 수 없고 빠르며, 만드는 일은 실패할 수 있고 느리다. 그래서 실패할 수 있는 일을 앞에 둬야 실패해도 원래 상태가 남는다. 칸 이름 바꾸기나 테이블 나누기 같은 다른 스키마 변경에도 같은 순서가 적용된다.

이 순서로도 남는 비용이 하나 있다. 인덱스를 만드는 동안 쓰기가 기다리는 것이다. 결제가 그 시간만큼 멈춘다. 이것까지 없애는 것이 `CREATE INDEX CONCURRENTLY`다. 쓰기를 막지 않는 대신 표를 두 번 읽어 더 오래 걸리고, 트랜잭션 안에서는 쓸 수 없다. 이 문서는 로컬 DB라 다루지 않는다(13장 "다루지 않은 것").

파일 전체를 아래로 바꾼다.

```sql
-- order-api-nest/prisma/migrations/0020_order_list_indexes/migration.sql
-- 새 인덱스를 먼저 만들고 옛 인덱스를 지운다. 그사이에도 user_id로 찾는 쿼리가 쓸 인덱스가 있게
CREATE INDEX "orders_created_at_id_idx" ON "orders"("created_at", "id");
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at", "id");

-- (user_id, created_at, id)가 user_id로 시작하므로 user_id만 찾는 쿼리도 위 인덱스를 쓴다
DROP INDEX "orders_user_id_idx";
```

```sh
npx prisma migrate deploy && npx prisma generate
```

### 작업 2. [확인] offset과 cursor의 실행 계획

20만 번째 행 자리에서 offset과 cursor를 비교한다. cursor 값은 offset으로 한 번 찾아 psql 변수에 담는다(`\gset`).

```sh
cd ..
docker compose exec -T db psql -U order -d order_api <<'EOF'
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 200000;
SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 199999 \gset
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders WHERE (created_at, id) < (:'created_at', :id) ORDER BY created_at DESC, id DESC LIMIT 20;
EOF
# 출력
                                                     QUERY PLAN                                                     
--------------------------------------------------------------------------------------------------------------------
 Limit (actual time=41.833..41.836 rows=20 loops=1)
   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual time=0.048..35.227 rows=200020 loops=1)
 Planning Time: 0.466 ms
 Execution Time: 41.859 ms
(4 rows)

                                                   QUERY PLAN                                                    
-----------------------------------------------------------------------------------------------------------------
 Limit (actual time=0.017..0.021 rows=20 loops=1)
   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual time=0.017..0.019 rows=20 loops=1)
         Index Cond: (ROW(created_at, id) < ROW('2024-09-27 07:48:11.517'::timestamp without time zone, 100080))
 Planning Time: 0.060 ms
 Execution Time: 0.035 ms
```

둘 다 같은 인덱스를 뒤에서부터 읽는다(`Index Scan Backward`). offset은 `rows=200020`, 버릴 20만 행까지 읽었다. cursor는 `Index Cond`로 그 자리에 바로 내려가 20행만 읽었다. **offset의 비용은 페이지 깊이에 비례하고, cursor의 비용은 깊이와 상관이 없다.**

### 실험 | 일부러 깨뜨려보기, OR로 쓴 cursor 조건

`(created_at, id) < (c, i)`는 PostgreSQL의 행 비교다. Prisma의 `where`에는 행 비교가 없어서 풀어 쓰면 "`created_at < c` 이거나, `created_at = c`이면서 `id < i`"가 된다. 그대로 실행해 본다.

```sh
docker compose exec -T db psql -U order -d order_api <<'EOF'
SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 199999 \gset
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders WHERE created_at < :'created_at' OR (created_at = :'created_at' AND id < :id) ORDER BY created_at DESC, id DESC LIMIT 20;
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, price, paid, created_at FROM orders WHERE created_at <= :'created_at' AND (created_at < :'created_at' OR id < :id) ORDER BY created_at DESC, id DESC LIMIT 20;
EOF
# 출력
                                                                                       QUERY PLAN                                                                                     
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit (actual time=26.207..26.214 rows=20 loops=1)
   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual time=26.206..26.209 rows=20 loops=1)
         Filter: ((created_at < '2024-09-27 07:48:11.517'::timestamp without time zone) OR ((created_at = '2024-09-27 07:48:11.517'::timestamp without time zone) AND (id < 100080)))
         Rows Removed by Filter: 200000
 Planning Time: … ms
 Execution Time: 26.237 ms
(6 rows)

                                                   QUERY PLAN                                                  
---------------------------------------------------------------------------------------------------------------
 Limit (actual time=0.010..0.016 rows=20 loops=1)
   ->  Index Scan Backward using orders_created_at_id_idx on orders (actual time=0.010..0.013 rows=20 loops=1)
         Index Cond: (created_at <= '2024-09-27 07:48:11.517'::timestamp without time zone)
         Filter: ((created_at < '2024-09-27 07:48:11.517'::timestamp without time zone) OR (id < 100080))
         Rows Removed by Filter: 1
 Planning Time: … ms
 Execution Time: 0.029 ms
(7 rows)
```

OR만 쓰면 조건이 `Index Cond`가 아니라 `Filter`에 들어간다. 인덱스를 처음부터 읽으며 20만 행을 걸러 버렸다(`Rows Removed by Filter: 200000`). 결과는 맞지만 비용은 offset과 같다. `created_at <= c`를 따로 더하면 그 부분이 `Index Cond`가 되어 인덱스가 그 자리부터 읽는다. 걸러 낸 1행은 cursor 행 자신이다.

> 결과가 맞으니 테스트로는 잡히지 않는다. cursor 조건을 바꾸면 깊은 자리에서 `EXPLAIN`을 다시 본다. 4장의 `afterOrder`가 두 번째 모양을 Prisma `where`로 쓴다.

### 용어 | SQL (실행 계획 읽기)

- `EXPLAIN (ANALYZE, COSTS OFF)`: 실제로 실행하고 단계별 시간과 행 수를 보여 준다. 예상 비용은 숨긴다
- `Index Scan Backward`: 인덱스를 뒤에서부터 읽는다. 오름차순 인덱스로 `DESC` 정렬을 정렬 없이 얻는다
- `Index Cond` / `Filter`: 인덱스에서 범위로 찾은 조건 / 읽은 뒤에 버리는 조건
- `(a, b) < (x, y)`: 행 비교. `a < x OR (a = x AND b < y)`와 같은 뜻이고, 복합 인덱스의 범위로 쓰인다
- `\gset`: psql 명령. 바로 앞 쿼리 결과의 칸을 같은 이름의 psql 변수에 담는다. `:'이름'`은 따옴표로 감싼 값, `:이름`은 그대로 넣는다

### 남길 것

- **찾아보면 되는 것**: `@@index`, `migrate dev --create-only`, psql의 `\gset`, 행 비교 `(a, b) < (x, y)`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - offset의 비용은 페이지 깊이에 비례하고, cursor의 비용은 깊이와 상관이 없다. cursor 조건이 `Index Cond`에 들어가야 그 자리부터 읽는다.

  - 결과가 맞아도 조건이 `Filter`에 있으면 인덱스를 처음부터 읽는다. 테스트로는 잡히지 않으므로 cursor 조건을 바꾸면 깊은 자리에서 `EXPLAIN`을 다시 본다.

  - Prisma가 만든 마이그레이션은 옛 인덱스를 먼저 지운다. 새 인덱스를 먼저 만들게 순서를 바꾼다.

- **에러 신호**:

  - cursor 쿼리의 실행 계획에 `Rows Removed by Filter: 200000` → OR 조건 앞에 `created_at <= c`가 따로 있는지

## 4. 3단계: 목록 API를 cursor 페이지로 바꾼다

### 작업 1. [커밋] 페이지 조각을 한곳에 모은다

세 목록의 응답을 `{ items, nextCursor }`로 바꾼다. `nextCursor`가 `null`이면 마지막 페이지다. 공통 부분은 `src/pagination/`에 둔다. tRPC 라우터도 쓰므로 데코레이터가 없는 파일이다([`12`](https://github.com/seungwoo7050/node-order/tree/12-trpc) 3단계).

```ts
// order-api-nest/src/pagination/cursor.ts
import { BadRequestException } from "@nestjs/common";

// REST 컨트롤러와 tRPC 라우터가 함께 쓴다. 그래서 데코레이터가 없는 파일로 둔다
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// nextCursor가 null이면 마지막 페이지다
export type Page<T, C = string> = { items: T[]; nextCursor: C | null };

// createdAt만으로는 같은 시각의 주문끼리 순서가 정해지지 않는다 → 유일한 id를 붙인다
type OrderKey = { createdAt: Date; id: number };

// 클라이언트는 받은 cursor를 그대로 돌려줄 뿐 안을 들여다보지 않는다 → base64url로 감싼다
export const encodeOrderCursor = (row: OrderKey) => Buffer.from(`${row.createdAt.toISOString()}_${row.id}`).toString("base64url");

export function decodeOrderCursor(cursor: string): OrderKey {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("_");
  const key = { createdAt: new Date(iso ?? ""), id: Number(id) };
  if (Number.isNaN(key.createdAt.getTime()) || !Number.isInteger(key.id)) throw new BadRequestException("cursor가 올바르지 않다");
  return key;
}

// (createdAt, id) < (c.createdAt, c.id)를 Prisma where로 푼 것
// OR만 쓰면 인덱스 범위가 되지 않는다 → createdAt <= c를 따로 걸어 인덱스가 그 자리부터 읽게 한다(3장 실험)
export function afterOrder(cursor: string | null | undefined) {
  if (!cursor) return {};
  const c = decodeOrderCursor(cursor);
  return { createdAt: { lte: c.createdAt }, OR: [{ createdAt: { lt: c.createdAt } }, { id: { lt: c.id } }] };
}
export const orderListOrder = [{ createdAt: "desc" }, { id: "desc" }] as const;

// limit보다 한 행 더 읽어 온 결과를 자른다. 한 행이 더 있었으면 다음 페이지가 있다(count(*)를 하지 않는다)
export function toPage<T, C>(rows: T[], limit: number, cursorOf: (last: T) => C): Page<T, C> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? cursorOf(items[items.length - 1]!) : null };
}
```

`toPage`는 다음 페이지가 있는지 알려고 `count(*)`를 하지 않는다. 21행을 읽어 21번째가 있으면 다음이 있다. 30만 행의 `count(*)`는 그 자체가 전체를 읽는 쿼리다.

쿼리 문자열은 문자열로 온다. `?limit=20`의 `20`도 문자열이다. 검사와 변환은 DTO로 한다.

```ts
// order-api-nest/src/pagination/page-query.dto.ts
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./cursor.js";

// 쿼리 문자열은 모두 문자열로 온다 → @Type(() => Number)로 바꾼 뒤 검사한다
export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
  @IsOptional() @IsString() cursor?: string;
}

// 상품은 id 하나로 정렬한다 → cursor가 마지막 상품의 id(숫자)다
export class ProductPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) cursor?: number;
}

// 관리자 표는 "37쪽으로 건너뛰기"가 필요해 offset도 받는다. cursor와 함께 오면 cursor를 쓴다
export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  // "true"·"false"만 불리언으로 바꾼다. 다른 값은 그대로 두어 @IsBoolean이 400으로 막는다
  @IsOptional() @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value)) @IsBoolean() paid?: boolean;
}
```

```ts
// order-api-nest/src/pagination/page-query.pipe.ts
import { ValidationPipe } from "@nestjs/common";

// 목록 쿼리 전용. 전역 파이프(main.ts)는 검사만 하고 원래 값(문자열 "20", 기본값 없음)을 넘긴다
export const PAGE_QUERY = new ValidationPipe({ whitelist: true, transform: true });
```

`main.ts`의 전역 `ValidationPipe`는 `transform`이 꺼져 있다. 검사는 하지만 컨트롤러에는 원래 값(문자열 `"20"`, 기본값 없음)을 넘긴다. 전역 설정을 켜면 모든 본문 DTO의 동작이 바뀌므로, 목록 쿼리에만 `transform: true`인 파이프를 붙인다.

내 주문과 상품은 REST와 tRPC가 같은 함수를 부르게 한 파일씩 둔다. 내 주문은 사용자 트랜잭션([`10`](https://github.com/seungwoo7050/node-order/tree/10-rls)의 `asUser`) 안에서 부른다.

```ts
// order-api-nest/src/me/my-orders.ts
import type { Prisma } from "../generated/prisma/client.js";
import { afterOrder, encodeOrderCursor, orderListOrder, toPage } from "../pagination/cursor.js";
import { orderSelect } from "./order-select.js";

// 내 주문 한 페이지. REST와 tRPC가 같은 함수를 부른다. RLS 때문에 asUser 트랜잭션 안에서 부른다
export async function listMyOrders(tx: Prisma.TransactionClient, userId: string, page: { limit: number; cursor?: string | null }) {
  const rows = await tx.order.findMany({
    where: { userId, ...afterOrder(page.cursor) },
    select: orderSelect,
    orderBy: [...orderListOrder],
    take: page.limit + 1, // 한 행 더 읽어 다음 페이지가 있는지 본다
  });
  return toPage(rows, page.limit, encodeOrderCursor);
}
```

상품은 `id` 하나로 정렬하고 새 상품은 언제나 `id`가 큰 쪽에 붙는다. 그래서 cursor가 마지막 상품의 `id` 그대로다.

```ts
// order-api-nest/src/products/product-list.ts
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { toPage } from "../pagination/cursor.js";

// 상품 한 페이지(id 순). REST와 tRPC가 같은 함수를 부른다
// 새 상품은 언제나 id가 큰 쪽에 붙는다 → cursor가 마지막 상품의 id 그대로다
export async function listProducts(prisma: PrismaService, storage: StorageService, page: { limit: number; cursor?: number | null }) {
  const rows = await prisma.product.findMany({
    where: page.cursor ? { id: { gt: page.cursor } } : {},
    orderBy: { id: "asc" },
    take: page.limit + 1,
  });
  const { items, nextCursor } = toPage(rows, page.limit, (last) => last.id);
  const withUrls = await Promise.all(
    items.map(async ({ imageKey, ...p }) => ({
      ...p,
      imageUrl: imageKey ? await storage.createDownloadUrl(imageKey, 600) : null,
    })),
  );
  return { items: withUrls, nextCursor };
}
```

### 작업 2. [커밋] 세 목록과 tRPC를 페이지로 바꾼다

내 주문은 `@Query(PAGE_QUERY)`로 쿼리 문자열 전체를 DTO로 받는다.

```diff
--- a/order-api-nest/src/me/me.controller.ts
+++ b/order-api-nest/src/me/me.controller.ts
@@
-import { Controller, Get, NotFoundException, Param, ParseIntPipe, Req, UseGuards } from "@nestjs/common";
+import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
 import type { Request } from "express";
 import { PrismaService } from "../prisma/prisma.service.js";
-import { orderDetailSelect, orderSelect } from "./order-select.js";
+import { PageQueryDto } from "../pagination/page-query.dto.js";
+import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
+import { listMyOrders } from "./my-orders.js";
+import { orderDetailSelect } from "./order-select.js";
 
 @Controller("me")
 @UseGuards(AuthGuard("jwt"))
@@
   constructor(private readonly prisma: PrismaService) {}
 
   @Get("orders")
-  myOrders(@Req() req: Request) {
+  myOrders(@Req() req: Request, @Query(PAGE_QUERY) query: PageQueryDto) {
     const userId = (req.user as { userId: string }).userId;
-    return this.prisma.asUser(userId, (tx) => tx.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "desc" } }));
+    return this.prisma.asUser(userId, (tx) => listMyOrders(tx, userId, query));
   }
 
   @Get("orders/:id")
```

전체 주문은 [`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)의 역할 구분을 그대로 둔다. `AdminGuard`가 진짜 관리자만 들이고, 데모 관리자는 403이다. 다른 방문자의 주문까지 다 보이는 목록이기 때문이다. 관리자 표에는 "37쪽으로 건너뛰기"가 필요하므로 offset도 받는다. 어느 쪽으로 읽었든 마지막 행의 cursor를 돌려주므로, offset으로 건너뛴 뒤에는 cursor로 이어 읽을 수 있다.

```diff
--- a/order-api-nest/src/orders/orders.controller.ts
+++ b/order-api-nest/src/orders/orders.controller.ts
@@
 import { OrdersService } from "./orders.service.js";
 import { CheckoutDto } from "./dto/checkout.dto.js";
 import { AdminGuard } from "../auth/admin.guard.js";
+import { AdminOrderQueryDto } from "../pagination/page-query.dto.js";
+import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 
 @Controller("orders")
 export class OrdersController {
@@
 
   @Get()
   @UseGuards(AuthGuard("jwt"), AdminGuard)
-  list(@Query("paid") paid?: string) {
-    return this.ordersService.list(paid === undefined ? undefined : paid === "true");
+  list(@Query(PAGE_QUERY) query: AdminOrderQueryDto) {
+    return this.ordersService.list(query);
   }
 
   @Get("totals")
```

```diff
--- a/order-api-nest/src/orders/orders.service.ts
+++ b/order-api-nest/src/orders/orders.service.ts
@@
 import type { CheckoutItemDto } from "./dto/checkout.dto.js";
 import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";
 import { StripeGateway } from "../payments/stripe.gateway.js";
+import { afterOrder, encodeOrderCursor, orderListOrder, toPage, type Page } from "../pagination/cursor.js";
 
 export type Order = { id: number; user: string; price: number; paid: boolean; }
 export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };
 export type CheckoutResponse = CheckoutResult & { checkoutUrl: string };
 
 const orderSelect = { id: true, userId: true, price: true, paid: true } as const;
+const listSelect = { ...orderSelect, createdAt: true } as const; // 다음 cursor를 만들려면 정렬 키도 읽어야 한다
 const toOrder = (row: { id: number; userId: string; price: number; paid: boolean }): Order =>(
   { id: row.id,user: row.userId, price: row.price, paid: row.paid }
 );
@@
     private readonly stripe: StripeGateway,
   ) {}
 
-  async list(paid?: boolean): Promise<Order[]> {
-    const rows = await this.prisma.asAdmin((tx) => tx.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } }));
-    return rows.map(toOrder);
+  // offset으로 건너뛰었든 cursor로 이었든 마지막 행의 cursor를 돌려준다 → 깊이 건너뛴 뒤에는 cursor로 이어 읽는다
+  async list(query: { limit: number; cursor?: string; offset?: number; paid?: boolean }): Promise<Page<Order & { createdAt: Date }>> {
+    const rows = await this.prisma.asAdmin((tx) => tx.order.findMany({
+      where: { paid: query.paid, ...afterOrder(query.cursor) },
+      select: listSelect,
+      orderBy: [...orderListOrder],
+      skip: query.cursor ? undefined : query.offset,
+      take: query.limit + 1,
+    }));
+    const page = toPage(rows, query.limit, encodeOrderCursor);
+    return { items: page.items.map((r) => ({ ...toOrder(r), createdAt: r.createdAt })), nextCursor: page.nextCursor };
   }
 
   async findOne(id: number): Promise<Order> {
```

상품 목록은 지금처럼 누구나 본다. 이미지 주소를 만드는 코드는 `product-list.ts`로 옮겼다.

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
-import { Controller, Get } from "@nestjs/common";
+import { Controller, Get, Query } from "@nestjs/common";
+import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
+import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
+import { listProducts } from "./product-list.js";
 
 @Controller("products")
 export class ProductsController {
@@
   ) {}
 
   @Get()
-  async list() {
-    const products = await this.prisma.product.findMany({ orderBy: { id: "asc" } });
-    return Promise.all(
-      products.map(async ({ imageKey, ...p }) => ({
-        ...p,
-        imageUrl: imageKey ? await this.storage.createDownloadUrl(imageKey, 600) : null,
-      })),
-    );
+  list(@Query(PAGE_QUERY) query: ProductPageQueryDto) {
+    return listProducts(this.prisma, this.storage, query);
   }
 }
```

tRPC는 입력을 zod로 받는다. 입력 이름을 `cursor`로 두는 것이 중요하다. 6장의 `useInfiniteQuery`가 다음 페이지를 부를 때 이 자리에 값을 채운다. `.default({ limit: DEFAULT_LIMIT })`가 있어 입력 없이 불러도 된다.

```diff
--- a/order-api-nest/src/trpc/router.ts
+++ b/order-api-nest/src/trpc/router.ts
@@
 import { TRPCError } from "@trpc/server";
 import { z } from "zod";
-import { orderDetailSelect, orderSelect } from "../me/order-select.js";
+import { listMyOrders } from "../me/my-orders.js";
+import { orderDetailSelect } from "../me/order-select.js";
+import { DEFAULT_LIMIT, MAX_LIMIT } from "../pagination/cursor.js";
+import { listProducts } from "../products/product-list.js";
 import { protectedProcedure, publicProcedure, router } from "./trpc.js";
 
 export const appRouter = router({
   products: router({
-    list: publicProcedure.query(async ({ ctx }) => {
-      const products = await ctx.prisma.product.findMany({ orderBy: { id: "asc" } });
-      return Promise.all(
-        products.map(async ({ imageKey, ...p }) => ({
-          ...p,
-          imageUrl: imageKey ? await ctx.storage.createDownloadUrl(imageKey, 600) : null,
-        })),
-      );
-    }),
+    // 입력 이름이 cursor여야 한다. useInfiniteQuery가 다음 페이지를 부를 때 이 자리에 값을 채운다
+    list: publicProcedure
+      .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.number().int().positive().nullish() }).default({ limit: DEFAULT_LIMIT }))
+      .query(({ ctx, input }) => listProducts(ctx.prisma, ctx.storage, input)),
   }),
 
   categories: router({
@@
     profile: protectedProcedure.query(({ ctx }) =>
       ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true, role: true } }),
     ),
-    orders: protectedProcedure.query(({ ctx }) =>
-      ctx.prisma.asUser(ctx.userId, (tx) =>
-        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "desc" } }),
-      ),
-    ),
+    orders: protectedProcedure
+      .input(z.object({ limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT), cursor: z.string().nullish() }).default({ limit: DEFAULT_LIMIT }))
+      .query(({ ctx, input }) => ctx.prisma.asUser(ctx.userId, (tx) => listMyOrders(tx, ctx.userId, input))),
     order: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
       const order = await ctx.prisma.asUser(ctx.userId, (tx) =>
         tx.order.findFirst({ where: { id: input.id, userId: ctx.userId }, select: orderDetailSelect }),
```

### 작업 3. [커밋] 경계를 테스트로 지킨다

`test/pagination.e2e-spec.ts`는 kim의 주문 5건 중 3건을 같은 시각으로 넣고 2건씩 끝까지 넘겨, 모든 주문이 정확히 한 번씩 나오는지 본다. 같은 시각 사이에 페이지 경계가 떨어져도 `id`가 순서를 정하므로 빠지거나 겹치지 않는다. 전체 주문은 관리자 경로라 `role: "admin"`을 담은 토큰을 만든다.

```ts
// order-api-nest/test/pagination.e2e-spec.ts
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { adminDb } from "./admin-db.js";

describe("페이지네이션 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let kimToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
    kimToken = app.get(JwtService, { strict: false }).sign({ sub: "kim", role: "admin" }); // 전체 주문은 관리자 경로다
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
    // kim의 2·3·4번은 같은 시각이다. 페이지 경계가 그 사이에 떨어져도 빠지거나 겹치면 안 된다
    const same = new Date("2026-01-31T00:00:00Z");
    await adminDb.order.createMany({
      data: [
        { userId: "kim", price: 1, paid: true, createdAt: new Date("2026-01-30T00:00:00Z") },
        { userId: "kim", price: 2, paid: true, createdAt: same },
        { userId: "kim", price: 3, paid: true, createdAt: same },
        { userId: "kim", price: 4, paid: false, createdAt: same },
        { userId: "kim", price: 5, paid: true, createdAt: new Date("2026-02-01T00:00:00Z") },
        { userId: "lee", price: 6, paid: true, createdAt: new Date("2026-02-02T00:00:00Z") },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = async (path: string, query: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const res = await fetch(`${baseUrl}${path}?${qs}`, { headers: { Authorization: `Bearer ${kimToken}` } });
    return { status: res.status, body: await res.json() };
  };
  const ids = (body: { items: { id: number }[] }) => body.items.map((o) => o.id);

  // nextCursor가 null이 될 때까지 따라가며 id를 모은다
  async function walk(path: string) {
    const all: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { body } = await get(path, { limit: 2, ...(cursor && { cursor }) });
      all.push(...ids(body));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    return { ids: all, pages };
  }

  it("내 주문: 최신순으로 2건씩, 같은 시각끼리는 id가 큰 것부터. 남의 주문은 없다", async () => {
    expect(await walk("/me/orders")).toEqual({ ids: [5, 4, 3, 2, 1], pages: 3 });
  });

  it("전체 주문(관리자): cursor로 끝까지 넘기면 모든 주문을 한 번씩 본다", async () => {
    expect(await walk("/orders")).toEqual({ ids: [6, 5, 4, 3, 2, 1], pages: 3 });
  });

  it("전체 주문: offset으로 건너뛴 뒤 받은 cursor로 이어 읽는다", async () => {
    const jump = await get("/orders", { limit: 2, offset: 2 });
    expect(ids(jump.body)).toEqual([4, 3]);
    const next = await get("/orders", { limit: 2, cursor: jump.body.nextCursor });
    expect(ids(next.body)).toEqual([2, 1]);
    expect(next.body.nextCursor).toBeNull();
  });

  it("전체 주문: paid=false로 걸러도 페이지 모양은 같다", async () => {
    const { body } = await get("/orders", { paid: "false" });
    expect(body).toMatchObject({ items: [{ id: 4, paid: false }], nextCursor: null });
  });

  it("잘못된 cursor, 너무 큰 limit, 불리언이 아닌 paid는 400", async () => {
    expect((await get("/orders", { cursor: "not-a-cursor" })).status).toBe(400);
    expect((await get("/orders", { limit: 101 })).status).toBe(400);
    expect((await get("/orders", { paid: "yes" })).status).toBe(400);
  });

  it("상품: id 순으로, cursor는 마지막 상품의 id", async () => {
    await adminDb.product.createMany({ data: [1, 2, 3].map((i) => ({ name: `상품 ${i}`, price: 1000, stock: 1 })) });
    const first = await get("/products", { limit: 2 });
    expect(first.body).toMatchObject({ items: [{ id: 1 }, { id: 2 }], nextCursor: 2 });
    const last = await get("/products", { limit: 2, cursor: 2 });
    expect(last.body).toMatchObject({ items: [{ id: 3 }], nextCursor: null });
  });

  it("tRPC의 me.orders도 REST와 같은 페이지를 준다", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 2 }));
    const res = await fetch(`${baseUrl}/trpc/me.orders?input=${input}`, { headers: { Authorization: `Bearer ${kimToken}` } });
    const rest = await get("/me/orders", { limit: 2 });
    expect((await res.json()).result.data).toEqual(rest.body);
  });
});
```

tRPC 테스트는 `me.orders`가 배열을 준다고 기대했다. 이제 `{ items, nextCursor }`이므로 `.items`를 붙인다.

```diff
--- a/order-api-nest/test/trpc.e2e-spec.ts
+++ b/order-api-nest/test/trpc.e2e-spec.ts
@@
 
   it("kim은 자기 주문만 받고, lee의 주문은 NOT_FOUND", async () => {
     const kim = callerAs("kim");
-    expect((await kim.me.orders()).map((o) => o.price)).toEqual([1000]);
+    expect((await kim.me.orders()).items.map((o) => o.price)).toEqual([1000]);
     expect(await codeOf(kim.me.order({ id: 2 }))).toBe("NOT_FOUND");
   });
 
@@
     const token = app.get(JwtService, { strict: false }).sign({ sub: "kim" });
     const ok = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: `Bearer ${token}` } });
     expect(ok.status).toBe(200);
-    expect((await ok.json()).result.data).toHaveLength(1);
+    expect((await ok.json()).result.data.items).toHaveLength(1);
 
     const bad = await fetch(`${baseUrl}/trpc/me.orders`, { headers: { Authorization: "Bearer not-a-token" } });
     expect(bad.status).toBe(401);
@@
       data: { userId: "kim", price: 210000, paid: false, items: { create: [{ productId: 2, quantity: 2, unitPrice: 30000 }, { productId: 1, quantity: 1, unitPrice: 150000 }] } },
     }); // id 3
     const kim = callerAs("kim");
-    expect((await kim.me.orders()).map((o) => o.id)).toEqual([3, 1]);
+    expect((await kim.me.orders()).items.map((o) => o.id)).toEqual([3, 1]);
     const detail = await kim.me.order({ id: 3 });
     expect(detail.items).toEqual([
       { quantity: 1, unitPrice: 150000, product: { id: 1, name: "키보드" } },
```

테스트 DB에도 3장의 마이그레이션을 넣고 돌린다.

```sh
# order-api-nest에서
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npx vitest run --config ./vitest.config.e2e.ts test/pagination.e2e-spec.ts test/trpc.e2e-spec.ts test/admin-only.e2e-spec.ts
# 출력
 Test Files  3 passed (3)
      Tests  24 passed (24)
```

### 작업 4. [확인] curl로 확인하고, 웹이 깨진 자리를 본다

API를 다시 빌드해 띄운다(터미널 2, 1장 작업 3의 명령). 그다음 터미널 3에서 확인한다.

```sh
curl -s "localhost:4000/me/orders?limit=2" -H "authorization: Bearer $T"
# 출력
# {"items":[{"id":73,"price":30000,"paid":true,"canceledAt":null,"createdAt":"2026-01-28T05:12:46.991Z"},{"id":70,"price":45000,"paid":true,"canceledAt":null,"createdAt":"2026-01-28T05:09:31.482Z"}],"nextCursor":"MjAyNi0wMS0yOFQwNTowOTozMS40ODJaXzcw"}

curl -s "localhost:4000/orders?cursor=abc" -H "authorization: Bearer $T"
# 출력
# {"message":"cursor가 올바르지 않다","error":"Bad Request","statusCode":400}

curl -s "localhost:4000/orders?limit=500" -H "authorization: Bearer $T"
# 출력
# {"message":["limit must not be greater than 100"],"error":"Bad Request","statusCode":400}
```

`nextCursor`를 base64url로 풀면 `2026-01-28T05:09:31.482Z_70`, 두 번째 주문(시드가 만든 kim의 두 번째 주문 70)의 정렬 키다. 맨 위의 주문 73은 1장 작업 3에서 결제한 주문이다.

응답 모양이 바뀌었으니 웹은 이제 컴파일되지 않는다. tRPC는 API의 반환 타입을 웹과 나누므로, 타입 검사가 고칠 자리를 빠짐없이 알려 준다.

```sh
# 저장소 루트에서
cd order-console-next && npx tsc --noEmit
# 출력
...
Found 9 errors in 4 files.

Errors  Files
     2  app/admin/products/page.tsx:26
     2  app/cart/page.tsx:22
     3  app/me/orders/my-order-list.tsx:16
     2  app/shop/page.tsx:63
```

네 파일이 6장에서 고칠 목록이다. 5장은 API와 DB만 쓰므로 그사이 웹을 띄우지 않는다. 이 상태로 푸시하면 CI의 타입 검사가 실패하므로, 푸시는 6장 작업 4 뒤에 한다.

### 용어 | Prisma 쿼리 문법

- `take`: 가져올 행 수(`LIMIT`)
- `skip`: 건너뛸 행 수(`OFFSET`). 0장 개념 2의 비용을 그대로 가진다
- `orderBy: [{ a: "desc" }, { b: "desc" }]`: 여러 칸으로 정렬. 배열 순서가 정렬 우선순위다
- `where: { a: { lte: x }, OR: [...] }`: 객체의 칸끼리는 AND, `OR` 배열 안은 OR

### 용어 | Nest·class-transformer API

- `@Query(pipe) dto`: 쿼리 문자열 전체를 DTO로 받는다. 그 인자에만 파이프를 건다
- `ValidationPipe({ transform: true })`: 검사한 뒤 DTO 인스턴스(변환된 값, 기본값)를 컨트롤러에 넘긴다
- `@Type(() => Number)`: 문자열을 숫자로 바꾼 뒤 검사한다
- `@Transform(fn)`: 값 바꾸는 규칙을 직접 적는다. `"true"`를 `true`로 바꾸는 데 썼다

### 개념 | Prisma에도 cursor 옵션이 있다

Prisma의 `findMany({ cursor: { id }, skip: 1 })`도 cursor 방식이다. 이 옵션은 유일한 칸(여기서는 `id`) 하나를 받고, Prisma가 그 행의 정렬 키를 다시 읽어 조건을 만든다. 정렬 키를 클라이언트에 드러내지 않아도 되는 대신 쿼리가 한 번 더 돈다.

이 문서는 정렬 키를 cursor에 직접 담았다. 3장처럼 생성되는 조건과 실행 계획을 직접 보고 맞추기 위해서다.

> 어느 쪽이든 정렬 키에 맞는 복합 인덱스가 있어야 빠르다.

### 남길 것

- **찾아보면 되는 것**: Prisma의 `take`·`skip`·`orderBy`·`OR`, class-transformer의 `@Type`·`@Transform`, zod의 `.nullish()`·`.default()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 다음 페이지가 있는지는 `count(*)`가 아니라 limit보다 한 행 더 읽어서 안다. 30만 행의 `count(*)`는 그 자체가 전체를 읽는 쿼리다.

  - 정렬 키는 행마다 유일해야 한다. 같은 시각의 주문이 있으므로 `(createdAt, id)` 두 칸이다.

  - 쿼리 문자열은 문자열로 온다. 전역 설정을 바꾸지 않고 목록 쿼리에만 `transform: true` 파이프를 건다.

  - API 응답 모양을 바꾸면 tRPC로 묶인 웹은 타입 검사에서 바로 깨진다. 그 에러 목록이 곧 고칠 화면의 목록이다.

- **에러 신호**:

  - `{"message":"cursor가 올바르지 않다","error":"Bad Request","statusCode":400}` → 받은 `nextCursor`를 그대로 보냈는지

  - `limit must not be greater than 100` → `limit`이 `MAX_LIMIT`를 넘었다

  - 컨트롤러에 `limit`이 문자열 `"20"`으로 오거나 기본값이 없다 → 그 `@Query`에 `PAGE_QUERY`를 걸었는지

  - 웹 타입 검사의 `Property 'map' does not exist on type '{ items: …; nextCursor: … }'` → 페이지 응답을 배열처럼 쓰고 있다. 6장에서 `data.pages.flatMap(…)`으로 바꾼다

## 5. 4단계: 일부러 깨뜨려보기 ①, 넘기는 사이에 목록이 바뀐다

### 작업 1. [커밋] 넘기는 사이에 목록을 바꿔 보는 page-drift.mjs

offset은 "앞에서 몇 번째"를 센다. 페이지를 넘기는 사이에 앞쪽 행이 늘거나 줄면 같은 숫자가 다른 행을 가리킨다. `scripts/page-drift.mjs`는 전체 주문 API를 5건씩 읽으면서 사이에 DB를 직접 바꾸고, 끝나면 되돌린다. 관리자 경로이므로 kim으로 로그인한다.

```js
// order-api-nest/scripts/page-drift.mjs
// 페이지를 넘기는 사이에 목록이 바뀌면 offset은 겹치거나 건너뛴다. cursor는 그렇지 않다
// 전체 주문(관리자) API를 5건씩 읽고, 사이에 끼어드는 변경은 DB에 직접 한 뒤 되돌린다
//   node scripts/page-drift.mjs
import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";

// GET /orders는 관리자 전용이다. 시드의 kim이 관리자다(데모 관리자는 403)
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();
const get = async (query) =>
  (await fetch(`${API}/orders?${new URLSearchParams({ limit: "5", ...query })}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
const ids = (page) => page.items.map((o) => o.id).join(", ");

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();

// ① 최신순이라 새 주문은 맨 앞에 붙는다
console.log("① 1쪽을 읽은 뒤 새 주문 2건이 들어온다");
const p1 = await get({});
console.log(`   1쪽              : ${ids(p1)}`);
const { rows: added } = await db.query(`INSERT INTO orders (user_id, price, paid) VALUES ('lee', 1000, true), ('lee', 1000, true) RETURNING id`);
console.log(`   offset=5로 2쪽   : ${ids(await get({ offset: "5" }))}`);
console.log(`   cursor로 2쪽     : ${ids(await get({ cursor: p1.nextCursor }))}`);
await db.query(`DELETE FROM orders WHERE id = ANY($1)`, [added.map((r) => r.id)]);

// ② 결제 대기만 걸러 보는 중에 1쪽의 두 건이 결제되어 목록에서 빠진다
console.log("② 결제 대기 1쪽을 읽은 뒤 그중 2건이 결제된다");
const u1 = await get({ paid: "false" });
console.log(`   1쪽              : ${ids(u1)}`);
const paidIds = u1.items.slice(0, 2).map((o) => o.id);
await db.query(`UPDATE orders SET paid = true WHERE id = ANY($1)`, [paidIds]);
const byOffset = await get({ paid: "false", offset: "5" });
const byCursor = await get({ paid: "false", cursor: u1.nextCursor });
console.log(`   offset=5로 2쪽   : ${ids(byOffset)}`);
console.log(`   cursor로 2쪽     : ${ids(byCursor)}`);
const skipped = byCursor.items.filter((o) => !byOffset.items.some((x) => x.id === o.id)).map((o) => o.id);
console.log(`   offset이 건너뛴 주문: ${skipped.join(", ") || "없음"}`);
await db.query(`UPDATE orders SET paid = false WHERE id = ANY($1)`, [paidIds]);

await db.end();
```

```sh
# order-api-nest에서
node scripts/page-drift.mjs
# 출력
① 1쪽을 읽은 뒤 새 주문 2건이 들어온다
   1쪽              : 73, 72, 71, 70, 69
   offset=5로 2쪽   : 70, 69, 68, 300073, 300072
   cursor로 2쪽     : 68, 300073, 300072, 300071, 300070
② 결제 대기 1쪽을 읽은 뒤 그중 2건이 결제된다
   1쪽              : 69, 300073, 300063, 300053, 300043
   offset=5로 2쪽   : 300013, 300003, 299993, 299983, 299973
   cursor로 2쪽     : 300033, 300023, 300013, 300003, 299993
   offset이 건너뛴 주문: 300033, 300023
```

①에서는 새 주문 2건이 맨 앞에 붙어 1쪽의 끝 두 건(70, 69)이 2쪽에 다시 나왔다. 시드 주문(68~72)과 1장의 주문 73이 가장 최근이고, 30만 건(74~300073)은 그 앞 2년에 걸쳐 있다. 무한 스크롤이라면 같은 주문이 화면에 두 번 그려진다.

②가 더 위험하다. 결제 대기만 걸러 보는 중에 1쪽의 두 건이 결제되어 목록에서 빠졌다. 뒤의 행들이 두 칸씩 앞으로 당겨지고, offset 5는 당겨진 두 건을 건너뛰었다. 화면에는 아무 표시도 없다. 관리자가 "결제 대기 주문을 끝까지 넘겨 확인했다"고 믿어도 두 건은 본 적이 없다.

cursor는 "1쪽의 마지막 행 다음"처럼 행을 기준으로 이어서 두 경우 모두 맞다.

### 작업 2. [커밋] 깊이별 HTTP 지연

`scripts/page-latency.mjs`는 깊이마다 offset 요청과, 같은 자리를 cursor로 가리킨 요청을 20번씩 보내 중앙값을 적는다. 같은 자리의 cursor는 offset으로 한 번 건너뛰어 받은 `nextCursor`다(4장의 offset → cursor 이어 읽기).

```js
// order-api-nest/scripts/page-latency.mjs
// 깊은 페이지일수록 offset은 느려지고 cursor는 그대로인지 HTTP로 잰다(전체 주문, 20건씩)
//   node scripts/page-latency.mjs [반복 수, 기본 20]
process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 20);
const DEPTHS = [0, 1_000, 10_000, 100_000, 250_000];

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

async function time(query) {
  const start = performance.now();
  const res = await fetch(`${API}/orders?${new URLSearchParams({ limit: "20", ...query })}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  return { ms: performance.now() - start, body };
}
const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];

await time({}); // 첫 요청(연결 만들기)은 재지 않는다
const table = [];
for (const depth of DEPTHS) {
  // 같은 자리를 가리키는 cursor: offset으로 바로 앞 페이지까지 건너뛰어 받은 nextCursor
  const cursor = depth === 0 ? undefined : (await time({ offset: String(depth - 20) })).body.nextCursor;
  const offsetMs = [];
  const cursorMs = [];
  for (let i = 0; i < N; i++) {
    offsetMs.push((await time({ offset: String(depth) })).ms);
    cursorMs.push((await time(cursor ? { cursor } : {})).ms);
  }
  table.push({ "깊이(건너뛴 행)": depth, "offset 중앙값(ms)": +median(offsetMs).toFixed(1), "cursor 중앙값(ms)": +median(cursorMs).toFixed(1) });
}
console.table(table);
```

```sh
node scripts/page-latency.mjs
# 출력
┌─────────┬─────────────────┬───────────────────┬───────────────────┐
│ (index) │ 깊이(건너뛴 행) │ offset 중앙값(ms) │ cursor 중앙값(ms) │
├─────────┼─────────────────┼───────────────────┼───────────────────┤
│ 0       │ 0               │ 3.4               │ 3.2               │
│ 1       │ 1000            │ 62                │ 3.3               │
│ 2       │ 10000           │ 65.2              │ 3.1               │
│ 3       │ 100000          │ 65.8              │ 5                 │
│ 4       │ 250000          │ 75.3              │ 4.9               │
└─────────┴─────────────────┴───────────────────┴───────────────────┘
```

cursor는 깊이와 상관없이 3~5ms다. 이상한 것은 offset이다. 3장의 psql에서는 20만 행을 건너뛰어도 42ms였는데, 여기서는 1,000행만 건너뛰어도 62ms다.

### 작업 3. [확인] RLS가 실행 계획을 바꾼다

psql은 테이블 소유자(`order`)로 붙었고, 앱은 RLS가 걸리는 `order_app`으로 붙는다([`10`](https://github.com/seungwoo7050/node-order/tree/10-rls)). 앱의 `asAdmin`과 같은 조건으로 다시 본다.

```sh
cd ..
docker compose exec -T db psql -U order_app -d order_api <<'EOF'
BEGIN;
SELECT set_config('app.role', 'admin', true);
EXPLAIN (ANALYZE, COSTS OFF) SELECT id, user_id, price, paid, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET 1000;
COMMIT;
EOF
# 출력
 set_config 
------------
 admin

                                                                    QUERY PLAN                                                                     
---------------------------------------------------------------------------------------------------------------------------------------------------
 Limit (actual time=156.015..156.883 rows=21 loops=1)
   ->  Gather Merge (actual time=155.883..156.856 rows=1021 loops=1)
         Workers Planned: 1
         Workers Launched: 1
         ->  Sort (actual time=154.733..154.767 rows=768 loops=2)
               Sort Key: created_at DESC, id DESC
               Sort Method: top-N heapsort  Memory: 192kB
               Worker 0:  Sort Method: top-N heapsort  Memory: 192kB
               ->  Parallel Seq Scan on orders (actual time=0.010..81.934 rows=150003 loops=2)
                     Filter: ((user_id = current_setting('app.user_id'::text, true)) OR (current_setting('app.role'::text, true) = 'admin'::text))
 Planning Time: 0.323 ms
 Execution Time: 156.920 ms
```

RLS 정책이 모든 쿼리에 `Filter`로 붙었다. 플래너는 `current_setting(…)`의 값을 실행 전에 모른다. 그래서 이 조건을 통과할 행이 일부뿐이라고 짐작하고, 1,021행을 모으려면 인덱스를 꽤 많이 읽어야 한다고 계산한다. 그 결과 인덱스 대신 전체 스캔과 정렬을 골랐다. 실제로는 관리자라 모든 행이 통과한다.

cursor 요청은 `LIMIT 21`에 범위 조건까지 있어 같은 짐작으로도 인덱스가 싸다. offset만 이 함정에 빠진다.

> 관리자 표의 페이지 건너뛰기는 offset으로 두되, 건너뛴 다음부터는 cursor로 읽는다. 깊은 offset이 느린 것은 기능의 한계로 받아들인다. 실제 서비스(GitHub의 목록 API, Stripe의 목록 API)도 깊은 페이지 번호를 막거나 cursor만 준다.

### 남길 것

- **찾아보면 되는 것**: `set_config('app.role', …, true)`, `page-latency.mjs`의 표 읽는 법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - offset은 넘기는 사이에 앞쪽 행이 늘면 겹치고, 줄면 건너뛴다. 건너뛰기가 더 위험하다. 화면에 아무 표시가 없다.

  - RLS 정책이 붙으면 플래너는 통과할 행 수를 모른다. 깊은 offset은 인덱스 대신 전체 스캔을 고른다. 실행 계획은 앱과 같은 역할로 본다.

- **에러 신호**:

  - 무한 목록에 같은 주문이 두 번 보인다, 결제 대기를 끝까지 넘겼는데 본 적 없는 주문이 있다 → offset으로 이어 읽는지

  - 앱의 깊은 페이지가 psql보다 훨씬 느리다 → psql을 소유자(`-U order`)로 붙었는지. `-U order_app`과 `set_config`로 다시 본다

  - `page-drift.mjs`가 `Cannot read properties of undefined (reading 'map')` → 응답이 페이지가 아니다. 401·403이면 kim 로그인(`.env`의 `DEMO_PASSWORD`)과 시드를 본다

## 6. 5단계: 목록 화면을 무한 스크롤로

### 작업 1. [커밋] 무한 쿼리 옵션과 "더 보기"

[`05`](https://github.com/seungwoo7050/node-order/tree/05-front-state)의 "다루지 않은 것"으로 남긴 무한 스크롤을 여기서 닫는다. 쿼리 옵션은 한 파일에 모은다. 같은 목록을 여러 화면이 보므로 키가 같아야 캐시를 함께 쓴다.

```ts
// order-console-next/lib/lists.ts
import type { useTRPC } from "./trpc";

// 같은 목록을 여러 화면이 본다(상점·장바구니·관리자, 주문 목록·주문 상세). 키가 같아야 캐시를 함께 쓴다 → 한곳에서 만든다
type Trpc = ReturnType<typeof useTRPC>;
export const PAGE_SIZE = 20;

// getNextPageParam: 받은 마지막 페이지를 보고 다음 cursor를 정한다. null이면 hasNextPage가 false
export const productListOptions = (trpc: Trpc) =>
  trpc.products.list.infiniteQueryOptions({ limit: PAGE_SIZE }, { getNextPageParam: (last) => last.nextCursor });

export const myOrderListOptions = (trpc: Trpc) =>
  trpc.me.orders.infiniteQueryOptions({ limit: PAGE_SIZE }, { getNextPageParam: (last) => last.nextCursor });
```

`getNextPageParam`은 받은 마지막 페이지를 보고 다음 cursor를 정한다. `null`이면 `hasNextPage`가 `false`가 된다. tRPC는 이 값을 프로시저 입력의 `cursor` 자리에 넣어 부른다.

목록의 끝에는 "더 보기" 버튼 하나를 둔다. 스크롤하는 사람에게는 저절로 불리고, 키보드와 낭독기를 쓰는 사람은 이 버튼으로 넘긴다.

```tsx
// order-console-next/app/load-more.tsx
"use client";

import { useEffect, useRef } from "react";

type Props = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
  loaded: number; // 지금까지 불러온 개수. 낭독기에 알린다
  pages: number; // 불러온 페이지 수
  noun: string; // "주문", "상품"
};

// 무한 목록의 끝. 버튼이 화면에 들어오면 저절로 다음 페이지를 부르고, 버튼 자체는 늘 둔다
// 키보드로 목록 끝까지 온 사람과 화면 낭독기를 쓰는 사람은 스크롤이 아니라 이 버튼으로 넘긴다
export function LoadMore({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, loaded, pages, noun }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  // 불러오기가 끝날 때마다 다시 건다. 버튼이 계속 화면 안에 있으면 "새로 들어왔다"는 알림이 다시 오지 않기 때문이다
  // 실패한 동안은 걸지 않는다. 걸면 실패 → 다시 관찰 → 다시 요청을 끝없이 되풀이한다
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage();
    }, { rootMargin: "200px" }); // 끝에 닿기 조금 전에 미리 부른다
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // 한 페이지로 끝나는 목록에는 아무것도 그리지 않는다
  if (!hasNextPage && pages <= 1) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      {hasNextPage && (
        // disabled를 쓰면 포커스가 문서 처음으로 간다. aria-disabled는 포커스를 두고 "지금은 누를 수 없다"만 알린다
        <button ref={ref} type="button" className="btn" aria-disabled={isFetchingNextPage}
          onClick={() => { if (!isFetchingNextPage) fetchNextPage(); }}>
          {isFetchingNextPage ? "불러오는 중…" : isFetchNextPageError ? "다시 시도" : "더 보기"}
        </button>
      )}
      <p role="status" className="num text-sm text-muted">
        {isFetchNextPageError ? "다음 페이지를 불러오지 못했습니다. " : ""}
        {noun} {loaded.toLocaleString("ko-KR")}건{hasNextPage ? "을 불러왔습니다" : " - 끝까지 불러왔습니다"}
      </p>
    </div>
  );
}
```

관찰 대상은 "더 보기" 버튼 자신이다. 버튼이 화면 아래 200px 안으로 들어오면 다음 페이지를 부른다. 스크롤하는 사람에게 버튼은 거의 보이지 않는다.

키보드로 목록 끝까지 탭한 사람과 화면 낭독기를 쓰는 사람은 스크롤이 아니라 이 버튼으로 넘긴다. 그래서 버튼을 숨기지 않는다. 몇 건을 불러왔는지는 `role="status"`가 낭독기에 읽어 준다.

관찰은 불러오기가 끝날 때마다 다시 건다. `IntersectionObserver`는 "들어왔다"가 바뀔 때만 알린다. 한 페이지가 짧아 버튼이 계속 화면 안에 있으면 다시 알리지 않는다. 다시 걸면 처음 관찰할 때 지금 상태를 한 번 알려 주므로 이어서 부른다.

실패한 동안은 걸지 않는다. 걸면 "실패 → 다시 관찰 → 다시 요청"을 끝없이 되풀이한다. 실패하면 버튼이 "다시 시도"가 되고 사람이 누른다.

> 한 페이지로 끝나는 목록(지금 상품 16개)에는 아무것도 그리지 않는다. 넘길 페이지가 없던 목록에 "끝까지 불러왔습니다"는 군더더기다.

`aria-disabled`인 버튼도 `disabled`와 같은 흐린 모양으로 그린다.

```diff
--- a/order-console-next/app/globals.css
+++ b/order-console-next/app/globals.css
@@
   .num { font-variant-numeric: tabular-nums; }
 
   .btn { border: 1px solid var(--line-strong); padding: 7px 16px; font-size: 0.82rem; font-weight: 400; cursor: pointer; }
-  .btn:disabled { color: var(--faint); border-color: var(--line); cursor: not-allowed; }
+  .btn:disabled, .btn[aria-disabled="true"] { color: var(--faint); border-color: var(--line); cursor: not-allowed; }
   .btn-primary { background: var(--fg); color: var(--bg); border-color: var(--fg); padding: 12px 24px; letter-spacing: 0.06em; }
   .btn-primary:disabled { background: var(--line); border-color: var(--line); color: var(--faint); }
   .link-quiet { font-size: 0.8rem; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
```

### 작업 2. [커밋] 네 화면을 무한 목록으로 바꾼다

4장 작업 4의 타입 에러가 난 네 파일을 고친다. 내 주문 목록부터.

```diff
--- a/order-console-next/app/me/orders/my-order-list.tsx
+++ b/order-console-next/app/me/orders/my-order-list.tsx
@@
 "use client";
 
-import { useQuery } from "@tanstack/react-query";
+import { useInfiniteQuery } from "@tanstack/react-query";
 import Link from "next/link";
+import { myOrderListOptions } from "@/lib/lists";
 import { useTRPC } from "@/lib/trpc";
+import { LoadMore } from "../../load-more";
 import { OrderStatus, orderDate } from "./order-status";
 
 export function MyOrderList() {
   const trpc = useTRPC();
-  const { data, isPending, error } = useQuery(trpc.me.orders.queryOptions());
+  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(myOrderListOptions(trpc));
 
   if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
   if (error?.data?.code === "UNAUTHORIZED")
     return <p role="alert" className="note">주문을 보려면 <Link href="/login">로그인</Link>해 주세요.</p>;
-  if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
-  if (data.length === 0)
+  // 다음 페이지만 실패해도 error가 찬다. 이미 받은 목록은 두고 LoadMore가 알린다
+  if (error && !data) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
+  const orders = data.pages.flatMap((p) => p.items);
+  if (orders.length === 0)
     return (
       <p className="border-y border-line py-8 text-sm text-muted" data-testid="my-orders">
         <span className="mb-1 block font-serif font-normal text-fg">아직 주문이 없습니다</span>
@@
       </p>
     );
   return (
-    <ul data-testid="my-orders" className="border-t border-line">
-      {data.map((o) => (
-        <li key={o.id} className="border-b border-line">
-          <Link href={`/me/orders/${o.id}`}
-            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 no-underline sm:grid-cols-[5rem_minmax(0,1fr)_auto_11rem]">
-            <span className="num order-1 text-sm text-muted sm:order-none">#{o.id}</span>
-            <span className="num order-3 text-sm text-muted sm:order-none">{orderDate(o.createdAt)}</span>
-            <span className="num order-2 text-right sm:order-none">{o.price.toLocaleString("ko-KR")}원</span>
-            <span className="order-4 text-right sm:order-none sm:text-left"><OrderStatus order={o} /></span>
-          </Link>
-        </li>
-      ))}
-    </ul>
+    <>
+      <ul data-testid="my-orders" className="border-t border-line">
+        {orders.map((o) => (
+          <li key={o.id} className="border-b border-line">
+            <Link href={`/me/orders/${o.id}`}
+              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 no-underline sm:grid-cols-[5rem_minmax(0,1fr)_auto_11rem]">
+              <span className="num order-1 text-sm text-muted sm:order-none">#{o.id}</span>
+              <span className="num order-3 text-sm text-muted sm:order-none">{orderDate(o.createdAt)}</span>
+              <span className="num order-2 text-right sm:order-none">{o.price.toLocaleString("ko-KR")}원</span>
+              <span className="order-4 text-right sm:order-none sm:text-left"><OrderStatus order={o} /></span>
+            </Link>
+          </li>
+        ))}
+      </ul>
+      <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
+        fetchNextPage={fetchNextPage} loaded={orders.length} pages={data.pages.length} noun="주문" />
+    </>
   );
 }
```

`error && !data`인 이유는, 다음 페이지만 실패해도 `error`가 채워지기 때문이다. 그때 목록 전체를 에러 문구로 바꾸면 이미 본 40건이 사라진다. 첫 페이지부터 실패했을 때만 목록 자리를 에러로 바꾸고, 다음 페이지의 실패는 `LoadMore`가 알린다. 상점과 관리자 상품 화면도 같은 방식이다.

```diff
--- a/order-console-next/app/shop/page.tsx
+++ b/order-console-next/app/shop/page.tsx
@@
 "use client";
 
-import { useQuery } from "@tanstack/react-query";
+import { useInfiniteQuery } from "@tanstack/react-query";
 import Link from "next/link";
 import { useSearchParams } from "next/navigation";
 import { Suspense, useCallback, useEffect, useState } from "react";
 import { useCartStore } from "@/lib/cart-store";
+import { productListOptions } from "@/lib/lists";
 import { useTRPC } from "@/lib/trpc";
+import { LoadMore } from "../load-more";
 import { Stepper } from "./stepper";
 
 const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
@@
 
 function ProductList() {
   const trpc = useTRPC();
-  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
+  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(productListOptions(trpc));
   const add = useCartStore((s) => s.add);
   const inCart = useCartStore((s) => s.items);
   const [added, setAdded] = useState<string | null>(null);
   const clearAdded = useCallback(() => setAdded(null), []);
 
   if (isPending) return <ProductSkeleton />;
-  if (error)
+  if (error && !data)
     return (
       <p role="alert" className="alert">
         상품을 불러오지 못했습니다.
         <span className="block text-sm text-muted">잠시 뒤 새로 고침해 주세요. ({error.message})</span>
       </p>
     );
+  const products = data.pages.flatMap((page) => page.items);
   return (
     <>
       <ul className="border-t border-line">
-        {data.map((p) => {
+        {products.map((p) => {
           const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
           const soldOut = p.stock === 0;
           return (
@@
           );
         })}
       </ul>
+      <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
+        fetchNextPage={fetchNextPage} loaded={products.length} pages={data.pages.length} noun="상품" />
       {added && <AddedToast name={added} onDone={clearAdded} />}
     </>
   );
```

관리자 상품 화면은 데모 관리자도 본다([`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)). 읽기 전용 표시는 그대로 두고 표만 무한 목록으로 바꾼다. 표와 버튼을 함께 돌려주려고 조각(`<>`)으로 감싼다.

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
 "use client";
 
-import { useQuery } from "@tanstack/react-query";
+import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
 import Link from "next/link";
+import { productListOptions } from "@/lib/lists";
 import { useTRPC } from "@/lib/trpc";
+import { LoadMore } from "../../load-more";
 import { ProductImageUploader } from "./product-image-uploader";
 
 const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
 
 function ProductTable({ readOnly }: { readOnly: boolean }) {
   const trpc = useTRPC();
-  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
+  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(productListOptions(trpc));
   if (isPending) return <p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>;
-  if (error) return <p role="alert" className="alert">상품을 불러오지 못했습니다. ({error.message})</p>;
+  if (error && !data) return <p role="alert" className="alert">상품을 불러오지 못했습니다. ({error.message})</p>;
+  const products = data.pages.flatMap((page) => page.items);
   return (
+    <>
     <table className="w-full border-collapse text-left">
       <thead>
         <tr className="border-b border-line-strong">
@@
         </tr>
       </thead>
       <tbody>
-        {data.map((p) => (
+        {products.map((p) => (
           <tr key={p.id} className="border-b border-line">
             <td className="py-3">
               <span className="flex items-center gap-3">
@@
         ))}
       </tbody>
     </table>
+    <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
+      fetchNextPage={fetchNextPage} loaded={products.length} pages={data.pages.length} noun="상품" />
+    </>
   );
 }
 
```

장바구니는 수량 상한을 정하려고 상품 목록 캐시에서 재고를 본다. 이제는 상점에서 불러온 페이지 안의 상품만 안다. 모르는 상품은 상한 없이 두고, 재고는 결제 API가 409로 막는다. 결제 뒤 목록을 지우는 두 줄은 `queryKey()`를 `pathKey()`로 바꾼다. 이유는 아래 "개념 | 무한 쿼리의 키"에서 다룬다.

```diff
--- a/order-console-next/app/cart/page.tsx
+++ b/order-console-next/app/cart/page.tsx
@@
 "use client";
 
-import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
+import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import Link from "next/link";
 import { ApiError, authFetch } from "@/lib/api-client";
 import { useCartStore } from "@/lib/cart-store";
+import { productListOptions } from "@/lib/lists";
 import { useTRPC } from "@/lib/trpc";
 import { useOnline } from "../online-banner";
 import { Stepper } from "../shop/stepper";
@@
   const online = useOnline();
   const queryClient = useQueryClient();
   const trpc = useTRPC();
-  const { data: products } = useQuery(trpc.products.list.queryOptions());
-  const stockOf = (productId: number) => products?.find((p) => p.id === productId)?.stock ?? Infinity;
+  // 상점에서 불러온 페이지까지만 재고를 안다. 모르는 상품은 상한 없이 두고, 재고는 결제 API가 409로 막는다
+  const { data: products } = useInfiniteQuery(productListOptions(trpc));
+  const stockOf = (productId: number) => products?.pages.flatMap((p) => p.items).find((p) => p.id === productId)?.stock ?? Infinity;
 
   const checkout = useMutation({
     mutationFn: () => {
@@
     },
     onSuccess: (data) => {
       useCartStore.getState().finishCheckout();
-      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
-      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
+      // 무한 쿼리의 키는 { input, type: "infinite" }까지 붙는다 → queryKey()로는 지워지지 않는다. 경로(pathKey)로 지운다
+      void queryClient.invalidateQueries({ queryKey: trpc.products.list.pathKey() });
+      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
       window.location.assign(data.checkoutUrl);
     },
   });
```

이미지를 올린 뒤 상품 목록을 지우는 곳도 같은 이유로 바꾼다.

```diff
--- a/order-console-next/app/admin/products/product-image-uploader.tsx
+++ b/order-console-next/app/admin/products/product-image-uploader.tsx
@@
         body: JSON.stringify({ key }),
       });
     },
-    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() }),
+    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.list.pathKey() }),
   });
 
   return (
```

### 작업 3. [커밋] 결제가 확인되면 목록 캐시의 한 줄을 고친다

주문 상세 화면은 아래에 내 주문 목록을 함께 그린다. Stripe 결제 화면에서 돌아오면 상세는 결제 대기인 동안 1초마다 다시 묻는다([`14`](https://github.com/seungwoo7050/node-order/tree/14-stripe)). 웹훅이 와서 상세가 "결제 완료"로 바뀌어도, 아래 목록은 처음 받은 "결제 대기"를 그대로 보여 준다. 고치는 방법은 둘이다.

| 방법 | 코드 | 요청 |
|---|---|---|
| 목록 무효화 | `invalidateQueries({ queryKey: trpc.me.orders.pathKey() })` | 불러온 페이지 수만큼(5쪽을 봤으면 5번, 첫 페이지부터 차례로) |
| 캐시에서 그 줄만 고치기 | `setQueryData(키, old => …)` | 0번 |

무한 쿼리를 무효화하면 TanStack Query는 불러온 페이지를 첫 페이지부터 차례로 다시 받는다. 다음 페이지의 cursor는 새로 받은 앞 페이지에서 다시 계산한다. 그래서 결과는 언제나 맞지만, 바뀐 것은 한 줄인데 페이지 수만큼 요청이 나간다. 이 화면은 무엇이 바뀌었는지 정확히 안다. 그래서 그 줄만 고친다.

```diff
--- a/order-console-next/app/me/orders/[id]/page.tsx
+++ b/order-console-next/app/me/orders/[id]/page.tsx
@@
 "use client";
 
-import { useQuery } from "@tanstack/react-query";
+import { useQuery, useQueryClient } from "@tanstack/react-query";
 import Link from "next/link";
 import { useParams, useSearchParams } from "next/navigation";
+import { useEffect } from "react";
+import { myOrderListOptions } from "@/lib/lists";
 import { useTRPC } from "@/lib/trpc";
 import { MyOrderList } from "../my-order-list";
 import { OrderStatus, orderDate } from "../order-status";
@@
     ...trpc.me.order.queryOptions({ id }),
     refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
   });
+  // 결제가 확인되면 아래 목록의 이 주문도 "결제 완료"로. 목록을 무효화하면 불러온 페이지 수만큼 다시 받는다 → 이 한 줄만 고친다
+  const queryClient = useQueryClient();
+  const paid = data?.paid === true;
+  useEffect(() => {
+    if (!fromCheckout || !paid) return;
+    queryClient.setQueryData(myOrderListOptions(trpc).queryKey, (old) => old && {
+      ...old,
+      pages: old.pages.map((page) => ({ ...page, items: page.items.map((o) => (o.id === id ? { ...o, paid: true } : o)) })),
+    });
+  }, [fromCheckout, paid, id, queryClient, trpc]);
   if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
   if (error?.data?.code === "NOT_FOUND") return <p className="note">주문 #{id}을 찾을 수 없습니다.</p>;
   if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
```

`useEffect`는 아래의 이른 `return`들보다 위에 둔다. 훅은 그리는 횟수마다 같은 순서로 불려야 한다.

새 주문이 생긴 경우도 같은 모양이다. 첫 페이지의 `items` 앞에 새 주문을 붙이면 된다. 첫 페이지가 21건이 되지만 문제없다. 2쪽의 cursor는 "몇 번째"가 아니라 "어느 행 다음"이라서, 앞에 한 줄이 붙어도 2쪽이 밀리지 않는다. offset이었다면 5장 ①처럼 한 줄이 겹친다. 다만 이 서비스는 결제를 누르면 Stripe 화면으로 페이지를 떠나므로, 새 주문 직후의 캐시는 다시 그릴 일이 없다. 장바구니는 떠나기 전에 `pathKey()`로 목록을 지워 두기만 한다(작업 2). 돌아왔을 때 첫 페이지부터 다시 받는다.

### 작업 4. [커밋] e2e로 지킨다

`e2e/infinite-orders.spec.ts`는 kim의 주문을 45건 이상으로 채운 뒤 세 가지를 본다. 스크롤로 다음 20건이 붙는지, 키보드로 "더 보기"를 눌러 넘기는지, 결제가 확인된 뒤 목록 요청이 다시 나가지 않는지다. 주문은 관리자 경로인 `POST /orders`로 재고와 상관없이 만든다. 시드의 kim이 관리자다.

```ts
// order-console-next/e2e/infinite-orders.spec.ts
import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:4000";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

// kim의 주문이 세 페이지(41건 이상)가 되게 채운다. POST /orders는 재고와 상관없는 관리자 경로이고, 시드의 kim이 관리자다
test.beforeAll(async ({ request }) => {
  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { items } = await (await request.get(`${API}/me/orders?limit=45`, { headers })).json();
  for (let i = items.length; i < 45; i++) await request.post(`${API}/orders`, { headers, data: { user: "kim", price: 1000, paid: true } });
});

const rows = (page: Page) => page.getByTestId("my-orders").getByRole("listitem");

test("목록 끝에 닿으면 다음 20건이 붙고, 같은 주문이 두 번 나오지 않는다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole("status").filter({ hasText: "주문 20건을 불러왔습니다" })).toBeVisible();

  await rows(page).last().scrollIntoViewIfNeeded(); // 끝까지 내리면 IntersectionObserver가 다음 페이지를 부른다
  await expect(rows(page)).toHaveCount(40);

  const hrefs = await rows(page).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(40);
});

test("스크롤하지 않아도 키보드로 '더 보기'를 눌러 넘기고, 포커스는 버튼에 남는다", async ({ page }) => {
  // 스크롤로 불러오는 길을 막는다: 아무것도 알리지 않는 IntersectionObserver로 바꿔 끼운다
  await page.addInitScript(() => {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  });
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(rows(page)).toHaveCount(20);

  const more = page.getByRole("button", { name: "더 보기" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(40);
  await expect(more).toBeFocused(); // 새 줄은 버튼 위에 붙는다. 다음 Enter로 바로 이어서 넘긴다
  await page.keyboard.press("Enter");
  await expect(rows(page)).not.toHaveCount(40);
});

test("결제가 확인되면 아래 목록의 그 주문도 '결제 완료'로 바뀐다 - 목록을 다시 받지 않는다", async ({ page }) => {
  // 결제 완료 웹훅을 보내 줄 쪽이 있어야 한다. API를 STRIPE_SIMULATOR_URL로 띄우고 시뮬레이터(:4100)를 켠 뒤 STRIPE_SIM=1로 돌린다
  test.skip(!process.env.STRIPE_SIM, "STRIPE_SIM=1 일 때만 Stripe 시뮬레이터로 결제한다");
  await loginAsKim(page);
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await Promise.all([page.waitForURL(/localhost:4100\/c\/pay\/cs_/), page.getByRole("button", { name: "결제" }).click()]);

  const listRequests: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/trpc/") && path.includes("me.orders")) listRequests.push(path);
  });
  // 시뮬레이터는 가게로 먼저 돌려보내고 1초 뒤에 웹훅을 보낸다 → 돌아온 화면은 결제 대기를 먼저 본다
  await page.getByRole("button", { name: "결제 완료" }).click();
  await page.waitForURL(/\/me\/orders\/\d+\?checkout=success$/);
  const id = new URL(page.url()).pathname.split("/").pop();

  const row = rows(page).filter({ has: page.locator(`a[href="/me/orders/${id}"]`) });
  await expect(row).toContainText("결제 대기");
  await expect(page.getByTestId("order-status")).toHaveText("결제 완료"); // 상세는 1초마다 묻다가 웹훅 뒤에 바뀐다
  await expect(row).toContainText("결제 완료");
  expect(listRequests).toEqual(["/trpc/me.order,me.orders"]); // 처음 그릴 때 상세와 묶여 나간 한 번뿐이다
});
```

마지막 테스트는 결제 완료 웹훅이 와야 끝난다. CI는 진짜 Stripe 키로 돌고 웹훅을 받을 주소가 없으므로, 기존 `stripe-payment.spec.ts`의 `STRIPE_E2E`처럼 `STRIPE_SIM=1`일 때만 돈다.

`shop.spec.ts`는 세 군데를 고친다. 결제 화면 주소가 Stripe든 시뮬레이터든 맞게 하고, 내 주문의 개수를 세던 테스트는 맨 위 주문을 비교하게 한다. 목록이 20건씩이라 개수로는 셀 수 없다.

셋째는 주문 번호다. 원래 테스트는 `/me/orders/1`을 열고 "주문 #1"을 기다린다. 새 DB에 시드를 한 번 넣은 직후에는 1번이 kim의 주문이라 통과한다. 그런데 시드는 시드 사용자의 주문을 지우고 다시 만들 뿐, 주문 번호(시퀀스)는 되돌리지 않는다. 이 문서처럼 30만 건을 넣고 시드를 다시 돌리면 1번 주문이 없어서 `Expected substring: "주문 #1"`, `element(s) not found`로 실패한다. 번호를 박지 않고, kim의 가장 최근 주문을 API로 받아 그 번호를 연다. 받아 오는 요청은 브라우저와 따로인 `request` 픽스처로 보낸다. 브라우저의 `page`로 보내면 그 응답이 테스트가 세는 `/auth/refresh` 응답과 요청 목록에 섞일 수 있다.

```diff
--- a/order-console-next/e2e/shop.spec.ts
+++ b/order-console-next/e2e/shop.spec.ts
@@
-import { expect, test, type Page } from "@playwright/test";
+import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
+
+const API = "http://localhost:4000";
 
 test.use({ serviceWorkers: "block" });
 
@@
   await expect(page).toHaveURL(/\/shop$/);
 }
 
+// 시드를 다시 돌려도 주문 번호(시퀀스)는 처음으로 돌아가지 않는다 → 번호를 박지 않고 kim의 가장 최근 주문을 API로 받는다
+async function newestKimOrderId(request: APIRequestContext): Promise<number> {
+  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
+  const { items } = await (await request.get(`${API}/me/orders?limit=1`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
+  return items[0].id;
+}
+
 test("장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다", async ({ page }) => {
   const errors: string[] = [];
   page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
@@
   await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
   await page.getByTestId("cart-count").click();
   await Promise.all([
-    page.waitForURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\//),
+    page.waitForURL(/\/c\/pay\/cs_/),
     page.getByRole("button", { name: "결제" }).click(),
   ]);
 
@@
   await expect(page.getByTestId("order-detail")).toContainText("30,000원 × 1");
 });
 
-test("새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다", async ({ page }) => {
+test("새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다", async ({ page, request }) => {
+  const id = await newestKimOrderId(request); // 브라우저와 따로 쓰는 요청이라 아래 refresh 수에 섞이지 않는다
   await loginAsKim(page);
   const refreshes: number[] = [];
   page.on("response", (res) => {
@@
 
   for (let i = 0; i < 2; i++) {
     refreshes.length = 0;
-    await page.goto("/me/orders/1");
-    await expect(page.getByTestId("order-detail")).toContainText("주문 #1");
+    await page.goto(`/me/orders/${id}`);
+    await expect(page.getByTestId("order-detail")).toContainText(`주문 #${id}`);
     await expect(page.getByTestId("my-orders")).toBeVisible();
     expect(refreshes).toEqual([200]);
   }
@@
   await loginAsKim(page);
   await page.goto("/me/orders");
   await expect(page.getByTestId("my-orders")).toBeVisible();
-  const countBefore = await page.getByTestId("my-orders").getByRole("listitem").count();
+  const newestBefore = await page.getByTestId("my-orders").getByRole("listitem").first().getByRole("link").getAttribute("href");
   await page.goto("/shop");
   await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }));
 
@@
   await page.getByRole("button", { name: "결제" }).click();
   await expect(page.getByText(/결제를 시작하지 못했습니다/)).toBeVisible();
   await Promise.all([
-    page.waitForURL(/^https:\/\/checkout\.stripe\.com\//),
+    page.waitForURL(/\/c\/pay\/cs_/),
     page.getByRole("button", { name: "결제" }).click(),
   ]);
 
   await page.goto("/me/orders");
-  await expect(page.getByTestId("my-orders").getByRole("listitem")).toHaveCount(countBefore + 1);
-});
+  const links = page.getByTestId("my-orders").getByRole("listitem").getByRole("link");
+  await expect(links.nth(1)).toHaveAttribute("href", newestBefore!);
+  await expect(links.nth(0)).not.toHaveAttribute("href", newestBefore!);
+});
```

`trpc.spec.ts`도 같은 가정을 한다. 같은 방법으로 고친다.

```diff
--- a/order-console-next/e2e/trpc.spec.ts
+++ b/order-console-next/e2e/trpc.spec.ts
@@
-import { expect, test } from "@playwright/test";
+import { expect, test, type APIRequestContext } from "@playwright/test";
 
-test("주문 상세 화면의 tRPC 요청 두 개(me.order, me.orders)가 HTTP 요청 하나로 묶인다", async ({ page }) => {
+const API = "http://localhost:4000";
+
+// 시드를 다시 돌려도 주문 번호(시퀀스)는 처음으로 돌아가지 않는다 → 번호를 박지 않고 kim의 가장 최근 주문을 API로 받는다
+async function newestKimOrderId(request: APIRequestContext): Promise<number> {
+  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
+  const { items } = await (await request.get(`${API}/me/orders?limit=1`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
+  return items[0].id;
+}
+
+test("주문 상세 화면의 tRPC 요청 두 개(me.order, me.orders)가 HTTP 요청 하나로 묶인다", async ({ page, request }) => {
+  const id = await newestKimOrderId(request);
   await page.goto("/login");
   await page.getByLabel("아이디").fill("kim");
   await page.getByLabel("비밀번호").fill("1234");
@@
     if (url.pathname.startsWith("/trpc/me.order")) calls.push(url.pathname);
   });
 
-  await page.goto("/me/orders/1");
-  await expect(page.getByTestId("order-detail")).toContainText("주문 #1");
+  await page.goto(`/me/orders/${id}`);
+  await expect(page.getByTestId("order-detail")).toContainText(`주문 #${id}`);
   await expect(page.getByTestId("my-orders")).toBeVisible();
   expect(calls).toEqual(["/trpc/me.order,me.orders"]);
 });
```

API를 다시 빌드해 시뮬레이터 모드로 띄우고(터미널 2), 웹 e2e를 돌린다. `playwright.config.ts`가 웹을 빌드해 띄운다.

```sh
# 저장소 루트에서
cd order-console-next && STRIPE_SIM=1 npx playwright test e2e/infinite-orders.spec.ts e2e/shop.spec.ts e2e/trpc.spec.ts
# 출력(끝 줄)
  8 passed (13.2s)
```

### 실험 | 일부러 깨뜨려보기 ②, disabled로 막고 목록을 무효화한다

실험 전에 작업 1~4를 커밋해 둔다. 4장부터 깨져 있던 웹 타입 검사가 여기서 다시 통과하고, 실험의 원복이 `git restore` 한 줄로 끝난다.

처음 떠올리기 쉬운 두 가지로 바꿔 본다. 불러오는 동안 버튼을 `disabled`로 막고, 결제가 확인되면 목록을 무효화한다.

```diff
--- a/order-console-next/app/load-more.tsx
+++ b/order-console-next/app/load-more.tsx
@@
     <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
       {hasNextPage && (
         // disabled를 쓰면 포커스가 문서 처음으로 간다. aria-disabled는 포커스를 두고 "지금은 누를 수 없다"만 알린다
-        <button ref={ref} type="button" className="btn" aria-disabled={isFetchingNextPage}
-          onClick={() => { if (!isFetchingNextPage) fetchNextPage(); }}>
+        <button ref={ref} type="button" className="btn" disabled={isFetchingNextPage}
+          onClick={() => fetchNextPage()}>
           {isFetchingNextPage ? "불러오는 중…" : isFetchNextPageError ? "다시 시도" : "더 보기"}
         </button>
       )}
```

```diff
--- a/order-console-next/app/me/orders/[id]/page.tsx
+++ b/order-console-next/app/me/orders/[id]/page.tsx
@@
   const paid = data?.paid === true;
   useEffect(() => {
     if (!fromCheckout || !paid) return;
-    queryClient.setQueryData(myOrderListOptions(trpc).queryKey, (old) => old && {
-      ...old,
-      pages: old.pages.map((page) => ({ ...page, items: page.items.map((o) => (o.id === id ? { ...o, paid: true } : o)) })),
-    });
+    void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
   }, [fromCheckout, paid, id, queryClient, trpc]);
   if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
   if (error?.data?.code === "NOT_FOUND") return <p className="note">주문 #{id}을 찾을 수 없습니다.</p>;
```

```sh
STRIPE_SIM=1 npx playwright test e2e/infinite-orders.spec.ts
# 출력(줄임)
#     Error: expect(locator).toBeFocused() failed
#     Locator:  getByRole('button', { name: '더 보기' })
#     Expected: focused
#     Received: inactive
#
#     Error: expect(received).toEqual(expected) // deep equality
#       Array [
#         "/trpc/me.order,me.orders",
#     +   "/trpc/me.orders",
#       ]
```

첫째, 40건은 붙었지만 포커스가 버튼에 없다. `disabled`가 된 요소는 포커스를 가질 수 없다. 브라우저는 포커스를 문서 처음(`body`)으로 돌린다. 키보드 사용자는 다음 20건을 보려면 맨 위부터 다시 탭해야 한다. 그래서 `aria-disabled`를 쓴다. 포커스는 그대로 두고, 낭독기에는 "지금은 누를 수 없다"를 알린다. 누름은 `onClick`에서 무시한다.

둘째, 화면 결과는 같은데 목록 요청이 한 번 더 나갔다. 지금은 한 쪽만 봤으니 한 번이지만, 다섯 쪽을 넘긴 사람에게는 다섯 번이다.

### 작업 5. [원복] 실험 두 곳을 되돌린다

```sh
# 저장소 루트에서
git restore order-console-next/app/load-more.tsx "order-console-next/app/me/orders/[id]/page.tsx"
```

### 개념 | 무한 쿼리의 키

무효화할 때 `queryKey()`가 아니라 `pathKey()`를 쓴 데는 이유가 있다. 세 키는 다르게 생겼다.

```text
queryKey()          [["me","orders"],{"type":"query"}]
infinite queryKey   [["me","orders"],{"input":{"limit":20},"type":"infinite"}]
pathKey()           [["me","orders"]]
```

TanStack Query의 무효화는 앞부분이 같은 키를 모두 찾는다. `queryKey()`의 두 번째 칸 `{ type: "query" }`는 무한 쿼리의 `{ …, type: "infinite" }`와 맞지 않는다. 그래서 [`12`](https://github.com/seungwoo7050/node-order/tree/12-trpc)부터 써 온 `invalidateQueries({ queryKey: trpc.products.list.queryKey() })`는 타입 에러도 없이 아무것도 지우지 않는다. 경로만 담은 `pathKey()`로 바꿨다(장바구니의 결제, 관리자의 이미지 업로드).

### 용어 | TanStack Query API

- `useInfiniteQuery(options)`: 페이지를 이어 붙이는 쿼리. `data.pages`가 받은 페이지들의 배열이다
- `fetchNextPage()`: 다음 페이지를 부른다. 불러오는 중에 다시 부르면 앞 요청을 버리고 새로 부르므로, 앱에서 `isFetchingNextPage`로 막는다
- `hasNextPage` / `isFetchingNextPage` / `isFetchNextPageError`: 다음이 있는가 / 부르는 중인가 / 다음 페이지만 실패했는가
- `setQueryData(key, updater)`: 요청 없이 캐시를 고친다. 무한 쿼리면 `{ pages, pageParams }`를 받아 같은 모양을 돌려준다

### 용어 | tRPC API

- `infiniteQueryOptions(input, { getNextPageParam })`: 무한 쿼리 옵션. 입력에 `cursor`가 있는 프로시저에만 쓸 수 있다
- `pathKey()`: 프로시저 경로만 담은 키. 그 프로시저의 모든 쿼리(일반, 무한, 입력별)와 맞는다

### 용어 | 브라우저 API

- `IntersectionObserver(callback, { rootMargin })`: 요소가 화면(뷰포트)에 들어오고 나갈 때 알린다. `rootMargin`만큼 미리 알린다
- `aria-disabled="true"`: 낭독기에 "누를 수 없음"을 알린다. 포커스와 클릭은 막지 않는다

### 남길 것

- **찾아보면 되는 것**: `useInfiniteQuery`가 돌려주는 값, `infiniteQueryOptions`의 `getNextPageParam`, `IntersectionObserver`의 `rootMargin`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 불러오는 동안 버튼을 `disabled`로 막으면 포커스가 문서 처음으로 간다. 키보드 사용자를 위해 `aria-disabled`로 막고 버튼은 늘 둔다.

  - 무엇이 바뀌었는지 아는 화면은 무한 목록을 무효화(불러온 페이지 수만큼 요청)하지 않고 `setQueryData`로 그 줄만 고친다. cursor 목록은 첫 페이지 앞에 한 줄이 붙어도 뒤 페이지가 밀리지 않는다.

  - 무한 쿼리를 지울 때는 `queryKey()`가 아니라 `pathKey()`다. 틀려도 타입 에러 없이 아무것도 지우지 않는다.

- **에러 신호**:

  - `expect(locator).toBeFocused() failed`, `Received: inactive` → 불러오는 동안 버튼을 `disabled`로 바꿨는지

  - 무효화했는데 무한 목록이 그대로다 → `queryKey()`로 지웠는지

  - 목록 요청에 `"/trpc/me.orders"`가 한 번 더 나간다 → 한 줄을 고치려고 목록을 무효화했다

  - Playwright가 고친 화면을 모른다 → `:3000`에 예전 빌드의 `next start`가 떠 있는지(`reuseExistingServer`)

  - `page.waitForURL: Timeout` (`localhost:4100/c/pay/cs_`) → API를 `STRIPE_SIMULATOR_URL=…` 없이 띄웠거나 시뮬레이터가 꺼져 있다

  - `Expected substring: "주문 #1"`, `element(s) not found` → 테스트가 주문 번호 1을 박아 두었다. 시드를 다시 돌리면 번호가 밀린다. 가장 최근 주문을 API로 받아 쓴다

## 7. 6단계: 같은 재고를 비관적 잠금으로 판다

### 작업 1. [커밋] 지금의 비관적 잠금으로 50명이 동시에 산다

[`02`](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency)의 실험을 다시 한다. 한정판 키보드(상품 5)의 재고는 시드에서 10개다. 50명이 동시에 하나씩 산다. `scripts/stampede.mjs`는 응답을 사유(메시지)별로 세게 고친다. 재고 부족 409와, 뒤에서 볼 "재시도를 다 써서 난 409"를 나눠 보기 위해서다. 끝의 장부 표는 산 상품만 보게 좁힌다. 작업 2에서 부하용 상품 50개가 더해지면 표가 길어지기 때문이다.

가져온 코드의 버그도 하나 고친다. `const idempotencyKey = process.argv`는 넷째 인자가 아니라 인자 배열 전체를 받는다. 배열은 언제나 참이므로 50개 요청이 모두 같은 `Idempotency-Key`를 달고 나간다. 그러면 첫 요청만 주문을 만들고, 나머지 49개는 멱등 재응답으로 같은 주문을 201로 돌려받는다. 결과는 `'201': 50`에 팔린 수량 1이다. 잠금 실험이 아니라 멱등 키 실험이 된 것이다. `process.argv[4]`로 고쳐, 넷째 인자를 줄 때만 키를 단다.

```diff
--- a/order-api-nest/scripts/stampede.mjs
+++ b/order-api-nest/scripts/stampede.mjs
@@
 const API = "http://localhost:4000";
 const N = Number(process.argv[2] ?? 50);
 const items = JSON.parse(process.argv[3] ?? '[{"productId":1,"quantity":1}]');
-const idempotencyKey = process.argv
+const idempotencyKey = process.argv[4]; // 넷째 인자를 주면 50개 요청이 모두 같은 키를 쓴다(멱등 실험). 주지 않으면 키 없이 보낸다
 
 const login = await fetch(`${API}/auth/login`, {
   method: "POST",
@@
         ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
       },
       body: JSON.stringify({ items }),
-    }).then((r) => r.status),
+    }).then(async (r) => (r.ok ? String(r.status) : `${r.status} ${(await r.json()).message}`)), // 실패는 사유까지 나눠 센다
   ),
 );
 const tally = statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
-console.log("응답 코드별 개수:", tally);
+console.log("응답별 개수:", tally);
 
 const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
 await db.connect();
 const { rows } = await db.query(`
   SELECT p.id, p.name, p.stock AS "남은 재고", COALESCE(SUM(oi.quantity), 0)::int AS "팔린 수량"
   FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
-  GROUP BY p.id ORDER BY p.id`);
+  WHERE p.id = ANY($1)
+  GROUP BY p.id ORDER BY p.id`, [items.map((i) => i.productId)]); // 산 상품만 본다(부하용 상품 50개까지 찍히지 않게)
 console.table(rows);
-await db.end();
+await db.end();
```

시드를 다시 넣는다. 시드는 임시 계정과 시드 사용자의 주문(2장의 30만 건 포함)을 지우고 재고를 처음 값으로 돌린다. 장부(남은 재고 + 팔린 수량 = 처음 재고)를 맞추려면 실험마다 시드부터 한다. 결제는 시뮬레이터로 가야 하므로 1장 작업 3의 터미널 1·2가 떠 있어야 한다.

```sh
# order-api-nest에서
npx prisma db seed
node scripts/stampede.mjs 50 '[{"productId":5,"quantity":1}]'
# 출력
응답별 개수: { '201': 10, '409 재고 부족: 한정판 키보드': 40 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 5  │ '한정판 키보드' │ 0         │ 10        │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

지금의 비관적 잠금이다. 10건만 받았고 남은 재고와 팔린 수량을 더하면 처음 재고 10이다. 50명이 같은 행을 두고 다투는 이 장면을 8장에서 다른 잠금 두 가지로 똑같이 다시 한다.

### 작업 2. [커밋] 부하 시나리오를 지금 카탈로그에 맞춘다

[`08`](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp)의 k6 시나리오를 쓴다. 가상 사용자 20명이 20초 동안 쉬지 않고 결제한다. `HOT=0`은 재고가 넉넉한 부하용 상품 50개에 흩어지고, `HOT=1`은 모두 한정판 키보드(5번) 하나를 산다.

시나리오는 상품 번호를 1·2번과 3~52번으로 박아 두었다. 지금 카탈로그는 16개이고 1~4번은 사진 상품이다. 게다가 시드는 팔린 적 있는 상품을 지우지 않고 재고만 0으로 둔다. 시드를 다시 돌릴 때마다 부하용 상품의 번호가 밀린다. 그래서 몰린 부하는 5번으로 고정하고, 흩어진 부하는 `setup`에서 상품 목록을 받아 이름이 "부하용 상품"이고 재고가 남은 것만 고른다. 상품 목록이 페이지로 나뉘었으므로 `nextCursor`를 따라간다.

몰린 부하를 5번 한정판 키보드로 정한 데는 이유가 있다. 2장의 30만 건이 5~8번을 쓰는 것과는 상관없다(그 주문은 시드가 지운다).

- **같은 장면을 잇는다.** 작업 1의 `stampede.mjs`가 50명을 몰아넣은 상품이 5번이다. 몰린 부하는 그 장면을 20초 동안 이어 간 것이다. 같은 행을 두고 다투는 결과를 동시 50건과 k6에서 나란히 비교할 수 있다.
- **이 서비스의 "인기 상품"이다.** 시드에서 재고가 10개뿐인 선착순 한정판이다. 실제로 몰릴 상품이 이것이고, 8장의 "고르기"도 이 상품을 근거로 든다. 예전 시나리오의 1번도 당시 카탈로그의 한정판 키보드였다. 번호만 카탈로그를 따라 바뀌었다.
- **사진 상품(1~4번)을 피한다.** 1~4번은 [`21`](https://github.com/seungwoo7050/node-order/tree/21-public-demo)에서 더한 만든 사람의 사진 상품이라 부하 실험의 대상으로 맞지 않는다.

재고 10개로는 20초를 버티지 못하므로, `load-seed.sql`이 5번의 재고만 1,000,000으로 올린다. 그래서 몰린 부하에서 실패는 재고 부족이 아니라 잠금 방식에서만 생긴다. 측정이 끝나면 시드가 10개로 되돌린다.

```diff
--- a/order-api-nest/loadtest/load-seed.sql
+++ b/order-api-nest/loadtest/load-seed.sql
@@
+-- 시드를 다시 돌려도 팔린 적 있는 부하용 상품은 재고 0으로 남는다. 번호가 매번 달라지므로 checkout.js가 이름으로 찾는다
 INSERT INTO products (name, price, stock)
 SELECT '부하용 상품 ' || i, 1000, 1000000 FROM generate_series(1, 50) AS i;
-UPDATE products SET stock = 1000000 WHERE id IN (1, 2);
+UPDATE products SET stock = 1000000 WHERE id = 5; -- 몰린 부하는 한정판 키보드 하나를 산다
 SELECT count(*) AS products, sum(stock) AS total_stock FROM products;
```

```diff
--- a/order-api-nest/loadtest/checkout.js
+++ b/order-api-nest/loadtest/checkout.js
@@
   const res = http.post(`${API}/auth/login`, JSON.stringify({ id: "kim", password: "1234" }), {
     headers: { "Content-Type": "application/json" },
   });
-  return { token: res.json("accessToken") };
+  // 재고가 남은 부하용 상품의 id를 모은다. 상품 목록이 페이지로 나뉘었으므로 nextCursor를 따라간다
+  const loadIds = [];
+  for (let cursor = null; ;) {
+    const page = http.get(`${API}/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`).json();
+    loadIds.push(...page.items.filter((p) => p.name.startsWith("부하용 상품") && p.stock > 0).map((p) => p.id));
+    if (!page.nextCursor) break;
+    cursor = page.nextCursor;
+  }
+  return { token: res.json("accessToken"), loadIds };
 }
 
 export default function (data) {
-  const productId = HOT ? 1 : 3 + Math.floor(Math.random() * 50);
+  const productId = HOT ? 5 : data.loadIds[Math.floor(Math.random() * data.loadIds.length)];
   const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: [{ productId, quantity: 1 }] }), {
     headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
     tags: { name: "checkout" },
```

### 작업 3. [확인] 비관적 잠금으로 흩은 부하와 몰린 부하를 잰다

지금 코드(`FOR UPDATE`)가 기준선이다. 8장에서 바꾼 잠금을 이 숫자와 비교한다.

아래를 `HOT=0`, `HOT=1`로 한 번씩 한다. 매번 시드와 부하용 상품을 다시 넣고, API를 다시 띄운 뒤 돌린다. 8장의 실험도 같은 순서로 재므로, 여기서 순서를 손에 익혀 둔다. 요청마다 찍히는 로그가 측정을 흔들지 않게 `LOG_LEVEL=warn`으로 띄운다. 그러면 시작 로그(`Nest application successfully started`)도 info 수준이라 찍히지 않는다. 빌드는 몇 초면 끝나고, 그 뒤 터미널이 조용한 것은 API가 떠서 요청을 기다리는 상태다. 멈춘 것으로 보고 끄지 말고 `/health/ready`로 확인한다.

k6 컨테이너는 이 PC에서 띄운 API에 `host.docker.internal`로 붙는다. Docker Desktop(macOS)에서는 저절로 있는 이름이고, `--add-host=…:host-gateway`는 Linux에서도 같게 해 준다. 요청 수 제한이 켜져 있으면 이 20명이 모두 한 IP로 세어진다(1장 작업 4에서 꺼짐을 확인했다).

```sh
# order-api-nest에서
npx prisma db seed
docker compose -f ../compose.yaml exec -T db psql -q -U order -d order_api < loadtest/load-seed.sql
# 출력
 products | total_stock 
----------+-------------
       66 |    51000560

# 터미널 2에서 다시 띄운다. warn 수준이라 다 떠도 아무것도 찍히지 않는다
npm run build && LOG_LEVEL=warn STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js

# 터미널 3. 떴는지는 상태 확인 경로로 본다
curl -s localhost:4000/health/ready
# {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}

docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e API=http://host.docker.internal:4000 -e HOT=0 /scripts/checkout.js
# 출력(줄임)
#     http_req_duration{name:checkout}
#     ✓ 'p(95)<200' p(95)=71.13ms
#     checks_succeeded...: 100.00% 8897 out of 8897
#     http_reqs......................: 8899   442.992705/s
curl -s localhost:4000/metrics | grep checkout_retries
# 출력 없음
```

성공한 결제는 k6의 `checks_succeeded`(201을 받은 수)다. 흩어진 부하에서는 9천 건 가까운 결제가 하나도 실패하지 않았다. `grep checkout_retries`가 아무것도 찍지 않는 것은 이 코드에 재시도가 없어서다(8장 낙관적 실험에서 생긴다). k6가 끝에 `thresholds … have been crossed`로 실패를 알리면 [`08`](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp)에서 정한 목표(p95 200ms, 실패 1% 미만)를 넘었다는 뜻이다. 여기서는 숫자만 모은다.

`HOT=1`도 시드부터 같은 순서로 잰다. 두 결과는 8장 "개념 | 세 방식의 결과"의 표에서 비관적 두 줄이 된다.

> 7장까지의 작업을 여기서 모두 커밋해 둔다. 8장은 실험만으로 이어지고, 끝의 원복이 `src`를 마지막 커밋으로 되돌린다.

### 남길 것

- **찾아보면 되는 것**: `$queryRaw`의 `SELECT … FOR UPDATE`, k6의 `-e`·`checks_succeeded`, `host.docker.internal`과 `--add-host=…:host-gateway`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 비관적 잠금은 같은 행을 두고 다투는 결제를 줄 세워 하나씩 처리한다. 재고 10개에 정확히 10건이고, 흩어진 부하에서는 실패가 없다. 바꿀 방식은 이 기준선과 비교한다.

  - 동시성 실험의 장부는 시드 직후에만 맞는다. 지난 실험의 주문과 임시 계정의 견본 주문이 "팔린 수량"에 섞이지 않게 실험마다 시드부터 한다.

  - 부하 시나리오에 박아 둔 id는 시드가 바뀌면 조용히 다른 상품을 가리킨다. 이름이나 목록으로 찾게 한다.

- **에러 신호**:

  - `stampede.mjs`의 응답이 전부 `500` → API를 `STRIPE_SIMULATOR_URL=…` 없이 띄웠거나 시뮬레이터가 꺼져 있다. 세션을 못 만든 주문은 바로 취소되고 재고가 돌아온다

  - 남은 재고 + 팔린 수량이 처음 재고와 다르다 → 실험 전에 시드를 다시 넣었는지

  - `stampede.mjs`가 `응답별 개수: { '201': 50 }`인데 팔린 수량이 1 → 모든 요청이 같은 `Idempotency-Key`로 나가 멱등 재응답을 받았다. `idempotencyKey`가 `process.argv[4]`인지

  - `LOG_LEVEL=warn`으로 띄운 API 터미널이 빌드 뒤 아무것도 찍지 않는다 → 정상이다. 시작 로그도 info 수준이라 숨는다. `curl -s localhost:4000/health/ready`로 떴는지 본다

  - k6가 `dial tcp … connect: connection refused` → API가 떠 있는지, k6에 `-e API=http://host.docker.internal:4000`을 줬는지

  - 흩어진 부하인데 결제가 모두 400 → `setup`이 재고 남은 부하용 상품을 하나도 못 찾았다. 시드 뒤에 `load-seed.sql`을 넣었는지

  - 웹 e2e의 "재고보다 많이 담을 수 없다"가 시간 초과 → 실험이 키보드 재고를 0이나 1,000,000으로 바꿨다. `npx prisma db seed`

## 8. 7단계: 일부러 바꿔보기, 낙관적 잠금과 SERIALIZABLE

7장의 장면(동시 50건, k6 흩어짐·몰림)을 잠금만 바꿔 다시 한다. 이 장의 바꿔보기는 모두 `실험`이다. 실험 두 개는 이어서 쌓고, 사이에 커밋하지 않는다. 끝의 작업 1 `[원복]`이 한 번에 되돌리고, 남기는 것은 작업 2 `[커밋]`의 주석 한 줄뿐이다. 실험을 건너뛰어도 코드는 완성된다. 그때는 작업 1이 할 일 없이 지나간다.

시작 전에 `git status`가 깨끗한지 본다. 원복의 `git checkout -- src prisma/schema.prisma`는 커밋하지 않은 `src` 변경을 모두 지운다.

측정 결과만 보고는 어느 잠금을 쟀는지 알 수 없다. 재기 전에 지금 코드가 어느 방식인지 본다. 이것이 "실험을 적용했는지 보는 법"이다.

```sh
# order-api-nest에서
grep -n "FOR UPDATE\|Serializable\|version: product.version" src/orders/orders.service.ts
```

| 찍히는 줄 | 지금 방식 |
|---|---|
| `FOR UPDATE` | 비관적(실험을 적용하지 않았거나 원복했다) |
| `version: product.version`만 | 낙관적 |
| `Serializable` | `SERIALIZABLE` |

### 실험 | 일부러 바꿔보기, 낙관적 잠금

상품에 `version` 칸을 더하고, `placeOrder`는 잠그지 않고 읽는다. 차감할 때 "내가 읽은 `version` 그대로인가"를 조건에 넣고, 같이 `version`을 올린다. 바뀐 행이 0개면 그사이 누가 고친 것이다. 충돌하면 트랜잭션 전체를 처음부터 다시 한다. 앞에서 읽은 재고는 낡았기 때문이다. `placeOrReplay`의 `this.prisma.asUser(…)`를 `withRetry`로 감싼다. 재시도 간격은 시도마다 두 배로 늘리고 무작위로 흩뜨린다(0장 개념 7). 다섯 번까지 해 보고 안 되면 409로 돌려준다. 몇 번 다시 했는지는 지표 `checkout_retries_total`로 센다.

```diff
--- a/order-api-nest/prisma/schema.prisma
+++ b/order-api-nest/prisma/schema.prisma
@@
   name          String
   price         Int
   stock         Int
+  version       Int         @default(0)
   imageKey      String?     @map("image_key")
   items         OrderItem[]
   categoryId    Int?        @map("category_id")
--- a/order-api-nest/src/metrics/metrics.ts
+++ b/order-api-nest/src/metrics/metrics.ts
@@
   registers: [registry],
 });
 
+export const checkoutRetries = new Counter({
+  name: "checkout_retries_total",
+  help: "결제 트랜잭션을 처음부터 다시 한 횟수",
+  labelNames: ["reason"] as const,
+  registers: [registry],
+});
+
 export const rateLimited = new Counter({
   name: "http_rate_limited_total",
   help: "요청 수 제한으로 거절한 요청 수",
--- a/order-api-nest/src/orders/orders.service.ts
+++ b/order-api-nest/src/orders/orders.service.ts
@@
 import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";
 import { StripeGateway } from "../payments/stripe.gateway.js";
 import { afterOrder, encodeOrderCursor, orderListOrder, toPage, type Page } from "../pagination/cursor.js";
+import { checkoutRetries } from "../metrics/metrics.js";
+
+class VersionConflict extends Error {}
 
 export type Order = { id: number; user: string; price: number; paid: boolean; }
 export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };
@@
   private async placeOrReplay(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResult> {
     const requestHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
     try {
-      const result = await this.prisma.asUser(userId, async (tx) => {
+      const result = await this.withRetry(() => this.prisma.asUser(userId, async (tx) => {
         if (idempotencyKey) {
           await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash } });
         }
@@
           });
         }
         return placed;
-      });
+      }));
       this.logger.log(`주문 접수(결제 대기): #${result.id} (${result.user}) ${result.price}원`);
       return result;
     } catch (err) {
@@
     }
   }
 
+  // 충돌하면 트랜잭션 전체를 처음부터 다시 한다. 앞에서 읽은 재고가 낡았기 때문이다
+  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
+    for (let attempt = 1; ; attempt++) {
+      try {
+        return await fn();
+      } catch (err) {
+        const reason = err instanceof VersionConflict ? "version"
+          : err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034" ? "serialization" : null;
+        if (!reason) throw err;
+        if (attempt >= 5) throw new ConflictException("동시에 결제가 몰려 처리하지 못했다 - 다시 시도한다");
+        checkoutRetries.inc({ reason });
+        // 간격을 시도마다 두 배로 늘리고 무작위로 흩뜨린다. 같이 실패한 트랜잭션끼리 또 같이 부딪치지 않게
+        await new Promise((r) => setTimeout(r, Math.random() * 10 * 2 ** attempt));
+      }
+    }
+  }
+
   private async placeOrder(tx: Prisma.TransactionClient, userId: string, items: CheckoutItemDto[]): Promise<CheckoutResult> {
     const ids = [...new Set(items.map((i) => i.productId))];
-    const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
-      SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
+    // 잠그지 않고 읽는다. 대신 읽은 version을 기억한다
+    const products = await tx.product.findMany({
+      where: { id: { in: ids } }, select: { id: true, name: true, price: true, stock: true, version: true }, orderBy: { id: "asc" },
+    });
     let total = 0;
     for (const item of items) {
       const product = products.find((p) => p.id === item.productId);
       if (!product) throw new NotFoundException(`product ${item.productId} not found`);
       if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
-      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
+      // 내가 읽은 version 그대로일 때만 차감하고 version을 올린다. 0행이면 그사이 누가 고쳤다
+      const { count } = await tx.product.updateMany({
+        where: { id: product.id, version: product.version },
+        data: { stock: { decrement: item.quantity }, version: { increment: 1 } },
+      });
+      if (count === 0) throw new VersionConflict();
       total += product.price * item.quantity;
     }
     const order = await tx.order.create({
```

마이그레이션 뒤에 클라이언트를 다시 만든다. Prisma 7의 `migrate dev`는 클라이언트를 만들지 않는다. 이 마이그레이션은 작업 1의 원복에서 지우므로 번호로 바꾸지 않는다.

```sh
npx prisma migrate dev --name product_version
npx prisma generate
```

API를 다시 빌드해 띄우고(터미널 2) 같은 실험을 한다.

```sh
npx prisma db seed
node scripts/stampede.mjs 50 '[{"productId":5,"quantity":1}]'
curl -s localhost:4000/metrics | grep checkout_retries
# 출력(줄임)
# 응답별 개수: { '201': 10, '409 재고 부족: 한정판 키보드': 40 }
# │ 0       │ 5  │ '한정판 키보드' │ 0         │ 10        │
# checkout_retries_total{reason="version"} 78
```

`grep`은 `^`을 붙이지 않는다. prom-client의 라벨 달린 카운터는 한 번도 올라가지 않으면 값 줄이 없고 `# HELP`·`# TYPE` 두 줄만 있다. `^checkout_retries`로 거르면 "재시도 0번"과 "이 지표가 코드에 없다"가 똑같이 빈 출력이 된다.

| `grep checkout_retries` 출력 | 뜻 |
|---|---|
| 아무것도 없다 | 지표가 없다. 지금 코드는 비관적 잠금이다(실험을 적용하지 않았거나 원복했다) |
| `# HELP`·`# TYPE` 두 줄뿐 | 지표는 있고 아직 한 번도 다시 하지 않았다 |
| `checkout_retries_total{reason="…"} N` | N번 다시 했다 |

결과는 같다. 다만 50건을 처리하는 동안 78번을 처음부터 다시 했다. 비관적 잠금이 "기다림"으로 낸 비용을 낙관적 잠금은 "다시 하기"로 낸다.

같은 코드로 부하도 건다. 7장 작업 3과 같은 순서(시드 → 부하용 상품 → API 다시 빌드·실행 → k6 `HOT=0`, `HOT=1` → `grep checkout_retries`)로 재고, 결과는 아래 "개념 | 세 방식의 결과"의 표에 모은다.

### 실험 | 일부러 바꿔보기, SERIALIZABLE

확인을 DB에 맡긴다. 재고는 잠그지 않고 읽고 그냥 차감한다(낙관적 실험에서 `version` 조건만 뺀 모양). 대신 트랜잭션을 `SERIALIZABLE`로 연다. `asUser`가 `$transaction`의 옵션을 받게 한다. 아래 diff는 낙관적 실험을 마친 모양에서 시작한다.

```diff
--- a/order-api-nest/src/orders/orders.service.ts
+++ b/order-api-nest/src/orders/orders.service.ts
@@
           });
         }
         return placed;
-      }));
+      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
       this.logger.log(`주문 접수(결제 대기): #${result.id} (${result.user}) ${result.price}원`);
       return result;
     } catch (err) {
@@
       const product = products.find((p) => p.id === item.productId);
       if (!product) throw new NotFoundException(`product ${item.productId} not found`);
       if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
-      // 내가 읽은 version 그대로일 때만 차감하고 version을 올린다. 0행이면 그사이 누가 고쳤다
-      const { count } = await tx.product.updateMany({
-        where: { id: product.id, version: product.version },
-        data: { stock: { decrement: item.quantity }, version: { increment: 1 } },
-      });
-      if (count === 0) throw new VersionConflict();
+      // 확인은 DB가 한다. 겹치면 PostgreSQL이 40001로 실패시키고 Prisma가 P2034로 던진다 → withRetry가 다시 한다
+      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
       total += product.price * item.quantity;
     }
     const order = await tx.order.create({
--- a/order-api-nest/src/prisma/prisma.service.ts
+++ b/order-api-nest/src/prisma/prisma.service.ts
@@
     });
   }
 
-  asUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
+  asUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
     return this.$transaction(async (tx) => {
       await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
       return fn(tx);
-    });
+    }, options);
   }
 
   asAdmin<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
```

겹친 트랜잭션은 PostgreSQL이 `40001`로 실패시키고, Prisma는 `P2034`로 감싸 던진다. `withRetry`가 그것을 다시 한다. `VersionConflict`는 이제 던지는 곳이 없지만 작업 1의 원복에서 함께 사라지므로 그대로 둔다.

```sh
# 출력(줄임)
# 응답별 개수: { '201': 10, '409 재고 부족: 한정판 키보드': 40 }
# │ 0       │ 5  │ '한정판 키보드' │ 0         │ 10        │
# checkout_retries_total{reason="serialization"} 85
```

세 방식 모두 재고 10개에 정확히 10건이다. **정합성은 셋 다 지킨다. 다른 것은 비용을 무엇으로 내느냐다.** 그 비용은 부하를 걸어야 보인다. 7장 작업 3과 같은 순서로 k6를 건다.


```sh
docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e API=http://host.docker.internal:4000 -e HOT=0 /scripts/checkout.js
curl -s localhost:4000/metrics | grep checkout_retries
# 출력(줄임)
# checks_succeeded...: 64.70% 3655 out of 5649
# checkout_retries_total{reason="serialization"} 8004
```


SERIALIZABLE은 흩어진 부하에서도 성공률이 64.7%다. 같은 조건을 네 번 더 돌린다.

```sh
# 출력(SERIALIZABLE, 흩어진 부하, 네 번)
# checks_succeeded...: 46.56% 2176 out of 4674  … checkout_retries_total{reason="serialization"} 9862
# checks_succeeded...: 98.85% 7132 out of 7215  … checkout_retries_total{reason="serialization"} 794
# checks_succeeded...: 72.78% 4247 out of 5835  … checkout_retries_total{reason="serialization"} 6735
# checks_succeeded...: 99.14% 7980 out of 8049  … checkout_retries_total{reason="serialization"} 749
```

두 번은 재시도 800번 안팎에 99%, 두 번은 재시도가 수천 번으로 불어나 46~73%다. 같은 조건에서 결과가 둘로 갈린다.

실패 사유는 DB 로그에 있다. 잘 된 판 하나의 20초를 세면 이렇다.

```sh
docker compose -f ../compose.yaml logs db --since <시작 시각> 2>&1 | grep ERROR | sed -E 's/.*ERROR: +//' | sort | uniq -c
# 출력
#     808 could not serialize access due to concurrent update
#     133 could not serialize access due to read/write dependencies among transactions
```

`<시작 시각>`에는 k6를 시작한 시각(`2026-02-04T10:00:00`처럼)을 넣는다. 첫째 줄은 같은 상품을 동시에 고친 경우다. 낙관적 잠금의 충돌과 같다. 둘째 줄이 SERIALIZABLE에만 있다. 서로 다른 상품을 산 두 결제도 "서로가 읽은 것을 고쳤다"고 판단되면 하나가 실패한다. 부하 중에 다른 터미널에서 `pg_locks`를 보면 PostgreSQL이 읽은 것을 어디에 기록하는지 보인다.

```sh
docker compose -f ../compose.yaml exec -T db psql -U order -d order_api -c "SELECT locktype, relation::regclass AS rel, page, tuple, count(*) FROM pg_locks WHERE mode='SIReadLock' GROUP BY 1,2,3,4 ORDER BY count(*) DESC"
# 출력
#  locktype |       rel        | page | tuple | count
# ----------+------------------+------+-------+-------
#  page     | products_pkey    |    1 |       |     9
#  page     | orders_pkey      |    5 |       |     6
#  page     | users_pkey       |    1 |       |     6
#  tuple    | users            |    0 |     1 |     6
#  page     | order_items_pkey |    2 |       |     4
#  tuple    | products         |    0 |    78 |     1
```

`SIReadLock`이 "이 트랜잭션이 읽은 범위"의 기록이다. 상품 인덱스는 행이 아니라 페이지(`page 1`) 단위로 기록됐다. 상품 수십 개가 인덱스 한 페이지에 다 들어 있으므로, 부하용 상품 하나를 읽은 결제와 다른 부하용 상품을 고친 결제도 같은 페이지에서 만난다. 이렇게 넓게 기록한 판정은 진짜 충돌이 아닌 것도 충돌로 본다. 실패가 늘면 재시도가 늘고, 재시도가 겹치면 또 실패한다.

> SERIALIZABLE은 여러 행에 걸친 규칙(0장 개념 7의 Write Skew)을 잠금 없이 지키는 도구다. 행 하나의 숫자를 줄이는 일에는 맞지 않는다.

### 작업 1. [원복] 두 실험을 되돌린다

두 실험의 코드를 되돌리고, `version` 칸과 그 마이그레이션 기록을 지운다. 마이그레이션 폴더는 커밋하지 않았으므로 지우면 된다. DB에는 칸과 기록이 남아 있으므로 SQL로 지운다. 실험을 건너뛰었다면 아래 명령은 바꿀 것이 없어 그냥 지나간다(`IF EXISTS`, `find … -exec`).

```sh
# order-api-nest에서
git checkout -- src prisma/schema.prisma
find prisma/migrations -maxdepth 1 -name '*_product_version' -exec rm -r {} +
docker compose -f ../compose.yaml exec -T db psql -U order -d order_api -c "ALTER TABLE products DROP COLUMN IF EXISTS version" -c "DELETE FROM _prisma_migrations WHERE migration_name LIKE '%_product_version'"
npx prisma generate && npx prisma migrate status
# 출력(끝 줄)
# Database schema is up to date!
```

`orders.service.ts`에 `FOR UPDATE`가 다시 보이면 원복된 것이다(아래 "실험을 적용했는지 보는 법"의 표).

### 개념 | 세 방식의 결과

7장 작업 3의 비관적 두 줄과 두 실험의 네 줄을 모으면 이렇다.

| 방식 | 부하 | 요청/초 | 성공한 결제(20초) | p95 | 재시도 |
|---|---|---|---|---|---|
| 비관적(`FOR UPDATE`) | 50개에 흩어짐 | 443.0 | 8,897 (100%) | 71ms | 0 |
| 비관적(`FOR UPDATE`) | 하나에 몰림 | 254.2 | 5,129 (100%) | 243ms | 0 |
| 낙관적(`version`) | 50개에 흩어짐 | 425.1 | 8,554 (100%) | 85ms | 824 |
| 낙관적(`version`) | 하나에 몰림 | 248.2 | 2,782 (55.4%) | 188ms | 13,928 |
| `SERIALIZABLE` | 50개에 흩어짐 | 278.7 | 3,655 (64.7%) | 193ms | 8,004 |
| `SERIALIZABLE` | 하나에 몰림 | 225.3 | 2,351 (51.6%) | 196ms | 12,816 |

같은 조건으로 두 번씩 돌려 두 번째 결과를 적었다. 낙관적·비관적은 세 번씩 더 돌려도 흩어진 부하에서 모두 100%였다.

### 개념 | 흩어진 부하에서는 비관적과 낙관적이 같다

20명이 상품 50개 중 하나를 고르면, 같은 순간 같은 상품을 고른 사람이 가끔 있다. 비관적 잠금에서는 그 사람이 잠깐 기다리고, 낙관적 잠금에서는 다시 한다(824번). 둘 다 드물어서 처리량이 같다.

### 개념 | 하나에 몰리면 낙관적 잠금이 반을 놓친다

비관적 잠금은 상품 5의 행 잠금 앞에 줄을 세운다. 한 번에 한 트랜잭션씩이라 처리량이 흩어졌을 때의 절반으로 떨어지고 p95가 243ms로 늘지만, 줄을 선 결제는 모두 받는다.

낙관적 잠금은 줄을 세우지 않는다. 20명이 동시에 읽고 동시에 차감하면 그중 하나만 이긴다. 진 19명은 다시 하고, 다시 붙고, 또 하나만 이긴다. 13,928번을 다시 했고, 다섯 번을 다 쓴 결제는 409로 돌아갔다. 결제 5,023건 중 2,241건이다. 재고가 넉넉한데도 "다시 시도해 달라"는 답을 받은 것이다.

### 개념 | 고르기: 비관적 잠금을 남긴다

- 흩어진 부하에서 낙관적 잠금과 처리량이 같고 p95는 더 짧다
- 인기 상품에 몰릴 때 모든 결제를 받는 것은 비관적 잠금뿐이다. 선착순 한정판이 이 서비스의 시드 상품 5번이다
- 재시도 코드, `version` 칸, 재시도를 다 썼을 때의 409 안내가 필요 없다

낙관적 잠금이 맞는 곳은 따로 있다. 충돌이 드물고, 읽기와 쓰기 사이가 긴 곳이다. 관리자가 상품 수정 화면을 열어 두고 몇 분 뒤에 저장하는 경우가 그렇다. 그동안 행을 잠가 둘 수는 없으므로, 화면을 열 때 읽은 `version`을 저장할 때 확인한다. 다만 같은 관리자 화면이라도 재고 입고는 결과가 아니라 변화를 보내는 편이 낫다. 9장에서 다룬다.

### 작업 2. [커밋] 고른 이유를 주석으로 남긴다

`placeOrder`의 `FOR UPDATE` 위에 고른 이유를 남긴다. 나중에 "잠금이 느리니 낙관적으로 바꾸자"는 개선이 이 측정을 모르고 되돌리지 않게 한다.

```diff
--- a/order-api-nest/src/orders/orders.service.ts
+++ b/order-api-nest/src/orders/orders.service.ts
@@
 
   private async placeOrder(tx: Prisma.TransactionClient, userId: string, items: CheckoutItemDto[]): Promise<CheckoutResult> {
     const ids = [...new Set(items.map((i) => i.productId))];
+    // 비관적 잠금(FOR UPDATE)을 남긴다. 낙관적 잠금(version)과 SERIALIZABLE을 k6로 비교했다(22 가이드 8장)
+    // 흩어진 부하에서는 낙관적과 처리량이 같았고, 한 상품에 몰리면 이 방식만 모든 결제를 받았다. 재시도 코드도 필요 없다
     const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
       SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
     let total = 0;
```

### 용어 | PostgreSQL·Prisma (직렬화 실패)

- `40001` / `P2034`: 직렬화 실패. PostgreSQL의 SQLSTATE / Prisma가 감싼 코드. 교착 상태(`40P01`)도 `P2034`로 온다
- `SIReadLock`: SERIALIZABLE 트랜잭션이 읽은 범위의 기록. 기다리게 하지 않고, 충돌 판정에만 쓴다
- `could not serialize access due to concurrent update`: 내가 읽은 뒤 다른 트랜잭션이 고친 행을 내가 고치려 했다
- `… read/write dependencies among transactions`: 트랜잭션들이 서로가 읽은 것을 고쳐 어느 순서로도 설명되지 않는다
- `$transaction(fn, { isolationLevel })`: 그 트랜잭션만 격리 수준을 바꾼다

### 남길 것

- **찾아보면 되는 것**: `updateMany`가 돌려주는 `count`, `$transaction`의 `isolationLevel`, `P2034`, `pg_locks`에서 `SIReadLock`을 세는 쿼리, DB 로그를 사유별로 세는 `sort | uniq -c`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 세 잠금 모두 재고 10개에 정확히 10건이다. 정합성은 셋 다 지킨다. 다른 것은 비용을 기다림으로 내는지, 다시 하기로 내는지다.

  - 한 행에 몰리면 낙관적 잠금은 재시도가 불어나 절반을 놓친다. 비관적 잠금은 줄을 세워 느려지지만 모두 받는다. 행 하나의 숫자를 줄이는 일에는 비관적 잠금이다.

  - 낙관적 잠금과 `SERIALIZABLE`은 다시 하는 코드를 앱이 가져야 한다. 낡은 값을 읽었으므로 트랜잭션 전체를 처음부터 다시 한다.

  - `SERIALIZABLE`은 읽은 범위를 넓게(페이지 단위로) 기록해 서로 다른 행을 고친 트랜잭션도 실패시킨다. 같은 조건에서도 결과가 둘로 갈린다.

  - 바꿔 보는 코드는 실험으로 묶고, 실험과 원복 사이에 커밋을 두지 않는다. 그 사이의 커밋은 실험 코드를 같이 담거나 원복을 어긋나게 한다.

- **에러 신호**:

  - `PrismaClientValidationError`에 더한 칸(`version`)이 없다 → `migrate dev` 뒤에 `npx prisma generate`와 `npm run build`를 했는지

  - 재고가 넉넉한데 409 `동시에 결제가 몰려 처리하지 못했다 - 다시 시도한다` → 재시도 다섯 번을 다 썼다. `checkout_retries_total`

  - DB 로그 `could not serialize access due to concurrent update` → 같은 행을 동시에 고쳤다

  - DB 로그 `could not serialize access due to read/write dependencies among transactions` → 읽은 범위가 겹쳤다. `pg_locks`의 `SIReadLock`

  - 실험 중인데 `grep checkout_retries`가 아무것도 찍지 않는다 → 재시도 지표가 코드에 없다. 실험을 적용했는지 위 "실험을 적용했는지 보는 법"으로 본다

## 9. 8단계: 관리자의 재고 입고를 증가량으로 받는다

7·8장은 결제끼리의 경쟁이었다. 재고를 바꾸는 쪽은 결제만이 아니다. 관리자가 입고를 반영하고, 결제 기한이 지난 주문은 재고를 돌려준다. 지금 코드에서 재고를 바꾸는 곳은 셋이고, 모두 "지금 값에서 얼마"로 쓴다.

| 쓰는 곳 | 코드 | 모양 |
|---|---|---|
| 결제 | `orders.service.ts`의 `placeOrder` | `FOR UPDATE`로 읽고 `stock: { decrement }` |
| 결제 취소·기한 만료 | `payments/cancel-unpaid-order.ts` | `stock: { increment }` |
| 임시 계정 정리(`21`) | `auth/demo-user.ts`의 `deleteUsers` → 위의 취소 | `stock: { increment }` |

관리자 화면에는 아직 재고를 바꾸는 길이 없다. 여기에 "재고를 50으로"를 받는 API를 만들면 넷 중 하나만 결과를 덮어쓴다. 0장 개념 8의 문제다. 먼저 재현하고, 증가량을 받는 API로 고친다.

### 개념 | "재고 = 50"은 그사이 팔린 수량을 지운다

관리자의 한 번의 입고는 요청 둘에 걸친다. 상품 관리 화면을 여는 GET과, 몇 분 뒤 저장하는 요청이다. 그사이의 결제는 관리자가 본 값에 들어 있지 않다.

| 시각 | 관리자 | 결제(lee) | DB의 재고 |
|---|---|---|---|
| t0 | 화면을 연다. 재고 10을 본다 | | 10 |
| t1 | 입고 수량을 입력하는 중 | 5건 결제(`FOR UPDATE`) | 5 |
| t2 | "입고 40개" → 10 + 40 = 50을 저장 | | **50** (맞는 값은 45. 5건이 장부에서 사라졌다) |

결제가 `FOR UPDATE`로 행을 잠가도 소용없다. 그 잠금은 결제 트랜잭션이 끝나면 풀리고, 관리자의 저장은 그 뒤에 온다. 관리자는 잠금을 피한 것이 아니라 낡은 값으로 계산했다. 이것은 Lost Update가 요청 두 개에 걸쳐 일어난 것이다.

고치는 길은 둘이다(0장 개념 8).

| 방법 | 관리자가 보내는 것 | 그사이 결제가 있으면 |
|---|---|---|
| 낙관적 잠금 | `{ stock: 50, version: 7 }` | 409. 관리자가 새 값을 보고 다시 계산한다 |
| 증가량 | `{ delta: 40 }` | DB가 지금 값(5)에 40을 더해 45 |

입고에서 관리자가 아는 사실은 "40개가 들어왔다"다. "50개여야 한다"는 그 사실에 낡은 값을 더한 계산이다. 그래서 사실을 그대로 보내는 증가량이 맞다. 몇 개가 남아야 하는지 직접 정하는 일(재고 실사)이라면 그때는 낙관적 잠금으로 "내가 본 값 그대로일 때만"을 건다. 이 문서는 입고와 파손·분실 정리(음수)만 다룬다.

### 작업 1. [커밋] 입고와 결제를 겹쳐 보는 restock-race.mjs

`scripts/restock-race.mjs`는 관리자 kim과 손님 lee로 로그인한다. 상품 5의 재고를 10으로 맞추고, 관리자가 화면을 연 것처럼 상품 목록을 읽은 뒤, 결제 5건을 동시에 보내고, 관리자가 입고 40개를 저장한다. 끝에 DB의 재고를 "10 - 판 수량 + 40"과 맞춰 본다. 결제는 시뮬레이터로 가야 하므로 1장 작업 3의 터미널 1·2가 떠 있어야 한다.

```js
// order-api-nest/scripts/restock-race.mjs
// 관리자가 재고 화면을 본 뒤 입고를 저장하기 전에 결제가 들어온다. 숫자로 덮어쓰는 입고는 그 판매를 지운다
//   node scripts/restock-race.mjs set      PUT  /products/5/stock { stock }   (9장 실험에만 있는 경로)
//   node scripts/restock-race.mjs delta    POST /products/5/stock-adjustments { delta }
//   셋째 인자 together: 관리자의 저장을 결제와 같은 순간에 보낸다(set은 판마다 결과가 달라진다)
import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";
const MODE = process.argv[2] ?? "delta";
const TOGETHER = process.argv[3] === "together";
const PRODUCT = 5; // 한정판 키보드
const START = 10;
const BUYERS = 5;
const RESTOCK = 40;

const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();
await db.query("UPDATE products SET stock = $1 WHERE id = $2", [START, PRODUCT]); // 판마다 같은 자리에서 시작한다

async function login(id) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password: process.env.DEMO_PASSWORD }),
  });
  return (await res.json()).accessToken;
}
const admin = await login("kim"); // 관리자
const buyer = await login("lee");
const headers = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

// ① 관리자가 상품 관리 화면을 연다. 이때 본 재고가 관리자가 아는 마지막 값이다
const { items } = await (await fetch(`${API}/products?limit=100`)).json();
const seen = items.find((p) => p.id === PRODUCT).stock;
console.log(`관리자가 본 재고: ${seen}`);

// ② 관리자가 "입고 40개"를 입력하는 사이에 결제 5건이 들어온다
const checkout = () =>
  fetch(`${API}/orders/checkout`, { method: "POST", headers: headers(buyer), body: JSON.stringify({ items: [{ productId: PRODUCT, quantity: 1 }] }) })
    .then((r) => r.status);
// ③ 관리자가 저장한다. set은 "본 재고 + 40"이라는 결과를, delta는 "40을 더하라"는 변화를 보낸다
const restock = () =>
  MODE === "set"
    ? fetch(`${API}/products/${PRODUCT}/stock`, { method: "PUT", headers: headers(admin), body: JSON.stringify({ stock: seen + RESTOCK }) })
    : fetch(`${API}/products/${PRODUCT}/stock-adjustments`, { method: "POST", headers: headers(admin), body: JSON.stringify({ delta: RESTOCK }) });

let statuses;
let saved;
if (TOGETHER) {
  [saved, ...statuses] = await Promise.all([restock(), ...Array.from({ length: BUYERS }, checkout)]);
} else {
  statuses = await Promise.all(Array.from({ length: BUYERS }, checkout));
  saved = await restock();
}
console.log(`결제 응답: ${statuses.join(", ")} / 관리자 저장(${MODE}): ${saved.status}`);

const sold = statuses.filter((s) => s === 201).length;
const { rows } = await db.query("SELECT stock FROM products WHERE id = $1", [PRODUCT]);
const expected = START - sold + RESTOCK;
const actual = rows[0].stock;
console.log(`맞는 재고 ${START} - ${sold} + ${RESTOCK} = ${expected}, 실제 재고 ${actual}${actual === expected ? "" : ` → ${actual - expected}개가 장부 없이 생겼다`}`);
await db.end();
```

`set` 모드가 부르는 `PUT /products/5/stock`은 아래 실험에서만 잠깐 만든다. 남기는 경로는 `delta` 모드의 `POST /products/5/stock-adjustments`다.

### 실험 | 일부러 깨뜨려보기 ③, 재고를 숫자로 덮어쓴다

관리자가 화면에서 계산한 결과를 받는 API를 만든다. 재고를 바꾸는 관리자 경로이므로 `AdminGuard` 뒤에 둔다.

```ts
// order-api-nest/src/products/product-stock.controller.ts
import { Body, Controller, Param, ParseIntPipe, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminGuard } from "../auth/admin.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("products/:id")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductStockController {
  constructor(private readonly prisma: PrismaService) {}

  // 실험: 관리자가 화면에서 계산한 "결과"를 그대로 덮어쓴다
  @Put("stock")
  setStock(@Param("id", ParseIntPipe) id: number, @Body("stock", ParseIntPipe) stock: number) {
    return this.prisma.product.update({ where: { id }, data: { stock }, select: { id: true, stock: true } });
  }
}
```

```diff
--- a/order-api-nest/src/products/products.module.ts
+++ b/order-api-nest/src/products/products.module.ts
@@
 import { Module } from "@nestjs/common";
 import { ProductsController } from "./products.controller.js";
 import { ProductImagesController } from './product-images.controller.js';
+import { ProductStockController } from "./product-stock.controller.js";
 
-@Module({ controllers: [ProductsController, ProductImagesController] })
+@Module({ controllers: [ProductsController, ProductImagesController, ProductStockController] })
 export class ProductsModule {}
```

API를 다시 빌드해 띄우고(터미널 2) 돌린다.

```sh
# order-api-nest에서
node scripts/restock-race.mjs set
# 출력
# 관리자가 본 재고: 10
# 결제 응답: 201, 201, 201, 201, 201 / 관리자 저장(set): 200
# 맞는 재고 10 - 5 + 40 = 45, 실제 재고 50 → 5개가 장부 없이 생겼다

node scripts/restock-race.mjs set together
# 출력(판마다 다르다)
# 관리자가 본 재고: 10
# 결제 응답: 201, 201, 201, 201, 201 / 관리자 저장(set): 200
# 맞는 재고 10 - 5 + 40 = 45, 실제 재고 47 → 2개가 장부 없이 생겼다
```

첫 판은 관리자가 결제가 다 끝난 뒤 저장한 경우다. 판 5개가 그대로 되살아났다. 실제 서비스에서 관리자가 화면을 열어 두고 몇 분 뒤에 저장하면 이 모양이다.

`together`는 저장을 결제와 같은 순간에 보낸다. `UPDATE`는 결제가 `FOR UPDATE`로 쥔 행을 기다렸다가 쓰므로, 저장보다 먼저 끝난 결제만큼 사라진다. 몇 건이 먼저 끝나는지는 판마다 다르다. 결과가 들쭉날쭉하다는 것은 테스트 한 번으로는 이 문제가 잡히지 않는다는 뜻이다.

### 작업 2. [커밋] 증가량을 받는 API

변화를 DTO로 받는다. 0은 할 일이 없고, 한 번에 움직일 수 있는 양에는 상한을 둔다.

```ts
// order-api-nest/src/products/stock-adjustment.dto.ts
import { IsInt, Max, Min, NotEquals } from "class-validator";

export class StockAdjustmentDto {
  // 입고는 양수, 파손·분실 정리는 음수. 결과(몇 개가 되어야 하나)가 아니라 변화(몇 개가 늘고 주나)를 받는다
  @IsInt() @NotEquals(0) @Min(-100000) @Max(100000) delta!: number;
}
```

상한을 `100_000`이 아니라 `100000`으로 쓴 데는 이유가 있다. 10장의 Swagger 플러그인이 숫자 구분자를 만나면 이 DTO의 칸을 문서에서 통째로 빠뜨린다(10장 작업 3).

`product-stock.controller.ts`를 아래 내용으로 만든다. 실험을 했다면 실험 파일을 통째로 바꾼다. PUT 경로가 사라지는 것이 이 실험의 원복이다. 계산을 앱에서 하지 않고 SQL 한 문장에 맡긴다.

```ts
// order-api-nest/src/products/product-stock.controller.ts
import { Body, ConflictException, Controller, HttpCode, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminGuard } from "../auth/admin.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StockAdjustmentDto } from "./stock-adjustment.dto.js";

// 재고를 바꾸는 관리자 경로. AdminGuard가 데모 관리자(demo_admin)를 403으로 막는다
@Controller("products/:id")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductStockController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("stock-adjustments")
  @HttpCode(200) // 조정 기록을 따로 남기지 않는다. 만든 것이 없으므로 201이 아니다
  async adjust(@Param("id", ParseIntPipe) id: number, @Body() dto: StockAdjustmentDto) {
    // 읽고 계산해서 쓰지 않는다. "지금 값 + delta"를 DB가 문장 하나로 계산한다
    // 결제가 FOR UPDATE로 이 행을 쥐고 있으면 기다렸다가, 결제가 끝난 뒤의 값으로 WHERE를 다시 확인한다 → 음수가 되지 않는다
    const rows = await this.prisma.$queryRaw<{ id: number; stock: number }[]>`
      UPDATE products SET stock = stock + ${dto.delta}
      WHERE id = ${id} AND stock + ${dto.delta} >= 0
      RETURNING id, stock`;
    if (rows[0]) return rows[0];
    // 0행: 상품이 없거나, 빼려는 수량이 지금 재고보다 많다
    const product = await this.prisma.product.findUnique({ where: { id }, select: { stock: true } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    throw new ConflictException(`재고가 ${product.stock}개라 ${-dto.delta}개를 뺄 수 없습니다`);
  }
}
```

모듈 등록은 실험에서 한 것과 같다. 실험을 건너뛰었다면 지금 넣는다.

```diff
--- a/order-api-nest/src/products/products.module.ts
+++ b/order-api-nest/src/products/products.module.ts
@@
 import { Module } from "@nestjs/common";
 import { ProductsController } from "./products.controller.js";
 import { ProductImagesController } from './product-images.controller.js';
+import { ProductStockController } from "./product-stock.controller.js";
 
-@Module({ controllers: [ProductsController, ProductImagesController] })
+@Module({ controllers: [ProductsController, ProductImagesController, ProductStockController] })
 export class ProductsModule {}
```

이 한 문장이 하는 일은 셋이다.

- **원자적으로 더한다.** `stock = stock + 40`은 DB가 그 순간의 값을 읽어 더한다. 앱이 읽고 계산해서 쓰는 틈이 없다.
- **음수를 막는다.** `stock + delta >= 0`이 아니면 바꾸지 않는다. 결제가 `FOR UPDATE`로 그 행을 쥐고 있으면 `UPDATE`는 기다렸다가, 결제가 끝난 뒤의 새 값으로 `WHERE`를 다시 확인한다(PostgreSQL의 `READ COMMITTED`). 그래서 "확인할 때는 5개였는데 빼고 나니 -3개"가 생기지 않는다.
- **결과를 돌려준다.** `RETURNING`으로 바뀐 재고를 같은 문장에서 받는다. 화면은 이 값으로 한 줄을 고친다(작업 4).

0행이 나오면 상품이 없거나 뺄 수 없는 경우다. 둘을 가르려고 한 번 더 읽는다. 이 읽기는 메시지를 만들 뿐이라 그사이 값이 바뀌어도 장부는 틀리지 않는다.

`AdminGuard`가 앞에 있으므로 데모 관리자는 이 경로도 403(`데모 관리자는 볼 수만 있습니다`)이다. 공개 데모에서 방문자가 재고를 바꿀 수 없다.

새 경로는 다시 빌드해 띄운 API에만 있다. 터미널 2를 끄고 1장 작업 3의 명령으로 다시 띄운 뒤, 경로가 생겼는지 본다. 작업 4의 화면과 작업 5의 스크립트가 이 API를 부른다.

```sh
# 터미널 3(저장소 루트에서). T는 1장 작업 3에서 받은 kim의 토큰
curl -s -XPOST localhost:4000/products/6/stock-adjustments -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"delta":1}'
# 출력
# {"id":6,"stock":101}
curl -s -XPOST localhost:4000/products/6/stock-adjustments -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"delta":-1}'
# 출력
# {"id":6,"stock":100}
```

`{"message":"Cannot POST /products/6/stock-adjustments","error":"Not Found","statusCode":404}`가 나오면 예전 빌드가 떠 있는 것이다. `401`이면 토큰이 15분이 지나 만료된 것이므로 `T`를 다시 받는다.

### 작업 3. [커밋] 동시 조정과 데모 관리자를 테스트로 지킨다

`test/stock-adjustments.e2e-spec.ts`는 한꺼번에 보낸 조정이 하나도 빠지지 않는지, 뺄 때 음수가 되지 않는지를 본다. 재고 3에서 -1을 다섯 번 동시에 보내면 정확히 세 번만 성공해야 한다.

```ts
// order-api-nest/test/stock-adjustments.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { adminDb } from "./admin-db.js";

describe("POST /products/:id/stock-adjustments - 동시성 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    adminToken = app.get(JwtService, { strict: false }).sign({ sub: "kim", role: "admin" });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.product.create({ data: { name: "테스트 상품", price: 1000, stock: 3 } }); // id 1
  });

  afterAll(async () => {
    await app.close();
  });

  const adjust = (delta: unknown, productId = 1) =>
    fetch(`${baseUrl}/products/${productId}/stock-adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ delta }),
    });
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;

  it("+1 20번과 -1 2번을 한꺼번에 보내도 모두 반영된다: 3 + 20 - 2", async () => {
    const deltas = [...Array(20).fill(1), -1, -1];
    const statuses = await Promise.all(deltas.map((d) => adjust(d).then((r) => r.status)));
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(await stock()).toBe(21);
  });

  it("재고 3에서 -1을 한꺼번에 5번 보내면 3번만 성공하고 2번은 409다. 음수가 되지 않는다", async () => {
    const statuses = await Promise.all(Array.from({ length: 5 }, () => adjust(-1).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(await stock()).toBe(0);
  });

  it("delta가 0이거나 정수가 아니면 400, 없는 상품은 404", async () => {
    expect((await adjust(0)).status).toBe(400);
    expect((await adjust(1.5)).status).toBe(400);
    expect((await adjust("10")).status).toBe(400);
    expect((await adjust(1, 999)).status).toBe(404);
  });
});
```

데모 관리자가 막히는지는 `admin-only.e2e-spec.ts`의 목록에 한 줄을 더해 지킨다. 이 테스트는 목록의 경로마다 로그인 없이 401, 일반 사용자 403, 데모 관리자 403과 그 메시지를 본다.

```diff
--- a/order-api-nest/test/admin-only.e2e-spec.ts
+++ b/order-api-nest/test/admin-only.e2e-spec.ts
@@
   ["GET", "/users"], ["POST", "/users"],
   ["PATCH", "/categories/1"], ["DELETE", "/categories/1"],
   ["POST", "/products/1/image/upload-url"], ["POST", "/products/1/image/confirm"],
+  ["POST", "/products/1/stock-adjustments"],
 ] as const;
 
 describe("관리자 전용 API", () => {
```

```sh
# order-api-nest에서
npx vitest run --config ./vitest.config.e2e.ts test/stock-adjustments.e2e-spec.ts test/admin-only.e2e-spec.ts
# 출력(끝 줄)
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

### 작업 4. [커밋] 관리자 상품 화면에 입고 입력칸

상품 표의 줄마다 수량 입력칸과 "반영" 버튼을 둔다. 입고는 `40`, 파손 정리는 `-2`처럼 넣는다. 성공하면 서버가 돌려준 재고로 그 상품 한 줄만 고친다(6장의 `setQueryData`와 같은 방식).

```tsx
// order-console-next/app/admin/products/stock-adjuster.tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { productListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";

type Adjusted = { id: number; stock: number };

// 입고(+)와 파손·분실 정리(-)를 "몇 개 늘고 주나"로 보낸다. 화면에 보이는 재고는 이미 낡았을 수 있다
export function StockAdjuster({ productId, name, readOnly }: { productId: number; name: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState("");
  const value = Number(delta);
  const valid = delta !== "" && Number.isInteger(value) && value !== 0;

  const adjust = useMutation({
    mutationFn: (d: number) =>
      authFetch<Adjusted>(`/products/${productId}/stock-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: d }),
      }),
    onSuccess: ({ stock }) => {
      setDelta("");
      // 서버가 계산한 재고로 그 상품 한 줄만 고친다. 상품 목록 페이지를 다시 받지 않는다
      queryClient.setQueryData(productListOptions(trpc).queryKey, (old) => old && {
        ...old,
        pages: old.pages.map((page) => ({ ...page, items: page.items.map((p) => (p.id === productId ? { ...p, stock } : p)) })),
      });
    },
  });

  return (
    <form className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (valid && !adjust.isPending) adjust.mutate(value); }}>
      <label htmlFor={`stock-delta-${productId}`} className="sr-only">{name} 재고 조정 수량(입고는 +, 빼기는 -)</label>
      <input id={`stock-delta-${productId}`} type="number" step={1} inputMode="numeric" placeholder="+40"
        className="num w-20 border border-line px-2 py-1 text-sm" data-testid={`stock-delta-${productId}`}
        value={delta} onChange={(e) => setDelta(e.target.value)}
        disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      {/* 저장 중에는 aria-disabled로 막는다. disabled로 바꾸면 버튼에 있던 포커스가 문서 처음으로 간다(6장) */}
      <button type="submit" className="btn" disabled={readOnly} aria-disabled={adjust.isPending || !valid}>
        {adjust.isPending ? "반영 중…" : "반영"}
      </button>
      {adjust.error && <span role="alert" className="text-[0.82rem] text-danger" data-testid={`stock-error-${productId}`}>{adjust.error.message}</span>}
    </form>
  );
}
```

표에 열을 더하고, 데모 관리자에게 보이는 안내 문구에 재고 조정을 넣는다. 입력칸은 `readOnly`면 꺼지고 그 이유(`read-only-note`)를 가리킨다.

```diff
--- a/order-console-next/app/admin/products/page.tsx
+++ b/order-console-next/app/admin/products/page.tsx
@@
 import { useTRPC } from "@/lib/trpc";
 import { LoadMore } from "../../load-more";
 import { ProductImageUploader } from "./product-image-uploader";
+import { StockAdjuster } from "./stock-adjuster";
 
 const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
 
@@
           <th scope="col" className="label py-3 font-normal">상품</th>
           <th scope="col" className="label hidden py-3 font-normal sm:table-cell">가격</th>
           <th scope="col" className="label hidden py-3 font-normal sm:table-cell">재고</th>
+          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">입고·조정</th>
           <th scope="col" className="label py-3 font-normal">이미지</th>
         </tr>
       </thead>
@@
               </span>
             </td>
             <td className="num hidden py-3 sm:table-cell">{won(p.price)}</td>
-            <td className="num hidden py-3 sm:table-cell">{p.stock}</td>
+            <td className="num hidden py-3 sm:table-cell" data-testid={`admin-stock-${p.id}`}>{p.stock}</td>
+            <td className="hidden py-3 sm:table-cell"><StockAdjuster productId={p.id} name={p.name} readOnly={readOnly} /></td>
             <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} readOnly={readOnly} /></td>
           </tr>
         ))}
@@
       <>
         {profile.role === "demo_admin" ? (
           <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
-            데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기는 진짜 관리자만 할 수 있어 버튼을 꺼 두었습니다.
+            데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기와 재고 조정은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.
           </p>
         ) : (
           <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
```

웹 e2e는 둘이다. 데모 관리자에게 입력칸이 꺼져 있는지를 기존 테스트에 더하고, 관리자가 더하고 빼는 흐름을 새로 쓴다. 새 테스트는 끝에 재고를 시드 값으로 돌려 둔다. `shop.spec.ts`가 마우스 재고를 기준으로 비교하기 때문이다.

```diff
--- a/order-console-next/e2e/demo-login.spec.ts
+++ b/order-console-next/e2e/demo-login.spec.ts
@@
   await page.getByRole("link", { name: "관리" }).click();
   await expect(page.getByTestId("read-only-note")).toContainText("볼 수만 있습니다");
   await expect(page.getByTestId(/^image-input-/).first()).toBeDisabled();
+  await expect(page.getByTestId(/^stock-delta-/).first()).toBeDisabled();
 });
```

```ts
// order-console-next/e2e/stock-adjust.spec.ts
import { expect, test, type Page } from "@playwright/test";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("관리자는 입고 수량을 더하고 빼며, 재고보다 많이 빼면 이유가 보인다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin/products");
  const stock = page.getByTestId("admin-stock-6");
  await expect(stock).not.toHaveText("");
  const before = Number(await stock.textContent());
  const input = page.getByTestId("stock-delta-6");

  await input.fill("5");
  await input.press("Enter");
  await expect(stock).toHaveText(String(before + 5));

  await input.fill(String(-(before + 6))); // 지금 재고보다 하나 더 뺀다
  await input.press("Enter");
  await expect(page.getByTestId("stock-error-6")).toContainText("뺄 수 없습니다");
  await expect(stock).toHaveText(String(before + 5));

  await input.fill("-5"); // 시드 상태로 돌려 둔다. 다른 테스트가 마우스 재고에 기댄다
  await input.press("Enter");
  await expect(stock).toHaveText(String(before));
});
```

```sh
# 저장소 루트에서. API는 작업 2 뒤에 다시 빌드해 띄운 상태여야 한다. restock-race가 바꾼 키보드 재고는 시드로 되돌린다
cd order-api-nest && npx prisma db seed && cd ..
cd order-console-next && npx playwright test e2e/stock-adjust.spec.ts e2e/demo-login.spec.ts
# 출력(끝 줄)
  3 passed (8.1s)
```

### 작업 5. [확인] 같은 경쟁을 증가량으로 다시 돌린다

```sh
# order-api-nest에서
node scripts/restock-race.mjs delta
# 출력
관리자가 본 재고: 10
결제 응답: 201, 201, 201, 201, 201 / 관리자 저장(delta): 200
맞는 재고 10 - 5 + 40 = 45, 실제 재고 45

node scripts/restock-race.mjs delta together
# 출력
관리자가 본 재고: 10
결제 응답: 201, 201, 201, 201, 201 / 관리자 저장(delta): 200
맞는 재고 10 - 5 + 40 = 45, 실제 재고 45
```

증가량은 저장이 결제보다 먼저든 나중이든 45다. 이제 `set` 모드는 실험의 PUT이 없어져 404를 받는다. 실험을 다시 해 볼 때만 쓴다.

> 증가량은 같은 요청을 두 번 보내면 두 번 더한다. 응답을 못 받은 관리자가 다시 누르면 80개가 들어간다. 화면은 저장 중의 두 번째 누름을 무시하지만, 네트워크가 끊겨 다시 보낸 요청까지 막으려면 결제처럼 `Idempotency-Key`가 필요하다. 13장 "다루지 않은 것"에 남긴다.

### 용어 | SQL (조건부 UPDATE)

- `UPDATE … SET stock = stock + $1`: 지금 값을 기준으로 바꾼다. 앱이 읽은 값이 끼어들지 않는다
- `WHERE … AND stock + $1 >= 0`: 조건을 만족할 때만 바꾼다. 바뀐 행 수(0 또는 1)로 성공을 안다
- `RETURNING id, stock`: 바꾼 행의 새 값을 같은 문장에서 돌려받는다
- `READ COMMITTED`에서 잠긴 행을 만난 `UPDATE`: 잠금이 풀릴 때까지 기다린 뒤 새 값으로 `WHERE`를 다시 확인한다
- `` $queryRaw`…${값}…` ``: 태그 템플릿의 `${}`는 문자열로 이어 붙지 않고 SQL 매개변수(`$1`)로 넘어간다
- `@NotEquals(0)`: class-validator. 그 값이 아니어야 통과한다

### 남길 것

- **찾아보면 되는 것**: `UPDATE … RETURNING`, `$queryRaw`의 매개변수, `@HttpCode`, `@NotEquals`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 사람이 화면을 보고 저장하는 값은 늘 낡았다. 다른 쓰기(결제, 만료 취소)가 있는 칸은 결과(재고 = 50)가 아니라 변화(+40)로 받고, 계산은 DB가 한 문장으로 한다.

  - 행 잠금은 트랜잭션 안의 경쟁만 막는다. 요청 둘에 걸친 "읽고 → 사람이 계산하고 → 쓰기"는 잠금으로 막을 수 없다. 변화로 받거나 `version`으로 거절한다.

  - 조건부 `UPDATE`는 "확인"과 "쓰기"를 한 문장에 묶는다. 잠긴 행을 기다린 뒤 새 값으로 다시 확인하므로 음수가 생기지 않는다.

  - 동시성 버그는 판마다 결과가 다르다. 재현 스크립트는 겹치는 순서를 고정한 판(set)과 동시에 보낸 판(together)을 둘 다 둔다.

- **에러 신호**:

  - 입고 뒤 재고가 "본 재고 + 입고"와 같고, 그사이 결제가 있었다 → 결과로 덮어썼다. 증가량으로 받는지

  - 409 `재고가 3개라 5개를 뺄 수 없습니다` → 정상. 빼려는 수량이 지금 재고보다 많다

  - 403 `데모 관리자는 볼 수만 있습니다` → 데모 관리자로 조정했다. 시드의 kim으로 한다

  - 400 `delta should not be equal to 0`, `delta must be an integer number` → 0이나 소수, 문자열을 보냈다

  - `restock-race.mjs`의 결제 응답이 `500` → API를 시뮬레이터 모드로 띄웠는지

  - 입고를 반영해도 재고 숫자가 그대로이고 `Cannot POST /products/6/stock-adjustments`(404) → API를 작업 2 뒤에 다시 빌드해 띄우지 않았다. e2e에서는 `Expected: "105"`, `Received: "100"`으로 보인다

## 10. 9단계: API 문서

### 작업 1. [커밋] @nestjs/swagger로 /docs 띄우기

REST 경로가 30개 가까이 되고, 목록마다 쿼리(`limit`, `cursor`, `offset`, `paid`)가 생겼다. `@nestjs/swagger`로 OpenAPI 문서를 띄운다.

```sh
npm install @nestjs/swagger -w order-api-nest   # 저장소 루트에서
```

`package.json`에 한 줄이 생기고 `package-lock.json`이 바뀐다.

```diff
--- a/order-api-nest/package.json
+++ b/order-api-nest/package.json
@@
     "@nestjs/passport": "^12.0.0",
     "@nestjs/platform-express": "^12.0.1",
     "@nestjs/platform-socket.io": "^12.1.2",
+    "@nestjs/swagger": "^12.0.2",
     "@nestjs/websockets": "^12.1.2",
     "@opentelemetry/auto-instrumentations-node": "^0.81.0",
     "@opentelemetry/exporter-trace-otlp-http": "^0.223.0",
```

경로·쿼리·본문의 모양은 Nest CLI 플러그인이 빌드할 때 DTO의 class-validator 데코레이터에서 읽는다. 그래서 DTO에 문서용 데코레이터를 따로 달지 않는다.

```diff
--- a/order-api-nest/nest-cli.json
+++ b/order-api-nest/nest-cli.json
@@
   "collection": "@nestjs/schematics",
   "sourceRoot": "src",
   "compilerOptions": {
-    "deleteOutDir": true
+    "deleteOutDir": true,
+    "plugins": ["@nestjs/swagger"]
   }
 }
```

```diff
--- a/order-api-nest/src/main.ts
+++ b/order-api-nest/src/main.ts
@@
 import { ValidationPipe } from '@nestjs/common';
 import { HttpAdapterHost, NestFactory } from '@nestjs/core';
+import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
 import type { NestExpressApplication } from '@nestjs/platform-express';
 import { AppModule } from './app.module.js';
 import { Logger } from 'nestjs-pino';
@@
   await redisIoAdapter.connectToRedis(process.env.REDIS_URL!);
   app.useWebSocketAdapter(redisIoAdapter);
 
+  // REST API 문서: 브라우저로 /docs, 원문 JSON은 /docs-json. tRPC(/trpc)는 타입을 프론트와 직접 나누므로 여기에 없다
+  // 경로·쿼리·본문의 모양은 nest-cli.json의 swagger 플러그인이 빌드할 때 DTO의 class-validator 데코레이터에서 읽는다
+  const docs = new DocumentBuilder().setTitle('order-api').setDescription('주문 서비스 REST API').addBearerAuth().build();
+  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, docs));
+
   // 5. 마지막 요청 받기 시작
   await app.listen(process.env.PORT ?? 3000);
 }
```

플러그인은 칸 이름 뒤의 `?`로 필수인지 정한다. `limit`은 기본값이 있어 `?`가 없으므로 "필수"로 읽힌다. `@ApiPropertyOptional()` 하나만 붙여 표시를 고친다.

```diff
--- a/order-api-nest/src/pagination/page-query.dto.ts
+++ b/order-api-nest/src/pagination/page-query.dto.ts
@@
+import { ApiPropertyOptional } from "@nestjs/swagger";
 import { Transform, Type } from "class-transformer";
 import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
 import { DEFAULT_LIMIT, MAX_LIMIT } from "./cursor.js";
 
 // 쿼리 문자열은 모두 문자열로 온다 → @Type(() => Number)로 바꾼 뒤 검사한다
 export class PageQueryDto {
-  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
+  // 플러그인은 이름 뒤의 ?로 "생략 가능"을 정한다. 기본값이 있어 ?가 없는 limit은 문서 표시만 고친다
+  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
   @IsOptional() @IsString() cursor?: string;
 }
 
 // 상품은 id 하나로 정렬한다 → cursor가 마지막 상품의 id(숫자)다
 export class ProductPageQueryDto {
-  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
+  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
   @IsOptional() @Type(() => Number) @IsInt() @Min(1) cursor?: number;
 }
 
```

### 작업 2. [커밋] 컨트롤러에 태그와 토큰 표시를 단다

컨트롤러마다 `@ApiTags`로 묶음을 정하고, 토큰이 필요한 경로에는 `@ApiBearerAuth()`를 단다. 그래야 문서 화면의 "Authorize"에 넣은 토큰이 그 경로에 실린다. 문서에 넣지 않을 `/`와 `/metrics`는 `@ApiExcludeController()`로 뺀다. 모든 경로가 토큰을 요구하는 컨트롤러는 클래스에, 일부만 요구하면 그 메서드에 단다.

```diff
--- a/order-api-nest/src/app.controller.ts
+++ b/order-api-nest/src/app.controller.ts
@@
 import { Controller, Get } from '@nestjs/common';
+import { ApiExcludeController } from '@nestjs/swagger';
 import { AppService } from './app.service.js';
 
+@ApiExcludeController() // 문서에 넣지 않는다
 @Controller()
 export class AppController {
   constructor(private readonly appService: AppService) {}
```

```diff
--- a/order-api-nest/src/metrics/metrics.module.ts
+++ b/order-api-nest/src/metrics/metrics.module.ts
@@
 import { Controller, Get, Header, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
+import { ApiExcludeController } from "@nestjs/swagger";
 import { Gauge } from "prom-client";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { httpMetricsMiddleware, registry } from "./metrics.js";
 
+@ApiExcludeController() // Prometheus가 읽는 경로. 문서에 넣지 않는다
 @Controller()
 class MetricsController {
   @Get("metrics")
```

```diff
--- a/order-api-nest/src/health/health.controller.ts
+++ b/order-api-nest/src/health/health.controller.ts
@@
 import { Controller, Get, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
+import { ApiTags } from "@nestjs/swagger";
 import { Redis } from "ioredis";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
@@
 const withTimeout = <T>(p: Promise<T>, ms: number) =>
   Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${ms}ms 초과`)), ms))]);
 
+@ApiTags("health")
 @Controller("health")
 export class HealthController implements OnModuleDestroy {
   private readonly redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
```

```diff
--- a/order-api-nest/src/payments/payments.controller.ts
+++ b/order-api-nest/src/payments/payments.controller.ts
@@
 import { BadRequestException, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from "@nestjs/common";
+import { ApiTags } from "@nestjs/swagger";
 import type { Request } from "express";
 import type Stripe from "stripe";
 import { PaymentsService } from "./payments.service.js";
 import { StripeGateway } from "./stripe.gateway.js";
 
+@ApiTags("payments")
 @Controller("payments")
 export class PaymentsController {
   constructor(
```

```diff
--- a/order-api-nest/src/auth/auth.controller.ts
+++ b/order-api-nest/src/auth/auth.controller.ts
@@
 import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import type { CookieOptions, Request, Response } from "express";
 import { AuthService, REFRESH_TOKEN_TTL_SECONDS } from "./auth.service.js";
 import { LoginDto } from "./login.dto.js";
@@
   path: "/auth",
 };
 
+@ApiTags("auth")
 @Controller("auth")
 export class AuthController {
   constructor(private readonly authService: AuthService) {}
@@
 
   @Post("logout-all")
   @HttpCode(200)
+  @ApiBearerAuth()
   @UseGuards(AuthGuard("jwt"))
   async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
     const revoked = await this.authService.logoutAll((req.user as { userId: string }).userId);
```

```diff
--- a/order-api-nest/src/categories/categories.controller.ts
+++ b/order-api-nest/src/categories/categories.controller.ts
@@
 import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { MoveCategoryDto } from "./move-category.dto.js";
 import { CategoriesService } from "./categories.service.js";
 import { AdminGuard } from "../auth/admin.guard.js";
 
+@ApiTags("categories")
 @Controller("categories")
 export class CategoriesController {
   constructor(
@@
   }
 
   @Patch(":id")
+  @ApiBearerAuth()
   @UseGuards(AuthGuard("jwt"), AdminGuard)
   move(@Param("id", ParseIntPipe) id: number, @Body() dto: MoveCategoryDto) {
     return this.categories.move(id, dto.parentId);
@@
 
   @Delete(":id")
   @HttpCode(204)
+  @ApiBearerAuth()
   @UseGuards(AuthGuard("jwt"), AdminGuard)
   async remove(@Param("id", ParseIntPipe) id: number) {
     const children = await this.prisma.category.count({ where: { parentId: id } });
```

```diff
--- a/order-api-nest/src/me/me.controller.ts
+++ b/order-api-nest/src/me/me.controller.ts
@@
 import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import type { Request } from "express";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { PageQueryDto } from "../pagination/page-query.dto.js";
@@
 import { listMyOrders } from "./my-orders.js";
 import { orderDetailSelect } from "./order-select.js";
 
+@ApiTags("me")
+@ApiBearerAuth() // 이 컨트롤러의 모든 경로가 토큰을 요구한다
 @Controller("me")
 @UseGuards(AuthGuard("jwt"))
 export class MeController {
```

```diff
--- a/order-api-nest/src/orders/orders.controller.ts
+++ b/order-api-nest/src/orders/orders.controller.ts
@@
 import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards, Headers } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import type { Request } from "express";
 import { CreateOrderDto } from "./dto/create-order.dto.js";
 import { OrdersService } from "./orders.service.js";
@@
 import { AdminOrderQueryDto } from "../pagination/page-query.dto.js";
 import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 
+@ApiTags("orders")
+@ApiBearerAuth()
 @Controller("orders")
 export class OrdersController {
   constructor(private readonly ordersService: OrdersService) {}
```

```diff
--- a/order-api-nest/src/users/users.controller.ts
+++ b/order-api-nest/src/users/users.controller.ts
@@
 import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import { AdminGuard } from "../auth/admin.guard.js";
 import { CreateUserDto } from "./dto/create-user.dto.js";
 import { UsersService } from "./users.service.js";
 
+@ApiTags("users")
+@ApiBearerAuth()
 @Controller("users")
 @UseGuards(AuthGuard("jwt"), AdminGuard)
 export class UsersController {
```

```diff
--- a/order-api-nest/src/products/products.controller.ts
+++ b/order-api-nest/src/products/products.controller.ts
@@
 import { Controller, Get, Query } from "@nestjs/common";
+import { ApiTags } from "@nestjs/swagger";
 import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
 import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
 import { listProducts } from "./product-list.js";
 
+@ApiTags("products")
 @Controller("products")
 export class ProductsController {
   constructor(
```

```diff
--- a/order-api-nest/src/products/product-images.controller.ts
+++ b/order-api-nest/src/products/product-images.controller.ts
@@
 import { randomUUID } from "node:crypto";
 import { BadRequestException, Body, Controller, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StorageService } from "../storage/storage.service.js";
 import { EXTENSIONS, looksLike } from "./image-signature.js";
@@
 export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 2 * 1024 * 1024); // 2MB
 const UPLOAD_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 60);
 
+@ApiTags("products")
+@ApiBearerAuth()
 @Controller("products/:id/image")
 @UseGuards(AuthGuard("jwt"), AdminGuard)
 export class ProductImagesController {
```

```diff
--- a/order-api-nest/src/products/product-stock.controller.ts
+++ b/order-api-nest/src/products/product-stock.controller.ts
@@
 import { Body, ConflictException, Controller, HttpCode, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
+import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
 import { AdminGuard } from "../auth/admin.guard.js";
 import { PrismaService } from "../prisma/prisma.service.js";
 import { StockAdjustmentDto } from "./stock-adjustment.dto.js";
 
 // 재고를 바꾸는 관리자 경로. AdminGuard가 데모 관리자(demo_admin)를 403으로 막는다
+@ApiTags("products")
+@ApiBearerAuth()
 @Controller("products/:id")
 @UseGuards(AuthGuard("jwt"), AdminGuard)
 export class ProductStockController {
```

### 작업 3. [확인] 문서에 쿼리와 본문이 실렸는지 본다

```sh
# order-api-nest에서 빌드해 다시 띄운 뒤(터미널 2)
curl -s localhost:4000/docs-json | jq -c '.paths["/me/orders"].get.parameters'
# [{"name":"limit","required":false,"in":"query","schema":{"minimum":1,"maximum":100,"default":20,"type":"number"}},{"name":"cursor","required":false,"in":"query","schema":{"type":"string"}}]

curl -s localhost:4000/docs-json | jq -c '.components.schemas.StockAdjustmentDto'
# {"type":"object","properties":{"delta":{"type":"number","minimum":-100000,"maximum":100000}},"required":["delta"]}
```

`limit`의 범위와 기본값이 `@Min`, `@Max`, 초깃값에서 왔다. `@ApiPropertyOptional()`을 빼면 `"required": true`가 된다. 브라우저로 `http://localhost:4000/docs`를 열면 Swagger UI가 경로를 태그별로 보여 준다.

`StockAdjustmentDto`의 `properties`가 비어 있으면 DTO 파일에 숫자 구분자(`100_000`)가 있는지 본다. 이 저장소의 빌드에서 `100_000`으로 쓰면 플러그인이 만든 메타데이터가 `{}`였고, `100000`으로 바꾸자 `delta`가 실렸다.

> tRPC(`/trpc`)는 이 문서에 없다. 타입을 프론트와 직접 나누므로 문서가 필요 없는 쪽이다([`12`](https://github.com/seungwoo7050/node-order/tree/12-trpc)).  
> 배포하면 `/docs`도 공개 주소에 열린다. 문서가 보여 주는 것은 이미 누구나 부를 수 있는 경로의 모양이고, 관리자 경로는 문서가 있어도 토큰이 없으면 401이다.

### 남길 것

- **찾아보면 되는 것**: `DocumentBuilder`, `@ApiTags`·`@ApiBearerAuth`·`@ApiExcludeController`, `nest-cli.json`의 `plugins`, `jq -c`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - Swagger 플러그인은 DTO의 검사 데코레이터와 칸 이름 뒤 `?`로 문서를 만든다. 문서용 데코레이터는 플러그인이 틀리게 읽는 자리에만 붙인다.

  - 빌드 단계의 코드 변환(플러그인)은 실패해도 빌드를 멈추지 않을 수 있다. 문서가 비면 생성된 결과(`/docs-json`)를 직접 열어 본다.

- **에러 신호**:

  - `/docs-json`에서 기본값이 있는 `limit`이 `"required": true` → `@ApiPropertyOptional()`

  - `/docs-json`에서 어떤 DTO의 `properties`가 비었다 → 그 DTO 파일에 숫자 구분자(`100_000`)가 있는지

  - Swagger UI에서 관리자 경로를 불렀는데 401 → "Authorize"에 토큰을 넣었는지, 그 컨트롤러에 `@ApiBearerAuth()`가 있는지

## 11. 디버깅

### 진단 1. `PrismaClientValidationError`에 더한 칸이 없다고 나온다

스키마에 칸을 더하고 마이그레이션까지 했는데, 쿼리의 `select`에서 그 칸에 `~~~` 표시가 붙고 쓸 수 있는 칸 목록에 없다. Prisma 7의 `migrate dev`는 클라이언트를 다시 만들지 않는다. `npx prisma generate` 뒤에 `npm run build`를 다시 한다.

### 진단 2. 깊은 페이지가 psql보다 훨씬 느리다

psql을 소유자(`-U order`)로 붙었는지 본다. 앱은 RLS가 걸리는 `order_app`이라 실행 계획이 다르다. 5장 작업 3처럼 `-U order_app`으로 붙고, 트랜잭션 안에서 `set_config`로 사용자나 관리자를 정한 뒤 `EXPLAIN`을 본다.

### 진단 3. 무효화했는데 무한 목록이 그대로다

키를 비교한다. `queryKey()`는 `{ type: "query" }`가 붙어 무한 쿼리와 맞지 않는다. `pathKey()`로 지운다(6장 "개념 | 무한 쿼리의 키").

### 진단 4. 직렬화 실패가 몇 번, 왜 났는지 본다

```sh
docker compose logs db --since 5m 2>&1 | grep -A1 "could not serialize"
```

`DETAIL`의 `Reason code`가 판정의 종류다. `concurrent update`면 같은 행이고, `read/write dependencies`면 읽은 범위가 겹친 것이다.

### 진단 5. Playwright가 고친 화면을 모른다

`playwright.config.ts`는 `reuseExistingServer: true`다. `:3000`에 예전 빌드의 `next start`가 떠 있으면 새로 빌드하지 않고 그것으로 시험한다. 떠 있는 웹을 끄고 다시 돌린다.

### 진단 6. 웹 e2e의 "재고보다 많이 담을 수 없다"가 시간 초과로 끝난다

동시 결제 실험(7·8장)과 재고 경쟁 실험(9장)이 한정판 키보드의 재고를 바꿨다. 0이면 품절이라 재고 숫자(`stock-5`)가 없어서 테스트가 그것을 기다리다 끝나고, `load-seed.sql`이 1,000,000으로 올렸으면 "+"를 백만 번 누르다 끝난다. 웹 e2e는 시드 직후의 데이터를 전제한다. `npx prisma db seed`를 다시 하고 돌린다.

### 진단 7. 결제가 시뮬레이터로 가지 않는다

결제하기를 누르면 연결할 수 없다는 화면이 나오면 시뮬레이터(`node scripts/stripe-sim.mjs`)가 떠 있는지 본다. 결제 화면이 `checkout.stripe.com`이면 API를 `STRIPE_SIMULATOR_URL=http://localhost:4100` 없이 띄운 것이다. 이때 `.env.local`의 진짜 테스트 키로 세션이 만들어지고, 부하 실험이라면 Stripe의 요청 수 제한에 걸린다. 시뮬레이터를 껐다 켜면 세션 기록이 사라져 예전 결제 화면 주소는 404다.

### 진단 8. 재고 조정이 막힌다

403이면 토큰의 역할을 본다. 관리자 경로는 `role`이 `admin`인 토큰만 들인다. 데모 관리자(`demo_admin`)는 메시지가 `데모 관리자는 볼 수만 있습니다`다. 409면 정상 동작이다. 빼려는 수량이 지금 재고보다 많다. 메시지의 "재고가 N개"가 화면의 숫자와 다르면 화면이 낡은 것이다. 새로 고친다.

### 진단 9. 에러 신호 모아 보기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| 결제하기를 누르면 연결할 수 없다는 화면 | 시뮬레이터가 꺼져 있다 | `node scripts/stripe-sim.mjs`(진단 7) | 1장 |
| 시뮬레이터를 다시 켠 뒤 예전 결제 화면 주소가 404 | 세션 기록은 시뮬레이터 메모리에만 있다 | 결제를 새로 만든다 | 1장 |
| `/complete`가 404 `시뮬레이터에 없는 경로나 세션: /c/pay/cs_test_sim_%e2%80%a6_…` | 손으로 옮긴 주소에 줄임표가 들어가 없는 세션을 불렀다 | 응답의 `checkoutUrl`을 `jq -r .checkoutUrl`로 꺼내 쓴다 | 1장 |
| `POST /orders/checkout`이 500, API 로그에 `결제 세션 생성 실패 → 주문 #N 취소, 재고 복구` | 시뮬레이터 모드의 API가 4100번에 닿지 못해 세션을 못 만들고, 보상 처리로 주문을 취소했다 | 시뮬레이터(터미널 1)를 다시 띄우고 결제를 새로 만든다(진단 7) | 1장 |
| 결제가 `checkout.stripe.com`으로 간다 | API가 `.env.local`의 진짜 키로 세션을 만들었다 | API를 `STRIPE_SIMULATOR_URL=…`을 붙여 띄웠는지(진단 7) | 1장 |
| 응답에 `RateLimit-Limit` 헤더, 429 `요청이 너무 많습니다` | `21`의 요청 수 제한이 켜져 있다 | 셸·`.env.local`의 `RATE_LIMIT_PER_MINUTE` | 1장 |
| 실행 계획에 `Seq Scan`과 `Sort Method: external merge  Disk:` | 정렬 순서에 맞는 인덱스가 없어 전체를 읽고 정렬한다 | `@@index([createdAt, id])` | 2장 |
| `GET /orders`가 401이나 403 | 전체 주문은 진짜 관리자만 보는 경로다 | kim의 토큰을 실었는지 | 2장 |
| cursor 쿼리에 `Rows Removed by Filter: 200000` | cursor 조건이 `Index Cond`가 아니라 `Filter`에 들어갔다 | OR 앞의 `created_at <= c` | 3장 |
| `{"message":"cursor가 올바르지 않다","error":"Bad Request","statusCode":400}` | cursor를 풀 수 없다 | 받은 `nextCursor`를 그대로 보냈는지 | 4장 |
| `limit must not be greater than 100` | `MAX_LIMIT`를 넘었다 | `limit` 값 | 4장 |
| 컨트롤러에 `limit`이 문자열 `"20"`으로 오거나 기본값이 없다 | 전역 `ValidationPipe`는 `transform`이 꺼져 있다 | 그 `@Query`의 `PAGE_QUERY` | 4장 |
| 웹 타입 검사의 `Property 'map' does not exist on type '{ items: …; nextCursor: … }'` | 페이지 응답을 배열처럼 쓴다 | `useInfiniteQuery`와 `data.pages.flatMap`(6장) | 4장 |
| 무한 목록에 같은 주문이 두 번, 결제 대기에서 본 적 없는 주문이 있다 | offset으로 이어 읽는 사이 앞쪽 행이 늘거나 줄었다 | cursor로 이어 읽는지 | 5장 |
| 앱의 깊은 페이지가 psql보다 훨씬 느리다 | 앱은 RLS가 걸리는 `order_app`이라 실행 계획이 다르다 | `-U order_app`과 `set_config`로 `EXPLAIN`(진단 2) | 5장 |
| `page-drift.mjs`가 `Cannot read properties of undefined (reading 'map')` | 응답이 페이지가 아니다(401·403) | kim 로그인과 시드 | 5장 |
| `expect(locator).toBeFocused() failed`, `Received: inactive` | `disabled`가 된 버튼에서 포커스가 문서 처음으로 갔다 | `aria-disabled` | 6장 |
| 무효화했는데 무한 목록이 그대로다 | `queryKey()`의 `{ type: "query" }`가 무한 쿼리와 맞지 않는다 | `pathKey()`(진단 3) | 6장 |
| 목록 요청에 `"/trpc/me.orders"`가 한 번 더 나간다 | 한 줄을 고치려고 목록을 무효화했다 | `setQueryData`로 그 줄만 | 6장 |
| Playwright가 고친 화면을 모른다 | `:3000`에 예전 빌드가 떠 있다(`reuseExistingServer`) | 떠 있는 웹을 끈다(진단 5) | 6장 |
| `Expected substring: "주문 #1"`, `element(s) not found` | 시드는 주문 번호(시퀀스)를 되돌리지 않아 1번 주문이 없다 | 번호를 박지 말고 API로 받은 주문 번호를 쓴다 | 6장 |
| `page.waitForURL: Timeout` (`localhost:4100/c/pay/cs_`) | 결제가 시뮬레이터로 가지 않았다 | API의 `STRIPE_SIMULATOR_URL`, 시뮬레이터(진단 7) | 6장 |
| `stampede.mjs`의 응답이 전부 `500` | 결제 세션을 만들지 못해 주문이 취소됐다 | API를 시뮬레이터 모드로 띄웠는지(진단 7) | 7장 |
| `stampede.mjs`가 `{ '201': 50 }`인데 팔린 수량이 1 | 50개 요청이 같은 `Idempotency-Key`로 나가 멱등 재응답을 받았다 | `idempotencyKey = process.argv[4]` | 7장 |
| 남은 재고 + 팔린 수량이 처음 재고와 다르다 | 지난 실험이나 임시 계정의 주문이 섞였다 | `npx prisma db seed` 뒤에 다시 | 7장 |
| `LOG_LEVEL=warn`으로 띄운 API 터미널이 빌드 뒤 아무것도 찍지 않는다 | 정상. 시작 로그도 info 수준이라 숨는다 | `curl -s localhost:4000/health/ready` | 7장 |
| k6가 `dial tcp … connect: connection refused` | 컨테이너에서 API에 닿지 않는다 | API가 떠 있는지, `-e API=http://host.docker.internal:4000` | 7장 |
| 흩어진 부하인데 결제가 모두 400 | `setup`이 재고 남은 부하용 상품을 못 찾았다 | 시드 뒤에 `load-seed.sql`을 넣었는지 | 7장 |
| 웹 e2e의 "재고보다 많이 담을 수 없다"가 시간 초과 | 실험이 키보드 재고를 0이나 1,000,000으로 바꿨다 | `npx prisma db seed`(진단 6) | 7장 |
| `PrismaClientValidationError`에 더한 칸(`version`)이 없다 | `migrate dev`가 클라이언트를 다시 만들지 않았다 | `npx prisma generate`, `npm run build`(진단 1) | 8장 |
| 재고가 넉넉한데 409 `동시에 결제가 몰려 처리하지 못했다 - 다시 시도한다` | 재시도 다섯 번을 다 썼다 | `checkout_retries_total` | 8장 |
| DB 로그 `could not serialize access due to concurrent update` | 같은 행을 동시에 고쳤다 | 낙관적 잠금의 충돌과 같다(진단 4) | 8장 |
| DB 로그 `could not serialize access due to read/write dependencies among transactions` | 읽은 범위가 겹쳤다 | `pg_locks`의 `SIReadLock`(진단 4) | 8장 |
| 실험 중인데 `grep checkout_retries`가 아무것도 찍지 않는다 | 재시도 지표가 없다. 지금 코드는 비관적 잠금이다 | 8장 "실험을 적용했는지 보는 법"(`FOR UPDATE`가 있는지) | 8장 |
| 입고 뒤 재고가 "본 재고 + 입고"와 같고, 그사이 결제가 있었다 | 결과로 덮어써 판매가 사라졌다 | 증가량(`delta`)으로 받는지 | 9장 |
| 409 `재고가 3개라 5개를 뺄 수 없습니다` | 정상. 빼려는 수량이 지금 재고보다 많다 | 화면의 재고가 낡지 않았는지(진단 8) | 9장 |
| 403 `데모 관리자는 볼 수만 있습니다` | 데모 관리자로 관리자 경로를 불렀다 | 시드의 kim으로(진단 8) | 9장 |
| 400 `delta should not be equal to 0`, `delta must be an integer number` | 0이나 소수, 문자열을 보냈다 | 보낸 `delta` | 9장 |
| 입고를 반영해도 재고가 그대로, `Cannot POST /products/6/stock-adjustments`(404). e2e에서 `Expected: "105"`, `Received: "100"` | 새 경로가 없는 예전 빌드의 API가 떠 있다 | API를 다시 빌드해 띄운다(`npm run build`) | 9장 |
| `restock-race.mjs`의 결제 응답이 `500` | 결제 세션을 만들지 못했다 | API를 시뮬레이터 모드로 띄웠는지(진단 7) | 9장 |
| `/docs-json`에서 기본값이 있는 `limit`이 `"required": true` | 플러그인은 `?`로 필수를 정하는데 기본값이 있는 칸에는 `?`가 없다 | `@ApiPropertyOptional()` | 10장 |
| `/docs-json`에서 어떤 DTO의 `properties`가 비었다 | 플러그인이 그 DTO를 읽지 못했다 | 숫자 구분자(`100_000`) | 10장 |
| Swagger UI에서 관리자 경로를 불렀는데 401 | 토큰이 실리지 않았다 | "Authorize", `@ApiBearerAuth()` | 10장 |

## 12. 완성 확인

### 시험해보기

API(시뮬레이터 모드)와 시뮬레이터를 띄운 상태에서, 시드를 다시 넣고 돌린다. 테스트 DB에는 3장의 마이그레이션을 넣어 두었다(4장 작업 3).

```sh
# 저장소 루트에서
(cd order-api-nest && npx prisma db seed)
npm run lint && npm run typecheck
npm run test:api                 # 페이지네이션 7, 재고 조정 3이 더해졌다
STRIPE_SIM=1 npm run test:web    # 무한 목록 3, 재고 조정 1이 더해졌다. 진짜 Stripe용 1개는 건너뛴다
```

### 체크리스트

- [ ] 상품·전체 주문·내 주문이 `{ items, nextCursor }`로 20건씩 오고, REST와 tRPC가 같다
- [ ] 전체 주문은 관리자만 보고, 데모 관리자는 403이다
- [ ] 같은 시각의 주문 사이에 페이지 경계가 떨어져도 빠지거나 겹치지 않는다
- [ ] 깊은 자리에서 offset과 cursor의 `EXPLAIN`을 보고, OR만 쓴 조건이 `Filter`가 되는 것을 확인했다
- [ ] 넘기는 사이에 주문이 생기거나 결제되면 offset이 겹치거나 건너뛰는 것을 재현했다
- [ ] 내 주문을 스크롤로도, 키보드의 "더 보기"로도 넘기고, 포커스가 버튼에 남는다
- [ ] 결제가 확인되면 목록을 다시 받지 않고 그 줄만 바뀐다
- [ ] 세 잠금 모두 재고 10개에 정확히 10건이고, 흩어진 부하와 몰린 부하의 처리량·성공률·재시도를 쟀다
- [ ] 바꿔보기를 원복했고(`version` 칸 없음), `FOR UPDATE` 위에 고른 이유가 있다
- [ ] 재고를 숫자로 덮어쓰면 판매가 사라지는 것을 재현했고, 입고는 증가량으로 받아 음수가 되지 않는다
- [ ] 관리자 상품 화면에서 입고를 반영하고, 데모 관리자에게는 입력칸이 꺼져 있다
- [ ] `/docs`에 REST API 문서가 뜬다

## 13. 다음 단계

### 자가 점검

1. offset 20만의 쿼리는 인덱스를 쓰는데도 왜 느린가? cursor는 왜 깊이와 상관이 없는가?

2. 정렬 키가 `createdAt` 하나면 어떤 경우에 주문이 빠지거나 겹치는가?

3. `created_at < c OR (created_at = c AND id < i)`만 쓰면 결과는 맞는데 무엇이 문제인가? 무엇을 더하면 고쳐지는가?

4. 결제 대기만 걸러 보는 중에 주문이 결제되면 offset은 어떻게 틀리는가? 그 틀림이 중복보다 위험한 이유는?

5. 앱의 offset 1,000이 psql의 offset 20만보다 느렸던 이유는?

6. 불러오는 동안 "더 보기"를 `disabled`로 막으면 누가 무엇을 잃는가?

7. 무한 목록에서 한 줄이 바뀌었을 때 무효화와 `setQueryData`는 요청 수가 어떻게 다른가? 첫 페이지에 새 주문을 붙여도 2쪽이 밀리지 않는 이유는?

8. 인기 상품에 몰린 부하에서 낙관적 잠금이 결제의 절반을 놓친 과정을 순서대로 설명한다. 재고는 넉넉했다.

9. SERIALIZABLE이 서로 다른 상품을 산 결제끼리도 실패시킨 이유는?

10. 결제는 `FOR UPDATE`로 잠그는데, 관리자의 "재고 = 50"은 왜 그 잠금으로 막히지 않는가?

11. `UPDATE … SET stock = stock + $1 WHERE … AND stock + $1 >= 0`이 결제와 동시에 와도 음수를 만들지 않는 이유는? 같은 일을 "읽고 → 앱에서 확인 → 쓰기"로 하면 어디서 틀리는가?

12. 낙관적 잠금이 이 서비스에서 맞는 곳은 어디인가? 재고 입고는 왜 그곳이 아닌가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 페이지 번호와 전체 개수(`count(*)`)를 함께 보여 주는 표, 추정 개수(`pg_class.reltuples`)
- 양방향 cursor(이전 페이지), 정렬 기준을 사용자가 바꾸는 목록의 cursor
- 운영 중인 큰 테이블에 잠그지 않고 인덱스 만들기(`CREATE INDEX CONCURRENTLY`)
- 결제 차감도 조건부 `UPDATE … WHERE stock >= n` 한 문장으로 하기, Redis로 재고를 먼저 깎는 선착순 판매
- 재고 조정의 기록(누가 언제 몇 개를 왜 바꿨는지 남기는 표)과 그 기록으로 재고를 다시 계산하기
- 재고 조정 요청의 `Idempotency-Key`, DB의 `CHECK (stock >= 0)` 제약
- 재고 실사처럼 결과를 정하는 수정에 `version`으로 거는 낙관적 잠금(`If-Match`)
- 분산 락(Redlock), 읽기 복제본으로 목록 조회 나누기, 전문 검색
- 가상 스크롤(화면 밖 줄을 그리지 않기)
- OpenAPI 문서로 클라이언트 코드 만들기

다음 단계는 상품 목록에 Redis 캐시를 얹고, 화면 하나를 Next 서버 캐시로 바꾼다. 캐시가 Redis, Next 서버, TanStack Query 세 겹이 될 때 수정 한 번이 어디어디를 지워야 하는지 정한다. 이 문서의 결제와 재고 조정이 그 "수정"이다.

---

## 이 브랜치의 코드 실행

| 폴더 | 확인 명령 |
|---|---|
| 저장소 루트 | `npm ci`, `docker compose up -d`, `npm run lint`, `npm run typecheck`, `npm run test:api`, `STRIPE_SIM=1 npm run test:web` |
| 저장소 루트 | `docker compose exec -T db psql -U order -d order_api < order-api-nest/scripts/bulk-orders.sql` |
| `order-api-nest/` | `npx prisma migrate deploy && npx prisma db seed`, `node scripts/stripe-sim.mjs` |
| `order-api-nest/` | `npm run build && STRIPE_SIMULATOR_URL=http://localhost:4100 node --env-file=.env dist/main.js` |
| `order-api-nest/` | `node scripts/page-drift.mjs`, `node scripts/page-latency.mjs`, `node scripts/stampede.mjs 50 '[{"productId":5,"quantity":1}]'`, `node scripts/restock-race.mjs delta` |
| `order-api-nest/` | `docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD/loadtest:/scripts" grafana/k6 run -e API=http://host.docker.internal:4000 -e HOT=1 /scripts/checkout.js` |
