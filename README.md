# 15: 모니터링과 경보

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20prom--client%20%7C%20Prometheus%20%7C%20Alertmanager%20%7C%20Grafana-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [14-stripe](https://github.com/seungwoo7050/node-order/tree/14-stripe) 브랜치

API가 `GET /metrics`로 Prometheus 형식의 지표를 내보내고, compose의 `monitoring` 프로필로 Prometheus·Alertmanager·Grafana를 띄워 수집·경보·대시보드를 붙입니다. 경보 규칙에는 `promtool` 단위 테스트가 있습니다. 프론트(`order-console-next`)는 바뀌지 않았습니다.

## 지원 범위

- `14-stripe`까지의 기능: JWT 로그인과 refresh 회전, GitHub 로그인, Stripe Checkout 결제와 웹훅, outbox와 BullMQ 메일, socket.io 알림, presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC, 서비스 워커 오프라인 화면
- `GET /metrics`(prom-client)
  - `http_request_duration_seconds`: 요청 처리 시간 히스토그램(`method`, `route`, `status_code`). `route`는 실제 URL이 아니라 경로 패턴(`/orders/:id`)이고, 어느 라우트에도 맞지 않으면 `unmatched`. `/metrics` 요청은 재지 않는다
  - Node 프로세스 기본 지표(이벤트 루프 지연, 메모리 등)
  - `outbox_unpublished_events`: 수집할 때마다 DB에서 세는 미발행 outbox 수. 1초 안에 답이 없거나 실패하면 이 지표만 NaN이고 `/metrics`는 200
  - `stripe_webhook_events_total`: 웹훅 처리 결과(`type`, `result`=`processed`·`duplicate`·`ignored`)
- 경보 규칙(`monitoring/alert-rules.yml`)
  - `ApiDown`(critical): `up{job="order-api"} == 0`이 30초 지속
  - `HighErrorRate`(warning): 최근 30초 5xx 비율이 5%를 넘는 상태가 1분 지속
  - `OutboxBacklog`(warning): 미발행 이벤트가 20건을 넘는 상태가 1분 지속
- compose `monitoring` 프로필
  - Prometheus(`9090`): PC에서 뜬 API(`host.docker.internal:4000`)를 5초마다 수집
  - Alertmanager(`9093`): 경보를 `http://host.docker.internal:5001/alerts`로 보내고 resolved도 보냄
  - Grafana(`3001`): Prometheus 데이터소스와 `order-api` 대시보드(초당 요청 수, 응답 시간 p95, 5xx 비율, outbox 미발송, 이벤트 루프 지연 p99, RSS)를 자동 등록. 익명 Viewer로 로그인 없이 볼 수 있음
- 실험 스크립트(`order-api-nest/scripts/`)
  - `alert-receiver.mjs`: Alertmanager 웹훅을 받아 firing/resolved를 찍는 수신 서버(`5001`)
  - `alert-state.mjs`: Prometheus 경보 규칙의 상태(inactive·pending·firing)가 바뀔 때마다 찍음. 인자로 규칙 이름을 주면 그 규칙만
  - `traffic.mjs`: 초당 N건(기본 10) 요청을 보내고 5초마다 상태 코드 분포를 찍음

## 구성

`14`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── docker-compose.yml                # monitoring 프로필: prometheus, alertmanager, grafana
│   ├── package.json                      # prom-client
│   ├── src/
│   │   ├── app.module.ts                 # MetricsModule
│   │   ├── metrics/
│   │   │   ├── metrics.ts                # registry, 요청 히스토그램, 웹훅 카운터, 측정 미들웨어
│   │   │   └── metrics.module.ts         # GET /metrics, outbox 게이지(1초 타임아웃)
│   │   └── payments/payments.service.ts  # 웹훅 처리 결과를 카운터에 기록
│   ├── monitoring/
│   │   ├── prometheus.yml                # 수집 대상, 규칙 파일, Alertmanager 주소
│   │   ├── alert-rules.yml               # ApiDown, HighErrorRate, OutboxBacklog
│   │   ├── alert-rules.test.yml          # promtool 규칙 단위 테스트
│   │   ├── alertmanager.yml              # 묶음 규칙과 로컬 웹훅 수신처
│   │   └── grafana/
│   │       ├── provisioning/             # 데이터소스·대시보드 자동 등록
│   │       └── dashboards/order-api.json
│   ├── scripts/
│   │   ├── alert-receiver.mjs
│   │   ├── alert-state.mjs
│   │   └── traffic.mjs
│   └── test/metrics.e2e-spec.ts          # 경로 라벨, outbox 지표 실패 시 NaN
└── package-lock.json
```

## 실행

API를 PC에서 `4000`으로 띄우는 방법은 `14`와 같고, 모니터링 도구만 컨테이너로 더 띄웁니다. 결제·GitHub 로그인을 쓰지 않으면 `.env.local` 없이 API가 뜹니다.

```sh
npm ci

cd order-api-nest
cp .env.example .env
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 모니터링 도구와 실험 스크립트를 띄웁니다(`order-api-nest`에서).

```sh
docker compose --profile monitoring up -d prometheus alertmanager grafana
node scripts/alert-receiver.mjs # :5001
node scripts/alert-state.mjs    # 규칙 상태 전이
node scripts/traffic.mjs 10     # 초당 10건
```

| 대상 | 주소 |
|---|---|
| 지표 | http://localhost:4000/metrics |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3001/d/order-api (`3000`은 Next) |

`traffic.mjs`를 켠 채 `docker compose stop db`로 DB를 멈추면 요청이 500으로 끝나 `HighErrorRate`가 pending을 거쳐 firing이 되고 수신 서버에 찍힙니다. `docker compose start db`로 되살리면 resolved가 옵니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
docker run --rm -v "$PWD/monitoring:/m" --entrypoint promtool prom/prometheus:latest test rules /m/alert-rules.test.yml
```

`test/metrics.e2e-spec.ts`는 요청 지표의 `route` 라벨이 경로 패턴인지, outbox 지표 조회가 실패해도 `/metrics`가 200이고 그 지표만 NaN인지 확인합니다.

`alert-rules.test.yml`은 시계열을 꾸며 넣고 `ApiDown`이 30초를 채우기 전에는 울리지 않고 그 뒤에 울리는지, `HighErrorRate`가 짧은 튐에는 울리지 않고 5xx가 이어지면 울리는지 검사합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile monitoring --profile app down    # 컨테이너만 내림
docker compose --profile monitoring --profile app down -v # DB·저장소 볼륨까지 삭제
```
