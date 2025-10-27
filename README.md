# 07: 운영 준비

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Docker%20%7C%20pino%20%7C%20OpenTelemetry-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [06-file-upload](https://github.com/seungwoo7050/node-order/tree/06-file-upload) 브랜치

지금까지 만든 주문 API(`order-api-nest`)를 운영용 컨테이너 이미지로 만들고, 헬스 체크·정상 종료·구조화 로그·분산 추적을 붙여 compose로 전체를 띄웁니다.

특정 클라우드에 올리는 일은 다루지 않고, 어느 플랫폼에 올리든 똑같이 필요한 것만 다룹니다.

## 지원 범위

- 다단계 `Dockerfile`

  - `runtime` 타깃: 빌드 결과와 운영 의존성만 담고, root가 아닌 `node` 사용자로 OpenTelemetry를 먼저 불러온 뒤 실행

  - `migrate` 타깃: `prisma migrate deploy`만 한 번 실행하고 끝남

  - `.dockerignore`로 `.env`·테스트·스크립트·실험 파일을 빌드 컨텍스트에서 제외

- compose `app` 프로필

  - DB 헬스 체크가 통과하면 마이그레이션, 마이그레이션이 성공하면 API 기동

  - API는 `init: true`로 띄워 node가 PID 1이 되지 않고 종료 신호를 init이 전달

  - API 헬스 체크는 `/health/ready`를 호출

- 헬스 체크

  - `GET /health`: 프로세스가 응답하면 200 (liveness)

  - `GET /health/ready`: DB·Redis·스토리지를 각각 1초 제한으로 동시에 확인해 모두 되면 200, 아니면 503과 항목별 결과 (readiness)

- 정상 종료

  - `enableShutdownHooks()`로 SIGTERM을 받으면 모듈 정리, HTTP 서버 종료 순서로 끝냄

  - 메일 워커, 워커 전용 Redis 연결, 리더 잠금을 정리하고 그 과정을 로그로 남김

- 구조화 로그 (nestjs-pino)

  - 요청마다 JSON 한 줄, Nest 로거도 pino로 교체

  - `X-Request-Id`를 받으면 그대로 쓰고 없으면 새로 만들어 응답 헤더로 돌려줌

  - `authorization`·`cookie`·`set-cookie` 헤더는 가림. `LOG_LEVEL`로 레벨 조절, 프로덕션이 아니면 pino-pretty로 출력

- 분산 추적 (OpenTelemetry)

  - http·express·pg·ioredis 등을 자동 계측해 OTLP HTTP로 Jaeger에 보냄 (fs 계측은 끔)

  - `scripts/trace-tree.mjs`로 최근 추적 하나를 span 트리와 SQL로 출력

- presigned URL 주소 분리

  - 서버가 직접 부르는 주소(`S3_ENDPOINT`, 컨테이너 안에서는 `http://storage:9000`)와 브라우저가 쓸 URL에 서명할 주소(`S3_PUBLIC_ENDPOINT`)를 나눔

- 그 밖의 API(로그인·토큰 회전, 주문·결제, socket.io 알림, BullMQ 메일 큐, 리더 선출, 이미지 업로드)와 `order-console-next`는 `06-file-upload` 그대로입니다.

## 구성

```text
.
├── order-api-nest/                 # NestJS API
│   ├── Dockerfile                  # deps → build → migrate / prod-deps → runtime
│   ├── .dockerignore               # .env, 테스트, 스크립트, 생성 코드 제외
│   ├── docker-compose.yml          # db·redis·storage(RustFS)·jaeger, app 프로필에 migrate·api
│   ├── prisma7.config.ts           # .env가 있을 때만 불러옴(컨테이너에는 없음)
│   ├── src/
│   │   ├── main.ts                 # pino 로거, 종료 훅, 미들웨어, 전역 설정, ws 어댑터 순서
│   │   ├── app.module.ts           # LoggerModule(요청 ID, 헤더 가림, pino-pretty)
│   │   ├── instrumentation.ts      # OpenTelemetry NodeSDK, node --import로 먼저 불러옴
│   │   ├── shutdown-logger.ts      # 종료 단계별 로그와 걸린 시간
│   │   ├── health/                 # GET /health, GET /health/ready
│   │   ├── storage/                # 내부용 S3 클라이언트와 presigned URL용 클라이언트, ping
│   │   └── queue/mail.queue.ts     # 워커 연결까지 닫는 BullMQ 메일 큐
│   └── scripts/trace-tree.mjs      # Jaeger API에서 추적 트리 출력
├── order-console-next/             # Next.js 주문 콘솔 (06-file-upload와 같음)
└── README.md
```

## 실행

컨테이너로 전체를 띄웁니다.

API `4000`, PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, Jaeger 화면 `16686`입니다.

```sh
cd order-api-nest
docker compose --profile app up -d --build
docker compose --profile app ps -a # migrate는 Exited (0), api는 healthy
curl localhost:4000/health/ready
```

마이그레이션 컨테이너는 시드를 넣지 않습니다. 데모 계정(`kim` / `1234`)과 상품이 필요하면 같은 DB에 로컬에서 시드를 넣습니다.

```sh
npm ci
npx prisma generate
npx prisma db seed
```

추적은 http://localhost:16686 에서 Service `order-api`를 골라 보거나, 결제를 한 번 한 뒤 터미널에서 트리로 봅니다.

```sh
node scripts/trace-tree.mjs                   # 기본은 "POST /orders/checkout"
node scripts/trace-tree.mjs "GET /products"
```

API를 컨테이너 대신 로컬에서 추적과 함께 띄울 수도 있습니다. 인프라만 compose로 띄우고, `.env`에 `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`을 넣습니다.

```sh
docker compose up -d
npx prisma migrate deploy
npm run build
npm run start:traced # OpenTelemetry를 먼저 불러온 뒤 dist/main.js 실행
```

정상 종료는 종료에 걸리는 시간과 API 로그로 확인합니다.

```sh
time docker compose stop api
docker compose logs api | tail
```

## 테스트

e2e 테스트는 `.env`의 `TEST_DATABASE_URL`이 가리키는 테스트 전용 DB를 씁니다. 인프라가 떠 있는 상태에서 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

## 정리

```sh
cd order-api-nest
docker compose --profile app down                # 컨테이너만 내림
docker compose --profile app down -v --rmi local # 볼륨과 빌드한 이미지까지 삭제
```
