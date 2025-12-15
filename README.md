# 15: 모니터링과 경보

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20prom--client%20%7C%20Prometheus%20%7C%20Alertmanager%20%7C%20Grafana-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [14-stripe](https://github.com/seungwoo7050/node-order/tree/14-stripe) 브랜치의 `order-api-nest`, `order-console-next`

API가 `/metrics`로 지표를 내보내고, Prometheus·Alertmanager·Grafana로 모아서 봅니다. DB 장애나 API 다운처럼 숫자가 이상해지면 사람이 들여다보기 전에 경보가 오게 합니다.

## 지원 범위

- 지표 엔드포인트 `GET /metrics` (prom-client)

  - 요청 응답 시간 히스토그램 `http_request_duration_seconds`. 경로 라벨은 실제 URL이 아니라 경로 패턴(`/orders/:id`)이고, 매칭되지 않은 경로는 `unmatched`로 묶어 라벨 개수가 늘어나지 않음

  - Node 프로세스 기본 지표(이벤트 루프 지연, 메모리 등)

  - outbox 적체 `outbox_unpublished_events`. 스크레이프할 때마다 DB에서 세고, 1초 안에 답이 없거나 실패하면 그 지표만 NaN이고 `/metrics`는 200

  - Stripe 웹훅 처리 결과 `stripe_webhook_events_total` (이벤트 타입, `processed`/`duplicate`/`ignored`별)

- 경보 규칙 `monitoring/alert-rules.yml`

  - `ApiDown`: `/metrics`를 30초 넘게 가져오지 못함 (critical)

  - `HighErrorRate`: 5xx 비율이 5%를 넘는 상태가 1분 지속 (warning). 짧은 튐에는 울리지 않음

  - `OutboxBacklog`: 발행되지 않은 이벤트가 20건을 넘는 상태가 1분 지속 (warning)

  - `promtool`로 돌리는 규칙 단위 테스트 `monitoring/alert-rules.test.yml`

- compose `monitoring` 프로필: Prometheus, Alertmanager, Grafana

  - Prometheus는 PC에서 뜬 API(`host.docker.internal:4000`)를 5초마다 수집

  - Alertmanager는 경보를 로컬 웹훅(`5001`)으로 보내고, resolved도 보냄

  - Grafana는 데이터소스와 `order-api` 대시보드(초당 요청 수, p95, 5xx 비율, outbox 미발송, 이벤트 루프 지연, RSS)가 자동 등록되고, 로그인 없이 볼 수 있음

- 실험 스크립트

  - `scripts/alert-receiver.mjs`: Alertmanager의 경보를 받아 firing/resolved를 콘솔에 찍는 수신 서버

  - `scripts/alert-state.mjs`: Prometheus의 경보 규칙 상태가 inactive → pending → firing으로 바뀔 때마다 찍음. Alertmanager로는 보이지 않는 pending 단계를 볼 때 씀

  - `scripts/traffic.mjs`: 초당 N건 요청을 꾸준히 보내고 5초마다 상태 코드 분포를 찍음

- `14-stripe`까지의 기능은 그대로입니다. 프론트(`order-console-next`)는 바뀐 것이 없습니다.

## 구성

```text
.
├── package.json                      # 워크스페이스 루트(order-api-nest, order-console-next)
├── order-api-nest/                   # NestJS API
│   ├── src/
│   │   ├── metrics/
│   │   │   ├── metrics.ts            # registry, 요청 히스토그램, 웹훅 카운터, 요청 측정 미들웨어
│   │   │   └── metrics.module.ts     # GET /metrics, outbox 게이지(1초 타임아웃)
│   │   └── payments/payments.service.ts  # 웹훅 처리 결과를 카운터에 기록
│   ├── monitoring/
│   │   ├── prometheus.yml            # 수집 대상, 경보 규칙, Alertmanager 주소
│   │   ├── alert-rules.yml           # ApiDown, HighErrorRate, OutboxBacklog
│   │   ├── alert-rules.test.yml      # promtool 규칙 단위 테스트
│   │   ├── alertmanager.yml          # 묶음 규칙과 로컬 웹훅 수신처
│   │   └── grafana/
│   │       ├── provisioning/         # 데이터소스와 대시보드 자동 등록 설정
│   │       └── dashboards/order-api.json
│   ├── scripts/
│   │   ├── alert-receiver.mjs        # 경보 수신 서버(5001)
│   │   ├── alert-state.mjs           # 경보 규칙 상태 전이 감시
│   │   └── traffic.mjs               # 꾸준한 요청 발생
│   ├── test/metrics.e2e-spec.ts      # 경로 라벨, DB 지표 실패 시 NaN 회귀 테스트
│   └── docker-compose.yml            # db, redis, storage, jaeger + monitoring 프로필
├── order-console-next/               # Next.js 프론트(14-stripe와 같음)
└── README.md
```

## 실행

의존성은 루트에서 한 번 설치합니다. API는 지금까지처럼 PC에서 `4000`으로 띄우고, 모니터링 도구만 컨테이너로 띄웁니다.

결제·GitHub 로그인을 쓰지 않으면 `.env.local`(비밀 값) 없이도 API가 뜹니다.

```sh
npm ci
cd order-api-nest
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 모니터링 도구와 실험 스크립트를 띄웁니다.

```sh
cd order-api-nest
docker compose --profile monitoring up -d prometheus alertmanager grafana
node scripts/alert-receiver.mjs # 5001에서 Alertmanager의 경보를 받아 찍음
node scripts/alert-state.mjs    # 경보 규칙 상태 전이를 찍음(규칙 이름을 인자로 주면 그것만)
node scripts/traffic.mjs 10     # 초당 10건 요청, 5초마다 상태 코드 분포
```

| 도구 | 주소 |
|---|---|
| 지표 원본 | http://localhost:4000/metrics |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Grafana | http://localhost:3001/d/order-api (3000은 Next) |

`docker compose stop db`로 DB를 멈추면 1분 남짓 뒤 `HighErrorRate` 경보가 수신 서버에 찍히고, `docker compose start db`로 다시 시작하면 resolved가 옵니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다(`order-api-nest`에서).

```sh
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

e2e는 `/metrics`의 경로 라벨이 실제 URL이 아니라 경로 패턴인지, outbox 지표 조회가 실패해도 `/metrics`가 200이고 그 지표만 NaN인지 확인합니다.

`promtool`은 시계열을 꾸며 넣고, `ApiDown`이 30초를 채운 뒤에야 울리는지, `HighErrorRate`가 짧은 튐에는 울리지 않고 5xx가 이어지면 울리는지 검사합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile monitoring --profile app down    # 컨테이너만 내림
docker compose --profile monitoring --profile app down -v # DB·저장소 볼륨까지 삭제
```
