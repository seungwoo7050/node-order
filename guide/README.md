# 모니터링과 경보: 지표를 모으고, 이상하면 먼저 알림 받기

## 목표

이 프로젝트는 [`14-stripe`](https://github.com/seungwoo7050/node-order/tree/14-stripe)로부터 시작한다.

이미 로그(pino)와 추적(Jaeger)을 붙였다. 둘 다 "무슨 일이 있었는지 찾아볼 때" 쓴다.

이 문서는 지표를 더한다. 요청 수, 응답 시간, 오류 비율 같은 숫자를 시간에 따라 모은다.

그 숫자가 이상해지면 사람이 들여다보기 전에 경보가 온다.

1. API가 `/metrics`로 지표를 내보낸다(요청 수·응답 시간·오류, Node 프로세스 상태, outbox 적체, 웹훅 결과)

2. Prometheus가 지표를 모으고 경보 규칙을 평가한다. Alertmanager가 경보를 묶어 보내고, Grafana로 대시보드를 본다

3. DB 장애, API 다운, 짧은 튐을 실제로 일으켜 경보가 맞게 울리는지 본다

4. 경보 규칙을 단위 테스트한다

```text
DB 정지 15:11:55
15:13:06 🔥 [firing] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 98.02%
DB 시작 15:13:36
15:14:06 ✅ [resolved] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 7.51%
```

> 시작 기준점:  
> `14-stripe`까지 마친 워크스페이스(`order-api-nest` + `order-console-next`)에서 시작한다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·설정·문법의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러거나 틀린 경보다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 8장에서 "어느 층에서 틀어졌나"를 가르는 절차 | 필요할 때 친다(`curl`, Prometheus 화면) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 8장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가를 수 있다.

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일: 코드, 설정 파일(`monitoring/`, `docker-compose.yml`), 새 스크립트·테스트, 패키지 설치 | 한다 |
  | `[실행]` | 저장소 밖의 상태: 컨테이너. 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다: 요청 보내기, 장애를 일으켰다가 되돌리기, 결과 읽기 | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다 | 안 한다 |

  한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`). 이 문서의 실험은 각 실험 블록 끝에서 스스로 되돌리므로 `[원복]` 작업은 따로 없다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 8장 "진단 4"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 설치·이름 바꾸기뿐이고, 8·9장(디버깅, 운영)과 10·11장(체크리스트)에는 `남길 것`을 두지 않았다.

- 실험과 도전 과제에서 코드를 바꾼 상태는 `practice/` 아래에 있다. `break-url-label`(실험 ①), `break-metrics-db-failure`(실험 ②), `break-alert-without-for`(실험 ③), `challenge-*`(9장 도전 과제)다.

| 단계 | 하는 일 |
|---|---|
| [0. 모니터링에 대한 사전지식](#0-모니터링에-대한-사전지식) | 로그·추적·지표의 차이, pull 방식, 경보의 흐름, 라벨과 시계열(작업 없음) |
| [1. 준비](#1-준비) | `prom-client`를 설치하고, 설치가 덜 끝났을 때 다시 까는 법과 compose 프로젝트 이름을 확인한다 |
| [2. 1단계: `/metrics` 내보내기](#2-1단계-metrics-내보내기) | 요청 히스토그램·outbox 게이지·웹훅 카운터를 `/metrics`로 내보내고, 실제 URL을 라벨로 넣어 시계열을 폭증시켜 본다 |
| [3. 2단계: Prometheus, Alertmanager, Grafana](#3-2단계-prometheus-alertmanager-grafana) | 수집·경보 규칙·배달·대시보드를 compose `monitoring` 프로필로 띄운다 |
| [4. 3단계: DB 장애](#4-3단계-db-장애) | DB를 멈춰 `/metrics`까지 실패하는 것을 보고, 실패를 그 지표에 가둔다 |
| [5. 4단계: `for` 없는 경보 (일부러 깨뜨려보기 ③)](#5-4단계-for-없는-경보-일부러-깨뜨려보기-③) | 10초 튐에 `for`가 없으면 울리는 것을 본다 |
| [6. 5단계: API 다운](#6-5단계-api-다운) | API 프로세스를 끄고 `up`으로 거는 경보를 본다 |
| [7. 6단계: 테스트](#7-6단계-테스트) | `promtool`로 경보 규칙을, e2e로 `/metrics`를 회귀 테스트한다 |
| [8. 디버깅](#8-디버깅) | 어디를 보는지, 자주 쓰는 PromQL, 증상·에러 신호 표 |
| [9. 운영에서 생각할 것](#9-운영에서-생각할-것) | `/metrics` 노출, 수집 간격, 증상에 거는 경보, 여러 인스턴스, 도전 과제 |
| [10. 완성 확인](#10-완성-확인) | 체크리스트 |
| [11. 다음 단계](#11-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 모니터링에 대한 사전지식

### 개념 1 | 로그·추적·지표

| | 무엇 | 언제 쓰나 |
|---|---|---|
| 로그 | 요청 하나하나의 기록 | "이 요청에 무슨 일이 있었나" |
| 추적 | 요청 하나가 거친 단계(HTTP → SQL → Redis)의 시간 | "이 요청은 어디서 느렸나" |
| 지표(이 문서) | 숫자의 시간별 흐름(초당 요청 수, p95, 오류 비율) | "지금 서비스가 괜찮은가", "언제부터 이상했나" |

로그로 "최근 1분 오류 비율"을 구하려면 로그를 전부 읽어 세야 한다. 지표는 처음부터 세어 둔 숫자다.

C로 치면 리눅스의 `/proc/net/dev`가 패킷을 하나하나 기록하지 않고 누적 카운터만 들고 있는 것과 같다.

필요한 사람이 가끔 읽어 가서 "지난번보다 얼마나 늘었나"를 계산한다.

### 개념 2 | Prometheus는 가져간다(pull).

API가 지표를 어딘가로 보내지 않는다. API는 `/metrics`에 지금 값을 텍스트로 보여 줄 뿐이고, **Prometheus가 몇 초마다 가져간다**(scrape).

가져갈 때마다 시각과 값을 저장해 시계열을 만든다. 가져가지 못하면 그 자체가 신호다(`up` = 0).

지표 종류는 세 가지면 충분하다.

| 종류 | 성질 | 예 |
|---|---|---|
| 카운터(counter) | 늘기만 한다(프로세스가 재시작하면 0부터) | 요청 수, 처리한 웹훅 수 |
| 게이지(gauge) | 오르내린다 | 메모리, outbox 미발송 건수 |
| 히스토그램(histogram) | 값을 구간(bucket)별로 센다 | 응답 시간. "0.05초 이하가 몇 건, 0.1초 이하가 몇 건..." |

카운터는 값 자체보다 증가 속도가 중요하다. Prometheus의 `rate(x[30s])`는 "최근 30초 동안 초당 몇씩 늘었나"다.

히스토그램에서는 `histogram_quantile(0.95, ...)`로 p95를 계산한다.

### 개념 3 | 경보는 규칙 + 기다림 + 배달

```text
Prometheus : 규칙(expr)이 참 → pending ─(for 동안 계속 참)→ firing ──▶ Alertmanager ──▶ 받는 곳(Slack, 메일, 웹훅)
                                     └(중간에 거짓)→ inactive                 (묶기, 중복 거르기, 해제 알림)
```

`for`는 "이만큼 계속돼야 진짜로 본다"는 기다림이다. 4단계에서 이것이 없을 때를 본다.

### 개념 4 | 라벨 하나하나가 시계열이다.

`http_request_duration_seconds_count{method="GET", route="/orders/:id", status_code="200"}`처럼 지표에는 라벨이 붙는다. **라벨 값의 조합마다 시계열이 하나** 생긴다.

Prometheus는 시계열마다 메모리와 디스크를 쓴다. 그래서 라벨 값의 종류가 적어야 한다.

1단계에서 이걸 어긴다.

## 1. 준비

### 작업 1. [커밋] 폴더 복사와 prom-client 설치

```sh
cp -R 14-stripe 15-monitoring && cd 15-monitoring
rm -rf node_modules order-api-nest/dist order-console-next/.next
npm install
npm install prom-client -w order-api-nest
```

`prom-client` 15.1.3을 썼다. 이후 명령은 따로 적지 않으면 `order-api-nest`에서 친다.

### 개념 | 설치가 덜 끝난 `node_modules`

`npm install`이 도중에 끊기거나 압축 해제가 덜 끝나면, 패키지 폴더와 `package.json`은 있는데 안의 파일이 빠진 채로 남는다. `npm ls`로 보면 버전까지 멀쩡히 나온다.

그래서 설치 때가 아니라 처음 실행할 때 드러난다. 1단계 작업 5에서 `npm run start:dev`를 치면 `nest` CLI가 뜨기도 전에 멈춘다.

```text
Error: Cannot find package '.../node_modules/emojilib/index.js' imported from .../node_modules/node-emoji/lib/index.js
  code: 'ERR_MODULE_NOT_FOUND'
```

이때 `emojilib` 폴더에는 `package.json`과 크기 0인 `emojis.json`만 있었다. 같은 설치에서 61개 패키지가 이렇게 비어 있었다. 메시지에 나온 패키지 하나만 고치지 않고, lock 파일 그대로 처음부터 다시 깐다.

```sh
# 워크스페이스 루트에서
npm cache verify # 내려받아 둔 캐시를 검사하고 정리한다
npm ci # node_modules를 지우고 package-lock.json 그대로 다시 설치한다
```

`npm ci`는 `package-lock.json`을 고치지 않는다. `prom-client`는 위의 설치로 이미 lock에 들어 있으므로 다시 칠 필요 없다.

### 개념 | compose 프로젝트 이름

compose 파일에 `name:` 줄이 없으므로 프로젝트 이름은 compose 파일이 있는 폴더 이름이다. `order-api-nest/docker-compose.yml`이니 `order-api-nest`다.

복사한 폴더도 compose 파일은 `order-api-nest/` 안에 있어 이름이 같다. 앞 폴더의 컨테이너와 볼륨을 그대로 이어 쓴다.

API는 지금까지처럼 PC에서 `npm run start:dev`로 띄우고, 모니터링 도구만 컨테이너로 띄운다.

| 도구 | 주소 | 이미지 크기(작성 시점) |
|---|---|---|
| Prometheus | http://localhost:9090 | 357MB |
| Alertmanager | http://localhost:9093 | 117MB |
| Grafana | http://localhost:3001 (3000은 Next) | 1.81GB |

## 2. 1단계: `/metrics` 내보내기

### 작업 1. [커밋] 지표 정의와 요청 지표 미들웨어

지표 정의와, 모든 요청의 처리 시간을 재는 미들웨어를 한 파일에 둔다.

```ts
// src/metrics/metrics.ts
import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// 지표 저장소. /metrics가 이걸 텍스트로 내보낸다
export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// 요청 처리 시간. 값의 종류가 적은 것만 라벨로 쓴다(1단계)
export const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP 요청 처리 시간(초)",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// 앞에서 만든 Stripe 웹훅 처리 결과(processed / duplicate / ignored)
export const webhookEvents = new Counter({
  name: "stripe_webhook_events_total",
  help: "처리한 Stripe 웹훅 이벤트 수",
  labelNames: ["type", "result"] as const,
  registers: [registry],
});

// 라벨에 넣을 경로: 실제 URL(/orders/123)이 아니라 경로 패턴(/orders/:id)
function routeOf(req: Request): string {
  const path = req.route?.path as string | undefined;
  // 어느 컨트롤러에도 안 걸린 요청(404)은 한 값으로 묶는다
  if (!path || path === "{/*splat}") return "unmatched";
  return `${req.baseUrl}${path}`; // /orders/:id, /trpc/*path(tRPC) ...
}

// 모든 요청에 붙는 미들웨어. 응답이 끝나는 순간(finish) 걸린 시간을 기록한다
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Prometheus가 가져가는 요청 자체는 세지 않는다. req.path는 미들웨어 기준 경로라 원래 URL로 비교한다
  if (req.originalUrl.split("?")[0] === "/metrics") return next();
  const end = httpDuration.startTimer(); // 지금 시각을 기억한 함수를 돌려받는다
  res.on("finish", () => end({ method: req.method, route: routeOf(req), status_code: String(res.statusCode) }));
  next();
}
```

### 작업 2. [커밋] `/metrics` 컨트롤러와 outbox 적체 게이지

`/metrics` 경로와, DB에 묻는 게이지 하나를 모듈 파일에 둔다.

`collect` 안은 우선 한 줄로 쓴다. 이 한 줄이 무엇을 망가뜨리는지는 3단계에서 직접 겪고 고친다.

```ts
// src/metrics/metrics.module.ts
import { Controller, Get, Header, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { Gauge } from "prom-client";
import { PrismaService } from "../prisma/prisma.service.js";
import { httpMetricsMiddleware, registry } from "./metrics.js";

@Controller()
class MetricsController {
  // 운영에서는 이 경로를 밖에 열지 않는다(9장)
  @Get("metrics")
  @Header("Content-Type", registry.contentType)
  metrics() {
    return registry.metrics();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule implements NestModule {
  constructor(prisma: PrismaService) { // PrismaModule이 @Global()이라 imports 없이 주입된다
    // 아직 보내지 않은 outbox 알림 수
    new Gauge({
      name: "outbox_unpublished_events",
      help: "아직 발행되지 않은 outbox 이벤트 수",
      registers: [registry],
      async collect() { // 화살표 함수로 쓰면 안 된다(아래 "collect" 개념)
        this.set(await prisma.outboxEvent.count({ where: { publishedAt: null } }));
      },
    });
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(httpMetricsMiddleware).forRoutes("*"); // 모든 경로에 미들웨어를 건다
  }
}
```

### 작업 3. [커밋] `AppModule`에 등록하기

`app.module.ts`의 `imports` 목록 맨 앞(`LoggerModule` 다음)에 `MetricsModule`을 넣는다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열 맨 앞의 MetricsModule만 추가한다
import { MetricsModule } from "./metrics/metrics.module.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [
    LoggerModule.forRoot(loggerOptions),
    MetricsModule, PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule, CategoriesModule, TrpcModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

> 미들웨어는 모듈 순서대로 등록된다. `12`의 `TrpcModule`은 요청을 받아 응답까지 끝내므로, 그보다 앞에 있어야 tRPC 요청도 센다.

배열이 길어서 끝(`PaymentsModule` 뒤)에 덧붙이기 쉽다. 그래도 서버는 뜨고 `/metrics`도 나오며, 다른 경로는 다 세어진다. tRPC 요청만 빠지므로 작업 5의 출력에서 한 줄이 없는 것으로만 드러난다.

여기서 빠뜨리면 서버는 멀쩡히 뜨는데 `GET /metrics`만 404가 난다. Nest는 `AppModule`의 `imports` 사슬에 있는 모듈만 알기 때문이다.

### 작업 4. [커밋] 웹훅 처리 결과 세기

`14`의 웹훅 결과도 센다. 원래 `handle`의 본문을 `process`로 옮기고, `handle`은 결과를 센 뒤 그대로 돌려준다.

```ts
// src/payments/payments.service.ts
// import 한 줄을 추가하고, handle을 둘로 나눈다
import { webhookEvents } from "../metrics/metrics.js";

  async handle(event: Stripe.Event): Promise<WebhookResult> {
    const result = await this.process(event);
    webhookEvents.inc({ type: event.type, result }); // 처리 결과를 지표로
    return result;
  }

  private async process(event: Stripe.Event): Promise<WebhookResult> {
    // (원래 handle의 내용)
```

컨트롤러는 그대로 `this.payments.handle(event)`를 부르므로 고칠 곳이 없다.

### 작업 5. [확인] 요청을 보내고 `/metrics` 보기

`npm run start:dev`로 API를 띄우고 요청을 몇 개 보낸 뒤 본다.

```sh
for u in /products /orders/1 /orders/2 /orders/999 /trpc/products.list /nope /nope2; do curl -s -o /dev/null localhost:4000$u; done
curl -s localhost:4000/metrics | grep '^http_request_duration_seconds_count'
http_request_duration_seconds_count{method="GET",route="/products",status_code="200"} 1
http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="404"} 1
http_request_duration_seconds_count{method="GET",route="/trpc/*path",status_code="200"} 1
http_request_duration_seconds_count{method="GET",route="unmatched",status_code="404"} 2

curl -s localhost:4000/metrics | grep -E '^(outbox_unpublished_events|nodejs_eventloop_lag_p99_seconds|process_resident_memory_bytes) '
process_resident_memory_bytes 221233152
nodejs_eventloop_lag_p99_seconds 0.011673599
outbox_unpublished_events 0
```

`/orders/1`과 `/orders/2`가 `/orders/:id` 한 줄로 모였다. `route="/metrics"` 줄은 없어야 한다.

`route="/trpc/*path"` 줄만 빠지고 나머지 네 줄이 같다면 `MetricsModule`이 `imports`에서 `TrpcModule`보다 뒤에 있는 것이다.

컨트롤러로 가는 요청(`/products`, `/orders/:id`)은 모든 미들웨어를 지난 뒤에 처리되므로 순서와 상관없이 세어진다. 없는 경로(`unmatched`)도 마찬가지다.

tRPC 요청은 컨트롤러가 아니라 `TrpcModule`의 미들웨어가 응답까지 끝낸다. 그 뒤에 붙은 요청 지표 미들웨어는 아예 불리지 않아 `res.on("finish")`도 걸리지 않는다. 작업 3대로 `MetricsModule`을 맨 앞으로 옮기면 `start:dev`가 다시 띄운 뒤부터 세어진다.

출력이 위와 글자 그대로 같을 필요는 없다. 다음은 달라도 된다.

- **줄 순서**: prom-client는 라벨 조합을 처음 기록된 순서대로 적는다. tRPC 요청이 먼저 들어왔으면 `/trpc/*path` 줄이 맨 위에 온다.

- **세어진 수**: 루프 말고도 요청을 더 보냈으면 그만큼 크다. 반대로 `start:dev`가 파일 변경으로 다시 뜨면 모든 값이 0부터 다시 시작한다. 지표는 프로세스 메모리에 있기 때문이다.

- **메모리, 이벤트 루프 지연**: 기계와 시각마다 다르다. 줄이 있으면 된다.

맞아야 하는 것은 라벨 조합이다. `route` 값이 `/products`, `/orders/:id`, `/trpc/*path`, `unmatched` 네 가지뿐이고, `/orders/1` 같은 실제 URL과 `route="/metrics"`가 없으면 된다.

`stripe_webhook_events_total`은 웹훅이 한 번도 오지 않았으면 `# HELP`, `# TYPE` 두 줄만 나온다. 라벨이 있는 카운터는 첫 `inc` 전까지 값 줄이 없다.

### 개념 | 요청 지표 미들웨어가 경로 패턴을 얻는 때

#### 왜 `finish`에서 라벨을 정하나

미들웨어가 처음 불리는 순간에는 아직 어느 컨트롤러로 갈지 정해지지 않았다.

응답이 끝나는(`finish`) 시점에는 Express가 `req.route`에 "어느 경로 패턴에 걸렸는지"를 채워 둔다. 그래서 `startTimer()`로 시작 시각만 잡아 두고, 라벨은 `finish` 콜백에서 넣는다.

`startTimer()`가 돌려준 `end`는 시작 시각을 품고 있는 클로저다. C로 치면 `struct { double start; }`와 "끝날 때 부를 함수"를 한 덩어리로 들고 있는 셈이고, `end(라벨)`을 부르면 지금 시각과의 차이가 그 라벨 조합의 히스토그램에 기록된다.

#### `{/*splat}`과 `unmatched`

처음에는 어느 경로에도 안 걸린 `/nope`이 `route="{/*splat}"`로 나왔다.

Nest가 404를 내려고 마지막에 두는 처리 경로의 패턴이다. 그래서 그 값을 `unmatched`로 바꿨다.

이렇게 묶지 않으면 아무 URL이나 찔러 보는 요청마다 시계열이 생길 수 있다(아래 실험 ①과 같은 문제다).

#### `/metrics` 요청을 거르는 비교

`forRoutes("*")`로 붙인 미들웨어 안에서 `req.path`는 `"/metrics"`가 아니다. 그래서 처음에 `req.path`로 비교했을 때는 5초마다 오는 수집 요청이 `route="/metrics"` 200으로 집계됐다.

수집 요청은 늘 성공하므로 5xx 비율의 분모만 부풀린다. 트래픽이 적을 때 HighErrorRate가 묽어진다.

`req.originalUrl`은 미들웨어가 어디에 걸렸든 클라이언트가 보낸 원래 URL이다. 쿼리(`?...`)만 떼고 비교한다.

#### 등록 순서

Nest는 각 모듈의 `configure()`에 적힌 미들웨어를 `imports` 순서대로 Express에 붙인다.

tRPC는 `TrpcModule`의 미들웨어가 요청을 받아 응답까지 끝내므로, 그 뒤에 붙은 미들웨어에는 tRPC 요청이 오지 않는다. 작업 3에서 `MetricsModule`을 맨 앞에 둔 이유다.

`imports` 순서가 늘 중요한 것은 아니다. 주입(어느 서비스가 어느 서비스를 받는지)과 컨트롤러 경로는 Nest가 모듈 전체를 읽은 뒤 짝지으므로, 순서를 바꿔도 결과가 같다. 지금까지 모듈을 아무 데나 더해도 문제가 없었던 이유다.

순서가 결과를 바꾸는 것은 `configure()`로 미들웨어를 붙이는 모듈뿐이다. 이 앱에서는 셋이고, 그 앞에 `main.ts`의 `app.use`가 있다.

| 순서 | 모듈 | 붙이는 미들웨어 |
|---|---|---|
| 0 | `main.ts` | `enableCors`, `app.use(cookieParser())` |
| 1 | `LoggerModule` | `nestjs-pino`의 요청 로그(`pino-http`) |
| 2 | `MetricsModule` | 요청 지표 |
| 3 | `TrpcModule` | tRPC 처리. 응답을 끝내고 다음으로 넘기지 않는다 |

요청을 지켜보기만 하는 미들웨어(로그, 지표)는 앞에, 응답을 끝내 버리는 미들웨어는 뒤에 둔다. `LoggerModule`이 맨 앞이라 tRPC 요청도 로그에는 남는다.

`main.ts`가 0번인 것은 붙는 때가 달라서다. `app.use`는 부르는 즉시 Express에 붙는다. 모듈의 `configure()`는 `app.listen`이 앱을 초기화할 때 붙는다. 그래서 `imports`를 어떻게 놓아도 쿠키 파싱은 tRPC보다 앞이다.

작업 3의 코드대로 놓았다면 `LoggerModule` → `MetricsModule` → ... → `TrpcModule` → `PaymentsModule`이다. 사이에 낀 `PrismaModule`~`CategoriesModule`과 `TrpcModule` 뒤의 `PaymentsModule`은 미들웨어가 없어 자리를 옮길 필요가 없다.

새 모듈을 더할 때는 그 모듈이 `implements NestModule`로 `configure()`를 갖는지만 보면 된다. 없으면 어디에 넣어도 된다.

### 용어 | prom-client API

- `new Registry()`: 지표를 모아 두는 저장소다. 지표마다 `registers: [registry]`로 어느 저장소에 넣을지 정한다.

- `collectDefaultMetrics({ register })`: Node 프로세스 기본 지표(CPU, 메모리(힙), 이벤트 루프 지연, GC 시간 등)를 자동으로 모은다.

- `new Histogram({ name, help, labelNames, buckets })`: 값을 `buckets`에 적은 경계(초)별로 센다. `/metrics`에 실제로 어떻게 나오는지는 아래 "히스토그램은 경계마다 카운터를 하나씩 둔다"에서 다룬다.

- `new Counter({ ... })`: 늘기만 하는 지표다. `.inc(라벨)`로 1씩 올린다.

- `histogram.startTimer()`: 지금부터 시간을 재기 시작하고, 끝낼 때 부를 함수를 돌려준다. 그 함수에 라벨을 넘기면 걸린 시간이 기록된다.

- `new Gauge({ ..., collect() })`: 오르내리는 지표다. `collect`를 주면 값을 미리 세어 두지 않고 가져갈 때마다 채운다. 아래 "`collect`: 가져갈 때 값을 채우는 지표"에서 다룬다.

- `registry.metrics()`: 저장소의 모든 지표를 Prometheus가 읽는 텍스트 형식으로 만든다(Promise).

- `registry.contentType`: 그 텍스트 형식의 `Content-Type` 값이다.

### 개념 | 히스토그램은 경계마다 카운터를 하나씩 둔다

0장 개념 2에서 히스토그램은 "값을 구간별로 센다"고 했다.

실제로는 `buckets`에 적은 경계마다 "걸린 시간이 이 값 이하인 요청이 몇 건인가"를 세는 카운터가 하나씩 있다. 걸린 시간 자체는 어디에도 저장하지 않는다.

`/orders/:id` 요청이 0.03초, 0.2초 걸렸다고 하자. `startTimer()`가 돌려준 `end`도 결국 아래처럼 걸린 시간을 기록한다.

```ts
httpDuration.observe({ method: "GET", route: "/orders/:id", status_code: "200" }, 0.03);
httpDuration.observe({ method: "GET", route: "/orders/:id", status_code: "200" }, 0.2);
```

`/metrics`에는 이렇게 나온다.

```text
http_request_duration_seconds_bucket{le="0.005",method="GET",route="/orders/:id",status_code="200"} 0
http_request_duration_seconds_bucket{le="0.01",method="GET",route="/orders/:id",status_code="200"} 0
http_request_duration_seconds_bucket{le="0.025",method="GET",route="/orders/:id",status_code="200"} 0
http_request_duration_seconds_bucket{le="0.05",method="GET",route="/orders/:id",status_code="200"} 1
http_request_duration_seconds_bucket{le="0.1",method="GET",route="/orders/:id",status_code="200"} 1
http_request_duration_seconds_bucket{le="0.25",method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_bucket{le="0.5",method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_bucket{le="1",method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_bucket{le="2.5",method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_bucket{le="+Inf",method="GET",route="/orders/:id",status_code="200"} 2
http_request_duration_seconds_sum{method="GET",route="/orders/:id",status_code="200"} 0.23
http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="200"} 2
```

- `le`는 "이하"(less than or equal)다. 0.2초 요청은 0.25, 0.5, 1, 2.5, `+Inf` 칸 모두에 1씩 더해진다. 그래서 칸의 값은 경계를 따라 내려가지 않고 쌓이기만 한다.

- `+Inf` 칸은 prom-client가 알아서 붙이는 마지막 칸이라 늘 `_count`와 같다.

- `_sum`(걸린 시간의 합)과 `_count`(요청 수)도 함께 나온다. 이 문서가 요청 수와 오류 비율을 따로 센 카운터 없이 `http_request_duration_seconds_count`로 구하는 이유다.

- 라벨 조합 하나마다 경계 9개 + `+Inf` + `_sum` + `_count`, 12줄이 생긴다. 아래 "일부러 깨뜨려보기 ①"에서 이 12줄이 라벨 값 수만큼 곱해진다.

- 0.2초가 0.1~0.25 칸 어디쯤인지는 남지 않는다. p95는 칸 안을 짐작해 계산하며, 그 계산은 도전 과제 1에서 직접 본다.

> C로 치면 관측할 때마다 `for (i = 0; i < n; i++) if (v <= bound[i]) count[i]++;`를 도는 누적 도수 배열이다.

### 개념 | `collect`: 가져갈 때 값을 채우는 지표

#### 언제 불리나

카운터와 히스토그램은 요청이 끝날 때처럼 일이 생기는 순간 코드가 값을 올린다.

"지금 DB에 미발송 outbox가 몇 건인가"는 그렇게 올리기 어렵다. 값이 API 밖(DB)에 있기 때문이다.

`collect`를 주면 `registry.metrics()`가 텍스트를 만들기 직전에 그 함수를 부른다. 즉 Prometheus가 `/metrics`를 가져갈 때마다 DB에 묻고, `this.set(값)`으로 채운 값을 내보낸다.

`async` 함수면 끝날 때까지 기다린다. `registry.metrics()`는 모든 지표의 값을 `Promise.all`로 한꺼번에 기다린 뒤 텍스트를 만든다.

#### 화살표 함수를 쓰면 안 되는 이유

`this`가 Gauge 자신이어야 하므로 화살표 함수로 쓰면 안 된다.

```ts
// 잘못: 화살표 함수의 this는 Gauge가 아니라 바깥의 MetricsModule이다
new Gauge({
  name: "outbox_unpublished_events",
  help: "아직 발행되지 않은 outbox 이벤트 수",
  registers: [registry],
  collect: async () => {
    this.set(await prisma.outboxEvent.count({ where: { publishedAt: null } }));
  },
});
// 가져갈 때 TypeError: this.set is not a function
```

- 타입 검사(`tsc`)는 `Property 'set' does not exist on type 'MetricsModule'.`(TS2339)로 잡아 준다. 검사 없이 띄운 상태라면 가져가는 순간에야 터진다.

- `collect`가 느리면 `/metrics` 응답 전체가 그만큼 늦어진다. 3단계에서 1초 시간 제한(`Promise.race`)을 두는 이유다.

- `collect`가 던진 예외는 이 지표 하나가 아니라 `/metrics` 전체를 실패시킨다. 위의 `Promise.all`이 하나라도 실패하면 전체가 실패하기 때문이다. 3단계에서 직접 겪는다.

#### 왜 모듈 생성자에서 만드나

`metrics.ts`의 다른 지표는 파일 최상단에서 만든다. 이 게이지만 `MetricsModule`의 생성자에서 만드는 것은 `collect`가 `PrismaService`를 써야 해서다.

파일 최상단의 코드에는 Nest가 아무것도 주입해 주지 않는다. Nest가 만드는 클래스(모듈·컨트롤러·프로바이더)의 생성자에서만 `PrismaService`를 받을 수 있다.

같은 이름의 지표를 한 저장소에 두 번 만들면 prom-client가 `A metric with the name outbox_unpublished_events has already been registered.`로 멈춘다. 모듈 생성자는 앱 하나에 한 번만 불리므로 여기서는 생기지 않는다.

> C로 치면 0장 개념 1의 `/proc/net/dev`와 같다. 그 파일의 내용은 어디에 써 둔 것이 아니라, 읽는 순간 커널이 그때 값을 채워 보여 준다.

### 실험 | 일부러 깨뜨려보기 ①: 실제 URL을 라벨로

`httpMetricsMiddleware`의 `res.on` 한 줄을 잠깐 바꾼다.

```ts
// src/metrics/metrics.ts
// routeOf(req) 대신 실제 URL을 라벨로 넣는다
  res.on("finish", () => end({ method: req.method, route: req.originalUrl, status_code: String(res.statusCode) })); // 깨뜨려보기
```

주문 번호 1~300으로 요청을 보내고, 바꾸기 전과 줄 수·크기를 비교한다.

```sh
for i in $(seq 1 300); do curl -s -o /dev/null localhost:4000/orders/$i; done
curl -s localhost:4000/metrics | grep -c '^http_request_duration_seconds' # 시계열 줄 수
curl -s localhost:4000/metrics | wc -c # /metrics 크기(바이트)
```

```text
경로 패턴: 시계열 72줄, /metrics 16430바이트
실제 URL : 시계열 3648줄, /metrics 370904바이트
Prometheus의 버킷 시계열 수: 3040
```

요청 300개로 시계열이 50배가 됐다. 히스토그램은 라벨 조합 하나마다 구간(bucket) 10개 + 합계 + 개수, 12줄을 만든다.

실제 서비스에서는 주문 번호, 사용자 id, 검색어, 쿼리 문자열마다 늘어난다. 결국 Prometheus의 메모리가 터지거나 질의가 느려진다.

한번 들어간 시계열은 보존 기간 동안 남는다.

실제로 이 실험 뒤 Grafana의 "경로별 요청 수" 범례는 `/orders/100`, `/orders/101`...로 가득 찼다. 되돌린다.

> 라벨에 넣어도 되는 것은 경로 패턴, HTTP 메서드, 상태 코드, 결과 종류처럼 가짓수가 정해진 값이다. id, 이메일, URL 원문, 에러 메시지 원문은 넣으면 안 된다.

### 남길 것

- **찾아보면 되는 것**: prom-client 생성자의 옵션 이름(`name`, `help`, `labelNames`, `buckets`, `registers`), 기본 지표의 이름(`process_resident_memory_bytes`, `nodejs_eventloop_lag_p99_seconds`), 설치가 깨졌을 때 다시 까는 `npm ci`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 라벨 값의 조합마다 시계열이 하나 생기고, 히스토그램은 그 하나가 12줄이다. 라벨에는 경로 패턴·메서드·상태 코드처럼 가짓수가 정해진 값만 넣는다.

  - `collect`는 가져갈 때마다 돌고, 그 안의 지연과 예외는 `/metrics` 전체로 번진다.

  - `imports` 순서는 `configure()`로 미들웨어를 붙이는 모듈 사이에서만 중요하다. 지켜보는 미들웨어는 앞에, 응답을 끝내는 미들웨어는 뒤에 둔다.

- **에러 신호**:

  - `npm run start:dev`가 `Error: Cannot find package '.../node_modules/emojilib/index.js'`(`ERR_MODULE_NOT_FOUND`)로 바로 멈춘다 → 1장의 설치가 덜 끝났는지. 그 패키지 폴더를 `ls`로 보고, 파일이 빠졌으면 루트에서 `npm ci`

  - 서버는 뜨는데 `GET /metrics`만 404 → `app.module.ts`의 `imports`에 `MetricsModule`이 있는지

  - `/metrics`에 `route="/trpc/*path"` 줄만 없다(`/trpc/...` 요청이 지표에 안 보인다) → `MetricsModule`이 `imports`에서 `TrpcModule`보다 앞인지. 배열 끝에 덧붙이지 않았는지

  - `route="{/*splat}"` 줄이 보인다 → `routeOf`가 404 요청을 `unmatched`로 묶는지

  - `route="/metrics"` 줄이 5초마다 는다 → 미들웨어가 `req.originalUrl`로 `/metrics`를 거르는지

  - `TypeError: this.set is not a function` 또는 `Property 'set' does not exist on type 'MetricsModule'.` → `collect`를 화살표 함수로 썼는지

  - Grafana 범례가 `/orders/100`, `/orders/101`...로 가득 찬다 → 라벨에 실제 URL이 들어갔는지

## 3. 2단계: Prometheus, Alertmanager, Grafana

설정 파일은 `order-api-nest/monitoring/`에 둔다.

### 작업 1. [커밋] Prometheus 수집 설정

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 5s # 학습용으로 짧게. 운영에서는 15초~1분이 흔하다
  evaluation_interval: 5s

rule_files:
  - /etc/prometheus/alert-rules.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

scrape_configs:
  - job_name: order-api
    static_configs:
      # PC에서 npm run start:dev로 띄운 API
      # (compose의 --profile app으로 API를 컨테이너로 띄웠다면 "api:4000")
      - targets: ["host.docker.internal:4000"]
```

`rule_files`의 경로는 PC의 경로가 아니라 컨테이너 안의 경로다. 작업 5에서 compose가 `./monitoring/alert-rules.yml`을 그 자리에 마운트한다.

### 작업 2. [커밋] 경보 규칙 세 개

```yaml
# monitoring/alert-rules.yml
groups:
  - name: order-api
    rules:
      # Prometheus가 /metrics를 못 가져왔다 = 프로세스가 죽었거나 응답을 못 한다
      - alert: ApiDown
        expr: up{job="order-api"} == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "order-api가 응답하지 않는다"
          description: "{{ $labels.instance }}의 /metrics를 30초 넘게 가져오지 못했다"

      # 최근 30초 요청 중 5xx 비율이 5%를 넘는 상태가 1분 이어졌다
      # for(1분)가 비율을 재는 창(30초)보다 길어야 짧은 튐을 걸러 낸다(4단계)
      - alert: HighErrorRate
        expr: |
          sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[30s]))
            / sum(rate(http_request_duration_seconds_count[30s])) > 0.05
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "5xx 응답 비율이 높다"
          description: "최근 30초 5xx 비율 {{ $value | humanizePercentage }}"

      # 보내지 못한 outbox 알림이 쌓인다(outbox relay가 멈췄거나 느리다)
      - alert: OutboxBacklog
        expr: outbox_unpublished_events > 20
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "outbox 알림이 쌓이고 있다"
          description: "발행되지 않은 이벤트 {{ $value }}건"
```

### 작업 3. [커밋] Alertmanager 배달 설정

```yaml
# monitoring/alertmanager.yml
route:
  receiver: local-webhook
  group_by: ["alertname"]
  group_wait: 5s
  group_interval: 30s
  repeat_interval: 1h

receivers:
  - name: local-webhook
    webhook_configs:
      # Slack·메일 대신 PC에서 띄운 작은 수신기(scripts/alert-receiver.mjs)로 보낸다
      - url: http://host.docker.internal:5001/alerts
        send_resolved: true
```

### 작업 4. [커밋] Grafana 데이터 소스와 대시보드 자동 등록

Grafana는 뜰 때 데이터 소스와 대시보드를 파일에서 읽게 한다(손으로 등록하지 않는다).

```yaml
# monitoring/grafana/provisioning/datasources/prometheus.yml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
```

```yaml
# monitoring/grafana/provisioning/dashboards/dashboards.yml
# 이 폴더의 JSON 대시보드를 Grafana가 뜰 때 불러온다
apiVersion: 1
providers:
  - name: order-api
    folder: ""
    type: file
    options:
      path: /var/lib/grafana/dashboards
```

대시보드 파일(`monitoring/grafana/dashboards/order-api.json`)은 패널 배치까지 담은 JSON이라 손으로 치지 않고 아래를 그대로 붙여 넣는다.

이 파일을 빠뜨려도 compose는 뜬다. 마운트할 폴더가 없으면 Docker가 빈 `dashboards/` 폴더를 만들어 이어 주기 때문이다. 그러면 Grafana에 대시보드가 하나도 없고(`curl -s localhost:3001/api/search`가 `[]`), http://localhost:3001/d/order-api 는 "Dashboard not found"다.

Grafana는 이 폴더를 몇 초마다 다시 읽으므로, 띄운 뒤에 파일을 넣어도 다시 띄울 필요 없이 나타난다.

<details>
<summary><code>monitoring/grafana/dashboards/order-api.json</code> 펼치기</summary>

```json
{
  "uid": "order-api",
  "title": "order-api",
  "schemaVersion": 39,
  "refresh": "5s",
  "time": { "from": "now-15m", "to": "now" },
  "panels": [
    {
      "id": 1, "type": "timeseries", "title": "초당 요청 수(경로별)",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "reqps" }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "sum by (route) (rate(http_request_duration_seconds_count[1m]))", "legendFormat": "{{route}}" }
      ]
    },
    {
      "id": 2, "type": "timeseries", "title": "응답 시간 p95",
      "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))", "legendFormat": "p95" }
      ]
    },
    {
      "id": 3, "type": "timeseries", "title": "5xx 비율",
      "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "percentunit", "min": 0 }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "sum(rate(http_request_duration_seconds_count{status_code=~\"5..\"}[1m])) / sum(rate(http_request_duration_seconds_count[1m]))", "legendFormat": "5xx" }
      ]
    },
    {
      "id": 4, "type": "timeseries", "title": "outbox 미발송",
      "gridPos": { "x": 12, "y": 8, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "none", "min": 0 }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "outbox_unpublished_events", "legendFormat": "미발송" }
      ]
    },
    {
      "id": 5, "type": "timeseries", "title": "이벤트 루프 지연 p99",
      "gridPos": { "x": 0, "y": 16, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "nodejs_eventloop_lag_p99_seconds", "legendFormat": "p99" }
      ]
    },
    {
      "id": 6, "type": "timeseries", "title": "메모리(RSS)",
      "gridPos": { "x": 12, "y": 16, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "bytes" }, "overrides": [] },
      "targets": [
        { "refId": "A", "datasource": { "type": "prometheus", "uid": "prometheus" },
          "expr": "process_resident_memory_bytes", "legendFormat": "RSS" }
      ]
    }
  ]
}
```

</details>

그 파일에서 손으로 맞춰야 하는 값은 둘뿐이다.

- 맨 위의 `"uid": "order-api"`: 대시보드 주소 http://localhost:3001/d/order-api 의 마지막 부분이 된다.

- 패널마다 있는 `"datasource": { "type": "prometheus", "uid": "prometheus" }`: 위 데이터 소스 파일의 `uid: prometheus`와 같아야 패널이 데이터를 찾는다.

패널 6개의 질의는 다음과 같다.

| 패널 | PromQL |
|---|---|
| 초당 요청 수(경로별) | `sum by (route) (rate(http_request_duration_seconds_count[1m]))` |
| 응답 시간 p95 | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))` |
| 5xx 비율 | `sum(rate(...{status_code=~"5.."}[1m])) / sum(rate(...[1m]))` |
| outbox 미발송 | `outbox_unpublished_events` |
| 이벤트 루프 지연 p99 | `nodejs_eventloop_lag_p99_seconds` |
| 메모리(RSS) | `process_resident_memory_bytes` |

### 작업 5. [커밋] compose에 monitoring 프로필 추가

`jaeger` 서비스 다음, `--profile app` 서비스들 앞에 세 서비스를 더한다.

```yaml
# docker-compose.yml
# services 아래에 세 서비스를 추가한다
  # ── 모니터링. --profile monitoring 을 붙였을 때만 뜬다 ──
  prometheus:
    image: prom/prometheus:latest
    profiles: ["monitoring"]
    ports:
      - "9090:9090" # 웹 화면과 API
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/alert-rules.yml:/etc/prometheus/alert-rules.yml:ro
    extra_hosts:
      - "host.docker.internal:host-gateway" # 리눅스에서도 컨테이너 안에서 PC를 이 이름으로 찾게 한다
  alertmanager:
    image: prom/alertmanager:latest
    profiles: ["monitoring"]
    ports:
      - "9093:9093"
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
  grafana:
    image: grafana/grafana:latest
    profiles: ["monitoring"]
    ports:
      - "3001:3000" # 3000은 Next가 쓴다
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true" # 학습용: 로그인 없이 보기
      GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
```

### 작업 6. [커밋] 경보 수신기와 트래픽 스크립트

경보를 받을 곳은 Slack 대신 PC에서 띄우는 작은 서버다. 트래픽을 꾸준히 만드는 스크립트도 둔다.

```js
// scripts/alert-receiver.mjs
// Alertmanager가 보내는 경보를 받아 콘솔에 찍는 작은 서버(Slack·메일의 자리). node scripts/alert-receiver.mjs
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 5001);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/alerts") {
      const payload = JSON.parse(body);
      // 한 번의 알림에 같은 그룹의 경보가 여러 개 들어 있을 수 있다
      for (const a of payload.alerts) {
        const time = new Date().toTimeString().slice(0, 8);
        const icon = a.status === "firing" ? "🔥" : "✅";
        console.log(`${time} ${icon} [${a.status}] ${a.labels.alertname} (${a.labels.severity}) - ${a.annotations.summary}: ${a.annotations.description}`);
      }
    }
    res.writeHead(200).end();
  });
}).listen(PORT, () => console.log(`경보 수신기: http://localhost:${PORT}/alerts`));
```

```js
// scripts/traffic.mjs
// API에 꾸준히 요청을 보내고 5초마다 상태 코드 분포를 찍는다. node scripts/traffic.mjs [초당 요청 수]
const API = process.env.API ?? "http://localhost:4000";
const RPS = Number(process.argv[2] ?? 10);
const paths = ["/products", "/trpc/products.list", "/orders/1", "/categories/tree"];
let counts = {};

setInterval(async () => {
  const path = paths[Math.floor(Math.random() * paths.length)];
  const key = await fetch(API + path).then((r) => String(r.status), () => "연결 실패");
  counts[key] = (counts[key] ?? 0) + 1;
}, 1000 / RPS);

setInterval(() => {
  console.log(new Date().toTimeString().slice(0, 8), JSON.stringify(counts));
  counts = {};
}, 5000);
```

### 작업 7. [실행] 띄우고 수집·규칙 확인

API(`npm run start:dev`)를 띄운 채로, 모니터링 도구와 두 스크립트를 띄운다.

```sh
docker compose --profile monitoring up -d prometheus alertmanager grafana
node scripts/alert-receiver.mjs # 터미널 하나
node scripts/traffic.mjs 10 # 터미널 하나. 초당 10건
14:57:36 {"200":50}
```

```sh
curl -s localhost:9090/api/v1/targets # 수집 대상
# 대상: http://host.docker.internal:4000/metrics up
curl -s localhost:9090/api/v1/rules # 규칙
# 규칙: ApiDown inactive ok / HighErrorRate inactive ok / OutboxBacklog inactive ok
```

두 API의 응답은 긴 JSON이라 필요한 칸만 위 주석처럼 요약했다. 같은 내용을 http://localhost:9090/targets 와 http://localhost:9090/alerts 화면에서 볼 수 있다.

9090은 Prometheus 자신의 주소다. 웹 화면(`/targets`, `/alerts`, `/graph`)과 질의 API(`/api/v1/...`)가 모두 이 포트에 있다. 수집 대상은 9090이 아니라 API의 `/metrics`다.

```text
API(PC, 4000) ←── 5초마다 GET /metrics ── Prometheus(컨테이너, 9090) ←── 브라우저·curl이 결과를 본다
                  host.docker.internal:4000                              localhost:9090
```

Prometheus가 가져간 값을 저장하고, 그 값으로 규칙을 평가하고, 결과를 9090에서 보여 준다. 대상 주소(`http://host.docker.internal:4000/metrics`)는 `prometheus.yml`의 `targets`에 적은 것이다.

요약의 단어는 두 API 응답의 칸 값이다.

| 응답 | 칸 | 값 | 뜻 |
|---|---|---|---|
| `/api/v1/targets` | `health` | `up` / `down` / `unknown` | 마지막 수집이 성공했나. 아직 한 번도 안 가져갔으면 `unknown` |
| `/api/v1/rules` | `state` | `inactive` / `pending` / `firing` | 경보의 상태(0장 개념 3). 조건이 거짓이면 `inactive` |
| `/api/v1/rules` | `health` | `ok` / `err` / `unknown` | 규칙의 `expr`을 평가하는 데 성공했나 |

`ok`는 "괜찮다"가 아니라 "평가가 됐다"다. `inactive ok`는 "규칙은 제대로 돌았고, 조건은 거짓이다"이고, `firing ok`도 정상적인 조합이다. `err`이면 그 규칙의 `lastError` 칸에 이유가 있다.

브라우저로 http://localhost:3001/d/order-api 를 열면 대시보드가 이미 있다.

### 개념 | 누가 누구를 어떤 이름으로 부르나

이 단계에는 주소가 네 가지 나온다. 부르는 쪽이 어디에 있느냐에 따라 같은 대상도 이름이 다르다.

| 부르는 쪽 | 받는 쪽 | 이름 | 이유 |
|---|---|---|---|
| Prometheus 컨테이너 | PC에서 띄운 API | `host.docker.internal:4000` | 컨테이너 안의 `localhost`는 그 컨테이너 자신이다 |
| Prometheus 컨테이너 | Alertmanager 컨테이너 | `alertmanager:9093` | 같은 compose 네트워크 안에서는 서비스 이름이 호스트 이름이다 |
| Grafana 컨테이너 | Prometheus 컨테이너 | `prometheus:9090` | 위와 같다 |
| Alertmanager 컨테이너 | PC에서 띄운 수신기 | `host.docker.internal:5001` | 첫 줄과 같다 |
| PC의 브라우저·`curl` | 각 컨테이너 | `localhost:9090`, `localhost:3001` | compose의 `ports`가 PC 포트를 컨테이너 포트에 이어 준다 |

- `host.docker.internal`은 Docker Desktop(macOS·Windows)에는 원래 있지만 리눅스에는 없다. compose의 `extra_hosts: "host.docker.internal:host-gateway"`가 리눅스에서도 그 이름을 PC로 이어 준다.

- Grafana의 `"3001:3000"`은 "PC의 3001을 컨테이너의 3000으로"다. 컨테이너끼리 부를 때는 `ports`와 상관없이 컨테이너 안 포트(Prometheus는 9090)를 쓴다.

- 대상이 `down`이고 사유가 `connection refused`면, 먼저 API가 PC에서 4000으로 떠 있는지, 그다음 이 표의 이름이 맞는지 본다.

### 용어 | Prometheus 설정

- `scrape_interval`: 대상의 `/metrics`를 가져오는(scrape) 간격이다.

- `evaluation_interval`: 경보 규칙을 평가하는 간격이다.

- `rule_files`: 경보 규칙 파일의 경로 목록이다.

- `alerting.alertmanagers`: 규칙이 울리면(firing) 경보를 보낼 Alertmanager 주소다.

- `scrape_configs`: 수집 대상 목록이다. `job_name`은 지표에 `job` 라벨로 붙고, `static_configs.targets`에 주소를 적는다.

- `host.docker.internal`: 컨테이너 안에서 PC를 가리키는 이름이다.

### 용어 | Prometheus 경보 규칙

- `alert`: 경보 이름이다.

- `expr`: PromQL 조건이다. 결과가 하나라도 나오면 참이다.

- `for`: `expr`이 이만큼 계속 참이어야 pending에서 firing이 된다.

- `labels`: 경보에 붙일 라벨이다. 여기서는 `severity`로 심각도를 나눈다.

- `annotations`: 알림에 실을 문장이다. `{{ $labels.instance }}`로 라벨 값을, `{{ $value }}`로 `expr`의 값을 넣는다. `| humanizePercentage`는 0.98을 98%처럼 바꾼다.

### 용어 | PromQL

- `up{job="order-api"}`: 중괄호 안의 라벨 조건에 맞는 시계열만 고른다.

- `status_code=~"5.."`: `=~`는 정규식으로 라벨 값을 고른다. `5..`는 500번대 전부다.

- `sum(...)`: 여러 시계열을 하나로 더한다. 더하면서 라벨이 어떻게 되는지는 아래 "`sum`은 라벨을 지운다"에서 다룬다.

- `sum by (route) (...)`: `route` 라벨 값별로 따로 더한다.

- `le`: 히스토그램 버킷의 상한("이 값 이하")을 담은 라벨이다. `histogram_quantile`에는 `le`를 남긴 채 더해서 넘긴다.

### 개념 | `sum`은 라벨을 지운다

#### `sum`과 `sum by`

`rate(http_request_duration_seconds_count[30s])`의 결과는 한 줄이 아니라 라벨 조합마다 한 줄씩이다.

`sum`은 이것을 한 줄로 더하면서 라벨을 전부 버리고, `sum by (route)`는 `route`만 남기고 나머지를 버린다.

```text
# rate(http_request_duration_seconds_count[30s]) (값은 예시, Prometheus가 붙인 job 라벨은 생략)
{instance="host.docker.internal:4000", route="/products", status_code="200"} 4
{instance="host.docker.internal:4000", route="/orders/:id", status_code="200"} 3
{instance="host.docker.internal:4000", route="/orders/:id", status_code="500"} 1

# sum(...): 라벨 없는 한 줄
{} 8

# sum by (route) (...): route만 남는다
{route="/products"} 4
{route="/orders/:id"} 4
```

#### 나눗셈은 라벨이 같은 줄끼리 짝짓는다

이게 중요한 곳이 나눗셈이다. PromQL의 `/`는 양쪽에서 라벨이 똑같은 줄끼리 짝지어 나누고, 짝이 없는 줄은 버린다.

```text
# 잘못: 5xx 줄이 오른쪽의 자기 자신과 짝지어진다 → 값이 늘 1(100%), 200 줄은 짝이 없어 사라진다
rate(http_request_duration_seconds_count{status_code=~"5.."}[30s])
  / rate(http_request_duration_seconds_count[30s])

# 맞음: 양쪽을 라벨 없는 한 줄로 만든 뒤 나눈다(HighErrorRate)
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[30s]))
  / sum(rate(http_request_duration_seconds_count[30s]))
```

- `sum`이 `instance`까지 지우므로 HighErrorRate 경보에는 `instance` 라벨이 없다. `sum`을 쓰지 않은 ApiDown에는 남아 있다(7장 작업 1 테스트의 `exp_labels`가 다른 이유다).

- `histogram_quantile`에 `sum by (le)`로 넘기는 것도 같은 이유다. `le`까지 지우면 칸의 구분이 사라져 분위수를 계산할 수 없다.

- 순서는 `rate`가 먼저, `sum`이 나중이다. 9장 "여러 인스턴스"에서 다시 본다.

> `sum by (route)`는 SQL의 `SELECT route, SUM(...) ... GROUP BY route`와 같다. `by`에 적지 않은 라벨은 결과에 남지 않는다.

### 용어 | Alertmanager 설정

- `route.receiver`: 경보를 보낼 기본 수신자 이름이다.

- `group_by`: 이 라벨이 같은 경보를 한 알림으로 묶는다.

- `group_wait`: 새 묶음의 첫 알림을 보내기 전에 기다리는 시간이다. 아래 "보내기 전의 세 가지 기다림"에서 다룬다.

- `group_interval`: 이미 보낸 묶음에 변화가 생겼을 때 다음 알림까지의 간격이다. 아래 "보내기 전의 세 가지 기다림"에서 다룬다.

- `repeat_interval`: 변화가 없어도 이 간격마다 다시 알린다(잊지 않게). 아래 "보내기 전의 세 가지 기다림"에서 다룬다.

- `webhook_configs`: 경보를 JSON으로 POST할 주소다. `send_resolved: true`면 해결됐을 때도 알린다.

### 개념 | 보내기 전의 세 가지 기다림

Alertmanager는 경보를 받는 즉시 보내지 않는다. `group_by`로 묶은 묶음마다 시계를 따로 두고, 아래 세 값에 따라 보낼 때를 정한다.

이 문서는 `group_by: ["alertname"]`이라 ApiDown과 HighErrorRate는 서로 다른 묶음이다.

| 설정 | 이 문서 값 | 언제 쓰이나 |
|---|---|---|
| `group_wait` | 5s | 새 묶음이 생겼을 때, 첫 알림을 보내기 전 |
| `group_interval` | 30s | 보낸 묶음에 경보가 더해지거나 해제됐을 때, 다음 알림까지 |
| `repeat_interval` | 1h | 아무 변화 없이 계속 firing일 때, 같은 알림을 다시 보내기까지 |

HighErrorRate 하나가 울렸다가 풀리면 이렇게 흐른다.

```text
0초   firing 도착 → 새 묶음, group_wait 5초 대기
5초   첫 알림 발송(🔥 firing)
20초  해제 도착 → 묶음에 변화. 바로 보내지 않는다
35초  첫 발송 뒤 group_interval 30초가 되는 차례에 발송(✅ resolved)
```

- `group_wait`는 같이 터지는 경보(예: 인스턴스 여러 대의 같은 경보)를 한 알림에 담으려고 있다. 그만큼 알림이 늦어지며, 3단계에서 잰 71초에도 이 5초가 들어 있다.

- 해제 알림이 회복 직후가 아니라 다음 `group_interval` 차례에 오는 것도 이 때문이다.

- `repeat_interval`이 짧으면 같은 알림이 쏟아지고, 길면 해결 안 된 경보가 잊힌다.

> 세 값은 Prometheus의 `for`와 달리 "울릴지"를 정하지 않는다. 이미 울린 경보를 "언제 보낼지"만 정한다.

### 남길 것

- **찾아보면 되는 것**: `prometheus.yml`·경보 규칙·`alertmanager.yml`의 칸 이름, Grafana 프로비저닝 폴더 경로와 대시보드 JSON의 패널 구조, PromQL 함수 이름, `/api/v1/targets`·`/api/v1/rules` 응답의 칸(`health`, `state`)과 값. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - PromQL의 `/`는 라벨이 똑같은 줄끼리 짝지어 나눈다. 비율은 양쪽을 `sum`으로 라벨 없는 한 줄로 만든 뒤 나눈다.

  - 컨테이너 안의 `localhost`는 그 컨테이너 자신이다. PC는 `host.docker.internal`, 다른 컨테이너는 compose 서비스 이름으로 부른다.

- **에러 신호**:

  - 수집 대상이 `down`, 사유에 `connection refused` → API가 4000으로 떠 있는지, 컨테이너에서 `host.docker.internal`로 PC를 찾는지(리눅스면 `extra_hosts`)

  - 오류 비율 패널이나 경보 값이 늘 100%이고 200 줄이 사라진다 → `sum` 없이 나눴는지

  - `/api/v1/rules`에 규칙이 없다 → `rule_files`의 컨테이너 안 경로와 compose의 `alert-rules.yml` 마운트가 맞는지

  - 경보는 firing인데 수신기 콘솔이 조용하다 → `alertmanager.yml`의 `url`(5001), 수신기가 떠 있는지, http://localhost:9093 에 경보가 들어왔는지

  - http://localhost:3001/d/order-api 에 대시보드가 없거나 패널이 비어 있다 → `monitoring/grafana/dashboards/`에 JSON 파일이 있는지(없어도 compose는 빈 폴더로 뜬다), 대시보드 JSON의 `uid`, 패널의 데이터 소스 `uid`가 `prometheus`인지

## 4. 3단계: DB 장애

### 실험 | 일부러 깨뜨려보기 ②: 지표를 만들다가 지표를 잃는다

트래픽을 흘리는 채로 DB를 멈춘다. `outbox_unpublished_events`의 `collect`는 아직 1단계 작업 2의 한 줄 그대로다.

이 실험은 `collect`가 그 한 줄일 때만 재현된다. 아래 작업 1의 `try`/`catch`를 먼저 넣었다면 DB를 멈춰도 `/metrics`는 200이고, `outbox_unpublished_events Nan` 한 줄만 바뀐다. 이미 고친 결과를 본 것이다.

그때 실험을 보려면 `collect` 본문만 잠깐 한 줄로 되돌린다. `start:dev`가 다시 띄운 뒤 DB를 멈춘다.

```ts
// src/metrics/metrics.module.ts
// 실험하는 동안만. try/catch 블록 전체를 이 한 줄로 바꾼다
        this.set(await prisma.outboxEvent.count({ where: { publishedAt: null } }));
```

실험이 끝나면 작업 1의 코드로 되돌린다. `git stash`로 고친 파일을 잠깐 치워 둘 수도 있지만, 함께 고친 다른 파일까지 치워지므로 이 한 곳만 손으로 바꾸는 편이 낫다.

```sh
docker compose stop db
curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/metrics
500
```

`traffic.mjs` 터미널에는 `14:58:01 {"500":49}`처럼 모든 요청이 500으로 찍힌다.

http://localhost:9090/targets 에는 수집 대상이 `down`으로, 사유가 `server returned HTTP status 500 Internal Server Error`로 보인다.

1분 반을 기다린 결과는 이렇다.

```text
14:58:31 🔥 [firing] ApiDown (critical) - order-api가 응답하지 않는다: host.docker.internal:4000의 /metrics를 30초 넘게 가져오지 못했다
규칙: ApiDown firing / HighErrorRate inactive
```

**두 가지가 다 틀렸다.** API는 살아 있는데 "API가 응답하지 않는다"가 울렸다. 모든 요청이 500인데 오류 비율 경보는 조용하다.

원인은 `outbox_unpublished_events`다. 이 지표는 Prometheus가 가져갈 때 DB에 묻는다.

DB가 없으니 예외가 났고, prom-client는 지표 하나라도 실패하면 `/metrics` 전체를 실패시킨다.

Prometheus는 5xx를 센 지표까지 하나도 못 가져갔다. 오류가 가장 많은 순간에 오류 지표가 사라진 것이다.

### 작업 1. [커밋] 고치기: 실패를 그 지표에 가두기

`collect`의 한 줄을 시간 제한과 `try`/`catch`로 감싼다.

```ts
// src/metrics/metrics.module.ts
// collect의 본문을 이렇게 바꾼다
      async collect() {
        try {
          // DB가 느리면 /metrics 전체가 늦어진다 → 1초만 기다린다
          const count = prisma.outboxEvent.count({ where: { publishedAt: null } });
          const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("시간 초과")), 1000).unref());
          this.set(await Promise.race([count, timeout]));
        } catch {
          // 예외를 던지면 /metrics 전체가 500이 된다 → 이 지표만 "모름"(NaN)으로 둔다
          this.set(Number.NaN);
        }
      },
```

- `Promise.race`는 먼저 끝나는 쪽의 결과를 따른다. 1초 안에 `count`가 안 끝나면 `timeout`이 먼저 거부되어 `catch`로 간다.

- `.unref()`는 이 타이머 하나 때문에 Node 프로세스가 끝나지 못하고 기다리는 일이 없게 한다. `count`가 먼저 끝나도 타이머는 1초 동안 남아 있기 때문이다.

DB를 멈춘 채로 고쳐서 저장하면 `start:dev`가 다시 띄운다.

```text
/metrics → 200
outbox_unpublished_events Nan
15:00:31 ✅ [resolved] ApiDown (critical) - ...
```

다시 가져갈 수 있게 되자 ApiDown이 해제됐다.

### 개념 | 0이 아니라 NaN을 넣는 이유

0을 넣지 않고 NaN을 넣는다. 0은 "미발송이 없다"는 거짓 정보다.

NaN은 "모른다"이고, `> 20` 같은 비교에서 항상 거짓이라 엉뚱한 경보도 만들지 않는다. Grafana에서는 그 구간의 선이 끊겨 보인다.

prom-client는 NaN을 `Nan`으로 적는다(위 출력). Prometheus는 대소문자를 가리지 않고 읽는다. 7장의 e2e 테스트가 `/^outbox_unpublished_events nan$/im`처럼 `i` 플래그로 비교하는 이유다.

### 작업 2. [확인] 최종 규칙으로 처음부터 다시 재현

DB를 다시 켜고(`docker compose start db`) 정상으로 돌아온 것을 확인한 뒤, 같은 장애를 처음부터 다시 일으킨다.

```sh
date +"DB 정지 %T"; docker compose stop db
# 1분 반쯤 기다린다
date +"DB 시작 %T"; docker compose start db
```

아래 출력은 한 터미널에 찍힌 것이 아니다. `DB 정지`·`DB 시작` 줄은 위 명령을 친 터미널에, 🔥·✅ 줄은 작업 7에서 띄운 경보 수신기(`node scripts/alert-receiver.mjs`) 터미널에 찍힌다. 두 터미널의 줄을 시각 순으로 합쳐 적었다.

경보가 울리기 전 상태는 http://localhost:9090/alerts 에서 HighErrorRate가 inactive → pending → firing으로 바뀌는 것으로 본다. 경보 수신기에는 firing이 된 뒤 Alertmanager가 보낸 것만 온다.

```text
DB 정지 15:11:55
15:13:06 🔥 [firing] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 98.02%
DB 시작 15:13:36
15:14:06 ✅ [resolved] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 7.51%
```

멈춘 지 71초 뒤에 울렸다. 오류 비율이 기준을 넘고(수집 5초 + 30초 창이 채워지는 시간), `for: 1m`을 채우고, Alertmanager의 `group_wait` 5초를 거친 시간이다.

> 해제 알림에 찍힌 값(7.51%)은 지금 값이 아니다. 경보가 마지막으로 평가됐을 때(회복하는 중)의 값이다. 해제 알림의 숫자로 현재 상태를 판단하지 않는다.

### 개념 | 지표 엔드포인트는 밖의 장애에 휩쓸리지 않아야 한다

같은 원리가 `07`의 헬스 체크에도 있다.

`/health`(살아 있나)는 DB를 보지 않고, `/health/ready`(일할 수 있나)만 DB(와 Redis·저장소)를 본다.

지표 엔드포인트는 `/health`처럼 밖의 장애에 휩쓸리지 않아야 한다. 밖의 자원에 묻는 지표는 실패해도 그 지표만 비어야 한다.

### 남길 것

- **찾아보면 되는 것**: `Promise.race`로 시간 제한 걸기, `setTimeout(...).unref()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 지표 하나의 실패가 `/metrics` 전체를 실패시키면, 오류가 가장 많은 순간에 오류 지표가 사라지고 경보가 뒤바뀐다. 실패는 그 지표에 가두고, 0 같은 거짓 값 대신 NaN(모름)을 넣는다.

  - 장애에서 경보까지 걸리는 시간은 수집 간격 + 창 + `for` + `group_wait`의 합이다(여기서는 71초).

- **에러 신호**:

  - 수집 대상이 `down`, 사유에 `server returned HTTP status 500 Internal Server Error` → `/metrics`를 만드는 중 예외. `collect`가 DB 같은 밖의 자원에 기대는지

  - API는 살아 있는데 ApiDown이 울리고, 모든 요청이 500인데 HighErrorRate는 조용하다 → `/metrics` 자체가 실패하고 있는지(`curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/metrics`)

  - 실험 ②에서 DB를 멈췄는데 `/metrics`가 200이고 `outbox_unpublished_events Nan` → 작업 1의 `try`/`catch`가 이미 들어가 있다. 고친 결과이고, 실험을 보려면 `collect`를 잠깐 한 줄로 되돌린다

  - 해제 알림의 비율이 아직 높다(`7.51%`) → 그 값은 마지막 평가 때 값이다. 현재 값은 Prometheus에서 직접 본다

## 5. 4단계: `for` 없는 경보 (일부러 깨뜨려보기 ③)

DB를 10초만 멈췄다 켠다. 짧은 튐이다(배포 중 재시작, 순간적인 네트워크 끊김 같은 것).

### 작업 1. [커밋] `for: 1m`인 채로 10초 튐 일으키기

`traffic.mjs`와 수신기를 켜 둔 채로 DB를 10초만 멈춘다. 규칙의 상태는 http://localhost:9090/alerts 에서 본다.

그런데 pending은 울리지 않은 상태라 경보 수신기에는 아무것도 오지 않는다. `/alerts` 화면에서 지켜볼 수는 있지만, 화면은 지금 상태만 보여 주므로 "언제 pending이 됐다가 언제 돌아왔나"가 남지 않는다.

그래서 상태가 바뀔 때마다 시각과 함께 한 줄 찍는 스크립트를 하나 더 둔다. 1초마다 Prometheus의 `/api/v1/rules`(2단계 작업 7)에 묻고, `state` 칸이 바뀌면 찍는다.

```js
// scripts/alert-state.mjs
const PROM = process.env.PROM ?? "http://localhost:9090";
const only = process.argv[2]; // 없으면 모든 경보
const last = {};

setInterval(async () => {
  const body = await fetch(`${PROM}/api/v1/rules?type=alert`).then((r) => r.json(), () => null);
  if (!body) return; // Prometheus가 안 떠 있으면 다음 번에 다시 묻는다
  for (const group of body.data.groups) {
    for (const rule of group.rules) {
      if (only && rule.name !== only) continue;
      // 처음 본 상태는 기억만 하고, 바뀐 때만 찍는다
      if (last[rule.name] !== undefined && last[rule.name] !== rule.state) {
        console.log(`${new Date().toTimeString().slice(0, 8)} ${rule.name}: ${rule.state}`);
      }
      last[rule.name] = rule.state;
    }
  }
}, 1000);

console.log(`경보 상태 감시: ${PROM}/alerts`);
```

새 파일 하나가 남으므로 커밋한다. 터미널을 하나 더 열어 띄우고, 다른 터미널에서 튐을 일으킨다.

```sh
node scripts/alert-state.mjs HighErrorRate # 터미널 하나. 경보 이름을 빼면 모든 경보를 본다
date +"== for 1m, DB 10초 정지 %T"; docker compose stop db; sleep 10; docker compose start db
```

```text
== for 1m, DB 10초 정지 15:07:26
15:07:56 HighErrorRate: pending
15:08:17 HighErrorRate: inactive
(받은 경보 없음)
```

이 출력도 한 터미널의 것이 아니다. `==` 줄은 튐을 일으킨 터미널에, `HighErrorRate:` 줄은 `alert-state.mjs` 터미널에 찍힌다. `(받은 경보 없음)`은 경보 수신기 터미널이 조용했다는 뜻으로 덧붙인 것이다.

조건이 잠깐 참이 되어 pending까지 갔지만, 1분을 채우지 못하고 inactive로 돌아왔다. 수신기에는 아무것도 오지 않는다.

pending이 되기까지 걸리는 시간은 그때그때 다르다. 수집 5초와 평가 5초 간격 중 어디에 걸리느냐에 따라 멈춘 지 10~30초 뒤다.

### 실험 | `for`를 지우고 같은 튐 일으키기

`HighErrorRate`의 `for: 1m` 한 줄을 지운다.

```yaml
# monitoring/alert-rules.yml
# HighErrorRate의 for 한 줄만 지운다
        expr: |
          sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[30s]))
            / sum(rate(http_request_duration_seconds_count[30s])) > 0.05
        labels:
          severity: warning
```

규칙 파일은 마운트돼 있을 뿐이라 Prometheus가 저절로 다시 읽지 않는다. `docker compose restart prometheus`로 다시 읽게 한 뒤 같은 튐을 일으킨다. `date`의 앞머리만 `== for 없음`으로 바꾼다.

아래 🔥·✅ 줄은 경보 수신기 터미널에 찍힌다. `alert-state.mjs` 터미널에는 pending 없이 바로 `firing`이 찍힌다. `for`가 없으면 조건이 참이 되는 평가에서 곧장 울리기 때문이다.

```text
== for 없음, DB 10초 정지 15:09:46
15:09:56 🔥 [firing] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 10.32%
15:10:26 ✅ [resolved] HighErrorRate (warning) - 5xx 응답 비율이 높다: 최근 30초 5xx 비율 11.86%
```

이미 저절로 회복된 일로 알림이 두 번 왔다. 이런 알림이 하루에 몇 번씩 오면 사람들은 경보를 무시하게 된다.

그러면 진짜 장애도 놓친다. 되돌린다(`for: 1m`, 다시 `docker compose restart prometheus`).

### 개념 | `for`는 창보다 길어야 한다

**`for`는 비율을 재는 창(`[30s]`)보다 길어야 한다.** 짧은 튐도 창 안에는 창의 길이만큼 머물기 때문이다.

10초 튐이라도 그 오류들은 30초 동안 `rate(...[30s])`의 창 안에 남는다. 그동안 비율은 기준을 넘긴 채로 보인다.

창을 `[1m]`으로 두면 10초 튐이 1분 가까이 기준을 넘긴 채로 남아 `for: 1m`과 겨우 맞물린다. 그래서 이 문서는 창을 30초로 두었다.

### 남길 것

- **찾아보면 되는 것**: 규칙 상태(inactive / pending / firing)를 보는 화면 http://localhost:9090/alerts, `alert-state.mjs`가 묻는 `/api/v1/rules?type=alert`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 저절로 회복된 일로 오는 알림은 사람들이 경보를 무시하게 만든다. `for`는 비율을 재는 창보다 길게 둬서 짧은 튐을 거른다.

  - Prometheus는 마지막으로 읽은 규칙을 들고 평가한다. 규칙 파일을 고쳤으면 다시 띄우고, 지금 도는 규칙이 고친 것인지 `/api/v1/rules`로 확인한다.

- **에러 신호**:

  - firing이 오고 30초쯤 뒤 resolved가 오는 일이 반복된다 → `for`가 없거나 창보다 짧은지

  - 규칙 파일을 고쳤는데 동작이 그대로다 → Prometheus를 다시 띄워(`docker compose restart prometheus`) 규칙을 다시 읽었는지

  - `promtool check config`가 `open /etc/prometheus/alert-rules.yml: no such file or directory` → 편집기가 파일을 바꿔치기해 컨테이너가 지워진 옛 파일을 붙들고 있다. `docker compose restart prometheus`

## 6. 5단계: API 다운

이번에는 진짜로 API 프로세스를 끈다.

### 작업 1. [확인] API 프로세스를 끄고 다시 켜기

`npm run start:dev` 터미널에서 Ctrl+C로 API를 끈다. 30초 넘게 기다렸다가 다시 `npm run start:dev`로 켠다.

```text
15:04:02 API 프로세스 종료        traffic.mjs: {"연결 실패":50}
15:04:41 🔥 [firing] ApiDown (critical) - order-api가 응답하지 않는다: host.docker.internal:4000의 /metrics를 30초 넘게 가져오지 못했다
(다시 실행)
15:05:11 ✅ [resolved] ApiDown (critical) - ...
```

이번에는 http://localhost:9090/targets 의 사유가 3단계의 `HTTP status 500`이 아니라 `connection refused`다.

### 개념 | 죽었다는 신호는 `up`이 낸다

`up`은 Prometheus가 수집할 때마다 스스로 만드는 지표다(성공 1, 실패 0). 앱이 죽어서 자기 지표를 못 내보내도 이 값은 남는다.

> 그래서 "죽었다"는 경보는 앱의 지표가 아니라 `up`으로 건다.

### 남길 것

- **찾아보면 되는 것**: `up{job="order-api"}`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 앱이 죽으면 앱의 지표도 함께 사라진다. "죽었다"는 경보는 Prometheus가 스스로 만드는 `up`으로 건다.

- **에러 신호**:

  - `traffic.mjs`에 `{"연결 실패":50}`, 수집 대상 사유가 `connection refused` → API 프로세스가 죽었다(3단계의 `HTTP status 500`과 구분한다)

## 7. 6단계: 테스트

### 작업 1. [커밋] 경보 규칙 단위 테스트

경보 규칙도 코드다. `promtool test rules`로 Mock 시계열을 넣고 "이 시점에 이 경보가 울리는가"를 확인한다.

4단계를 몇 분씩 기다리며 손으로 할 필요가 없다.

```yaml
# monitoring/alert-rules.test.yml
# 실행: docker run --rm -v "$PWD/monitoring:/m" --entrypoint promtool prom/prometheus:latest test rules /m/alert-rules.test.yml
rule_files:
  - alert-rules.yml
evaluation_interval: 5s

tests:
  # ApiDown: 수집 실패(up=0)가 30초 넘게 이어져야 울린다
  - interval: 5s
    input_series:
      - series: 'up{job="order-api", instance="api:4000"}'
        values: "1 1 0x12" # 10초부터 0
    alert_rule_test:
      - eval_time: 30s # 0이 된 지 20초. 아직(pending)
        alertname: ApiDown
        exp_alerts: []
      - eval_time: 45s # 35초. 울린다
        alertname: ApiDown
        exp_alerts:
          - exp_labels: { severity: critical, job: order-api, instance: "api:4000" }
            exp_annotations:
              summary: "order-api가 응답하지 않는다"
              description: "api:4000의 /metrics를 30초 넘게 가져오지 못했다"

  # HighErrorRate: 10초짜리 튐은 거르고(for 1m), 계속되는 오류는 울린다
  - interval: 5s
    input_series:
      # 정상 요청: 5초마다 50건(초당 10건)
      - series: 'http_request_duration_seconds_count{route="/products", status_code="200"}'
        values: "0+50x40"
      # 5xx: 20초~30초 사이에만 5초마다 50건 늘고 그 뒤로는 그대로(10초짜리 튐)
      - series: 'http_request_duration_seconds_count{route="/products", status_code="500"}'
        values: "0x4 50 100 100x34"
    alert_rule_test:
      - eval_time: 40s
        alertname: HighErrorRate
        exp_alerts: []
      - eval_time: 100s
        alertname: HighErrorRate
        exp_alerts: []

  - interval: 5s
    input_series:
      - series: 'http_request_duration_seconds_count{route="/products", status_code="200"}'
        values: "0+50x40"
      # 5xx: 처음부터 계속 5초마다 50건(절반이 오류)
      - series: 'http_request_duration_seconds_count{route="/products", status_code="500"}'
        values: "0+50x40"
    alert_rule_test:
      - eval_time: 50s # 조건은 참이지만 1분이 안 됐다
        alertname: HighErrorRate
        exp_alerts: []
      - eval_time: 100s
        alertname: HighErrorRate
        exp_alerts:
          - exp_labels: { severity: warning }
            exp_annotations:
              summary: "5xx 응답 비율이 높다"
              description: "최근 30초 5xx 비율 50%"
```

규칙 테스트와 함께, 띄워 둔 Prometheus·Alertmanager의 설정 파일도 문법 검사한다.

```sh
docker run --rm -v "$PWD/monitoring:/m" --entrypoint promtool prom/prometheus:latest test rules /m/alert-rules.test.yml
  SUCCESS
docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml
Checking /etc/prometheus/prometheus.yml
  SUCCESS: 1 rule files found
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config file syntax

Checking /etc/prometheus/alert-rules.yml
  SUCCESS: 3 rules found

docker compose exec -T alertmanager amtool check-config /etc/alertmanager/alertmanager.yml
Checking '/etc/alertmanager/alertmanager.yml'  SUCCESS
Found:
 - global config
 - route
 - 0 inhibit rules
 - 1 receivers
 - 0 templates
```

`promtool check config`는 `prometheus.yml`을 본 뒤, 거기 적힌 `rule_files`도 따라가 검사한다. 첫 번째 `docker run`은 PC의 `monitoring/` 폴더를 새 컨테이너에 붙여 그 자리에서 읽는다. 아래 두 명령은 떠 있는 컨테이너 안의 파일을 읽는다. 그래서 같은 `alert-rules.yml`인데 아래쪽만 실패할 수 있다.

```text
Checking /etc/prometheus/alert-rules.yml
  FAILED:
/etc/prometheus/alert-rules.yml: open /etc/prometheus/alert-rules.yml: no such file or directory
```

compose는 `alert-rules.yml` 파일 하나를 컨테이너에 붙였다(마운트). 붙이는 것은 경로가 아니라 컨테이너가 뜰 때의 그 파일이다. 편집기는 저장할 때 새 파일을 써서 원래 파일과 바꿔치기하는 경우가 많다. 4단계 실험처럼 `for`를 지웠다가 되돌리고 다시 띄우지 않으면 이렇게 된다. 그러면 컨테이너는 지워진 옛 파일을 붙든 채로 남는다.

- 컨테이너 안에서 `ls -la /etc/prometheus/`로 보면 파일은 보이는데, 링크 수 칸이 `0`이다. 지워진 파일이라는 뜻이다. `cat`으로 열면 `No such file or directory`다.

- 이 상태에서도 Prometheus는 마지막으로 읽어 둔 규칙을 메모리에 들고 계속 평가한다. `/api/v1/rules`와 `/alerts` 화면은 멀쩡해 보이지만, 그 규칙은 지금 PC의 파일이 아니다.

`docker compose restart prometheus`로 다시 띄우면 그때의 파일을 다시 붙이므로 고쳐진다. 4단계에서 규칙 파일을 고친 뒤 다시 띄우라고 한 것도 같은 이유다.

### 용어 | promtool 테스트 문법

- `tests[].interval`: `input_series`의 값 사이 간격이다.

- `input_series`: 넣을 시계열이다. `series`에 지표 이름과 라벨을, `values`에 간격마다의 값을 적는다.

- `values: "0+50x40"`: 0에서 시작해 50씩 40번 늘어난다. 아래 "`values` 표기 펼쳐 읽기"에서 다룬다.

- `values: "100x34"`: 100을 35번(첫 값 + 34번 반복) 이어 쓴다. 아래 "`values` 표기 펼쳐 읽기"에서 다룬다.

- `alert_rule_test`: `eval_time` 시점에 `alertname` 경보가 `exp_alerts`처럼 울리는지 본다. 빈 목록(`[]`)이면 울리지 않아야 한다.

- `exp_labels` / `exp_annotations`: 울린 경보가 가져야 할 라벨과 문장이다.

### 개념 | `values` 표기 펼쳐 읽기

`values`에 적은 값은 0초부터 `interval`(5초)마다 한 칸씩 놓인다.

`a+bxn`은 a에서 시작해 b씩 n번 늘린 n+1개, `axn`은 a를 n+1개 쓴다는 뜻이고, 공백으로 이어 붙인다.

| 적은 것 | 펼친 값 | 시각 |
|---|---|---|
| `"1 1 0x12"`(ApiDown) | 1, 1, 0을 13개 | 0·5초는 1, 10~70초는 0 |
| `"0+50x40"`(정상 요청) | 0, 50, 100, ..., 2000 | 0~200초 |
| `"0x4 50 100 100x34"`(10초짜리 튐) | 0을 5개, 50, 100, 100을 35개 | 0~20초는 0, 25초 50, 30초부터 100 |

- 시각은 "칸 번호 × `interval`"이다. `eval_time`과 맞춰 읽는다. ApiDown 테스트의 `eval_time: 45s`는 0이 된(10초) 지 35초 뒤다.

- 카운터에는 늘 누적값을 적는다. "5초마다 50건"은 `0+50x40`이다. `50x40`으로 적으면 값이 그대로라 `rate`가 0이 된다.

- 튐 시계열이 30초부터 100에 멈춰 있으니, `rate(...[30s])`로 보면 5xx는 20~30초에만 늘고 그 뒤로는 0이다.

> C로 치면 `for (i = 0; i <= n; i++) v[k++] = a + b * i;`로 배열을 채운 것이다.

### 실험 | `for`를 지우면 규칙 테스트가 잡는다

4단계처럼 `HighErrorRate`의 `for: 1m`을 지우고 같은 `promtool` 명령을 돌린다.

```text
  FAILED:
    alertname: HighErrorRate, time: 40s,
        exp:[],
        got:[
              Labels:{alertname="HighErrorRate", severity="warning"}
```

10초짜리 튐 테스트의 40초 시점에 울리지 않아야 할 경보가 울렸다. 확인했으면 `for: 1m`을 되돌린다.

### 작업 2. [커밋] `/metrics` 회귀 테스트

실제 앱을 띄워 `/metrics`를 가져오는 e2e 테스트를 쓴다.

```ts
// test/metrics.e2e-spec.ts
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("/metrics - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // 0: 빈 포트를 아무거나 쓴다
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const metrics = async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    return { status: res.status, text: await res.text() };
  };

  it("요청 지표의 경로 라벨은 실제 URL이 아니라 경로 패턴이다", async () => {
    for (const id of [1, 2, 3]) await fetch(`${baseUrl}/orders/${id}`);
    await fetch(`${baseUrl}/no-such-path/123`);
    const { text } = await metrics();
    expect(text).toContain('route="/orders/:id"');
    expect(text).not.toMatch(/route="\/orders\/\d+"/); // 번호마다 시계열이 생기면 안 된다
    expect(text).toContain('route="unmatched"'); // 없는 경로도 한 값으로
    expect(text).not.toContain("no-such-path");
  });

  it("DB에 묻는 지표가 실패해도 /metrics는 200이고, 그 지표만 NaN이다", async () => {
    const prisma = app.get(PrismaService);
    const spy = vi.spyOn(prisma.outboxEvent, "count").mockRejectedValueOnce(new Error("DB에 연결할 수 없다"));
    const { status, text } = await metrics();
    expect(status).toBe(200);
    expect(text).toMatch(/^outbox_unpublished_events nan$/im);
    expect(text).toMatch(/^http_request_duration_seconds_count/m); // 다른 지표는 그대로 있다
    spy.mockRestore();
  });
});
```

`vi.spyOn(...).mockRejectedValueOnce`는 다음 한 번의 호출만 실패하게 바꾼다. DB를 정말 멈추지 않고 3단계 상황을 만든다.

`describe`·`it`·`expect`·`vi`를 import하지 않아도 되는 것은 `vitest.config.e2e.ts`의 `globals: true` 덕분이다. 테스트는 `test/setup-env.ts`가 `DATABASE_URL`을 테스트 DB로 바꾼 뒤 돈다.

```sh
npm run test:e2e
 Test Files  9 passed (9)
      Tests  30 passed (30)
```

### 실험 | `try`/`catch`를 빼면 회귀 테스트가 잡는다

3단계 작업 1 이전의 한 줄 `collect`로 되돌리고 `npm run test:e2e`를 돌린다.

```text
× DB에 묻는 지표가 실패해도 /metrics는 200이고, 그 지표만 NaN이다
AssertionError: expected 500 to be 200
```

확인했으면 `try`/`catch`를 되돌린다.

### 남길 것

- **찾아보면 되는 것**: `promtool test rules`의 칸 이름과 `values` 표기, 설정 검사 명령(`promtool check config`, `amtool check-config`), `vi.spyOn(...).mockRejectedValueOnce`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 경보 규칙도 코드다. 시계열을 꾸며 넣고 "이 시각에 울리는가/안 울리는가"를 단정하면, 몇 분씩 기다리던 4단계를 몇 초에 되풀이할 수 있다. 카운터에는 늘 누적값을 적는다.

  - 장애 상황은 DB를 정말 멈추지 않고, 그 의존성 한 번의 호출을 실패시켜 만든다.

- **에러 신호**:

  - `FAILED: alertname: HighErrorRate, time: 40s, exp:[], got:[...]` → `for`가 지워졌거나 창보다 짧은지

  - 울려야 할 시각에 테스트가 `got:[]` → 카운터 시계열을 누적값이 아니라 `50x40`처럼 적었는지

  - `AssertionError: expected 500 to be 200` → `collect`의 `try`/`catch`가 빠졌는지

  - `promtool check config`가 `open /etc/prometheus/alert-rules.yml: no such file or directory` → 규칙 파일을 고친 뒤 Prometheus를 다시 띄우지 않았는지(4단계와 같은 원인). `docker compose restart prometheus`

  - `TEST_DATABASE_URL이 없다 - 개발 DB를 지우지 않도록 테스트를 멈춘다` → `.env`에 테스트 DB 주소가 있는지

## 8. 디버깅

### 진단 1. 어디를 보나

| 곳 | 보는 것 |
|---|---|
| `curl localhost:4000/metrics` | 앱이 내보내는 지금 값. 지표가 아예 없으면 앱 쪽 문제 |
| http://localhost:9090/targets | 수집 대상의 상태(`up`/`down`)와 마지막 오류 |
| http://localhost:9090/alerts | 규칙별 상태(inactive / pending / firing) |
| http://localhost:9090/graph | PromQL을 직접 실행해 본다 |
| http://localhost:9093 | Alertmanager가 받은 경보, 묶음, 일시 중지(silence) |
| 경보 수신기 콘솔 | 실제로 배달된 알림 |

앱 → Prometheus 수집 → 규칙 → Alertmanager → 수신기 순서로 위에서부터 본다. 앞 칸에서 값이 없으면 뒤 칸은 볼 필요가 없다.

### 진단 2. 자주 쓰는 PromQL

| 알고 싶은 것 | 질의 |
|---|---|
| 초당 요청 수 | `sum(rate(http_request_duration_seconds_count[1m]))` |
| 경로별 p95 | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))` |
| 상태 코드별 비율 | `sum by (status_code) (rate(http_request_duration_seconds_count[5m]))` |
| 시계열 개수(라벨 폭증 확인) | `count(http_request_duration_seconds_bucket)` |
| 웹훅 결과 | `sum by (result) (increase(stripe_webhook_events_total[1h]))` |

### 진단 3. 증상으로 원인 가르기

| 증상 | 원인 |
|---|---|
| 대상이 `down`, "connection refused" | API가 안 떠 있다. 또는 컨테이너에서 `host.docker.internal`로 PC를 못 찾는다(리눅스면 `extra_hosts`) |
| 대상이 `down`, "server returned HTTP status 500" | `/metrics`를 만드는 중 예외. 지표의 `collect`가 밖의 자원(DB 등)에 기대고 있지 않은가(3단계) |
| 장애인데 오류 비율 경보가 안 울린다 | 그 시각에 수집이 됐는지(`up`)부터 본다. 수집이 끊기면 비율도 계산되지 않는다 |
| 경보가 자꾸 울렸다 꺼진다 | `for`가 없거나 창보다 짧다(4단계) |
| 경보가 너무 늦게 온다 | 수집 간격 + 창 + `for` + `group_wait`를 더해 본다. 3단계에서는 71초였다 |
| 경보는 firing인데 알림이 안 온다 | Alertmanager의 `route`/`receiver`, 수신 주소. http://localhost:9093 에 경보가 들어왔는지 본다 |
| Prometheus 메모리가 계속 는다 | 라벨에 가짓수가 많은 값이 들어갔다(1단계). `count by (__name__) ({__name__=~".+"})`로 시계열이 많은 지표를 찾는다 |

### 진단 4. 에러 신호 한 표로 보기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `Error: Cannot find package '.../node_modules/emojilib/index.js'` (`ERR_MODULE_NOT_FOUND`) | 설치된 패키지 폴더에서 파일이 빠졌다 | 그 패키지 폴더를 `ls`, 비었으면 루트에서 `npm ci` | 1장(드러나는 곳은 1단계 작업 5) |
| 서버는 뜨는데 `GET /metrics`만 404 | `MetricsModule`이 `AppModule`의 `imports` 사슬에 없다 | `app.module.ts`의 `imports` | 1단계 |
| `route="/trpc/*path"` 줄만 없다(`/trpc/...` 요청이 지표에 안 보인다) | 요청 지표 미들웨어가 tRPC 미들웨어보다 뒤에 붙었다 | `imports`에서 `MetricsModule`이 `TrpcModule`보다 앞인지 | 1단계 |
| `route="{/*splat}"` 줄이 보인다 | 404 요청이 Nest의 마지막 처리 경로 패턴으로 잡혔다 | `routeOf`의 `unmatched` 처리 | 1단계 |
| `route="/metrics"` 줄이 5초마다 는다 | 수집 요청이 요청 지표에 섞여 5xx 비율의 분모를 부풀린다 | 미들웨어가 `req.originalUrl`로 비교하는지 | 1단계 |
| `TypeError: this.set is not a function` / `Property 'set' does not exist on type 'MetricsModule'.` | `collect`의 `this`가 Gauge가 아니다 | `collect`를 화살표 함수로 썼는지 | 1단계 |
| Grafana 범례가 `/orders/100`, `/orders/101`...로 가득 | 라벨 값의 가짓수가 폭증했다 | 라벨에 실제 URL·id가 들어갔는지 | 1단계 ① |
| 대상이 `down`, `connection refused` | 수집 대상에 닿지 못했다 | API가 떠 있는지, `host.docker.internal`·`extra_hosts` | 2단계, 5단계 |
| 비율이 늘 100%이고 200 줄이 사라진다 | 라벨이 다른 줄끼리 짝이 안 지어졌다 | 양쪽을 `sum`한 뒤 나눴는지 | 2단계 |
| `/api/v1/rules`에 규칙이 없다 | 규칙 파일을 못 읽었다 | `rule_files` 경로와 compose 마운트 | 2단계 |
| 경보는 firing인데 수신기 콘솔이 조용하다 | 배달 경로가 끊겼다 | `alertmanager.yml`의 `url`, 수신기, http://localhost:9093 | 2단계 |
| 대시보드가 없거나 패널이 비어 있다 | 프로비저닝 파일이나 데이터 소스 `uid`가 어긋났다 | `dashboards/` 폴더에 JSON이 있는지, 대시보드 JSON의 `uid`, 패널의 데이터 소스 `uid` | 2단계 |
| 대상이 `down`, `server returned HTTP status 500 Internal Server Error` | `/metrics`를 만드는 중 예외 | `collect`가 밖의 자원에 기대는지 | 3단계 ② |
| API는 살아 있는데 ApiDown, 모든 요청이 500인데 HighErrorRate는 조용 | `/metrics` 전체가 실패해 5xx 지표까지 잃었다 | `curl ... localhost:4000/metrics`의 상태 코드 | 3단계 ② |
| DB를 멈췄는데 `/metrics`가 200, `outbox_unpublished_events Nan` | `try`/`catch`가 이미 실패를 가두고 있다(정상) | 실험 ②를 보려면 `collect`를 잠깐 한 줄로 | 3단계 ② |
| 해제 알림의 비율이 아직 높다(`7.51%`) | 마지막 평가 때의 값이다 | 현재 값은 Prometheus에서 직접 | 3단계 |
| firing 뒤 30초쯤에 resolved가 반복된다 | 짧은 튐을 거르지 못한다 | `for`가 있는지, 창보다 긴지 | 4단계 ③ |
| 규칙 파일을 고쳤는데 동작이 그대로다 | Prometheus가 옛 규칙을 들고 있다 | `docker compose restart prometheus` | 4단계 |
| `open /etc/prometheus/alert-rules.yml: no such file or directory` | 컨테이너가 바꿔치기 전의 지워진 파일을 붙들고 있다 | `docker compose restart prometheus` | 4단계, 6단계 |
| `traffic.mjs`에 `{"연결 실패":50}` | API 프로세스가 죽었다 | API 터미널, `up` | 5단계 |
| `FAILED: alertname: HighErrorRate, time: 40s, exp:[], got:[...]` | 울리지 않아야 할 시각에 울렸다 | `for`가 지워졌는지 | 6단계 |
| 울려야 할 시각에 `got:[]` | 꾸민 카운터의 `rate`가 0이다 | `values`를 누적값(`0+50x40`)으로 적었는지 | 6단계 |
| `AssertionError: expected 500 to be 200` | `collect`의 예외가 `/metrics` 전체를 실패시켰다 | `try`/`catch` | 6단계 |
| `TEST_DATABASE_URL이 없다 - 개발 DB를 지우지 않도록 테스트를 멈춘다` | 테스트 DB 주소가 없다 | `.env` | 6단계 |

## 9. 운영에서 생각할 것

### 개념 | `/metrics`를 밖에 열지 않는다.

경로 목록, 처리량, 메모리가 그대로 보인다. 내부망에서만 닿게 하거나, 별도 포트로 내보내고 그 포트는 공개하지 않는다.

### 개념 | 수집 간격과 창

이 문서는 학습용으로 5초를 썼다. 보통 15초~1분이다.

> 간격이 길어지면 `rate`의 창도 그만큼 넓혀야 한다(창 안에 최소 2~4개의 값이 있어야 한다).

### 개념 | 경보는 증상에 건다.

"CPU 80%"처럼 원인에 걸면 사용자에게 문제가 없는데도 울린다.

"오류 비율", "응답 시간", "결제 처리 지연"처럼 사용자가 겪는 것에 건다.

### 개념 | 여러 인스턴스

`04`처럼 API를 여러 개 띄우면 각각을 수집 대상으로 둔다.

> 카운터는 인스턴스별로 쌓이므로 `sum(rate(...))`처럼 rate를 먼저, 합은 나중에 한다.

### 시험해보기

```sh
cd order-api-nest
npm run start:dev
docker compose --profile monitoring up -d prometheus alertmanager grafana
node scripts/alert-receiver.mjs & node scripts/traffic.mjs 10 &
docker compose stop db; sleep 90; docker compose start db # HighErrorRate firing → resolved
docker run --rm -v "$PWD/monitoring:/m" --entrypoint promtool prom/prometheus:latest test rules /m/alert-rules.test.yml
npm run test:e2e # 30 passed
```

### 도전 과제

#### 1. 응답 시간 경보 만들기

"p95가 0.5초를 넘는 상태가 2분"인 경보를 만들고, `promtool` 테스트도 쓴다.

히스토그램 버킷 경계(0.5)와 기준값을 맞춰야 하는 이유는 무엇인가?

**답**

```yaml
# monitoring/alert-rules.yml
# rules 끝에 더한다
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m]))) > 0.5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "응답 시간 p95가 길다"
          description: "최근 1분 p95 {{ $value | humanizeDuration }}"
```

```yaml
# monitoring/alert-rules.test.yml
# tests 끝에 더한다
  # 5초마다 100건. 0.25초 이하 80건, 0.5초 이하 85건, 1초 이하 100건
  - interval: 5s
    input_series:
      - series: 'http_request_duration_seconds_bucket{le="0.25"}'
        values: "0+80x40"
      - series: 'http_request_duration_seconds_bucket{le="0.5"}'
        values: "0+85x40"
      - series: 'http_request_duration_seconds_bucket{le="1"}'
        values: "0+100x40"
      - series: 'http_request_duration_seconds_bucket{le="+Inf"}'
        values: "0+100x40"
    alert_rule_test:
      - eval_time: 90s # 조건은 참이지만 2분이 안 됐다
        alertname: HighLatency
        exp_alerts: []
      - eval_time: 150s
        alertname: HighLatency
        exp_alerts:
          - exp_labels: { severity: warning }
            exp_annotations:
              summary: "응답 시간 p95가 길다"
              description: "최근 1분 p95 833.3ms"
```

1. `promtool test rules`가 `SUCCESS`다. 0.5초 이하가 97%인 입력을 넣으면 150초에도 울리지 않는다.

2. 기대값의 833.3ms는 실제 응답 시간이 아니다. 95번째 요청이 0.5~1초 구간에 있다는 것만 알므로, `histogram_quantile`은 구간 안을 직선으로 나눠 0.5 + 0.5 × (95 − 85) / (100 − 85)로 짐작한다.

3. 기준값이 버킷 경계와 같으면 이 짐작이 판단에 끼지 않는다. "p95 > 0.5"는 "0.5초 이하 버킷에 든 요청이 95%보다 적다"와 같은 말이고, 그 개수는 정확히 세어져 있다.

4. 경계가 어긋나면 틀린다. 모든 요청이 실제로는 0.26초(전부 0.25~0.5 구간)인 입력에서 같은 식의 값은 0.4875다(0.25 + 0.25 × 0.95). 기준을 0.4로 두면 0.4초를 넘은 요청이 하나도 없는데 울린다.

> 기준값을 바꾸고 싶으면 `buckets`에 그 값을 경계로 넣는다.

#### 2. `OutboxBacklog` 울려 보기

outbox relay를 멈추는 방법을 찾아 `OutboxBacklog`를 실제로 울려 본다.

> `04`의 리더 선출, `02`의 relay 주기를 떠올린다.

relay를 어떻게 멈췄고, 경보는 언제 울리고 풀리는가?

**답**

relay 주기를 환경변수로 받게 하고, 아주 길게 줘서 멈춘다.

```ts
// src/outbox/outbox.relay.ts
// onApplicationBootstrap의 setInterval 주기를 환경변수로 받는다
  onApplicationBootstrap() {
    // OUTBOX_RELAY_INTERVAL_MS=600000이면 10분 동안 relay가 한 번도 돌지 않는다
    const interval = Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 500);
    this.timer = setInterval(() => void this.tick(), interval);
  }
```

1. `OUTBOX_RELAY_INTERVAL_MS=600000`으로 API를 띄우고 `POST /orders`로 주문 25건을 만든다. `outbox_unpublished_events`가 25가 되고 줄지 않는다.

2. 규칙은 곧 pending이 되고, 주문을 만든 지 70초 뒤 수신기에 `🔥 [firing] OutboxBacklog (warning) - outbox 알림이 쌓이고 있다: 발행되지 않은 이벤트 25건`이 찍힌다.

3. 환경변수 없이 다시 띄우면 relay가 한 회차에 20건씩 꺼내 3초 안에 0이 되고, 13초 뒤 resolved가 온다.

> Redis를 멈춰도 relay는 멈춘다(메일 큐에 넣지 못해 트랜잭션이 되돌려진다). 하지만 Redis를 멈춘 지 75초쯤 지나자 ioredis의 `MaxRetriesPerRequestError`로 API 프로세스까지 죽었다. 경보 하나만 보려면 relay만 멈추는 편이 낫다.

#### 3. 경보 나눠 보내기와 묶어 두기

Alertmanager에 `severity="critical"`만 다른 수신기로 보내는 `routes`를 추가한다.

ApiDown과 HighErrorRate가 동시에 울릴 때 HighErrorRate를 묶어 두는 `inhibit_rules`는 어떻게 쓰면 되는가?

> API가 죽었으면 오류 비율 경보는 의미가 없다.

**답**

```yaml
# monitoring/alertmanager.yml
# route 아래에 routes를, 파일에 inhibit_rules와 두 번째 수신기를 더한다
route:
  receiver: local-webhook
  # (group_by 등은 그대로)
  routes:
    - matchers: ['severity="critical"']
      receiver: critical-webhook

inhibit_rules:
  - source_matchers: ['alertname="ApiDown"']
    target_matchers: ['alertname="HighErrorRate"']

receivers:
  - name: local-webhook
    # (그대로)
  - name: critical-webhook
    webhook_configs:
      - url: http://host.docker.internal:5002/alerts # PORT=5002 node scripts/alert-receiver.mjs
        send_resolved: true
```

1. `amtool check-config`가 `1 inhibit rules`, `2 receivers`를 찾는다. `amtool config routes test severity=critical`은 `critical-webhook`, `severity=warning`은 `local-webhook`을 고른다.

2. API를 끄면 ApiDown이 5002번 수신기에만 찍히고 5001번에는 오지 않는다.

3. ApiDown이 울리는 동안 HighErrorRate를 Alertmanager에 넣으면 `amtool alert query -i`에 `suppressed`로 남고 어느 수신기에도 가지 않는다.

4. API를 다시 켜 ApiDown이 resolved되면, 아직 살아 있는 HighErrorRate가 그제야 5001번으로 배달된다.

> `equal`은 비워 둔다. HighErrorRate는 `sum`으로 더해 `instance` 라벨이 없어서, `equal: ["instance"]`를 쓰면 짝이 지어지지 않아 둘 다 `active`로 나간다.

## 10. 완성 확인

- [ ] `/metrics`에 경로 패턴별 요청 지표, Node 기본 지표, outbox 적체, 웹훅 결과가 나온다

- [ ] 실제 URL을 라벨에 넣으면 시계열이 폭증하는 것을 숫자로 확인했다

- [ ] Prometheus가 수집하고, 규칙 3개가 로드되고, Grafana 대시보드가 자동으로 등록된다

- [ ] DB 장애 때 `/metrics`까지 실패해 경보가 뒤바뀌는 것을 재현했고, 실패를 그 지표에 가둬 고쳤다

- [ ] DB 장애 → HighErrorRate firing → 회복 → resolved 알림을 받았다

- [ ] `for` 없는 경보가 10초 튐에 울리는 것을 보고, `for`로 걸렀다

- [ ] API를 끄면 ApiDown, 켜면 해제가 온다

- [ ] `promtool test rules`와 `npm run test:e2e`(30개)가 통과한다

## 11. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 로그·추적·지표는 각각 어떤 질문에 답하는가?

2. Prometheus가 "가져가는(pull)" 방식이라서 생기는 장점 하나는?(`up`)

3. 카운터의 값 자체보다 `rate`를 보는 이유는? 프로세스가 재시작하면 카운터는 어떻게 되는가?

4. 라벨에 주문 id를 넣으면 무슨 일이 생기는가? 넣어도 되는 라벨의 조건은?

5. DB 장애 때 ApiDown이 울리고 HighErrorRate가 조용했던 이유는? 어떻게 고쳤나?

6. 실패한 지표에 0이 아니라 NaN을 넣은 이유는?

7. `for`는 무엇을 거르는가? 비율을 재는 창보다 길어야 하는 이유는?

8. 장애가 시작되고 경보가 오기까지 걸리는 시간은 무엇들의 합인가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 장기 보관과 여러 Prometheus의 통합(Thanos, Mimir 등), 원격 저장

- 서비스 수준 목표(SLO)와 오류 예산, 여러 창을 함께 보는 소진 속도(burn rate) 경보

- OpenTelemetry로 지표까지 보내기(`07`의 추적과 같은 SDK), exemplar로 지표에서 추적으로 건너뛰기

- 로그 수집 도구(Loki 등)와 Grafana 한 화면에서 로그·지표·추적 함께 보기

- 실제 Slack·PagerDuty 연동, 당번(on-call) 운영
