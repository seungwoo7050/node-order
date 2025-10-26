# 운영 준비: 컨테이너 이미지, 헬스 체크, 정상 종료, 로그와 추적

## 목표

이 프로젝트는 [`06-file-upload`](https://github.com/seungwoo7050/node-order/tree/06-file-upload)로부터 시작한다.

계획한 기능은 이미 만들었다.

이 문서는 그 코드를 **어디서든 같은 모습으로 띄우고, 상태를 묻고, 깨끗하게 끄고, 무슨 일이 있었는지 나중에 알아낼 수 있게** 만든다.

특정 클라우드에 올리는 일은 다루지 않고, 어느 플랫폼에 올리든 똑같이 필요한 것만 다룬다.

1. 운영용 Docker 이미지: 3.58GB에 `.env`까지 들어 있던 이미지를 933MB, 비밀 없음, root 아님으로 만든다

2. 컨테이너로 전체 띄우기: 마이그레이션 → 앱 순서, 컨테이너 안팎의 주소 차이

3. 헬스 체크: "살아 있는가"와 "일할 준비가 됐는가"를 나눈다

4. 정상 종료: `docker stop`이 10초를 기다렸다가 강제로 죽이던 것을 0.28초로 줄인다

5. 구조화 로그: 요청마다 ID가 붙은 JSON 한 줄, 토큰은 가린다

6. 분산 추적: 결제 한 건이 어디서 시간을 썼는지 SQL 한 줄 단위로 본다

```sh
# 마이그레이션 → 앱 순서로 전체를 컨테이너로 띄운다
docker compose --profile app up -d --build
docker compose --profile app ps -a
```

```sh
order-api-nest-api-1      Up (healthy)
order-api-nest-migrate-1  Exited (0)
...
```

```sh
# 의존 서비스 셋에 모두 닿는지 묻고, 끄는 데 걸리는 시간을 잰다
curl localhost:4000/health/ready
time docker compose stop api
```

```sh
{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}
real 0.28
```

> 시작 기준점:  
> `order-api-nest`가 PostgreSQL, Redis, RustFS(`docker compose up -d`)에 붙어 있고, 리더 선출, BullMQ 메일 큐, presigned URL 이미지 업로드가 있다.  
> 프론트는 이 문서에서 바꾸지 않는다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 7단계에서 "어디서 틀어졌나"를 가르는 절차 | 친다(`docker`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 7단계만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 7단계 "진단 5"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 확인 명령뿐이고 9·10장은 체크리스트라서 `남길 것`을 두지 않았다.

- 1단계의 깨뜨려보기 ①은 원복하지 않는다. 그때 만든 `Dockerfile.naive`는 비교용으로 남겨 둔다.

| 단계 | 하는 일 |
|---|---|
| [0. 운영에 대한 사전지식](#0-운영에-대한-사전지식) | 이미지, PID 1, liveness/readiness, 로그와 추적을 C의 정적 링크·시그널·프로파일러에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | `06`의 `order-api-nest`와 인프라를 띄운다 |
| [2. 1단계: 운영용 이미지 만들기](#2-1단계-운영용-이미지-만들기) | 단순한 이미지의 문제를 보고 `.dockerignore`와 다단계 빌드로 고친다 |
| [3. 2단계: 컨테이너로 전체 띄우기](#3-2단계-컨테이너로-전체-띄우기) | compose에 `migrate`·`api`를 더하고, 서명용 저장소 주소를 따로 둔다 |
| [4. 3단계: 헬스 체크](#4-3단계-헬스-체크) | `/health`(liveness)와 `/health/ready`(readiness)를 만들고 Docker가 묻게 한다 |
| [5. 4단계: 깨끗하게 끄기](#5-4단계-깨끗하게-끄기) | 종료 훅을 켜고, 10초 걸리던 종료의 두 원인(PID 1, 열린 연결)을 고친다 |
| [6. 5단계: 구조화 로그](#6-5단계-구조화-로그) | pino로 요청 ID가 붙은 JSON 로그를 남기고 토큰을 가린다 |
| [7. 6단계: 분산 추적](#7-6단계-분산-추적) | OpenTelemetry와 Jaeger로 결제 한 건의 SQL까지 추적한다 |
| [8. 7단계: 디버깅](#8-7단계-디버깅) | 안 뜨는 컨테이너, 이미지 내용, 주소 문제, 안 보이는 추적을 가른다 |
| [9. 완성 확인](#9-완성-확인) | 체크리스트 |
| [10. 다음 단계](#10-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 운영에 대한 사전지식

### 개념 1 | 이미지는 "실행 파일 + 필요한 모든 것"을 한 덩어리로 고정한다.

C 프로그램을 다른 서버에서 돌리면 "거기엔 그 버전의 libc가 없다", "그 공유 라이브러리가 없다"로 실패하곤 한다.

그래서 필요한 라이브러리를 정적으로 링크해 실행 파일 하나로 만들기도 한다.

컨테이너 이미지는 그 생각을 끝까지 밀어붙인 것이다. Node 실행기, `node_modules`, 빌드된 코드, 운영체제의 필요한 부분까지 한 덩어리로 묶어서, 어디서 띄우든 같은 파일들로 실행되게 한다.

그래서 **이미지에 무엇이 들어가는지**가 중요해진다.

필요 없는 것이 들어가면 커지고(배포가 느려진다), 비밀이 들어가면 이미지를 받은 누구나 그 비밀을 갖게 된다.

### 개념 2 | 컨테이너 안의 PID 1은 특별하다.

C로 시그널을 다뤄 봤다면 안다. `SIGTERM`의 기본 동작은 "프로세스 종료"이고, `signal()`/`sigaction()`으로 핸들러를 달면 그 대신 핸들러가 불린다.

그런데 리눅스에서 PID 1(init)은 예외다. **커널은 PID 1에게 핸들러가 없는 시그널을 그냥 버린다.** init이 실수로 죽으면 시스템 전체가 멈추기 때문이다.

컨테이너 안에서는 `CMD`로 띄운 프로세스가 PID 1이 된다.

우리 앱(`node`)이 PID 1이면, `docker stop`이 보낸 `SIGTERM`이 기본 동작으로 처리되지 않는다. 4단계에서 이게 실제로 어떤 결과를 내는지 잰다.

### 개념 3 | "살아 있다"와 "일할 준비가 됐다"는 다르다.

프로세스가 떠 있고 HTTP에 응답한다고 해서 일을 할 수 있는 건 아니다. DB 연결이 끊겼을 수도 있다.

운영 도구(Docker, 로드밸런서, 오케스트레이터)는 이 둘을 따로 묻는다.

- liveness(살아 있는가): 아니라면 프로세스가 고장 난 것이다 → 재시작한다

- readiness(준비됐는가): 아니라면 지금은 요청을 보내지 말아야 한다 → 트래픽을 빼고, 회복되면 다시 넣는다

> DB가 잠깐 끊긴 걸 liveness로 판단하면, 멀쩡한 프로세스를 계속 재시작하는 사고가 난다.

### 개념 4 | 로그는 사건, 추적은 한 요청의 이야기

`printf` 디버깅이 "여기를 지나갔다"를 남긴다면, 프로파일러는 "어느 함수에서 얼마나 걸렸는가"를 호출 관계 그대로 보여 준다. 운영에서도 둘 다 필요하다.

- 로그: 사건 하나하나. 나중에 검색할 수 있게 기계가 읽는 형식(JSON)으로, 같은 요청의 로그를 모을 수 있게 요청 ID를 붙여 남긴다

- 추적(trace): 요청 하나가 HTTP → 미들웨어 → 핸들러 → SQL로 내려가며 각 단계에서 쓴 시간을 나무 구조로 기록한 것. 서비스가 여러 개면 그 경계를 넘어서도 이어진다(그래서 "분산" 추적)

## 1. 준비

`06`의 `order-api-nest`에서 이어 간다. 5~6단계에서 쓸 패키지는 그때 설치한다.

### 작업 1. 인프라 띄우기

```sh
cd order-api-nest
docker compose up -d
```

이 문서의 출력에 나오는 컨테이너 이름(`order-api-nest-api-1` 같은 것)의 앞부분은 compose 프로젝트 이름이다. 프로젝트 이름은 compose 파일이 있는 폴더 이름이다(`order-api-nest/docker-compose.yml`이면 `order-api-nest`). 폴더 이름이 다르면 출력의 `order-api-nest` 자리에 그 이름이 보인다.

## 2. 1단계: 운영용 이미지 만들기

### 실험 | 일부러 깨뜨려보기 ①: 가장 단순한 이미지

먼저 생각나는 대로 만든다.

```dockerfile
# Dockerfile.naive
# 깨뜨려보기용: 가장 단순하게 만든 이미지
FROM node:24
WORKDIR /app
COPY . .
RUN npm ci
RUN npx prisma generate && npm run build
CMD ["npm", "run", "start:prod"]
```

```sh
docker build -f Dockerfile.naive -t order-api:naive .
docker image ls order-api:naive
order-api:naive   3.58GB
docker run --rm --entrypoint sh order-api:naive -c 'ls -a /app; cat /app/.env | head -3'
. .. .env .gitignore ... node_modules ... scripts src test ...
JWT_SECRET=change-me
DEMO_PASSWORD=1234
FRONTEND_URL=http://localhost:3000
```

**3.58GB이고, `.env`가 이미지 안에 있다.** `COPY . .`이 폴더의 모든 것을 복사했기 때문이다.

이 이미지를 레지스트리에 올리는 순간, 이미지를 받을 수 있는 모든 사람이 `JWT_SECRET`을 갖는다.

그 밖에 테스트, 실험 스크립트, 호스트의 `node_modules`(macOS용으로 빌드된 것)까지 들어갔고, TypeScript 컴파일러 같은 개발 도구도 그대로 남았다.

`Dockerfile.naive`는 지우지 않고 비교용으로 남겨 둔다. 아래 `.dockerignore`의 `Dockerfile*` 줄이 이 파일을 이미지 밖으로 뺀다.

### 용어 | Docker CLI

- `docker build -f 파일 -t 이름:태그 .`: 쓸 Dockerfile과 이미지 이름을 정한다. 마지막 `.`은 빌드에 넘길 폴더(빌드 컨텍스트)다.

- `docker run --rm --entrypoint sh 이미지 -c '명령'`: 이미지의 원래 실행 명령 대신 셸로 명령 하나를 돌린다. `--rm`은 끝난 컨테이너를 바로 지운다.

### 작업 1. 고치기 ①: `.dockerignore`

`.gitignore`처럼, 빌드할 때 Docker에 넘기지 않을 것을 적는다.

```text
# .dockerignore
# 이미지에 들어가면 안 되는 것: 호스트의 의존성·빌드 결과(다시 만든다), 비밀 값, 테스트·실험 파일
node_modules
dist
src/generated
.env
.env.*
*.tsbuildinfo
test
scripts
scratch-client.mjs
Dockerfile*
.dockerignore
.git
README.md
```

#### `.env` 없이도 Prisma 설정이 읽히게 하기

`.env`가 빠지면 `prisma7.config.ts`의 `process.loadEnvFile()`이 파일을 못 찾아 빌드가 실패한다(`Error: ENOENT: no such file or directory, open '.env'`).

컨테이너에서는 환경변수를 직접 받으므로, 파일이 있을 때만 읽게 바꾼다.

```ts
// prisma7.config.ts
// 맨 위의 import 한 줄과 loadEnvFile 줄만 바꾼다
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma CLI는 .env를 자동으로 읽지 않는다. dotenv 대신 Node 내장 함수로 읽는다(Node 20.12+)
// 컨테이너 안에는 .env가 없다(환경변수로 직접 받는다) → 파일이 있을 때만 읽는다
if (existsSync(".env")) process.loadEnvFile();
```

### 작업 2. 고치기 ②: 다단계 빌드

빌드에 필요한 것(TypeScript, Prisma CLI, 소스)과 실행에 필요한 것(빌드 결과, 운영용 의존성)은 다르다.

단계를 나눠, **마지막 단계에는 실행에 필요한 것만** 복사한다.

#### Dockerfile

`order-api-nest/Dockerfile`을 아래처럼 만든다. `# syntax=` 줄은 파일 첫 줄에 있어야 하므로 파일 이름 주석을 달지 않았다.

```dockerfile
# syntax=docker/dockerfile:1

# ① 의존성 설치(개발 도구 포함) - package*.json이 안 바뀌면 이 층은 캐시에서 그대로 쓴다
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ② 빌드: Prisma 클라이언트 생성 + TypeScript 컴파일
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ③ 마이그레이션 전용: prisma CLI(개발 의존성)가 필요하므로 build 단계에서 이어 간다. 배포할 때 한 번 실행하고 끝난다
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ④ 실행에 필요한 의존성만(devDependencies 제외)
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ⑤ 최종 이미지: 실행에 필요한 것만 담는다
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# "type": "module"을 Node가 읽어야 dist의 import 문을 ESM으로 실행한다
COPY package.json ./
# root가 아닌 사용자로 실행한다(node 이미지에 기본으로 있는 사용자)
USER node
EXPOSE 4000
# npm을 거치지 않고 node를 직접 실행한다 - 종료 신호(SIGTERM)가 node에 바로 가도록(이 문서 4단계)
CMD ["node", "dist/main.js"]
```

(6단계에서 `CMD`에 한 가지를 더한다.)

`package.json`을 소스보다 **먼저** 따로 복사하는 데에는 이유가 있다.

Docker는 단계(`RUN`, `COPY`) 하나하나를 층으로 캐시하고, 입력이 같으면 다시 실행하지 않는다. 소스만 고쳤을 때는 `npm ci` 층이 캐시에서 그대로 나와 빌드가 빨라진다.

#### 빌드하고 안을 확인하기

```sh
# --target: 이 단계까지만 빌드해서 이미지로 만든다
docker build --target runtime -t order-api:runtime .
docker build --target migrate -t order-api:migrate .

docker image ls | grep order-api
order-api:runtime   933MB
order-api:migrate   1.5GB
order-api:naive     3.58GB

docker run --rm --entrypoint sh order-api:runtime -c 'id; ls -a /app; test -f /app/.env && echo ".env 있음" || echo ".env 없음"'
uid=1000(node) gid=1000(node) groups=1000(node)
.
..
dist
node_modules
package.json
.env 없음
```

`/app`에는 `dist`, `node_modules`, `package.json` 셋뿐이고, root가 아닌 `node` 사용자로 돈다. 첫 줄의 `uid=1000(node)`가 Dockerfile의 `USER node`가 적용됐다는 확인이다.

여기서 `node`는 Node.js 프로그램이 아니라 **리눅스 사용자 계정 이름**이다. 공식 `node` 이미지는 만들 때 `node`라는 일반 사용자(uid 1000)를 미리 만들어 두는데, 이름이 런타임과 같을 뿐 둘은 상관이 없다. `USER`가 없으면 컨테이너는 root(uid 0)로 돈다.

> 앱에 취약점이 있어 누가 코드를 실행하게 되더라도 컨테이너 안에서 root 권한은 없다.

`COPY`로 넣은 파일은 root 소유로 들어가지만 읽기 권한은 모두에게 열려 있어 `node` 사용자가 실행하는 데 문제가 없다. 대신 `/app` 아래에 쓰기는 못 한다. 이 앱은 파일을 쓰지 않으니 이대로 두고, 파일을 써야 하는 앱이라면 `COPY --chown=node:node`로 소유자를 바꿔 넣는다.

### 용어 | Dockerfile 문법

- `# syntax=docker/dockerfile:1`: 이 파일을 해석할 Dockerfile 문법 버전을 정한다. 다른 주석보다 먼저, 파일 첫 줄에 있어야 한다. 없어도 빌드는 되지만(Docker 23부터 기본 빌더인 BuildKit이 내장 문법으로 읽는다), 그러면 문법 버전이 설치된 Docker 버전에 따라 달라진다. `:1`은 1.x 중 최신을 가리키므로, Docker를 업데이트하지 않아도 같은 최신 문법으로 빌드된다.

- `FROM 이미지 AS 이름`: 새 단계를 시작하고 이름을 붙인다. 뒤에서 `FROM 이름`이나 `COPY --from=이름`으로 그 단계를 가리킨다. 아래 "단계를 잇는 두 방법"에서 다룬다.

- `COPY --from=단계 원본 대상`: 다른 단계의 결과물에서 필요한 파일만 골라 복사한다.

- `USER node`: 이후 명령과 컨테이너 실행을 그 사용자로 한다.

- `EXPOSE 4000`: 컨테이너가 쓰는 포트를 표시한다. 실제로 호스트에 여는 건 compose의 `ports`다.

- `CMD ["node", "dist/main.js"]`(exec 형식): 셸을 거치지 않고 그 프로그램을 바로 실행한다. 아래 "`CMD`의 exec 형식과 셸 형식"에서 다룬다.

### 개념 | 단계를 잇는 두 방법: `FROM 단계`와 `COPY --from`

먼저 단계는 컨테이너가 아니다. 단계는 이미지를 만드는 **중간 작업대**이고, 빌드가 끝나면 `--target`으로 고른 단계 하나만 이름 붙은 이미지로 남는다. 컨테이너는 그 이미지를 `docker run`이나 compose로 띄울 때 생긴다.

이 Dockerfile에서는 다섯 단계 중 두 단계를 골라 이미지 두 개를 만들고, 나머지 셋(`deps`, `build`, `prod-deps`)은 재료만 대고 남지 않는다.

```text
[deps]       FROM node:24-slim       npm ci (개발 의존성 포함)
   │
   │ FROM deps: 전체를 물려받는다
   ▼
[build]      소스 복사 → prisma generate → npm run build → dist
   │   │
   │   └──── FROM build: 전체를 물려받는다
   │              ▼
   │         [migrate]    소스·prisma CLI·dist 전부 있음
   │              │
   │              └─ --target migrate ─► 이미지 order-api:migrate (1.5GB)
   │                                       └─► 컨테이너 migrate: 배포 때 한 번 돌고 Exited (0)
   │
   │ COPY --from=build: /app/dist만
   ▼
[runtime]    FROM node:24-slim (빈 바닥에서 새로 시작)
   ▲         + package.json, USER node, CMD node dist/main.js
   │              │
   │              └─ --target runtime ─► 이미지 order-api:runtime (933MB)
   │                                       └─► 컨테이너 api: 계속 떠서 요청을 받는다
   │
   │ COPY --from=prod-deps: /app/node_modules만
   │
[prod-deps]  FROM node:24-slim       npm ci --omit=dev
```

이 Dockerfile의 다섯 단계는 두 가지 방법으로 이어져 있다.

`FROM 단계`는 앞 단계의 **파일 시스템 전체를 물려받아** 그 위에 쌓고, `COPY --from=단계`는 새 바닥(`node:24-slim`)에서 시작해 앞 단계에서 **지정한 파일만** 가져온다.

```dockerfile
# 물려받기: build의 모든 것(소스, 개발 의존성 포함 node_modules, dist)이 그대로 있다
FROM build AS migrate

# 골라 오기: 빈 node:24-slim에 두 폴더만 들어온다
FROM node:24-slim AS runtime
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
```

C로 비유하면 `FROM build`는 컴파일러와 오브젝트 파일이 널린 빌드 디렉터리를 통째로 넘기는 것이고, `COPY --from`은 링크가 끝난 실행 파일만 골라 배포하는 것이다.

| 구분 | `FROM 단계` | `COPY --from=단계` |
| --- | --- | --- |
| 가져오는 것 | 앞 단계의 파일 시스템 전체 | 지정한 경로만 |
| 이 문서의 예 | `migrate`(prisma CLI가 필요하다) | `runtime` |
| 크기 | 1.5GB | 933MB |

- `migrate`가 `build`를 물려받은 건 의도한 것이다. `prisma migrate deploy`는 개발 의존성인 prisma CLI와 `prisma/` 폴더의 마이그레이션 파일이 있어야 돈다.

- `docker build --target runtime`은 `runtime`이 실제로 필요로 하는 단계(`deps`, `build`, `prod-deps`)만 빌드하고, 아무도 참조하지 않는 `migrate`는 건너뛴다.

- 단계 이름 대신 `COPY --from=node:24-slim ...`처럼 이미지 이름을 직접 쓸 수도 있다.

> 최종 이미지에 무엇이 남는지는 마지막 단계의 `FROM`과 `COPY --from`만 보면 알 수 있다. 앞 단계에 무엇을 설치했든 골라 오지 않으면 들어오지 않는다.

### 개념 | `CMD`의 exec 형식과 셸 형식

`CMD`는 두 가지로 쓸 수 있다.

JSON 배열로 쓰면(exec 형식) Docker가 그 프로그램을 바로 실행하고, 문자열로 쓰면(셸 형식) Docker가 그 문자열을 `/bin/sh -c "..."`로 감싸서 실행한다.

```dockerfile
CMD ["node", "dist/main.js"] # exec 형식: node가 PID 1이 된다
CMD node dist/main.js # 셸 형식: 실제로는 ["/bin/sh", "-c", "node dist/main.js"]. sh가 PID 1, node는 그 자식이다
```

PID 1이 왜 중요한지는 `docker stop`이 하는 일을 보면 알 수 있다.

1. 컨테이너의 **PID 1 하나에만** `SIGTERM`("정리하고 끝내라")을 보낸다. 다른 프로세스에는 보내지 않는다.

2. 기다린다(기본 10초).

3. 그때까지 컨테이너가 살아 있으면 `SIGKILL`로 안의 프로세스를 모두 강제로 죽인다. `SIGKILL`은 프로세스가 가로챌 수 없어서 정리 코드가 한 줄도 돌지 않는다.

그러니 종료 요청을 받는 건 PID 1뿐이다. 셸 형식에서는 이 요청을 sh가 받는다.

`node:24-slim`의 `/bin/sh`는 받은 `SIGTERM`을 자식에게 넘겨 주지 않는다. 게다가 sh 자신이 PID 1이라 핸들러 없는 시그널은 버려진다(0장 개념 2). 결국 node는 종료 요청이 왔다는 것도 모른 채 일하다가 10초 뒤 `SIGKILL`을 맞는다.

`SIGTERM`을 받으면 바로 끝나는 작은 node 프로그램을 두 형식으로 띄워 `docker stop`에 걸린 시간을 재면 차이가 그대로 나온다.

| `CMD` 형식 | PID 1 | `docker stop` 걸린 시간 | 종료 코드 |
| --- | --- | --- | --- |
| exec 형식 | node | 0.12초 | 0(node의 핸들러가 받아서 끝냄) |
| 셸 형식 | sh | 10.14초 | 137(node는 시그널을 못 받고 `SIGKILL`로 죽음) |

셸 형식의 10초는 sh가 시그널을 node에 넘기느라 걸린 시간이 아니다. 시그널은 node에 **아예 가지 않았고**, 컨테이너 안에서 아무도 반응하지 않아 Docker가 유예 시간(기본 10초)을 다 채운 것이다. 그래서 유예 시간을 30초로 늘리면 30초가 걸린다. 종료 코드 137은 128 + 9(`SIGKILL`의 번호)로, 강제로 죽었다는 표시다.

10초 차이가 눈에 띄지만 exec 형식을 쓰는 이유는 속도가 아니다. 중요한 건 **앱이 정리할 기회를 얻느냐**다. 종료 요청을 받은 서버는 할 일이 있다.

- 이미 받은 HTTP 요청에 끝까지 응답한다.

- 처리 중이던 큐 job을 마치거나 반납한다.

- DB와 Redis 연결을 닫는다.

`SIGKILL`로 죽으면 이 중 하나도 못 한다. 정리를 못 하는 쪽은 다른 서비스가 아니라 **node 앱 자신**이다. 다른 쪽은 그 결과를 떠안는다.

- 클라이언트: 응답 대신 연결 끊김을 받는다.

- DB: 연결이 갑자기 끊긴 것으로 보고, 진행 중이던 트랜잭션을 롤백한다.

- 큐: job이 처리 중 상태로 멈춰 있다가 나중에 다시 처리될 수 있다. 메일이 두 번 나가는 식의 중복이 여기서 생긴다.

배포할 때마다 기존 컨테이너는 이렇게 종료된다. 셸 형식이면 배포할 때마다 처리 중이던 요청이 잘리고, 컨테이너 하나를 바꿀 때마다 10초씩 기다리느라 배포도 늦어진다. 그래서 실무에서는 exec 형식을 기본으로 쓴다. 쿠버네티스도 같은 방식으로 종료하므로(기본 30초 뒤 `SIGKILL`) 사정이 같다.

exec 형식은 시그널이 node에 **닿게만** 해 준다. 받은 뒤 정리하는 건 앱의 일이다. 핸들러가 없거나 정리가 끝나지 않으면 exec 형식이어도 10초를 다 채운다. 4단계에서 이 경우를 다룬다.

- `CMD ["npm", "run", "start:prod"]`도 exec 형식이지만, PID 1은 node가 아니라 npm이다. 시그널이 node까지 가는지는 npm에 달려 있다.

- exec 형식에서는 셸이 없으므로 `$PORT` 같은 환경변수 치환이나 `&&`가 동작하지 않는다. 필요하면 앱 코드에서 `process.env`로 읽는다.

> Dockerfile에서 `CMD`를 문자열로 쓰는 순간 PID 1이 셸로 바뀐다. 정상 종료가 중요한 서버라면 배열로 쓴다.

### 개념 | 더 줄일 수 있는가

남은 크기의 대부분은 `node_modules`(451MB)다. 들여다보면 운영에 필요 없어 보이는 것이 있다.

```sh
docker run --rm --entrypoint sh order-api:runtime -c 'du -sh /app/node_modules/* /app/node_modules/@* | sort -rh | head -5'
172M  /app/node_modules/@prisma
 41M  /app/node_modules/prisma        # CLI. 운영에서는 안 쓴다
 34M  /app/node_modules/effect
 26M  /app/node_modules/@electric-sql
 24M  /app/node_modules/typescript    # 컴파일러. 운영에서는 안 쓴다
docker run --rm --entrypoint sh order-api:runtime -c 'cd /app && npm explain prisma'
prisma@7.10.0
  dev prisma@"^7.10.0" from the root project
  peerOptional prisma@"*" from @prisma/client@7.10.0
```

`--omit=dev`인데 `prisma` CLI와 `typescript`가 남았다. `npm explain`이 원인을 보여 준다.

우리 `devDependencies`이기도 하지만, 동시에 운영 의존성인 `@prisma/client`가 이 둘을 선택적 peer dependency로 선언하고 있다. 그래서 npm이 운영 설치에도 남겼다.

> 이걸 걷어 내려면 패키지 구성을 손봐야 하고, 이 문서에서는 "이미지 안을 들여다보고 이유를 찾는 법"까지만 한다.

### 남길 것

- **찾아보면 되는 것**: `.dockerignore` 항목, `FROM ... AS`·`COPY --from`·`USER`·`EXPOSE`의 문법, `docker build --target`, `npm explain`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `COPY . .`은 폴더의 모든 것을 이미지에 넣는다. 이미지에 들어간 비밀은 이미지를 받은 모든 사람의 것이 된다. 무엇이 들어가는지는 `.dockerignore`와 마지막 단계의 `COPY --from`이 정한다.

  - `CMD`를 문자열(셸 형식)이나 `npm run`으로 쓰면 node가 아닌 프로세스가 PID 1이 되고, 종료 신호가 node까지 가지 않을 수 있다.

- **에러 신호**:

  - 이미지 안에서 `cat /app/.env`가 값을 출력한다 → `.dockerignore`에 `.env`가 있는지

  - 빌드 중 `Error: ENOENT: no such file or directory, open '.env'` → `prisma7.config.ts`가 파일이 있을 때만 `loadEnvFile()`을 부르는지

  - `--omit=dev`로 설치했는데 `prisma`·`typescript`가 이미지에 있다 → `npm explain <패키지>`로 누가 끌어왔는지

  - `docker stop`이 10초 걸리고 종료 코드 137 → `CMD`가 셸 형식인지, PID 1이 무엇인지

## 3. 2단계: 컨테이너로 전체 띄우기

`docker-compose.yml`에 앱 서비스 둘을 더한다.

평소 개발할 때는 지금처럼 DB·Redis·저장소만 띄우고, `--profile app`을 붙였을 때만 앱까지 뜨게 한다.

### 작업 1. db에 healthcheck 더하기

```yaml
# docker-compose.yml
# db 서비스에 healthcheck를 추가한다
  db:
    # ... 기존 설정 ...
    # DB가 "연결을 받을 준비가 됐는지" 확인하는 방법. 다른 서비스가 이 결과를 기다린다(depends_on의 condition)
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "order", "-d", "order_api"]
      interval: 2s
      retries: 15
```

### 작업 2. migrate·api 서비스 더하기

```yaml
# docker-compose.yml
# services 끝에 추가한다
  # 여기부터는 앱 자체를 컨테이너로 띄우는 서비스. --profile app 을 붙였을 때만 뜬다
  # 마이그레이션: 한 번 실행하고 끝난다
  migrate:
    build: { context: ., target: migrate }
    profiles: ["app"]
    environment:
      DATABASE_URL: postgresql://order:order@db:5432/order_api # 컨테이너끼리는 서비스 이름(db)과 컨테이너 안의 포트(5432)로 찾는다
    depends_on:
      db: { condition: service_healthy }
  api:
    build: { context: ., target: runtime }
    profiles: ["app"]
    ports:
      - "4000:4000"
    environment:
      PORT: "4000"
      JWT_SECRET: change-me # 학습용 값. 운영에서는 비밀 관리 도구에서 주입한다
      DEMO_PASSWORD: "1234"
      FRONTEND_URL: http://localhost:3000
      ACCESS_TOKEN_TTL: 15m
      DATABASE_URL: postgresql://order:order@db:5432/order_api
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://storage:9000 # 서버 → 저장소(컨테이너 안의 주소)
      S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT-http://localhost:9000} # 브라우저 → 저장소(presigned URL에 들어갈 주소)
      S3_REGION: us-east-1
      S3_ACCESS_KEY: localaccess
      S3_SECRET_KEY: localsecret123
      S3_BUCKET: product-images
    depends_on:
      migrate: { condition: service_completed_successfully } # 마이그레이션이 성공적으로 끝난 뒤에 뜬다
      redis: { condition: service_started }
      storage: { condition: service_started }
```

`api`에는 3단계에서 `healthcheck`, 4단계에서 `init: true`, 6단계에서 추적용 환경변수 두 줄이 더 붙는다.

### 용어 | Compose 문법

- `build: { context: ., target: migrate }`: 이 폴더의 Dockerfile을 `migrate` 단계까지 빌드해 그 이미지로 띄운다.

- `profiles: ["app"]`: `--profile app`을 붙였을 때만 이 서비스를 띄운다.

- `depends_on`의 `condition`: 상대 서비스가 어떤 상태가 될 때까지 기다릴지 정한다. 아래 "`depends_on`이 기다리는 것"에서 다룬다.

- `${S3_PUBLIC_ENDPOINT-http://localhost:9000}`: 셸에 그 변수가 있으면 그 값, 없으면 기본값을 쓴다. 아래 깨뜨려보기에서 이 값을 바꿔 띄운다. `-`와 `:-`의 차이는 아래 "`${변수-기본값}`과 `${변수:-기본값}`"에서 다룬다.

### 개념 | `depends_on`이 기다리는 것

`depends_on`은 서비스를 띄우는 순서를 정한다. 그런데 기본으로는 상대 컨테이너가 **시작되기만** 하면 다음으로 넘어간다.

0장 개념 3에서 본 것처럼 "떠 있다"와 "일할 준비가 됐다"는 다르다.

PostgreSQL 컨테이너는 시작되고도 몇 초 동안 연결을 받지 못하고, 그 사이에 마이그레이션이 붙으면 실패한다.

```yaml
depends_on:
  db: { condition: service_healthy } # db의 healthcheck가 통과할 때까지
  migrate: { condition: service_completed_successfully } # migrate가 종료 코드 0으로 끝날 때까지
  redis: { condition: service_started } # 시작만 하면 된다(목록으로만 적었을 때의 기본값)
```

| `condition` | 기다리는 것 | 이 문서에서 |
| --- | --- | --- |
| `service_started` | 컨테이너가 시작됨 | `api` → `redis`, `storage` |
| `service_healthy` | 상대의 `healthcheck`가 통과함 | `migrate` → `db` |
| `service_completed_successfully` | 상대가 종료 코드 0으로 끝남 | `api` → `migrate` |

- `service_healthy`는 상대 서비스에 `healthcheck`가 있어야 쓸 수 있다. 없으면 `dependency failed to start: container ... has no healthcheck configured`로 바로 실패한다. 그래서 `db`에 `healthcheck`를 먼저 더했다.

- `depends_on`은 **처음 띄울 때의 순서만** 정한다. 떠 있는 동안 상대가 죽어도 이쪽을 멈추거나 재시작하지 않는다. 실행 중의 장애는 3단계의 readiness로 드러낸다.

> `depends_on: [db]`처럼 이름만 적으면 `service_started`다. "DB 다음에 뜨게 했는데 연결이 안 된다"는 대부분 이 기본값 때문이다.

### 개념 | `${변수-기본값}`과 `${변수:-기본값}`

compose 파일의 `${...}`는 셸과 같은 규칙으로 바뀐다. 차이는 **변수가 빈 문자열로 있을 때**다.

`-`는 "정의되지 않음"만 없다고 보고, `:-`는 빈 문자열도 없다고 본다.

두 표기를 나란히 넣은 시험용 compose 파일로 확인한다.

```yaml
    environment:
      A: ${S3_PUBLIC_ENDPOINT-http://localhost:9000}
      B: ${S3_PUBLIC_ENDPOINT:-http://localhost:9000}
```

```sh
# docker compose config: 변수를 채운 최종 설정을 보여 준다
# 변수 없음
docker compose config
A: http://localhost:9000
B: http://localhost:9000
# 빈 문자열로 정의
S3_PUBLIC_ENDPOINT= docker compose config
A: ""
B: http://localhost:9000
```

| 셸의 변수 상태 | `${X-기본}` | `${X:-기본}` |
| --- | --- | --- |
| 정의되지 않음 | 기본 | 기본 |
| 빈 문자열(`X=`) | 빈 문자열 | 기본 |
| 값 있음 | 그 값 | 그 값 |

- 이 문서의 `api`는 `-`를 쓴다. 그래서 `S3_PUBLIC_ENDPOINT=`로 띄우면 컨테이너에 빈 문자열이 그대로 들어간다. 아래 깨뜨려보기 ②에서 그 빈 문자열이 `??`를 만나 사고가 난다.

- JS로 옮기면 `-`는 `??`, `:-`는 `||`와 같은 감각이다(빈 문자열 외에 `0`, `false`까지 걸러 내는 `||`와 완전히 같지는 않다).

> `docker compose config`로 변수가 채워진 결과를 먼저 보면, 띄우기 전에 어떤 값이 들어갈지 확인할 수 있다.

### 개념 | 마이그레이션을 왜 따로 돌리는가

앱이 시작할 때마다 마이그레이션을 하게 짜면, 서버를 세 대 띄우는 순간 세 대가 동시에 같은 마이그레이션을 시도한다.

마이그레이션은 배포 절차의 한 단계로 **한 번만** 돌리고, 앱은 그게 끝난 뒤에 뜬다. `service_completed_successfully`가 그 순서를 지킨다.

마이그레이션이 실패하면(종료 코드가 0이 아니면) 앱은 뜨지 않는다.

### 작업 3. 서명용 저장소 클라이언트를 따로 두기

`06`의 디버깅 장 "서버가 쓰는 주소와 브라우저가 쓰는 주소"에서 예고한 일이 여기서 현실이 된다.

#### 무엇이 문제인가

저장소에 닿는 길이 둘이고, 둘이 쓰는 주소가 다르다.

```text
[api] ──① 직접 요청──► http://storage:9000 ──► 저장소 (도커 네트워크 안의 이름)
  │
  │ ② presigned URL을 응답으로 건넨다
  ▼
[브라우저] ──③ 업로드──► http://localhost:9000 ──► 같은 저장소 (호스트에 공개된 포트)
```

- ① 서버가 버킷을 만들거나 파일을 확인할 때는 도커 네트워크 안에서 `http://storage:9000`으로 찾는다. `storage`는 compose 서비스 이름이라 컨테이너끼리만 통한다.

- ③ 브라우저는 도커 네트워크 밖에 있다. `storage`라는 이름을 모르고, 호스트에 공개된 `http://localhost:9000`으로만 닿는다.

지금 코드는 클라이언트가 `S3_ENDPOINT` 하나뿐이라 presigned URL에도 `http://storage:9000`이 들어간다. 브라우저는 이 URL로 업로드하지 못한다.

#### 왜 URL의 주소만 바꿔 끼우면 안 되는가

만들어진 URL 문자열에서 `storage:9000`을 `localhost:9000`으로 바꾸면 될 것 같지만 안 된다. presigned URL의 서명에는 **호스트 주소도 들어가 있어서**, 주소를 바꾸면 저장소가 서명이 맞지 않는다며 거절한다(`403 SignatureDoesNotMatch`).

그래서 처음부터 브라우저용 주소로 서명해야 한다. 서명용 클라이언트를 하나 더 두고, 그 클라이언트에는 `S3_PUBLIC_ENDPOINT`(브라우저가 닿는 주소)를 준다.

컨테이너 안에서는 `localhost:9000`에 저장소가 없는데도 괜찮은 이유가 있다. `getSignedUrl`은 네트워크 요청을 보내지 않고 **서명 계산만** 한다. 서명용 클라이언트는 그 주소로 실제로 접속할 일이 없다.

#### 코드 바꾸기

고칠 파일은 `src/storage/storage.service.ts` 하나이고, 바꿀 곳은 세 군데다.

| 순서 | 위치 | 할 일 |
| --- | --- | --- |
| ① | `@Injectable()` 바로 위(import 아래) | `makeClient` 함수를 새로 넣는다 |
| ② | 클래스 안의 `private readonly s3 = new S3Client({...})` | 이 필드를 지우고 `s3`, `presigner` 두 필드로 바꾼다 |
| ③ | `createUploadUrl`, `createDownloadUrl` | `getSignedUrl`의 첫 인자를 `this.s3`에서 `this.presigner`로 바꾼다 |

import 줄은 그대로 둔다. `S3Client`와 `getSignedUrl`은 이미 import되어 있다.

#### 코드 ①: 클라이언트를 만드는 함수 넣기

같은 설정에 주소만 다른 클라이언트가 둘 필요하므로, 만드는 코드를 함수로 뺀다. 기존 `s3` 필드의 설정을 그대로 옮기고 `endpoint`만 인자로 받는다.

```ts
// src/storage/storage.service.ts
// import 아래, @Injectable() 위에 넣는다
function makeClient(endpoint: string | undefined) {
  return new S3Client({
    endpoint: endpoint || undefined, // AWS S3를 쓸 때는 비워 두면 된다(빈 문자열도 "없음"으로 친다)
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}
```

#### 코드 ②: `s3` 필드를 두 필드로 바꾸기

```diff
   readonly bucket = process.env.S3_BUCKET!;
-  private readonly s3 = new S3Client({
-    endpoint: process.env.S3_ENDPOINT,
-    region: process.env.S3_REGION,
-    forcePathStyle: true,
-    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
-    requestChecksumCalculation: "WHEN_REQUIRED",
-  });
+  // 서버가 저장소에 직접 요청할 때 쓰는 클라이언트(컨테이너 안이라면 http://storage:9000 같은 내부 주소)
+  private readonly s3 = makeClient(process.env.S3_ENDPOINT);
+  // presigned URL을 만들 때만 쓰는 클라이언트. URL에 이 주소가 들어가므로 "브라우저가 닿는 주소"여야 한다(이 문서 2단계)
+  private readonly presigner = makeClient(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT);
```

`s3`라는 이름은 그대로 두었으므로 `onModuleInit`, `head`, `readFirstBytes`, `list`, `delete`는 고칠 필요가 없다. 이 메서드들은 저장소에 직접 요청하므로 내부 주소를 쓰는 게 맞다.

`presigner`의 주소는 `S3_PUBLIC_ENDPOINT`가 있으면 그 값, 없으면 `S3_ENDPOINT`다.

- **컨테이너로 띄울 때**: compose가 `S3_PUBLIC_ENDPOINT`를 `http://localhost:9000`으로 넣어 주므로 두 클라이언트의 주소가 갈린다.

- **호스트에서 `npm run start:dev`로 띄울 때**: `.env`에 `S3_PUBLIC_ENDPOINT`가 없다. 서버와 브라우저가 둘 다 `localhost:9000`으로 닿으니 같은 주소를 쓰면 되고, 지금까지처럼 동작한다.

여기서 `??`가 아니라 `||`를 쓴 데는 이유가 있다. `??`는 빈 문자열을 "값이 있음"으로 쳐서, `S3_PUBLIC_ENDPOINT=`처럼 빈 값으로 들어오면 `S3_ENDPOINT`로 넘어가지 않는다. 그러면 SDK가 진짜 AWS 주소로 서명해 버린다. 실제로 겪은 일이라 아래 "깨뜨려보기 ②"에 적었다.

#### 코드 ③: 서명하는 두 메서드만 `presigner`로

```diff
   createUploadUrl(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
     return getSignedUrl(
-      this.s3,
+      this.presigner,
       new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
       { expiresIn, signableHeaders: new Set(["content-type"]) },
     );
   }

   createDownloadUrl(key: string, expiresIn: number): Promise<string> {
-    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
+    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
   }
```

#### 확인

```sh
npm run build # 타입 오류 없이 끝나면 된다

grep -n "this.presigner" src/storage/storage.service.ts
# 두 줄(createUploadUrl, createDownloadUrl)이 나와야 한다
47:      this.presigner,
54:    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });

```

실제로 업로드가 되는지는 다음 작업에서 컨테이너로 띄워 확인한다.

### 작업 4. 전체를 컨테이너로 띄우기

```sh
docker compose --profile app up -d --build

docker compose --profile app ps -a
NAME                       IMAGE                    COMMAND                   SERVICE   CREATED             STATUS                     PORTS
order-api-nest-api-1       order-api-nest-api       "docker-entrypoint.s…"   api       13 seconds ago      Up 9 seconds               0.0.0.0:4000->4000/tcp
order-api-nest-db-1        postgres:17              "docker-entrypoint.s…"   db        14 seconds ago      Up 13 seconds (healthy)    0.0.0.0:5433->5432/tcp
order-api-nest-migrate-1   order-api-nest-migrate   "docker-entrypoint.s…"   migrate   14 seconds ago      Exited (0) 9 seconds ago   
order-api-nest-redis-1     redis:7                  "docker-entrypoint.s…"   redis     About an hour ago   Up About an hour           0.0.0.0:6380->6379/tcp
order-api-nest-storage-1   rustfs/rustfs:latest     "/entrypoint.sh rust…"   storage   About an hour ago   Up About an hour           0.0.0.0:9000-9001->9000-9001/tcp
```

`migrate`는 할 일을 마치고 `Exited (0)`으로 끝났고, 그다음 `api`가 떴다.

`api`의 `(healthy)`는 3단계에서 `healthcheck`를 더한 뒤에 나타난다. 지금은 `Up`만 보인다.

`migrate`는 테이블만 만들고 시드는 넣지 않는다.

DB가 비어 있다면(1장에서 프로젝트 이름을 바꾼 경우) 호스트에서 `npx prisma db seed`를 한 번 돌린다. 호스트의 `.env`가 가리키는 `localhost:5433`이 같은 `db` 컨테이너다.

호스트에서 `upload-image.mjs`를 돌리면 ①②③이 모두 성공하고, 목록의 `imageUrl`은 `http://localhost:9000/...`으로 시작한다.

### 실험 | 일부러 깨뜨려보기 ②: 서명 주소를 내부 주소로

```sh
S3_PUBLIC_ENDPOINT=http://storage:9000 docker compose --profile app up -d --build api
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
[TypeError: fetch failed] { [cause]: Error: getaddrinfo ENOTFOUND storage ... }
```

업로드 URL은 받았지만, 그 URL의 주소 `storage`를 호스트(브라우저 자리)가 찾지 못했다.

확인했으면 변수 없이 다시 띄워 원복한다(`docker compose --profile app up -d api`).

#### `??`였을 때 실제로 겪은 일

이 문서를 쓰면서 실제로 겪은 일도 하나 적는다.

처음에는 위 코드가 `||`가 아니라 `??`였고, 실험하려고 `S3_PUBLIC_ENDPOINT=`(빈 문자열)로 띄웠다. 결과는 `ENOTFOUND`가 아니라 이랬다.

```text
② 저장소 PUT → 403 InvalidAccessKeyId
```

`??`는 `null`과 `undefined`만 "없음"으로 본다. 빈 문자열은 값이 있는 것으로 쳐서 `endpoint: ""`가 됐다.

SDK는 endpoint가 없을 때처럼 **진짜 AWS S3 주소**로 URL을 만들었다. 요청이 실제 AWS까지 가서, 그런 액세스 키는 없다는 답을 받은 것이다.

> 환경변수는 "안 넣음"과 "빈 값으로 넣음"이 쉽게 섞이므로, 빈 문자열도 없는 것으로 다루는 `||`를 쓴다.

### 남길 것

- **찾아보면 되는 것**: `profiles`, `depends_on`의 세 `condition`, `${X-기본}`과 `${X:-기본}`의 표, `docker compose config`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 컨테이너끼리는 서비스 이름과 컨테이너 안의 포트로 찾고, 브라우저에 건네는 주소는 호스트 기준이어야 한다. 한 앱이 두 주소를 다 가질 수 있다.

  - `depends_on`은 기본으로 "시작됨"만 기다리고, 처음 띄울 때의 순서만 정한다. 준비됐는지는 `healthcheck`가, 실행 중의 장애는 readiness가 드러낸다.

  - 환경변수의 빈 문자열은 `??`를 통과한다. "설정 안 함"을 걸러야 하면 `||`를 쓴다.

  - presigned URL은 호스트 주소까지 서명된다. 만든 뒤에 주소를 바꿔 끼울 수 없으니, 처음부터 브라우저가 닿는 주소로 서명한다.

- **에러 신호**:

  - `dependency failed to start: container ... has no healthcheck configured` → `service_healthy`로 기다리는 상대 서비스에 `healthcheck`가 있는지

  - "DB 다음에 뜨게 했는데 연결이 안 된다" → `depends_on`이 이름만 적은 `service_started`인지

  - `migrate`가 `Exited (1)`이고 `api`가 아예 시작하지 않는다 → `docker compose logs migrate`

  - `getaddrinfo ENOTFOUND storage` → presigned URL에 컨테이너 안의 주소가 들어갔다. `S3_PUBLIC_ENDPOINT`

  - `② 저장소 PUT → 403 InvalidAccessKeyId` → `endpoint`가 빈 문자열이라 진짜 AWS로 서명됐다. `??` 대신 `||`

## 4. 3단계: 헬스 체크

### 작업 1. HealthController와 HealthModule 만들기

```ts
// src/health/health.controller.ts
import { Controller, Get, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

// 기다려도 응답이 없으면 실패로 친다 - 확인 요청 자체가 멈춰 버리면 안 된다
// Promise.race: 먼저 끝나는 쪽의 결과를 쓴다
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${ms}ms 초과`)), ms))]);

@Controller("health")
export class HealthController implements OnModuleDestroy {
  // lazyConnect: 처음 명령을 보낼 때 연결한다. maxRetriesPerRequest: 1: 끊겨 있으면 오래 기다리지 않고 실패한다
  private readonly redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.redis.on("error", () => {}); // 연결 오류는 ready 응답으로 드러낸다(로그 폭주 방지)
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }

  // 살아 있는가(liveness): 프로세스가 요청을 받을 수 있으면 200. 의존 서비스는 보지 않는다
  @Get()
  live() {
    return { status: "ok" };
  }

  // 일할 준비가 됐는가(readiness): DB·Redis·저장소에 모두 닿아야 200
  @Get("ready")
  async ready() {
    const checks = {
      db: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
      storage: () => this.storage.ping(),
    };
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), 1000);
          return [name, "ok"] as const;
        } catch (err) {
          return [name, (err as Error).message || "error"] as const;
        }
      }),
    );
    const body = { status: results.every(([, r]) => r === "ok") ? "ok" : "fail", checks: Object.fromEntries(results) };
    if (body.status !== "ok") throw new ServiceUnavailableException(body); // 503으로 응답한다
    return body;
  }
}
```

```ts
// src/health/health.module.ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`HealthModule`의 `imports`가 비어 있는데도 `PrismaService`와 `StorageService`를 주입받을 수 있는 것은, `PrismaModule`과 `StorageModule`에 둘 다 `@Global()`이 붙어 있어서다.

전역이 아닌 모듈의 프로바이더를 받으려 했다면 서버가 뜨기 전에 `Nest can't resolve dependencies of the HealthController (PrismaService, ?)` 같은 에러로 멈춘다.

`ServiceUnavailableException`에 객체를 넘기면 Nest는 그 객체를 그대로 응답 본문으로 쓰고 상태 코드만 503으로 한다. 그래서 실패 응답에도 항목별 결과가 나온다.

### 작업 2. StorageService에 ping() 더하기

버킷에 닿는지 확인하는 `ping()`을 더한다. `HeadBucketCommand`는 `06`에서 버킷이 있는지 볼 때 이미 import해 두었다.

```ts
// src/storage/storage.service.ts
// StorageService 안, delete 위에 추가한다
  // 준비 상태 확인(이 문서 3단계 /health/ready)용: 버킷에 닿는가
  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
```

서명용 `presigner`가 아니라 `s3`를 쓴다. 서버가 실제로 저장소에 닿는지를 묻는 것이기 때문이다.

### 작업 3. app.module.ts에 HealthModule 등록하기

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 HealthModule만 추가한다
import { HealthModule } from './health/health.module.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

여기에 빠지면 서버는 멀쩡히 뜨는데 `/health`와 `/health/ready`만 404가 난다.

### 작업 4. Docker가 readiness를 묻게 하기

```yaml
# docker-compose.yml
# api 서비스에 추가한다
    # 컨테이너가 "일할 준비가 됐는가"를 Docker가 주기적으로 확인한다
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 5s
      retries: 6
```

`curl`이 아니라 `node -e`인 이유는 `node:24-slim` 이미지에 `curl`이 없기 때문이다. 확인 도구를 따로 설치하는 대신 이미 있는 Node의 `fetch`를 쓴다.

`healthcheck`의 명령은 컨테이너 **안에서** 돈다. 그래서 `localhost:4000`은 그 컨테이너 자신이다.

다시 빌드해 띄운다.

```sh
docker compose --profile app up -d --build
curl localhost:4000/health/ready
{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}}
```

### 개념 | 확인 요청이 멈추지 않게: 타임아웃과 Redis 연결 설정

readiness는 의존 서비스가 **죽어 있을 때** 쓰라고 있는 것이다. 그런데 의존 서비스가 죽으면 확인 요청 자체가 응답 없이 멈추기 쉽다.

Docker의 `healthcheck`도 기다리다 지치면 실패로 치지만, 그러면 "어느 쪽이 문제인지"가 응답에 남지 않는다.

#### `withTimeout`

`Promise.race`는 먼저 끝나는 쪽을 따른다. 확인이 1초 안에 안 끝나면 `1000ms 초과` 에러가 먼저 끝나므로 그 항목은 실패로 기록된다.

흔한 오해가 하나 있다. `Promise.race`는 진 쪽을 **취소하지 않는다**. 늦은 `ping()`은 뒤에서 계속 돌다가 결과가 버려질 뿐이다.

C로 치면 `select()`에 타임아웃을 줘서 기다리기를 그만둔 것이지, 그 소켓의 요청을 회수한 것은 아니다.

#### Redis 연결을 따로 만드는 이유

ioredis는 연결이 끊긴 동안 보낸 명령을 큐에 쌓아 두고, 다시 연결되면 보낸다. 그 사이 명령은 응답을 받지 못하고 기다린다.

`maxRetriesPerRequest`는 명령 하나가 재접속을 몇 번까지 기다릴지다. `1`이면 한 번 재접속에 실패하는 순간 `Reached the max retries per request limit ...` 에러로 끝난다.

그래서 깨뜨려보기 ③에서 Redis를 멈춘 직후의 첫 요청에는 이 메시지가 나오기도 한다.

이 설정은 앱의 다른 Redis 연결과 정반대다.

`04`부터 쓴 `MailQueue`의 연결은 `maxRetriesPerRequest: null`(무한히 기다림)이다. BullMQ가 그렇게 요구하기 때문이다.

같은 연결을 빌려 쓰면 헬스 체크가 무한히 기다리게 되므로, 헬스 체크용 연결을 따로 만들었다.

- `lazyConnect: true`는 생성자에서 바로 연결하지 않고 첫 명령 때 연결한다. 헬스 체크가 한 번도 불리지 않으면 연결도 생기지 않는다.

- `this.redis.on("error", () => {})`가 없으면 Redis가 끊긴 동안 ioredis가 재접속에 실패할 때마다 처리되지 않은 `error` 이벤트 경고가 쏟아진다. 실패는 ready 응답으로 드러내므로 로그는 막는다.

### 실험 | 일부러 깨뜨려보기 ③: Redis가 죽으면

```sh
docker compose stop redis
curl -s -w " → %{http_code}\n" localhost:4000/health
{"status":"ok"} → 200
curl -s -w " → %{http_code}\n" localhost:4000/health/ready
{"status":"fail","checks":{"db":"ok","redis":"1000ms 초과","storage":"ok"}} → 503
# 멈춘 직후 첫 요청은 redis 자리에 "Reached the max retries per request limit ..."가 나오기도 한다. 다시 물으면 "1000ms 초과"
```

프로세스는 살아 있지만(200), 일할 준비는 안 됐다(503). 어느 의존 서비스가 문제인지도 응답에 나온다.

Docker가 이걸 어떻게 받아들이는지 10초마다 본다.

```text
10초: healthy 연속실패=1
20초: healthy 연속실패=3
30초: healthy 연속실패=5
40초: unhealthy 연속실패=6
50초: unhealthy 연속실패=8
(Redis를 다시 켜면) 복구 후: healthy
```

`retries: 6`이라 연속 6번(약 30초) 실패해야 `unhealthy`가 된다. 한두 번의 일시적인 실패로 판단을 바꾸지 않기 위한 여유다.

로드밸런서나 오케스트레이터는 이 상태를 보고 이 컨테이너로 트래픽을 보내지 않는다.

> Docker Compose 자체는 `unhealthy`라고 컨테이너를 재시작하지는 않는다. 상태를 알려 줄 뿐이다.

`docker compose start redis`로 원복한다. 다음 회차의 확인부터 성공하고 상태가 `healthy`로 돌아온다.

### 남길 것

- **찾아보면 되는 것**: `healthcheck`의 `test`·`interval`·`retries`, ioredis의 `lazyConnect`·`maxRetriesPerRequest`, `ServiceUnavailableException`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - liveness는 의존 서비스를 보지 않는다. 의존 서비스가 죽었을 때 할 일은 재시작이 아니라 트래픽을 빼는 것이고, 그건 readiness가 말한다.

  - 확인 요청에는 반드시 시간 상한을 둔다. 죽은 서비스를 묻는 요청은 실패하지 않고 멈추기 쉽다.

- **에러 신호**:

  - 서버는 멀쩡히 뜨는데 `/health`만 404 → `app.module.ts`의 `imports`에 `HealthModule`이 있는지

  - `/health`는 200인데 `/health/ready`가 503 `"redis":"1000ms 초과"` → 그 항목의 의존 서비스(`docker compose ps`)

  - `"redis":"Reached the max retries per request limit ..."` → Redis가 막 끊겼다. 같은 칸

  - 컨테이너가 `(unhealthy)` → `docker inspect --format '{{json .State.Health}}' <컨테이너>`의 최근 출력

## 5. 4단계: 깨끗하게 끄기

배포는 "새 버전을 띄우고, 옛 버전에 `SIGTERM`을 보내 끄는" 일의 반복이다.

`docker stop`도 `SIGTERM`을 보내고 10초 기다린 뒤, 그때까지 안 죽으면 `SIGKILL`로 강제 종료한다.

**강제 종료는 정리할 기회가 없다는 뜻이다.** 처리 중인 BullMQ job이 중간에 끊기고, 아직 못 보낸 로그와 추적 기록도 사라진다.

### 작업 1. 종료 훅 켜기

Nest는 기본으로 시그널을 받지 않는다.

`main.ts`에 한 줄을 넣어야 `SIGTERM`을 받았을 때 모듈들의 `onModuleDestroy`(`01`·`02`·`04`·`06`에서 만든 타이머 정지, 워커·연결 닫기)를 돌고 끝낸다.

```ts
// src/main.ts
// NestFactory.create 바로 다음에 추가한다
  // SIGTERM(docker stop, 배포 교체)을 받으면 onModuleDestroy들을 돌고 정상 종료한다(이 문서 4단계)
  app.enableShutdownHooks();
```

### 작업 2. 종료 과정을 로그로 남기기

종료 과정을 보려고 로그를 남기는 작은 Provider를 하나 둔다.

```ts
// src/shutdown-logger.ts
import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";

// 종료 과정이 눈에 보이게 한다. Nest는 종료 신호를 받으면 이 순서로 부른다
//   ① 모든 onModuleDestroy(타이머 정지, 워커·DB·Redis 연결 닫기)
//   ② beforeApplicationShutdown → ③ HTTP 서버 닫기 → ④ onApplicationShutdown
@Injectable()
export class ShutdownLogger implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger("Shutdown");
  private startedAt = 0;

  beforeApplicationShutdown(signal?: string) {
    this.startedAt = Date.now();
    this.logger.log(`종료 신호(${signal}) - 모듈 정리를 마쳤습니다. HTTP 서버를 닫습니다`);
  }

  onApplicationShutdown() {
    this.logger.log(`HTTP 서버까지 닫았습니다(${Date.now() - this.startedAt}ms) - 프로세스를 종료합니다`);
  }
}
```

`app.module.ts`의 `providers`에 `ShutdownLogger`를 추가한다. `providers`에 없으면 Nest가 만들지 않으므로 훅도 불리지 않는다.

`@Module`의 세 칸은 "무엇을 넣느냐"로 나뉜다.

| 칸 | 넣는 것 | 알아보는 법 | 예 |
| --- | --- | --- | --- |
| `imports` | 다른 **모듈** | 클래스에 `@Module()`이 붙어 있다 | `PrismaModule`, `OrdersModule` |
| `controllers` | HTTP 요청을 받는 클래스 | `@Controller()`가 붙어 있다 | `AppController` |
| `providers` | Nest가 만들어서 주입해 주는 나머지 클래스(서비스, 리포지토리, 로거 등) | 대개 `@Injectable()`이 붙어 있다 | `AppService`, `ShutdownLogger` |

`imports`와 `providers`의 경계는 **"그 객체를 누가 만드느냐"**다. `providers`는 이 모듈이 직접 만드는 객체이고, `imports`는 다른 모듈이 만든 객체를 빌려 쓰겠다는 선언이다.

`OrdersService`의 생성자로 보면 이렇다.

```ts
// src/orders/orders.service.ts
  constructor(
    private readonly prisma: PrismaService,                 // PrismaModule이 만든다
    private readonly notifications: NotificationsGateway,   // NotificationsModule이 만든다
  ) {}
```

```ts
// src/notifications/notifications.module.ts
// providers: 이 모듈이 만든다 / exports: 그중 이것은 다른 모듈에 빌려준다
@Module({ providers: [NotificationsGateway], exports: [NotificationsGateway] })
export class NotificationsModule {}

// src/orders/orders.module.ts
@Module({
  imports: [NotificationsModule], // NotificationsModule이 빌려주는 것(NotificationsGateway)을 쓴다
  controllers: [OrdersController],
  providers: [OrdersService],     // OrdersService는 이 모듈이 만든다
})
export class OrdersModule {}
```

- `OrdersService`는 주문 모듈의 것이니 `OrdersModule`의 `providers`에 둔다.

- `NotificationsGateway`는 알림 모듈의 것이다. 주문 모듈은 만들지 않고 `NotificationsModule`을 `imports`해서 빌려 쓴다. 빌려 쓸 수 있는 건 상대 모듈이 `exports`에 올린 것뿐이다.

- `PrismaService`를 `imports` 없이 쓸 수 있는 건 `PrismaModule`에 `@Global()`이 붙어 있어서다. `@Global()` 모듈은 `AppModule`에서 한 번만 `imports`하면 모든 모듈이 빌려 쓸 수 있다.

헷갈려서 `NotificationsGateway`를 `OrdersModule`의 `providers`에 직접 넣어도 에러 없이 돈다. 하지만 그러면 주문 모듈이 게이트웨이를 **하나 더** 만든다. `PrismaService`로 같은 실수를 하면 DB 연결 풀이 둘이 된다. 다른 모듈의 것은 `providers`에 넣지 말고 그 모듈을 `imports`한다.

- Nest는 이 세 칸에 적힌 클래스만 만든다. 파일을 만들고 `@Injectable()`을 붙여도 어느 모듈의 `providers`에도 없으면 생성되지 않고, 생성되지 않은 객체의 훅은 불리지 않는다.

- `ShutdownLogger`는 HTTP 요청을 받지 않고 다른 모듈도 아니므로 `providers`에 넣는다.

```ts
// src/app.module.ts
// import 한 줄과 providers 배열의 ShutdownLogger만 추가한다
import { ShutdownLogger } from './shutdown-logger.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

### 작업 3. 워커와 리더 연결의 정리 로그 넣기

`MailQueue`와 `LeaderElection`의 `onModuleDestroy`에도 한 줄씩 넣는다.

```ts
// src/queue/mail.queue.ts
// onModuleDestroy 안, worker.close() 다음에 한 줄 추가한다
  async onModuleDestroy() {
    await this.worker.close(); // 처리 중인 job이 끝날 때까지 기다렸다가 닫는다
    this.logger.log("메일 워커 종료");
    await this.queue.close();
    await this.connection.quit();
  }
```

```ts
// src/leader/leader-election.ts
// onModuleDestroy 끝에 한 줄 추가한다
    await client?.end(); // 연결을 닫으면 잠금도 함께 풀린다
    if (client) this.logger.log("리더 연결 종료(잠금 해제)");
```

#### 재 보기

코드를 바꿨으니 이미지를 다시 빌드해 띄우고, `api`를 멈추면서 걸린 시간을 잰다.

```sh
# 바뀐 코드로 이미지를 다시 만들어 띄운다
docker compose --profile app up -d --build

# 멈추는 데 걸린 시간(real)을 잰다
time docker compose stop api
docker compose stop api  0.08s user 0.07s system 1% cpu 10.318 total

# api 줄의 Exited (숫자)가 종료 코드다, 137
docker compose --profile app ps -a

# 정리 로그가 찍혔는지 본다
docker compose logs api | tail -n 20
...
LOG [LeaderElection] 리더가 됐다(pid 1, PORT 4000)
LOG [LeaderElection] 리더 연결 종료(잠금 해제)
LOG [MailQueue] 메일 워커 종료
LOG [Shutdown] 종료 신호(SIGTERM) - 모듈 정리를 마쳤습니다. HTTP 서버를 닫습니다
LOG [Shutdown] HTTP 서버까지 닫았습니다(2ms) - 프로세스를 종료합니다
```

볼 것은 셋이다.

- **걸린 시간**: 1초 안쪽이면 스스로 끝난 것이고, 10초 언저리면 Docker가 기다리다 강제로 죽인 것이다.

- **종료 코드**: `137`이면 `SIGKILL`로 강제 종료된 것이다. `0`(스스로 끝남)이나 `143`(`SIGTERM`으로 끝남)은 정리를 마치고 끝난 것이다. 어느 쪽이 나오는지는 아래 "각각 따로 고쳐 보기"에서 본다.

- **로그**: `메일 워커 종료`, `리더 연결 종료`, `[Shutdown]` 두 줄이 찍혔는지 본다.

훅을 다 넣었으니 1초 안에 `0`으로 끝날 것 같지만, 실제로는 10초 뒤 `137`로 끝난다. 왜 그런지는 아래 깨뜨려보기 ④에서 본다.

### 용어 | NestJS API (종료 훅)

- `app.enableShutdownHooks()`: 종료 시그널을 받으면 아래 종료 훅들을 차례로 부르게 한다.

- 종료 훅의 순서: ① 모든 `onModuleDestroy`(타이머 정지, 워커·DB·Redis 연결 닫기) → ② `beforeApplicationShutdown(signal)` → ③ HTTP 서버 닫기 → ④ `onApplicationShutdown`. 아래 "종료 훅 네 단계"에서 다룬다.

### 개념 | 종료 훅 네 단계

Nest의 종료는 "모듈 정리 → 서버 닫기"의 순서로 정해져 있고, 그 사이사이에 끼어들 자리가 훅으로 열려 있다.

이름이 비슷해서 헷갈리지만, 기준은 **HTTP 서버를 닫기 전이냐 후냐**다.

| 순서 | 훅 | 불리는 때 | 이 문서에서 하는 일 |
| --- | --- | --- | --- |
| ① | `onModuleDestroy()` | 가장 먼저, 모든 모듈에서 | 타이머 정지, 워커·DB·Redis 연결 닫기 |
| ② | `beforeApplicationShutdown(signal)` | 모듈 정리가 끝난 뒤, 서버를 닫기 전 | `ShutdownLogger`가 시작 시각을 기록 |
| ③ | (훅 아님) HTTP 서버 닫기 | | 새 연결을 받지 않는다 |
| ④ | `onApplicationShutdown(signal)` | 서버까지 닫은 뒤 | `ShutdownLogger`가 걸린 시간을 기록 |

```ts
// 시그널 없이도 같은 순서로 불린다: 테스트에서 app.close()를 부를 때
await app.close(); // ① → ② → ③ → ④, 이때 signal은 undefined
```

- `ShutdownLogger`의 `signal?: string`이 선택 매개변수인 이유가 이것이다. 시그널로 끝날 때는 `"SIGTERM"`이 오고, `app.close()`로 끝날 때는 아무것도 오지 않는다.

- `enableShutdownHooks()`가 없어도 `app.close()`를 직접 부르면 훅은 돈다. 이 메서드가 하는 일은 `SIGTERM` 같은 시그널을 받았을 때 `app.close()`와 같은 정리를 시작하게 연결하는 것이다.

- 연결이나 타이머를 닫는 일은 대부분 ①에 둔다. ①이 서버를 닫기 전이라는 점이 낳는 문제는 아래 "정리 순서가 남기는 틈"에서 본다.

> 훅은 클래스에 메서드를 만들기만 하면 Nest가 찾아 부른다. `implements OnModuleDestroy` 같은 인터페이스는 이름 오타를 컴파일러가 잡게 해 줄 뿐이다.

### 실험 | 일부러 깨뜨려보기 ④: 정리는 끝났는데 안 죽는다

훅을 넣고 처음 재 본 결과다.

```sh
docker compose --profile app up -d --build
time docker compose stop api
docker compose logs api
```

```text
real 10.24
exit=137        # 128 + 9(SIGKILL): 강제로 죽었다
LOG [LeaderElection] 리더 연결 종료(잠금 해제)
LOG [MailQueue] 메일 워커 종료
LOG [Shutdown] 종료 신호(SIGTERM) - ...
LOG [Shutdown] HTTP 서버까지 닫았습니다(2ms) - ...
```

종료 코드는 `docker compose --profile app ps -a`의 `Exited (137)`로도 보인다.

정리는 2ms 만에 끝났는데, 프로세스는 10초를 버티다 `SIGKILL`로 죽었다. 원인이 두 겹이다.

#### 첫째, PID 1

로그의 `[Nest] 1`이 node의 PID다.

Nest는 정리를 마친 뒤, 자기 시그널 핸들러를 떼어 내고 **같은 시그널을 자기에게 다시 보내서** 끝낸다(`node_modules/@nestjs/core/nest-application-context.js`의 `process.kill(process.pid, signal)`).

핸들러가 없으니 기본 동작인 "종료"가 일어나야 하는데, 0장 개념 2대로 PID 1에게 핸들러 없는 시그널은 버려진다.

#### 둘째, 열린 연결

그래도 이벤트 루프에 남은 일이 없으면 Node는 스스로 끝난다. 끝나지 않았다는 건 무언가 열려 있다는 뜻이다.

`04`의 `MailQueue`는 워커에 `this.connection.duplicate()`로 만든 Redis 연결을 넘겼는데, **BullMQ는 바깥에서 넘겨받은 연결은 닫아 주지 않는다.**

아무도 닫지 않은 그 연결이 프로세스를 붙잡고 있었다.

#### 각각 따로 고쳐 보기

| 조건 | 걸린 시간 | 종료 코드 |
|---|---|---|
| 훅 없음, node가 PID 1 | 10.29초 | 137(강제 종료), 정리 로그 없음 |
| 훅 있음, 연결 누수, node가 PID 1 | 10.24초 | 137 |
| 훅 있음, 연결 누수, `init: true` | 0.25초 | 143(SIGTERM으로 종료) |
| 훅 있음, 누수 고침, node가 PID 1 | 0.30초 | 0(스스로 끝남) |

`init: true`는 Docker가 PID 1 자리에 작은 init 프로그램(tini)을 세우고, 우리 node를 그 자식으로 실행하게 한다. 컨테이너 안에서 `cat /proc/1/comm`을 하면 `docker-init`이 나온다.

init이 시그널을 node에 넘겨 주고, node는 더 이상 PID 1이 아니라서 다시 보낸 `SIGTERM`이 정상적으로 프로세스를 종료합니다.

### 작업 4. 고치기: 둘 다 고친다

#### 워커 연결을 직접 닫기

연결은 직접 만들었으니 직접 닫는다.

지금은 워커에 넘기는 연결을 `new Worker(...)`의 인자 안에서 `this.connection.duplicate()`로 바로 만든다. 이름이 없으니 나중에 닫을 방법이 없다. 이 연결을 필드로 빼서 이름을 붙이고, 종료할 때 함께 닫는다.

고칠 파일은 `src/queue/mail.queue.ts` 하나이고, 바꿀 곳은 네 군데다.

| 순서 | 위치 | 할 일 |
| --- | --- | --- |
| ① | 필드 선언부, `connection` 필드 바로 아래 | `workerConnection` 필드를 새로 넣는다 |
| ② | 생성자의 `new Worker(...)` 세 번째 인자 | `this.connection.duplicate()`를 `this.workerConnection`으로 바꾼다 |
| ③ | 생성자의 `this.connection.on("error", warn)` 바로 아래 | 워커 연결에도 오류 처리를 단다 |
| ④ | `onModuleDestroy`의 마지막 줄 | 두 연결을 함께 닫는다 |

#### 코드 ①: 워커 연결을 필드로

```diff
   private readonly connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
+  // 워커는 job을 기다리는 명령을 쓰므로 연결을 따로 쓴다. 바깥에서 만든 연결은 BullMQ가 닫아 주지 않으므로 직접 닫는다(이 문서 4단계)
+  private readonly workerConnection = this.connection.duplicate();
   private readonly queue = new Queue<OrderEmailJob>(QUEUE_NAME, { connection: this.connection });
```

반드시 `connection` 필드 **아래**에 둔다. 필드는 적힌 순서대로 만들어지므로, 위에 두면 아직 없는 `this.connection`을 `duplicate()`하려다 에러가 난다.

#### 코드 ②: 워커에 그 필드를 넘기기

```diff
     this.worker = new Worker<OrderEmailJob>(
       QUEUE_NAME,
       (job: Job<OrderEmailJob>) => this.mailer.send(job.data.to, `주문 #${job.data.orderId} 확인`, job.attemptsMade + 1),
-      { connection: this.connection.duplicate(), concurrency: Number(process.env.MAIL_CONCURRENCY ?? 5) },
+      { connection: this.workerConnection, concurrency: Number(process.env.MAIL_CONCURRENCY ?? 5) },
     );
```

#### 코드 ③: 워커 연결에도 오류 처리

```diff
     const warn = (err: Error) => this.logger.warn(`Redis 연결 오류: ${err.message}`);
     this.connection.on("error", warn);
+    this.workerConnection.on("error", warn);
     this.queue.on("error", warn);
```

ioredis 연결에 `error` 리스너가 없으면 Redis가 끊겼을 때 `[ioredis] Unhandled error event`가 재연결을 시도할 때마다 로거를 거치지 않고 쏟아진다. `connection`과 같은 처리를 단다.

#### 코드 ④: 종료할 때 두 연결을 함께 닫기

```diff
   async onModuleDestroy() {
-    await this.worker.close();
+    await this.worker.close(); // 처리 중인 job이 끝날 때까지 기다렸다가 닫는다
     this.logger.log("메일 워커 종료");
     await this.queue.close();
-    await this.connection.quit();
+    await Promise.all([this.connection.quit(), this.workerConnection.quit()]);
   }
```

`worker.close()`가 먼저다. 워커가 아직 job을 처리하는 중에 연결부터 닫으면 그 job이 중간에 끊긴다.

#### PID 1 자리에 init 세우기

`docker-compose.yml`의 `api` 서비스에 `init: true` 한 줄을 넣는다. `build`, `ports`와 같은 들여쓰기(공백 4칸)로, `profiles` 바로 아래에 둔다.

```diff
   api:
     build: { context: ., target: runtime }
     profiles: ["app"]
+    # PID 1로 작은 init 프로세스(tini)를 세우고 node는 그 자식으로 실행한다 - 신호 전달과 좀비 프로세스 정리를 init이 맡는다(이 문서 4단계)
+    init: true
     ports:
       - "4000:4000"
```

YAML에서 같은 들여쓰기의 키는 순서가 의미가 없어서, `api` 아래 어디에 둬도 동작은 같다. 틀리기 쉬운 건 들여쓰기다. `environment` 안쪽(공백 6칸)에 넣으면 서비스 설정이 아니라 환경변수 목록의 한 줄로 읽혀서 init은 서지 않는다.

정해진 순서는 없지만, 흔히 **무엇을 띄우나**(`image`/`build`) → **어떻게 실행하나**(`init`, `restart`, `user`) → **바깥과 어떻게 잇나**(`ports`, `environment`, `volumes`) → **언제 뜨고 건강한가**(`depends_on`, `healthcheck`) 순으로 적는다. `init`은 실행 방식이라 `build` 근처에 둔다.

#### 다시 재 보기

```sh
docker compose --profile app up -d --build

time docker compose stop api
docker compose stop api  0.06s user 0.07s system 24% cpu 0.520 total

docker compose --profile app ps -a
NAME                       IMAGE                    COMMAND                   SERVICE   CREATED              STATUS                          PORTS
order-api-nest-api-1       order-api-nest-api       "docker-entrypoint.s…"   api       About a minute ago   Exited (143) 30 seconds ago     
order-api-nest-db-1        postgres:17              "docker-entrypoint.s…"   db        43 minutes ago       Up 43 minutes (healthy)         0.0.0.0:5433->5432/tcp
order-api-nest-migrate-1   order-api-nest-migrate   "docker-entrypoint.s…"   migrate   About a minute ago   Exited (0) About a minute ago   
order-api-nest-redis-1     redis:7                  "docker-entrypoint.s…"   redis     2 hours ago          Up 2 hours                      0.0.0.0:6380->6379/tcp
order-api-nest-storage-1   rustfs/rustfs:latest     "/entrypoint.sh rust…"   storage   2 hours ago          Up 2 hours                      0.0.0.0:9000-9001->9000-9001/tcp

docker compose logs api | tail -n 20
...
LOG [LeaderElection] 리더가 됐다(pid 6, PORT 4000)
LOG [LeaderElection] 리더 연결 종료(잠금 해제)
LOG [MailQueue] 메일 워커 종료
LOG [Shutdown] 종료 신호(SIGTERM) - 모듈 정리를 마쳤습니다. HTTP 서버를 닫습니다
LOG [Shutdown] HTTP 서버까지 닫았습니다(2ms) - 프로세스를 종료합니다
```

### 개념 | 정리 순서가 남기는 틈

Dockerfile의 `CMD`를 `["npm", "run", "start:prod"]`가 아니라 `["node", ...]`로 쓴 것도 같은 이유다.

중간에 npm이나 셸(`sh -c`)이 끼면 그 프로세스가 PID 1이 되고, 시그널이 node까지 제대로 가는지는 그 프로그램에 달려 있게 된다.

로그 순서도 눈여겨본다. Nest는 모듈 정리(`onModuleDestroy`)를 HTTP 서버를 닫기 전에 한다.

그 짧은 사이에 들어온 요청은 이미 닫힌 DB 연결을 만날 수 있다.

> 그래서 운영에서는 끄기 전에 먼저 로드밸런서가 이 인스턴스로 트래픽을 보내지 않게 하고(3단계의 readiness가 그 신호가 된다), 그다음에 `SIGTERM`을 보내는 순서를 쓴다.

### 남길 것

- **찾아보면 되는 것**: 종료 훅 네 단계의 이름과 순서, `init: true`, 종료 코드 `128 + 시그널 번호`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 정리 로그가 다 찍혔는데 프로세스가 안 끝나면 원인은 둘 중 하나다. PID 1이라 시그널이 버려졌거나, 아무도 닫지 않은 연결이 이벤트 루프를 붙잡고 있다.

  - 라이브러리에 바깥에서 만든 연결을 넘기면, 그 연결을 닫는 것도 내 몫이다.

  - `init: true`로 띄우면 정상 종료도 `Exited (143)`이다. 문제는 10초 가까이 걸리고 `137`이 나올 때다.

  - Nest는 모듈의 `providers`·`controllers`·`imports`에 적힌 것만 만든다. 이 모듈이 만드는 것은 `providers`에, 다른 모듈이 만든 것은 그 모듈을 `imports`해서 쓴다.

- **에러 신호**:

  - `docker stop`이 10초 걸리고 `Exited (137)`, 정리 로그는 다 찍혔다 → PID 1(`init: true`)과 닫지 않은 연결

  - `Exited (137)`이고 정리 로그가 하나도 없다 → `main.ts`의 `app.enableShutdownHooks()`

  - `ShutdownLogger`의 로그가 안 찍힌다 → `app.module.ts`의 `providers`에 `ShutdownLogger`가 있는지

## 6. 5단계: 구조화 로그

지금까지의 로그는 `[Nest] 1 - 10/04/2025 ... LOG [OrdersService] 결제 완료: ...` 같은 사람용 문장이었다.

서버가 여러 대고 하루에 수십만 줄이 쌓이면, "이 요청 하나의 로그만 모아 보기"가 불가능하다.

로그를 **JSON 한 줄**로 남기고 요청마다 ID를 붙인다.

### 작업 1. 패키지 설치

```sh
# nestjs-pino: Nest의 로거를 pino(빠른 JSON 로거)로 바꾸고, 요청마다 로그를 남기는 pino-http를 붙여 준다
npm install nestjs-pino pino pino-http
# pino-pretty: 개발 중에 JSON 로그를 사람이 읽기 좋게 바꿔 보여 준다
npm install -D pino-pretty
```

### 작업 2. LoggerModule 등록하기

`app.module.ts`의 최종 모습이다. 3·4단계에서 더한 `HealthModule`, `ShutdownLogger`에 `LoggerModule`이 더해졌다.

```ts
// src/app.module.ts
// import 두 줄(randomUUID, LoggerModule)과 imports 배열 맨 앞의 LoggerModule.forRoot(...)를 추가한다
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ShutdownLogger } from './shutdown-logger.js';
// ... 나머지 모듈 import 그대로 ...
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    // 요청마다 JSON 한 줄로 로그를 남긴다(pino). 개발 중에는 사람이 읽기 좋게 색을 입혀 보여 준다
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        // 요청 ID: 들어온 X-Request-Id가 있으면 그대로, 없으면 새로 만든다. 응답 헤더에도 돌려준다
        genReqId: (req, res) => {
          const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
          res.setHeader("X-Request-Id", id);
          return id;
        },
        // 로그에 남으면 안 되는 값을 가린다(이 문서 5단계)
        redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty", options: { singleLine: true } },
      },
    }),
    PrismaModule, StorageModule, HealthModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

`transport`가 `NODE_ENV`를 보는 데에는 이유가 있다. `pino-pretty`는 `-D`로 설치한 개발 의존성이라 운영 이미지(`npm ci --omit=dev`)에는 없다.

운영 이미지는 Dockerfile의 `ENV NODE_ENV=production` 덕분에 `transport`가 `undefined`가 되어 `pino-pretty`를 찾지 않는다. 이 조건이 없으면 운영 컨테이너가 `unable to determine transport target for "pino-pretty"` 같은 에러로 뜨지 못한다.

### 작업 3. main.ts에서 pino 로거 쓰기

`main.ts`의 최종 모습이다. 4단계의 `enableShutdownHooks()` 앞에 pino 두 줄이 붙었다.

줄이 늘어났으니 `bootstrap()` 안을 역할별로 묶어 둔다. Nest가 순서를 강제하는 건 아니지만, 아래 순서가 흔히 쓰는 모양이다.

```ts
// src/main.ts
// import 한 줄과 bootstrap 맨 앞의 세 줄(create의 bufferLogs, useLogger, enableShutdownHooks)이 이 문서에서 더한 곳이다
// 나머지 줄은 내용은 그대로이고, 역할별로 묶어 순서만 정리했다
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter.js';
import { RedisIoAdapter } from './redis/redis-io.adapter.js';

async function bootstrap() {
  // 1. 앱 만들기와 앱 자체의 동작
  // bufferLogs : pino 로거가 준비될 때까지 부팅 로그를 모아 뒀다가 pino로 내보낸다
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Nest의 Logger(new Logger(...)로 쓰던 것)가 전부 pino로 나가게 한다
  app.useLogger(app.get(Logger));
  // SIGTERM(docker stop, 배포 교체)을 받으면 onModuleDestroy들을 돌고 정상 종료한다(이 문서 4단계)
  app.enableShutdownHooks();

  // 2. 미들웨어: 라우팅 전에 모든 요청이 거친다(적은 순서대로 거친다). enableCors도 안에서 cors 미들웨어를 단다
  app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
  app.use(cookieParser());

  // 3. Nest 전역 설정: 미들웨어가 아니다. 라우팅이 끝나 어느 핸들러로 갈지 정해진 뒤에 걸린다
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

  // 4. WebSocket 어댑터
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(process.env.REDIS_URL!);
  app.useWebSocketAdapter(redisIoAdapter);

  // 5. 마지막에 요청 받기 시작
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

2번과 3번은 둘 다 "요청이 컨트롤러에 닿기 전"에 돌지만 층이 다르다.

```text
요청 → [미들웨어: cors → cookieParser] → 라우팅(어느 핸들러인지 결정)
     → [가드] → [인터셉터] → [파이프: ValidationPipe] → 컨트롤러 메서드
     → (예외가 나면) [예외 필터: PrismaExceptionFilter] → 응답
```

- **미들웨어**는 Express 층에서 돈다. 아직 어느 컨트롤러로 갈지 모르는 상태라, 모든 요청에 똑같이 걸린다. `req`, `res`를 직접 만진다.

- **파이프, 필터, 가드, 인터셉터**는 Nest 층에서 돈다. 어느 핸들러로 갈지 안 뒤라, 핸들러의 파라미터 타입(DTO)이나 데코레이터를 보고 동작할 수 있다. `ValidationPipe`가 DTO를 검사할 수 있는 이유다.

순서가 실제로 결과를 바꾸는 곳은 세 군데다.

- **`listen`은 맨 끝**: `listen`이 모듈을 초기화하고 요청을 받기 시작한다. 그 뒤에 적은 설정은 이미 요청을 받는 중에 붙거나, 전역 파이프나 WebSocket 어댑터처럼 초기화 때 읽히는 것은 아예 반영되지 않는다.

- **`enableShutdownHooks`는 앞쪽**: 시그널 핸들러를 다는 시점부터 종료 요청을 받는다. `listen` 뒤에 두면 Redis 연결이나 `listen`을 기다리는 동안 온 `SIGTERM`은 정리 없이 처리된다.

- **`app.use`끼리는 적은 순서대로 돈다**: 미들웨어는 적은 순서대로 요청을 거친다. 지금은 `cors`와 `cookieParser`가 서로 영향을 주지 않아 바꿔도 같지만, 인증처럼 쿠키를 읽는 미들웨어를 붙인다면 `cookieParser` 뒤에 둔다.

`Logger`를 `@nestjs/common`이 아니라 `nestjs-pino`에서 가져온다. 이름이 같아서 import를 잘못 고르기 쉽다.

`01`부터 써 온 `new Logger(OrdersService.name)` 코드는 하나도 고치지 않는다. 출력 대상만 pino로 바뀐다.

### 작업 4. 요청 ID 확인하기

코드를 바꿨으니 `api`를 다시 띄운 뒤에 확인한다. 4단계에서 `docker compose stop api`로 멈춘 채라면 `api`가 떠 있지 않다.

```sh
# 바뀐 코드로 api 이미지를 다시 만들어 띄운다(호스트에서 npm run start:dev로 띄워도 된다)
docker compose --profile app up -d --build api

# -D -: 응답 헤더를 화면에 찍는다 / -o /dev/null: 본문은 버린다 / -sS: 진행 표시는 숨기고 에러는 보인다
curl -sS -D - -o /dev/null localhost:4000/products | grep -i x-request-id
X-Request-Id: 66925b2c-2b11-4c27-b35b-76584ed91a9c
```

아무것도 안 나오면 원인은 둘 중 하나다.

- `curl: (7) Failed to connect`가 보인다 → 4000번에 아무도 없다. `docker compose --profile app ps`로 `api`가 떠 있는지 본다. `-s`만 쓰면 이 에러까지 숨겨져서 빈 화면만 남는다.

- 에러 없이 빈 화면 → 서버는 응답했지만 헤더가 없다. `grep` 없이 `curl -sS -D - -o /dev/null localhost:4000/products`로 헤더 전체를 보고, `genReqId`의 `res.setHeader`가 들어갔는지, 이미지를 `--build`로 다시 만들었는지 확인한다.

#### 요청 ID로 한 요청의 로그만 골라 보기

요청 ID가 쓸모 있는 건 로그를 거를 때다. 결제 요청 하나에 ID를 직접 붙여 보내고, 그 ID로 로그를 걸러 본다.

컨테이너의 `api`는 `NODE_ENV=production`이라 로그가 JSON 한 줄씩 나간다(`pino-pretty`를 거치지 않는다).

```sh
# 1. 로그인해서 액세스 토큰을 받는다(컨테이너의 DEMO_PASSWORD는 compose에 적은 "1234")
TOKEN=$(curl -sS -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 2. 결제 요청에 X-Request-Id를 직접 붙여 보낸다. 상품 1번이 없으면 있는 상품 ID로 바꾼다
curl -sS -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'X-Request-Id: pay-001' \
  -d '{"items":[{"productId":1,"quantity":1}]}'

# {"id":10,"user":"kim","price":150000,"paid":true,"items":[{"productId":1,"quantity":1,"unitPrice":150000}]}

# 3. api 로그에서 그 ID가 붙은 줄만 거른다(--no-log-prefix: 줄 앞의 컨테이너 이름을 뗀다)
docker compose logs api --no-log-prefix | grep pay-001
```

실제 줄에는 `level`, `time`, `req`, `res` 같은 필드가 더 있다. 아래는 볼 필드만 추린 것이다.

```text
{"msg":"결제 완료: #6 (kim) 30000원","context":"OrdersService","reqId":"pay-001"}
{"msg":"request completed","reqId":"pay-001"}
```

- 첫 줄은 `OrdersService`의 `this.logger.log("결제 완료: ...")`가 남긴 우리 로그다.

- 둘째 줄은 pino-http가 응답을 보낸 뒤 자동으로 남기는 요청 로그다.

- 주문 번호(`#6`)와 금액은 DB 상태에 따라 다르다. 두 줄 모두 `reqId`가 `pay-001`이면 된다.

우리 코드가 남긴 `결제 완료` 로그에도 **같은 요청 ID**가 붙었다. nestjs-pino가 요청이 진행되는 동안의 모든 로그에 그 요청의 정보를 자동으로 달아 준다.

> 프론트나 앞단의 프록시가 `X-Request-Id`를 만들어 보내면, 그 ID 하나로 여러 서버의 로그를 이어 볼 수 있다.

### 용어 | nestjs-pino API

- `genReqId(req, res)`: 요청마다 붙일 ID를 정한다. 반환값이 그 요청의 모든 로그에 `reqId`로 붙는다.

- `redact: [경로, ...]`: 그 경로에 있는 값을 로그에 `[Redacted]`로 바꿔 남긴다. 경로를 쓰는 법은 아래 "`redact` 경로"에서 다룬다.

- `transport`: 로그를 다른 형식으로 바꿔 내보낼 대상이다. 운영에서는 `undefined`로 두어 JSON 그대로 낸다.

- `bufferLogs: true`: pino 로거가 준비될 때까지 부팅 로그를 모아 뒀다가 pino로 내보낸다.

- `app.useLogger(app.get(Logger))`: Nest의 `Logger`(`new Logger(...)`로 쓰던 것)가 전부 pino로 나가게 한다.

### 개념 | 요청 ID가 인자 없이 따라오는 이유

`OrdersService`는 싱글턴이라 동시에 들어온 요청들이 같은 인스턴스 하나를 같이 쓴다. `02`에서 본 대로, 요청마다 다른 값을 필드에 넣으면 `await` 사이에 덮어써진다.

그런데 `this.logger.log("결제 완료: ...")`에는 요청 ID를 넘긴 적이 없는데도 그 요청의 `reqId`가 정확히 붙었다.

nestjs-pino는 요청이 들어올 때 미들웨어에서 Node의 `AsyncLocalStorage`로 "이 요청의 로거"를 담아 둔다.

`AsyncLocalStorage`에 담은 값은 그 요청에서 시작된 비동기 흐름(`await`, 콜백) 전체를 따라간다. 다른 요청의 흐름과는 섞이지 않는다.

C로 치면 스레드마다 따로 있는 `thread_local` 변수와 비슷하다. 다만 기준이 스레드가 아니라 "이 요청에서 이어진 비동기 호출 사슬"이다.

- 그래서 요청과 상관없이 시작된 일의 로그에는 `reqId`가 없다. 서버가 켜질 때 `onApplicationBootstrap`에서 돌기 시작한 `OutboxRelay`나 `LeaderElection`의 타이머가 그렇다.

- 요청 하나에서 시작해 큐를 거쳐 다른 곳에서 이어지는 일을 같은 ID로 묶으려면, ID를 데이터에 직접 실어 보내야 한다. 6단계의 도전 과제 2가 추적 정보로 그 일을 한다.

### 개념 | `redact` 경로

`redact`의 각 항목은 **로그로 나가는 JSON 객체 안의 위치**를 JS 속성 접근 문법으로 적은 것이다.

pino-http는 요청을 `req`, 응답을 `res`라는 키 아래에 남기므로, 요청의 `Authorization` 헤더는 `req.headers.authorization`에 있다.

```ts
const log = pino({ redact: ["req.headers.authorization", 'res.headers["set-cookie"]'] });
log.info({ req: { headers: { authorization: "Bearer abc", host: "x" } }, res: { headers: { "set-cookie": "rt=1" } } }, "done");
// 출력: {"level":30,...,"req":{"headers":{"authorization":"[Redacted]","host":"x"}},"res":{"headers":{"set-cookie":"[Redacted]"}},"msg":"done"}
```

- 경로는 대소문자를 구분한다. `req.headers.Authorization`으로 적으면 아무것도 가려지지 않는다. Node는 들어온 요청의 헤더 이름을 전부 소문자로 바꿔 두므로(`req.headers["x-request-id"]`도 그래서 소문자다), 경로도 소문자로 적는다.

- `set-cookie`처럼 `-`가 든 이름은 이 문서처럼 `["set-cookie"]`로 감싸 적으면 JS의 속성 접근과 똑같이 읽힌다.

- `{ paths: [...], remove: true }`로 주면 `[Redacted]`로 바꾸는 대신 키 자체를 지운다. 이 문서는 기본값을 써서, 값은 숨기되 "그 헤더가 있었다"는 흔적은 남긴다.

> 경로가 틀려도 pino는 에러를 내지 않고 그냥 아무것도 가리지 않는다. 그래서 `redact`를 넣은 뒤에는 아래 깨뜨려보기처럼 실제 로그를 한 번 눈으로 확인한다.

### 실험 | 일부러 깨뜨려보기 ⑤: `redact`를 빼면

`app.module.ts`의 `redact` 줄을 잠깐 지우고, 로그인과 토큰을 실은 요청을 보낸 뒤 로그에서 헤더 값만 뽑아 보면 이렇다.

```text
leak-1 authorization: Bearer eyJhbGciOiJIUzI1NiIsInR…
leak-2 set-cookie: refresh_token=92vgoJhH91_3Zx4vFHo1y1LipK…
```

pino-http는 기본으로 요청·응답 헤더를 통째로 남긴다. `03`에서 그렇게 지킨 액세스 토큰과 httpOnly 쿠키의 refresh token이 **로그 파일에 그대로** 찍혔다.

로그는 보통 코드보다 훨씬 많은 사람과 시스템(로그 수집 서비스, 장애 분석 담당자)이 본다. httpOnly가 막아 준 XSS보다 훨씬 쉬운 유출 경로다.

`redact` 줄을 되살려 원복하면 `"authorization":"[Redacted]"`로 바뀐다.

### 남길 것

- **찾아보면 되는 것**: `LoggerModule.forRoot`의 `pinoHttp` 옵션(`genReqId`, `redact`, `transport`), `bufferLogs`, `redact`의 `remove` 옵션. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 로그는 기계가 읽는 JSON 한 줄로, 요청 ID를 붙여 남긴다. 그래야 수십만 줄 속에서 요청 하나를 모을 수 있다.

  - 로그는 코드보다 많은 사람이 본다. 헤더를 통째로 남기는 라이브러리라면 토큰·쿠키를 가리는 것이 기본이고, 가렸는지는 실제 로그로 확인한다(경로가 틀려도 에러가 나지 않는다).

- **에러 신호**:

  - 로그에 `authorization: Bearer ...`가 그대로 찍힌다 → `redact` 경로(소문자, `req.`/`res.` 아래)

  - 로그가 여전히 `[Nest] 1 - ... LOG [...]` 형식이고 `reqId`가 없다 → `main.ts`의 `app.useLogger(app.get(Logger))`, `Logger`를 `nestjs-pino`에서 가져왔는지

  - 운영 컨테이너가 `unable to determine transport target for "pino-pretty"`로 뜨지 않는다 → `NODE_ENV=production`인지, `transport` 조건

  - 부팅 초반의 `InstanceLoader ...` 로그만 `[Nest]` 형식이고 그 뒤는 pino 형식이다 → `NestFactory.create`의 `{ bufferLogs: true }`

  - `curl ... | grep -i x-request-id`가 빈 화면이다 → `-sS`로 다시 보고, `Failed to connect`면 `api`가 떠 있는지

## 7. 6단계: 분산 추적

### 작업 1. 패키지 설치와 Jaeger 추가

```sh
# OpenTelemetry: 추적·지표·로그를 남기는 표준. sdk-node는 Node용 본체, auto-instrumentations-node는 http·express·pg·ioredis 등을 자동으로 계측하는 묶음
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation
```

추적 기록을 받아 보여 줄 Jaeger를 compose에 추가한다. `profiles`가 없으므로 평소의 `docker compose up -d`로도 뜬다.

```yaml
# docker-compose.yml
# services에 추가한다
  # jaeger: 분산 추적 기록을 받아 저장하고 보여 주는 서버(6단계). 브라우저로 http://localhost:16686
  jaeger:
    image: jaegertracing/jaeger:latest
    ports:
      - "16686:16686" # 웹 화면
      - "4318:4318" # OTLP(HTTP) 수신 - 앱이 추적 기록을 여기로 보낸다
```

### 작업 2. 계측 설정 파일 만들기

계측은 **우리 앱 코드보다 먼저** 시작해야 한다.

OpenTelemetry는 `pg`, `express` 같은 라이브러리가 불러와지는 순간 그 함수들을 감싸서(시작·끝 시각을 기록하는 코드로 바꿔 끼워서) 동작하기 때문이다.

이미 불러온 뒤에는 끼어들 수 없다. 그래서 별도 파일로 만들고 `--import`로 먼저 불러온다.

```ts
// src/instrumentation.ts
// 앱 코드보다 "먼저" 실행되어야 하는 파일. node --import ./dist/instrumentation.js dist/main.js 로 띄운다
// OpenTelemetry는 http, express, pg, ioredis 같은 라이브러리를 불러올 때 끼어들어(계측) 각 호출의 시작·끝을 기록한다
// → 그래서 그 라이브러리들이 불러와지기 전에 이 설정이 끝나 있어야 한다
import { register } from "node:module";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

// ESM의 import에도 끼어들 수 있게 하는 로더 훅(CommonJS의 require만 계측하면 우리 앱의 import는 못 잡는다)
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "order-api",
  // 추적 기록을 OTLP(표준 형식)로 Jaeger에 보낸다. 기본 주소는 http://localhost:4318/v1/traces
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // 파일 시스템 호출까지 기록하면 너무 많다
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});
sdk.start();

// 종료할 때 아직 못 보낸 기록을 마저 보낸다
process.once("SIGTERM", () => void sdk.shutdown());
```

`src/` 아래에 두었으므로 `npm run build`가 `dist/instrumentation.js`로 함께 컴파일한다. `main.ts`는 이 파일을 import하지 않는다.

### 작업 3. 추적을 켜고 띄워 결제 한 건 보기

#### 띄우기

이번에는 `api`를 컨테이너가 아니라 **호스트에서** 띄운다. 계측 파일을 고치고 다시 돌려 보기가 쉽기 때문이다. 컨테이너로 띄우는 건 작업 4에서 한다.

5단계에서 띄운 `api` 컨테이너가 4000번을 쥐고 있으면 호스트의 앱이 `EADDRINUSE`로 뜨지 못하므로, 먼저 멈춘다.

```sh
docker compose stop api # 떠 있지 않으면 아무 일도 안 한다

# start:traced: instrumentation.js를 먼저 불러온 뒤 main.js를 실행하는 스크립트를 package.json에 추가한다
npm pkg set scripts.start:traced="node --env-file=.env --import ./dist/instrumentation.js dist/main.js"

docker compose up -d jaeger # 추적 기록을 받을 서버. 16686(웹 화면), 4318(수신)
npm run build && npm run start:traced
```

`start:traced`는 터미널을 붙잡고 계속 돈다. 아래 결제 요청은 **새 터미널**에서 보낸다.

#### 결제 한 건 보내기

5단계 "요청 ID로 한 요청의 로그만 골라 보기"와 같은 요청이다. 비밀번호는 `.env`의 `DEMO_PASSWORD`(여기서는 `1234`)다.

```sh
TOKEN=$(curl -sS -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -sS -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":1,"quantity":1}]}'

{"id":11,"user":"kim","price":150000,"paid":true,"items":[{"productId":1,"quantity":1,"unitPrice":150000}]}
```

#### 웹 화면에서 보기

Jaeger 화면은 **검색 화면**과 **추적 화면** 두 장이다.

검색 화면(`http://localhost:16686`)은 왼쪽에 검색 조건, 오른쪽에 결과가 있다.

```text
[왼쪽: Search]                 [오른쪽: 결과]
  Service    order-api            점 그래프: 점 하나가 요청 하나(가로 = 요청 시각, 세로 = 걸린 시간)
  Operation  POST /orders/...     그 아래 목록: "order-api: POST /orders/checkout  32 Spans" 같은 줄
  Lookback   Last Hour            줄을 누르면 추적 화면이 열린다
  [Find Traces]
```

1. **Service**에서 `order-api`를 고른다. 목록에 없으면 몇 초 뒤 새로 고친다. 추적 기록은 모아서 보내므로(기본 5초 간격) 요청 직후에는 아직 도착하지 않았을 수 있다.

2. **Span Name**에서 `POST /orders/checkout`을 고르고 **Find Traces**를 누른다.

3. 오른쪽 목록에서 줄 하나를 누르면 그 요청의 추적 화면이 열린다. 추적 화면은 표 하나로 보면 된다. 한 행이 일 하나이고, 왼쪽은 이름, 오른쪽은 시간 막대다.

    - **행 = span**: "어떤 일 하나의 시작과 끝"이라는 기록이다. HTTP 요청 전체, 미들웨어 하나, SQL 하나가 각각 span이다.

    - **들여쓰기 = 부모-자식**: `▾`를 눌러 접고 펼 수 있다. 핸들러 아래의 `pg.query`들은 그 핸들러 안에서 일어난 쿼리다.

    - **막대의 위치와 길이**: 왼쪽 끝이 시작 시각, 길이가 걸린 시간이다. 긴 막대가 시간을 많이 쓴 곳이다.

    - **행을 누르면** 아래로 상세가 펼쳐진다. **Tags**의 `db.statement`(또는 `db.query.text`)에 실제 SQL이 있다.

#### 글자로 보기

웹 화면 대신 터미널에서 같은 나무를 보려면 Jaeger의 API로 추적을 받아 찍는 스크립트를 쓴다. 이 문서의 나무는 모두 이 스크립트로 찍었다.

```js
// scripts/trace-tree.mjs
// Jaeger에서 order-api의 가장 최근 추적 하나를 받아, 웹 화면의 나무를 글자로 찍는다
const JAEGER = process.env.JAEGER_URL ?? "http://localhost:16686";
const operation = process.argv[2] ?? "POST /orders/checkout";

const now = new Date();
const params = new URLSearchParams({
  "query.service_name": "order-api",
  "query.operation_name": operation,
  "query.start_time_min": new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 최근 1시간
  "query.start_time_max": now.toISOString(),
});
const res = await fetch(`${JAEGER}/api/v3/traces?${params}`);
if (!res.ok) {
  console.error(`Jaeger 응답 ${res.status}: 최근 1시간 안에 "${operation}" 추적이 없거나 Jaeger가 떠 있지 않습니다`);
  process.exit(1);
}
const { result } = await res.json();

// 응답은 OTLP 형식이다: resourceSpans → scopeSpans → spans. 여러 추적의 span이 섞여 있으니 traceId로 묶는다
const spans = result.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const traces = Map.groupBy(spans, (s) => s.traceId);
const roots = spans.filter((s) => !s.parentSpanId);
const latestRoot = roots.reduce((a, b) => (BigInt(a.startTimeUnixNano) > BigInt(b.startTimeUnixNano) ? a : b));
const trace = traces.get(latestRoot.traceId);

// 어디서 나온 추적인지(호스트 이름). 컨테이너라면 컨테이너 ID가 나온다
const resource = result.resourceSpans.find((r) => r.scopeSpans.some((s) => s.spans.includes(latestRoot))).resource;
const host = resource.attributes.find((a) => a.key === "host.name")?.value.stringValue;
console.log(`host: ${host}`);

const t0 = BigInt(latestRoot.startTimeUnixNano);
const ms = (ns) => (Number(ns) / 1e6).toFixed(1);
const children = Map.groupBy(trace, (s) => s.parentSpanId ?? "");
const sqlOf = (s) => s.attributes?.find((a) => a.key === "db.statement" || a.key === "db.query.text")?.value.stringValue;

function print(span, depth) {
  const start = `+${ms(BigInt(span.startTimeUnixNano) - t0)}ms`.padStart(9);
  const dur = `(${ms(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano))}ms)`;
  const sql = sqlOf(span);
  console.log(`${start} ${"  ".repeat(depth)}${span.name}  ${dur}${sql ? `  ${sql.replace(/\s+/g, " ").slice(0, 70)}` : ""}`);
  const kids = (children.get(span.spanId) ?? []).sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1));
  for (const k of kids) print(k, depth + 1);
}
print(latestRoot, 0);
console.log(`span 수: ${trace.length}`);
```

```sh
# 새 터미널에서, 결제 요청을 보낸 뒤 몇 초 기다렸다가
node scripts/trace-tree.mjs
```

웹 화면의 각 행이 한 줄로 나온다.

- 맨 앞의 `+숫자ms`는 요청이 시작된 뒤 그 일이 시작된 시각이고, 괄호 안은 걸린 시간이다. 웹 화면의 막대 위치와 길이를 숫자로 적은 것이다.

- 들여쓰기가 부모-자식 관계다.

- SQL span은 실행한 SQL의 앞부분을 붙여 보여 준다.

아래는 결제 흐름에 해당하는 줄만 추린 것이다. 직접 찍으면 `middleware - patched`, `request handler - {/*splat}` 같은 줄이 더 나온다. Express가 미들웨어를 감싼 층까지 기록한 것이라 무시해도 된다.

```text
   +0.0ms POST /orders/checkout  (68.5ms)
   +0.0ms   middleware - cookieParser  (0.0ms)
   +1.0ms   middleware - corsMiddleware  (0.0ms)
   +1.0ms   middleware - jsonParser  (0.2ms)
   +1.0ms   request handler - /orders/checkout  (67.6ms)
   +3.0ms     pg-pool.connect  (0.1ms)
   +4.0ms     pg.query:BEGIN order_api  (0.6ms)  BEGIN
   +5.0ms             pg.query:SELECT order_api  (1.3ms)   SELECT id, name, price, stock FROM products WHERE id = ANY($1) ORDER 
  +11.0ms             pg.query:UPDATE order_api  (1.3ms)  UPDATE "public"."products" SET "stock" = ("public"."products"."stock" 
  +21.0ms             pg.query:INSERT order_api  (1.7ms)  INSERT INTO "public"."orders" ("user_id","price","paid","created_at") 
  +23.0ms             pg.query:INSERT order_api  (1.4ms)  INSERT INTO "public"."order_items" ("order_id","product_id","quantity"
  +25.0ms             pg.query:SELECT order_api  (1.7ms)  SELECT "public"."orders"."id", "public"."orders"."user_id", "public"."
  +28.0ms             pg.query:SELECT order_api  (1.0ms)  SELECT "public"."order_items"."order_id", "public"."order_items"."prod
  +30.0ms             pg.query:INSERT order_api  (0.8ms)  INSERT INTO "public"."outbox_events" ("type","user_id","payload","crea
  +31.0ms             pg.query:COMMIT order_api  (0.9ms)  COMMIT
span 수: 30
```

이 추적에 담긴 span은 모두 30개다. 위에서 빠진 줄도 웹 화면과 `trace-tree.mjs`에서는 다 보인다.

결제가 실제로 하는 일이 SQL 한 줄 단위로, 시간 순서대로 나온다.

- `FOR UPDATE` 쿼리

- 중첩 쓰기가 쿼리 여러 개로 나뉘는 모습(`orders` INSERT 뒤의 `order_items` INSERT와 SELECT 둘)

- outbox INSERT

- 그 모두를 감싼 `BEGIN`/`COMMIT`

쿼리 로그(11단계 진단 3)에서는 `BEGIN`이 찍히지 않았지만, 여기서는 보인다.

### 용어 | OpenTelemetry API

- `register(훅, import.meta.url)`(`node:module`): ESM의 `import`에 끼어드는 로더 훅을 등록한다. 왜 필요한지는 아래 "ESM 계측에 로더 훅이 필요한 이유"에서 다룬다.

- `new NodeSDK({ ... })` / `sdk.start()`: 서비스 이름, 내보낼 곳, 계측할 라이브러리를 정하고 추적을 시작한다.

- `new OTLPTraceExporter()`: 추적 기록을 OTLP(표준 형식)로 Jaeger 같은 수신 서버에 보낸다. 주소는 `OTEL_EXPORTER_OTLP_ENDPOINT` 환경변수로 바꾼다.

- `getNodeAutoInstrumentations(설정)`: http·express·pg·ioredis·pino 등의 자동 계측을 한 번에 켠다. 라이브러리별로 끌 수 있다.

- `sdk.shutdown()`: 아직 못 보낸 기록을 마저 보내고 멈춘다.

### 개념 | ESM 계측에 로더 훅이 필요한 이유

자동 계측은 라이브러리의 함수를 "시작·끝 시각을 기록하고 원래 함수를 부르는" 함수로 바꿔 끼우는 방식이다.

CommonJS에서는 이게 쉽다. `require`가 돌려주는 모듈 객체는 평범한 객체라서, 그 속성을 덮어쓰면 그 뒤로 같은 모듈을 `require`하는 모든 코드가 바뀐 함수를 받는다.

ESM의 `import`가 주는 모듈 네임스페이스는 **읽기 전용**이라 같은 방법이 통하지 않는다.

```js
// cjs.cjs - CommonJS: 모듈 객체의 함수를 바꿔 끼울 수 있다
const fs = require("node:fs");
fs.readFileSync = () => "가짜";
console.log(require("node:fs").readFileSync("x")); // 출력: 가짜

// esm.mjs - ESM: 네임스페이스는 읽기 전용이다
import * as fs from "node:fs";
fs.readFileSync = () => "가짜";
// 실행하면 TypeError: Cannot assign to read only property 'readFileSync' of object '[object Module]'
```

그래서 ESM은 모듈을 **불러오는 단계**에 끼어든다. `register`로 등록한 로더 훅은 이후 `import`되는 모듈의 내용을 우리 코드가 받기 전에 계측된 형태로 바꿔 넘긴다.

C로 비유하면 실행 중에 함수 포인터를 덮어쓰는 대신, 링커 단계에서 심볼을 감싼 함수로 바꿔 거는 것(`ld --wrap`)에 가깝다.

- 두 번째 인자 `import.meta.url`은 첫 번째 인자(`"@opentelemetry/instrumentation/hook.mjs"`)를 어느 위치 기준으로 찾을지 정한다. 이 파일 자리에서 `node_modules`를 찾아 올라간다.

- 훅은 등록한 **뒤에** 불러오는 모듈에만 적용된다. 이미 불러온 모듈은 바꿀 수 없으므로 `--import`로 가장 먼저 실행한다(진단 4에서 순서를 바꿔 본 결과가 있다).

> `"type": "module"`인 이 프로젝트의 `dist`는 ESM이다. `instrumentation.ts`의 주석대로 `require`만 계측해서는 우리 앱의 `import`를 못 잡으므로, `register` 한 줄이 따라붙는다.

### 개념 | 빈 시간은 앱 안에서 쓴 시간이다

그런데 위 추적 나무에서 `UPDATE`가 끝난(+11ms) 뒤 다음 `INSERT`(+36ms)까지 25ms가 비어 있다.

**추적에서 빈 시간은 DB가 아니라 앱 안에서 쓴 시간**이다. 같은 결제를 다섯 번 더 하고 마지막 것을 보면 이렇게 된다.

```text
전체 9.1ms
   +2.0ms pg.query:BEGIN    0.8ms
   ...(SELECT, UPDATE, INSERT, INSERT, SELECT, SELECT, INSERT)
   +8.0ms pg.query:COMMIT   1.1ms
DB 쿼리 합계 6.6ms
```

두 번째부터는 빈 시간이 거의 없다. 첫 요청에는 서버가 켜진 뒤 처음 하는 일들(커넥션 준비, 코드 최적화, Prisma 쿼리 준비 등)의 비용이 섞인다.

> 그래서 응답 시간은 한 번이 아니라 여러 번을 재서 본다.

### 개념 | 로그와 추적 잇기

`getNodeAutoInstrumentations`에는 pino 계측도 들어 있어서, 추적이 켜진 상태의 로그에는 `trace_id`가 자동으로 붙는다.

```text
{"msg":"결제 완료: #13 (kim) 30000원","reqId":"ctr-1","trace_id":"c2c5ff7e10255d97d7f6d40ae357b049"}
```

로그에서 이상한 줄을 찾으면 그 `trace_id`로 Jaeger에서 해당 요청의 전체 나무를 연다(`http://localhost:16686/trace/<trace_id>`).

반대로 느린 추적을 찾으면 그 `trace_id`로 로그를 거른다.

### 작업 4. 컨테이너에서도 추적하기

Dockerfile의 `CMD`와 compose의 환경변수를 바꾼다.

```dockerfile
# Dockerfile
# runtime 단계 마지막의 CMD를 이렇게 바꾼다
# --import : 앱보다 먼저 추적(OpenTelemetry) 설정을 불러온다(이 문서 6단계)
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]
```

```yaml
# docker-compose.yml
# api의 environment에 추가한다
      OTEL_SERVICE_NAME: order-api
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318 # 추적 기록을 보낼 곳(컨테이너 안의 주소)
```

`OTLPTraceExporter`는 이 주소 뒤에 `/v1/traces`를 붙여 보낸다. 컨테이너 안에서 기본값 `localhost:4318`은 `api` 컨테이너 자신이라 아무 데도 닿지 않는다.

#### 컨테이너로 띄우기

작업 3에서 호스트에 띄운 `npm run start:traced`가 아직 돌고 있으면 4000번을 쥐고 있어 `api` 컨테이너가 포트를 열지 못한다. 그 터미널에서 `Ctrl+C`로 먼저 끈다.

```sh
docker compose --profile app up -d --build # CMD가 바뀌었으니 --build로 이미지를 다시 만든다
docker compose --profile app ps            # api가 (healthy)가 될 때까지 본다
```

#### 컨테이너에서 나온 추적인지 확인하기

작업 3과 같은 방법으로 결제를 한 번 보내고(로그인 → `/orders/checkout`), 몇 초 뒤 추적을 찍는다.

```sh
TOKEN=$(curl -sS -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -sS -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":1,"quantity":1}]}'

node scripts/trace-tree.mjs
host: 3f2a9c1d7e4b       # 컨테이너 ID. 호스트에서 띄웠을 때는 맥의 이름(예: macbook_air)이 나왔다
   +0.0ms POST /orders/checkout  (...)
   ...
```

`host`가 컨테이너 ID로 바뀌었으면 컨테이너의 앱이 보낸 추적이 같은 Jaeger에 도착한 것이다. 컨테이너 ID는 `docker compose --profile app ps -q api`의 앞 12자리와 같다.

웹 화면에서는 추적 화면의 맨 위 줄(`order-api POST /orders/checkout`)을 누르고 **Process**를 펼치면 같은 `host.name`이 보인다.

#### 정상 종료가 그대로인지 확인하기

`instrumentation.ts`는 `SIGTERM`을 받으면 `sdk.shutdown()`으로 남은 기록을 보내는 핸들러를 따로 단다. 이 핸들러가 4단계에서 맞춰 둔 Nest의 정상 종료를 방해하지 않는지 다시 잰다.

```sh
time docker compose stop api
docker compose --profile app ps -a # api 줄의 Exited (숫자)를 본다
```

4단계 "다시 재 보기"와 같게 1초 안쪽(이 문서에서는 0.28초)에 `Exited (143)`으로 끝나면 된다.

`143`은 128 + 15(`SIGTERM`의 번호)로, `SIGTERM`으로 끝났다는 뜻이다. `init: true`라 node가 PID 1이 아니므로, Nest가 정리를 마치고 자기에게 다시 보낸 `SIGTERM`이 그대로 프로세스를 끝낸 것이다. 정상이다.

문제는 10초 가까이 걸리고 `137`(`SIGKILL`)이 나올 때다. 그때는 4단계 깨뜨려보기 ④의 표로 돌아가 원인을 찾는다.

### 남길 것

- **찾아보면 되는 것**: OpenTelemetry 패키지 이름들, `NodeSDK` 옵션, `OTEL_SERVICE_NAME`·`OTEL_EXPORTER_OTLP_ENDPOINT`, Jaeger 화면의 Service·Operation 고르는 법, `scripts/trace-tree.mjs`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 자동 계측은 라이브러리가 불러와지는 순간 끼어든다. 그래서 계측 설정은 앱 코드의 import 순서에 맡기지 않고 `--import`로 항상 가장 먼저 불러온다.

  - 추적 나무에서 span 사이의 빈 시간은 앱 안에서 쓴 시간이다. 첫 요청 하나로 판단하지 않고 여러 번 잰다.

- **에러 신호**:

  - Jaeger의 Service 목록에 `order-api`가 없다 → `--import ./dist/instrumentation.js` 없이 띄웠는지, 컨테이너라면 `OTEL_EXPORTER_OTLP_ENDPOINT`가 `jaeger:4318`인지

  - 로그에 `trace_id`가 없다 → `start:dev`가 아니라 `start:traced`로 띄웠는지, 계측이 다른 import보다 늦게 시작됐는지(진단 4)

  - 첫 결제만 추적에 수십 ms의 빈 시간이 있다 → 서버가 켜진 뒤 첫 요청의 준비 비용이다. 여러 번 잰다

  - `npm run start:traced`가 `EADDRINUSE`로 뜨지 않는다 → `api` 컨테이너가 4000번을 쥐고 있다. `docker compose stop api`

## 8. 7단계: 디버깅

### 진단 1. 컨테이너가 안 뜰 때

```sh
docker compose --profile app ps -a # 상태와 종료 코드. migrate가 Exited (1)이면 api는 아예 시작하지 않는다
docker compose logs migrate # 마이그레이션이 왜 실패했는가
docker compose logs api --since 1m # 최근 1분 로그
docker inspect --format '{{json .State.Health}}' order-api-nest-api-1 # 헬스 체크 기록(최근 결과와 출력)
```

종료 코드는 `128 + 시그널 번호`인 경우가 많다.

- `137`: `SIGKILL`(9)로 강제로 죽은 것이다(4단계, 또는 메모리 초과).

- `143`: `SIGTERM`(15)으로 끝난 것이다.

### 진단 2. 이미지 안에 무엇이 있는가

```sh
docker run --rm --entrypoint sh order-api:runtime -c 'ls -a /app; du -sh /app/node_modules'
docker history order-api:runtime # 층마다 크기. 어느 단계가 크게 만들었는가
docker run --rm --entrypoint sh order-api:runtime -c 'cd /app && npm explain <패키지>' # 왜 들어왔는가
```

비밀이 들어갔는지 의심되면 `ls -a`로 `.env`부터 본다.

> 한 번이라도 레지스트리에 올라간 이미지에 비밀이 있었다면, 이미지를 지우는 것으로는 부족하다. 그 비밀 자체를 바꿔야 한다.

### 진단 3. "컨테이너 안에서는 안 된다"

호스트에서 잘 되던 것이 컨테이너에서만 안 되면, 십중팔구 **주소**다.

- 컨테이너 안에서 `localhost`는 그 컨테이너 자신이다.

- 다른 서비스는 compose의 서비스 이름(`db`, `redis`, `storage`, `jaeger`)과 컨테이너 안의 포트(5433이 아니라 5432)로 찾는다.

- 반대로 브라우저에 나가는 주소(presigned URL)는 호스트 기준이어야 한다(2단계).

### 진단 4. 추적이 안 보일 때

| 증상 | 원인 |
|---|---|
| Jaeger의 Service 목록에 `order-api`가 없다 | 앱을 `--import ./dist/instrumentation.js` 없이 띄웠다. 또는 `OTEL_EXPORTER_OTLP_ENDPOINT`가 틀렸다(컨테이너 안에서 `localhost:4318`) |
| 로그에 `trace_id`가 없다 | 추적 없이 띄운 서버다(`npm run start:dev`). `start:traced`로 띄운다. 또는 계측이 늦게 시작됐다(아래) |

계측을 시작하는 위치에 따라 결과가 달라진다. 이 프로젝트에서 직접 해 본 결과다.

- `main.ts`의 맨 첫 줄에 `import './instrumentation.js';`를 두고 `--import` 없이 띄우면, 결제 추적에 `pg.query`까지 30개 span이 다 잡혔다.

- 같은 줄을 다른 import들 뒤로 옮기면, 로그에 `trace_id`가 붙지 않았다. pino를 포함한 다른 모듈이 계측보다 먼저 불러와졌기 때문이다.

> import 순서는 정리 도구가 자동으로 바꿔 버리기도 한다. 그러니 순서에 기대지 말고 `--import`로 **항상 가장 먼저** 불러온다.

### 진단 5. 에러 코드·증상으로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| 이미지 안에서 `cat /app/.env`가 값을 출력한다 | `COPY . .`이 비밀 파일까지 복사했다 | `.dockerignore`의 `.env` | 1단계 |
| 빌드 중 `Error: ENOENT: no such file or directory, open '.env'` | `.env`를 뺀 빌드에서 Prisma 설정이 파일을 읽으려 했다 | `prisma7.config.ts`의 `existsSync(".env")` | 1단계 |
| `--omit=dev`인데 `prisma`·`typescript`가 이미지에 있다 | 운영 의존성이 선택적 peer dependency로 끌어왔다 | `npm explain <패키지>`(진단 2) | 1단계 |
| `docker stop`이 10초 걸리고 종료 코드 137, 정리 로그는 다 찍혔다 | 시그널이 버려졌거나(PID 1) 열린 연결이 프로세스를 붙잡았다 | `CMD` 형식, `init: true`, 직접 만든 연결을 닫는지 | 1·4단계 |
| `Exited (137)`이고 정리 로그가 하나도 없다 | Nest가 시그널을 받지 않았다 | `main.ts`의 `app.enableShutdownHooks()` | 4단계 |
| `ShutdownLogger`의 로그가 안 찍힌다 | Nest가 그 프로바이더를 만들지 않았다 | `app.module.ts`의 `providers` | 4단계 |
| `init: true`인데 `Exited (143)`, 1초 안에 끝났다 | 정상이다. Nest가 다시 보낸 `SIGTERM`으로 끝났다 | 볼 것 없음. `137`일 때만 문제 | 4단계 |
| `dependency failed to start: container ... has no healthcheck configured` | `service_healthy`로 기다리는데 상대에 `healthcheck`가 없다 | 상대 서비스의 `healthcheck` | 2단계 |
| "DB 다음에 뜨게 했는데 연결이 안 된다" | `depends_on`의 기본값은 "시작됨"만 기다린다 | `condition: service_healthy` | 2단계 |
| `migrate`가 `Exited (1)`이고 `api`가 시작하지 않는다 | 마이그레이션이 실패해 `service_completed_successfully`가 막았다 | `docker compose logs migrate`(진단 1) | 2단계 |
| `getaddrinfo ENOTFOUND storage` | presigned URL에 컨테이너 안의 주소가 들어갔다 | `S3_PUBLIC_ENDPOINT` | 2단계 |
| `② 저장소 PUT → 403 InvalidAccessKeyId` | `endpoint`가 빈 문자열이라 진짜 AWS 주소로 서명됐다 | `??` 대신 `\|\|` | 2단계 |
| 서버는 멀쩡히 뜨는데 `/health`만 404 | 모듈이 `AppModule`의 `imports` 사슬에 없다 | `app.module.ts`의 `HealthModule` | 3단계 |
| `/health`는 200, `/health/ready`는 503 `"redis":"1000ms 초과"` | 그 의존 서비스에 1초 안에 닿지 못했다 | 그 서비스의 상태(`docker compose ps`) | 3단계 |
| `"redis":"Reached the max retries per request limit ..."` | Redis가 막 끊겼고 재접속 1회가 실패했다 | 같은 칸 | 3단계 |
| 컨테이너가 `(unhealthy)` | readiness가 `retries`번 연속 실패했다 | `docker inspect`의 `.State.Health`(진단 1) | 3단계 |
| 로그에 `authorization: Bearer ...`가 그대로 찍힌다 | `redact`가 없거나 경로가 틀렸다(에러는 나지 않는다) | `redact` 경로(소문자, `req.`/`res.` 아래) | 5단계 |
| 로그가 여전히 `[Nest] 1 - ... LOG [...]` 형식, `reqId` 없음 | Nest 로거가 pino로 바뀌지 않았다 | `app.useLogger(app.get(Logger))`, `Logger`의 import 출처 | 5단계 |
| `unable to determine transport target for "pino-pretty"` | 운영 설치에 없는 개발 의존성을 찾았다 | `NODE_ENV=production`, `transport` 조건 | 5단계 |
| 부팅 초반 로그만 `[Nest]` 형식, 그 뒤는 pino | `useLogger` 전의 로그가 기본 로거로 나갔다 | `NestFactory.create`의 `bufferLogs: true` | 5단계 |
| `curl ... \| grep -i x-request-id`가 빈 화면 | `-s`가 연결 에러까지 숨겼거나 헤더가 없다 | `-sS`로 다시, `api`가 떠 있는지 | 5단계 |
| Jaeger의 Service 목록에 `order-api`가 없다 | 계측이 안 켜졌거나 보낼 곳이 틀렸다 | `--import`, `OTEL_EXPORTER_OTLP_ENDPOINT`(진단 4) | 6단계 |
| 로그에 `trace_id`가 없다 | 추적 없이 띄웠거나 계측이 늦게 시작됐다 | `start:traced`, import 순서(진단 4) | 6단계 |
| 첫 결제만 추적에 수십 ms의 빈 시간이 있다 | 서버가 켜진 뒤 첫 요청의 준비 비용 | 여러 번 재서 본다 | 6단계 |
| `start:traced`가 `EADDRINUSE` | `api` 컨테이너가 4000번을 쥐고 있다 | `docker compose stop api` | 6단계 |
| 호스트에서 되던 것이 컨테이너에서만 안 된다 | 컨테이너 안의 `localhost`는 그 컨테이너 자신이다 | 서비스 이름과 컨테이너 안의 포트(진단 3) | 7단계 |
| 종료 코드 137 / 143 | `SIGKILL`(강제 종료, 메모리 초과 포함) / `SIGTERM` | 진단 1 | 7단계 |

> 이미지에 비밀이 들어갔던 것을 발견했다면, 원인을 고치는 것과 별개로 그 비밀부터 바꾼다(진단 2).

### 시험해보기

```sh
docker compose --profile app up -d --build
docker compose --profile app ps -a # api healthy, migrate Exited (0)
curl localhost:4000/health/ready # 셋 다 ok
time docker compose stop api # 1초 안에, exit 143
```

### 도전 과제

#### 1. 컨테이너 두 개로 리더 선출 확인하기

같은 이미지로 `api`를 두 개 띄운다. `docker compose --profile app up -d --scale api=2`는 포트가 겹치므로, 포트를 뺀 두 번째 서비스를 만든다.

`04`의 리더 선출이 컨테이너에서도 동작하는지, 한쪽을 `docker stop`하면 다른 쪽이 리더를 이어받는지 확인한다.

이번에는 `kill -9`가 아니라 정상 종료다. 무엇이 다른지(리더 연결을 직접 닫는다) 로그로 본다.

**답**

두 번째 서비스는 `api`를 물려받고 호스트 포트만 뺀다.

```yaml
# docker-compose.yml
# services에 추가한다
  api2:
    extends: api
    ports: !reset []
```

1. `docker compose --profile app up -d --build`로 띄우면 `api`와 `api2`가 둘 다 `healthy`가 되고, `리더가 됐다` 로그는 한쪽(먼저 잠금을 잡은 `api`)에만 찍힌다.

2. `docker stop`으로 리더(`api`)를 끄면 그쪽 로그에 `리더 연결 종료(잠금 해제)`가 찍히고, 약 1.3초 뒤 `api2`에 `리더가 됐다`가 찍힌다. 남은 쪽이 2초마다 잠금을 다시 시도하기 때문이다.

3. 비교로 `docker kill`(SIGKILL)로 리더를 죽이면 죽은 쪽에는 아무 로그도 남지 않는다. 연결이 끊기면서 잠금이 풀리고, 남은 쪽이 약 1.5초 뒤 리더가 된다.

> 두 컨테이너의 로그는 둘 다 `pid 7, PORT 4000`이다. 컨테이너마다 프로세스 번호와 네트워크가 따로라서 겹치지 않는다. 어느 쪽인지는 compose 로그 앞의 컨테이너 이름(`api-1`, `api2-1`)으로 구분한다.

#### 2. 메일 job까지 하나의 추적으로 잇기

6단계의 추적에는 `04`의 BullMQ 메일 job이 나오지 않는다. 워커의 처리는 자동 계측 대상이 아니라 span이 생기지 않는다.

job을 넣을 때 현재 추적 정보를 job 데이터에 담고, 워커에서 그걸 이어받아 하나의 추적으로 보이게 만들어 본다(OpenTelemetry의 context propagation).

결제 추적이 어떻게 달라지는가?

**답**

1. job을 큐에 넣는 곳은 결제 요청이 아니라 `OutboxRelay`의 0.5초 타이머다. 그때의 "현재 추적"은 결제 요청이 아니므로, `checkout`에서 `propagation.inject(context.active(), trace)`로 `{ traceparent: "00-<trace_id>-<span_id>-01" }`을 꺼내 outbox 행의 `payload`에 함께 적는다.

2. relay는 `payload`에서 `trace`를 떼어 내 알림에는 싣지 않고, 메일 job 데이터에만 넘긴다.

3. 워커는 `propagation.extract(context.active(), job.data.trace ?? {})`로 부모를 만들고, `tracer.startActiveSpan(이름, { kind: SpanKind.CONSUMER }, 부모, ...)`로 span을 열어 메일을 보낸 뒤 닫는다. `@opentelemetry/api`를 의존성에 추가한다(sdk-node가 이미 쓰는 패키지다).

4. 결제를 한 번 하면 결제 추적의 span이 30개에서 31개가 된다. 응답이 끝난 뒤 약 +224ms에 `mail mail process`(약 302ms, `MAIL_DELAY_MS=300`) span이 같은 나무에 붙는다.

> 옮기는 것은 표준 `traceparent` 문자열 하나다. 그래서 HTTP 헤더든 outbox 행이든 큐의 job이든, 담을 곳만 있으면 같은 방법으로 추적을 잇는다.

### 남길 것

- **찾아보면 되는 것**: `docker compose logs`·`docker inspect`·`docker history`의 옵션, 시그널 번호표. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 컨테이너 문제는 먼저 상태와 종료 코드(`ps -a`)를 보고, 그다음 로그를 본다. 종료 코드 137은 "누가 강제로 죽였다", 143은 "SIGTERM으로 끝났다"다.

  - 호스트에서 되는데 컨테이너에서만 안 되면 주소부터 의심한다.

- **에러 신호**:

  - 호스트에서 되던 것이 컨테이너에서만 안 된다 → 서비스 이름과 컨테이너 안의 포트(진단 3)

  - 종료 코드 137 / 143 → 진단 1의 시그널 해석

## 9. 완성 확인

### 체크리스트

- [ ] 운영용 이미지에 `.env`가 없고, root가 아닌 사용자로 돌며, 단순한 이미지보다 작다

- [ ] `--profile app`으로 마이그레이션 → 앱 순서로 뜨고, 업로드 URL이 브라우저가 닿는 주소로 나온다

- [ ] Redis를 끄면 `/health`는 200, `/health/ready`는 503이고, Docker가 일정 시간 뒤 `unhealthy`로 표시한다

- [ ] `docker compose stop api`가 1초 안에 끝나고, 종료 로그가 순서대로 찍힌다. PID 1과 연결 누수가 각각 무엇을 막았는지 설명할 수 있다

- [ ] 로그가 요청 ID가 붙은 JSON 한 줄이고, 토큰과 쿠키는 `[Redacted]`다

- [ ] Jaeger에서 결제 한 건의 SQL까지 내려가는 추적을 보고, 로그의 `trace_id`로 찾아갈 수 있다

## 10. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 단순한 이미지에 `.env`가 들어간 경로는? `.dockerignore`와 다단계 빌드는 각각 무엇을 막는가?

2. `package.json`을 소스보다 먼저 복사하는 이유를 Docker의 층 캐시로 설명하면?

3. 마이그레이션을 앱 시작 코드가 아니라 별도 단계로 돌리는 이유는?

4. liveness와 readiness를 하나로 합치면 DB가 잠깐 끊겼을 때 무슨 일이 생기는가?

5. 훅을 넣었는데도 `docker stop`이 10초 걸렸던 두 가지 이유는? `init: true`는 그중 무엇을 해결하는가?

6. 로그에 요청 ID와 `trace_id`가 붙으면 무엇이 가능해지는가? `redact`를 빼면 무엇이 새는가?

7. 계측 설정을 `--import`로 따로 먼저 불러오는 이유는? `main.ts`의 import 목록 중간에 두면 무엇이 빠졌는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 지표(metrics): 초당 요청 수, 오류율, 응답 시간 분포를 시계열로 모으고 그래프·경보로 만들기(Prometheus, Grafana 등)

- 로그 수집·검색 시스템(여러 서버의 로그를 한곳에 모으기)

- 추적 샘플링(모든 요청을 다 기록하지 않기), 서비스 사이 추적 전파

- 이미지 취약점 검사, 더 작은 베이스 이미지(distroless 등), 이미지 서명

- 비밀 관리 도구(환경변수 대신 런타임에 주입), 설정과 코드의 분리

- 무중단 배포 전략(롤링, 블루-그린)과 마이그레이션 호환성
