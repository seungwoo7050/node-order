# 07: 운영 준비

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Docker%20%7C%20pino%20%7C%20OpenTelemetry-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [06-file-upload](https://github.com/seungwoo7050/node-order/tree/06-file-upload) 브랜치

주문 API(`order-api-nest`)를 다단계 Dockerfile로 이미지화하고, compose `app` 프로필로 마이그레이션과 API까지 컨테이너로 띄웁니다.

API에 liveness·readiness 헬스 체크, SIGTERM 정상 종료, nestjs-pino 구조화 로그, OpenTelemetry 분산 추적(Jaeger)을 붙였습니다. `order-console-next`는 바뀌지 않았습니다.

## 지원 범위

- 다단계 `Dockerfile`

  - `runtime` 타깃: 운영 의존성과 빌드 결과만 담고, `node` 사용자로 `node --import ./dist/instrumentation.js dist/main.js` 실행

  - `migrate` 타깃: `npx prisma migrate deploy`만 실행하고 끝남

  - `.dockerignore`로 `.env`, `test`, `scripts`, `src/generated` 등을 빌드 컨텍스트에서 제외

- compose `app` 프로필

  - `migrate`는 DB 헬스 체크가 통과한 뒤 실행되고, `api`는 `migrate`가 성공한 뒤 기동

  - `api`는 `init: true`로 실행되어 node가 PID 1이 아님

  - `api` 헬스 체크는 컨테이너 안에서 `/health/ready`를 호출

- 헬스 체크

  - `GET /health`: 항상 `{ "status": "ok" }` (liveness)

  - `GET /health/ready`: DB(`SELECT 1`)·Redis(`PING`)·스토리지(`HeadBucket`)를 각각 1초 제한으로 동시에 확인. 모두 되면 200, 하나라도 실패하면 503과 항목별 결과 (readiness)

- 정상 종료

  - `enableShutdownHooks()`로 SIGTERM을 받으면 모듈 정리 뒤 HTTP 서버를 닫음

  - 메일 워커와 워커 전용 Redis 연결, 리더 선출 연결을 닫고, 각 단계와 걸린 시간을 로그로 남김(`ShutdownLogger`)

- 구조화 로그 (nestjs-pino)

  - 요청마다 JSON 한 줄. Nest 기본 로거도 pino로 교체하고, 부팅 로그는 `bufferLogs`로 모았다가 pino로 출력

  - 요청에 `X-Request-Id`가 있으면 그 값을, 없으면 UUID를 요청 ID로 쓰고 응답 헤더로 돌려줌

  - `authorization`·`cookie` 요청 헤더와 `set-cookie` 응답 헤더는 가림. `LOG_LEVEL`(기본 `info`)로 레벨 조절, `NODE_ENV`가 `production`이 아니면 pino-pretty 한 줄 출력

- 분산 추적 (OpenTelemetry)

  - 자동 계측(fs 제외)한 span을 OTLP HTTP로 내보냄. 서비스 이름은 `OTEL_SERVICE_NAME`(기본 `order-api`)

  - `scripts/trace-tree.mjs`: Jaeger API에서 최근 1시간 안의 지정한 작업 추적 중 가장 최근 것을 span 트리와 SQL로 출력

- presigned URL 주소 분리

  - 서버가 직접 부르는 S3 클라이언트는 `S3_ENDPOINT`, presigned URL 서명용 클라이언트는 `S3_PUBLIC_ENDPOINT`(없으면 `S3_ENDPOINT`)를 씀. compose의 `api`는 `http://storage:9000`과 `http://localhost:9000`으로 나눔

- 그 밖의 API(로그인·토큰 회전, 주문·결제, socket.io 알림, BullMQ 메일 큐, 리더 선출, 이미지 업로드)와 `order-console-next`는 `06-file-upload`와 같습니다.

## 구성

`06`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── Dockerfile                  # deps → build → migrate / prod-deps → runtime
├── .dockerignore
├── docker-compose.yml          # jaeger 추가, app 프로필에 migrate·api
├── package.json                # start:traced, nestjs-pino·OpenTelemetry 의존성
├── prisma7.config.ts           # .env가 있을 때만 불러옴(이미지에는 .env가 없음)
├── scripts/trace-tree.mjs      # Jaeger API에서 추적 트리 출력
└── src/
    ├── main.ts                 # pino 로거, 종료 훅, 미들웨어 → 전역 설정 → ws 어댑터 → listen
    ├── app.module.ts           # LoggerModule(요청 ID, 헤더 가림, pino-pretty), HealthModule
    ├── instrumentation.ts      # OpenTelemetry NodeSDK. node --import로 앱보다 먼저 불러옴
    ├── shutdown-logger.ts      # 종료 단계 로그와 걸린 시간
    ├── health/                 # GET /health, GET /health/ready
    ├── storage/storage.service.ts  # 내부용·서명용 S3 클라이언트 분리, ping()
    ├── queue/mail.queue.ts     # 워커 연결도 종료 시 닫음
    └── leader/leader-election.ts   # 리더 연결 종료 로그
```

## 실행

Docker가 필요합니다. 포트는 API `4000`, PostgreSQL `5433`, Redis `6380`, RustFS `9000`(API)/`9001`(웹 콘솔), Jaeger `16686`(화면)/`4318`(OTLP HTTP)입니다.

전체를 컨테이너로 띄웁니다.

```sh
cd order-api-nest
docker compose --profile app up -d --build
docker compose --profile app ps -a # migrate는 Exited (0), api는 healthy
curl localhost:4000/health/ready
```

`migrate` 컨테이너는 시드를 넣지 않습니다. 데모 계정(`kim` / `1234`)과 상품은 로컬에서 같은 DB(`localhost:5433`)에 넣습니다. 시드 명령은 `tsx prisma/seed.ts`이고 `tsx`는 `package.json`에 없으므로 전역에 설치되어 있어야 합니다.

```sh
npm ci
npx prisma generate
npx prisma db seed
```

추적은 http://localhost:16686 에서 Service `order-api`를 골라 보거나, 해당 요청을 한 번 보낸 뒤 터미널에서 트리로 봅니다.

```sh
node scripts/trace-tree.mjs                   # 기본은 "POST /orders/checkout"
node scripts/trace-tree.mjs "GET /products"
```

API를 컨테이너 대신 로컬에서 추적과 함께 띄우려면 인프라만 compose로 띄웁니다. OTLP 내보내기 기본 주소가 `http://localhost:4318`이라 따로 설정하지 않아도 Jaeger로 갑니다.

```sh
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npm run build
npm run start:traced # --env-file=.env, instrumentation.js를 먼저 불러온 뒤 dist/main.js
```

정상 종료는 종료에 걸린 시간과 API 로그로 확인합니다.

```sh
time docker compose stop api
docker compose logs api | tail
```

프론트(`order-console-next`)를 띄우는 방법은 `06-file-upload`와 같습니다(`cp .env.example .env.local`, `npm run dev`, `3000`).

## 테스트

백엔드 e2e는 `.env`의 `TEST_DATABASE_URL`이 가리키는 테스트 전용 DB를 씁니다. 인프라가 떠 있는 상태에서 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # vitest 단위 테스트
npm run test:e2e # 결제 동시성, refresh token 회전 회귀 테스트
npm run lint     # oxlint
```

프론트 테스트는 `06-file-upload`와 같습니다(`order-console-next`에서 `npm run test:e2e`, `npm run lint`. e2e는 API가 `4000`에 떠 있어야 함).

## 정리

```sh
cd order-api-nest
docker compose --profile app down                # 컨테이너만 내림
docker compose --profile app down -v --rmi local # 볼륨과 빌드한 이미지까지 삭제
```
