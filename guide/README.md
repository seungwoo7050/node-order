# Redis: 서버를 여러 대로: Pub/Sub, 작업 큐, 리더 선출

## 목표

이 프로젝트는 [`03-auth-hardening`](https://github.com/seungwoo7050/node-order/tree/03-auth-hardening)으로부터 시작한다.

지금까지 `order-api-nest`는 한 대로만 돌았다. 서버를 두 대로 늘리는 순간 세 가지가 깨진다.

하나씩 직접 깨뜨리고 고친다.

1. WebSocket 알림은 "그 서버에 붙은 소켓"에만 간다 → 다른 서버에 붙은 사용자는 알림을 못 받는다 → Redis Pub/Sub(socket.io Redis 어댑터)

2. outbox relay 안에서 느리고 가끔 실패하는 일(메일 발송)을 하면 트랜잭션이 시간 초과로 계속 롤백된다 → 작업 큐(BullMQ)

3. 주기적으로 도는 정리 작업이 서버 대수만큼 중복 실행된다 → 리더 선출(PostgreSQL advisory lock). 같은 일을 Redis 락으로 하면 어떻게 다르게 실패하는지도 비교한다

```sh
# 서버 A(4000)로 주문 10개를 만들고, 서버 B(4001)에 붙은 클라이언트가 알림을 몇 개 받는가
node scripts/notify-check.mjs 10 4000 4001
```

```sh
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
```

```sh
# 메일 job이 두 서버의 워커에 나뉘어 처리되고, 전부 끝났다
node scripts/queue-stats.mjs
```

```sh
{ waiting: 0, active: 0, delayed: 0, completed: 30, failed: 0 }
```

> 시작 기준점:  
> `order-api-nest`가 PostgreSQL(`docker compose up -d`)에 붙어 있고, WebSocket 알림 게이트웨이(`NotificationsGateway`), outbox relay(`OutboxRelay`), `refresh_tokens`이 있다.  

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러거나 틀린 숫자다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 6단계에서 "어느 층에서 틀어졌나"를 가르는 절차 | 친다(`redis-cli`, `psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 6단계만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 6단계 "진단 6"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`만 있다. 8·9장은 체크리스트와 자가 점검이라 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | 프로세스 간 메모리, Redis, 작업 큐, 리더 선출을 `fork`·링 버퍼·`flock`에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | 가져온 프로젝트를 되살리고(`npm install`, `prisma generate`), Redis 컨테이너와 패키지·환경변수를 추가하고, 서버 두 대를 띄우는 법을 정한다 |
| [2. 1단계: 일부러 깨뜨려보기 ①, 서버 두 대의 알림](#2-1단계-일부러-깨뜨려보기-①-서버-두-대의-알림) | 서버 A로 만든 주문의 알림이 서버 B의 클라이언트에 일부만 가는 것을 본다 |
| [3. 2단계: Redis 어댑터로 알림을 모든 서버에 퍼뜨리기](#3-2단계-redis-어댑터로-알림을-모든-서버에-퍼뜨리기) | socket.io Redis 어댑터를 끼워 알림이 10/10이 되게 한다 |
| [4. 3단계: 일부러 깨뜨려보기 ②, relay 안에서 메일 보내기](#4-3단계-일부러-깨뜨려보기-②-relay-안에서-메일-보내기) | relay 트랜잭션 안에서 느린 메일을 보내 끝없는 재전송을 만든다 |
| [5. 4단계: BullMQ 작업 큐로 떼어 내기](#5-4단계-bullmq-작업-큐로-떼어-내기) | 메일을 BullMQ 큐로 옮기고 재시도·failed·중복 방지를 확인한다 |
| [6. 5단계: 리더 선출로 정리 작업은 한 대에서만](#6-5단계-리더-선출로-정리-작업은-한-대에서만) | advisory lock으로 리더를 뽑아 토큰 정리를 한 대에서만 돌리고, Redis 락과 비교한다 |
| [7. 6단계: 디버깅](#7-6단계-디버깅) | Redis 채널·큐 키·잠금을 들여다보고, 에러 신호를 표로 가른다 |
| [8. 완성 확인](#8-완성-확인) | 체크리스트 |
| [9. 다음 단계](#9-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | 프로세스가 둘이면 메모리도 둘이다.

C에서 `fork()`를 해 봤다면 안다. 자식 프로세스는 부모의 전역 변수를 복사본으로 받는다.

한쪽에서 바꿔도 다른 쪽에는 보이지 않는다.

둘이 정보를 주고받으려면 파이프나 소켓 같은 프로세스 간 통신(IPC)이 필요하다.

```c
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int counter = 0;  // 전역 변수

int main(void) {
  int fds[2];
  pipe(fds);  // fds[0]: 읽는 쪽, fds[1]: 쓰는 쪽

  if (fork() == 0) {                          // 자식
    counter = 100;                            // 자식의 복사본만 바뀐다
    write(fds[1], &counter, sizeof counter);  // 부모에게 알리려면 IPC로 보내야 한다
    _exit(0);
  }

  wait(NULL);                                 // 자식이 끝날 때까지 기다린다
  printf("부모의 counter: %d\n", counter);

  int received;
  read(fds[0], &received, sizeof received);
  printf("파이프로 받은 값: %d\n", received);
  return 0;
}
```

```sh
부모의 counter: 0
파이프로 받은 값: 100
```

자식이 `counter`를 100으로 바꿨지만 부모의 `counter`는 0 그대로다. 100이라는 값은 파이프를 거쳐서야 부모에게 닿는다.

서버 두 대도 똑같다. WebSocket 게이트웨이의 room(`user:kim` 방에 어떤 소켓이 있는가)은 그 서버 프로세스의 메모리에만 있다.

게이트웨이를 처음 만들 때 "다루지 않은 것"으로 남겨 둔 바로 그 문제다.

서버 A가 `server.to("user:kim").emit(...)`을 해도, `kim`의 소켓이 서버 B에 붙어 있으면 A는 그 소켓을 모른다.

### 개념 2 | Redis: 모두가 같이 쓰는 메모리 서버

Redis는 데이터를 메모리에 두는 키-값 서버다.

서버 A와 B가 각자 Redis에 접속하면, Redis가 두 프로세스가 같이 보는 메모리가 된다. 이 문서에서는 Redis의 기능 두 가지를 쓴다.

- Pub/Sub: 한 프로세스가 채널에 메시지를 발행(`PUBLISH`)하면, 그 채널을 구독(`SUBSCRIBE`)하는 모든 프로세스가 받는다. 여러 프로세스에 한꺼번에 보내는 IPC라고 생각하면 된다.

- 자료구조: 리스트, 정렬 집합, 해시 등. BullMQ는 이걸로 작업 큐를 만든다.

Redis는 명령을 하나씩 차례로 실행한다(단일 스레드). 그래서 명령 하나는 다른 명령과 섞이지 않는다.

> PostgreSQL의 조건부 `UPDATE` 한 문장이 원자적이었던 것과 같은 성질을, Redis 명령은 기본으로 갖는다.

### 개념 3 | 작업 큐: 생산자와 소비자를 떼어 놓는다.

C로 스레드를 써 봤다면 생산자-소비자 패턴을 안다.

생산자 스레드는 할 일을 링 버퍼에 넣고 바로 돌아가고, 소비자 스레드들이 꺼내서 처리한다. 생산자는 처리가 느려도 기다리지 않는다.

```c
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

#define SIZE 8
int buf[SIZE];                 // 링 버퍼
int head = 0, tail = 0, count = 0;
pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t not_empty = PTHREAD_COND_INITIALIZER;
pthread_cond_t not_full = PTHREAD_COND_INITIALIZER;

void push(int job) {
  pthread_mutex_lock(&mu);
  while (count == SIZE) pthread_cond_wait(&not_full, &mu);  // 꽉 찼을 때만 기다린다
  buf[tail] = job; tail = (tail + 1) % SIZE; count++;
  pthread_cond_signal(&not_empty);
  pthread_mutex_unlock(&mu);
}

int pop(void) {
  pthread_mutex_lock(&mu);
  while (count == 0) pthread_cond_wait(&not_empty, &mu);    // 비었으면 일이 올 때까지 잔다
  int job = buf[head]; head = (head + 1) % SIZE; count--;
  pthread_cond_signal(&not_full);
  pthread_mutex_unlock(&mu);
  return job;
}

void *consumer(void *arg) {
  long id = (long)arg;
  for (;;) {
    int job = pop();
    if (job < 0) break;        // 종료 신호
    usleep(100 * 1000);        // 느린 일(메일 발송이라 치자)
    printf("소비자 %ld: 주문 %d 메일 발송\n", id, job);
  }
  return NULL;
}

int main(void) {
  pthread_t c[2];
  for (long i = 0; i < 2; i++) pthread_create(&c[i], NULL, consumer, (void *)i);

  for (int order = 1; order <= 6; order++) {
    push(order);               // 넣고 바로 다음 주문으로 간다
    printf("생산자: 주문 %d 넣음\n", order);
  }
  push(-1); push(-1);          // 소비자마다 종료 신호 하나씩

  for (int i = 0; i < 2; i++) pthread_join(c[i], NULL);
  return 0;
}
```

```sh
생산자: 주문 1 넣음
생산자: 주문 2 넣음
...
생산자: 주문 6 넣음
소비자 1: 주문 1 메일 발송
소비자 0: 주문 2 메일 발송
...
```

생산자의 "넣음" 여섯 줄이 메일 한 통보다 먼저 다 찍힌다. 메일이 한 통에 100ms씩 걸려도 생산자는 그걸 기다리지 않는다. 어느 소비자가 어느 주문을 집는지는 실행할 때마다 다르다.

이 프로그램의 링 버퍼는 한 프로세스의 메모리에 있다. 그래서 개념 1의 한계를 그대로 갖는다. 다른 프로세스는 이 버퍼에 넣을 수도 꺼낼 수도 없고, 프로세스가 죽으면 아직 처리 못 한 주문도 같이 사라진다.

BullMQ는 이 링 버퍼를 Redis에 둔다. 그래서 두 가지가 더 생긴다.

- 생산자와 소비자가 다른 프로세스, 다른 서버여도 된다.

- 프로세스가 죽어도 넣어 둔 일은 Redis에 남는다.

실패한 일을 몇 번, 어떤 간격으로 다시 할지(재시도, backoff)도 큐가 관리한다.

### 개념 4 | 리더 선출: `flock`으로 잠근 PID 파일과 같은 발상

C 데몬이 "같은 프로그램은 하나만 떠야 한다"를 지키는 고전적인 방법이 있다.

`/var/run/app.pid`를 열고 `flock(fd, LOCK_EX | LOCK_NB)`로 잠그는 것이다. 이미 다른 프로세스가 잠갔으면 실패하므로 스스로 종료한다.

잠근 프로세스가 죽으면 커널이 fd를 닫으면서 잠금도 자동으로 풀린다. 그래서 비정상 종료해도 잠금이 영원히 남지 않는다.

```c
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/file.h>

int main(void) {
  int fd = open("/tmp/app.pid", O_RDWR | O_CREAT, 0644);

  if (flock(fd, LOCK_EX | LOCK_NB) == -1) {  // LOCK_NB: 기다리지 않고 바로 실패를 돌려받는다
    printf("이미 다른 프로세스가 돌고 있다. 종료\n");
    return 1;
  }

  ftruncate(fd, 0);
  dprintf(fd, "%d\n", getpid());             // 누가 잠갔는지 기록만 해 둔다
  printf("내가 리더다(pid %d). 정리 작업 시작\n", getpid());

  sleep(30);  // 일하는 중. 여기서 kill -9로 죽여도 커널이 fd를 닫으며 잠금을 푼다
  return 0;   // flock(fd, LOCK_UN)을 부르지 않아도 프로세스가 끝나면 풀린다
}
```

```sh
./leader &    # 내가 리더다(pid 24930). 정리 작업 시작
./leader      # 이미 다른 프로세스가 돌고 있다. 종료
kill -9 %1    # 첫 번째를 강제로 죽인다
./leader      # 내가 리더다(pid 24939). 정리 작업 시작
```

잠금의 주인을 가르는 것은 파일에 적힌 PID가 아니라 커널이 들고 있는 `flock`이다. PID는 사람이 보라고 적어 둔 것이다.

PID만 적고 잠그지 않는 방식은 죽은 프로세스의 PID 파일이 남아 다음 실행을 막는다. 잠금은 프로세스 수명에 묶여 있어서 그런 일이 없다.

PostgreSQL의 advisory lock(권고 잠금)이 서버 여러 대 사이에서 같은 일을 한다. 테이블의 행과 상관없는, "숫자 하나"에 거는 잠금이다.

세션 수준 advisory lock은 그 잠금을 건 DB 연결이 살아 있는 동안 유지되고, 연결이 끊기면 DB가 자동으로 푼다.

5단계에서 이걸로 "서버 여러 대 중 하나만 리더가 되어 정리 작업을 돌린다"를 만든다.

## 1. 준비

### 작업 1. Redis 컨테이너 추가

`docker-compose.yml`에 Redis를 추가한다.

```yaml
# docker-compose.yml
# services 아래, db 다음에 추가한다
  # redis:7 : 공식 Redis 7 이미지. 데이터는 메모리에 두고, 이 예제에서는 디스크 저장을 신경 쓰지 않는다
  redis:
    image: redis:7
    # PC에 이미 Redis가 6379를 쓰고 있을 수 있어서, PC 쪽은 6380으로 피한다(PostgreSQL의 5433과 같은 이유)
    ports:
      - "6380:6379"
```

```sh
cd order-api-nest
docker compose up -d
# redis-cli: Redis의 명령줄 클라이언트(PostgreSQL의 psql에 해당). PING에 PONG이 오면 살아 있다
docker compose exec redis redis-cli PING
PONG
```

### 작업 2. 가져온 프로젝트 되살리기: `npm install`, `prisma generate`

`03-auth-hardening`의 소스를 받아 온 직후라면, 코드는 있어도 그대로는 빌드되지 않는다. `.gitignore`에 들어 있는 두 폴더가 git으로 따라오지 않았기 때문이다.

| 없는 것 | 왜 git에 없나 | 되살리는 명령 |
|---|---|---|
| `node_modules/` | `package.json`·`package-lock.json`만 있으면 언제든 똑같이 다시 받을 수 있다 | `npm install` |
| `src/generated/prisma/` | `prisma/schema.prisma`만 있으면 언제든 다시 만들 수 있다 | `npx prisma generate` |

```sh
# order-api-nest 폴더에서
# package-lock.json에 적힌 버전 그대로 dependencies와 devDependencies를 모두 설치한다
npm install
# prisma/schema.prisma를 읽어 src/generated/prisma/에 PrismaClient 코드를 만든다(DB에는 접속하지 않는다)
npx prisma generate
```

- `npm install`(줄여서 `npm i`)을 인자 없이 치면 `dependencies`와 `devDependencies`를 둘 다 설치한다. 그래서 되살릴 때 `npm i -D`를 따로 칠 필요는 없다.

  `-D`(`--save-dev`)는 **새 패키지를 추가할 때** `devDependencies` 쪽에 적으라는 뜻이다(`npm i -D @types/foo`). 패키지 이름 없이 치면 `npm install`과 같다.

- `package-lock.json`과 정확히 같은 상태를 원하면 `npm ci`를 쓴다. `node_modules`를 지우고 lock 파일대로만 설치하며, `package.json`과 lock 파일이 어긋나면 고치지 않고 에러로 멈춘다.

- `prisma generate`는 `npm install` 때 저절로 돌지 않는다(`@prisma/client`에 postinstall 훅이 없다). `src/prisma/prisma.service.ts`가 `../generated/prisma/client.js`를 import하므로, 이 폴더가 없으면 `npm run build`가 `Cannot find module '../generated/prisma/client.js'`로 멈춘다.

언제 다시 쳐야 하는가:

| 상황 | `npm install` | `npx prisma generate` |
|---|---|---|
| 저장소를 새로 받았다(clone, 브랜치 소스 복사) | 친다 | 친다 |
| `git pull` 등으로 `package.json`·`package-lock.json`이 바뀌었다 | 친다 | `prisma` 버전이 바뀌었으면 친다 |
| `prisma/schema.prisma`가 바뀌었다 | 안 친다 | 친다 |
| 폴더를 `node_modules`·`src/generated`까지 통째로 복사해 왔다 | 생략해도 된다 | 생략해도 된다 |

두 명령 모두 여러 번 쳐도 결과가 같으니, 되살린 상태인지 헷갈리면 그냥 한 번 더 친다.

DB 테이블도 확인한다. `docker compose`의 볼륨 이름은 폴더 이름(`order-api-nest`)을 따라 `order-api-nest_pgdata`가 되므로, 앞 단계에서 같은 이름의 폴더로 띄웠던 PC라면 테이블이 이미 있다. 새 PC거나 볼륨을 지웠다면 비어 있다.

```sh
# prisma/migrations와 DB를 비교한다. "Database schema is up to date!"면 그대로 간다
npx prisma migrate status
# 적용 안 된 마이그레이션이 있다고 나오면 적용한다(새 마이그레이션을 만들지 않고, 있는 것만 순서대로 적용한다)
npx prisma migrate deploy
```

### 작업 3. 패키지 설치

```sh
npm install @socket.io/redis-adapter ioredis bullmq
```

- `@socket.io/redis-adapter`: socket.io가 Redis Pub/Sub으로 다른 서버와 이벤트를 주고받게 하는 어댑터

- `ioredis`: Node용 Redis 클라이언트

- `bullmq`: Redis 위에서 도는 작업 큐

리더 선출에 쓰는 `pg`(PostgreSQL 드라이버)는 설치돼 있으니 새로 설치하지 않는다.

### 작업 4. 환경변수 추가

`.env`에 추가한다.

```sh
# .env
# 맨 아래에 추가한다
REDIS_URL=redis://localhost:6380
# 3단계의 가짜 메일 발송기 설정: 한 통에 걸리는 시간(ms), 실패 확률(0~1), 워커가 동시에 처리할 개수
MAIL_DELAY_MS=300
MAIL_FAIL_RATE=0
MAIL_CONCURRENCY=5
# 5단계의 정리 작업 주기(ms)
CLEANUP_INTERVAL_MS=60000
```

### 작업 5. 서버 두 대 띄우는 법

이 문서 내내 같은 코드를 포트만 달리 해서 두 번 띄운다.

`start:dev`(watch 모드) 두 개가 같은 `dist` 폴더를 동시에 다시 빌드하면 서로 꼬이므로, 한 번 빌드하고 결과물을 두 번 실행한다.

```sh
npm run build
# 터미널 1. 명령 앞의 PORT=4000이 .env의 PORT보다 우선한다(--env-file은 이미 있는 환경변수를 덮어쓰지 않는다)
PORT=4000 node --env-file=.env dist/main.js
# 터미널 2
PORT=4001 node --env-file=.env dist/main.js
```

`.env`에는 `PORT=4000`이 적혀 있다. 터미널 2에서 `PORT=4001`을 빼먹으면 두 서버가 같은 포트를 잡으려 해서 두 번째가 `EADDRINUSE`로 뜨지 않는다.

> 코드를 고치면 두 서버를 끄고, 다시 빌드하고, 다시 띄운다.

### 남길 것

- **찾아보면 되는 것**: compose의 `ports` 문법(`"PC쪽:컨테이너쪽"`), `npm install`과 `npm ci`의 차이, 패키지 이름 세 개, `node --env-file`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - git에는 "다시 만들 수 있는 것"이 없다. 받아 온 프로젝트는 `npm install`로 패키지를, `npx prisma generate`로 Prisma 클라이언트를 되살린 뒤에야 빌드된다.

  - 같은 코드를 두 번 띄울 때는 watch 모드 두 개를 돌리지 않는다. 한 번 빌드하고 결과물을 포트만 달리 해서 두 번 실행한다.

  - 명령 앞에 붙인 환경변수(`PORT=4001 node ...`)가 `.env`의 값보다 우선한다. 서버마다 다른 값은 이렇게 넘긴다.

- **에러 신호**:

  - `npm run build`가 `Cannot find module '../generated/prisma/client.js'`로 멈춘다 → `npx prisma generate`를 쳤는지

  - `npx prisma db seed`가 `The table ... does not exist`로 멈춘다 → `npx prisma migrate status`, 필요하면 `migrate deploy`

  - 두 번째 서버가 `listen EADDRINUSE: address already in use :::4000`으로 죽는다 → 명령 앞에 `PORT=4001`을 붙였는지

## 2. 1단계: 일부러 깨뜨려보기 ①, 서버 두 대의 알림

서버 A로 주문을 만들고, 서버 B에 붙은 클라이언트가 알림을 몇 개 받는지 센다.

아직 Redis를 쓰는 코드는 하나도 없다. 준비에서 컨테이너와 패키지만 추가한 상태다.

### 작업 1. 알림 개수를 세는 스크립트 만들기

```js
// scripts/notify-check.mjs
// 서버 B(socket)에 붙어 있는 클라이언트가, 서버 A(HTTP)로 만든 주문의 알림을 몇 개 받는지 센다
// 사용법: node scripts/notify-check.mjs [주문 수] [A 포트] [B 포트]
//   node scripts/notify-check.mjs 10 4000 4001
import { io } from "socket.io-client";

process.loadEnvFile();
const N = Number(process.argv[2] ?? 10);
const A = `http://localhost:${process.argv[3] ?? 4000}`;
const B = `http://localhost:${process.argv[4] ?? 4001}`;

const login = await fetch(`${A}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

// B 서버에 WebSocket으로 붙는다
const socket = io(B, { auth: { token: accessToken } });
await new Promise((resolve) => socket.on("connect", resolve));
const received = new Set();
socket.on("order.created", (o) => received.add(o.id));

// A 서버로 주문을 N개 만든다(전부터 있던 POST /orders)
const created = [];
for (let i = 0; i < N; i++) {
  const res = await fetch(`${A}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ user: "kim", price: 1000, paid: true }),
  });
  created.push((await res.json()).id);
}

// outbox relay가 0.5초마다 돌므로 넉넉히 기다린다
await new Promise((r) => setTimeout(r, 2000));
console.log(`A(${A})로 만든 주문 ${created.length}개 중, B(${B})에 붙은 클라이언트가 받은 알림: ${received.size}개`);
socket.close();
```

### 실험 | 서버 두 대로 여러 번 돌리기

1장 작업 5대로 빌드해서 두 서버를 띄우고, 다른 터미널에서 여러 번 실행한다.

```sh
npx prisma db seed
for i in 1 2 3 4 5 6; do node scripts/notify-check.mjs 10 4000 4001; done
```

```sh
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 8개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 1개
```

돌릴 때마다 결과가 다르다. 그런데 아직 안 보낸 outbox 이벤트를 세어 보면 0이다.

```sh
docker compose exec db psql -U order -d order_api -c "SELECT count(*) FROM outbox_events WHERE published_at IS NULL"

 count 
-------
     0
(1 row)
```

모든 이벤트가 "보냄"으로 처리됐다. **보내기는 했는데 엉뚱한 곳으로 보낸 것이다.**

### 개념 | 이벤트를 집은 서버에 받는 소켓이 없다

outbox relay는 두 서버에서 각자 돌고 있다.

`FOR UPDATE SKIP LOCKED` 덕분에 같은 이벤트를 둘이 동시에 집지는 않는다. 대신 그 회차에 먼저 집은 쪽이 이벤트를 가져간다.

서버 A의 relay가 집으면 A의 `server.to("user:kim").emit(...)`이 실행되는데, A에는 `kim`의 소켓이 없다(B에 붙어 있다).

그 알림은 아무에게도 가지 않고 사라진다. relay는 보낸 것으로 알고 `published_at`을 채운다.

> 주문은 빠르게 연달아 만들어져서 보통 한 회차에 몰려 집히므로, 결과가 10개 아니면 0개로 갈리는 일이 많다. 주문이 두 회차에 걸쳐 집히면 8개나 5개처럼 일부만 오기도 한다.

### 남길 것

- **찾아보면 되는 것**: `socket.io-client`의 `io(주소, { auth })`, `process.loadEnvFile()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - room은 서버 프로세스의 메모리에만 있다. 서버가 둘이면 "그 사용자 방"도 서버마다 따로다.

  - outbox의 `published_at`은 "relay가 게이트웨이에 넘겼다"까지만 말한다. 받는 사람에게 닿았다는 뜻이 아니다.

- **에러 신호**:

  - 받은 알림 수가 실행마다 10, 1, 0처럼 다른데 미발행 outbox는 0건 → 서버가 여러 대인데 Redis 어댑터가 없는지

## 3. 2단계: Redis 어댑터로 알림을 모든 서버에 퍼뜨리기

socket.io의 어댑터는 "`emit`을 실제로 어디로 보낼지"를 정하는 부품이다. 기본 어댑터는 같은 프로세스의 소켓만 안다.

Redis 어댑터로 바꾸면 `emit`이 Redis 채널에도 발행되고, 모든 서버가 그 채널을 구독하고 있다가 각자 자기에게 붙은 소켓에 전달한다.

### 작업 1. RedisIoAdapter 만들기

```ts
// src/redis/redis-io.adapter.ts
import { INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

// socket.io 서버를 만들 때 Redis 어댑터를 끼워 넣는 Nest 어댑터
// server.to(room).emit()을 "내 프로세스의 소켓"에만 보내지 않고 Redis 채널에 발행(PUBLISH)한다
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pubClient = new Redis(url);
    // RESP2에서는 구독(SUBSCRIBE) 중인 연결이 다른 명령을 못 보낸다(ioredis 6 기본인 RESP3는 된다)
    // → 프로토콜과 상관없이 동작하고 구독 메시지와 일반 명령이 섞이지 않도록 발행용과 구독용 연결을 따로 둔다
    const subClient = pubClient.duplicate();
    // error 핸들러가 없으면 Redis가 끊길 때마다 경고와 스택이 쏟아진다. 재접속은 ioredis가 알아서 한다
    const logger = new Logger(RedisIoAdapter.name);
    for (const c of [pubClient, subClient]) c.on("error", (err) => logger.warn(`Redis 연결 오류: ${err.message}`));
    // 두 연결이 모두 준비될 때까지 기다린다
    await Promise.all([
      new Promise((resolve) => pubClient.once("ready", resolve)),
      new Promise((resolve) => subClient.once("ready", resolve)),
    ]);
    this.clients = [pubClient, subClient];
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  // 매개변수·반환 타입을 IoAdapter에서 그대로 가져온다(이유는 6단계 진단 4)
  createIOServer(...args: Parameters<IoAdapter["createIOServer"]>): ReturnType<IoAdapter["createIOServer"]> {
    const server = super.createIOServer(...args);
    server.adapter(this.adapterConstructor!);
    return server;
  }

  // 앱이 꺼질 때 Redis 연결도 닫는다
  async close(server: unknown) {
    await super.close(server as never);
    await Promise.all(this.clients.map((c) => c.quit()));
  }
}
```

### 작업 2. main.ts에서 어댑터 끼우기

```ts
// src/main.ts
// import 한 줄을 추가하고, app.listen 바로 앞에 세 줄을 넣는다
import { RedisIoAdapter } from './redis/redis-io.adapter.js';
// ... 기존 import 그대로 ...

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ... ValidationPipe, 예외 필터, cookieParser, enableCors 그대로 ...
  // WebSocket 서버가 Redis를 거쳐 다른 인스턴스와 이벤트를 주고받게 한다
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(process.env.REDIS_URL!);
  app.useWebSocketAdapter(redisIoAdapter);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

게이트웨이(`notifications.gateway.ts`)는 **한 줄도 고치지 않는다.** `server.to(...).emit(...)` 호출은 그대로이고, 그 호출이 어디까지 닿는지만 어댑터가 바꾼다.

### 작업 3. 같은 실험 다시 돌리기

빌드하고 두 서버를 다시 띄운 뒤 1단계와 같은 실험을 한다.

```sh
npm run build
# 터미널 1, 2에서 두 서버를 다시 띄운 뒤 터미널 3에서
for i in 1 2 3 4 5 6; do node scripts/notify-check.mjs 10 4000 4001; done
```

```sh
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개
A(http://localhost:4000)로 만든 주문 10개 중, B(http://localhost:4001)에 붙은 클라이언트가 받은 알림: 10개

```

어떤 서버의 relay가 이벤트를 집든 상관없어졌다.

#### MONITOR로 Redis 내부 보기

Redis에서 실제로 무슨 일이 일어나는지는 `MONITOR`로 본다. Redis가 받는 모든 명령을 실시간으로 출력하는 명령이다.

```sh
docker compose exec redis redis-cli MONITOR
```

`MONITOR`를 켜 둔 채로 다른 터미널에서 주문 하나를 만든다. `notify-check.mjs`가 하는 일(로그인 → `POST /orders`)을 `curl`로 한 번만 하는 것이다.

```sh
# kim으로 로그인해서 access token만 꺼내 둔다(jq: JSON에서 값을 꺼내는 명령줄 도구. 없으면 brew install jq)
TOKEN=$(curl -s -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
# 서버 A(4000)로 주문 하나를 만든다
curl -s -X POST localhost:4000/orders \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"user":"kim","price":1000,"paid":true}'
```

- 비밀번호 `1234`는 `.env`의 `DEMO_PASSWORD`다.

- 주문의 주인은 body의 `user`지만, 알림을 받을 사람(outbox 이벤트의 `userId`)은 토큰의 사용자 `kim`이다. 그래서 알림은 `user:kim` 방으로 간다.

- 주문 JSON이 돌아오고, outbox relay가 이벤트를 집는 0.5초 안쪽에 `MONITOR` 쪽에 `publish`가 한 줄 찍힌다.

```sh
1791796459.282051 [0 192.168.65.1:49973] "publish" "socket.io#/#user:kim#" "\x93\xa6IHRrqP\x83\xa4type\x02\xa4data\x92\xadorder.created\x85\xa7eventIdy\xa2id~\xa4paid\xc3\xa4user\xa3kim\xa5price\xcd\x03\xe8\xa3nsp\xa1/\x83\xa5rooms\x91\xa8user:kim\xa6except\x90\xa5flags\x80"
```

`socket.io#/#user:kim#`은 "기본 네임스페이스(`/`)의 `user:kim` 방" 채널이다.

메시지 내용은 MessagePack이라는 이진 형식이라 읽기 어렵지만, `order.created`와 `eventId`가 보인다.

> `MONITOR`는 Redis에 부담을 주므로 개발 중에 잠깐만 켠다. Ctrl+C로 끈다.

### 개념 | 어댑터가 두 겹이다: Nest의 `IoAdapter`와 socket.io의 Redis 어댑터

이 단계에서 "어댑터"라는 이름이 두 번 나온다. 서로 다른 부품이다.

| 이름 | 누구의 부품인가 | 하는 일 | 바꾸는 곳 |
|---|---|---|---|
| `IoAdapter`(`RedisIoAdapter`가 상속) | Nest | 게이트웨이를 위해 socket.io 서버(`Server`)를 만들고 닫는다 | `app.useWebSocketAdapter()` |
| `createAdapter(pubClient, subClient)`가 만든 것 | socket.io | 한 socket.io 서버 안에서 room 목록을 들고, `to(room).emit()`을 어느 소켓에 보낼지 정한다 | `server.adapter()` |

`RedisIoAdapter`는 앞의 것을 상속해서, socket.io 서버를 만드는 순간(`createIOServer`)에 뒤의 것을 끼워 넣는 다리다.

#### `emit` 한 번이 다른 서버의 소켓까지 가는 길

서버 A의 relay가 `notifyUser("kim", ...)`를 부르면 이렇게 된다.

1. 게이트웨이의 `this.server.to("user:kim").emit(...)`이 socket.io 어댑터에게 "이 방에 보내라"를 넘긴다.

2. Redis 어댑터는 A에 붙은 소켓 중 `user:kim` 방에 있는 것에 바로 보내고, 같은 패킷을 `socket.io#/#user:kim#` 채널에 `PUBLISH`한다. 위 `MONITOR`에 찍힌 그 줄이다.

3. B의 구독용 연결이 그 메시지를 받는다. B의 어댑터는 자기 메모리의 room 목록에서 `user:kim`을 찾아 거기 있는 소켓에 보낸다.

메시지 맨 앞의 `qC2HU_`는 보낸 서버의 어댑터 id다. A에게도 자기가 발행한 메시지가 돌아오지만, id가 자기 것이라 무시한다(이미 2번에서 보냈다).

room 목록 자체는 여전히 각 프로세스의 메모리에 있다. Redis를 지나가는 것은 "이 방에 보내라"는 메시지뿐이다.

> 0장 개념 1의 말로 하면, 각 프로세스가 자기 소켓 목록을 그대로 들고 있고 Redis Pub/Sub이 그 사이의 IPC가 된 것이다.

#### `useWebSocketAdapter`를 `listen` 앞에 두는 이유

게이트웨이의 socket.io 서버는 `app.listen()` 안에서 앱을 초기화할 때 만들어진다. 그때 등록돼 있는 WebSocket 어댑터의 `createIOServer`가 불린다.

`listen` 다음에 어댑터를 바꾸면 socket.io 서버는 이미 기본 `IoAdapter`로 만들어진 뒤라 Redis 어댑터가 붙지 않는다.

`await redisIoAdapter.connectToRedis(...)`가 그보다 앞에 있는 것도 같은 이유다. `createIOServer`는 `this.adapterConstructor!`를 쓰므로, 연결이 준비되기 전에 서버가 만들어지면 빈 값을 넘기게 된다.

그 대가로, Redis가 꺼진 채 서버를 켜면 `ready`가 오지 않아 `listen`까지 가지 못한다. 콘솔에는 `Redis 연결 오류: ...` 경고만 반복되고 HTTP 포트가 열리지 않는다.

e2e 테스트는 `main.ts`를 거치지 않고 앱을 만들기 때문에 이 어댑터가 붙지 않는다. 테스트의 게이트웨이는 기본 어댑터로 돈다.

#### 연결을 두 개 여는 이유

`createAdapter`에 발행용(`pubClient`)과 구독용(`subClient`) 연결을 따로 넘긴다.

Redis의 옛 프로토콜(RESP2)에서는 `SUBSCRIBE`를 보낸 연결이 구독 모드로 바뀌어, 그 뒤로는 `PUBLISH` 같은 다른 명령을 보낼 수 없다.

ioredis 6의 기본인 RESP3에서는 한 연결로도 되지만, 프로토콜과 상관없이 동작하고 구독 메시지와 일반 명령의 응답이 한 연결에서 섞이지 않도록 둘로 나눈다. `duplicate()`는 같은 설정으로 연결을 하나 더 만든다.

### 용어 | ioredis API

- `new Redis(url)`: Redis에 연결하는 클라이언트를 만든다. 연결이 끊기면 알아서 재접속한다.

- `client.duplicate()`: 같은 설정으로 새 연결을 하나 더 만든다.

- `client.on("error", 함수)`: 연결 오류가 날 때마다 호출된다.

- `client.once("ready", 함수)`: 연결이 끝나 명령을 받을 준비가 됐을 때 한 번 호출된다.

- `client.quit()`: 보낸 명령이 끝나기를 기다렸다가 연결을 닫는다.

### 용어 | socket.io 어댑터 API

- `IoAdapter`: Nest가 socket.io 서버를 만들 때 쓰는 기본 어댑터다. 이걸 상속해서 Redis를 끼워 넣는다.

- `createAdapter(pubClient, subClient)`: 발행용·구독용 연결로 Redis 어댑터를 만든다.

- `server.adapter(어댑터)`: socket.io 서버가 `emit`을 보낼 때 쓸 어댑터를 바꾼다.

- `app.useWebSocketAdapter(어댑터)`: Nest가 게이트웨이의 서버를 만들 때 쓸 어댑터를 바꾼다. `app.listen()` 전에 불러야 한다.

### 남길 것

- **찾아보면 되는 것**: `IoAdapter`를 상속하는 코드 모양, `createAdapter`의 인자, `MONITOR`의 출력 형식. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 여러 서버에 퍼뜨리는 일은 게이트웨이가 아니라 socket.io 어댑터가 맡는다. 그래서 `emit`하는 쪽 코드는 한 줄도 바뀌지 않는다.

  - room 목록은 계속 각 서버의 메모리에 있고, Redis에는 "이 방에 보내라"는 메시지만 지나간다.

- **에러 신호**:

  - 어댑터를 붙였는데도 알림이 일부만 온다 → `main.ts`에서 `useWebSocketAdapter`가 `app.listen`보다 앞에 있는지, 다시 빌드했는지

  - 서버가 `Redis 연결 오류: ...` 경고만 반복하고 포트가 열리지 않는다(`curl`이 `Failed to connect`) → Redis 컨테이너가 떠 있는지(`docker compose ps`)

  - `Type 'AdapterConstructor' is not assignable to type 'AdapterConstructor'. Two different types with this name exist, but they are unrelated.` → `socket.io`에서 타입을 직접 import했는지(6단계 진단 4)

## 4. 3단계: 일부러 깨뜨려보기 ②, relay 안에서 메일 보내기

주문이 생기면 확인 메일도 보내야 한다고 하자.

진짜 메일 서버 대신, 외부 서비스의 두 가지 성질(느리다, 가끔 실패한다)만 흉내 내는 가짜 발송기를 만든다.

### 작업 1. 가짜 메일 발송기 만들기

```ts
// src/mail/fake-mailer.ts
import { Injectable, Logger } from "@nestjs/common";

// 진짜 메일 서버 대신 쓰는 가짜 발송기. 외부 서비스의 두 가지 성질(느리다, 가끔 실패한다)만 흉내 낸다
@Injectable()
export class FakeMailer {
  private readonly logger = new Logger(FakeMailer.name);
  private readonly delayMs = Number(process.env.MAIL_DELAY_MS ?? 300);
  private readonly failRate = Number(process.env.MAIL_FAIL_RATE ?? 0);

  async send(to: string, subject: string, attempt = 1): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    // failRate가 0.3이면 약 30% 확률로 실패한다
    if (Math.random() < this.failRate) throw new Error(`메일 서버 일시 오류(${to})`);
    this.logger.log(`메일 발송: ${to} — ${subject} (시도 ${attempt})`);
  }
}
```

```ts
// src/mail/mail.module.ts
import { Module } from "@nestjs/common";
import { FakeMailer } from "./fake-mailer.js";

@Module({ providers: [FakeMailer], exports: [FakeMailer] })
export class MailModule {}
```

### 작업 2. 중복까지 세는 스크립트 만들기

이번에는 중복까지 세야 하므로 스크립트를 하나 더 만든다.

`notify-check.mjs`와 거의 같지만 서버는 한 대(4000)만 쓰고, 주문을 `Promise.all`로 한꺼번에 보내며, 받은 알림의 총 횟수와 서로 다른 주문 수를 따로 센다.

```js
// scripts/order-burst.mjs
// 소켓을 하나 붙여 둔 채 주문 N개를 동시에 만들고, 알림을 몇 번 받았는지 센다(중복 포함)
// 사용법: node scripts/order-burst.mjs [주문 수] [기다릴 ms]
//   node scripts/order-burst.mjs 20 12000
import { io } from "socket.io-client";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 20);
const WAIT = Number(process.argv[3] ?? 5000);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

const socket = io(API, { auth: { token: accessToken } });
await new Promise((resolve) => socket.on("connect", resolve));
let total = 0;
const unique = new Set();
socket.on("order.created", (o) => {
  total++; // 받은 횟수(중복 포함)
  unique.add(o.id); // 서로 다른 주문
});

await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ user: "kim", price: 1000, paid: true }),
    }),
  ),
);
await new Promise((r) => setTimeout(r, WAIT));
console.log(`주문 ${N}개 → 받은 알림 ${total}번(서로 다른 주문 ${unique.size}개)`);
socket.close();
```

### 작업 3. 깨뜨리기 전에 기준값 재기

relay를 건드리기 전에 스크립트를 한 번 돌려, 정상일 때의 숫자를 먼저 본다.

이 숫자가 있어야 실험에서 나오는 숫자가 "중복"인지 알아볼 수 있고, 숫자가 이상할 때 스크립트 탓인지 relay 탓인지도 가를 수 있다.

```sh
npm run build # 작업 1의 MailModule은 아직 아무도 import하지 않지만, 컴파일되는지는 여기서 확인된다
PORT=4000 node --env-file=.env dist/main.js # 터미널 1
node scripts/order-burst.mjs 20 3000 # 터미널 2

주문 20개 → 받은 알림 20번(서로 다른 주문 20개)
```

받은 횟수와 서로 다른 주문 수가 둘 다 주문 수와 같다. 이것이 기준값이다.

outbox 쪽도 확인한다. 보낼 것이 하나도 남지 않았어야 한다.

```sh
# psql로 DB에 붙어 아직 안 보낸(published_at이 비어 있는) 이벤트 수를 센다
docker compose exec db psql -U order -d order_api -c "SELECT count(*) FROM outbox_events WHERE published_at IS NULL"

 count
-------
     0
(1 row)
```

확인이 끝나면 서버를 끈다.

### 실험 | relay 트랜잭션 안에서 메일 보내기

가장 쉬운 방법은 이미 이벤트를 하나씩 처리하고 있는 relay에서 바로 보내는 것이다.

`OutboxModule`의 `imports`에 `MailModule`을 넣는다.

```ts
// src/outbox/outbox.module.ts
// 깨뜨려보기용: imports에 MailModule을 추가한다
import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OutboxRelay } from "./outbox.relay.js";

@Module({ imports: [NotificationsModule, MailModule], providers: [OutboxRelay] })
export class OutboxModule {}
```

relay가 `FakeMailer`를 주입받아 반복문 안에서 보낸다.

```ts
// src/outbox/outbox.relay.ts
// 깨뜨려보기용: import 한 줄, 생성자 매개변수 한 줄, for 문 안의 한 줄을 추가한다
import { FakeMailer } from "../mail/fake-mailer.js";

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly mailer: FakeMailer,
  ) {}

// publishBatch의 for 문
      for (const e of events) {
        this.notifications.notifyUser(e.user_id, e.type, { eventId: e.id, ...e.payload });
        // 깨뜨려보기: 느린 외부 작업(메일)을 relay 트랜잭션 안에서 직접 한다
        await this.mailer.send(`${e.user_id}@example.com`, `주문 #${String(e.payload.id)} 확인`);
      }
```

`OutboxModule`에 `MailModule`을 빠뜨리면 서버가 뜨기 전에 `Nest can't resolve dependencies of the OutboxRelay (PrismaService, NotificationsGateway, ?)`로 멈춘다. `?` 자리가 `FakeMailer`다.

빌드하고 서버를 **한 대만**(4000) 띄운다. 클라이언트 하나를 붙여 둔 채 주문 20개를 동시에 만든다.

이번에는 메일 발송 횟수를 세야 하므로 서버 로그를 `tee`로 화면과 파일(`server.log`)에 함께 남긴다.

```sh
npm run build
# 터미널 1. tee: 받은 출력을 화면에 보여 주면서 파일에도 쓴다
PORT=4000 node --env-file=.env dist/main.js | tee server.log
# 터미널 2
node scripts/order-burst.mjs 20 12000
```

```sh
주문 20개 → 받은 알림 38번(서로 다른 주문 20개)
```

터미널 1에는 이런 경고가 반복해서 찍힌다.

```sh
outbox 발행 실패 - 다음 회차에 다시 시도합니다
  (Transaction API error: ... expired transaction. The timeout for this transaction was 5000 ms ...)
```

스크립트가 끝나면(12초 뒤) 터미널 2에서 메일 발송 횟수와 outbox 상태를 센다.

```sh
# grep -c: 그 문자열이 들어 있는 줄 수를 센다. FakeMailer가 한 통 보낼 때마다 "메일 발송:" 한 줄을 남긴다
grep -c "메일 발송:" server.log
# 아직 안 보낸 이벤트 수
docker compose exec db psql -U order -d order_api -c "SELECT count(*) FROM outbox_events WHERE published_at IS NULL"
```

```sh
37
 count
-------
    20
(1 row)
```

relay는 서버를 끌 때까지 같은 회차를 반복하므로, `grep -c`를 늦게 칠수록 메일 발송 횟수는 더 커진다. outbox의 20은 그대로다. (`server.log`는 `.gitignore`의 `*.log`에 걸려 커밋되지 않는다.)

주문 20개에 알림은 38번, 메일은 37통이 나갔다. 그런데 outbox에는 20건이 전부 "아직 안 보냄"으로 남아 있다.

확인이 끝나면 서버를 끈다. relay와 `OutboxModule`은 다음 단계에서 큐를 쓰도록 바꾸므로, 여기서 넣은 `FakeMailer` 부분은 그때 `MailQueue`로 바뀐다.

### 개념 | 롤백된 회차가 끝없이 다시 보내는 과정

relay는 한 회차에 최대 20건을 집어 트랜잭션 하나 안에서 처리한다.

메일 한 통에 0.3초씩 20통이면 6초인데, `02`에서 본 Prisma 트랜잭션 시간 상한은 5초다.

1. 5초를 넘기는 순간 트랜잭션이 롤백되어 `published_at` 기록이 사라진다.

2. 하지만 이미 보낸 알림과 메일은 되돌릴 수 없다.

3. 다음 회차가 같은 20건을 다시 집고, 또 6초가 걸리고, 또 롤백된다.

이벤트가 쌓여 있는 한 영원히 반복되며 중복 메일을 뿌린다.

`02`의 9단계에서 "트랜잭션 안에서 느린 작업을 하면 위험하다"를 유령 알림으로 봤다. 같은 원리가 이번에는 끝없는 재전송으로 나타났다.

원칙은 같다. **트랜잭션 안에서는 DB 일만 빠르게 한다.**

### 남길 것

- **찾아보면 되는 것**: `Math.random()`으로 실패를 흉내 내는 방법, `Promise.all`로 요청을 동시에 보내는 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 트랜잭션 안에서 바깥 세상(메일, WebSocket)에 한 일은 롤백되지 않는다. 롤백된 회차를 다시 돌면 그 일이 또 일어난다.

  - 한 회차에 처리하는 건수 × 한 건의 시간이 트랜잭션 시간 상한(5초)을 넘으면, 그 회차는 영원히 끝나지 않는다.

- **에러 신호**:

  - `outbox 발행 실패 - 다음 회차에 다시 시도합니다`와 `expired transaction. The timeout for this transaction was 5000 ms` → relay 트랜잭션 안의 느린 외부 작업

  - 받은 알림 횟수가 주문 수보다 많다(38번/20개) → 롤백된 회차가 같은 이벤트를 다시 보내고 있다

  - `Nest can't resolve dependencies of the OutboxRelay (PrismaService, NotificationsGateway, ?)` → `?` 자리의 클래스를 가진 모듈을 `OutboxModule`의 `imports`에 넣었는지

## 5. 4단계: BullMQ 작업 큐로 떼어 내기

relay는 메일을 보내지 않고, "이 메일을 보내라"는 job을 큐에 넣기만 한다. Redis에 한 번 쓰는 일이라 금방 끝난다.

실제 발송은 워커가 따로 하고, 실패하면 큐가 알아서 재시도한다.

### 작업 1. MailQueue 만들기

```ts
// src/queue/mail.queue.ts
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { FakeMailer } from "../mail/fake-mailer.js";

export type OrderEmailJob = { to: string; orderId: number };

const QUEUE_NAME = "mail";

// 넣는 쪽(relay)과 처리하는 쪽(워커)이 분리되어, 느리거나 실패하는 일이 넣는 쪽을 붙잡지 않는다
@Injectable()
export class MailQueue implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueue.name);
  private readonly connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  private readonly queue = new Queue<OrderEmailJob>(QUEUE_NAME, { connection: this.connection });
  private readonly worker: Worker<OrderEmailJob>;

  constructor(private readonly mailer: FakeMailer) {
    // 서버 인스턴스마다 워커가 하나씩 떠서 일을 나눠 갖는다
    this.worker = new Worker<OrderEmailJob>(
      QUEUE_NAME,
      // 정상 종료하면 completed, 예외를 던지면 실패로 기록되고 재시도 대상이 된다
      (job: Job<OrderEmailJob>) => this.mailer.send(job.data.to, `주문 #${job.data.orderId} 확인`, job.attemptsMade + 1),
      // 메일 발송은 대부분 "기다리는" 일이라 여러 개를 겹쳐 돌린다
      { connection: this.connection.duplicate(), concurrency: Number(process.env.MAIL_CONCURRENCY ?? 5) },
    );
    // Redis 연결 오류는 로그만 남긴다 — ioredis가 재접속하고, 그동안 보낸 명령은 연결이 돌아오면 이어서 실행된다
    const warn = (err: Error) => this.logger.warn(`Redis 연결 오류: ${err.message}`);
    this.connection.on("error", warn);
    this.queue.on("error", warn);
    this.worker.on("error", warn);
    this.worker.on("failed", (job, err) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.warn(`메일 job ${job?.id} 실패(${job?.attemptsMade}회째)${final ? " — 재시도 소진, failed로 이동" : ""}: ${err.message}`);
    });
  }

  // eventId를 jobId로 쓴다 → 같은 outbox 이벤트가 두 번 들어와도(at-least-once) 큐에는 job이 하나만 생긴다
  async enqueueOrderEmail(eventId: number, data: OrderEmailJob) {
    await this.queue.add("order-email", data, {
      jobId: `order-email-${eventId}`,
      attempts: 4, // 처음 1번 + 재시도 3번
      backoff: { type: "exponential", delay: 500 }, // 재시도 간격: 0.5초 → 1초 → 2초
    });
  }

  async onModuleDestroy() {
    await this.worker.close(); // 처리 중인 job이 끝날 때까지 기다렸다가 닫는다
    await this.queue.close();
    await this.connection.quit();
  }
}
```

### 작업 2. QueueModule 만들고 relay에 연결하기

```ts
// src/queue/queue.module.ts
import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { MailQueue } from "./mail.queue.js";

@Module({ imports: [MailModule], providers: [MailQueue], exports: [MailQueue] })
export class QueueModule {}
```

`OutboxModule`의 `imports`를 `MailModule` 대신 `QueueModule`로 바꾼다. `FakeMailer`는 이제 `QueueModule`이 `MailModule`을 통해 쓴다.

```ts
// src/outbox/outbox.module.ts
// 3단계에서 넣은 MailModule을 QueueModule로 바꾼다
import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { OutboxRelay } from "./outbox.relay.js";

@Module({ imports: [NotificationsModule, QueueModule], providers: [OutboxRelay] })
export class OutboxModule {}
```

relay는 `FakeMailer` 대신 `MailQueue`를 주입받는다.

```ts
// src/outbox/outbox.relay.ts
// FakeMailer import를 MailQueue import로, 생성자의 mailer를 mailQueue로 바꾼다
import { MailQueue } from "../queue/mail.queue.js";

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly mailQueue: MailQueue,
  ) {}

// publishBatch의 for 문
      for (const e of events) {
        // eventId를 함께 보낸다 — 같은 이벤트가 두 번 와도 받는 쪽이 걸러낼 수 있게
        this.notifications.notifyUser(e.user_id, e.type, { eventId: e.id, ...e.payload });
        // 느린 메일 발송은 여기서 하지 않고 큐에 넣기만 한다(Redis에 한 번 쓰는 시간이면 끝난다)
        await this.mailQueue.enqueueOrderEmail(e.id, { to: `${e.user_id}@example.com`, orderId: Number(e.payload.id) });
      }
```

### 작업 3. 큐 상태 스크립트 만들고 다시 돌리기

큐 상태를 보는 스크립트를 하나 만든다.

```js
// scripts/queue-stats.mjs
// 메일 큐의 상태별 job 수를 출력한다
// 사용법: node scripts/queue-stats.mjs
import { Queue } from "bullmq";
import { Redis } from "ioredis";

process.loadEnvFile();
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("mail", { connection });
// waiting : 아직 안 꺼낸 job, active : 처리 중, delayed : 재시도 대기(backoff), completed / failed : 끝난 것
console.log(await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"));
await queue.close();
await connection.quit();
```

`queue.getJobCounts(...)`가 세는 상태는 다음과 같다.

- `waiting`: 아직 안 꺼낸 job

- `active`: 처리 중인 job

- `delayed`: 재시도를 기다리는(backoff) job

- `completed` / `failed`: 끝난 job

빌드하고 서버 한 대로 3단계와 같은 실험을 다시 한다.

```sh
npm run build
PORT=4000 node --env-file=.env dist/main.js # 터미널 1
node scripts/order-burst.mjs 20 12000 # 터미널 2
node scripts/queue-stats.mjs # 터미널 3
```

```sh
# 터미널 1
LOG [OutboxRelay] outbox 이벤트 20건 발행
LOG [FakeMailer] 메일 발송: kim@example.com — 주문 #147 확인 (시도 1)
...

# 터미널 2
주문 20개 → 받은 알림 20번(서로 다른 주문 20개)

# 터미널 3
{ waiting: 0, active: 0, delayed: 0, completed: 20, failed: 0 }
```

### 용어 | BullMQ API

- `new Queue<T>(이름, { connection })`: job을 넣는 쪽이다. `<T>`는 job 데이터의 모양이다.

- `new Worker<T>(이름, 처리 함수, { connection, concurrency })`: 큐에서 job을 꺼내 처리 함수를 실행한다. `concurrency`는 한 워커가 동시에 처리하는 job 수이며, 아래 "`concurrency`는 스레드 수가 아니다"에서 다룬다.

- `queue.add(이름, 데이터, { jobId, attempts, backoff })`: job을 넣는다. 같은 `jobId`의 job이 이미 있으면 새로 만들지 않는다(아래 "같은 이벤트를 두 번 넣으면"에서 확인한다). `attempts`와 `backoff`는 아래 "`attempts`·`backoff`와 `attemptsMade`"에서 다룬다.

- `job.attemptsMade`: 지금까지 실패한 횟수다. 아래 "`attempts`·`backoff`와 `attemptsMade`"에서 다룬다.

- `job.opts.attempts`: 이 job에 허용된 전체 시도 횟수다. 다 쓰면 failed 목록으로 간다.

- `worker.on("failed", (job, err) => ...)`: job이 한 번 실패할 때마다 호출된다.

- `worker.close()`: 처리 중인 job이 끝나기를 기다렸다가 워커를 닫는다.

- `queue.getJobCounts(...상태)`, `queue.getFailedCount()`, `queue.retryJobs({ state: "failed" })`: 상태별 개수를 세고, failed에 있는 job을 다시 대기열로 돌린다.

### 개념 | `attempts`·`backoff`와 `attemptsMade`

`attempts`는 "재시도 횟수"가 아니라 **처음 시도를 포함한 전체 시도 횟수**다. `attempts: 4`면 한 번 하고, 실패하면 최대 세 번 더 한다.

`attemptsMade`는 "지금까지 실패한 횟수"다. 처리 함수 안에서는 이번 시도 번호보다 1 작으므로 `MailQueue`는 `job.attemptsMade + 1`을 시도 번호로 넘긴다.

`failed` 이벤트에서는 방금 실패한 것까지 센 값이라, `attemptsMade >= opts.attempts`이면 마지막 시도였다는 뜻이다(`failed` 핸들러의 `final`).

`backoff: { type: "exponential", delay: 500 }`의 대기 시간은 `delay × 2^(attemptsMade - 1)`이다.

| 시도 | 처리 함수가 보는 `attemptsMade` | 그 시도 전에 기다린 시간 |
|---|---|---|
| 1 | 0 | 없음 |
| 2 | 1 | 500ms |
| 3 | 2 | 1000ms |
| 4 | 3 | 2000ms |

처음 세 번은 일부러 실패하는 job을 같은 옵션으로 넣고 시각을 찍어 보면 표와 같은 간격이 나온다.

```js
// queue.add(..., { attempts: 4, backoff: { type: "exponential", delay: 500 } })로 넣은 job
const worker = new Worker("mail", async (job) => {
  console.log(`${Date.now() - t0}ms 시도 ${job.attemptsMade + 1}`);
  if (job.attemptsMade < 3) throw new Error("메일 서버 일시 오류");
}, { connection });
// 실행한 예(ms 값은 실행마다 조금씩 다르다)
// 11ms 시도 1
// 589ms 시도 2
// 1629ms 시도 3
// 3708ms 시도 4
```

- 네 번째 시도까지 실패하면 job은 failed로 간다. 결과는 아래 "재시도를 다 써도 실패하면"에서 본다.

- `attemptsMade`는 failed에 간 job을 다시 돌려도 0으로 돌아가지 않는다. 아래 작업 4의 `시도 5`가 그 흔적이다.

- 간격을 지수로 늘리는 이유는 아래 "재시도"에서 다룬다.

> `attempts: 3`을 "3번 재시도"로 읽으면 기대보다 한 번 덜 시도한다. 처음 시도까지 센 숫자다.

### 개념 | `concurrency`는 스레드 수가 아니다

C에서 "동시에 5개"라고 하면 스레드 5개를 떠올린다. Node 프로세스는 JS를 스레드 하나(이벤트 루프)에서 돌린다.

`concurrency: 5`는 **처리 함수가 돌려준 Promise를 최대 5개까지 동시에 기다린다**는 뜻이다.

메일 발송처럼 대부분의 시간을 `await`로 기다리는 일이면 5개가 겹쳐서 돈다. CPU를 계속 쓰는 일은 기다리는 구간이 없으니 겹칠 수 없고, 하나씩 차례로 돈다.

```js
// 둘 다 concurrency: 5, job 5개, job 하나에 300ms
// 기다리는 일(메일 발송과 같은 모양)
new Worker("a", async () => { await new Promise((r) => setTimeout(r, 300)); }, { connection, concurrency: 5 });
// CPU를 계속 쓰는 일(이벤트 루프를 막는다)
new Worker("b", async () => { const end = Date.now() + 300; while (Date.now() < end); }, { connection, concurrency: 5 });
// 5개가 모두 끝나기까지 실행한 예: a는 약 0.3초, b는 약 1.5초
```

| 처리 함수가 하는 일 | `concurrency: 5`의 효과 |
|---|---|
| `await`로 기다리는 일(메일, HTTP, DB) | 5개가 겹쳐 돈다 |
| CPU를 계속 쓰는 일(압축, 이미지 변환) | 하나씩 차례로 돈다. 그동안 같은 프로세스의 HTTP 처리도 멈춘다 |

- 워커는 API 서버와 같은 프로세스에서 돈다. 처리 함수가 이벤트 루프를 오래 막으면 주문 API도 같이 느려진다. 뒤의 5단계에서 쓰는 `lock-race.mjs`의 `freeze`가 이 상태를 일부러 만든다.

- CPU 일을 나눠 돌리려면 `concurrency`가 아니라 워커 프로세스를 늘린다. 서버를 늘리면 워커도 늘어난다(아래 "서버 두 대에서").

> `concurrency`는 "한 워커가 동시에 붙잡고 있는 job 수"이지 CPU 코어 수가 아니다.

### 개념 | 워커는 `MailQueue`가 만들어지는 순간 돌기 시작한다

`MailQueue`는 프로바이더라서 Nest가 서버 프로세스마다 하나씩(싱글턴) 만든다.

그 생성자에서 `new Worker(...)`를 하므로, 워커는 Nest가 의존성을 엮는 서버 시작 단계에서 바로 큐를 지켜보기 시작한다. 서버가 두 대면 워커도 두 개다.

필드 초기화(`connection`, `queue`)는 생성자 본문보다 먼저, 적힌 순서대로 실행된다. 그래서 `queue`를 만드는 줄에서 `this.connection`을 쓸 수 있고, 생성자 본문에서는 `this.connection.duplicate()`로 워커용 연결을 하나 더 만든다.

이 사실에서 따라 나오는 것이 두 가지 있다.

- e2e 테스트도 `AppModule`을 통째로 만들기 때문에 `MailQueue`가 생기고 Redis에 연결한다. 이 단계부터는 `npm run test:e2e` 전에 Redis 컨테이너도 떠 있어야 한다.

- 끌 때의 정리(`onModuleDestroy`의 `worker.close()`)는 `app.close()`를 거칠 때만 돈다. `main.ts`에 `enableShutdownHooks()`가 없으니 Ctrl+C로 끄면 처리 중이던 job은 끝나지 않고 끊긴다. 끊긴 job은 BullMQ가 멈춘(stalled) job으로 보고 다시 대기열로 돌려, 살아 있는 워커가 다시 집는다.

### 용어 | ioredis 연결 설정

- `{ maxRetriesPerRequest: null }`: 연결이 끊겼을 때 명령을 포기하지 않고 재접속까지 기다리게 한다. BullMQ가 요구하는 설정이며, 아래 "`maxRetriesPerRequest: null`: 명령을 버리지 않고 기다린다"에서 다룬다.
- 워커에는 `connection.duplicate()`로 따로 연결을 준다. 워커는 Redis에서 job을 "기다리는" 명령을 쓰므로 큐와 연결을 나눠 써야 한다.

### 개념 | `maxRetriesPerRequest: null`: 명령을 버리지 않고 기다린다

ioredis는 연결이 끊긴 동안 보낸 명령을 버리지 않고 내부 대기열에 쌓아 두었다가, 재접속하면 이어서 보낸다.

다만 기본값(`maxRetriesPerRequest: 20`)에서는 명령 하나가 재접속 시도 20번 동안만 기다리고, 그래도 안 되면 에러로 끝난다.

```js
// 아무것도 듣지 않는 포트에 기본 설정으로 연결하고 명령을 보낸다
const redis = new Redis("redis://localhost:6399");
redis.on("error", () => {});
await redis.get("x");
// 1분 남짓 뒤 에러: MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20). Refer to "maxRetriesPerRequest" option for details.
```

`null`이면 횟수 제한이 없어서 Redis가 돌아올 때까지 명령을 쥐고 기다린다.

BullMQ 워커는 Redis에서 job이 들어오기를 오래 기다리는 명령을 쓰므로, 그 명령이 도중에 에러로 끝나면 안 된다. 그래서 기본값 그대로인 연결을 `Worker`에 넘기면 만들자마자 에러를 던진다.

```js
new Worker("mail", handler, { connection: new Redis(process.env.REDIS_URL) }); // maxRetriesPerRequest를 지정하지 않았다
// 에러: BullMQ: Your redis options maxRetriesPerRequest must be null.
```

- 6단계 진단 3에서 Redis를 껐을 때 relay의 `queue.add`가 실패하지 않고 기다린 것이 이 설정 때문이다.

- 대신 기다리는 쪽은 그만큼 붙잡힌다. 진단 3에서 relay 트랜잭션이 5초를 넘겨 롤백된 것이 그 대가이고, outbox와 `jobId`가 그 뒤를 받친다.

> 기본값은 "실패를 빨리 알린다", `null`은 "끝까지 기다린다"를 고른 것이다. job을 잃지 않는 것이 큐의 존재 이유라서 BullMQ는 뒤쪽을 요구한다.

### 실험 | 재시도

`MAIL_FAIL_RATE=0.3`(30% 실패)으로 띄워 같은 실험을 한다.

```sh
PORT=4000 MAIL_FAIL_RATE=0.3 node --env-file=.env dist/main.js # 터미널 1
node scripts/order-burst.mjs 20 12000 # 터미널 2
node scripts/queue-stats.mjs
```

```sh
{ waiting: 0, active: 0, delayed: 0, completed: 20, failed: 0 }
메일 발송 — 시도 1: 15통, 시도 2: 3통, 시도 3: 1통, 시도 4: 1통
실패 로그 — 1회째 5번, 2회째 2번, 3회째 1번
```

실패한 메일은 0.5초, 1초, 2초 간격으로 다시 시도되어 20통 모두 나갔다.

> 간격을 점점 늘리는 이유(지수 backoff)는, 메일 서버가 과부하로 실패하는 중이라면 곧바로 다시 몰아치는 것이 상황을 더 나쁘게 만들기 때문이다.

### 실험 | 재시도를 다 써도 실패하면

`MAIL_FAIL_RATE=1`(항상 실패)로 띄워 주문 5개를 만든다.

이 실험부터 "같은 이벤트를 두 번 넣으면"까지는 숫자(`order-email-1`, `주문 #6`, `5건`)를 맞춰 보며 따라가므로, DB와 큐를 처음 상태로 되돌리고 시작한다.

```sh
# 떠 있는 서버를 모두 끈다(Ctrl+C). 아무것도 출력되지 않아야 한다
lsof -iTCP:4000 -iTCP:4001 -sTCP:LISTEN
# seed는 테이블을 비우고 번호를 1부터 다시 매긴다(RESTART IDENTITY). 주문은 seed가 넣는 5건 다음인 #6부터, outbox 이벤트는 1부터 붙는다
npx prisma db seed
# 앞 실험의 job을 지운다(개발용 Redis에서만). 안 지우면 completed에 앞 숫자가 섞이고, 같은 jobId가 이미 있어 새 job이 안 들어간다
docker compose exec redis redis-cli FLUSHALL
```

```sh
# 터미널 1. 명령 앞의 MAIL_FAIL_RATE=1이 .env의 0보다 우선한다
PORT=4000 MAIL_FAIL_RATE=1 node --env-file=.env dist/main.js | tee fail.log
# 터미널 2. 재시도 간격이 0.5초·1초·2초라 job 하나가 failed로 가기까지 5초쯤 걸린다. 그래서 8초 기다린다
node scripts/order-burst.mjs 5 8000
node scripts/queue-stats.mjs
```

```sh
{ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 5 }
WARN [MailQueue] 메일 job order-email-1 실패(4회째) — 재시도 소진, failed로 이동: 메일 서버 일시 오류(kim@example.com)
```

job은 사라지지 않고 failed 목록에 남는다. 메일 서버가 복구되면 다시 돌릴 수 있다.

### 작업 4. failed job을 다시 돌리는 스크립트 만들기

```js
// scripts/retry-failed.mjs
// 재시도를 다 쓰고 failed에 쌓인 job을 다시 대기열로 돌려보낸다(메일 서버가 복구된 뒤에 쓴다)
// 사용법: node scripts/retry-failed.mjs
import { Queue } from "bullmq";
import { Redis } from "ioredis";

process.loadEnvFile();
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("mail", { connection });
const before = await queue.getFailedCount();
await queue.retryJobs({ state: "failed" });
console.log(`failed에 있던 job ${before}개를 다시 대기열로 보냈습니다`);
await queue.close();
await connection.quit();
```

메일 서버가 "복구"된 상황을 만든다. 터미널 1의 `MAIL_FAIL_RATE=1` 서버를 **먼저 끄고**, `.env`의 값(`MAIL_FAIL_RATE=0`)으로 다시 띄운다.

실패 서버를 끄지 않으면 두 가지가 꼬인다.

- 새 서버가 같은 4000번을 잡으려다 `EADDRINUSE`로 죽는다.

- 살아 있는 실패 서버의 워커가 다시 돌린 job을 집어 또 실패시키고, job은 그대로 failed로 돌아간다. `메일 발송` 로그는 끝내 안 나온다.

```sh
# 터미널 1. 실패 서버를 Ctrl+C로 끈 뒤
PORT=4000 node --env-file=.env dist/main.js | tee retry.log
# 터미널 2
node scripts/retry-failed.mjs
node scripts/queue-stats.mjs
grep "메일 발송:" retry.log
```

```sh
failed에 있던 job 5개를 다시 대기열로 보냈습니다
{ waiting: 0, active: 0, delayed: 0, completed: 5, failed: 0 }
LOG [FakeMailer] 메일 발송: kim@example.com — 주문 #6 확인 (시도 5)
... (주문 #7 ~ #10도 한 줄씩, 모두 시도 5)
```

- 로그 앞의 `[Nest] <프로세스 번호>  - <시각>`은 실행할 때마다 다르다. 뒷부분만 맞춰 본다.

- 주문 번호가 `#6`~`#10`이 아니라면 실험 시작 전에 seed를 하지 않은 것이다. 동작에는 문제가 없고 번호만 다르다.

- `retry-failed.mjs`가 `job 0개`라고 하면 failed에 아무것도 없었던 것이다. 바로 앞 실험의 `queue-stats.mjs`가 `failed: 5`였는지, 그 사이에 `FLUSHALL`을 하지 않았는지 본다.

- `job 5개`라고 했는데 `메일 발송` 로그가 없다면, 다른 서버(끄지 않은 실패 서버)가 job을 가져간 것이다. `lsof -iTCP:4000 -sTCP:LISTEN`으로 떠 있는 서버를 본다.

`시도 5`인 이유는 `attemptsMade`가 다시 돌려도 0으로 돌아가지 않고 이어서 세기 때문이다.

### 실험 | 같은 이벤트를 두 번 넣으면

outbox는 "적어도 한 번"이라 같은 이벤트가 다시 발행될 수 있다고 했다. 일부러 그 상황을 만든다.

```sql
-- 이미 보낸 이벤트 5건을 "아직 안 보냄"으로 되돌린다 → relay가 다시 집어서 다시 큐에 넣는다
UPDATE outbox_events SET published_at = NULL;
```

```sh
LOG [OutboxRelay] outbox 이벤트 5건 발행
{ waiting: 0, active: 0, delayed: 0, completed: 5, failed: 0 }    # 여전히 5
메일 발송 로그: 여전히 5통
```

relay는 5건을 다시 큐에 넣었지만 메일은 더 나가지 않았다.

`jobId`를 `order-email-<이벤트 id>`로 고정했기 때문에, BullMQ가 같은 id의 job이 이미 있으면 새로 만들지 않는다. `02`의 멱등성 키를 큐에서 다시 만난 것이다.

> 끝난 job을 Redis에서 지우는 설정(`removeOnComplete`)을 켜면, 지운 뒤에는 같은 id로 다시 들어갈 수 있다. 중복을 막아 주는 기간은 끝난 job을 얼마나 남겨 두느냐로 정해진다.

알림은 한 번 더 나갔는데, 이건 `02`에서 본 대로 받는 쪽이 `eventId`로 거른다.

### 작업 5. 서버 두 대에서

두 서버를 띄우고 주문 40개를 만들면, 두 워커가 일을 나눠 갖는다.

`MailQueue`는 서버마다 하나씩 만들어지므로, 서버가 두 대면 같은 `mail` 큐를 바라보는 워커도 두 개다.

앞 실험들의 job이 큐에 남아 있으면 `completed` 숫자가 섞이므로 큐를 비우고 시작한다.

```sh
# 떠 있는 서버를 모두 끈다(Ctrl+C). 아무것도 출력되지 않아야 한다
lsof -iTCP:4000 -iTCP:4001 -sTCP:LISTEN
# 큐를 비운다(개발용 Redis에서만)
docker compose exec redis redis-cli FLUSHALL # OK
npm run build
```

이번에는 서버마다 메일을 몇 통 보냈는지 세야 하므로, 로그를 서버별 파일로 남긴다.

```sh
# 터미널 1. 서버 A
PORT=4000 node --env-file=.env dist/main.js | tee a.log
# 터미널 2. 서버 B
PORT=4001 node --env-file=.env dist/main.js | tee b.log
```

주문은 `order-burst.mjs`로 A에만 보낸다. 큐는 Redis에 하나뿐이라, 주문을 어느 서버로 받았는지와 상관없이 두 워커가 같이 꺼내 간다.

```sh
# 터미널 3
node scripts/order-burst.mjs 40 8000
node scripts/queue-stats.mjs
# 파일이 여러 개면 grep -c는 파일마다 따로 센다
grep -c "메일 발송:" a.log b.log
```

```sh
주문 40개 → 받은 알림 40번(서로 다른 주문 40개)
{ waiting: 0, active: 0, delayed: 0, completed: 40, failed: 0 }
a.log:20
b.log:20
```

- 두 숫자의 합이 주문 수(40)와 같다. 같은 job을 두 워커가 모두 처리했다면 합이 40보다 크다.

- 20/20은 자주 나오지만 보장된 값은 아니다. 큐는 차례로 나눠 주지 않고, 손이 빈 워커가 먼저 꺼내 간다. 지금은 두 워커의 조건(동시 5개, 한 통 0.3초)이 같아서 꺼내 가는 속도도 거의 같고, 그래서 반반에 가깝게 나온다.

  조건이 달라지면 쏠린다. B만 `PORT=4001 MAIL_CONCURRENCY=1 node --env-file=.env dist/main.js | tee b.log`로 띄우면 B가 한 번에 1통만 들고 있으므로, 대략 5:1(33/7 안팎)로 갈린다.

  한쪽이 0이면 그 서버의 워커가 돌고 있지 않은 것이다(로그의 `Redis 연결 오류`, `MailQueue`가 만들어졌는지).

- 메일 한 통에 0.3초, 워커마다 동시에 5개(`MAIL_CONCURRENCY`)이므로 40통이 대략 `40 × 0.3초 ÷ (2대 × 5)` ≈ 1.2초에 끝난다. 서버 한 대였다면 그 두 배다.

확인이 끝나면 두 서버를 끈다. `a.log`, `b.log`는 `.gitignore`의 `*.log`에 걸려 커밋되지 않는다.

워커를 늘리려면 서버를 늘리면 된다.

같은 큐를 바라보는 워커들이 job을 하나씩 꺼내 가고, 같은 job을 둘이 동시에 꺼내는 일은 BullMQ가 막는다.

### 남길 것

- **찾아보면 되는 것**: `queue.add`의 옵션(`jobId`, `attempts`, `backoff`), `getJobCounts`의 상태 이름, `retryJobs`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 느리거나 실패하는 외부 작업은 트랜잭션 안에서 하지 않고 큐에 "넣기만" 한다. 넣는 쪽은 Redis에 한 번 쓰는 시간이면 끝나고, 재시도는 큐가 맡는다.

  - `jobId`를 outbox 이벤트 id로 고정하면, outbox의 "적어도 한 번"이 큐에서 "한 번"으로 줄어든다. 중복을 막는 기간은 끝난 job이 Redis에 남아 있는 동안이다.

  - `attempts`는 처음 시도를 포함한 전체 횟수이고, `concurrency`는 동시에 기다리는 Promise 수이지 스레드 수가 아니다.

- **에러 신호**:

  - `BullMQ: Your redis options maxRetriesPerRequest must be null.` → `Worker`에 넘긴 ioredis 연결의 옵션

  - `MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20)` → 기본 설정의 ioredis 연결이 Redis가 없는 동안 명령을 포기했다

  - `메일 job ... 실패(4회째) — 재시도 소진, failed로 이동` → 외부 서비스가 계속 실패한다. 복구 뒤 `retry-failed.mjs`

  - `queue-stats.mjs`의 `delayed`가 계속 는다 → 재시도가 밀리고 있다(외부 서비스 상태)

  - `Nest can't resolve dependencies of the OutboxRelay (PrismaService, NotificationsGateway, ?)` → `OutboxModule`의 `imports`에 `QueueModule`이 있는지, `QueueModule`이 `MailQueue`를 `exports`하는지

## 6. 5단계: 리더 선출로 정리 작업은 한 대에서만

`03`의 도전 과제였던 "오래된 `refresh_tokens` 지우기"를 주기적으로 돌린다고 하자. 지금 구조에서는 이 타이머가 서버마다 하나씩 뜬다.

서버가 10대면 같은 `DELETE`가 주기마다 10번 돈다. 결과가 틀리지는 않지만(지울 게 없으면 0건), 서버를 늘릴수록 DB에 쓸데없는 부하가 늘어난다.

정리 작업, 정산, 보고서 생성처럼 한 번만 돌아야 하는 일은 서버 중 하나에게만 맡겨야 한다.

`02`의 `FOR UPDATE`는 행을 잠갔다.

여기에는 잠글 행이 없다. "정리 작업을 돌릴 권리"는 테이블의 어떤 행도 아니기 때문이다.

이럴 때 쓰는 것이 advisory lock이다.

### 작업 1. psql 두 개로 advisory lock 성질 확인

먼저 `psql` 두 개로 성질을 확인한다. 터미널 두 개에서 각각 `docker compose exec db psql -U order -d order_api`로 들어간다.

```sh
# 세션 1
order_api=# SELECT pg_advisory_lock(42);
 pg_advisory_lock 
------------------

# 세션 2
order_api=# SELECT pg_try_advisory_lock(42) AS got_it;
 got_it
--------
 f

order_api=# SELECT pg_advisory_unlock(42) AS unlocked; # 남의 잠금을 풀어 보려 한다
WARNING:  you don't own a lock of type ExclusiveLock
 unlocked
----------
 f

order_api=# SELECT pid, locktype, objid, mode, granted FROM pg_locks WHERE locktype = 'advisory';
 pid | locktype | objid |     mode      | granted
-----+----------+-------+---------------+---------
 205 | advisory |    42 | ExclusiveLock | t

# 세션 1을 \q로 끝낸 뒤, 세션 2에서
order_api=# SELECT count(*) FROM pg_locks WHERE locktype = 'advisory';
 count
-------
     0
```

세 가지를 확인했다.

- 다른 세션은 그 잠금을 얻지도 풀지도 못한다.

- 잠금은 연결(세션)에 속한다.

- 연결이 끊기면 저절로 풀린다.

0장 개념 4의 `flock`과 같은 성질이다.

### 용어 | advisory lock 함수

- `pg_advisory_lock(키)`: 숫자 키에 잠금을 건다. 이미 누가 잡고 있으면 풀릴 때까지 기다린다(0장 개념 4의 `flock`에서 `LOCK_NB`를 뺀 것).
- `pg_try_advisory_lock(키)`: 기다리지 않고 바로 `true`/`false`를 돌려준다(`LOCK_NB`를 붙인 것). 같은 세션에서 다시 부를 때의 동작은 아래 "같은 세션에서 두 번 잠그면 두 번 풀어야 한다"에서 다룬다.
- `pg_advisory_unlock(키)`: 내가 건 잠금을 푼다. 남의 잠금이면 경고와 함께 `false`가 나온다.
- `pg_locks`: 지금 걸린 잠금을 보여 주는 시스템 뷰다. `locktype = 'advisory'`로 advisory lock만 거른다.

### 개념 | 같은 세션에서 두 번 잠그면 두 번 풀어야 한다

세션 수준 advisory lock은 같은 연결에서 다시 걸면 실패하지 않고 `true`가 나온다. 이미 내 잠금이기 때문이다.

대신 PostgreSQL은 몇 번 걸었는지를 세어 두고, **건 횟수만큼 풀어야** 실제로 풀린다.

```sql
-- 같은 psql 세션 하나에서
SELECT pg_try_advisory_lock(42) AS first, pg_try_advisory_lock(42) AS second;
--  first | second
-- -------+--------
--  t     | t
SELECT pg_advisory_unlock(42); -- t, 하지만 아직 잠겨 있다(pg_locks에 1행)
SELECT pg_advisory_unlock(42); -- t, 이제 풀렸다(pg_locks에 0행)
SELECT pg_advisory_unlock(42); -- f, WARNING:  you don't own a lock of type ExclusiveLock
```

- 아래 `LeaderElection`은 리더가 된 뒤에는 `if (this.leader) return;`으로 다시 시도하지 않으므로 잠금이 한 번만 걸린다. 이 줄이 없으면 2초마다 `true`가 나오면서 잠금 횟수만 하나씩 쌓인다.

- 연결을 닫으면 횟수와 상관없이 전부 풀린다(`client.end()`, `kill -9`).

- "다른 세션은 얻지도 풀지도 못한다"는 위 실험 그대로다. 횟수는 잠금을 쥔 세션 안에서만 쌓인다.

> C로 치면 `flock`보다 재귀 뮤텍스(`PTHREAD_MUTEX_RECURSIVE`)에 가깝다. 같은 주인은 몇 번이고 다시 잠글 수 있고, 잠근 만큼 풀어야 한다.

### 개념 | 두 가지 함정

#### 1. 트랜잭션 수준 잠금(`pg_try_advisory_xact_lock`)으로는 부족하다.

이 잠금은 트랜잭션이 끝나면 풀리므로 "두 서버가 동시에 돌지 않는다"만 보장한다.

서버 A가 정리를 끝내고 커밋한 직후 서버 B가 같은 주기에 잠금을 얻어 또 돌 수 있다.

"한 대만 돈다"를 원하면 한 서버가 잠금을 계속 쥐고 있어야 한다. 그래서 세션 수준 잠금을 쓴다.

#### 2. Prisma(커넥션 풀)로 세션 잠금을 걸면 안 된다.

풀은 쿼리마다 쉬고 있는 아무 연결이나 준다. 잠금을 건 연결이 어느 것인지 알 수 없고, 위에서 본 대로 다른 연결로는 풀 수도 없다.

게다가 그 연결은 풀로 돌아가 다른 요청의 쿼리에 쓰인다. 잠금은 그 연결이 닫힐 때까지 남으니, 앱이 모르는 잠금이 풀 안의 어느 연결에 붙어 다니게 된다.

그래서 리더 선출에는 전용 연결 하나를 따로 연다.

### 작업 2. LeaderElection 만들기

```ts
// src/leader/leader-election.ts
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
// pg: 처음부터 설치돼 있던 PostgreSQL 드라이버. Prisma를 거치지 않고 연결 하나를 직접 다룬다
import pg from "pg";

// 아무 정수나 정해 두면 된다. 같은 숫자를 쓰는 쪽끼리 같은 잠금을 다툰다
const LEADER_LOCK_KEY = 726_001;

// 여러 서버 인스턴스 중 "하나만" 리더가 되게 한다
// 리더가 죽으면(연결이 끊기면) 잠금이 풀리고, 다음 시도에서 다른 인스턴스가 리더가 된다
@Injectable()
export class LeaderElection implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LeaderElection.name);
  private client?: pg.Client;
  private timer?: NodeJS.Timeout;
  private leader = false;

  get isLeader() {
    return this.leader;
  }

  onApplicationBootstrap() {
    void this.tryBecomeLeader();
    this.timer = setInterval(() => void this.tryBecomeLeader(), 2000); // 리더가 아니면 2초마다 다시 도전한다
  }

  private async tryBecomeLeader() {
    if (this.leader) return;
    try {
      // Prisma의 커넥션 풀이 아니라 "전용 연결"을 쓴다
      if (!this.client) {
        this.client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        // 연결이 끊기면 잠금도 사라졌으므로 리더 자격을 내려놓는다
        this.client.on("error", () => this.stepDown("DB 연결 오류"));
        this.client.on("end", () => this.stepDown("DB 연결 종료"));
        await this.client.connect();
      }
      const { rows } = await this.client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LEADER_LOCK_KEY]);
      if (rows[0].ok) {
        this.leader = true;
        this.logger.log(`리더가 됐다(pid ${process.pid}, PORT ${process.env.PORT})`);
      }
    } catch (err) {
      this.stepDown(`리더 시도 실패: ${(err as Error).message}`);
    }
  }

  private stepDown(reason: string) {
    if (this.leader) this.logger.warn(`리더 자격 상실 — ${reason}`);
    this.leader = false;
    this.client = undefined; // 다음 시도에서 새 연결을 만든다
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    const client = this.client;
    this.client = undefined;
    this.leader = false;
    await client?.end(); // 연결을 닫으면 잠금도 함께 풀린다
  }
}
```

### 작업 3. TokenCleanupJob과 LeaderModule 만들고 등록하기

```ts
// src/leader/token-cleanup.job.ts
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { LeaderElection } from "./leader-election.js";

// 만료된 지 하루가 지난 refresh token을 지운다. 리더 인스턴스에서만 돈다
// 회수(revoked)된 토큰은 만료 전까지 지우지 않는다 — 앞에서 만든 재사용 탐지는 회수된 행이 남아 있어야 사슬을 통째로 회수할 수 있다
@Injectable()
export class TokenCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TokenCleanupJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.CLEANUP_INTERVAL_MS ?? 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader) return; // 리더가 아니면 아무것도 안 한다
    // 한 번에 너무 많이 지우면 잠금이 길어지고 로그가 몰린다 → LIMIT으로 나눠서 지운다
    // $executeRaw는 영향받은 행 수를 돌려준다
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM refresh_tokens WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE expires_at < now() - interval '1 day'
        LIMIT 1000)`;
    if (deleted > 0) this.logger.log(`토큰 정리: ${deleted}건 삭제`);
  }
}
```

```ts
// src/leader/leader.module.ts
import { Module } from "@nestjs/common";
import { LeaderElection } from "./leader-election.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";

@Module({ providers: [LeaderElection, TokenCleanupJob] })
export class LeaderModule {}
```

`app.module.ts`의 `imports`에 `LeaderModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 LeaderModule만 추가한다
import { LeaderModule } from './leader/leader.module.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`LeaderModule`이 `imports`에 없으면 파일이 있어도 두 클래스가 만들어지지 않는다. 에러 없이 서버가 뜨지만 어느 서버에도 `리더가 됐다`가 찍히지 않는다.

`TokenCleanupJob`이 `LeaderElection`을 주입받는 것은 둘이 같은 모듈의 `providers`에 있어서다. 서버마다 `LeaderElection`이 하나씩 있고, 그 서버의 `TokenCleanupJob`은 자기 서버의 `isLeader`만 본다.

### 작업 4. 리더 한 대만 도는지, 죽으면 넘어가는지 확인

#### 리더 확인

확인을 위해 정리 주기를 1초로 줄여 두 서버를 띄운다. 로그인을 세 번 해서 refresh token을 만든 뒤 만료된 것처럼 바꾼다.

```sh
npm run build
PORT=4000 CLEANUP_INTERVAL_MS=1000 node --env-file=.env dist/main.js # 터미널 1
PORT=4001 CLEANUP_INTERVAL_MS=1000 node --env-file=.env dist/main.js # 터미널 2
# 터미널 3. 로그인 3번 → refresh token 3개(비밀번호는 .env의 DEMO_PASSWORD)
for i in 1 2 3; do curl -s -o /dev/null -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'; done
docker compose exec db psql -U order -d order_api -c "UPDATE refresh_tokens SET expires_at = now() - interval '2 days'"
```

```sh
# 터미널 1 (4000)
LOG [LeaderElection] 리더가 됐다(pid 35517, PORT 4000)
LOG [TokenCleanupJob] 토큰 정리: 3건 삭제

# 터미널 2 (4001)
(리더 관련 로그 없음)
```

```sh
docker compose exec db psql -U order -d order_api

order_api=# SELECT a.pid, l.objid, l.granted, a.state FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype = 'advisory';

 pid | objid  | granted | state
-----+--------+---------+-------
 223 | 726001 | t       | idle
```

리더의 전용 연결이 잠금을 쥔 채 `idle`로 쉬고 있다.

#### 리더를 `kill -9`로 죽이기

이제 리더를 비정상 종료시킨다. 정상 종료가 아니라 `kill -9`이므로 `onModuleDestroy`도 돌지 않는다.

```sh
# lsof -t: 그 포트를 쓰는 프로세스의 pid만 출력한다
kill -9 $(lsof -tiTCP:4000 -sTCP:LISTEN)
```

```sh
# 터미널 2 (4001). 2초 안에
LOG [LeaderElection] 리더가 됐다(pid 35519, PORT 4001)
```

프로세스가 죽자 운영체제가 소켓을 닫았고, PostgreSQL이 연결 종료를 알아채 잠금을 풀었다. 서버 B가 다음 시도에서 리더가 됐다.

정리 작업은 언제나 한 대에서만, 그러나 그 한 대가 죽어도 멈추지 않고 돈다.

### 용어 | pg API

- `new pg.Client({ connectionString })`: 풀이 아닌 연결 하나를 만든다. `client.connect()`로 실제로 연결한다.

- `client.query<T>(SQL, [값])`: SQL을 실행하고 `{ rows }`를 돌려준다. `$1`은 두 번째 인자 배열의 첫 값으로 채워진다.

- `client.on("error" | "end", 함수)`: 연결에 오류가 나거나 연결이 끝났을 때 호출된다.

- `client.end()`: 연결을 닫는다. 이 연결이 쥔 세션 잠금도 함께 풀린다.

### 개념 | 이 방식의 한계

리더의 DB 연결이 네트워크 문제로 조용히 끊기면, PostgreSQL이 그걸 알아채기까지 시간이 걸린다.

그 사이 옛 리더는 아직 자기가 리더라고 믿고, DB는 새 리더에게 잠금을 줄 수 있다. 짧은 순간 리더가 둘이 될 수 있다는 뜻이다.

> 그래서 리더가 하는 일은 두 번 돌아도 결과가 틀리지 않게(이 문서의 `DELETE`처럼) 짜는 것이 안전하다. 같은 일을 BullMQ의 반복 job(정해진 주기마다 job을 하나만 만들어 워커 하나가 처리하게 하는 기능)으로 대신할 수도 있다.

### 작업 5. 비교: Redis 락으로 했다면

리더 선출이나 "한 번에 하나만" 같은 잠금은 Redis로도 많이 건다.

Redis 명령 하나 `SET key value NX PX ttl`이 "키가 없을 때만 만들고(`NX`), ttl 뒤에 저절로 사라지게(`PX`)"를 원자적으로 해 주기 때문이다.

advisory lock과 무엇이 다른지, 같은 상황에서 둘을 나란히 돌려 본다.

#### 상황

일꾼 셋(A, B, C)이 같은 작업을 잠금으로 다툰다. 잠금을 잡은 일꾼은 작업하는 동안 이벤트 루프가 통째로 멈춘다.

GC나 무거운 계산으로 프로세스가 잠깐 얼어붙은 상황이다. 멈춰 있는 동안에는 잠금을 연장하는 코드도 돌 수 없다.

- A: 0ms에 시작, 2500ms 멈춘다. Redis 잠금의 TTL(2000ms)보다 길다

- B: 50ms에 시작, 1500ms 일한다. TTL 안에 끝난다

- C: 2200ms에 늦게 시작, 1500ms 일한다

방식은 셋이다. 각 일꾼이 잠금을 쥐고 일한 구간이 서로 겹쳤는지 센다.

- `redis-naive`: Redis 잠금을 아무 확인 없이 `DEL`로 푼다

- `redis-safe`: 내 잠금일 때만 푼다

- `pg`: 이 단계의 advisory lock

#### lock-race.mjs 만들기

```js
// scripts/lock-race.mjs
// 같은 "한 번에 하나만 해야 하는 작업"을 일꾼 셋(A, B, C)이 잠금으로 다툰다(상황은 본문 참고)
// 사용법: node scripts/lock-race.mjs <redis-naive | redis-safe | pg>
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import pg from "pg";

process.loadEnvFile();
const MODE = process.argv[2];
const TTL_MS = 2000; // Redis 잠금의 유효 시간
const PLAN = { A: { delay: 0, hold: 2500 }, B: { delay: 50, hold: 1500 }, C: { delay: 2200, hold: 1500 } };
const KEY = "lock:cleanup";
const PG_KEY = 726003;

// 부모 프로세스: 일꾼 셋을 동시에 띄우고, 각자가 잠금을 쥐고 있던 구간이 겹쳤는지 센다
if (!process.env.WORKER) {
  if (MODE !== "pg") await new Redis(process.env.REDIS_URL).del(KEY).then(() => {});
  const t0 = Date.now();
  const spans = [];
  await Promise.all(["A", "B", "C"].map((name) => new Promise((resolve) => {
    const child = fork(process.argv[1], [MODE], { env: { ...process.env, WORKER: name, T0: String(t0) } });
    child.on("message", (m) => { if (m.span) spans.push({ name, ...m.span }); else console.log(m.log); });
    child.on("exit", resolve);
  })));
  const overlaps = [];
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const [a, b] = [spans[i], spans[j]];
    if (a.from < b.to && b.from < a.to) overlaps.push(`${a.name}·${b.name} (${Math.max(a.from, b.from)}~${Math.min(a.to, b.to)}ms)`);
  }
  console.log(`\n=> 동시에 작업한 구간: ${overlaps.length ? overlaps.join(", ") : "없음"}`);
  process.exit(0);
}

// 일꾼 프로세스
const name = process.env.WORKER;
const { delay, hold } = PLAN[name];
const t = () => Date.now() - Number(process.env.T0);
const log = (msg) => process.send({ log: `${String(t()).padStart(5)}ms  ${name}: ${msg}` });
const freeze = (ms) => { const end = Date.now() + ms; while (Date.now() < end); }; // 이벤트 루프를 통째로 막는다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(delay);

if (MODE === "pg") {
  // advisory lock: 잠금을 건 "연결"이 살아 있는 동안 유지된다
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [PG_KEY]);
    if (rows[0].ok) {
      const from = t(); log(`잠금 획득 → 작업 시작(${hold}ms 멈춤)`);
      freeze(hold);
      const to = t(); await client.query("SELECT pg_advisory_unlock($1)", [PG_KEY]);
      log("작업 끝 → 잠금 해제"); process.send({ span: { from, to } });
      break;
    }
    await sleep(100);
  }
  await client.end();
} else {
  const redis = new Redis(process.env.REDIS_URL);
  const token = `${name}-${randomUUID()}`; // 내 잠금임을 알아볼 값
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await redis.set(KEY, token, "PX", TTL_MS, "NX")) {
      const from = t(); log(`잠금 획득(TTL ${TTL_MS}ms) → 작업 시작(${hold}ms 멈춤)`);
      freeze(hold);
      const to = t();
      if (MODE === "redis-naive") {
        const deleted = await redis.del(KEY); // 누구 잠금인지 확인하지 않고 지운다
        log(`작업 끝 → DEL ${deleted ? "(누군가의 잠금을 지웠다)" : "(이미 없었다)"}`);
      } else {
        // 값이 내 token일 때만 지운다. 확인과 삭제를 Lua 스크립트 하나로 묶어 Redis 안에서 한 번에 실행한다
        const deleted = await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, KEY, token,
        );
        log(`작업 끝 → 내 잠금일 때만 삭제: ${deleted ? "삭제함" : "내 것이 아니라 안 지움"}`);
      }
      process.send({ span: { from, to } });
      break;
    }
    await sleep(100);
  }
  await redis.quit();
}
process.exit(0);
```

부모는 `fork()`로 자기 자신을 세 번 다시 실행한다. 환경변수 `WORKER`가 있으면 일꾼, 없으면 부모로 동작한다.

일꾼은 별도 프로세스라 한 일꾼의 `freeze`가 다른 일꾼을 멈추지 않는다. 서버 세 대가 따로 도는 것과 같은 모양이다.

#### 세 방식 돌리기

서버는 띄우지 않아도 된다. Redis와 PostgreSQL 컨테이너만 떠 있으면 된다.

```sh
node scripts/lock-race.mjs redis-naive
   82ms  A: 잠금 획득(TTL 2000ms) → 작업 시작(2500ms 멈춤)
 2091ms  B: 잠금 획득(TTL 2000ms) → 작업 시작(1500ms 멈춤)
 2583ms  A: 작업 끝 → DEL (누군가의 잠금을 지웠다)
 2592ms  C: 잠금 획득(TTL 2000ms) → 작업 시작(1500ms 멈춤)
 3592ms  B: 작업 끝 → DEL (누군가의 잠금을 지웠다)
 4093ms  C: 작업 끝 → DEL (이미 없었다)

=> 동시에 작업한 구간: A·B (2091~2582ms), B·C (2592~3591ms)

node scripts/lock-race.mjs redis-safe
   89ms  A: 잠금 획득(TTL 2000ms) → 작업 시작(2500ms 멈춤)
 2187ms  B: 잠금 획득(TTL 2000ms) → 작업 시작(1500ms 멈춤)
 2590ms  A: 작업 끝 → 내 잠금일 때만 삭제: 내 것이 아니라 안 지움
 3688ms  B: 작업 끝 → 내 잠금일 때만 삭제: 삭제함
 3721ms  C: 잠금 획득(TTL 2000ms) → 작업 시작(1500ms 멈춤)
 5222ms  C: 작업 끝 → 내 잠금일 때만 삭제: 삭제함

=> 동시에 작업한 구간: A·B (2187~2589ms)

node scripts/lock-race.mjs pg
   87ms  A: 잠금 획득 → 작업 시작(2500ms 멈춤)
 2590ms  A: 작업 끝 → 잠금 해제
 2592ms  B: 잠금 획득 → 작업 시작(1500ms 멈춤)
 4093ms  B: 작업 끝 → 잠금 해제
 4143ms  C: 잠금 획득 → 작업 시작(1500ms 멈춤)
 5645ms  C: 작업 끝 → 잠금 해제

=> 동시에 작업한 구간: 없음
```

세 번씩 돌려도 겹친 구간의 모양은 같았다. 두 가지 문제가 보인다.

쓰인 Redis 명령을 먼저 정리하고, 그 아래 "문제 ①"과 "문제 ②"에서 하나씩 본다.

### 용어 | Redis 명령 (잠금)

- `SET key value PX ttl NX`: 키가 없을 때만(`NX`) 값을 쓰고, ttl 밀리초 뒤 저절로 사라지게(`PX`) 한다. 명령 하나라 원자적이다. 아래 "`SET ... NX PX`: 확인, 쓰기, 만료를 명령 하나로"에서 다룬다.

- `DEL key`: 키를 지우고, 지운 개수를 돌려준다.

- `EVAL 스크립트 키개수 키... 인자...`: Lua 스크립트를 Redis 안에서 한 번에 실행한다. 아래 "`EVAL`: Lua 스크립트를 명령 하나처럼"에서 다룬다.

#### `SET ... NX PX`: 확인, 쓰기, 만료를 명령 하나로

ioredis에서는 `redis.set(KEY, token, "PX", TTL_MS, "NX")`로 쓴다.

잠금을 얻으면 `"OK"`, 이미 누가 쥐고 있으면 아무것도 하지 않고 `null`을 돌려준다. `lock-race.mjs`가 `if (await redis.set(...))`로 바로 분기할 수 있는 이유다.

```js
await redis.set("lock:cleanup", "A-1", "PX", 2000, "NX"); // "OK": A가 잠금을 얻었다
await redis.set("lock:cleanup", "B-1", "PX", 2000, "NX"); // null: 이미 있어서 아무것도 안 했다
await redis.pttl("lock:cleanup"); // 2000 이하의 값: 남은 수명(ms). 0이 되면 키가 사라진다
```

같은 일을 예전 명령 두 개로 나눠 쓰는 코드가 아직 많이 보인다.

```js
await redis.setnx("lock:cleanup", token); // 1: 잠금을 얻었다(이 시점에는 만료가 없다)
// 여기서 프로세스가 죽으면 다음 줄은 영영 실행되지 않는다
await redis.pexpire("lock:cleanup", 2000);
```

- 두 명령 사이에서 죽으면 키는 만료 없이(`TTL`이 `-1`) 남고, 누구도 그 잠금을 다시 얻지 못한다. 사람이 키를 지울 때까지 작업이 멈춘다.

- 명령 하나는 다른 명령과 섞이지 않으므로(0장 개념 2) `SET ... NX PX`에는 이런 틈이 없다.

> 원자성은 "잠금을 거는 순간"만 지켜 준다. 아래 문제 ①(TTL이 작업보다 짧다)은 이 명령을 써도 그대로 생긴다.

#### `EVAL`: Lua 스크립트를 명령 하나처럼

`redis.eval(스크립트, 키 개수, ...키, ...인자)`에서 두 번째 인자는 뒤의 값들 중 앞에서 몇 개가 키인지를 알려 준다.

그만큼이 `KEYS`로, 나머지가 `ARGV`로 들어간다. Lua 배열은 1부터 센다.

```js
const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
await redis.set("lock:cleanup", "A-1", "PX", 2000, "NX");
// 키 1개: KEYS[1] = "lock:cleanup", ARGV[1] = 비교할 token
await redis.eval(script, 1, "lock:cleanup", "B-1"); // 0: 값이 B의 token이 아니라 안 지웠다
await redis.eval(script, 1, "lock:cleanup", "A-1"); // 1: 내 token이라 지웠다(DEL이 돌려준 개수)
```

- 스크립트 안에서는 `redis.call(...)`로 Redis 명령을 부른다. 스크립트 전체가 끝날 때까지 다른 클라이언트의 명령은 끼어들지 못한다(0장 개념 2의 단일 스레드).

- 그래서 스크립트는 짧게 쓴다. 오래 도는 스크립트는 그동안 Redis 전체를 멈춘다(6단계 진단 2에서 `KEYS` 대신 `--scan`을 쓰는 것과 같은 이유).

- 키를 `ARGV`가 아니라 `KEYS`로 넘기는 것은 Redis Cluster가 명령을 어느 노드로 보낼지 키를 보고 정하기 때문이다. 서버 한 대에서도 규칙대로 쓴다.

> 확인과 삭제를 왜 묶어야 하는지는 아래 "문제 ② 남의 잠금을 지운다"에서 실제 결과로 본다.

### 개념 | 겹친 구간 읽기: Redis 락과 advisory lock

#### 문제 ① TTL이 작업보다 짧다(A·B)

A가 멈춘 사이 2000ms가 지나 잠금이 저절로 사라졌고, 기다리던 B가 잠금을 얻었다.

A는 멈춰 있었으니 자기가 잠금을 잃은 줄도 모르고, 깨어나서 작업을 마저 했다. 400ms 동안 두 일꾼이 동시에 일했다.

이건 내 잠금일 때만 풀기로 고쳐도 남는다(`redis-safe`에도 A·B가 있다).

> TTL을 길게 잡으면 줄지만, 프로세스가 얼마나 멈출지는 미리 알 수 없다. 잠금을 주기적으로 연장하는 방법도 멈춘 동안에는 연장 코드가 돌지 못하므로 같은 문제를 갖는다.

#### 문제 ② 남의 잠금을 지운다(B·C)

`redis-naive`에서 깨어난 A는 `DEL`로 잠금을 지웠다. 그런데 그 잠금은 이미 B의 것이었다.

잠금이 사라지자 늦게 온 C가 바로 잠금을 얻었고, 아직 일하던 B와 1000ms 넘게 겹쳤다. B도 끝나면서 C의 잠금을 지웠다.

`redis-safe`는 잠금 값에 "내 표시(token)"를 넣어 두고, Lua 스크립트로 "값이 내 token일 때만 지운다"를 Redis 안에서 한 번에 실행한다.

확인과 삭제를 두 명령으로 나누면 그 사이에 잠금이 바뀔 수 있어서다(`02`의 "읽고 → 판단하고 → 쓰기"와 같은 틈).

그 결과 A는 B의 잠금을 건드리지 않았고, C는 B가 끝난 뒤에야 들어왔다.

#### advisory lock(`pg`)은 겹치지 않았다

이 잠금에는 TTL이 없다. 잠금은 그 잠금을 건 연결에 묶여 있고, A가 멈춰 있는 동안에도 운영체제는 TCP 연결을 살려 둔다.

그래서 A가 깨어나 풀 때까지 아무도 들어오지 못했다.

대가도 있다. A가 멈춰 있는 2.5초 동안 B와 C는 그냥 기다렸다.

프로세스가 멈춘 채 죽지 않으면, 연결이 살아 있는 한 다른 누구도 일을 넘겨받지 못한다.

> Redis 락은 "멈춘 일꾼을 기다리지 않고 넘어간다" 대신 "둘이 동시에 일할 수 있다"를 받아들이고, advisory lock은 그 반대를 받아들인다.

| | Redis 락(`SET NX PX`) | advisory lock(세션) |
|---|---|---|
| 잠금이 풀리는 때 | TTL이 지나거나, 누가 지울 때 | 잠금을 건 연결이 풀거나 끊길 때 |
| 쥔 쪽이 멈추면 | TTL 뒤에 다른 쪽이 들어온다 → 동시에 일할 수 있다 | 아무도 못 들어온다 → 일이 멈춘다 |
| 쥔 쪽이 죽으면 | TTL 뒤에 풀린다 | 연결이 끊기는 즉시 풀린다(이 단계의 `kill -9`) |
| 반드시 할 것 | 내 잠금일 때만 풀기(Lua), TTL을 넉넉히 | 전용 연결 쓰기(풀 금지) |
| 필요한 것 | Redis | 이미 쓰는 PostgreSQL |

어느 쪽이든 **잠금만으로 "절대 둘이 동시에 하지 않는다"를 믿지 않는다.**

이 단계의 정리 작업처럼 두 번 돌아도 결과가 같게 짜거나, 작업이 쓰는 데이터 쪽에서 한 번 더 막는다(`02`의 조건부 `UPDATE`와 멱등성 키처럼).

이 문서의 리더 선출은 이미 PostgreSQL을 쓰고, 정리 작업이 DB를 고치는 일이라 advisory lock을 골랐다.

### 남길 것

- **찾아보면 되는 것**: `pg_advisory_lock` / `pg_try_advisory_lock` / `pg_advisory_unlock`, `pg_locks` 조회, `SET ... NX PX`와 `EVAL`의 인자 순서, 비교 표. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - "한 대만 돈다"는 잠금을 계속 쥐는 세션 수준 advisory lock으로, 그것도 풀이 아닌 전용 연결로 건다. 연결이 끊기면 잠금이 풀려 다른 서버가 이어받는다.

  - Redis 락은 TTL이 지나면 멈춘 주인을 두고 넘어가서 둘이 동시에 일할 수 있고, advisory lock은 멈춘 주인을 끝까지 기다린다. 어느 쪽이든 작업 자체를 두 번 돌아도 괜찮게 짠다.

- **에러 신호**:

  - `WARNING:  you don't own a lock of type ExclusiveLock` → 잠금을 건 연결과 다른 연결로 풀려 했다(커넥션 풀로 세션 잠금을 걸었는지)

  - 어느 서버에도 `리더가 됐다`가 찍히지 않고 `pg_locks`에 advisory 행이 없다 → `app.module.ts`의 `imports`에 `LeaderModule`이 있는지

  - `lock-race.mjs`의 `동시에 작업한 구간`이 `없음`이 아니다 → TTL보다 오래 멈췄는지(문제 ①), 남의 잠금을 지웠는지(문제 ②)

## 7. 6단계: 디버깅

### 진단 1. Redis 안을 들여다보기

```sh
# 구독 중인 채널 목록. socket.io 어댑터는 서버끼리 요청·응답을 주고받는 채널을 만든다
docker compose exec redis redis-cli PUBSUB CHANNELS '*'
socket.io-response#/#qC2HU_#
socket.io-response#/#hc5fMH#
socket.io-response#/#
socket.io-request#/#

# 패턴 구독 수. 방송은 "socket.io#/#*" 같은 패턴 구독으로 받는다
docker compose exec redis redis-cli PUBSUB NUMPAT
1
```

알림이 다른 서버로 안 넘어간다면, 먼저 `PUBSUB CHANNELS`에 `socket.io-` 채널이 있는지 본다.

> 없으면 어댑터가 붙지 않은 것이다(`main.ts`의 `useWebSocketAdapter`가 빠졌거나, 테스트처럼 `main.ts`를 거치지 않고 앱을 만든 경우).

### 진단 2. 큐 안을 들여다보기

```sh
# KEYS 대신 --scan을 쓴다. KEYS는 키가 많으면 Redis 전체를 잠깐 멈추게 한다
docker compose exec redis redis-cli --scan --pattern 'bull:mail:*'
bull:mail:completed
bull:mail:events
bull:mail:id
bull:mail:meta
bull:mail:order-email-1
bull:mail:stalled-check

# job 하나는 해시로 저장된다. 이름은 위 --scan 결과에 나온 것을 그대로 넣는다
docker compose exec redis redis-cli HGETALL bull:mail:order-email-1
name        order-email
data        {"to":"kim@example.com","orderId":6}
opts        {"jobId":"order-email-1","backoff":{"delay":500,"type":"exponential"},"attempts":4}
finishedOn  1791125852238
...
```

job 이름 끝의 숫자는 주문 번호가 아니라 outbox 이벤트 id다(`jobId: order-email-<이벤트 id>`). 위 예시의 `-1`은 seed 직후 처음 만든 이벤트라서 나온 번호다. 실습을 여러 번 했다면 `order-email-162`처럼 큰 번호가 나오고, `FLUSHALL`로 비운 뒤라면 그 전 번호의 job은 없다.

없는 키를 `HGETALL`하면 에러 없이 `(empty array)`가 나온다. 빈 결과가 나오면 `--scan` 목록에 그 이름이 있는지부터 본다.

`bull:<큐 이름>:<jobId>`가 job 하나이고, `completed`·`failed` 같은 키는 상태별 목록(정렬 집합)이다. `queue-stats.mjs`가 보여 주는 숫자가 이 목록들의 크기다.

- `delayed`가 계속 늘면 재시도가 밀리고 있는 것이다.

- `failed`가 늘면 외부 서비스가 계속 실패하고 있는 것이다.

### 진단 3. Redis가 꺼지면 어떻게 되는가

서버를 켜 둔 채 Redis만 끄고 주문을 만든다. 주문 번호(`#6`)와 job 이름(`order-email-1`)을 맞춰 보려면 처음 상태에서 시작한다.

```sh
# 떠 있는 서버를 모두 끈다(Ctrl+C). 아무것도 출력되지 않아야 한다
lsof -iTCP:4000 -iTCP:4001 -sTCP:LISTEN
# DB 번호를 1부터 다시 매기고, 큐도 비운다.
# 큐를 안 비우면 앞 실험의 order-email-1이 남아 있어서, 새 이벤트 1번의 job이 "이미 있는 jobId"로 무시된다
npx prisma db seed
docker compose exec redis redis-cli FLUSHALL
```

서버는 한 대만 띄우고, 나중에 로그를 찾을 수 있게 파일로 남긴다.

```sh
# 터미널 1
PORT=4000 node --env-file=.env dist/main.js | tee redis-down.log
```

터미널 2에서 Redis를 끄고, 주문 하나를 만든다. 로그인과 주문 생성은 DB만 쓰므로 Redis가 없어도 된다.

```sh
# 터미널 2
# stop은 컨테이너를 멈추기만 한다(지우지 않는다). 나중에 start로 그대로 다시 켠다
docker compose stop redis
TOKEN=$(curl -s -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
curl -s -X POST localhost:4000/orders \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"user":"kim","price":1000,"paid":true}'
```

```sh
{"id":6,"user":"kim","price":1000,"paid":true}
```

주문은 정상으로(201) 만들어졌다. 터미널 1에는 Redis 연결 경고가 반복된다.

```sh
WARN [MailQueue] Redis 연결 오류: read ECONNRESET
WARN [RedisIoAdapter] Redis 연결 오류: write EPIPE
WARN [MailQueue] Redis 연결 오류: connect ECONNREFUSED 127.0.0.1:6380
...
```

- `ECONNRESET`·`EPIPE`: 끊기는 순간 열려 있던 연결에서 난다. 한두 번 나온다.

- `ECONNREFUSED`: 끊긴 뒤 ioredis가 다시 접속하려다 거절당했다. Redis가 돌아올 때까지 반복된다.

8초쯤 기다린 뒤 outbox를 본다. relay가 0.5초마다 도는데도 이벤트가 발행되지 않았다.

```sh
# 터미널 2. psql은 DB 컨테이너라 Redis와 상관없이 붙는다
docker compose exec db psql -U order -d order_api -c "SELECT id, published_at FROM outbox_events"
```

```sh
 id | published_at
----+--------------
  1 |
(1 row)
```

이제 Redis를 다시 켜고, 몇 초 뒤 큐와 로그를 본다.

```sh
# 터미널 2
docker compose start redis
node scripts/queue-stats.mjs
grep -E "메일 발송:|outbox 이벤트|outbox 발행 실패" redis-down.log
docker compose exec db psql -U order -d order_api -c "SELECT id, published_at FROM outbox_events"
```

```sh
{ waiting: 0, active: 0, delayed: 0, completed: 1, failed: 0 }
... ERROR [OutboxRelay] outbox 발행 실패 - 다음 회차에 다시 시도합니다
  (... expired transaction. The timeout for this transaction was 5000 ms, however 12210 ms passed ...)
... LOG [FakeMailer] 메일 발송: kim@example.com — 주문 #6 확인 (시도 1)
... LOG [OutboxRelay] outbox 이벤트 1건 발행
 id |        published_at
----+----------------------------
  1 | 2025-10-12 19:02:41.513
(1 row)
```

- `completed: 1`, `메일 발송` 한 줄: 메일은 정확히 한 번 나갔다.

- `발행 실패` 로그는 Redis가 꺼져 있는 동안이 아니라 **다시 켠 직후**에 찍힌다. 그 회차는 `queue.add`에서 멈춰 있다가 Redis가 돌아온 뒤에야 다음 줄(`published_at` 기록)로 넘어갔고, 그때 이미 5초가 지난 트랜잭션이라 실패한 것이다. `12210 ms`는 Redis를 꺼 둔 시간에 따라 달라진다.

- 로그 순서(발행 실패 / 메일 발송 / 1건 발행)는 섞여 나올 수 있다. 워커와 relay가 따로 돌기 때문이다.

무슨 일이 있었는지 순서대로 보면 이렇다.

1. Redis가 꺼져 있는 동안 relay의 `queue.add`는 실패하지 않고 기다렸다(`maxRetriesPerRequest: null`이라 ioredis가 명령을 쥐고 재접속을 기다린다).

2. 그 사이 relay 트랜잭션은 5초를 넘겨 롤백됐고, 이벤트는 미발행으로 남았다.

3. Redis가 돌아오자 기다리던 `queue.add`가 실행되어 job이 생겼다.

4. 다음 회차의 relay가 같은 이벤트를 다시 넣었지만 `jobId`가 같아 무시됐다.

outbox(DB) + jobId(큐) 두 겹의 멱등성 덕분에, 장애 중에 들어온 주문도 메일이 빠지거나 두 번 나가지 않았다.

> `error` 핸들러를 달지 않으면 이 동안 `missing 'error' handler on this Redis client`라는 경고와 긴 스택이 쏟아진다. ioredis 연결과 BullMQ의 `Queue`·`Worker`에는 항상 `error` 핸들러를 단다.

### 진단 4. "Two different types with this name exist, but they are unrelated"

2단계에서 `RedisIoAdapter`를 처음 짤 때, `createIOServer(port: number, options?: ServerOptions)`처럼 `socket.io`에서 `ServerOptions`를 직접 import하면 이런 타입 에러가 난다.

```sh
Type 'AdapterConstructor' is not assignable to type 'AdapterConstructor'. Two different types with this name exist, but they are unrelated.
```

"같은 이름인데 서로 다른 타입"이라는 말은 거의 항상 같은 라이브러리가 두 벌 설치됐다는 뜻이다. 확인한다.

```sh
npm ls socket.io
├─┬ @nestjs/platform-socket.io@12.1.2
│ └── socket.io@4.8.3    # Nest가 정확히 이 버전을 고정해서 따로 설치됐다
└── socket.io@4.8.4    # WebSocket 게이트웨이를 만들 때 우리가 설치한 것
```

해결책은 두 가지다.

- 버전을 맞춰 한 벌로 합친다(`npm install socket.io@4.8.3`).

- 이 문서처럼 타입을 직접 import하지 않고 `Parameters<IoAdapter["createIOServer"]>`로 Nest가 쓰는 쪽에서 그대로 가져온다. 이쪽은 Nest가 버전을 바꿔도 따라간다.

### 진단 5. 리더가 누구인지 확인하기

```sql
-- advisory lock을 쥔 연결과, 그 연결이 어느 프로세스(클라이언트 주소)에서 왔는지
SELECT a.pid, a.client_addr, a.client_port, a.backend_start, l.objid
FROM pg_locks l JOIN pg_stat_activity a USING (pid)
WHERE l.locktype = 'advisory';
```

아무 행도 없으면 리더가 없는 것이다(모든 서버가 꺼졌거나, `LeaderModule`을 등록하지 않았다).

> 서버 로그에 `리더가 됐다`가 두 번 이상 연달아 찍혔다면 리더가 바뀐 것이니, 그 직전에 `리더 자격 상실` 로그나 DB 재시작이 있었는지 본다.

### 진단 6. 에러 신호·증상으로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `listen EADDRINUSE: address already in use :::4000` | 두 서버가 같은 포트를 잡으려 했다 | 두 번째 서버 명령 앞의 `PORT=4001` | 준비 |
| 받은 알림 수가 실행마다 10, 1, 0처럼 다른데 미발행 outbox는 0건 | 이벤트를 집은 서버에 받는 소켓이 없었다 | Redis 어댑터가 붙어 있는지(진단 1) | 1단계 |
| 어댑터를 붙였는데도 알림이 일부만 온다 | socket.io 서버가 기본 어댑터로 만들어졌다 | `main.ts`에서 `useWebSocketAdapter`가 `app.listen` 앞에 있는지, 다시 빌드했는지 | 2단계 |
| `Redis 연결 오류: ...`만 반복되고 포트가 안 열린다(`Failed to connect`) | `connectToRedis`가 `ready`를 기다리며 멈춰 있다 | Redis 컨테이너(`docker compose ps`) | 2단계 |
| `Type 'AdapterConstructor' is not assignable to type 'AdapterConstructor'. Two different types with this name exist, but they are unrelated.` | 같은 라이브러리가 두 벌 설치됐다 | `npm ls socket.io`, 타입을 직접 import했는지(진단 4) | 2단계 |
| `outbox 발행 실패 - 다음 회차에 다시 시도합니다` + `expired transaction. The timeout for this transaction was 5000 ms` | relay 트랜잭션이 시간 상한을 넘겨 롤백됐다 | 트랜잭션 안의 느린 외부 작업, Redis 상태(진단 3) | 3단계, 진단 3 |
| 받은 알림 횟수가 주문 수보다 많다 | 롤백된 회차가 같은 이벤트를 다시 보낸다 | relay 트랜잭션 안에서 하는 일 | 3단계 |
| `Nest can't resolve dependencies of the OutboxRelay (PrismaService, NotificationsGateway, ?)` | 세 번째 생성자 인자를 넣어 줄 프로바이더를 못 찾았다 | `OutboxModule`의 `imports`(`MailModule` 또는 `QueueModule`), 그 모듈의 `exports` | 3·4단계 |
| `BullMQ: Your redis options maxRetriesPerRequest must be null.` | `Worker`에 기본 설정의 ioredis 연결을 넘겼다 | `new Redis(url, { maxRetriesPerRequest: null })` | 4단계 |
| `MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20)` | Redis가 없는 동안 명령을 포기했다 | 그 연결의 `maxRetriesPerRequest`, Redis 상태 | 4단계 |
| `메일 job ... 실패(4회째) — 재시도 소진, failed로 이동` | 재시도를 다 썼다 | 외부 서비스 상태. 복구 뒤 `retry-failed.mjs` | 4단계 |
| `queue-stats.mjs`의 `delayed`가 계속 는다 | 재시도가 밀리고 있다 | 외부 서비스 상태(진단 2) | 4단계 |
| `WARNING:  you don't own a lock of type ExclusiveLock` | 잠금을 건 연결과 다른 연결로 풀려 했다 | 세션 잠금을 커넥션 풀로 걸었는지 | 5단계 |
| 어느 서버에도 `리더가 됐다`가 없고 `pg_locks`에 advisory 행이 없다 | `LeaderElection`이 만들어지지 않았다 | `app.module.ts`의 `imports`에 `LeaderModule` | 5단계, 진단 5 |
| `lock-race.mjs`의 `동시에 작업한 구간`이 `없음`이 아니다 | Redis 락의 TTL이 지났거나 남의 잠금을 지웠다 | TTL과 멈춘 시간, 내 잠금일 때만 푸는지 | 5단계 |
| `missing 'error' handler on this Redis client`와 긴 스택 | ioredis 연결에 `error` 핸들러가 없다 | 그 연결, `Queue`·`Worker`의 `on("error")` | 진단 3 |
| 서버 로그에 `리더가 됐다`가 연달아 찍힌다 | 리더가 바뀌었다 | 직전의 `리더 자격 상실` 로그, DB 재시작(진단 5) | 진단 5 |

### 시험해보기

```sh
npx prisma db seed
docker compose exec redis redis-cli FLUSHALL # 큐를 비운다(개발용 Redis에서만)
# 두 서버를 띄우고
node scripts/notify-check.mjs 10 4000 4001 # 10개
node scripts/queue-stats.mjs # completed가 만든 주문 수만큼, failed 0
```

### 도전 과제

#### 1. `removeOnComplete`를 켜고 중복 실험하기

`MailQueue`의 `queue.add`에 `removeOnComplete: true`를 넣고, 4단계의 "같은 이벤트를 두 번 넣으면" 실험을 다시 한다.

메일이 몇 통 나가는가? 중복을 막아 주는 기간과 Redis 메모리 사이의 균형을 생각해 본다.

> 확인이 끝나면 원복한다.

**답**

1. 주문 5개를 만들면 메일이 5통 나가고, `queue-stats.mjs`는 `completed: 0`을 보여 준다. 끝난 job이 바로 지워져서 `bull:mail:order-email-*` 키도 남지 않는다.

2. `UPDATE outbox_events SET published_at = NULL;`로 되돌리면 relay가 5건을 다시 큐에 넣는다. 같은 `jobId`의 job이 이미 지워졌으므로 새 job으로 들어가고, 메일이 5통 더 나간다(모두 `시도 1`, 합계 10통).

> 중복을 막아 주는 기간은 끝난 job이 Redis에 남아 있는 동안이다. 오래 남길수록 중복은 오래 막히지만, job 하나하나가 해시로 Redis 메모리를 차지한다.

#### 2. 리더를 차례로 죽이기

서버 세 대(4000, 4001, 4002)를 띄우고 리더를 차례로 `kill -9` 한다.

리더가 매번 남은 서버 중 하나로 넘어가는지, 마지막 한 대가 남았을 때도 정리 작업이 도는지 확인한다.

**답**

1. 처음 리더가 된 서버(4000)만 `토큰 정리` 로그를 찍는다.

2. 그 서버를 `kill -9` 하면 2초 안에 남은 두 대 중 하나가 `리더가 됐다`를 찍는다. 2초마다 다시 도전하는 타이머가 먼저 돈 쪽이 잡으므로, 4001과 4002 중 어느 쪽이 될지는 정해져 있지 않다.

3. 새 리더도 `kill -9` 하면 마지막 한 대가 리더가 된다. 로그인으로 refresh token을 만들어 만료시키면 이 서버가 `토큰 정리: N건 삭제`를 찍고, `pg_locks`에는 advisory lock(`726001`)을 쥔 연결이 하나만 보인다.

#### 3. 받는 쪽에서 중복 거르기

`scratch-client.mjs`에 `eventId`를 기억하는 `Set`을 두고, 이미 받은 이벤트를 무시하게 고친다.

4단계의 `UPDATE outbox_events SET published_at = NULL;`로 알림을 다시 보내게 만들어 중복이 걸러지는지 확인한다.

무엇이 출력되는가?

**답**

```js
// scratch-client.mjs
// order.created 핸들러를 바꾼다
const seen = new Set();
socket.on("order.created", (o) => {
  if (seen.has(o.eventId)) {
    console.log(`중복 무시: eventId ${o.eventId}(주문 #${o.id})`);
    return;
  }
  seen.add(o.eventId);
  console.log("알림:", o);
});
```

1. 클라이언트를 붙여 둔 채 주문 3개를 만들면 `알림: { eventId: 1, id: 6, ... }`처럼 세 번 찍힌다.

2. `UPDATE outbox_events SET published_at = NULL;`을 실행하면 relay가 같은 이벤트 3건을 다시 보낸다. 이번에는 `중복 무시: eventId 1(주문 #6)`처럼 세 줄만 찍히고 알림으로 처리되지 않는다.

### 남길 것

- **찾아보면 되는 것**: `PUBSUB CHANNELS`, `PUBSUB NUMPAT`, `--scan --pattern`, `HGETALL`, `pg_locks`와 `pg_stat_activity`를 잇는 쿼리. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 알림이 안 넘어가면 Redis의 채널(진단 1)을, 메일이 밀리면 큐의 상태별 목록(진단 2)을, 정리 작업이 안 돌면 `pg_locks`(진단 5)를 먼저 본다. 층마다 들여다볼 창이 따로 있다.

  - Redis가 꺼져도 주문은 된다. outbox(DB)와 `jobId`(큐)가 두 겹으로 받쳐서, 돌아온 뒤에 메일이 빠지거나 두 번 나가지 않는다.

- **에러 신호**:

  - `missing 'error' handler on this Redis client`와 긴 스택 → ioredis 연결과 `Queue`·`Worker`에 `error` 핸들러를 달았는지

  - 서버 로그에 `리더가 됐다`가 연달아 찍힌다 → 직전의 `리더 자격 상실` 로그, DB 재시작

## 8. 완성 확인

### 체크리스트

- [ ] 서버 두 대에서 어댑터 없이 알림이 사라지는 것을 재현했고, Redis 어댑터로 10/10이 됐다

- [ ] relay 안에서 메일을 보내면 트랜잭션 시간 초과로 끝없이 재전송되는 것을 재현했다

- [ ] BullMQ로 옮긴 뒤 실패한 메일이 재시도되고, 재시도를 다 쓴 job은 failed에 남아 다시 돌릴 수 있다

- [ ] 같은 outbox 이벤트를 다시 발행해도 메일은 한 번만 나간다(`jobId`)

- [ ] 리더가 한 대만 정리 작업을 돌리고, 리더를 `kill -9` 하면 다른 서버가 이어받는다

- [ ] Redis 락에서 TTL보다 오래 멈추면 둘이 동시에 일하는 것과, 남의 잠금을 지우는 것을 따로 재현했다. advisory lock은 겹치지 않는 대신 멈춘 동안 아무도 일하지 못하는 것을 확인했다

- [ ] Redis를 껐다 켜도 그 사이 주문의 메일이 빠지거나 두 번 나가지 않는다

## 9. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 어댑터 없이 서버 두 대일 때, outbox 이벤트는 전부 "발행됨"인데 알림이 사라진 이유는?

2. Redis 어댑터를 붙이면서 게이트웨이 코드를 한 줄도 안 고쳐도 된 이유는?

3. 3단계에서 주문 20개에 알림이 38번 나간 과정을 트랜잭션 시간 상한과 연결해서 설명하면?

4. 작업 큐가 "넣는 쪽"에게 주는 것 두 가지는? 이 문서에서 relay가 얻은 것은?

5. `jobId`를 outbox 이벤트 id로 고정하면 무엇이 막히는가? `removeOnComplete`와는 어떤 관계인가?

6. 트랜잭션 수준 advisory lock으로는 "한 대만 돈다"를 보장할 수 없는 이유는? 세션 잠금을 Prisma 풀로 걸면 안 되는 이유는?

7. 리더가 `kill -9`로 죽었는데도 잠금이 풀린 이유를 `flock`과 비교해서 설명하면?

8. Redis 락에서 "내 잠금일 때만 풀기"로 고쳐도 남는 겹침은 왜 생기는가? advisory lock에서는 같은 상황이 어떻게 달라지는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- Redis 자체의 고가용성(복제, Sentinel, Cluster)과 데이터 영속화(RDB/AOF). 지금 Redis가 죽으면 큐의 job은 메모리와 함께 사라질 수 있다

- 잠금에 순번(fencing token)을 붙여, 늦게 깨어난 옛 주인의 쓰기를 데이터 쪽에서 거절하는 방법

- Redis 여러 대에 동시에 잠금을 거는 방식(Redlock)과 그 논쟁

- Redis를 캐시로 쓰기(조회 결과 캐싱, 만료와 무효화)

- 요청 횟수 제한(rate limit)을 Redis 카운터로 구현하기

- BullMQ의 우선순위, 그룹별 동시성 제한, 작업 흐름(부모-자식 job), 관리용 대시보드

- 워커를 API 서버와 다른 프로세스로 분리해 따로 배포·확장하기
