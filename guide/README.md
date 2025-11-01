# 부하와 보안 헤더: k6로 한계를 재고, CSP로 화면의 허용 범위를 정한다

## 목표

이 프로젝트는 [`07-operations`](https://github.com/seungwoo7050/node-order/tree/07-operations)으로부터 시작한다.

이번에 하는 일은 둘이다.

1. k6 부하 테스트: 결제 API에 동시 사용자를 늘려 가며 처리량과 응답 시간을 잰다. 한계가 어디서 오는지 찾고, 추적·로그가 드는 비용도 숫자로 본다.

2. CSP(Content Security Policy): 프론트 페이지가 실행할 수 있는 스크립트, 불러올 수 있는 이미지, 연결할 수 있는 서버를 브라우저에게 알려 주는 응답 헤더를 붙인다.

```sh
# 인기 상품 하나에 가상 사용자 50명이 몰리면 결제 p95가 기준(200ms)을 넘는다
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run -e VUS=50 -e HOT=1 /scripts/checkout.js
```

```text
    ✗ 'p(95)<200' p(95)=357.36ms
    http_reqs......................: 5084   250.244521/s
```

```sh
# 운영 빌드의 페이지 응답에 요청마다 다른 nonce가 든 CSP 헤더가 붙는다
curl -sI localhost:3000/shop | grep -i content-security-policy
content-security-policy: default-src 'self'; script-src 'self' 'nonce-MDk2NjgxODYtZDk1Mi00MWU2LWFiMTAtZjQzMjRlZGIyZmM4' 'strict-dynamic'; ...
```

> 시작 기준점:  
> `order-api-nest`는 컨테이너 구성(`docker compose --profile app`)과 Jaeger 추적까지 마친 상태다.  
> 프론트는 [`06-file-upload`](https://github.com/seungwoo7050/node-order/tree/06-file-upload)의 `order-console-next`(장바구니, 결제, 직접 업로드, e2e 테스트 6개)를 그대로 쓴다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 6단계에서 "어디서 틀어졌나"를 가르는 절차 | 친다(`docker stats`, `curl`, 브라우저 콘솔) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 6단계만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 `[ ]`는 그 작업이 무엇을 남기는지다. 제목만 보고 "커밋할 변경이 있나"를 가를 수 있다.

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일(코드 작성·수정, 설정, 패키지 설치, 마이그레이션) | 한다 |
  | `[실행]` | 저장소 밖의 상태(컨테이너, DB 데이터, 이미지). 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다. 재고, 빌드하고, 테스트하고, 결과를 읽는다 | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

  한 작업에 여러 성격이 섞이면 `[커밋]` > `[원복]` > `[실행]` > `[확인]` 순으로 센 쪽 하나만 붙인다. 측정이 DB에 주문을 쌓는 것처럼, 다음 작업이 기대지 않는 부산물은 "남는 것"으로 치지 않는다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 6단계 "진단 3"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 준비 명령뿐이고 8·9장은 체크리스트와 자가 점검이라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | 부하 테스트가 재는 "줄 서기"와, CSP가 브라우저에게 주는 허용 목록을 본다(작업 없음) |
| [1. 준비](#1-준비) | 컨테이너를 띄워 compose 네트워크 이름(`order-api-nest_default`)을 확인하고 시드와 k6 이미지를 준비한다 |
| [2. 1단계: k6 시나리오](#2-1단계-k6-시나리오) | 부하용 상품과 결제 시나리오(`checkout.js`)를 만들고 한 번 돌린다 |
| [3. 2단계: 사용자를 늘려 가며 재기](#3-2단계-사용자를-늘려-가며-재기) | VU를 늘려 처리량이 멈추는 지점과 병목, 잠금의 비용, 장부를 본다 |
| [4. 3단계: 관측에도 비용이 든다](#4-3단계-관측에도-비용이-든다) | 추적·샘플링·로그 레벨을 바꿔 가며 처리량 차이를 잰다 |
| [5. 4단계: CSP 붙이기](#5-4단계-csp-붙이기) | `proxy.ts`로 요청마다 nonce를 넣은 CSP를 붙이고 운영 빌드로 확인한다 |
| [6. 5단계: 일부러 깨뜨려보기, 허용 목록이 좁으면](#6-5단계-일부러-깨뜨려보기-허용-목록이-좁으면) | 허용 목록을 좁혀 화면이 조용히 깨지는 것을 보고 원복한다 |
| [7. 6단계: 디버깅](#7-6단계-디버깅) | 부하 결과 읽기, CSP 위반 찾기, 에러 신호 표 |
| [8. 완성 확인](#8-완성-확인) | 체크리스트 |
| [9. 다음 단계](#9-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | 부하 테스트는 "줄 서기"를 재는 일이다.

`stampede.mjs`는 요청을 한꺼번에 보내 정확성(재고가 맞는가)을 봤다.

부하 테스트는 성능을 본다. 가상 사용자(VU) 여러 명이 쉬지 않고 요청을 반복하고, 그동안 초당 처리 수(처리량)와 응답 시간 분포를 모은다.

C로 서버를 짜 봤다면 이 관계를 안다. 서버가 1초에 처리할 수 있는 양에는 상한이 있다.

그 상한보다 많이 밀어 넣으면 처리량은 더 늘지 않고, **대기열만 길어진다.**

대기열이 길어지면 각 요청이 기다리는 시간, 즉 응답 시간이 늘어난다.

그래서 사용자를 늘려 가며 "처리량이 멈추는 지점"과 "그때의 응답 시간"을 찾는 것이 목표다.

> 평균은 잘 속는다. 대부분 10ms인데 일부가 2초면 평균은 그럭저럭 괜찮아 보인다.  
> **그래서 p95(가장 느린 5%를 빼고 가장 느린 값)처럼 분포의 꼬리를 본다**.

### 개념 2 | CSP는 브라우저에게 주는 허용 목록이다.

웹 페이지는 기본적으로 어디서 온 스크립트든 실행하고, 어디로든 요청을 보낸다.

CSP 헤더는 그 범위를 페이지 쪽에서 좁힌다. "스크립트는 이 조건을 만족하는 것만", "이미지는 이 출처에서만", "fetch는 이 서버로만" 같은 규칙이다.

브라우저는 규칙을 어기는 것을 실행하거나 불러오지 않고, 콘솔에 위반을 기록한다.

코드에 실수가 있어 의도하지 않은 스크립트가 페이지에 끼어들더라도, CSP가 있으면 그 스크립트가 할 수 있는 일이 줄어든다.

규칙을 지키게 하는 쪽은 서버가 아니라 브라우저다. 서버는 헤더를 붙여 보낼 뿐이다.

그래서 `curl`이나 k6처럼 HTML을 실행하지 않는 클라이언트에게 CSP는 아무 영향이 없다. 이 문서에서 CSP 동작을 브라우저(Playwright)로 확인하는 이유다.

> 입력 검증과 출력 이스케이프가 첫 번째 방어선이고, CSP는 그 뒤의 방어선이다. 첫 번째를 대신하지는 않는다.

## 1. 준비

`07`의 `order-api-nest`에서 이어 간다. 새로 설치할 npm 패키지는 없다.

### 작업 1. [실행] 컨테이너를 띄우고 네트워크 이름 확인하기

이 문서의 k6 명령은 모두 `--network order-api-nest_default`로 앱과 같은 네트워크에 붙는다.

```sh
cd order-api-nest
docker compose --profile app up -d --build # 앞에서 만든 컨테이너 구성. migrate 서비스가 마이그레이션까지 한다
docker network ls # 목록에 order-api-nest_default가 있어야 한다
```

```text
NETWORK ID     NAME                     DRIVER    SCOPE
b8392aa0a58c   bridge                   bridge    local
dd3e3586d0d4   host                     host      local
8db87ef9658d   none                     null      local
0420129c067b   order-api-nest_default   bridge    local
```

위의 셋(`bridge`, `host`, `none`)은 Docker가 처음부터 만들어 두는 기본 네트워크다. 마지막 줄이 compose가 이 프로젝트를 위해 만든 네트워크다. ID는 기계마다 다르다.

### 개념 | compose 프로젝트 이름이 정하는 것

compose 파일에 `name:`이 없으면 프로젝트 이름은 compose 파일이 있는 폴더 이름이다. `order-api-nest/docker-compose.yml`이면 `order-api-nest`다.

compose는 이 프로젝트 이름을 앞에 붙여 자원 이름을 짓는다.

| 자원 | 이름 | 이 문서에서 |
|---|---|---|
| 네트워크 | `order-api-nest_default` | k6 컨테이너가 `--network`로 붙는 곳 |
| 컨테이너 | `order-api-nest-api-1`, `order-api-nest-db-1` ... | `docker stats` 출력에 보이는 이름 |
| 볼륨 | `order-api-nest_pgdata` | DB 데이터가 들어 있는 곳 |

- 폴더 이름이 다르면 자원 이름도 달라진다. 그때는 `docker network ls`로 실제 네트워크 이름을 확인하고, 아래 명령의 `order-api-nest_default`를 그 이름으로 바꿔 쓴다.

- 같은 폴더에서 이어 가면 프로젝트도 볼륨도 그대로다. 이전 단계의 DB 데이터가 남아 있지만, 시드가 표를 비우고 다시 채우므로(작업 2) 출발점은 같아진다.

> C로 치면 출력 디렉터리 이름이 소스 폴더 이름에서 정해지는 것과 비슷하다. 폴더가 바뀌면 이전 결과물은 그대로 두고 새로 만든다.

### 작업 2. [실행] 시드 넣고 k6 이미지 받기

```sh
npx prisma db seed
# k6: Grafana가 만든 부하 테스트 도구. 설치 없이 Docker 이미지로 실행한다
docker pull grafana/k6
```

```text
Running seed command `tsx prisma/seed.ts` ...
seed 완료: 사용자 4 명, 주문 5 건, 상품 2 개

🌱  The seed command has been executed.
```

시드는 표를 모두 비우고(`TRUNCATE ... RESTART IDENTITY`) 사용자 4명(`kim` 포함), 주문 5건, 상품 2개를 다시 넣는다. 상품 id도 1부터 다시 센다.

시드를 빼먹으면 어떻게 되는지는 1단계 "처음 돌렸을 때"에서 실제로 본다.

k6를 Dockerfile이나 compose 서비스가 아니라 `docker run` 한 줄로 돌리는 이유는 1단계 "k6를 `docker run`으로 바로 돌리는 이유"에서 다룬다.

## 2. 1단계: k6 시나리오

부하용 상품을 넉넉히 만든다. 재고가 금방 떨어지면 409만 재게 된다.

### 작업 1. [커밋] 부하용 상품 SQL

`order-api-nest` 안에 `loadtest/` 폴더를 만들고 두 파일을 둔다. k6 명령이 `$PWD/loadtest`를 컨테이너에 붙이므로, 이 문서의 k6 명령은 모두 `order-api-nest`에서 실행한다.

```sql
-- loadtest/load-seed.sql
-- 부하 테스트용 상품: 재고를 넉넉히 둔 상품 50개(id 3~52)를 더하고, 기존 두 상품의 재고도 늘린다
-- 사용법: docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
INSERT INTO products (name, price, stock)
SELECT '부하용 상품 ' || i, 1000, 1000000 FROM generate_series(1, 50) AS i;
UPDATE products SET stock = 1000000 WHERE id IN (1, 2);
SELECT count(*) AS products, sum(stock) AS total_stock FROM products;
```

시드가 상품 id를 1, 2로 되감아 두므로(`TRUNCATE ... RESTART IDENTITY`), 시드 직후에 이 파일을 넣으면 새 상품은 3~52번이 된다. 시나리오가 이 번호를 그대로 쓴다.

### 작업 2. [커밋] 결제 시나리오 작성

```js
// loadtest/checkout.js
// 결제 API에 부하를 거는 k6 시나리오
// 실행: docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run /scripts/checkout.js
//   -e VUS=20: 동시에 요청을 보내는 가상 사용자 수
//   -e HOT=1: 모든 가상 사용자가 같은 상품(1번)을 산다(인기 상품에 몰리는 상황)
import http from "k6/http";
import { check } from "k6";

const API = __ENV.API ?? "http://api:4000"; // compose 네트워크 안에서 api 서비스 이름으로 부른다
const HOT = __ENV.HOT === "1";

export const options = {
  vus: Number(__ENV.VUS ?? 20),
  duration: __ENV.DURATION ?? "20s",
  // 기준선: 실패율 1% 미만, 결제 응답 95%가 200ms 안
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:checkout}": ["p(95)<200"],
  },
};

export function setup() {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ id: "kim", password: "1234" }), {
    headers: { "Content-Type": "application/json" },
  });
  return { token: res.json("accessToken") };
}

export default function (data) {
  const productId = HOT ? 1 : 3 + Math.floor(Math.random() * 50); // 3~52번 중 하나
  const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: [{ productId, quantity: 1 }] }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
    tags: { name: "checkout" },
  });
  check(res, { "201 Created": (r) => r.status === 201 });
}
```

k6 컨테이너를 앱과 같은 compose 네트워크(`--network order-api-nest_default`)에 붙여서 `http://api:4000`으로 부른다.

호스트를 거치지 않으니 측정에 섞이는 것이 줄어든다.

### 작업 3. [실행] 한 번 돌려 보기

```sh
docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run /scripts/checkout.js
```

- 첫 줄은 작업 1의 SQL을 DB 컨테이너 안의 `psql`에 표준 입력으로 흘려 넣는다. `-T`는 가상 터미널(TTY)을 붙이지 않는 옵션이다. 사람이 입력하는 게 아니라 `<`로 파일을 흘려 넣을 때는 터미널을 끈다.

- 둘째 줄은 아무 `-e`도 주지 않았으므로 시나리오의 기본값(VU 20명, 20초)으로 한 번 돈다.

- 1장 작업 2의 `npx prisma db seed`를 먼저 해 두어야 한다. 시드가 상품 id를 1, 2로 되감은 뒤라야 새 상품이 3~52번이 된다.

#### 시드 SQL의 출력

```text
INSERT 0 50
UPDATE 2
 products | total_stock
----------+-------------
       52 |    52000000
```

- `INSERT 0 50`: 50행을 넣었다. 앞의 `0`은 옛 PostgreSQL의 흔적(OID) 자리라 늘 0이다.

- `UPDATE 2`: 기존 상품 1, 2번의 재고를 고쳤다.

- 마지막 `SELECT`: 상품 52개(시드 2 + 부하용 50), 재고 합계 52 × 1,000,000이다. 이 숫자가 다르면 시드 없이 넣었거나 두 번 넣은 것이다.

#### k6의 출력

맨 위의 k6 로고와 설정 안내, 1초마다 찍히는 진행 막대는 뺐다.

```text
  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=79.66ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS

    checks_total.......: 8182    407.59493/s
    checks_succeeded...: 100.00% 8182 out of 8182
    checks_failed......: 0.00%   0 out of 8182

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=48.81ms min=21.33ms med=43.93ms max=291.39ms p(90)=67ms    p(95)=79.66ms
      { expected_response:true }...: avg=48.81ms min=21.33ms med=43.93ms max=291.39ms p(90)=67ms    p(95)=79.66ms
      { name:checkout }............: avg=48.81ms min=21.33ms med=43.93ms max=291.39ms p(90)=67ms    p(95)=79.66ms
    http_req_failed................: 0.00%  0 out of 8183
    http_reqs......................: 8183   407.644746/s

    EXECUTION
    iteration_duration.............: avg=48.9ms  min=21.39ms med=44.02ms max=291.47ms p(90)=67.12ms p(95)=79.76ms
    iterations.....................: 8182   407.59493/s
    vus............................: 20     min=20        max=20
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 4.1 MB 206 kB/s
    data_sent......................: 2.8 MB 139 kB/s


default ✓ [ 100% ] 20 VUs  20s
```

#### 결과 읽기: 위에서 아래로

1. **`THRESHOLDS`부터 본다.** `options.thresholds`에 적은 두 기준선이 통과(`✓`)했는지가 맨 위에 모인다. 둘 다 `✓`이면 k6는 종료 코드 0으로 끝난다. 하나라도 `✗`이면 99다.

   - `p(95)=79.66ms`: 결제 요청 95%가 80ms 안에 끝났다. 기준 200ms보다 한참 아래다.

   - `rate=0.00%`: 실패한 요청이 없다. 이것이 0%가 아니면 아래의 응답 시간은 믿지 않는다(아래 "처음 돌렸을 때").

2. **`checks`는 `check()`가 센 것이다.** 시나리오의 `"201 Created"` 조건을 8,182번 검사해 모두 통과했다. 실패가 있으면 `✗ 201 Created`와 함께 몇 번 실패했는지 나온다.

3. **`HTTP`의 `http_req_duration`이 응답 시간 분포다.**

   - `avg`(평균) 48.81ms, `med`(중앙값) 43.93ms, `p(95)` 79.66ms, `max` 291.39ms. 평균과 중앙값은 비슷한데 최댓값은 여섯 배다. 0장 개념 1에서 말한 "꼬리"가 이것이다.

   - 아래의 `{ expected_response:true }`는 성공한 응답만, `{ name:checkout }`은 `tags`로 이름 붙인 결제 요청만 모은 것이다. 지금은 전부 성공이고 거의 전부 결제라 세 줄이 같다. 실패가 섞이면 첫 줄과 둘째 줄이 갈라진다(6단계 "시험해보기"에서 실제로 갈라진 출력을 본다).

4. **`http_reqs`가 처리량이다.** 20초 동안 8,183건, 초당 약 408건이다.

5. **요청 수와 반복 수가 1 차이 난다.** `http_reqs`는 8,183, `iterations`와 `checks`는 8,182다. 남는 하나는 `setup()`의 로그인 요청이다. 로그인은 `default` 반복이 아니라서 `iterations`에 안 들어가고, `name:checkout` 태그도 없어서 기준선에서도 빠진다.

6. **`EXECUTION`은 가상 사용자 쪽에서 본 숫자다.** `iteration_duration`은 `default` 함수 한 번에 걸린 시간인데, 요청 하나만 보내므로 `http_req_duration`과 거의 같다. `vus=20 min=20 max=20`은 20명이 처음부터 끝까지 유지됐다는 뜻이다.

7. **`NETWORK`**: 주고받은 바이트 수다. 이 시나리오에서는 병목이 아니므로 넘어가도 된다.

8. **마지막 줄**: 시나리오 `default`가 VU 20명으로 20초를 다 채우고(`100%`) 끝났다.

> 숫자끼리 맞는지 한 번 확인해 볼 수 있다. 20명이 쉬지 않고 요청 하나에 평균 0.0488초씩 쓰면 20 ÷ 0.0488 ≈ 410건/초로, 실제 처리량 408건/초와 거의 같다. 이 계산이 2단계의 "리틀의 법칙"이다.

> 이 문서의 숫자는 모두 한 PC(8코어 Mac, Docker Desktop)에서 잰 것이다. CPU, Docker에 준 자원, 같이 돌고 있는 프로그램에 따라 절대값은 달라진다. 비교는 같은 기계에서 잰 숫자끼리만 하고, 숫자보다 모양(어디서 멈추는가, 무엇이 더 느린가)을 본다.

### 개념 | k6를 `docker run`으로 바로 돌리는 이유

k6 명령 한 줄을 나눠 읽으면 이렇다.

- `docker run grafana/k6`: Docker Hub의 `grafana/k6` 이미지로 컨테이너를 하나 만들어 실행한다. 이미지 안에 k6 실행 파일이 이미 들어 있다.

- `--rm`: k6가 끝나면 컨테이너를 지운다. 측정 한 번이 컨테이너 하나이고, 끝나면 남는 것이 없다.

- `-i`: 표준 입력을 연다. 스크립트를 `- < checkout.js`처럼 표준 입력으로 넘기는 공식 예시를 따른 것이고, 이 문서처럼 파일을 붙여 넘길 때는 없어도 돈다.

- `--network order-api-nest_default`: 앱과 같은 compose 네트워크에 붙는다. 그래서 `http://api:4000`처럼 서비스 이름으로 부를 수 있다.

- `-v "$PWD/loadtest:/scripts"`: 호스트의 `loadtest/` 폴더를 컨테이너의 `/scripts`로 보이게 한다. 시나리오를 고치면 다음 실행에 바로 반영된다.

- `run -e VUS=50 /scripts/checkout.js`: 이미지 이름 뒤의 인자는 컨테이너 안의 `k6`에 그대로 넘어간다.

#### 세 방식이 적는 것

| 방식 | 무엇을 적는가 | 이 프로젝트에서 |
|---|---|---|
| `docker run` | 이미 있는 이미지를 어떤 옵션으로 한 번 실행할지 | k6 |
| Dockerfile | 이미지를 만드는 절차(무엇을 복사하고, 설치하고, 빌드할지) | `api`, `migrate` 이미지 |
| compose | 함께 떠 있어야 하는 컨테이너들의 구성(이미지, 환경변수, 네트워크, 시작 순서) | db, redis, storage, jaeger, migrate, api |

셋은 서로 대신하는 관계가 아니라 층이 다르다. compose의 `build:`는 Dockerfile을 부르고, compose가 컨테이너를 띄우는 일은 결국 `docker run`을 여러 번 하는 것과 같다.

> C로 치면 Dockerfile은 Makefile, 이미지는 빌드된 실행 파일, `docker run`은 그 실행 파일을 인자와 함께 한 번 실행하는 것, compose는 데몬 여러 개를 정해진 순서로 띄우는 시작 스크립트다.

#### Dockerfile이 필요 없는 이유

Dockerfile은 내 것을 이미지에 구워 넣을 때 쓴다. `api`는 소스, 의존성, 빌드 결과를 이미지에 고정해야 어디서 띄워도 같은 것이 돈다.

k6는 사정이 다르다. 실행 파일은 공식 이미지에 이미 있고, 내가 넣을 것은 시나리오 파일 하나다.

시나리오를 이미지에 구워 넣으면 VU 수를 바꾸는 것 말고 코드를 한 줄 고칠 때마다 다시 빌드해야 한다. 실행할 때 `-v`로 붙이면 빌드할 것이 없다.

#### compose 서비스로 넣을 수도 있다

같은 일을 compose에 적을 수도 있고, 결과는 같다.

```yaml
# docker-compose.yml에 넣는다면 (이 문서는 넣지 않는다)
  k6:
    image: grafana/k6
    profiles: ["loadtest"] # --profile app up에는 뜨지 않는다
    volumes:
      - ./loadtest:/scripts
```

```sh
docker compose run --rm k6 run -e VUS=50 /scripts/checkout.js # 네트워크는 compose가 알아서 붙인다
```

이 문서가 그렇게 하지 않은 이유는 셋이다.

1. k6는 떠 있는 서비스가 아니다. 측정마다 `VUS`, `HOT`, `DURATION`을 바꿔 한 번 돌고 끝난다. 함께 띄우기, 시작 순서, 헬스체크 같은 compose의 장점이 k6에는 쓸 데가 없다.

2. compose 파일은 "측정 대상"의 설정으로 남긴다. 3단계에서 compose의 환경변수를 바꿔 가며 api를 다시 띄우는데, 측정기까지 같은 파일에 있으면 무엇을 바꿔서 숫자가 달라졌는지 읽기 어려워진다.

3. 네트워크를 명령에 드러낸다. `--network`가 보여야 `http://api:4000`이 왜 통하는지(1장 "compose 프로젝트 이름이 정하는 것"), 네트워크 이름이 다르면 어디를 고칠지가 보인다. `docker compose run`은 이것을 알아서 처리해 숨긴다.

> 호스트에 k6를 설치해서 돌려도 된다(도전 과제 1의 숫자가 그렇게 잰 것이다). 그때는 compose 네트워크 밖이므로 `-e API=http://localhost:4000`처럼 호스트 포트로 부른다. 이 문서는 설치 없이 누구나 같은 방법으로 돌릴 수 있게 이미지를 쓴다.

### 용어 | k6 API

- `__ENV.이름`: `-e 이름=값`으로 넘긴 환경변수를 읽는다.

- `options.vus` / `options.duration`: 동시 가상 사용자 수와 테스트 시간이다.

- `options.thresholds`: 기준선이다. 하나라도 넘으면 k6가 실패(종료 코드 99)로 끝난다. 적는 법은 아래 "기준선(`thresholds`)과 `check`의 차이"에서 다룬다.

- `setup()`: 테스트 시작 전에 한 번만 실행되고, 반환값이 `default` 함수의 인자(`data`)가 된다. 아래 "k6 스크립트가 실행되는 순서"에서 다룬다.

- `export default function`: 가상 사용자마다 시간이 다 될 때까지 계속 반복 실행된다.

- `res.json("accessToken")`: 응답 JSON에서 그 이름의 값을 꺼낸다.

- `tags: { name: "checkout" }`: 이 이름으로 결과를 따로 모은다. 기준선의 `http_req_duration{name:checkout}`이 이 태그를 고른다.

- `check(res, { 이름: 조건 })`: 응답이 조건을 만족하는지 세어 기록한다. 실패해도 테스트를 실패시키지 않으며, 아래 "기준선(`thresholds`)과 `check`의 차이"에서 다룬다.

### 개념 | k6 스크립트가 실행되는 순서

`checkout.js`는 JS로 쓰지만 Node가 실행하지 않는다.

k6는 Go로 만든 프로그램이고, 안에 들어 있는 자체 JS 엔진으로 이 파일을 읽는다.

그래서 `k6/http` 같은 모듈은 npm 패키지가 아니라 k6가 기본으로 주는 것이고, `fs`나 `Buffer` 같은 Node API는 없다.

#### 세 단계

파일의 각 부분은 정해진 단계에서 실행된다.

```js
// ① init: 가상 사용자를 준비할 때 실행된다. 여기서는 HTTP 요청을 보낼 수 없다
const API = __ENV.API ?? "http://api:4000";
export const options = { vus: 20, duration: "20s" };

// ② setup: 테스트 전체에서 한 번만 실행된다. 로그인처럼 모두가 같이 쓸 준비를 한다
export function setup() {
  return { token: "..." }; // 이 값이 data로 복사되어 각 가상 사용자에게 간다
}

// ③ default: 가상 사용자 20명이 각자 20초 동안 쉬지 않고 반복한다
export default function (data) {
  // data.token으로 결제 요청
}
```

- `setup`의 반환값은 JSON으로 바꿔서 가상 사용자마다 복사해 준다. 숫자, 문자열, 객체는 되지만 함수는 넘어가지 않는다.

- `default`에서 로그인까지 하면 결제가 아니라 "로그인 + 결제"를 재게 된다. 측정할 요청만 `default`에 둔다.

- 반복 사이에 쉬지 않으므로 VU 20명은 "동시에 요청 20개가 계속 떠 있는 상태"다. 사람처럼 쉬게 하려면 도전 과제 2의 `sleep`을 쓴다.

> C로 치면 `main`이 `setup()`을 한 번 부르고, 그 결과 구조체를 값으로 복사해 스레드 20개에 넘긴 뒤, 각 스레드가 `while (!timeout) worker(data);`를 도는 모양이다.

#### 모든 VU가 같은 토큰을 쓴다

`setup()`에서 `kim`으로 한 번 로그인했으므로 VU 20명이 같은 사용자, 같은 토큰으로 결제한다.

토큰 하나를 공유해도 결제 요청끼리는 서로 막지 않는다. 결제가 잠그는 것은 사용자가 아니라 상품 행(`02`의 `FOR UPDATE`)이기 때문이다.

토큰의 수명(`ACCESS_TOKEN_TTL: 15m`)이 테스트 시간(기본 20초)보다 훨씬 길어서, 측정 도중에 401로 바뀌지 않는다.

### 개념 | 기준선(`thresholds`)과 `check`의 차이

`thresholds`의 키는 "어느 지표를", 값은 "어떤 조건이어야 하는가"를 적는다.

키 뒤의 `{name:checkout}`은 그 지표 중 `name` 태그가 `checkout`인 요청만 골라낸다.

```js
thresholds: {
  http_req_failed: ["rate<0.01"], // 실패한 요청의 비율이 1% 미만
  "http_req_duration{name:checkout}": ["p(95)<200"], // checkout 태그 요청의 p95가 200ms 미만
},
```

`check`도 조건을 적지만 하는 일이 다르다.

| 구분 | `check` | `thresholds` |
|---|---|---|
| 무엇을 보는가 | 응답 하나하나 | 테스트 전체의 지표 |
| 조건이 틀리면 | 실패 횟수만 센다(요약에 `✗`로 표시) | k6가 종료 코드 99로 끝난다 |
| 쓰는 곳 | `default` 함수 안 | `options` |

- `check`가 전부 실패해도 k6는 성공(종료 코드 0)으로 끝난다. check 결과로 테스트를 실패시키려면 `checks: ["rate>0.99"]`처럼 `checks` 지표에 기준선을 건다.

- 키에 `{}`가 들어가면 JS 식별자가 아니므로 `"..."`로 감싸야 한다.

- `p(95)`는 0장 개념 1에서 본 p95다. `avg`, `max`, `p(99)`도 같은 자리에 쓸 수 있다.

> 사람이 결과를 눈으로 읽는다면 `check`로 충분하지만, CI처럼 종료 코드로 성공·실패를 가르는 곳에서는 `thresholds`만 효과가 있다.

### 개념 | 처음 돌렸을 때

시드(1장 작업 2)를 넣기 전에 같은 명령을 돌리면 이렇게 나온다. 사용자 표를 비운 DB에서 재현했다.

```text
  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=23.16ms

    http_req_failed
    ✗ 'rate<0.01' rate=100.00%


  █ TOTAL RESULTS

    checks_total.......: 36763   1832.496858/s
    checks_succeeded...: 0.00%   0 out of 36763
    checks_failed......: 100.00% 36763 out of 36763

    ✗ 201 Created
      ↳  0% — ✓ 0 / ✗ 36763

    HTTP
    http_req_duration.....: avg=10.82ms min=1.93ms med=8.7ms  max=324.6ms  p(90)=16.11ms p(95)=23.17ms
      { name:checkout }...: avg=10.82ms min=1.93ms med=8.7ms  max=324.6ms  p(90)=16.1ms  p(95)=23.16ms
    http_req_failed.......: 100.00% 36764 out of 36764
    http_reqs.............: 36764   1832.546705/s
    ...

time="2026-10-13T05:01:35Z" level=error msg="thresholds on metrics 'http_req_failed' have been crossed"
```

초당 1,832건에 평균 11ms. 작업 3(초당 408건, 평균 49ms)보다 네 배 넘게 빠르다. 너무 좋다. 그리고 실패율이 100%다.

- 응답 시간 기준선(`p(95)<200`)은 `✓`다. 응답 시간만 봤다면 통과로 읽었을 결과다.

- `check`는 36,763번 모두 실패했다(`✗ 201 Created`, `↳ 0%`). 그래도 k6를 실패로 끝낸 것은 `check`가 아니라 `http_req_failed` 기준선이다(위 "기준선과 `check`의 차이").

- `{ expected_response:true }` 줄이 아예 없다. 성공한 응답이 하나도 없어서 모을 것이 없다.

DB에 `kim`이 없어서 로그인이 실패했고, 그 뒤의 결제 요청은 모두 401을 받았다.

401은 토큰 검사에서 바로 돌아오니 빠를 수밖에 없다. DB 잠금도, 재고 차감도, 주문 기록도 하지 않는다.

`setup()`의 로그인이 실패해도 k6는 멈추지 않는다. `res.json("accessToken")`이 값 없이 돌아오고, 모든 결제 요청이 `Bearer undefined`를 달고 나간다.

> **부하 테스트 결과가 이상하게 좋으면 먼저 실패율을 본다.** 기준선(`thresholds`)에 `http_req_failed`를 넣어 둔 이유가 이것이다.

### 남길 것

- **찾아보면 되는 것**: `options`·`thresholds`·`check`·`tags`의 적는 법, `__ENV`, `docker run`의 `--network`·`-v` 플래그. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 부하 결과가 이상하게 좋으면 먼저 실패율을 본다. 실패한 요청은 대개 아무 일도 안 하고 빨리 돌아온다.

  - 측정할 요청만 `default`에 두고, 로그인 같은 준비는 `setup()`에서 한 번만 한다.

- **에러 신호**:

  - `✗ 'rate<0.01' rate=100.00%`인데 처리량이 평소의 몇 배 → 시드(`kim`)를 넣었는지, `setup()`의 로그인이 성공했는지

  - `level=error msg="thresholds on metrics '...' have been crossed"`와 종료 코드 99 → 기준선을 넘었다. 어느 지표인지 메시지에서 본다

  - `docker run`이 `network order-api-nest_default not found`로 실패 → compose 파일이 있는 폴더 이름(1장 작업 1)과 `docker network ls`

  - k6가 `/scripts/checkout.js`를 찾지 못한다 → `order-api-nest`에서 실행했는지(`$PWD/loadtest`가 붙는 폴더)

  - `load-seed.sql`의 마지막 출력이 `52 | 52000000`이 아니다 → `npx prisma db seed`를 먼저 넣었는지, `load-seed.sql`을 두 번 넣었는지

## 3. 2단계: 사용자를 늘려 가며 재기

### 작업 1. [확인] VU 1·10·50으로 재기

1단계 작업 3에서 넣은 시드 그대로 이어서 잰다.

```sh
for v in 1 10 50; do
  docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e VUS=$v -e DURATION=15s /scripts/checkout.js
done
```

- `for v in 1 10 50; do ... done`: 셸 반복문이다. `$v`에 1, 10, 50을 차례로 넣어 k6를 세 번 돌린다. 앞의 측정이 끝나야 다음이 시작되므로 셋이 서로 겹치지 않는다.

- `-e VUS=$v -e DURATION=15s`: 시나리오의 `__ENV.VUS`, `__ENV.DURATION`으로 들어간다. 세 번을 같은 15초로 맞춰야 서로 비교할 수 있다.

- `--quiet`: 시작할 때 나오는 k6 로고·설정 안내와 진행 막대를 끈다. 세 번 이어서 돌리면 진행 막대가 화면을 덮으므로 요약만 남긴다. 그래서 1단계 출력의 마지막 줄(`default ✓ [ 100% ] ...`)도 이번에는 나오지 않는다.

#### 시드는 언제 다시 넣나

측정마다 다시 넣을 필요는 없다. 이 장의 측정(작업 1~3)은 시드를 한 번 넣은 상태에서 이어서 한다.

- **재고는 모자라지 않는다.** 상품마다 1,000,000개이고, 이 장의 측정을 다 합쳐도 상품 하나에서 팔리는 것은 1만 개 남짓이다.

- **`load-seed.sql`만 다시 넣는 것은 피한다.** 이 파일은 주문을 지우지 않고 상품 50개를 더 만들고(53~102번) 1, 2번의 재고만 1,000,000으로 되돌린다. 작업 3에서 1번을 판 뒤에 다시 넣으면 팔린 기록은 남고 재고만 되돌아가, 작업 4의 장부 확인이 `f`로 나온다.

- **처음부터 깨끗이 하려면 둘을 함께 넣는다.** `npx prisma db seed`가 주문·outbox까지 비우고 상품 id를 되감은 뒤, `load-seed.sql`이 부하용 상품을 다시 만든다.

```sh
npx prisma db seed && docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
```

> 측정 사이에 앞 측정의 뒷일(결제마다 쌓인 outbox 행을 서버가 처리하는 일)이 섞이는 것까지 없애고 싶을 때도 이렇게 한다. 도전 과제 1이 매번 이렇게 했다.

#### 출력

세 번의 요약이 차례로 나온다. 모양은 1단계 작업 3과 같다.

<details>
<summary>VU 1·10·50 전체 출력</summary>

```text
  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=5.35ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 5127    340.643728/s
    checks_succeeded...: 100.00% 5127 out of 5127
    checks_failed......: 0.00%   0 out of 5127

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=2.85ms min=2.04ms med=2.34ms max=43.87ms p(90)=4.16ms p(95)=5.35ms
      { expected_response:true }...: avg=2.85ms min=2.04ms med=2.34ms max=43.87ms p(90)=4.16ms p(95)=5.35ms
      { name:checkout }............: avg=2.84ms min=2.04ms med=2.34ms max=22.87ms p(90)=4.16ms p(95)=5.35ms
    http_req_failed................: 0.00%  0 out of 5128
    http_reqs......................: 5128   340.710169/s

    EXECUTION
    iteration_duration.............: avg=2.91ms min=2.09ms med=2.4ms  max=23.04ms p(90)=4.29ms p(95)=5.49ms
    iterations.....................: 5127   340.643728/s
    vus............................: 1      min=1         max=1
    vus_max........................: 1      min=1         max=1

    NETWORK
    data_received..................: 2.6 MB 172 kB/s
    data_sent......................: 1.7 MB 116 kB/s

  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=34.07ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 7241    481.158114/s
    checks_succeeded...: 100.00% 7241 out of 7241
    checks_failed......: 0.00%   0 out of 7241

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=20.64ms min=9.65ms med=17.12ms max=446.48ms p(90)=27.64ms p(95)=34.13ms
      { expected_response:true }...: avg=20.64ms min=9.65ms med=17.12ms max=446.48ms p(90)=27.64ms p(95)=34.13ms
      { name:checkout }............: avg=20.63ms min=9.65ms med=17.12ms max=446.48ms p(90)=27.63ms p(95)=34.07ms
    http_req_failed................: 0.00%  0 out of 7242
    http_reqs......................: 7242   481.224563/s

    EXECUTION
    iteration_duration.............: avg=20.71ms min=9.7ms  med=17.2ms  max=446.66ms p(90)=27.72ms p(95)=34.19ms
    iterations.....................: 7241   481.158114/s
    vus............................: 10     min=10        max=10
    vus_max........................: 10     min=10        max=10

    NETWORK
    data_received..................: 3.7 MB 243 kB/s
    data_sent......................: 2.5 MB 164 kB/s

  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=120.51ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 7983    528.844401/s
    checks_succeeded...: 100.00% 7983 out of 7983
    checks_failed......: 0.00%   0 out of 7983

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=94.04ms min=14.78ms med=90.89ms max=235.59ms p(90)=110.32ms p(95)=120.51ms
      { expected_response:true }...: avg=94.04ms min=14.78ms med=90.89ms max=235.59ms p(90)=110.32ms p(95)=120.51ms
      { name:checkout }............: avg=94.05ms min=14.78ms med=90.89ms max=235.59ms p(90)=110.32ms p(95)=120.51ms
    http_req_failed................: 0.00%  0 out of 7984
    http_reqs......................: 7984   528.910648/s

    EXECUTION
    iteration_duration.............: avg=94.12ms min=15.32ms med=90.97ms max=235.71ms p(90)=110.37ms p(95)=120.57ms
    iterations.....................: 7983   528.844401/s
    vus............................: 50     min=50        max=50
    vus_max........................: 50     min=50        max=50

    NETWORK
    data_received..................: 4.0 MB 268 kB/s
    data_sent......................: 2.7 MB 180 kB/s
```

</details>

#### 세 요약에서 뽑을 숫자

요약 하나에서 세 줄만 뽑아 표로 옮긴다.

- `vus`: 몇 명으로 잰 요약인지. 세 요약이 연달아 붙어 나오므로 이것으로 구분한다.

- `http_reqs`의 `/s`: 처리량.

- `THRESHOLDS`의 `p(95)`: 결제 요청(`name:checkout`)만의 p95. `HTTP` 첫 줄의 p95는 `setup()`의 로그인 한 건이 섞여 있어 아주 조금 다르다(VU 10에서 34.13ms와 34.07ms).

위 출력을 옮기면 이렇다.

| VU | 처리량(초당) | 평균 | p95 | max |
|---|---|---|---|---|
| 1 | 341 | 2.84ms | 5.35ms | 22.87ms |
| 10 | 481 | 20.63ms | 34.07ms | 446.48ms |
| 50 | 529 | 94.05ms | 120.51ms | 235.59ms |

- **사람을 10배(1 → 10) 늘렸는데 처리량은 1.4배다.** 1명과 10명 사이 어딘가에서 이미 상한 근처에 닿았다.

- **10 → 50은 다섯 배인데 처리량은 481에서 529로 10%만 늘었다.** 대신 평균은 약 4.6배(21 → 94ms), p95는 약 3.5배(34 → 121ms)가 되었다. 0장 개념 1의 "대기열만 길어진다"가 숫자로 나왔다.

- **`max`는 p95와 따로 논다.** VU 10의 `max` 446ms는 VU 50의 `max`보다도 크다. 요청 한두 개가 운 나쁘게 오래 걸린 값이라, 한 번의 측정에서 `max`로 결론을 내리지 않는다.

#### 세 번 재 보기

같은 명령을 세 번 더 돌렸다. 처리량(초당)과 p95다.

| VU | 1회 | 2회 | 3회 |
|---|---|---|---|
| 1 | 341 / 5.35ms | 339 / 5.12ms | 340 / 5.21ms |
| 10 | 481 / 34.07ms | 489 / 33.54ms | 488 / 33.34ms |
| 50 | 529 / 120.51ms | **373 / 237.6ms ✗** | 526 / 117.91ms |

- VU 1, 10은 세 번이 거의 같다. 상한 근처인 VU 50은 2회에서만 처리량이 30% 떨어지고 p95가 기준을 넘었다.

- 코드도 설정도 같으니 바뀐 것은 기계의 상태뿐이다. 같은 PC에서 함께 도는 일(다른 프로그램, 앞 측정이 남긴 outbox 처리)이 CPU를 나눠 가져가면 이렇게 된다. 상한에 붙어 있을 때일수록 이런 방해에 크게 흔들린다.

> 한 번 잰 숫자로 결론 내리지 않는다. 최소 두세 번 재서 같은 모양이 나오는지 본다. 이 문서의 표가 회차별 숫자를 같이 적는 이유다.

### 개념 | 리틀의 법칙으로 확인하기

계산으로도 확인할 수 있다. 동시에 일하는 사람 수 = 처리량 × 평균 응답 시간이다(리틀의 법칙).

50명 ÷ 초당 529건이면, 요청 하나가 평균 약 0.095초 걸려야 한다.

처리량이 멈춘 상태에서 사람을 늘리면 그만큼 평균 대기만 늘어난다는 뜻이다.

같은 식으로 VU 1명을 보면 1 ÷ 341 ≈ 0.003초다. 혼자일 때 요청 하나가 실제로 걸리는 시간이 약 3ms이고, 50명일 때의 나머지 시간은 대부분 줄 서서 기다린 시간이다.

작업 1의 출력에 있는 `avg`로 맞춰 볼 수 있다. 계산한 값과 k6가 잰 평균이 거의 같다.

| VU | 사람 ÷ 처리량 | k6의 `avg` |
|---|---|---|
| 1 | 1 ÷ 341 ≈ 2.9ms | 2.84ms |
| 10 | 10 ÷ 481 ≈ 20.8ms | 20.63ms |
| 50 | 50 ÷ 529 ≈ 94.5ms | 94.05ms |

> 이 식이 맞는 것은 k6의 VU가 쉬지 않고 요청을 반복하기 때문이다. 반복 사이에 `sleep`을 넣으면(도전 과제 2) 쉬는 시간까지 "걸린 시간"에 넣어 계산해야 한다.

### 작업 2. [확인] 병목 찾기: 컨테이너별 CPU

처리량이 멈췄다는 것은 어딘가 상한에 닿았다는 뜻이다. 그곳이 어느 컨테이너인지 CPU 사용량으로 찾는다.

**k6가 도는 동안** 재야 한다. 끝난 뒤에 재면 모든 컨테이너가 쉬고 있다.

```sh
# 터미널 1: 옮겨 칠 시간을 넉넉히(60초) 주고 VU 50명으로 돌린다
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run -e VUS=50 -e DURATION=60s /scripts/checkout.js

# 터미널 2: 터미널 1의 진행 막대가 움직이는 동안 친다
docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}}'
```

- `--no-stream`: 한 번만 재서 찍고 끝낸다. 빼면 `top`처럼 화면이 계속 갱신되고 `Ctrl+C`로 나온다.

- `--format`: 기본 출력은 메모리·네트워크·디스크 열까지 나와 넓으므로 이름과 CPU만 고른다. `{{ }}`는 Go 템플릿 문법이다.

> 터미널 하나로 하려면 k6를 뒤에서 돌리고 중간에 잰다.  
> `docker run ... -e DURATION=30s /scripts/checkout.js > /dev/null & sleep 15; docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}}'; wait`  
> `&`는 명령을 뒤로 보내고, `> /dev/null`은 k6 요약이 섞이지 않게 버리고, `wait`는 k6가 끝날 때까지 기다린다.

#### 출력 읽기

k6가 20초쯤 돌았을 때 잰 결과다.

```text
flamboyant_wing CPU=12.28%
order-api-nest-api-1 CPU=107.51%
order-api-nest-db-1 CPU=40.35%
order-api-nest-redis-1 CPU=0.75%
order-api-nest-jaeger-1 CPU=8.10%
order-api-nest-storage-1 CPU=0.03%
```

- **100%가 CPU 코어 하나다.** 코어가 여덟 개면 전부 써야 800%다. 108%는 "코어 하나를 꽉 채우고 조금 더"다. 넘는 몫은 Node의 보조 스레드(GC, 파일·DNS 작업용 스레드 풀)다.

- **API가 상한이다.** Node는 JS를 스레드 하나에서 실행하므로, 코어 하나가 이 서버 한 대의 상한이다. DB는 40%로 아직 여유가 있고, Redis는 결제 경로에서 거의 쓰지 않아 놀고 있다.

- **jaeger도 8%를 쓴다.** API가 요청마다 추적(span)을 보내고 있기 때문이다. 이 비용은 3단계에서 따로 잰다.

- **맨 위의 `flamboyant_wing`은 k6 컨테이너다.** `docker run`에 `--name`을 주지 않으면 Docker가 이렇게 무작위 이름을 붙인다. 부하를 거는 쪽도 같은 PC의 CPU를 12% 쓰고 있다는 뜻이다.

10초 뒤에 한 번 더 재면 API가 146%, jaeger가 23%로 나왔다. `--no-stream`은 그 순간 하나만 찍으므로 값이 출렁인다. 두세 번 찍어서 "API가 100% 이상으로 붙어 있다"는 모양을 본다.

> 처리량을 더 올리려면 `04`처럼 서버를 여러 대로 늘린다. `04`에서 그걸 위해 알림(Redis 어댑터), 작업 큐, 리더 선출을 미리 준비해 두었다. 실제로 늘려 보는 것은 도전 과제 1이다.

#### 모두 몇 %밖에 안 나오면

```text
order-api-nest-api-1 CPU=4.77%
order-api-nest-db-1 CPU=1.34%
order-api-nest-redis-1 CPU=2.02%
order-api-nest-jaeger-1 CPU=0.29%
order-api-nest-storage-1 CPU=0.06%
```

k6가 끝난 뒤에 잰 것이다. k6 컨테이너가 목록에 없는 것도 그래서다. 이 값으로는 병목을 말할 수 없다.

남은 몇 %는 헬스체크, outbox 처리처럼 요청이 없어도 도는 일이다. 부하 뒤에는 결제마다 쌓인 outbox 행을 서버가 조금씩 내보내느라 API가 한동안 몇 %를 쓴다.

터미널 1의 진행 막대가 아직 움직이는지 확인하고 다시 잰다.

### 작업 3. [확인] 인기 상품 하나에 몰리게 하기(`HOT=1`)

```sh
for v in 10 50; do
  docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e VUS=$v -e HOT=1 -e DURATION=15s /scripts/checkout.js
done
```

작업 1과 같은 명령에 `-e HOT=1`만 더했다. 시나리오가 3~52번 중 하나를 고르는 대신 모두 1번 상품을 산다. 시드는 다시 넣지 않는다(작업 1 "시드는 언제 다시 넣나").

#### 출력

<details>
<summary>VU 10·50 전체 출력</summary>

```text
  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=24.24ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 5950    395.198543/s
    checks_succeeded...: 100.00% 5950 out of 5950
    checks_failed......: 0.00%   0 out of 5950

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=25.14ms min=5.55ms med=8.39ms max=2.01s p(90)=17.94ms p(95)=24.32ms
      { expected_response:true }...: avg=25.14ms min=5.55ms med=8.39ms max=2.01s p(90)=17.94ms p(95)=24.32ms
      { name:checkout }............: avg=25.14ms min=5.55ms med=8.39ms max=2.01s p(90)=17.88ms p(95)=24.24ms
    http_req_failed................: 0.00%  0 out of 5951
    http_reqs......................: 5951   395.264963/s

    EXECUTION
    iteration_duration.............: avg=25.21ms min=5.61ms med=8.46ms max=2.01s p(90)=18.01ms p(95)=24.34ms
    iterations.....................: 5950   395.198543/s
    vus............................: 10     min=10        max=10
    vus_max........................: 10     min=10        max=10

    NETWORK
    data_received..................: 3.0 MB 201 kB/s
    data_sent......................: 2.0 MB 134 kB/s

  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=184.21ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%

  █ TOTAL RESULTS

    checks_total.......: 4905    323.989253/s
    checks_succeeded...: 100.00% 4905 out of 4905
    checks_failed......: 0.00%   0 out of 4905

    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=153.33ms min=8.58ms med=137.1ms  max=1.05s p(90)=166.12ms p(95)=184.2ms
      { expected_response:true }...: avg=153.33ms min=8.58ms med=137.1ms  max=1.05s p(90)=166.12ms p(95)=184.2ms
      { name:checkout }............: avg=153.35ms min=8.58ms med=137.1ms  max=1.05s p(90)=166.13ms p(95)=184.21ms
    http_req_failed................: 0.00%  0 out of 4906
    http_reqs......................: 4906   324.055306/s

    EXECUTION
    iteration_duration.............: avg=153.44ms min=8.92ms med=137.19ms max=1.05s p(90)=166.23ms p(95)=184.29ms
    iterations.....................: 4905   323.989253/s
    vus............................: 50     min=50        max=50
    vus_max........................: 50     min=50        max=50

    NETWORK
    data_received..................: 2.5 MB 165 kB/s
    data_sent......................: 1.7 MB 110 kB/s
```

</details>

#### 분산과 나란히 놓기

작업 1의 "세 번 재 보기"와 같은 회차에 이어서 쟀다. 처리량(초당)과 p95다.

| VU | 분산 | `HOT=1` 1회 | `HOT=1` 2회 | `HOT=1` 3회 |
|---|---|---|---|---|
| 10 | 481~489 / 33~34ms | 395 / 24.24ms | 315 / 58.13ms | 374 / 30.27ms |
| 50 | 526~529 / 118~121ms(2회의 373은 뺐다) | 324 / 184.21ms | 340 / 186.17ms | 318 / 191.2ms |

- **같은 서버인데 VU 50에서 처리량이 35~40% 낮다.** 분산은 526~529건/초, `HOT=1`은 318~340건/초다. 그리고 10명에서 50명으로 늘려도 처리량이 오르지 않는다. 사람을 늘려도 처리량이 늘지 않는 상한이 분산 때보다 낮은 곳에 있다.

- **VU 50의 p95는 기준(200ms) 언저리다.** 이 세 번은 184~191ms로 기준 바로 아래였고, 분산(118~121ms)의 1.5배를 넘는다. 문서 맨 위 "목표"의 명령(20초, 시드를 막 넣은 직후)으로 세 번 재면 284~357ms로 세 번 모두 기준을 넘었다. 그러면 `THRESHOLDS`에 `✗`가 붙고 맨 끝에 이 줄이 찍힌다.

  ```text
  ✗ 'p(95)<200' p(95)=357.36ms
  time="2026-10-13T05:37:34Z" level=error msg="thresholds on metrics 'http_req_duration{name:checkout}' have been crossed"
  ```

  결과 요약은 그대로 다 나오고 종료 코드만 99가 된다. `for`로 이어 돌렸다면 어느 회차에서 넘었는지는 `vus` 줄로 구분한다.

- **실패율은 0%다.** 느려졌을 뿐 결제가 실패하지는 않았다. 재고가 넉넉하니 409도 없다.

- **10명일 때 `med`는 8~11ms인데 `max`는 1.5~2.5초다.** 1회 출력을 보면 평균 25.14ms, 중앙값 8.39ms, 최댓값 2.01s다. 대부분은 분산 때(중앙값 17ms)보다도 빨리 끝나는데, 몇 개가 아주 오래 기다려 평균을 끌어올렸다. 같은 행 하나를 두고 줄을 서면 운 나쁜 요청이 긴 꼬리를 만든다. 평균만 봤다면 놓쳤을 모양이다.

### 개념 | 같은 행을 잠그면 한 줄로 선다

`02`의 `SELECT ... FOR UPDATE`가 같은 상품 행을 잠그므로, 1번 상품을 사는 결제들은 **한 줄로 서서** 차례로 처리된다.

여러 상품에 나눠 살 때는 서로 다른 행을 잠그니 겹쳐서 진행된다.

잠금이 정확성을 지키는 대가가 이것이다.

- 줄을 서는 동안 각 결제는 트랜잭션과 DB 커넥션을 쥔 채 기다린다. 기다리는 결제가 많아지면 커넥션 풀이 차고, 그 뒤의 요청은 트랜잭션을 시작하기도 전에 기다린다.

- 그래서 같은 VU 50명이라도 `HOT=1`에서는 API의 CPU가 아니라 행 잠금이 상한이 된다. 서버의 CPU를 늘리는 것으로는 이 줄이 짧아지지 않는다.

> 선착순 특가처럼 한 상품에 몰리는 상황은 서버를 늘려도 그 행 하나의 줄은 줄어들지 않는다.

### 작업 4. [확인] 장부가 맞는지 확인

부하가 끝난 뒤 DB에서 확인한다.

```sh
docker compose exec db psql -U order -d order_api
```

```sql
SELECT sum(1000000 - stock) = (SELECT coalesce(sum(quantity), 0) FROM order_items) AS 장부일치,
       sum(1000000 - stock) AS 팔린수량
FROM products;
```

```text
 장부일치 | 팔린수량
----------+----------
 t        |    72839
(1 row)
```

1단계 작업 3부터 이 장의 작업 1~3(작업 2의 60초 측정 포함)까지 시드를 다시 넣지 않고 이어서 돌린 뒤의 결과다.

7만 2천 건이 넘게 팔린 뒤에도 줄어든 재고와 팔린 수량이 정확히 같다(`t`).

- 모든 상품의 처음 재고가 1,000,000이라서 `1000000 - stock`이 그 상품의 팔린 수량이 된다.

- 72,839는 각 측정의 `iterations`를 모두 더한 값과 같다. 결제 한 번이 상품 하나를 1개씩 사기 때문이다. 1단계 작업 3의 8,182가 그 첫 몫이다.

> 빠르기만 하고 틀린 서버는 의미가 없으니, 부하 테스트 뒤에는 항상 정확성도 같이 본다.

### 남길 것

- **찾아보면 되는 것**: `docker stats`의 `--no-stream`·`--format` 문법, k6의 `--quiet`, 리틀의 법칙 식. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 사용자를 늘렸는데 처리량은 그대로이고 p95만 늘면 상한에 닿은 것이다. 그때 CPU를 다 쓰는 컨테이너가 병목이다. Node 서버 한 대는 CPU 하나가 상한이다.

  - 같은 행을 잠그는 요청은 서버가 몇 대든 한 줄로 선다. 인기 상품 시나리오는 따로 잰다.

  - 상한 근처의 숫자는 회차마다 크게 흔들린다. 한 번 잰 숫자로 결론 내리지 않고, 두세 번 재서 같은 모양이 나오는지 본다.

- **에러 신호**:

  - 처리량이 늘지 않고 p95만 는다 → `docker stats`에서 CPU를 다 쓰는 컨테이너

  - `docker stats`의 모든 컨테이너가 몇 % 이하이고 k6 컨테이너가 목록에 없다 → k6가 끝난 뒤에 쟀다. 부하가 걸려 있는 동안 다시 잰다

  - `HOT=1`에서만 p95가 기준을 넘는다(`have been crossed`) → 같은 상품 행의 `FOR UPDATE` 잠금 대기

  - 장부 확인 쿼리가 `f` → 재고를 앱이 읽은 값으로 덮어쓰는 곳(`02`의 갱신 손실), 또는 측정 도중 `load-seed.sql`로 재고를 다시 채웠는지

## 4. 3단계: 관측에도 비용이 든다

`07`에서 붙인 추적과 요청 로그는 공짜가 아니다. compose의 `api`에 끄고 켤 수 있는 환경변수를 둔다.

### 작업 1. [커밋] compose에 관측 스위치 추가

```yaml
# order-api-nest/docker-compose.yml
# api의 environment, OTEL_SERVICE_NAME 바로 아래에 추가한다
      OTEL_SDK_DISABLED: ${OTEL_SDK_DISABLED-false}   # true면 추적을 끈다(이 문서의 비교 실험)
      # 샘플링: 요청의 일부만 추적한다. parentbased_traceidratio + 0.1 = 앞단에서 이미 정해 준 결정이 없으면 10%만 기록
      OTEL_TRACES_SAMPLER: ${OTEL_TRACES_SAMPLER-parentbased_always_on}
      OTEL_TRACES_SAMPLER_ARG: ${OTEL_TRACES_SAMPLER_ARG-1}
      LOG_LEVEL: ${LOG_LEVEL-info}
```

OpenTelemetry SDK는 위의 `OTEL_` 환경변수들을 스스로 읽으므로 코드는 바꾸지 않는다.

`LOG_LEVEL`은 `07`부터 `app.module.ts`의 pino 설정이 읽고 있다.

```ts
// src/app.module.ts
// 이미 있는 코드다. 바꾸지 않는다
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info", // warn이면 요청마다 찍히는 info 로그가 빠진다
        // ...
```

### 작업 2. [확인] 설정마다 다시 띄우고 재기

VU 20명, 15초씩 같은 조건으로 잰다. 설정을 바꿀 때마다 `api`만 다시 띄운다.

```sh
# ① 추적 100%, 요청 로그 info (기본값. 앞에 아무것도 붙이지 않는다)
docker compose --profile app up -d api
# ② 추적 10% 샘플링
OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.1 docker compose --profile app up -d api
# ③ 추적 끔
OTEL_SDK_DISABLED=true docker compose --profile app up -d api
# ④ 추적 끔 + 요청 로그 끔
OTEL_SDK_DISABLED=true LOG_LEVEL=warn docker compose --profile app up -d api

# 매번 api가 healthy가 된 뒤에 잰다
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e VUS=20 -e DURATION=15s /scripts/checkout.js

# 다 재고 나면 기본값(①)으로 되돌려 둔다
docker compose --profile app up -d api
```

마지막 줄을 빼먹으면 api가 ④(추적 끔, 요청 로그 끔)인 채로 남는다. 이 작업이 `[확인]`인 것은 이 줄로 처음 상태에 돌아오기 때문이다. 6단계 "진단 1"처럼 Jaeger와 로그로 느린 요청을 찾으려면 추적과 로그가 켜져 있어야 한다.

환경변수가 바뀌면 `up -d`가 그 컨테이너만 새로 만든다. 앞에 붙인 값은 그 명령에만 적용되므로, 아무것도 붙이지 않고 다시 띄우면 기본값(①)으로 돌아간다.

값이 컨테이너까지 갔는지는 띄운 뒤 바로 확인한다.

```sh
docker compose exec api printenv OTEL_SDK_DISABLED OTEL_TRACES_SAMPLER OTEL_TRACES_SAMPLER_ARG LOG_LEVEL
```

```text
false
parentbased_traceidratio
0.1
info
```

②로 띄웠을 때의 출력이다. 네 줄이 위 명령의 네 이름 순서대로 나온다.

설정마다 세 번씩 쟀다. 처리량(초당)과 p95다.

| 설정 | 1회 | 2회 | 3회 | 처리량 평균 |
|---|---|---|---|---|
| ① 추적 100%, 요청 로그 info | 419 / 75.01ms | 456 / 64.7ms | 400 / 80.15ms | 425 |
| ② 추적 10% 샘플링 | 535 / 56.9ms | 583 / 51.41ms | 606 / 48.19ms | 575 |
| ③ 추적 끔 | 708 / 43.61ms | 829 / 33.03ms | 659 / 73.9ms | 732 |
| ④ 추적 끔 + 요청 로그 끔(`LOG_LEVEL=warn`) | 757 / 38.74ms | 892 / 31.52ms | 902 / 30.79ms | 850 |

#### 숫자 읽기

모든 요청을 추적하면(①) 처리량이 끈 것(③)보다 약 40% 낮다.

샘플링 10%(②)로 일부를 되찾지만 끈 것만큼은 아니다. 기록을 보내는 비용은 줄어도, 모든 함수 호출을 감싸는 계측 자체의 비용은 남기 때문이다.

로그 레벨에 따라서도(③ → ④) 처리량이 약 16% 차이 났다. 요청마다 JSON 한 줄을 만들어 쓰는 일이 빠졌다.

회차마다 출렁임(③의 659~829)이 설정 사이의 차이보다 작지 않은 칸도 있다. 그래서 한 번이 아니라 세 번을 재서 평균의 차이를 본다.

> 1·2단계의 숫자는 모두 ①(기본값)에서 잰 것이다. 같은 VU 20명인 1단계 작업 3의 408건/초가 ①의 400~456건/초와 같은 범위에 있는 것도 그래서다.

#### 샘플링이 정말 10%인가

pino 계측이 로그 한 줄마다 `trace_flags`를 붙인다. `01`이면 기록된 요청, `00`이면 기록하지 않은 요청이다.

②로 띄워 세 번 잰 직후, 그동안의 로그에서 둘을 셌다.

```sh
docker compose logs api --since 2m --no-log-prefix | grep -c '"trace_flags":"01"'
docker compose logs api --since 2m --no-log-prefix | grep -c '"trace_flags":"00"'
```

```text
5191
47558
```

5,191 ÷ (5,191 + 47,558) ≈ 9.8%다.

같은 방법으로 ①을 세면 `01`만 39,238줄 나오고 `00`은 하나도 없다. ③은 추적이 꺼져 둘 다 0이고, ④는 요청 로그 자체가 없어 셀 줄이 없다.

#### 그래서 어떻게 하나

결론은 "관측을 끄자"가 아니다. 장애가 났을 때 아무것도 안 남아 있는 것이 훨씬 비싸다.

운영에서는 **샘플링 비율과 로그 레벨을 조절 가능한 설정으로** 두고, 평소에는 낮게, 문제를 쫓을 때는 높여서 쓴다.

> 이 숫자들은 한 PC 위 컨테이너에서 잰 것이라 절대값보다 차이의 크기를 본다.

### 용어 | OpenTelemetry 환경변수

- `OTEL_SDK_DISABLED`: `true`면 추적을 끈다.

- `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`: 샘플링, 즉 요청의 일부만 추적하는 방식과 비율이다. 기본값 `parentbased_always_on`은 모두 기록하고, `parentbased_traceidratio`와 `0.1`을 주면 10%만 기록한다. 이름의 `parentbased`가 뜻하는 것은 아래 "샘플링 결정은 요청의 입구에서 한 번 내린다"에서 다룬다.

- `${이름-기본값}`(compose 문법): 셸(또는 `.env` 파일)에 그 환경변수가 있으면 그 값을, 없으면 기본값을 넣는다. 그래서 `OTEL_SDK_DISABLED=true docker compose ...`처럼 앞에 붙인 값이 컨테이너까지 전달된다.

### 개념 | 샘플링 결정은 요청의 입구에서 한 번 내린다

추적 하나(trace)는 여러 span으로 이루어진다. 결제 요청 하나에 HTTP 처리, DB 쿼리 같은 span이 여러 개 붙는다.

샘플링을 span마다 따로 정하면 한 요청의 추적이 중간중간 빠진 채로 남는다.

그래서 **결정은 맨 처음 span(root)에서 한 번만** 내리고 나머지는 그 결정을 따른다.

| 값 | root span에서 | 자식 span에서 |
|---|---|---|
| `parentbased_always_on` | 항상 기록 | 부모의 결정을 따른다 |
| `parentbased_traceidratio` + `0.1` | trace id를 보고 10%만 기록 | 부모의 결정을 따른다 |

내려진 결정은 "기록함(`01`)/안 함(`00`)" 플래그로 span에 붙어 다닌다. 위에서 로그의 `trace_flags`를 세어 비율 9.8%를 확인한 것이 이 플래그다.

- `parentbased`의 "부모"는 다른 서비스일 수도 있다. 앞단 서비스가 `traceparent` 헤더에 결정을 실어 보내면 이 서버는 비율을 다시 계산하지 않고 그 결정을 따른다. k6 요청에는 그 헤더가 없으므로 여기서는 항상 이 서버가 root다.

- 기록하지 않기로 한 요청도 span 객체는 만들어지고 계측 코드도 돈다. 속성 기록과 내보내기(export)가 빠질 뿐이다. 10%로 줄여도 끈 것만큼 빨라지지 않은 이유가 이것이다.

> 샘플링 비율은 "요청 몇 개를 기록하는가"이지 "span 몇 개를 기록하는가"가 아니다. 기록된 요청은 처음부터 끝까지 다 남는다.

### 남길 것

- **찾아보면 되는 것**: `OTEL_*` 환경변수 이름과 샘플러 값, compose의 `${이름-기본값}` 문법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 관측은 공짜가 아니다. 모든 요청을 추적하면 처리량이 눈에 띄게 줄고, 샘플링은 내보내는 비용만 줄일 뿐 계측 비용은 남는다.

  - 샘플링 비율과 로그 레벨은 끄고 켜는 것이 아니라 조절하는 설정으로 둔다. 평소에는 낮게, 문제를 쫓을 때는 높게.

- **에러 신호**:

  - `OTEL_SDK_DISABLED=true`로 띄웠는데 숫자가 그대로다 → compose에 `${OTEL_SDK_DISABLED-false}`로 적었는지, `docker compose exec api printenv OTEL_SDK_DISABLED`

  - 10% 샘플링인데 Jaeger에 추적이 거의 다 보인다 → 로그의 `trace_flags`를 세어 `01`의 비율을 본다

  - 측정을 마친 뒤 Jaeger에 새 추적이 안 생기고 요청 로그도 안 찍힌다 → api가 ④로 남아 있다. 아무것도 붙이지 않고 `docker compose --profile app up -d api`

## 5. 4단계: CSP 붙이기

`06`의 `order-console-next`에서 이어 간다.

Next.js 16 문서가 권하는 방식은 요청마다 새 nonce(한 번만 쓰는 무작위 값)를 만들어 CSP에 넣는 것이다.

Next.js는 그 nonce를 읽어 자기가 페이지에 넣는 `<script>`들에 붙이고, 브라우저는 **nonce가 맞는 스크립트만** 실행한다.

Next.js 16에서는 이런 요청 가로채기를 `proxy.ts`에 둔다.

### 작업 1. [커밋] proxy.ts

```ts
// proxy.ts (프로젝트 루트, app/ 폴더와 같은 위치)
import { NextResponse, type NextRequest } from "next/server";

// 페이지 요청마다 새 nonce를 만들어 CSP 헤더에 넣는다
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const storage = process.env.NEXT_PUBLIC_STORAGE_URL ?? "http://localhost:9000";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // 상품 이미지는 저장소(presigned URL)에서 온다
    `img-src 'self' blob: data: ${storage}`,
    "font-src 'self'",
    // fetch가 갈 수 있는 곳: 우리 API와 저장소(업로드 PUT)뿐
    `connect-src 'self' ${api} ${storage}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // 정적 파일과 미리 가져오기(prefetch) 요청에는 붙이지 않는다
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

파일 위치와 함수 이름이 정해져 있다. 프로젝트 루트의 `proxy.ts`에서 `proxy`라는 이름으로 내보내야 Next.js가 찾는다.

`app/` 안처럼 다른 곳에 두면 에러 없이 무시되어 CSP 헤더가 붙지 않는다. 위치를 의심할 때는 빌드 결과에 `Proxy (Middleware)` 줄이 있는지 본다(작업 5).

각 줄이 이 앱의 무엇과 맞물리는지 본다.

| 지시어 | 값 | 이 앱에서의 이유 |
|---|---|---|
| `script-src` | nonce + `'strict-dynamic'` | Next.js가 넣는 스크립트만 실행된다 |
| `img-src` | 저장소 주소 | `06`의 상품 이미지가 `localhost:9000`에서 온다 |
| `connect-src` | API, 저장소 | `05`의 `authFetch`가 4000으로, `06`의 업로드 PUT이 9000으로 간다. 그 밖의 곳으로는 fetch가 나가지 않는다 |
| `frame-ancestors 'none'` | | 다른 사이트가 이 페이지를 `<iframe>`으로 감싸지 못한다(클릭재킹 방지) |
| `object-src 'none'`, `base-uri 'self'` | | 플러그인 콘텐츠와 `<base>` 태그 바꿔치기를 막는다 |

### 작업 2. [커밋] 저장소 주소 환경변수

`.env.local`과 `.env.example`에 저장소 주소를 더한다.

```sh
# order-console-next/.env.local, .env.example
# 상품 이미지 저장소 주소(CSP의 img-src, connect-src에 넣는다)
NEXT_PUBLIC_STORAGE_URL=http://localhost:9000
```

`.env.local`은 `.gitignore`에 들어 있어 커밋되지 않는다. 커밋되는 것은 `.env.example` 쪽이고, 다른 사람은 그것을 복사해 `.env.local`을 만든다.

`NEXT_PUBLIC_`이 붙은 값은 빌드할 때 코드에 박힌다. 값을 바꿨다면 `npm run build`를 다시 해야 운영 서버에 반영된다.

### 용어 | CSP 문법

- 지시어끼리는 `; `로 잇는다. 각 지시어는 `이름 값 값 ...` 형태다.

- `default-src`: 따로 적지 않은 종류의 기본값이다. 모든 지시어가 이 값을 물려받지는 않으며, 아래 "`default-src`가 대신하지 않는 지시어"에서 다룬다.

- `'self'` / `'none'`: 페이지와 같은 출처만 허락한다 / 아무것도 허락하지 않는다.

- `'nonce-값'`: 같은 `nonce` 속성을 가진 `<script>`, `<style>`만 허락한다. 아래 "nonce와 `'strict-dynamic'`"에서 다룬다.

- `'strict-dynamic'`: nonce로 허락된 스크립트가 불러오는 스크립트도 허락한다. 아래 "nonce와 `'strict-dynamic'`"에서 다룬다.

- `'unsafe-eval'`: `eval` 같은 문자열 실행을 허락한다. 개발 중에는 React가 eval을 쓰므로 개발 환경에서만 더한다.

### 개념 | nonce와 `'strict-dynamic'`

nonce는 서버가 응답마다 새로 만드는 무작위 문자열이다.

서버는 같은 값을 두 군데에 넣는다. CSP 헤더의 `'nonce-값'`과, 자기가 HTML에 넣는 `<script nonce="값">`이다.

브라우저는 둘이 같은 스크립트만 실행한다.

```html
<!-- 응답 헤더: Content-Security-Policy: script-src 'self' 'nonce-ZDIwNWI4...' 'strict-dynamic' -->
<script nonce="ZDIwNWI4...">...</script> <!-- 실행된다: 서버가 넣은 것 -->
<script>alert(1)</script> <!-- 막힌다: nonce가 없다 -->
```

공격자가 페이지에 스크립트를 끼워 넣어도 이번 응답의 nonce를 미리 알 수 없으니 실행되지 않는다.

그래서 nonce는 **요청마다 달라야** 하고, 고정된 값을 쓰면 아무 효과가 없다. 요청마다 렌더링해야 하는 이유가 여기서 나온다(아래 "요청마다 렌더링하기").

#### 동적으로 불러오는 조각

그런데 Next.js 앱에서는 처음 실행된 스크립트가 나머지 코드 조각(chunk)을 `<script>` 태그로 만들어 동적으로 불러온다.

`'strict-dynamic'`은 "nonce로 허락된 스크립트가 만들어 넣은 스크립트도 믿는다"는 뜻이라, 이 조각들에 일일이 nonce를 챙기지 않아도 실행된다.

- `'strict-dynamic'`을 이해하는 브라우저는 같은 `script-src`의 `'self'`와 주소 목록을 무시한다. 출처가 아니라 "누가 불렀는가"로 판단하기 때문이다. `'self'`는 이를 모르는 옛 브라우저를 위한 대비다.

- nonce는 `<script>`, `<style>` 태그에만 붙는다. HTML 속성(`style="..."`, `onclick="..."`)에는 붙일 자리가 없어서 막힌다(아래 "style 속성을 클래스로 바꾸기").

> nonce는 "이번 응답에서만 통하는 암호"다. 서버만 알고 응답이 끝나면 버린다.

#### nonce를 만드는 줄

`Buffer.from(crypto.randomUUID()).toString("base64")`는 무작위 UUID 문자열을 base64로 바꾼 것이다.

CSP의 nonce 값은 base64 글자로 쓰는 것이 규칙이라 한 번 감쌌다. 무작위성은 `randomUUID()`에서 온다.

요청마다 이 줄이 다시 실행되므로 `curl`을 두 번 보내면 두 응답의 `'nonce-...'` 값이 다르다. 같다면 어딘가에 고정된 값이 남아 있는 것이다.

### 개념 | `default-src`가 대신하지 않는 지시어

`script-src`, `style-src`, `img-src`, `connect-src`, `font-src`, `object-src`처럼 "무엇을 불러오는가"를 정하는 지시어는 적지 않으면 `default-src` 값을 쓴다.

`default-src 'self'` 한 줄이 이 종류를 한꺼번에 막아 두는 기본값이다.

하지만 불러오기가 아닌 지시어는 `default-src`를 물려받지 않는다. 적지 않으면 **제한이 없다.**

| 지시어 | 적지 않으면 | 이 문서에서 |
|---|---|---|
| `img-src`, `connect-src` 등 | `default-src` 값을 쓴다 | 저장소 주소를 더하려고 따로 적었다 |
| `base-uri` | 아무 `<base>`나 허용 | `'self'` |
| `form-action` | 어디로든 폼 전송 허용 | `'self'` |
| `frame-ancestors` | 어느 사이트든 `<iframe>`으로 감쌀 수 있다 | `'none'` |

- `proxy.ts`에 `base-uri`, `form-action`, `frame-ancestors`를 따로 적은 이유가 이것이다. `default-src 'self'`만 있으면 셋 다 열려 있다.

- 한 종류를 따로 적으면 `default-src`는 그 종류에 더 이상 쓰이지 않는다. `img-src`에 `'self'`를 다시 적은 이유다. 빼면 같은 출처 이미지도 막힌다.

> `default-src`는 "나머지 전부"가 아니라 "불러오기 종류의 나머지"다.

### 용어 | Next.js API (proxy)

- `proxy(request)`: Next.js 16에서 페이지 요청을 가로채는 함수다. 프로젝트 루트의 `proxy.ts`에서 내보낸다. 이전 버전의 `middleware.ts`가 이름을 바꾼 것이라 빌드 결과에는 `Proxy (Middleware)`로 나온다.

- `NextResponse.next({ request: { headers } })`: 요청을 그대로 진행시키되, 바꾼 요청 헤더를 렌더링 쪽에 넘긴다. Next.js는 여기서 CSP 헤더의 nonce를 읽는다. 응답 헤더에도 따로 넣는 이유는 아래 "요청 헤더와 응답 헤더에 둘 다 넣는 이유"에서 다룬다.

- `config.matcher`: proxy를 실행할 경로다. `source`는 경로 패턴, `missing`은 "이 헤더가 없는 요청에만"이라는 조건이다. 패턴은 아래 "`matcher`의 경로 패턴 읽기"에서 다룬다.

### 개념 | 요청 헤더와 응답 헤더에 둘 다 넣는 이유

`proxy`는 브라우저와 페이지 렌더링 사이에 끼어 있다. 그래서 헤더를 넣을 수 있는 방향이 둘이고, 받는 쪽이 다르다.

```ts
const requestHeaders = new Headers(request.headers);
requestHeaders.set("x-nonce", nonce);
requestHeaders.set("Content-Security-Policy", csp); // 렌더링 쪽(Next.js)이 읽는다
const response = NextResponse.next({ request: { headers: requestHeaders } });
response.headers.set("Content-Security-Policy", csp); // 브라우저가 읽는다
```

| 넣는 곳 | 읽는 쪽 | 하는 일 |
|---|---|---|
| 요청 헤더 | Next.js 렌더링 | CSP 헤더에서 nonce를 꺼내 자기가 넣는 `<script>`에 붙인다 |
| 응답 헤더 | 브라우저 | 그 정책으로 스크립트, 이미지, fetch를 거른다 |

- 응답 헤더를 빼면 nonce는 붙지만 브라우저는 정책을 모르니 아무것도 막지 않는다.

- 요청 헤더를 빼면 브라우저는 정책을 받지만 Next.js의 `<script>`에 nonce가 없어 앱 스크립트가 전부 막힌다.

- `x-nonce`는 Next.js가 쓰는 것이 아니라, 직접 만든 `<Script>` 등에 nonce를 붙이고 싶을 때 서버 컴포넌트가 `headers()`로 꺼내 쓰라고 넘겨 두는 값이다.

#### 요청 하나가 지나가는 길

```text
브라우저 ── GET /shop ──▶ proxy: nonce 생성, 요청 헤더와 응답 헤더에 같은 CSP를 넣는다
                              │
                              ▼
                         렌더링: 요청 헤더의 CSP에서 nonce를 읽어 <script nonce="..."> 를 쓴다
                              │
브라우저 ◀── HTML + 응답 헤더의 CSP ──┘
   │
   └─ 헤더의 nonce와 같은 <script>만 실행하고, 정책 밖의 이미지·fetch는 막는다
```

한쪽이라도 빠지면 위의 두 경우 중 하나가 된다. 같은 nonce가 두 갈래로 나갔다가 브라우저에서 다시 만나야 한다.

> 요청 헤더는 "서버 안쪽으로 보내는 쪽지"이고, 응답 헤더는 "브라우저로 나가는 규칙"이다. 같은 값을 양쪽에 넣어야 둘이 맞물린다.

### 개념 | `matcher`의 경로 패턴 읽기

`source`의 `/((?!api|_next/static|_next/image|favicon.ico).*)`는 정규식으로 읽는다.

핵심은 `(?!...)`(부정 전방탐색)로, "지금 위치에서 이 중 하나로 시작하지 않으면"이라는 조건이다. 글자를 소비하지 않고 확인만 한다.

```js
// 같은 패턴을 JS 정규식으로 옮겨 시험한다
const re = /^\/((?!api|_next\/static|_next\/image|favicon.ico).*)$/;
re.test("/shop"); // true: proxy가 실행된다
re.test("/"); // true
re.test("/_next/static/chunks/main.js"); // false: 정적 파일은 건너뛴다
re.test("/favicon.ico"); // false
re.test("/apiary"); // false: "api"로 시작하기만 해도 빠진다
```

- `/` 바로 뒤를 보는 조건이라 `/api`뿐 아니라 `/apiary`처럼 `api`로 시작하는 모든 경로가 빠진다. 나중에 그런 이름의 페이지를 만들면 CSP 헤더가 붙지 않는다(6단계 "진단 2"의 "헤더가 없다면 matcher에 그 경로가 빠졌다").

- `missing`의 두 항목은 링크를 미리 가져오는 요청에 붙는 헤더다(Next.js 라우터의 `next-router-prefetch`, 브라우저의 `purpose: prefetch`). 이 헤더가 있는 요청에는 proxy를 실행하지 않는다.

> 정적 파일은 HTML이 아니라 스크립트를 실행시키지 않으므로 CSP가 필요 없고, 거기서까지 nonce를 만들면 요청마다 헛일만 늘어난다.

### 작업 3. [커밋] 요청마다 렌더링하기

nonce는 요청마다 달라야 하므로, 페이지를 빌드할 때 미리 만들어 둘 수 없다. 루트 레이아웃에서 요청이 올 때마다 렌더링하게 한다.

```tsx
// app/layout.tsx
// import 한 줄과 instant 한 줄을 더하고, RootLayout을 async로 바꿔 맨 앞에서 connection()을 기다린다
import { connection } from "next/server";
// ... 기존 import 그대로 ...

// cacheComponents에서 Suspense 밖의 connection()은 빌드를 막는다. 이 레이아웃은 요청을 기다려도 된다고 표시한다
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection(); // 요청이 올 때마다 렌더링한다
  return (
    // ... 그대로
```

### 용어 | Next.js API (connection, instant)

- `connection()`: 렌더링이 실제 요청을 기다리게 해서, 빌드 때 미리 만들지 않고 요청마다 렌더링하게 한다.

- `export const instant = false`: 이 레이아웃(과 그 아래 페이지)은 요청 데이터를 기다리느라 화면이 바로 뜨지 않아도 된다고 Next.js에 알린다. `next.config.ts`에 `cacheComponents: true`가 켜져 있을 때만 쓰는 설정이다.

### 개념 | `instant = false`가 없으면 빌드가 멈춘다

이 프로젝트의 `next.config.ts`에는 `cacheComponents: true`가 켜져 있다. 빌드 결과 첫머리의 `- Cache Components enabled`가 그 표시다.

이 모드에서 Next.js는 페이지마다 "빌드 때 미리 만들 수 있는 껍데기"를 찾고, 요청을 기다리는 코드는 `<Suspense>` 안에 두기를 요구한다. 루트 레이아웃에서 `<Suspense>` 없이 `connection()`을 부르면 모든 페이지의 껍데기가 막히므로, 빌드가 이렇게 멈춘다.

```text
Error: Route "/login": Next.js encountered uncached or runtime data during prerendering.

`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()` accessed outside of `<Suspense>` prevents the route from being prerendered, blocking the page load and leading to a slower user experience.

Ways to fix this:
  - [stream] Provide a placeholder with `<Suspense fallback={...}>` around the data access
  - [cache] For uncached data (`fetch`, database calls): cache the access with `"use cache"` (does not apply to `connection()`)
  - [block] Set `export const instant = false` to allow a blocking route
```

에러가 내놓는 세 방법 중 `[block]`이 이 문서의 목적에 맞는다.

- `[stream]`(`<Suspense>`로 감싸기)은 감싼 바깥을 빌드 때 껍데기로 미리 만든다. 그 껍데기의 `<script>`에는 요청마다 바뀌는 nonce가 들어갈 수 없다. 아래 "정적 페이지와 nonce가 함께 갈 수 없는 이유"와 같은 문제다.

- `[cache]`는 `connection()`에는 쓸 수 없다고 메시지에 적혀 있다.

- `[block]`은 "이 레이아웃은 요청을 기다려도 된다"는 표시다. 요청마다 렌더링하는 것이 목적이니 그대로 받아들인다.

둘 중 하나만 있으면 빌드되지 않는다. 직접 해 보면 이렇다.

| 레이아웃 | `npm run build` |
|---|---|
| 둘 다 없음(`06` 그대로) | 실패. `/me/orders/[id]`의 `useParams()`가 `<Suspense>` 밖에 있다 |
| `connection()`만 | 실패. 위의 `/login` 에러 |
| `instant = false`만 | 실패. `/me/orders/[id]`를 서버에서 렌더링하지 못한다 |
| 둘 다 | 성공 |

> 첫 줄이 말해 주듯 `06`의 프론트도 운영 빌드는 이미 실패하는 상태였다. 지금까지는 개발 서버(`npm run dev`)로만 돌렸기 때문에 드러나지 않았다. CSP 때문에 처음으로 운영 빌드를 하면서 함께 고치는 셈이다.

### 개념 | 정적 페이지와 nonce가 함께 갈 수 없는 이유

`connection()`이 없으면 Next.js는 데이터를 요청마다 읽지 않는 페이지를 빌드할 때 HTML로 만들어 둔다(빌드 결과의 `○`). `cacheComponents`가 켜져 있으면 페이지의 바깥 껍데기만 미리 만들고 안쪽을 요청 때 채우기도 한다(빌드 결과의 `◐`).

그 HTML은 빌드할 때 한 번 만들어진 것이라, 요청마다 새로 만든 nonce가 들어갈 자리가 없다.

반면 `proxy.ts`는 정적 페이지 요청에도 실행되어 매번 새 nonce가 든 CSP 헤더를 붙인다.

결과는 "헤더에는 이번 nonce, HTML의 `<script>`에는 nonce가 없거나 다른 값"이다. 브라우저는 앱 스크립트를 전부 막고, 화면은 HTML만 보일 뿐 버튼이 동작하지 않는다.

루트 레이아웃 한 곳에서 `connection()`을 부르면 그 아래 모든 페이지가 요청마다 렌더링된다. 페이지마다 따로 챙길 필요가 없는 대신, 빌드 때 만들어 두는 이점도 모든 페이지에서 사라진다.

### 작업 4. [커밋] style 속성을 클래스로 바꾸기

`05`의 `Nav`에는 `style={{ display: "flex", gap: 12 }}` 속성이 있었다. `style-src`에 `'unsafe-inline'`이 없으면 이런 style 속성은 막힌다.

nonce는 `<style>` 태그에만 붙일 수 있고 속성에는 붙일 수 없기 때문이다. 프로젝트에 이미 있는 Tailwind 클래스로 바꾼다.

```tsx
// app/nav.tsx
// return의 <nav> 한 줄만 바꾼다
  // 엄격한 CSP는 style 속성을 막으므로 클래스를 쓴다
  return (
    <nav className="flex gap-3">
```

`gap-3`은 Tailwind의 간격 단위(0.25rem)로 3칸, 즉 0.75rem(12px)이라 원래의 `gap: 12`와 같다.

클래스는 `globals.css`에서 빌드된 스타일시트에 들어가고, 스타일시트는 같은 출처(`'self'`)에서 오므로 `style-src`를 통과한다.

### 작업 5. [커밋] 운영 빌드로 확인하기

개발 서버는 `'unsafe-eval'`이 더해지고 동작 방식도 달라서, CSP는 실제로 배포할 모양(`next build && next start`)으로 확인해야 한다.

#### 빌드 결과 읽기

```sh
npm run build
```

```sh
▲ Next.js 16.4.0 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 73ms
- Cache Components enabled
- Partial Prefetching enabled

  Creating an optimized production build ...
✓ Compiled successfully in 452ms
  ...
✓ Generating static pages using 7 workers (10/10) in 190ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /login
├ ƒ /me/orders
├   /me/orders/[id]
│ └ ◐ /me/orders/[id]
├ ƒ /orders
├   /orders/[id]
│ └ ◐ /orders/[id]
└ ƒ /shop


ƒ Proxy (Middleware)

◐  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content
ƒ  (Dynamic)            server-rendered on demand
```

- **주소가 고정된 페이지는 모두 `ƒ`(요청마다 렌더링)가 됐다.** 빌드 때 HTML로 고정하는 `○`는 없다.

- **주소에 `[id]`가 든 두 경로는 `◐`로 표시된다.** 그래도 아래 브라우저 확인에서 두 페이지(`/orders/1`, `/me/orders/1`)를 열어 봤을 때 CSP 위반은 없었다. 표시만 보고 판단하지 말고 브라우저로 확인하는 이유다.

- **`ƒ Proxy (Middleware)` 줄이 `proxy.ts`가 잡혔다는 표시다.** 이 줄이 없으면 파일 위치나 함수 이름이 틀린 것이다(작업 1).

> CSP 때문에 생긴 비용이니 알고 받아들인다.

#### 헤더 확인

```sh
npx next start -p 3000

# 다른 터미널에서
curl -sI localhost:3000/shop | grep -i content-security-policy
# 출력
content-security-policy: default-src 'self'; script-src 'self' 'nonce-Y2Y0MWIwMjEtYmIxMC00OTgzLWJlMTktZmEzYzNjYzM1NWYz' 'strict-dynamic'; style-src 'self' 'nonce-Y2Y0MWIwMjEtYmIxMC00OTgzLWJlMTktZmEzYzNjYzM1NWYz'; img-src 'self' blob: data: http://localhost:9000; font-src 'self'; connect-src 'self' http://localhost:4000 http://localhost:9000; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- `proxy.ts`의 배열이 `; `로 이어져 한 줄로 나왔다. `img-src`와 `connect-src`에 작업 2의 저장소 주소(`http://localhost:9000`)가 들어갔다.

- 같은 명령을 한 번 더 치면 `nonce-` 뒤의 값이 바뀐다. 바뀌지 않으면 어딘가에 고정된 값이 남아 있는 것이다.

#### 브라우저에서 위반이 없는지 확인

`curl`은 HTML을 실행하지 않으니 정책이 실제로 무엇을 막는지는 브라우저로 봐야 한다(0장 개념 2). Playwright로 로그인한 뒤 네 페이지를 돌며 콘솔의 CSP 위반 메시지를 모으고, 페이지의 `<script>` 태그에 nonce가 붙었는지 세었다.

이 스크립트는 5단계에서도 다시 쓰므로 `order-console-next`에 남겨 커밋한다. 이 작업이 `[커밋]`인 이유다.

<details>
<summary>확인에 쓴 스크립트(<code>csp-check.mjs</code>)</summary>

```js
// order-console-next/csp-check.mjs
// 실행: node csp-check.mjs            (기본 네 페이지)
//       node csp-check.mjs /orders/1,/me/orders/1   (쉼표로 페이지를 고른다)
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
const violations = [];
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(`${page.url()} ${m.text()}`); });

await page.goto("http://localhost:3000/login");
await page.getByPlaceholder("password").fill("1234");
await page.getByRole("button", { name: "로그인" }).click();
await page.waitForURL(/\/shop$/);

const counts = {};
for (const p of (process.argv[2] ?? "/login,/shop,/me/orders,/orders").split(",")) {
  await page.goto("http://localhost:3000" + p);
  await page.waitForLoadState("networkidle");
  const c = await page.$$eval("script", (els) => els.map((e) => (e.nonce ? "nonce있음" : "nonce없음")));
  for (const k of c) counts[k] = (counts[k] ?? 0) + 1;
  const nav = await page.$eval("nav", (n) => getComputedStyle(n).display).catch(() => "-");
  const img = await page.$eval("img", (i) => i.complete && i.naturalWidth > 0).catch(() => "이미지 없음");
  console.log(p, "nav display:", nav, "첫 이미지 로드:", img);
}
console.log("CSP 위반:", violations.length ? "\n" + violations.join("\n") : "없음");
console.log("script 태그:", JSON.stringify(counts));
await browser.close();
```

</details>

```text
/login nav display: flex 첫 이미지 로드: 이미지 없음
/shop nav display: flex 첫 이미지 로드: 이미지 없음
/me/orders nav display: flex 첫 이미지 로드: 이미지 없음
/orders nav display: flex 첫 이미지 로드: 이미지 없음
CSP 위반: 없음
script 태그: {"nonce있음":57,"nonce없음":13}
```

- **CSP 위반: 없음.** 네 페이지 어디에서도 막힌 것이 없다. `nav display: flex`는 작업 4의 클래스가 적용됐다는 뜻이다(5단계에서 이 값이 바뀐다).

- **`첫 이미지 로드: 이미지 없음`**: 아직 상품 이미지를 올리지 않아 `<img>`가 없다. 아래 e2e의 업로드 테스트가 2번 상품에 이미지를 올린다.

- **nonce가 없는 `<script>` 13개는 위반이 아니다.** 서버가 보낸 HTML만 세면 `<script>`는 모두 nonce를 달고 있다(`/login`이면 15개 중 15개). nonce가 없는 것은 그 스크립트들이 실행되면서 나중에 끼워 넣은 코드 조각(chunk)이고, `'strict-dynamic'`이 허락한 것이다(위 "nonce와 `'strict-dynamic'`").

> CSP 헤더가 있는 페이지에서 브라우저는 `<script>`의 `nonce` 속성 값을 지워 숨긴다(CSS 선택자 같은 것으로 nonce를 읽어 가지 못하게). 그래서 확인은 속성(`getAttribute("nonce")`)이 아니라 프로퍼티(`e.nonce`)로 한다.

그리고 `05`·`06`의 e2e 테스트 6개를 이 운영 서버에 그대로 돌렸다.

`playwright.config.ts`의 `reuseExistingServer: true`가 이미 떠 있는 3000번 서버를 쓴다. 3000번이 비어 있으면 설정의 `npm run dev`로 개발 서버를 띄우므로, 운영 빌드를 시험하려면 `next start`를 먼저 켜 둔다.

```sh
npx playwright test --reporter=list
```

```text
Running 6 tests using 1 worker

  ✓  1 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (441ms)
  ✓  2 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (565ms)
  ✓  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (594ms)
  ✓  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (751ms)
  ✓  5 e2e/upload.spec.ts:11:5 › 이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다 (419ms)
  ✓  6 e2e/upload.spec.ts:24:5 › 이미지가 아닌 파일은 확장자가 .png여도 거절된다 (467ms)

  6 passed (3.7s)
```

로그인, 장바구니, 결제, refresh, 직접 업로드가 CSP 아래에서도 모두 동작한다.

#### e2e 전에 시드를 다시 넣는다

2·3단계의 부하는 모두 `kim`으로 결제했다. 그대로 e2e를 돌리면 `kim`의 주문이 수십만 건 쌓인 상태라(이 문서의 측정 뒤에는 279,617건) `/me/orders`가 그 전부를 받아 그리느라 5초 안에 뜨지 않는다.

```text
  ✘  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (5.5s)
  ✘  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (5.4s)

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('my-orders')
    Expected: visible
    Timeout: 5000ms
```

CSP가 아니라 데이터 때문이다. `order-api-nest`에서 `npx prisma db seed`로 주문을 비운 뒤 돌리면 6개가 모두 통과한다. 위의 `6 passed`가 그렇게 돌린 결과다.

> 부하 테스트가 남긴 데이터가 기능 테스트를 깨뜨리는 일은 흔하다. 같은 DB를 쓴다면 둘 사이에 시드를 다시 넣는다.

### 남길 것

- **찾아보면 되는 것**: CSP 지시어 이름과 `'self'`·`'none'`·`'strict-dynamic'` 같은 키워드, `matcher`의 `source`·`missing` 적는 법, `connection()`과 `instant` 설정. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - nonce는 요청마다 달라야 효과가 있고, 그래서 nonce를 쓰는 페이지는 빌드 때 고정할 수 없다(`○`가 없어진다).

  - 같은 CSP를 요청 헤더(렌더링이 nonce를 읽는다)와 응답 헤더(브라우저가 정책을 지킨다) 양쪽에 넣어야 맞물린다.

  - CSP는 운영 빌드로 확인한다. 개발 서버는 정책도 동작도 다르다.

- **에러 신호**:

  - `npm run build`가 `encountered uncached or runtime data during prerendering`으로 멈춘다 → 루트 레이아웃에 `export const instant = false`가 있는지(작업 3)

  - 운영 서버에서 e2e의 `/me/orders` 테스트만 5초 시간 초과 → 부하 테스트가 쌓은 주문. `npx prisma db seed` 뒤에 다시 돌린다

  - `curl -sI` 결과에 `content-security-policy` 줄이 없다 → `proxy.ts`가 프로젝트 루트에 있는지(빌드 결과의 `Proxy (Middleware)` 줄), `matcher`에 그 경로가 빠지지 않았는지

  - 화면은 보이는데 버튼이 하나도 동작하지 않고 콘솔에 `script-src` 위반이 쌓인다 → 빌드 결과에 `○` 페이지가 남았는지(`connection()`), 요청 헤더에 CSP를 넣었는지

  - `Applying inline style violates the following Content Security Policy directive 'style-src ...'` → `style={{ ... }}` 속성이 남아 있다. 클래스로 바꾼다

## 6. 5단계: 일부러 깨뜨려보기, 허용 목록이 좁으면

CSP의 흔한 사고는 필요한 것을 빠뜨려 정상 기능이 막히는 것이다.

### 실험 | 허용 목록에서 두 가지를 빼고 운영 빌드로 띄우기

두 가지를 동시에 바꿔 운영 빌드로 띄운다. 바꾼 결과는 `practice/break-narrow-csp/order-console-next`에 있다.

1. `proxy.ts`의 `img-src`에서 저장소 주소를 뺀다: `` `img-src 'self' blob: data:` ``

2. `app/nav.tsx`의 `<nav>`를 원래의 `style={{ display: "flex", gap: 12 }}`로 되돌린다

```sh
npm run build && npx next start -p 3000
# 다른 터미널에서. 4단계 작업 5의 e2e가 2번 상품에 이미지를 올려 둔 상태다
node csp-check.mjs /shop
```

```text
/shop nav display: block 첫 이미지 로드: false
CSP 위반:
http://localhost:3000/login Applying inline style violates the following Content Security Policy directive 'style-src 'self' 'nonce-MDUwMWYxMGEtN2YxYS00ZTE5LTkxM2EtYTdhOTkxZjc2Nzg2''. Either the 'unsafe-inline' keyword, a hash ('sha256-/gi5LRe9CHYJodV60ArIVrHgRFs9M0SV6s5Yx16t13Q='), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
http://localhost:3000/shop Applying inline style violates the following Content Security Policy directive 'style-src 'self' 'nonce-YmEzMzg3OWUtYzVlYy00NDc3LTg0MmUtMWFiYTU1NzRhMmM5''. Either the 'unsafe-inline' keyword, a hash ('sha256-/gi5LRe9CHYJodV60ArIVrHgRFs9M0SV6s5Yx16t13Q='), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.
http://localhost:3000/shop Loading the image 'http://localhost:9000/product-images/products/2/3ea6c94b-....png?X-Amz-Algorithm=AWS4-HMAC-SHA256&...' violates the following Content Security Policy directive: "img-src 'self' blob: data:". The action has been blocked.
script 태그: {"nonce있음":14,"nonce없음":3}
```

- **`nav display: block`**: `display: flex`가 적용되지 않았다. 메뉴가 가로로 늘어서지 않고 세로로 쌓인다.

- **`첫 이미지 로드: false`**: `<img>`는 있는데 그림이 오지 않았다. 셋째 위반 메시지가 그 이유다. 저장소 주소가 `img-src`에 없어서 막혔다.

- **style 위반은 페이지마다 하나씩 나온다.** 로그인 화면(`/login`)과 `/shop`에서 각각 찍혔다. `Nav`가 모든 페이지에 있기 때문이다. 메시지 끝의 `Note that hashes do not apply to ... style attributes`가 "style 속성은 해시로도 허락할 수 없다"는 뜻이라, 클래스로 바꾸는 것(4단계 작업 4)이 사실상 유일한 길이다.

- **스크립트는 멀쩡하다.** `script-src`는 건드리지 않았으므로 nonce가 맞고, 로그인도 동작했다.

에러 화면 없이 **조용히** 깨진다. 메뉴가 세로로 쌓이고 이미지 자리가 빈다.

브라우저 콘솔(개발자 도구)에 위반 메시지가 남는 것이 유일한 단서다.

#### e2e는 무엇을 잡는가

깨진 상태 그대로 e2e를 돌린다.

```sh
npx playwright test --reporter=list
```

```text
  ✓  1 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (537ms)
  ✓  2 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (457ms)
  ✓  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (459ms)
  ✓  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (729ms)
  ✘  5 e2e/upload.spec.ts:11:5 › 이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다 (5.3s)
  ✓  6 e2e/upload.spec.ts:24:5 › 이미지가 아닌 파일은 확장자가 .png여도 거절된다 (411ms)

  1) e2e/upload.spec.ts:11:5 › 이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다

    Error: expect(received).toBeGreaterThan(expected)

    Expected: > 0
    Received:   0

    Call Log:
    - Timeout 5000ms exceeded while waiting on the predicate

      20 |   await expect(img).toHaveAttribute("src", new RegExp(`^http://localhost:9000/product-images/${key}\\?`));
    > 21 |   await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  1 failed
  5 passed (8.7s)
```

- **이미지는 잡혔다.** 업로드 테스트가 마지막에 "그림의 실제 너비(`naturalWidth`)가 0보다 큰가"를 보기 때문이다. `src`가 맞는지만 봤다면(20번 줄) 통과했을 것이다.

- **메뉴는 잡히지 않았다.** 6개 중 어느 테스트도 메뉴가 가로인지 보지 않는다. 버튼과 링크는 세로로 쌓여도 눌린다.

> e2e는 "확인하는 것"만 잡는다. CSP 위반을 빠짐없이 잡으려면 위의 `csp-check.mjs`처럼 콘솔의 위반 메시지 자체를 모아 0건인지 보는 검사를 함께 둔다.

### 작업 1. [원복] 원복하고 다시 확인

두 곳을 원래대로 되돌리고 다시 빌드한다.

```sh
npm run build && npx next start -p 3000
# 다른 터미널에서
npx playwright test --reporter=list
```

```text
  6 passed (3.9s)
```

원복하고 다시 빌드하면 6개 테스트가 다시 통과한다. `node csp-check.mjs`도 다시 `CSP 위반: 없음`이 된다.

새 외부 리소스(분석 도구, 폰트, 지도 등)를 붙일 때마다 CSP도 같이 고쳐야 한다.

> 그래서 e2e 테스트를 CSP가 붙은 운영 빌드에 돌리는 것이 중요하다. 개발 서버에서만 테스트하면 이런 깨짐을 배포하고 나서야 알게 된다.

### 남길 것

- **찾아보면 되는 것**: 브라우저 콘솔에 남는 CSP 위반 메시지의 형식. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - CSP 사고는 에러 화면 없이 조용히 깨진다. 단서는 브라우저 콘솔뿐이다. e2e는 확인하는 것만 잡으므로(메뉴가 깨져도 6개 중 5개가 통과했다), 운영 빌드에서 콘솔의 CSP 위반이 0건인지 보는 검사를 함께 둔다.

  - 새 외부 리소스를 붙이는 변경에는 CSP 수정이 함께 따라와야 한다.

- **에러 신호**:

  - 상품 이미지 자리만 비어 있고 에러 화면은 없다 → `img-src`에 저장소 주소(`NEXT_PUBLIC_STORAGE_URL`)가 있는지

  - e2e 업로드 테스트가 `naturalWidth` `Received: 0`으로 실패 → 그림이 막혔다. 위와 같이 `img-src`

  - 메뉴가 세로로 쌓인다(`display: block`) → `style` 속성이 `style-src`에 막혔다

  - 업로드가 실패하고 콘솔에 `connect-src` 위반 → `connect-src`에 저장소 주소가 있는지

## 7. 6단계: 디버깅

### 진단 1. 부하 테스트 결과 읽기

| 보이는 것 | 먼저 볼 것 |
|---|---|
| 지나치게 빠르다 | `http_req_failed`. 실패한 요청은 대개 빠르다(1단계의 첫 실행) |
| 처리량이 늘지 않고 p95만 는다 | 상한에 닿았다. `docker stats`로 어느 컨테이너가 CPU를 다 쓰는지 본다 |
| 특정 조건(같은 상품)에서만 느리다 | 잠금 대기. `02`의 11단계 "진단 1"처럼 `pg_stat_activity`에서 `Lock`을 기다리는 쿼리를 본다 |
| 오류가 섞인다 | 오류 응답 코드를 나눠 본다. 409(재고 부족)인지, `02`의 `P2028`(커넥션 풀 고갈) 같은 500인지 |

느린 요청 하나를 골라 보고 싶다면 그 시간대의 로그에서 `trace_id`를 찾아 Jaeger에서 연다(`07`의 6단계).

> 부하 중에는 100% 추적이 측정 자체를 바꾸므로(3단계), 샘플링을 켠 상태에서 본다.

### 진단 2. CSP 위반 찾기

- 브라우저 개발자 도구의 콘솔에 `Refused to ...` 또는 `violates the following Content Security Policy directive`로 시작하는 메시지가 남는다. 어느 지시어(`img-src` 등)가 무엇을 막았는지가 적혀 있다.

- 응답 헤더를 직접 본다: `curl -sI <주소> | grep -i content-security-policy`. 헤더가 없다면 `proxy.ts`의 `matcher`에 그 경로가 빠졌다.

- 개발 서버에서는 되는데 운영 빌드에서만 깨지면, 정적으로 고정된 페이지(`○`)가 남아 nonce를 못 받았는지 빌드 결과를 본다.

- 새 정책을 바로 막는 대신 위반만 보고받고 싶다면 헤더 이름을 `Content-Security-Policy-Report-Only`로 바꿔 먼저 관찰하는 방법이 있다.

### 진단 3. 에러 신호 모아 보기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `docker run`이 `network order-api-nest_default not found`로 실패 | 그 이름의 compose 네트워크가 없다 | compose 파일이 있는 폴더 이름, `docker network ls` | 1단계 |
| k6가 `/scripts/checkout.js`를 찾지 못한다 | `-v "$PWD/loadtest:/scripts"`가 빈 폴더를 붙였다 | `order-api-nest`에서 실행했는지 | 1단계 |
| `✗ 'rate<0.01' rate=100.00%`인데 처리량이 평소의 몇 배 | 요청이 전부 실패해 바로 돌아왔다(대개 401) | 시드(`kim`)와 `setup()`의 로그인 | 1단계 |
| `load-seed.sql`의 마지막 출력이 `52 \| 52000000`이 아니다 | 상품 id가 1, 2로 되감기지 않았거나 두 번 넣었다 | `npx prisma db seed`를 먼저 넣었는지 | 1단계 |
| `level=error msg="thresholds on metrics '...' have been crossed"`, 종료 코드 99 | 기준선을 넘었다 | 메시지의 지표 이름(`http_req_failed`인지 `http_req_duration`인지) | 1단계, 2단계 |
| 처리량이 늘지 않고 p95만 는다 | 서버 한 대의 상한에 닿았다 | `docker stats`에서 CPU를 다 쓰는 컨테이너 | 2단계 |
| `docker stats`가 모두 몇 %이고 k6 컨테이너가 없다 | 부하가 끝난 뒤에 쟀다 | k6가 도는 동안 다시 잰다 | 2단계 |
| `HOT=1`에서만 p95가 기준을 넘는다 | 같은 상품 행의 잠금 앞에 줄을 섰다 | `FOR UPDATE`, `pg_stat_activity`의 `Lock` 대기 | 2단계 |
| 장부 확인 쿼리가 `f` | 줄어든 재고와 팔린 수량이 다르다 | 앱이 읽은 값으로 덮어쓰는 곳, 측정 도중 `load-seed.sql`을 다시 넣었는지 | 2단계 |
| `OTEL_SDK_DISABLED=true`로 띄웠는데 숫자가 그대로다 | 환경변수가 컨테이너까지 가지 않았다 | compose의 `${OTEL_SDK_DISABLED-false}`, `docker compose exec api printenv OTEL_SDK_DISABLED` | 3단계 |
| 10% 샘플링인데 Jaeger에 추적이 거의 다 보인다 | 샘플러 설정이 적용되지 않았다 | 로그의 `trace_flags`에서 `01`의 비율 | 3단계 |
| 측정 뒤 Jaeger에 새 추적이 없고 요청 로그도 없다 | api가 ④(추적 끔, 로그 warn)로 남았다 | 아무것도 붙이지 않고 `up -d api` | 3단계 |
| `npm run build`가 `encountered uncached or runtime data during prerendering`으로 멈춘다 | `cacheComponents`에서 `<Suspense>` 밖의 `connection()`이 막혔다 | 루트 레이아웃의 `export const instant = false` | 4단계 |
| 운영 서버에서 e2e의 `/me/orders` 테스트만 시간 초과 | 부하 테스트가 쌓은 주문 수십만 건을 화면이 다 그린다 | e2e 전에 `npx prisma db seed` | 4단계 |
| 시험해보기의 k6가 `rate=99.98%`, 결제가 404 | 부하용 상품(3~52번)이 없다 | `npx prisma db seed` 뒤에 `load-seed.sql`도 넣었는지 | 6단계 |
| `curl -sI`에 `content-security-policy` 줄이 없다 | proxy가 그 요청에 실행되지 않았다 | `proxy.ts`의 위치(빌드 결과의 `Proxy (Middleware)`), `matcher` | 4단계 |
| 화면은 보이는데 버튼이 동작하지 않고 `script-src` 위반이 쌓인다 | HTML의 `<script>`에 이번 nonce가 없다 | 빌드 결과의 `○`(`connection()`), 요청 헤더의 CSP | 4단계 |
| `Applying inline style violates the following Content Security Policy directive 'style-src ...'` | `style` 속성이 막혔다 | `style={{ ... }}`를 클래스로 바꿨는지 | 4단계, 5단계 |
| 메뉴가 세로로 쌓인다(`display: block`) | `style` 속성이 적용되지 않았다 | 위와 같다 | 5단계 |
| e2e 업로드 테스트가 `naturalWidth` `Received: 0`으로 실패 | 그림이 막혀 오지 않았다 | `img-src`의 저장소 주소 | 5단계 |
| 상품 이미지 자리만 비고 에러 화면은 없다 | `img-src`가 저장소를 막았다 | `img-src`의 저장소 주소 | 5단계 |
| 업로드가 실패하고 콘솔에 `connect-src` 위반 | fetch가 허용 목록 밖으로 나가려 했다 | `connect-src`의 저장소 주소 | 5단계 |
| 개발 서버에서는 되는데 운영 빌드에서만 깨진다 | 정책과 렌더링 방식이 개발 서버와 다르다 | 운영 빌드로 e2e를 돌렸는지, 빌드 결과의 `○` | 6단계 |

### 시험해보기

```sh
# 백엔드(:4000) 컨테이너가 떠 있는 상태에서, order-api-nest에서
npx prisma db seed && docker compose exec -T db psql -U order -d order_api < loadtest/load-seed.sql
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e VUS=10 -e DURATION=15s /scripts/checkout.js
# 프론트(order-console-next)
npm run build && npx next start -p 3000 # 다른 터미널
npx playwright test --reporter=list # 6 passed
```

```text
    ✓ 'p(95)<200' p(95)=41.36ms
    ✓ 'rate<0.01' rate=0.00%
    http_reqs......................: 6011   399.284567/s
...
  6 passed (5.5s)
```

첫 줄의 시드 두 개를 빼먹기 쉽다. 4단계에서 e2e를 위해 `npx prisma db seed`만 넣었다면 부하용 상품(3~52번)이 없는 상태라, k6가 이렇게 끝난다.

```text
    http_req_failed
    ✗ 'rate<0.01' rate=99.98%
    ...
    ✗ 201 Created
      ↳  0% — ✓ 0 / ✗ 9669

    HTTP
    http_req_duration..............: avg=15.45ms min=6.03ms  med=11.99ms max=155.16ms p(90)=26.29ms p(95)=39.13ms
      { expected_response:true }...: avg=42.89ms min=42.89ms med=42.89ms max=42.89ms  p(90)=42.89ms p(95)=42.89ms
      { name:checkout }............: avg=15.45ms min=6.03ms  med=11.99ms max=155.16ms p(90)=26.27ms p(95)=39.05ms
    http_req_failed................: 99.98% 9669 out of 9670
```

- 결제는 모두 `404 product 3 not found`로 실패했다. 실패율이 100%가 아니라 99.98%인 것은 `setup()`의 로그인 한 건만 성공했기 때문이다.

- 1단계 작업 3에서 "실패가 섞이면 갈라진다"던 `{ expected_response:true }` 줄이 여기서 갈라졌다. 성공한 응답이 로그인 하나뿐이라 min, med, max가 모두 42.89ms로 같다.

k6가 시드 뒤에 결제를 6천 건쯤 더 쌓지만, 이 정도는 e2e에 지장이 없다. 4단계 작업 5처럼 수십만 건이 쌓였을 때만 `/me/orders` 테스트가 늦어진다.

### 도전 과제

#### 1. API 서버를 두 대로 늘리기

`04`의 리더 선출과 Redis 어댑터가 있으니 API 서버를 두 대로 늘릴 수 있다.

compose에 두 번째 API 서비스와, 둘에게 요청을 나눠 주는 리버스 프록시를 붙이고 2단계의 분산 시나리오를 다시 잰다.

처리량이 두 배가 되는가? 인기 상품 시나리오(`HOT=1`)는 어떤가?

**답** (전체 프로젝트: `practice/challenge-two-api-servers/order-api-nest`)

```yaml
# order-api-nest/docker-compose.yml
# services에 추가
  api2:
    extends: { service: api } # api 설정을 그대로 물려받는다
    ports: !reset [] # 호스트의 4000은 api가 쓰므로 비운다
  lb:
    image: nginx:alpine
    profiles: ["app"]
    ports:
      - "4080:80"
    volumes:
      - ./loadtest/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      api: { condition: service_healthy }
      api2: { condition: service_healthy }
```

```nginx
# loadtest/nginx.conf
upstream order_api {
  server api:4000; # 기본은 라운드 로빈: 번갈아 보낸다
  server api2:4000;
  keepalive 64; # 프록시 → API 연결을 재사용한다
}
server {
  listen 80;
  location / {
    proxy_pass http://order_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
  }
}
```

```sh
docker compose --profile app up -d # api2, lb가 새로 뜬다
# 한 대: api를 바로 부른다 / 두 대: lb를 부른다
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e API=http://api:4000 -e VUS=50 -e DURATION=15s /scripts/checkout.js
docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e API=http://lb:80 -e VUS=50 -e DURATION=15s /scripts/checkout.js
```

k6는 compose 네트워크 안에서 돌므로 호스트 포트(`4080`) 대신 서비스 이름과 컨테이너 안의 포트(`lb:80`)로 부른다. `-e API=`만 바꾸고 나머지는 같다.

VU 50명, 15초씩, 매번 시드를 새로 넣고 세 번 쟀다. 측정 중간(8초쯤)에 `docker stats`도 찍었다. 처리량(초당)과 p95다.

| 시나리오 | 한 대 | 두 대 |
|---|---|---|
| 분산 | 451 / 147ms, 431 / 160ms, 310 / 329ms | 415 / 316ms, 618 / 175ms, 399 / 317ms |
| `HOT=1` | 298 / 222ms, 245 / 337ms, 254 / 305ms | 299 / 374ms, 286 / 380ms, 317 / 361ms |

| 시나리오 | CPU(한 대) | CPU(두 대) |
|---|---|---|
| 분산 | api 109~121%, db 38~39% | api 105~108%, api2 110~125%, db 59~96%, lb 5~11% |

1. 분산 시나리오는 두 배가 되지 않았다. 한 대는 310~451건/초, 두 대는 399~618건/초다. 가장 좋은 회차끼리 견줘도 1.4배(451 → 618)이고, 두 대의 세 번 중 두 번은 한 대의 좋은 회차보다 낮았다.

2. 두 대일 때 두 API는 각각 CPU를 105~125% 썼다. 둘 다 코어 하나를 꽉 채웠는데도 둘이 합쳐 처리한 수는 혼자일 때와 비슷하다. DB의 CPU는 38%에서 59~96%로 올랐다.

3. 한 PC 위에서는 API 두 대, DB, 프록시, k6가 같은 CPU를 나눠 쓴다. 서버를 늘린 만큼 처리량이 늘려면 서버마다 따로 쓸 CPU가 있어야 하고, 그다음에는 같은 DB가 다음 상한이 된다.

4. `HOT=1`은 두 대에서 처리량이 조금 늘었지만(245~298 → 286~317건/초), p95는 세 번 모두 기준(200ms)을 넘었다(361~380ms). 이번 측정에서는 한 대일 때도 넘었다(222~337ms). 1번 상품 행의 `FOR UPDATE` 줄은 서버가 몇 대든 하나이기 때문이다. 두 대일 때 각 API의 CPU가 55~66%로 내려간 것도 같은 이야기다. 서버는 놀고 행 잠금 앞의 줄이 상한이다.

> 한 대의 숫자가 2단계(분산 VU 50에서 526~529건/초)보다 낮다. 이 측정 동안에는 놀고 있는 api2와 lb도 떠 있었고, 매번 시드를 새로 넣어 DB와 서버가 데워지지 않은 상태에서 시작했다. 같은 표 안의 한 대와 두 대만 서로 비교한다.

> 측정 사이에 시드를 새로 넣은 이유: 결제마다 쌓이는 outbox 행을 리더 서버가 부하가 끝난 뒤에도 한참 처리해서, 앞 측정의 뒷일이 다음 측정에 섞인다.

#### 2. 사용자 흐름으로 시나리오 바꾸기

k6 시나리오를 "결제만"이 아니라 "상품 목록 보기 → 담기 → 결제"를 섞은 사용자 흐름으로 바꾼다.

요청 종류별로 `tags`를 달아 각각의 p95를 따로 본다.

요청 종류마다 p95가 어떻게 다른가?

**답** (전체 프로젝트: `practice/challenge-user-flow/order-api-nest`)

```js
// loadtest/checkout.js
// 바뀐 부분만 보인다. import에 sleep을 더한다
import { check, sleep } from "k6";

  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:products}": ["p(95)<200"], // 기준선을 걸어 둔 태그는 결과에 따로 나온다
    "http_req_duration{name:checkout}": ["p(95)<200"],
  },

export default function (data) {
  // ① 상품 목록 보기
  const list = http.get(`${API}/products`, { tags: { name: "products" } });
  check(list, { "목록 200": (r) => r.status === 200 });
  const products = list.json().filter((p) => p.stock > 0 && (HOT ? p.id === 1 : p.id >= 3));
  if (products.length === 0) return;
  sleep(0.5);
  // ② 담기: 장바구니는 브라우저에만 있으니 서버 요청이 없다. 1~3개를 고른다
  const count = HOT ? 1 : 1 + Math.floor(Math.random() * 3);
  const picked = [];
  while (picked.length < count) {
    const p = products[Math.floor(Math.random() * products.length)];
    if (!picked.includes(p.id)) picked.push(p.id);
  }
  sleep(0.5);
  // ③ 결제: 화면처럼 Idempotency-Key를 붙인다
  const res = http.post(`${API}/orders/checkout`, JSON.stringify({ items: picked.map((productId) => ({ productId, quantity: 1 })) }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}`, "Idempotency-Key": `k6-${__VU}-${__ITER}-${Date.now()}` },
    tags: { name: "checkout" },
  });
  check(res, { "201 Created": (r) => r.status === 201 });
}
```

`sleep`은 k6가 주는 함수로, 가상 사용자가 그 초만큼 쉰다(사용자가 화면을 보는 시간).

같은 상품을 두 줄로 넣으면 결제 DTO의 `@ArrayUnique`가 400으로 거부하므로, `picked`에 이미 있는 id는 다시 고르지 않는다.

VU마다 30초씩, 시드를 새로 넣고 두 번 쟀다. 범위는 두 번의 값이다.

```sh
for v in 1 10 50 200; do
  docker run --rm -i --network order-api-nest_default -v "$PWD/loadtest:/scripts" grafana/k6 run --quiet -e VUS=$v -e DURATION=30s /scripts/checkout.js
done
```

| VU | 처리량(초당) | 목록 p95 | 결제 p95 |
|---|---|---|---|
| 1 | 2 | 5.03~5.24ms | 27.78~30.7ms |
| 10 | 19 | 12.86~17.56ms | 53.15~96.97ms |
| 50 | 82~86 | 100.93~134.07ms | 174.12~262.89ms(두 번째 ✗) |
| 200 | 228~263 | 419.09~592.13ms ✗ | 457.88~838.49ms ✗ |

결과 요약에는 기준선을 건 태그마다 줄이 따로 생긴다. VU 1의 한 회다.

```text
  █ THRESHOLDS

    http_req_duration{name:checkout}
    ✓ 'p(95)<200' p(95)=30.7ms

    http_req_duration{name:products}
    ✓ 'p(95)<200' p(95)=5.24ms
    ...
    ✓ 목록 200
    ✓ 201 Created

    HTTP
    http_req_duration..............: avg=12.27ms min=1.53ms med=10.75ms max=85.49ms p(90)=21.81ms p(95)=29.32ms
      { expected_response:true }...: avg=12.27ms min=1.53ms med=10.75ms max=85.49ms p(90)=21.81ms p(95)=29.32ms
      { name:checkout }............: avg=20.11ms min=9.81ms med=17.06ms max=85.49ms p(90)=24.86ms p(95)=30.7ms
      { name:products }............: avg=3.32ms  min=1.53ms med=3.07ms  max=11.79ms p(90)=3.61ms  p(95)=5.24ms
    ...
    iteration_duration.............: avg=1.02s   min=1.01s  med=1.02s   max=1.09s   p(90)=1.03s   p(95)=1.04s
    iterations.....................: 30     0.970351/s
```

`iteration_duration`이 1.02초다. 쉬는 1초에 요청 두 개(목록 3ms + 결제 20ms)가 더해진 것이다.

1. 사용자가 적을 때 결제는 목록보다 5~6배 느리다(p95 5ms 대 28~31ms). 행 잠금, 재고 차감, 주문·outbox·멱등 키 기록을 한 트랜잭션에서 하기 때문이다. 결제만 재는 시나리오에는 목록 쪽 숫자가 아예 없다.

2. 목록은 혼자서는 5ms짜리 가벼운 요청인데, 사용자가 늘면 같은 서버에서 결제와 함께 느려진다. VU 50명에서 이미 100ms를 넘었고, VU 200명에서는 목록도 기준(200ms)을 넘었다.

3. 처리량 숫자는 결제만 잴 때보다 훨씬 작다. 사용자마다 한 바퀴에 1초를 쉬기 때문이다. 같은 서버가 결제만으로는 VU 50명에서 초당 526~529건을 처리했다(2단계 작업 1).

4. 리틀의 법칙으로도 맞는다. VU 50명의 첫 회는 한 바퀴에 평균 1.16초(쉬는 1초 + 요청 두 개)를 썼다. 50 ÷ 1.16 ≈ 초당 43바퀴, 요청으로는 약 86건으로, 그 회의 처리량 85.8건/초와 같다.

> 태그별 기준선을 걸어 두면 k6가 "어느 요청이" 기준을 넘었는지 따로 알려 준다. VU 200명에서는 결제뿐 아니라 가벼운 목록도 200ms를 넘었다는 것이 따로 보인다.

## 8. 완성 확인

- [ ] k6로 VU를 늘려 가며 처리량이 멈추는 지점과 그때의 p95를 찾았다

- [ ] 그 한계가 API의 CPU에서 온다는 것을 `docker stats`로 확인했다

- [ ] 인기 상품 하나에 몰리면 잠금 때문에 처리량이 낮아지는 것을 쟀다

- [ ] 부하 뒤에도 재고 장부가 맞는다

- [ ] 추적·로그 설정에 따른 처리량 차이를 쟀고, 샘플링 비율을 로그로 확인했다

- [ ] 운영 빌드에서 CSP 헤더가 붙고, 위반 없이 e2e 6개가 통과한다

- [ ] 허용 목록에서 필요한 것을 빼면 조용히 깨지는 것을 재현했다

## 9. 다음 단계

### 자가 점검

1. 사용자를 늘렸는데 처리량은 그대로이고 p95만 늘었다. 무슨 일이 일어나고 있는가?

2. 처음 실행에서 결과가 지나치게 좋았던 이유는? 그걸 막는 장치는?

3. 같은 서버에서 인기 상품 하나에 몰리면 처리량이 낮아지는 이유를 `02`의 잠금으로 설명하면?

4. 추적을 10%만 샘플링해도 끈 것만큼 빨라지지 않은 이유는?

5. CSP에 nonce를 쓰려면 왜 페이지를 요청마다 렌더링해야 하는가?

6. `connect-src`에 저장소 주소가 꼭 필요한 이유는? `img-src`에서 빼면 무엇이 깨지는가?

7. CSP를 개발 서버가 아니라 운영 빌드로 확인해야 하는 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 부하를 오래 거는 내구성 테스트, 순간적으로 몰리는 스파이크 테스트, 한계까지 미는 스트레스 테스트

- 여러 대의 부하 발생기로 분산 부하 만들기, 결과를 시계열로 저장해 그래프로 보기

- CSP 위반 보고를 수집하는 엔드포인트(`report-to`), 해시 기반 CSP, 하위 리소스 무결성(SRI)

- 그 밖의 보안 헤더(`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`)
