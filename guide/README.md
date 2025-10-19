# 파일 업로드: presigned URL로 브라우저가 저장소에 직접 올리기

## 목표

이 프로젝트는 [`05-frontend-state`](https://github.com/seungwoo7050/node-order/tree/05-frontend-state)로부터 시작한다.

상품에 이미지를 붙인다. 지금까지 요청 본문은 전부 작은 JSON이었는데, 이미지는 수백 KB에서 수 MB다.

이 문서는 **파일 바이트가 우리 API 서버를 거치지 않게** 만든다.

1. 우리 서버는 "이 파일을 올려도 된다"는 서명된 URL(presigned URL)만 발급한다

2. 브라우저가 그 URL로 오브젝트 저장소(S3)에 직접 올린다

3. 우리 서버는 실제로 올라간 파일을 확인한 뒤에만 상품에 연결한다

4. 올라갔지만 아무도 가리키지 않는 파일(고아)은 `04`의 리더가 주기적으로 지운다

```sh
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
# ① upload-url → 201 { key: 'products/1/87528612-1f8c-40a7-a175-0d3d6319335d.png', expiresIn: 60 }
# ② 저장소 PUT → 200
# ③ confirm → 201 products/1/87528612-1f8c-40a7-a175-0d3d6319335d.png

# 확장자는 .png지만 내용은 HTML인 파일. 저장소까지는 올라가도, 확인 단계에서 거절된다
node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1 image/png
# ③ confirm → 400 이미지 파일이 아니다
```

> 시작 기준점:  
> `05`의 `order-api-nest`(PostgreSQL, Redis, 리더 선출)와 `order-console-next`(TanStack Query, `authFetch`)를 이어 쓴다.  
> 시드 사용자 `kim`과 `.env`의 `DEMO_PASSWORD`로 로그인한다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 7단계에서 "어느 층에서 틀어졌나"를 가르는 절차 | 친다(`node`, `curl`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 7단계(디버깅)만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 7단계 "진단 6"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 9·10장은 체크리스트와 자가 점검이라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 파일 업로드에 대한 사전지식](#0-파일-업로드에-대한-사전지식) | 오브젝트 저장소, 바이트 복사, presigned URL, 고아 파일을 C와 JWT에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | RustFS 저장소를 compose에 띄우고 SDK와 `.env`를 준비한다 |
| [2. 1단계: 저장소 연결](#2-1단계-저장소-연결) | `products.image_key`를 만들고, 버킷과 CORS를 준비하는 `StorageService`를 붙인다 |
| [3. 2단계: 업로드 URL 발급](#3-2단계-업로드-url-발급) | 형식·크기를 검사하고 `Content-Type`까지 서명한 업로드 URL을 내준다 |
| [4. 3단계: "다 올렸다"를 그대로 믿지 않는다](#4-3단계-다-올렸다를-그대로-믿지-않는다) | confirm에서 저장소에 직접 물어 크기와 매직 넘버를 확인하고, 목록에 읽기 URL을 붙인다 |
| [5. 4단계: 브라우저에서 올리기](#5-4단계-브라우저에서-올리기) | `/shop`에 업로더를 붙이고, 버킷 CORS를 깨뜨려 본다 |
| [6. 5단계: 고아 파일 정리](#6-5단계-고아-파일-정리) | 아무도 가리키지 않는 오래된 파일을 리더가 지운다 |
| [7. 6단계: e2e 테스트](#7-6단계-e2e-테스트) | Playwright로 업로드 성공과 가짜 이미지 거절을 확인한다 |
| [8. 7단계: 디버깅](#8-7단계-디버깅) | 저장소 내용, URL의 서명, 저장소 에러 코드, CORS 사전 요청을 직접 본다 |
| [9. 완성 확인](#9-완성-확인) | 시험해보기와 체크리스트 |
| [10. 다음 단계](#10-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 파일 업로드에 대한 사전지식

### 개념 1 | 파일은 DB가 아니라 오브젝트 저장소에 둔다.

C 프로그램이 큰 데이터를 다룰 때 구조체 안에 통째로 넣지 않고, 파일로 저장한 뒤 구조체에는 경로만 들고 있는 것과 같다.

이미지 바이트를 PostgreSQL에 넣으면 DB가 커지고, 백업이 느려지고, 조회할 때마다 큰 덩어리가 오간다.

오브젝트 저장소(대표적으로 AWS S3)는 "키(이름) → 바이트 덩어리"를 아주 많이, 싸게 저장하는 서버다.

S3(Simple Storage Service)는 원래 AWS의 서비스 이름이다. 그런데 S3가 먼저 널리 쓰이면서 그 HTTP API(버킷 만들기, `PUT`/`GET`으로 객체 올리고 받기, 서명 방식)가 사실상의 표준이 됐고, 다른 저장소들(MinIO, RustFS, Cloudflare R2 등)이 같은 API를 흉내 낸다.

그래서 이 문서에서 "S3"는 두 가지로 쓰인다. AWS의 그 서비스를 가리킬 때와, "S3와 같은 API로 말하는 저장소"(S3 호환 저장소)를 가리킬 때다. 코드의 `S3Client`, `.env`의 `S3_*`는 뒤쪽 뜻이다. API가 같으니 어느 저장소든 같은 코드로 붙는다.

폴더처럼 보이는 `products/1/abc.png`도 사실은 그 문자열 전체가 키 하나다.

> 이 문서에서 DB의 `products.image_key`에는 그 키만 들어간다.

### 개념 2 | 우리 서버를 거치면 바이트가 두 번 복사된다.

가장 단순한 방법은 브라우저가 우리 API로 파일을 보내고(multipart), API가 그걸 받아 다시 저장소로 보내는 것이다.

C로 치면 `read()`로 사용자 버퍼에 다 읽어 들인 다음 `write()`로 다른 소켓에 쓰는 것과 같다.커널 안에서 바로 넘기는 `sendfile()` 같은 방법이 있는데도 굳이 한 번 더 복사하는 셈이다.

업로드가 몰리면 API 서버의 메모리와 대역폭이 파일 크기만큼 묶이고, 그동안 이벤트 루프도 바빠진다.

presigned URL은 이 복사를 없앤다. 우리 서버는 "이 키에, 이 타입·이 크기로, 60초 안에 PUT 해도 된다"는 허가증만 서명해서 건넨다.

**바이트는 브라우저에서 저장소로 바로 간다.**

저장소는 서명을 검증할 수 있으므로(서명에 쓴 비밀 키를 공유한다), 우리 서버에 물어보지 않고도 그 요청이 허가받은 것인지 안다.

### 개념 3 | presigned URL은 `03`의 JWT와 닮았다.

서명이 있고, 만료 시각이 있고, **한 번 내주면 회수할 수 없다.**

그래서 JWT의 액세스 토큰처럼 짧게(여기서는 60초) 준다.

> URL 자체가 권한이므로, 로그나 화면에 남기지 않는다.

### 개념 4 | DB와 저장소 사이에는 트랜잭션이 없다.

"저장소에 파일 쓰기"와 "DB에 키 쓰기"는 서로 다른 시스템이라 하나의 트랜잭션으로 묶을 수 없다. `02`의 outbox에서 본 것과 같은 문제다.

파일은 올라갔는데 DB 연결 전에 사용자가 창을 닫거나 서버가 죽으면, 저장소에 아무도 가리키지 않는 파일이 남는다.

이걸 막을 수는 없으니, 5단계에서 **나중에 찾아서 지우는** 쪽으로 설계한다.

## 1. 준비

### 개념 | 저장소: MinIO 대신 RustFS

로컬에서 S3 대신 쓰는 저장소로 흔히 MinIO를 쓴다.

이 문서를 쓰는 시점에 MinIO의 공식 이미지(`minio/minio`, `quay.io/minio/minio`)는 Docker Hub와 quay.io 모두에서 받을 수 없었다(`pull access denied`).

AWS 에뮬레이터인 LocalStack의 최신 이미지도 실행하면 라이선스를 요구하며 종료했다.

그래서 MinIO와 같은 방식(S3 API는 9000번, 웹 콘솔은 9001번)으로 동작하는 RustFS를 쓴다.

> 코드는 AWS 공식 SDK(`@aws-sdk/client-s3`)로 짜므로, 저장소만 바꾸면 실제 S3에도 그대로 붙는다.

SDK(Software Development Kit)는 어떤 서비스를 코드에서 쉽게 쓰라고 그 서비스 쪽에서 만들어 주는 라이브러리 묶음이다. 여기서는 AWS가 만든 npm 패키지다.

S3 API는 결국 HTTP 요청이라, SDK 없이 `fetch`로도 부를 수는 있다. 하지만 요청 하나마다 직접 해야 할 일이 많다.

- URL과 헤더를 S3 규칙대로 조립한다

- 비밀 키로 요청 전체에 서명한다(서명 버전 4. 정해진 순서로 헤더를 정렬하고 HMAC-SHA256을 여러 번 계산한다)

- XML로 오는 응답과 에러를 파싱한다

SDK는 이걸 함수 호출 하나로 감싸 준다. 우리는 "어느 버킷의 어느 키를 지워라"만 적고, 서명과 HTTP는 SDK가 처리한다.

C로 치면 PostgreSQL의 통신 규약을 소켓에 직접 쓰는 대신 `libpq`의 `PQexec()`를 부르는 것과 같다. 이 프로젝트에서 SQL 대신 Prisma를 쓰는 것도 같은 이유다.

### 작업 1. compose에 저장소를 추가하고 SDK 설치

```yaml
# docker-compose.yml
# services 아래, redis 다음에 storage를 추가한다
  # rustfs: S3와 같은 API를 쓰는 오브젝트 저장소. 로컬에서 AWS S3 대신 쓴다
  storage:
    image: rustfs/rustfs:latest
    environment:
      RUSTFS_ACCESS_KEY: localaccess # S3의 액세스 키 ID에 해당(학습용 값)
      RUSTFS_SECRET_KEY: localsecret123 # S3의 비밀 액세스 키에 해당(학습용 값)
    ports:
      - "9000:9000" # S3 API
      - "9001:9001" # 웹 콘솔(브라우저로 버킷과 파일을 볼 수 있다)
    volumes:
      - storagedata:/data
```

포트를 두 개 여는 것은 컨테이너 하나 안에서 서버가 두 개 돌기 때문이다. 건물 하나에 문이 두 개 있다고 보면 된다. 하나는 물건이 드나드는 문이고, 하나는 사람이 둘러보는 문이다.

| 포트 | 누가 쓰나 | 무엇이 오가나 |
|---|---|---|
| `9000` (S3 API) | 프로그램 | 파일 바이트 자체. "이 키로 이 파일을 저장해라", "이 키의 파일을 달라" 같은 요청 |
| `9001` (웹 콘솔) | 사람 | 버킷 목록과 파일 목록을 보여 주는 관리 화면(HTML) |

`9000`에 오는 것은 이 문서에서 코드가 보내는 요청 전부다.

- 우리 API 서버가 SDK로 보내는 요청(버킷 만들기, 파일 확인, 삭제). `.env`의 `S3_ENDPOINT=http://localhost:9000`이 이 문을 가리킨다.
- 브라우저가 presigned URL로 보내는 `PUT`. 발급된 URL이 `http://localhost:9000/product-images/...`로 시작하는 것이 그래서다.

`9001`은 우리가 눈으로 확인할 때만 쓴다. `psql`로 DB 안을 들여다보듯, 브라우저로 `http://localhost:9001`을 열어 파일이 정말 올라갔는지 보는 창이다.

코드는 `9001`을 한 번도 부르지 않는다. 그래서 `"9001:9001"` 줄을 지워도 업로드는 그대로 되고, 콘솔 화면만 못 열게 된다. 반대로 `"9000:9000"`을 지우면 서버가 저장소에 닿지 못해 시작부터 실패한다.

`"9000:9000"`의 왼쪽은 내 컴퓨터(호스트)의 포트, 오른쪽은 컨테이너 안의 포트다. 앞 단계의 PostgreSQL이 `"5433:5432"`(컨테이너 안 5432를 내 컴퓨터의 5433으로 연다)였던 것과 같은 형식이다. 저장소는 양쪽을 같은 번호로 맞췄을 뿐이다.

파일 맨 아래 `volumes`에 저장소가 쓸 볼륨 이름을 하나 더 적는다.

```yaml
# docker-compose.yml
# 맨 아래 volumes에 storagedata 한 줄을 추가한다
volumes:
  pgdata:
  storagedata:
```

```sh
cd order-api-nest
docker compose up -d
# @aws-sdk/client-s3: S3 API를 부르는 공식 SDK, @aws-sdk/s3-request-presigner: presigned URL을 만드는 도구
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

`docker compose ps`에 `storage`가 떠 있고, 브라우저로 `http://localhost:9001`이 열리면 된다.

콘솔은 로그인 화면부터 나온다. 아이디와 비밀번호는 따로 만든 계정이 아니라, compose에 적은 두 값이다.

- 아이디(Access Key): `RUSTFS_ACCESS_KEY`의 값 `localaccess`
- 비밀번호(Secret Key): `RUSTFS_SECRET_KEY`의 값 `localsecret123`

우리 서버의 SDK도 `.env`의 `S3_ACCESS_KEY`/`S3_SECRET_KEY`로 같은 두 값을 쓴다. 그래서 compose와 `.env`의 값이 한 글자라도 다르면, 콘솔 로그인은 되는데 서버는 서명이 틀렸다는 에러(`SignatureDoesNotMatch`)를 받는다.

> `latest` 태그를 쓰므로, 나중에 저장소 동작이 이 문서와 달라지면 `rustfs/rustfs:<버전>`으로 고정한다.

### 작업 2. `.env`에 저장소 설정 추가

`S3_*` 값은 위의 compose와 맞춘 학습용 값이다. 실제 S3의 키는 `03`에서 본 비밀 값과 똑같이 다룬다.

```sh
# .env
# 맨 아래에 추가한다. FRONTEND_URL은 앞 단계부터 있던 값을 1단계의 버킷 CORS에서 그대로 쓴다
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=localaccess
S3_SECRET_KEY=localsecret123
S3_BUCKET=product-images
# 이미지 최대 크기(바이트, 2MB), 업로드 URL 유효 시간(초)
MAX_IMAGE_BYTES=2097152
UPLOAD_URL_TTL_SECONDS=60
# 5단계 고아 파일 정리: 이보다 오래된 고아만 지운다(초), 정리 주기(ms)
ORPHAN_MIN_AGE_SECONDS=3600
ORPHAN_CLEANUP_INTERVAL_MS=600000
```

`2097152`(2 × 1024 × 1024), `600000`(10 × 60 × 1000)처럼 숫자를 계산된 값으로 적는다. `.env`는 계산을 하지 않는 단순한 `이름=문자열` 파일이라서, `MAX_IMAGE_BYTES=2*1024*1024`라고 쓰면 코드는 `"2*1024*1024"`라는 문자열을 받는다.

```js
Number("2097152");      // 출력: 2097152
Number("2*1024*1024");  // 출력: NaN
2000000 > NaN;          // 출력: false (NaN과의 비교는 항상 false)
```

마지막 줄이 위험한 지점이다. 2단계의 크기 검사 `dto.size > MAX_IMAGE_BYTES`가 언제나 `false`가 되어, 에러 없이 **크기 제한이 조용히 꺼진다.**

반대로 2단계 코드의 기본값 `2 * 1024 * 1024`는 JS 식이라 곱셈이 실제로 계산된다. 그래서 읽기 쉬운 식은 코드 쪽에 두고, `.env`에는 계산된 숫자와 단위를 적은 주석(`# 2MB`)을 함께 둔다.

### 남길 것

- **찾아보면 되는 것**: RustFS 이미지 이름과 환경변수 이름(`RUSTFS_ACCESS_KEY`), SDK 패키지 두 개의 이름, 웹 콘솔 주소와 로그인 값(compose에 적혀 있다). 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 로컬 저장소는 실제 S3의 대역일 뿐이다. "S3"는 AWS의 서비스 이름이자 사실상 표준이 된 API라서, 코드가 AWS SDK와 `S3_*` 환경변수만 보게 해 두면 저장소를 바꿔도 코드는 그대로다.
  
  - 저장소의 두 포트는 쓰는 쪽이 다르다. `9000`(S3 API)은 프로그램이, `9001`(웹 콘솔)은 사람이 쓴다. 코드가 가리키는 곳은 `9000`뿐이다.
  
  - `.env`는 계산하지 않는 `이름=문자열` 파일이다. 숫자는 계산된 값으로 적는다. 식을 적으면 `Number()`가 `NaN`이 되어 검사가 에러 없이 꺼진다.

- **에러 신호**:
  
  - `pull access denied` → 그 이미지를 받을 수 없다. 같은 S3 API를 쓰는 다른 저장소 이미지로 바꾼다
  
  - 웹 콘솔 로그인이 안 된다 → compose의 `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` 값으로 넣었는지, compose를 고친 뒤 컨테이너를 다시 만들었는지
  
  - 2MB보다 큰 파일도 upload-url이 내준다 → `.env`의 `MAX_IMAGE_BYTES`가 식(`2*1024*1024`)이 아니라 계산된 숫자인지

## 2. 1단계: 저장소 연결

### 작업 1. Product에 imageKey 칸 추가

```prisma
// prisma/schema.prisma
// Product 모델에 imageKey 한 줄을 추가한다(나머지 필드는 줄만 맞췄다)
model Product {
  id       Int         @id @default(autoincrement())
  name     String
  price    Int
  stock    Int
  // 저장소(S3)에 올라간 이미지의 키. 파일 자체는 DB가 아니라 저장소에 있다
  imageKey String?     @map("image_key")
  items    OrderItem[]

  @@map("products")
}
```

```sh
npx prisma migrate dev --name add-product-image-key
npx prisma generate
```

생성된 SQL은 `ALTER TABLE "products" ADD COLUMN "image_key" TEXT;` 한 줄이다.

`String?`이라 기존 상품은 `NULL`로 채워지므로 데이터 문제는 없다.

### 작업 2. StorageService 만들기

S3를 다루는 코드는 한곳에 모은다. 다른 코드는 SDK를 직접 만지지 않는다.

```ts
// src/storage/storage.service.ts
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command,
  PutBucketCorsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

// S3(또는 S3와 같은 API를 쓰는 저장소)를 다루는 곳. 다른 코드는 S3 SDK를 직접 쓰지 않는다
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET!;
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT, // AWS S3를 쓸 때는 이 줄을 빼면 된다
    region: process.env.S3_REGION,
    forcePathStyle: true, // http://주소/버킷/키 형식. 로컬 저장소는 버킷을 도메인으로 쓰는 방식을 지원하지 않는다
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
    // presigned URL에 "빈 본문"의 체크섬이 박히지 않게, 꼭 필요한 요청에만 체크섬을 계산한다(7단계 진단 2)
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  async onModuleInit() {
    // 버킷이 없으면 만든다(개발 편의. 운영에서는 인프라 설정으로 미리 만들어 둔다)
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`버킷 생성: ${this.bucket}`);
    }
    // 브라우저가 이 버킷에 직접 PUT/GET 할 수 있게, 프론트 출처만 허락한다(4단계)
    await this.s3.send(new PutBucketCorsCommand({
      Bucket: this.bucket,
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: [process.env.FRONTEND_URL!],
          AllowedMethods: ["PUT", "GET"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 600,
        }],
      },
    }));
  }

  // 2~3단계에서 쓰는 메서드들(createUploadUrl, createDownloadUrl, head, readFirstBytes, delete)과
  // 5단계의 list는 아래에서 하나씩 추가한다
}
```

import 줄에는 뒤 단계에서 쓸 Command까지 미리 다 적어 두었다. 쓰지 않는 import는 지금은 경고도 에러도 아니다.

### 작업 3. StorageModule 만들고 등록하기

```ts
// src/storage/storage.module.ts
// PrismaModule처럼 앱 전체의 기반이라 @Global로 둔다
import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service.js";

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
```

`app.module.ts`의 `imports`에 `StorageModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 StorageModule만 추가한다
import { StorageModule } from './storage/storage.module.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, StorageModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

서버를 켜면 `버킷 생성: product-images`가 찍힌다. 버킷이 이미 있으면 `HeadBucketCommand`가 성공하므로 두 번째부터는 찍히지 않는다.

```sh
npm run start:dev
```

브라우저로 `http://localhost:9001/rustfs/console/`에 들어가 `localaccess` / `localsecret123`으로 로그인하면 버킷이 보인다.

`psql`이 DB를 들여다보는 창이었던 것처럼, 이 콘솔이 저장소를 들여다보는 창이다.

### 개념 | 전역 모듈과 `onModuleInit`

- `StorageModule`에 `@Global()`을 붙이고 `exports`에 `StorageService`를 적었다. 그래서 `AppModule`의 `imports`에 한 번만 넣으면, 다른 모듈은 자기 `imports`에 적지 않고도 생성자에서 `StorageService`를 받을 수 있다. 2단계의 `ProductImagesController`, 5단계의 `OrphanImageCleanupJob`이 그렇게 받는다.

- `AppModule`의 `imports`에서 빠지면 `StorageService`는 아예 만들어지지 않는다. 지금은 아무도 주입받지 않으니 에러 없이 서버가 뜨고, `버킷 생성` 로그만 안 찍힌다. 2단계에서 컨트롤러가 주입받기 시작하면 그때 `Nest can't resolve dependencies of the ProductImagesController (PrismaService, ?)`로 서버가 멈춘다.

- `onModuleInit()`은 Nest가 프로바이더를 만든 직후 부르는 생명주기 훅이다. Nest는 이 메서드가 돌려준 Promise를 기다린 뒤에 다음으로 넘어가므로, 버킷 준비와 CORS 설정이 끝나기 전에는 서버가 요청을 받기 시작하지 않는다.

- 그 대신 여기서 예외가 나면 서버 시작 자체가 실패한다. 저장소 컨테이너가 꺼져 있으면 `npm run start:dev`가 연결 에러로 멈추는 이유다.

### 용어 | S3 SDK API (클라이언트·버킷)

- `new S3Client({ ... })`: 저장소에 요청을 보내는 클라이언트를 만든다. `endpoint`를 주면 AWS가 아닌 S3 호환 저장소로 간다.
- `requestChecksumCalculation: "WHEN_REQUIRED"`: SDK는 기본으로 요청 본문의 체크섬을 계산해 붙인다. 이 값을 주면 꼭 필요한 요청에만 계산한다. 왜 꺼 두는지는 7단계 진단 2에서 직접 본다.
- `s3.send(new XxxCommand({ ... }))`: SDK v3는 작업마다 Command 객체를 만들어 `send`로 보낸다. 아래 "Command 객체와 `send`"에서 다룬다.
- `HeadBucketCommand` / `CreateBucketCommand`: 버킷이 있는지 묻는다(없으면 에러를 던진다) / 버킷을 만든다.
- `PutBucketCorsCommand`: 버킷의 CORS 규칙(허락할 출처, 메서드, 헤더)을 설정한다. 왜 필요한지는 4단계 "저장소의 CORS"에서 본다.

### 개념 | Command 객체와 `send`

SDK v3에서 "버킷이 있는가", "파일을 올려라" 같은 작업은 메서드가 아니라 요청 내용을 적은 객체(Command)로 표현한다.

Command를 만드는 것만으로는 아무 일도 일어나지 않는다. 그 객체를 `s3.send`에 넘겨야 HTTP 요청이 나간다.

```js
const cmd = new HeadBucketCommand({ Bucket: "product-images" });
console.log(cmd.input); // 출력: { Bucket: 'product-images' } (아직 요청은 나가지 않았다)

await s3.send(cmd); // 여기서 저장소로 HEAD 요청이 나간다
```

C로 치면 요청 구조체를 채워 두고(`struct request req = { ... }`) 그 포인터를 처리 함수에 넘기는 방식이다.

요청 내용과 "보내는 일"이 나뉘어 있어서, 2단계에서는 같은 종류의 Command를 `send` 대신 `getSignedUrl`에 넘겨 **보내지 않고 서명만** 하게 된다.

- 실패는 반환값이 아니라 예외로 온다. `onModuleInit`이 `HeadBucketCommand`를 `try/catch`로 감싼 이유다. "버킷이 없다"는 에러가 곧 "만들어야 한다"는 신호다.

- 이 `catch`는 저장소가 꺼져 있을 때도 걸린다. 그때는 이어지는 `CreateBucketCommand`도 같은 이유로 실패하므로, 서버는 시작하지 못하고 연결 에러를 낸다.

> Command는 "무엇을 할지", `send`는 "보내기"다. 이 둘이 나뉘어 있다는 것이 presigned URL을 가능하게 한다.

### 남길 것

- **찾아보면 되는 것**: `S3Client`의 옵션 이름(`forcePathStyle`, `requestChecksumCalculation`), 버킷 관련 Command 이름, CORS 규칙의 칸 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - SDK v3에서 Command는 요청 내용일 뿐이고, `send`에 넘겨야 요청이 나간다. 이 분리 덕분에 같은 Command로 "보내기" 대신 "서명만" 할 수 있다.
  
  - `onModuleInit`에서 저장소를 준비하면, 준비가 끝나기 전에는 서버가 요청을 받지 않는다. 대신 저장소가 꺼져 있거나 키가 틀리면 서버도 못 뜬다.
  
  - 컨테이너의 환경변수는 만들 때 정해진다. compose를 고쳐도 떠 있는 컨테이너는 옛 값을 쓰므로 `docker compose up -d`로 다시 만든다.

- **에러 신호**:
  
  - 서버가 뜨지 않고 `onModuleInit`에서 연결 에러 → `docker compose ps`로 `storage` 컨테이너가 떠 있는지, `S3_ENDPOINT`가 맞는지
  
  - 서버가 뜨지 않고 `onModuleInit`에서 `SignatureDoesNotMatch` → compose의 `RUSTFS_SECRET_KEY`와 `.env`의 `S3_SECRET_KEY`가 같은지. compose를 고쳤다면 `docker compose up -d`로 컨테이너를 다시 만들었는지(이미 떠 있는 컨테이너는 옛 값을 그대로 쓴다)
  
  - 처음 켰는데 `버킷 생성: product-images`가 안 찍히고 콘솔에도 버킷이 없다 → `app.module.ts`의 `imports`에 `StorageModule`이 있는지

## 3. 2단계: 업로드 URL 발급

### 작업 1. 허용 형식과 매직 넘버 표

허용하는 형식과, 그 형식의 "진짜 모습"을 한곳에 둔다(진짜 모습은 3단계에서 쓴다).

```ts
// src/products/image-signature.ts
// 파일 형식마다 맨 앞에 오는 고정된 바이트(매직 넘버). 확장자나 Content-Type은 아무나 바꿀 수 있지만, 내용은 속이기 어렵다
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export const ALLOWED_IMAGE_TYPES = Object.keys(SIGNATURES);
export const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function looksLike(contentType: string, firstBytes: Buffer): boolean {
  return SIGNATURES[contentType]?.(firstBytes) ?? false;
}
```

C에서 `file` 명령이 파일 종류를 알아내는 방법이 이것이다. 확장자를 보지 않고 첫 몇 바이트(매직 넘버)를 본다.

> PNG는 항상 `89 50 4E 47 0D 0A 1A 0A`로 시작한다(`xxd scripts/fixtures/pixel.png | head -1`로 직접 볼 수 있다. 파일은 작업 5에서 만든다).

### 작업 2. 요청 DTO

```ts
// src/products/product-image.dto.ts
import { IsIn, IsInt, IsPositive, IsString, Matches } from "class-validator";
import { ALLOWED_IMAGE_TYPES } from "./image-signature.js";

export class UploadUrlDto {
  @IsIn(ALLOWED_IMAGE_TYPES) contentType!: string; // 정해진 값 중 하나여야 한다
  @IsInt() @IsPositive() size!: number;
}

export class ConfirmImageDto {
  // 키의 모양을 먼저 거른다: products/숫자/UUID.확장자
  @IsString() @Matches(/^products\/\d+\/[0-9a-f-]{36}\.(png|jpg|webp)$/) key!: string;
}
```

### 작업 3. StorageService에 createUploadUrl 추가

```ts
// src/storage/storage.service.ts
// StorageService 클래스 안에 추가한다
  // 이 URL을 가진 사람은 expiresIn초 동안, 정확히 이 키·이 타입·이 크기로만 PUT 할 수 있다
  createUploadUrl(key: string, contentType: string, size: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      // SDK는 기본으로 Content-Type을 서명에 넣지 않는다 → 넣어야 다른 타입으로 올리는 요청이 거부된다(2단계)
      { expiresIn, signableHeaders: new Set(["content-type"]) },
    );
  }
```

### 작업 4. 업로드 URL 발급 컨트롤러

#### ProductImagesController

```ts
// src/products/product-images.controller.ts
import { randomUUID } from "node:crypto";
import { BadRequestException, Body, Controller, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { EXTENSIONS, looksLike } from "./image-signature.js";
import { ConfirmImageDto, UploadUrlDto } from "./product-image.dto.js";

export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 2 * 1024 * 1024); // 2MB
const UPLOAD_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 60);

// 실제 서비스라면 관리자만 쓸 수 있어야 한다. 여기서는 로그인만 요구한다
@Controller("products/:id/image")
@UseGuards(AuthGuard("jwt"))
export class ProductImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService, // StorageModule이 @Global이라 ProductsModule에 imports 없이 받는다
  ) {}

  // 1) "이 파일을 올려도 되는가"를 서버가 판단하고, 된다면 저장소에 직접 올릴 수 있는 URL을 내준다
  @Post("upload-url")
  async createUploadUrl(@Param("id", ParseIntPipe) id: number, @Body() dto: UploadUrlDto) {
    if (dto.size > MAX_IMAGE_BYTES) throw new BadRequestException(`이미지는 ${MAX_IMAGE_BYTES}바이트 이하여야 합니다`);
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    // 키는 서버가 정한다. 클라이언트가 고르면 남의 파일을 덮어쓸 수 있다
    const key = `products/${id}/${randomUUID()}.${EXTENSIONS[dto.contentType]}`;
    const uploadUrl = await this.storage.createUploadUrl(key, dto.contentType, dto.size, UPLOAD_URL_TTL_SECONDS);
    return { key, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS };
  }
}
```

import 줄의 `ConfirmImageDto`와 `looksLike`는 3단계의 confirm에서 쓴다. 코드 주석의 "관리자만"은 `03`의 도전 과제 1(관리자 Guard)을 가리킨다.

#### ProductsModule에 등록하기

```ts
// src/products/products.module.ts
// import 한 줄과 controllers 배열의 ProductImagesController만 추가한다
import { Module } from "@nestjs/common";
import { ProductImagesController } from "./product-images.controller.js";
import { ProductsController } from "./products.controller.js";

@Module({ controllers: [ProductsController, ProductImagesController] })
export class ProductsModule {}
```

여기에 빠지면 서버는 멀쩡히 뜨는데 `POST /products/1/image/upload-url`만 404가 난다.

### 작업 5. 업로드 스크립트와 시험 파일

#### 업로드 스크립트

브라우저가 하는 일을 순서대로 흉내 내는 스크립트로 확인한다(③ confirm은 3단계에서 만든다).

```js
// scripts/upload-image.mjs
// 상품 이미지를 "브라우저가 하는 순서 그대로" 올린다: ① 업로드 URL 받기 → ② 저장소에 직접 PUT → ③ 서버에 확인 요청
// 사용법: node scripts/upload-image.mjs <파일> [상품 id] [Content-Type]
//   node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
//   node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1 image/png
import { readFile } from "node:fs/promises";

process.loadEnvFile();
const API = "http://localhost:4000";
const [file, productId = "1", contentType = "image/png"] = process.argv.slice(2);
const body = await readFile(file);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();
const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

// ① 우리 서버에게: 이 타입, 이 크기의 파일을 올려도 되는가?
const res1 = await fetch(`${API}/products/${productId}/image/upload-url`, {
  method: "POST", headers: auth, body: JSON.stringify({ contentType, size: body.length }),
});
const step1 = await res1.json();
console.log("① upload-url →", res1.status, res1.ok ? { key: step1.key, expiresIn: step1.expiresIn } : step1.message);
if (!res1.ok) process.exit(1);

// ② 저장소에게 직접: 우리 서버는 이 파일의 바이트를 한 번도 거치지 않는다
const res2 = await fetch(step1.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body });
console.log("② 저장소 PUT →", res2.status, res2.ok ? "" : (await res2.text()).match(/<Code>(.*?)<\/Code>/)?.[1]);

// ③ 우리 서버에게: 다 올렸으니 확인하고 상품에 연결해 달라
const res3 = await fetch(`${API}/products/${productId}/image/confirm`, {
  method: "POST", headers: auth, body: JSON.stringify({ key: step1.key }),
});
const step3 = await res3.json();
console.log("③ confirm →", res3.status, res3.ok ? step3.key : step3.message);
```

#### 시험 파일 만들기

시험용 파일 두 개를 만든다. 하나는 1×1 픽셀짜리 진짜 PNG, 하나는 이름만 `.png`인 HTML이다.

```sh
mkdir -p scripts/fixtures
node -e 'require("fs").writeFileSync("scripts/fixtures/pixel.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","base64"))'
printf '<html><script>alert(1)</script></html>\n' > scripts/fixtures/not-an-image.png
```

이 두 줄은 외울 필요 없이 복사해서 붙이면 된다. 하는 일만 알면 된다.

- 첫 줄: `node -e '...'`는 따옴표 안의 JS 한 줄을 바로 실행한다. 긴 문자열은 1×1 PNG 파일의 바이트를 base64(바이너리를 글자로 적는 방법)로 적어 둔 것이고, `Buffer.from(..., "base64")`로 바이트로 되돌려 파일에 쓴다. 이미지 파일을 따로 내려받지 않으려고 쓴 방법이다.
- 둘째 줄: `printf '...' > 파일`은 그 글자를 그대로 파일에 쓴다. 이름만 `.png`일 뿐 내용은 HTML이다.

남겨야 할 감각은 "두 파일이 실제로 어떻게 다른가"다. 앞에서 본 `file` 명령과, 바이트를 16진수로 보여 주는 `xxd`로 직접 확인할 수 있다.

```sh
file scripts/fixtures/*.png
# scripts/fixtures/not-an-image.png: HTML document text, ASCII text
# scripts/fixtures/pixel.png:        PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced

xxd scripts/fixtures/pixel.png | head -1
# 00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR
xxd scripts/fixtures/not-an-image.png | head -1
# 00000000: 3c68 746d 6c3e 3c73 6372 6970 743e 616c  <html><script>al
```

`pixel.png`의 첫 8바이트 `89 50 4e 47 0d 0a 1a 0a`가 작업 1의 표에 적은 PNG 매직 넘버 그대로다. `not-an-image.png`는 `<html>`로 시작하므로, 3단계 확인에서 이 차이로 걸러진다.

#### 서버가 먼저 거르는 것

지금 돌리면 ①과 ②는 성공하고, ③은 아직 confirm이 없어 404다.

```sh
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
# ① upload-url → 201 { key: 'products/1/f6f1b17e-4cf6-4309-803e-0c36acf8902c.png', expiresIn: 60 }
# ② 저장소 PUT → 200
# ③ confirm → 404 Cannot POST /products/1/image/confirm
```

서버는 URL을 내주기 전에 크기와 형식을 거른다.

```text
5MB로 요청         → 400 이미지는 2097152바이트 이하여야 합니다
image/gif로 요청   → 400 ["contentType must be one of the following values: image/png, image/jpeg, image/webp"]
```

### 용어 | Node Buffer API

- `Buffer.from([0x89, ...])`: 바이트 값 배열로 Buffer를 만든다.

- `b.subarray(시작, 끝)`: 복사 없이 그 구간만 가리키는 Buffer를 돌려준다(끝은 포함하지 않는다). 아래 "`subarray`와 `equals`"에서 다룬다.

- `a.equals(b)`: 두 Buffer의 바이트가 모두 같은지 비교한다. `===`와의 차이는 아래 "`subarray`와 `equals`"에서 다룬다.

- `b.toString("ascii")`: 바이트를 ASCII 문자열로 읽는다.

### 개념 | `subarray`와 `equals`

Buffer는 Node가 바이트를 다루는 자료형이다. C의 `unsigned char` 배열처럼 칸마다 0~255 값 하나가 들어가고, `b[0] === 0xff`처럼 인덱스로 읽는다.

`subarray`는 새 배열을 만들지 않는다. C에서 `buf + 시작`으로 같은 메모리의 중간을 가리키는 포인터를 만드는 것과 같다.

그래서 잘라 낸 쪽을 고치면 원본도 바뀐다.

```js
const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const head = b.subarray(0, 4); // b의 앞 4바이트를 가리킬 뿐, 복사하지 않는다
head[0] = 0x00;
console.log(b[0]); // 출력: 0 (원본도 바뀌었다)
```

Buffer 두 개를 `===`로 비교하면 내용이 아니라 같은 객체인지를 본다.

C에서 배열 두 개를 `==`로 비교하면 주소를 비교하게 되어 내용은 `memcmp`로 비교해야 하는 것과 같은 이치다. `equals`가 Buffer의 `memcmp`다.

```js
const a = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const c = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
console.log(a === c); // 출력: false (다른 객체)
console.log(a.equals(c)); // 출력: true (바이트가 같다)
```

| 연산 | 하는 일 | C로 치면 |
|---|---|---|
| `b.subarray(s, e)` | 같은 메모리의 s번부터 e번 직전까지를 가리킨다 | `buf + s` |
| `a === c` | 같은 객체인가 | 포인터 비교 |
| `a.equals(c)` | 길이와 바이트가 모두 같은가 | 길이 비교 + `memcmp` |

- `subarray`는 끝 인덱스를 포함하지 않는다. `subarray(0, 8)`은 0~7번, 8바이트다. 3단계의 Range 요청은 반대로 끝을 포함한다.

- 원본과 떨어진 사본이 필요하면 `Buffer.from(b.subarray(...))`로 복사한다. 매직 넘버 검사는 읽기만 하므로 복사가 필요 없다.

> 매직 넘버 비교를 `===`로 쓰면 진짜 PNG를 넣어도 항상 `false`라 모든 이미지가 거절된다. 바이트 비교는 `equals`다.

### 용어 | S3 SDK API (presigned URL)

- `getSignedUrl(클라이언트, 명령, 옵션)`: 명령을 실제로 보내지 않고, 그 요청을 미리 서명한 URL을 만든다. 아래 "`getSignedUrl`은 저장소에 묻지 않는다"에서 다룬다.
- `expiresIn`: URL이 유효한 시간(초)이다.
- `signableHeaders`: 기본으로 서명하는 헤더 외에 서명에 더 넣을 헤더를 고른다. 이 옵션이 없으면 무슨 일이 생기는지는 아래 "일부러 깨뜨려보기 ①"에서 본다.
- `PutObjectCommand({ Key, ContentType, ContentLength })`: 파일을 올리는 요청이다. 여기 적은 값이 서명에 들어간다.

### 개념 | `getSignedUrl`은 저장소에 묻지 않는다

1단계에서 본 대로 Command는 요청 내용일 뿐이다.

`send`는 그것을 HTTP로 보내지만, `getSignedUrl`은 같은 요청을 비밀 키로 서명해서 **URL 문자열로만** 만든다. 서명(`AWS4-HMAC-SHA256`)은 우리 서버 안에서 계산하므로 저장소와 통신하지 않는다.

저장소를 끈 상태에서도 URL은 만들어진다.

```js
// 저장소(localhost:9000)를 끈 상태
const url = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: "product-images", Key: "products/1/a.png", ContentType: "image/png", ContentLength: 70 }),
  { expiresIn: 60, signableHeaders: new Set(["content-type"]) },
);
console.log(url);
// 출력(가운데를 줄임): http://localhost:9000/product-images/products/1/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&x-id=PutObject

await s3.send(new HeadBucketCommand({ Bucket: "product-images" })); // 이것은 저장소에 닿아야 하므로 연결 에러가 난다
```

0장 개념 2의 "저장소는 서명을 검증할 수 있다"의 나머지 반쪽이 이것이다.

서명하는 쪽(우리 서버)과 검증하는 쪽(저장소)은 같은 비밀 키를 가지고 있을 뿐, URL을 발급할 때 서로 연락하지 않는다.

- 그래서 저장소는 어떤 URL이 발급됐는지 모른다. 하나만 골라 취소할 방법이 없고(0장 개념 3의 "회수할 수 없다"), 만료 시간이 유일한 안전장치다.

- 저장소가 무엇을 검사할지는 서명에 넣은 값으로 정해진다. Command에 적은 `ContentType`, `ContentLength`와 `signableHeaders`가 그 목록이고, 실제로 들어간 헤더는 URL의 `X-Amz-SignedHeaders`로 보인다(7단계 진단 2).

- URL이 만들어졌다고 버킷 이름이나 비밀 키가 맞다는 뜻은 아니다. 틀렸다면 실제 PUT에서야 `NoSuchBucket`이나 `SignatureDoesNotMatch`로 드러난다(7단계 진단 3).

> presigned URL 발급은 저장소 호출이 아니라 문자열 계산이다. 그래서 빠르고, 저장소가 꺼져 있어도 성공한다.

### 개념 | 서명은 무엇을 계산하고, 저장소는 무엇을 비교하나

presigned URL의 쿼리에 붙은 값들은 암호화된 것이 아니라 그냥 읽히는 글자다. 7단계 진단 2에서 URL을 뜯어 그대로 읽을 수 있는 것도 그래서다.

비밀인 것은 하나뿐이다. 맨 끝의 `X-Amz-Signature`를 만들 때 쓴 비밀 키(`S3_SECRET_KEY`)다.

#### 서명을 만드는 순서

`getSignedUrl`이 우리 서버 안에서 하는 일은 이렇다. 이 방식을 AWS Signature Version 4(SigV4)라고 부른다.

1. 요청을 정해진 모양의 문자열 하나로 펼친다(canonical request). 메서드(`PUT`), 경로(`/product-images/products/1/...png`), `X-Amz-Signature`를 뺀 쿼리, `X-Amz-SignedHeaders`에 적힌 헤더들의 이름과 값, 본문 해시 자리가 줄 단위로 들어간다. presigned URL은 본문을 미리 알 수 없으므로 본문 해시 자리에 `UNSIGNED-PAYLOAD`를 적는다.

2. 이 문자열의 SHA-256 해시에 날짜와 범위(`날짜/us-east-1/s3/aws4_request`)를 붙여 "서명할 문자열"을 만든다.

3. 비밀 키에 날짜·리전·서비스 이름을 차례로 HMAC으로 섞어 서명용 키를 만들고, 그 키로 2의 문자열에 HMAC-SHA256을 한 번 더 건다. 그 결과가 `X-Amz-Signature`다.

HMAC은 "비밀 키를 섞은 해시"다. 같은 키와 같은 메시지면 항상 같은 값이 나오고, 키 없이는 맞는 값을 만들 수 없다.

#### 저장소가 검사하는 순서

PUT이 도착하면 저장소는 같은 계산을 다시 한다.

1. `X-Amz-Credential`의 앞부분(`localaccess`)으로 그 액세스 키의 비밀 키를 찾는다. compose의 `RUSTFS_SECRET_KEY`가 그것이다.

2. 지금 들어온 요청으로 canonical request를 다시 만든다. 이때 헤더 값은 URL을 만들 때의 값이 아니라 **지금 요청에 실려 온 값**을 쓴다.

3. 같은 방법으로 서명을 계산해 URL의 `X-Amz-Signature`와 비교한다. 다르면 `SignatureDoesNotMatch`다.

4. 서명과 별개로 `X-Amz-Date` + `X-Amz-Expires`가 지났으면 거절한다. 아래 "일부러 깨뜨려보기 ①"의 `AccessDenied`가 이것이다.

#### 그래서 생기는 일

- `Content-Type`을 `image/png`로 서명했는데 `text/html`로 보내면, 2번에서 펼친 문자열이 달라져 서명이 맞지 않는다. 서명에 넣지 않은 헤더는 2번 문자열에 아예 들어가지 않으므로 어떤 값이든 통과한다.

- `content-length`도 서명에 들어 있다. `fetch`는 본문 크기로 `Content-Length`를 자동으로 채우므로, ① upload-url에 알린 `size`와 실제 파일 크기가 다르면 거절된다. 업로더가 `file.size`를, 스크립트가 `body.length`를 그대로 보내는 이유다.

- 흔한 오해는 "URL을 숨기면 안전하다"다. URL의 내용은 누구나 읽을 수 있고, 지켜 주는 것은 위조할 수 없다는 점과 짧은 만료뿐이다. 그래서 URL 자체를 권한으로 다룬다(0장 개념 3).

> 저장소는 우리 서버에 아무것도 묻지 않는다. 같은 비밀 키로 같은 계산을 해 보고, 값이 같은지만 본다.

### 실험 | 일부러 깨뜨려보기 ①: 서명에 무엇이 들어갔나

`createUploadUrl`에서 `signableHeaders` 옵션을 빼고, 받은 URL로 다른 Content-Type(`text/html`)을 달아 PUT 해 본다.

```sh
X-Amz-SignedHeaders = content-length;host
다른 Content-Type(text/html)으로 PUT → 200
```

`image/png`로 허가받았는데 `text/html`로 올라갔다.

URL의 `X-Amz-SignedHeaders`(서명에 포함된 헤더 목록)를 보면 이유가 보인다. **`content-type`이 없다.**

AWS SDK v3는 presigned URL을 만들 때 기본으로 `Content-Type`을 서명에 넣지 않는다. 서명하지 않은 헤더는 저장소가 검사하지 않으니 아무 값이나 통과한다.

`signableHeaders: new Set(["content-type"])`을 넣으면 이렇게 바뀐다.

```sh
X-Amz-SignedHeaders = content-length;content-type;host
다른 Content-Type(text/html)으로 PUT → 403 SignatureDoesNotMatch
선언보다 큰 파일(5000B)로 PUT        → 403 SignatureDoesNotMatch
```

`ContentLength`는 처음부터 서명에 들어가 있었으므로 크기를 속이면 바로 거절된다.

만료도 확인한다. `UPLOAD_URL_TTL_SECONDS=2`로 서버를 켜고, URL을 받은 지 3초 뒤에 PUT 하면 이렇게 된다.

```sh
3000ms 뒤 PUT → 403 AccessDenied
```

확인했으면 `signableHeaders`를 되돌리고, `UPLOAD_URL_TTL_SECONDS`도 60으로 켠다.

### 남길 것

- **찾아보면 되는 것**: `getSignedUrl`의 옵션(`expiresIn`, `signableHeaders`), 형식별 매직 넘버 값, Buffer 메서드 이름, 시험 파일을 만드는 두 줄 명령. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - presigned URL은 저장소에 묻지 않고 우리 서버 안에서 계산한 문자열이다. 저장소는 서명에 들어간 것만 검사하므로, 지켜야 할 조건(타입·크기)은 반드시 서명에 넣는다. `X-Amz-SignedHeaders`가 그 목록이다.
  
  - 키는 서버가 정한다. 클라이언트에게 고르게 하면 남의 파일을 덮어쓸 수 있다.

- **에러 신호**:
  
  - `400 이미지는 2097152바이트 이하여야 합니다` / `contentType must be one of the following values: ...` → 서버가 URL을 내주기 전에 거른 것. 보낸 `size`와 `contentType`
  
  - `POST /products/1/image/upload-url`만 404 → `ProductsModule`의 `controllers`에 `ProductImagesController`가 있는지
  
  - `Nest can't resolve dependencies of the ProductImagesController (PrismaService, ?)` → `app.module.ts`의 `imports`에 `StorageModule`이 있는지
  
  - 저장소 PUT이 `403 SignatureDoesNotMatch` → 서명된 헤더(`Content-Type`, 크기)를 요청과 다르게 보냈는지
  
  - 저장소 PUT이 `403 AccessDenied` → URL이 만료됐는지(`UPLOAD_URL_TTL_SECONDS`)
  
  - 다른 `Content-Type`으로 PUT 했는데 200 → `X-Amz-SignedHeaders`에 `content-type`이 있는지(`signableHeaders`)

## 4. 3단계: "다 올렸다"를 그대로 믿지 않는다

presigned URL은 "올려도 된다"는 허가일 뿐, 실제로 올렸는지, 무엇을 올렸는지는 알려 주지 않는다.

클라이언트가 confirm을 보내면 서버가 **저장소에 직접 물어서** 확인한다.

### 작업 1. StorageService에 확인용 메서드 추가

```ts
// src/storage/storage.service.ts
// StorageService 클래스 안, createUploadUrl 다음에 추가한다
  createDownloadUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  // 올라간 파일의 크기와 타입. 없으면 null
  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? "" };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  // 파일의 앞부분만 읽는다. 전체를 내려받지 않고 "진짜 이미지인지"를 확인하는 데 쓴다
  async readFirstBytes(key: string, length: number): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
```

### 작업 2. confirm 엔드포인트

```ts
// src/products/product-images.controller.ts
// ProductImagesController 클래스 안, createUploadUrl 다음에 추가한다
  // 2) 클라이언트가 "다 올렸다"고 알려 오면, 저장소에 실제로 올라간 것을 확인한 뒤에야 상품에 연결한다
  @Post("confirm")
  async confirm(@Param("id", ParseIntPipe) id: number, @Body() dto: ConfirmImageDto) {
    // 다른 상품의 키를 가져와 자기 상품에 붙이는 것을 막는다
    if (!dto.key.startsWith(`products/${id}/`)) throw new BadRequestException("이 상품의 키가 아니다");
    const meta = await this.storage.head(dto.key);
    if (!meta) throw new BadRequestException("업로드된 파일이 없다");
    if (meta.size > MAX_IMAGE_BYTES) throw new BadRequestException("파일이 너무 크다");
    // Content-Type은 올린 쪽이 적어 보낸 값일 뿐이다 → 파일의 앞 12바이트로 진짜 그 형식인지 확인한다
    if (!looksLike(meta.contentType, await this.storage.readFirstBytes(dto.key, 12))) {
      await this.storage.delete(dto.key);
      throw new BadRequestException("이미지 파일이 아니다");
    }
    const before = await this.prisma.product.findUnique({ where: { id }, select: { imageKey: true } });
    await this.prisma.product.update({ where: { id }, data: { imageKey: dto.key } });
    // 이전 이미지는 더 이상 아무도 가리키지 않으므로 지운다
    if (before?.imageKey && before.imageKey !== dto.key) await this.storage.delete(before.imageKey);
    return { key: dto.key, imageUrl: await this.storage.createDownloadUrl(dto.key, 600) };
  }
```

검사는 싼 것부터 한다. 문자열 비교(키의 상품 번호) → 메타데이터만 받는 `HEAD` → 앞 12바이트만 받는 `GET` 순서다.

이제 목표의 두 명령이 그대로 나온다.

```sh
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
① upload-url → 201 {
  key: 'products/1/27081ce8-1f73-4b32-9649-297cb4b1b279.png',
  expiresIn: 60
}
② 저장소 PUT → 200 
③ confirm → 201 products/1/27081ce8-1f73-4b32-9649-297cb4b1b279.png

node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1 image/png
① upload-url → 201 {
  key: 'products/1/d8213b54-7789-4b05-9450-5c5d633efccd.png',
  expiresIn: 60
}
② 저장소 PUT → 200 
③ confirm → 400 이미지 파일이 아니다
```

### 용어 | S3 SDK API (확인·삭제)

- `GetObjectCommand`: 파일을 내려받는다. `getSignedUrl`에 넣으면 서명된 읽기 URL이 된다.

- `HeadObjectCommand`: 파일 내용 없이 메타데이터(`ContentLength`, `ContentType` 등)만 받는다. 파일이 없으면 이름이 `NotFound`인 에러를 던진다.

- `Range: "bytes=0-11"`: HTTP Range 요청이다. 지정한 구간의 바이트만 받는다. 아래 "Range 요청으로 앞부분만 읽기"에서 다룬다.

- `res.Body.transformToByteArray()`: 응답 본문 스트림을 끝까지 읽어 바이트 배열로 만든다. 이것도 아래 "Range 요청으로 앞부분만 읽기"에서 다룬다.

- `DeleteObjectCommand`: 파일을 지운다.

### 개념 | Range 요청으로 앞부분만 읽기

confirm이 알고 싶은 것은 "앞 12바이트가 그 형식의 매직 넘버인가"뿐이다. 2MB 파일을 다 내려받을 이유가 없다.

HTTP의 `Range` 헤더는 "이 구간만 달라"는 요청이고, 저장소는 그 구간만 보낸다. C로 치면 파일 전체를 읽지 않고 `read(fd, buf, 12)`로 앞 12바이트만 읽는 것이다.

범위는 **끝 번호를 포함한다.** 그래서 `readFirstBytes(key, 12)`는 `bytes=0-11`을 보낸다. 2단계의 `subarray`와 반대다.

```ts
const length = 12;
const range = `bytes=0-${length - 1}`; // "bytes=0-11": 0번부터 11번까지, 12바이트
const first = buf.subarray(0, length); // 같은 12바이트를 Buffer에서는 (0, 12)로 적는다
```

| 표기 | 끝 번호 | 앞 12바이트 |
|---|---|---|
| HTTP `Range` | 포함 | `bytes=0-11` |
| `Buffer.subarray` | 미포함 | `subarray(0, 12)` |

응답의 `Body`는 바이트 배열이 아니라 스트림이다.

네트워크에서 도착하는 대로 조금씩 흘러나오는 통로라서, `transformToByteArray()`로 끝까지 읽어 모은 다음에야 `Buffer.from`으로 Buffer를 만들어 검사할 수 있다.

- `- 1`을 빼먹어 `bytes=0-12`로 보내면 13바이트가 온다. 매직 넘버 검사는 앞부분만 보므로 결과가 같아서 눈에 띄지 않을 뿐이다.

- 스트림은 한 번만 읽을 수 있다. 같은 응답의 `Body`를 두 번 변환하려 하면 두 번째는 에러가 난다. 필요하면 처음 읽은 바이트를 변수에 두고 쓴다.

- 파일이 12바이트보다 짧으면 저장소는 있는 만큼만 보낸다. 그러면 `subarray(0, 8)`도 짧아져 `equals`가 `false`가 되므로 이미지가 아니라고 거절된다.

> 검사에 필요한 만큼만 읽는다. 큰 파일일수록 차이가 커진다.

### 실험 | 일부러 깨뜨려보기 ②: 확인을 우회해 보기

```text
올리지 않고 confirm               → 400 업로드된 파일이 없다
상품 1의 키로 상품 2를 confirm     → 400 이 상품의 키가 아니다
모양이 틀린 키(../../etc/passwd)  → 400 ["key must match /^products\/\d+\/[0-9a-f-]{36}\.(png|jpg|webp)$/ regular expression"]
```

그리고 목표에서 본 HTML 파일이다.

`Content-Type: image/png`로 허가를 받고 그 타입 그대로 올렸으니 서명 검사는 전부 통과했다. 저장소 입장에서는 정상 업로드다.

걸러 낸 것은 confirm의 매직 넘버 검사다.

```text
① upload-url → 201
② 저장소 PUT → 200
③ confirm → 400 이미지 파일이 아니다
```

`Content-Type`은 올린 쪽이 정한 값이라, 내용이 정말 그 타입이라는 보장이 없다.

이런 파일을 받아 두면, 나중에 다른 타입으로 다시 저장되거나 다른 경로로 내려가 HTML로 해석되는 순간 스크립트가 실행될 수 있다.

> 내용으로 확인할 수 있는 것은 서버에서 확인한다.

### 작업 3. 목록에 이미지 URL 붙이기

버킷은 비공개다. 서명 없이 열면 거절된다.

그래서 `GET /products`가 이미지마다 짧은 읽기 URL을 만들어 함께 내려준다. `ProductsController`가 `StorageService`를 주입받게 하고 `list`를 바꾼다.

```ts
// src/products/products.controller.ts
// StorageService import와 생성자 매개변수를 추가하고, list를 바꾼다
import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Controller("products")
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const products = await this.prisma.product.findMany({ orderBy: { id: "asc" } });
    // 버킷은 비공개다 → 이미지마다 10분짜리 읽기 URL을 만들어 함께 내려준다
    // imageKey만 떼어 내고 나머지 필드는 p에 모은다(키 자체는 응답에 넣지 않는다)
    return Promise.all(
      products.map(async ({ imageKey, ...p }) => ({
        ...p,
        imageUrl: imageKey ? await this.storage.createDownloadUrl(imageKey, 600) : null,
      })),
    );
  }
}
```

서버를 다시 켜고, 2단계에서 상품 1에 이미지를 올려 둔 상태에서 확인한다. 세 가지를 본다.

1. 목록에 `imageKey` 대신 `imageUrl`이 오는가. 이미지가 없는 상품은 `null`이다

2. 그 URL을 그대로 열면 이미지가 오는가

3. 같은 주소에서 서명(`?` 뒤)만 지우면 거절되는가. 버킷이 비공개라는 뜻이다

```sh
# 1) 목록. 상품 1에는 서명이 붙은 imageUrl이, 상품 2에는 null이 온다
curl -s localhost:4000/products
#출력
[{"id":1,"name":"한정판 키보드","price":150000,"stock":10,"imageUrl":"http://localhost:9000/product-images/products/1/27081ce8-1f73-4b32-9649-297cb4b1b279.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=localaccess%2F20251012%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251012T150411Z&X-Amz-Expires=600&X-Amz-Signature=f15ae5ee72ce4dbfe06fbb92a08650c607ed5822a10dfe9f6e82dc4ba5bf4a71&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"},{"id":2,"name":"마우스","price":30000,"stock":98,"imageUrl":null}]%

# 상품 1의 imageUrl만 꺼내 변수에 담는다(node -pe: JS 식 하나를 실행하고 결과를 출력한다)
URL=$(curl -s localhost:4000/products | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].imageUrl')

# 2) 서명이 붙은 URL 그대로 GET → 상태 코드, 타입, 받은 크기만 찍는다
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' "$URL"
# 출력
200 image/png 70B

# 3) ${URL%%\?*}는 URL에서 ? 이후를 잘라 낸 문자열이다. 서명 없이 같은 파일을 GET
curl -s "${URL%%\?*}"
# 출력
<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>%
```

`70B`는 2단계에서 만든 `pixel.png`의 크기다. 3)은 상태 코드 403과 함께 저장소의 XML 에러가 온다.

`createDownloadUrl`도 문자열 계산이라 상품 수만큼 불러도 저장소 요청은 늘지 않는다.

같은 상품에 이미지를 다시 올리면 confirm이 이전 파일을 지운다. 5단계의 `list-objects.mjs`로 보면 저장소에는 새 파일 하나만 남아 있다.

### 남길 것

- **찾아보면 되는 것**: `HeadObjectCommand`가 던지는 에러 이름(`NotFound`), `Range` 헤더 문법, `transformToByteArray()`, 목록 확인에 쓴 `node -pe`와 `${URL%%\?*}`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - "다 올렸다"는 클라이언트의 주장이다. 서버는 저장소에 직접 물어(존재·크기) 확인하고, `Content-Type`도 주장일 뿐이니 앞 몇 바이트(매직 넘버)로 내용을 확인한다.
  
  - 검사는 싼 것부터 한다. 문자열 비교 → 메타데이터(`HEAD`) → 필요한 만큼만 읽기(`Range`).

- **에러 신호**:
  
  - confirm이 `400 업로드된 파일이 없다` → PUT이 실패했는지, 고아 정리가 먼저 지웠는지(5단계의 최소 나이)
  
  - confirm이 `400 이 상품의 키가 아니다` → 키의 `products/<id>/`와 경로의 상품 id
  
  - confirm이 `400 이미지 파일이 아니다` → 파일 내용(`xxd 파일 | head -1`)이 그 형식의 매직 넘버로 시작하는지
  
  - `key must match ... regular expression` → upload-url이 돌려준 `key`를 그대로 보냈는지
  
  - 서명 없이 이미지 주소를 열면 403 → 정상이다. 목록이 내려준 `imageUrl` 전체(`?` 뒤 포함)를 쓴다

## 5. 4단계: 브라우저에서 올리기

`order-console-next`에 업로드 컴포넌트를 더한다.

### 작업 1. 업로더 컴포넌트

```tsx
// app/shop/product-image-uploader.tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-client";

type UploadUrl = { key: string; uploadUrl: string; expiresIn: number };

// 상품 이미지 올리기: ① 우리 서버에서 업로드 URL 받기 → ② 저장소에 직접 PUT → ③ 우리 서버에 확인 요청
export function ProductImageUploader({ productId }: { productId: number }) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { key, uploadUrl } = await authFetch<UploadUrl>(`/products/${productId}/image/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      // 저장소로 바로 보낸다. 인증 헤더도 쿠키도 없다. URL의 서명 자체가 권한이다
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`저장소 업로드 실패(${put.status})`);
      await authFetch(`/products/${productId}/image/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  return (
    <label>
      {" "}이미지:{" "}
      <input
        type="file"
        // 사용자가 바꿀 수 있는 기본 필터일 뿐이므로 검증은 서버가 한다
        accept="image/png,image/jpeg,image/webp"
        data-testid={`image-input-${productId}`}
        disabled={upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 오게 비운다
        }}
      />
      {upload.isPending && " 올리는 중…"}
      {upload.error && <span data-testid={`image-error-${productId}`}> {upload.error.message}</span>}
    </label>
  );
}
```

저장소 PUT에는 `authFetch`가 아니라 맨 `fetch`를 쓴다. `authFetch`는 우리 API 주소와 액세스 토큰을 붙이는 도우미라, 저장소로 가는 요청에는 맞지 않는다.

confirm이 끝나면 `invalidateQueries`로 `["products"]`를 다시 받아 오므로, 새 `imageUrl`이 목록에 들어온다.

### 작업 2. 상품 목록에 이미지와 업로더 붙이기

`app/shop/page.tsx`의 `ProductList`에서, `Product` 타입에 `imageUrl: string | null`을 추가하고 각 상품 줄에 이미지와 업로더를 붙인다.

```tsx
// app/shop/page.tsx
// import 두 줄, Product 타입의 imageUrl, ProductList 안의 loggedIn·img·업로더를 추가한다
import { useAuthStore } from "@/lib/auth-store";
import { ProductImageUploader } from "./product-image-uploader";
// ... 기존 import 그대로 ...

type Product = { id: number; name: string; price: number; stock: number; imageUrl: string | null };

function ProductList() {
  // ... useQuery와 add는 그대로 ...
  const loggedIn = useAuthStore((s) => s.accessToken !== null);

  // ... isPending, error 처리는 그대로 ...
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.imageUrl && (
            // next/image는 서버가 이미지를 다시 받아 최적화하는데, 서명이 바뀔 때마다 다른 URL이 되어 캐시가 쌓인다 → 그냥 img를 쓴다
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.name} width={48} height={48} data-testid={`image-${p.id}`} />
          )}
          {p.name} - {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
          <button disabled={p.stock === 0} onClick={() => add({ productId: p.id, name: p.name, price: p.price })}>
            담기
          </button>
          {loggedIn && <ProductImageUploader productId={p.id} />}
        </li>
      ))}
    </ul>
  );
}
```

#### 브라우저에서 확인하기

터미널 두 개에서 백엔드와 프론트를 각각 켠다.

```sh
# 터미널 1: 백엔드(localhost:4000)
cd order-api-nest
npm run start:dev

# 터미널 2: 프론트(localhost:3000)
cd order-console-next
npm run dev
```

1. 브라우저로 `http://localhost:3000/login`을 열고 `kim`과 `.env`의 `DEMO_PASSWORD`로 로그인한다.

2. `http://localhost:3000/shop`으로 간다. 로그인한 상태라 상품 줄마다 `이미지: [파일 선택]`이 붙어 있다. 로그인하지 않았으면 업로더가 보이지 않는다(`loggedIn`).

3. 파일을 고르기 **전에** 개발자 도구(macOS `Cmd+Option+I`, Windows `F12`)를 열고 Network 탭을 누른다. 열어 두기 전에 오간 요청은 기록되지 않는다.

4. 상품 1 줄의 `파일 선택`으로 `scripts/fixtures/pixel.png`(또는 아무 PNG·JPEG)를 고른다. 잠깐 `올리는 중…`이 보였다가, 상품 이름 앞에 48×48 이미지가 나타난다.

Network 탭에는 이렇게 쌓인다. 줄을 클릭하면 Headers 탭 맨 위 General에 그 요청의 요약이 나온다.

- `Request URL`: 브라우저가 요청한 주소. 아래 표의 "목적지"는 이 값의 `호스트:포트`다

- `Request Method`: `POST`, `PUT` 같은 메서드

- `Remote Address`: 브라우저가 실제로 연결한 상대의 IP와 포트(`127.0.0.1:9000`, `[::1]:9000` 등). 로컬에서는 `Request URL`의 포트와 같으므로 목적지를 한 번 더 확인하는 용도로 본다

`Remote Address`가 늘 `Request URL`과 같지는 않다. 운영에서 프록시나 CDN을 거치면 그 중간 서버의 주소가 찍힌다. 캐시에서 꺼낸 응답처럼 실제로 연결하지 않은 요청에는 아예 비어 있다. 그래서 "어디로 보냈나"는 `Request URL`로 판단한다.

| 순서 | 요청 | 목적지 | 오가는 것 |
|---|---|---|---|
| ① | `POST /products/1/image/upload-url` | `localhost:4000`(우리 서버) | 작은 JSON. `{ contentType, size }`를 보내고 `{ key, uploadUrl }`을 받는다 |
| ② | `PUT /product-images/products/1/....png` | `localhost:9000`(저장소) | **파일 바이트 전체** |
| ③ | `POST /products/1/image/confirm` | `localhost:4000`(우리 서버) | 작은 JSON. `{ key }`만 보낸다 |
| 그 뒤 | `GET /products`, 이미지 `GET` | 4000, 9000 | `invalidateQueries`로 목록을 다시 받고, 새 `imageUrl`로 이미지를 읽는다 |

이 밖에 `OPTIONS`(또는 `preflight`라고 표시된) 줄이 섞여 보일 수 있다. 브라우저가 다른 출처로 요청하기 전에 허락을 묻는 사전 요청이고, 아래 "저장소의 CORS"에서 다룬다.

봐야 할 것은 ②의 목적지다. 파일이 실린 유일한 요청이 우리 서버가 아니라 저장소로 갔다.

**우리 서버로 간 요청은 수십 바이트짜리 JSON 둘뿐이다.**

### 용어 | 브라우저 파일 API

- `<input type="file">`: 파일 선택 창을 여는 입력이다. 고른 파일은 `e.target.files`(FileList)에 들어온다.

- `accept`: 파일 선택 창의 기본 필터다. 사용자가 "모든 파일"로 바꿀 수 있다.

- `File`: 사용자가 고른 파일이다. `type`(MIME 타입)과 `size`(바이트)를 브라우저가 채워 준다. `fetch`의 `body`에 그대로 넣으면 그 바이트가 전송된다. `type`을 믿으면 안 되는 이유는 아래 "`file.type`은 내용이 아니라 이름에서 온다"에서 다룬다.

### 개념 | `file.type`은 내용이 아니라 이름에서 온다

브라우저는 `File.type`을 정할 때 파일 내용을 열어 보지 않고 주로 확장자로 짐작한다.

그래서 목표에서 본 `not-an-image.png`를 고르면, 내용이 HTML인데도 `file.type`은 `image/png`다.

이 컴포넌트는 그 값을 그대로 서버에 보내고(`contentType: file.type`) 저장소 PUT의 헤더에도 쓴다.

서명 검사는 "허가받은 타입과 보낸 타입이 같은가"만 보므로 통과하고, 걸러 내는 것은 3단계 confirm의 매직 넘버 검사다.

`File`을 만드는 쪽은 `type`에 아무 값이나 적을 수 있다. Node에서 직접 만들어 보면 드러난다.

```js
// Node 24. 브라우저와 달리 Node는 확장자로 짐작하지도 않는다
const f = new File(["<html>"], "not-an-image.png");
console.log(JSON.stringify(f.type)); // 출력: ""
const g = new File(["<html>"], "not-an-image.png", { type: "image/png" });
console.log(g.type); // 출력: image/png (내용과 무관하게 적은 값 그대로다)
```

6단계 e2e 테스트의 `setInputFiles({ name, mimeType: "image/png", buffer })`도 같은 식으로 HTML 내용에 `image/png` 타입을 붙여 넣는다.

| 값 | 누가 정하는가 | 믿어도 되는가 |
|---|---|---|
| `accept` 필터 | 우리 코드 | 아니다. 사용자가 "모든 파일"로 바꿀 수 있다 |
| `file.type` | 브라우저(확장자로 짐작) | 아니다 |
| `file.size` | 브라우저(실제 바이트 수) | 서명에 들어가므로 저장소가 다른 크기를 거절한다 |
| 앞 몇 바이트(매직 넘버) | 파일 내용 | 서버가 읽어서 확인한다 |

- 확장자가 없거나 브라우저가 모르는 확장자면 `file.type`은 빈 문자열이다. 그러면 ① upload-url의 `@IsIn` 검사에서 400으로 걸린다.

> 클라이언트가 알려 주는 파일 정보는 전부 "주장"이다. 3단계에서 본 대로, 내용으로 확인할 수 있는 것은 서버에서 확인한다.

### 개념 | 저장소의 CORS

브라우저가 `localhost:3000`에서 `localhost:9000`으로 `PUT`을 보내는 것은 다른 출처로 가는 요청이다.

그래서 백엔드에 CORS를 열었듯이, 저장소(버킷)도 프론트 출처를 허락해야 한다. 1단계의 `PutBucketCorsCommand`가 그 설정이고, 허락할 출처는 `.env`의 `FRONTEND_URL`이다.

`PUT`은 "단순 요청"(`GET`, `HEAD`, 일부 `POST`)이 아니므로, 브라우저는 실제 요청 전에 `OPTIONS`로 사전 요청(preflight)을 먼저 보내 허락을 묻는다.

#### 사전 요청이 오가는 순서

1. 브라우저가 실제 PUT 대신 `OPTIONS`를 먼저 보낸다. `Origin: http://localhost:3000`, `Access-Control-Request-Method: PUT`, `Access-Control-Request-Headers: content-type`이 실린다.

2. 저장소가 버킷의 CORS 규칙과 비교해, 맞으면 `access-control-allow-origin` 등을 담아 응답한다. 7단계 진단 4에서 이 요청을 `curl`로 직접 보낸다.

3. 브라우저는 그 응답에서 허락을 확인했을 때만 실제 PUT을 보낸다.

`AllowedHeaders`에 `content-type`이 있어야 하는 이유도 여기 있다.

`Content-Type`은 값이 `text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded` 중 하나일 때만 허락 없이 보낼 수 있는 헤더다. `image/png`는 거기 없으므로 사전 요청에서 허락받아야 한다.

#### 흔한 오해

- "저장소가 업로드를 거절했다"가 아니다. 사전 요청에서 허락을 못 받으면 **PUT은 아예 나가지 않는다.** 그래서 저장소에는 파일이 없고, 업로더는 PUT에서 예외가 나 confirm까지 가지 않는다.

- 페이지의 코드는 실패 이유를 읽을 수 없다. `fetch`는 상태 코드 없이 `Failed to fetch`라는 `TypeError`로 끝나고, 자세한 이유는 브라우저 개발자 도구 콘솔에만 찍힌다.

- 목록의 `<img src>`는 이 검사를 받지 않는다. `crossorigin` 속성이 없는 `<img>`는 다른 출처의 이미지도 그대로 그린다. 이미지가 안 보이면 CORS보다 URL의 서명과 만료를 먼저 본다.

### 실험 | 일부러 깨뜨려보기 ③: CORS

`onModuleInit`의 `AllowedOrigins`를 `["http://localhost:5173"]`로 바꿔 서버를 다시 켜고(켤 때 버킷 CORS를 다시 건다) 이미지를 올려 본다.

```text
화면: 이미지:  Failed to fetch
Network: PUT http://localhost:9000/product-images/products/1/... (failed) net::ERR_FAILED
```

`node scripts/upload-image.mjs`로는 같은 순간에도 잘 올라간다.

CORS는 **브라우저가** 지키는 규칙이라, 브라우저가 아닌 클라이언트에는 적용되지 않는다.

> "스크립트로는 되는데 화면에서만 안 된다"면 CORS부터 의심한다.

원복하고 서버를 다시 켠다.

### 남길 것

- **찾아보면 되는 것**: `<input type="file">`의 `accept`, `File`의 `type`·`size`, 사전 요청 헤더 이름(`Access-Control-Request-*`), 개발자 도구 단축키와 Network 탭 General의 항목 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - Network 탭에서 `Request URL`의 호스트:포트로 요청의 목적지를 확인한다. 파일 바이트가 실린 요청(`PUT`)은 저장소로 가는 하나뿐이고, 우리 서버로는 작은 JSON만 간다. 이 문서 전체의 목표가 그 한 줄에 보인다.
  
  - 브라우저가 저장소에 직접 보내면 저장소도 그 출처를 CORS로 허락해야 한다. CORS는 브라우저만 지키므로 "스크립트로는 되는데 화면에서만 안 된다"가 전형적인 증상이다.
  
  - `file.type`은 브라우저가 이름으로 짐작한 값이다. 프론트의 필터와 타입은 편의일 뿐이고, 검증은 서버가 한다.

- **에러 신호**:
  
  - 화면에 `Failed to fetch`, Network에 PUT `(failed) net::ERR_FAILED` → 버킷 CORS의 `AllowedOrigins`가 `FRONTEND_URL`과 같은지(7단계 진단 4)
  
  - 화면에 `저장소 업로드 실패(403)` → 서명 문제. 7단계 진단 2로 URL을, 진단 3으로 `<Code>`를 본다
  
  - 화면에 `이미지 파일이 아니다` → 정상 거절. 고른 파일의 내용이 진짜 이미지인지
  
  - 업로더가 안 보인다 → 로그인했는지(`loggedIn`일 때만 그린다)

## 6. 5단계: 고아 파일 정리

0장 개념 4의 고아 파일은 이미 생겼다. 2~3단계의 실험에서 URL만 받고 confirm하지 않은 파일, confirm이 거절된 파일이 그것이다.

### 작업 1. 저장소와 DB를 나란히 보는 스크립트

```js
// scripts/list-objects.mjs
// 저장소 버킷에 실제로 있는 파일과, DB의 products.image_key가 가리키는 파일을 나란히 보여 준다
// 사용법: node scripts/list-objects.mjs
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

process.loadEnvFile();
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: "products/" }));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query("SELECT id, image_key FROM products WHERE image_key IS NOT NULL");
await db.end();
const used = new Map(rows.map((r) => [r.image_key, r.id]));

console.table(Contents.map((o) => ({
  key: o.Key,
  size: o.Size,
  "올라간 지(초)": Math.round((Date.now() - o.LastModified.getTime()) / 1000),
  "가리키는 상품": used.get(o.Key) ?? "(없음 - 고아)",
})));
```

```sh
node scripts/list-objects.mjs
```

```text
┌─────────┬───────────────────────────────────────────────────────┬──────┬───────────────┬─────────────────┐
│ (index) │ key                                                   │ size │ 올라간 지(초) │ 가리키는 상품   │
├─────────┼───────────────────────────────────────────────────────┼──────┼───────────────┼─────────────────┤
│ 0       │ 'products/1/2f950f7a-6337-4b40-b90e-613a251bf2ba.png' │ 70   │ 26            │ '(없음 - 고아)' │
│ 1       │ 'products/1/677e1369-6ffa-4218-83b9-5fdc80882cc4.png' │ 70   │ 26            │ '(없음 - 고아)' │
│ 2       │ 'products/1/87528612-1f8c-40a7-a175-0d3d6319335d.png' │ 70   │ 44            │ 1               │
└─────────┴───────────────────────────────────────────────────────┴──────┴───────────────┴─────────────────┘
```

### 작업 2. StorageService에 list 추가

정리는 한 대에서만 돌면 되는 주기 작업이니 `LeaderElection`에 얹는다. 먼저 `StorageService`에 목록 메서드를 더한다.

```ts
// src/storage/storage.service.ts
// StorageService 클래스 안, readFirstBytes 다음에 추가한다
  // prefix로 시작하는 파일을 전부 나열한다. 다음 쪽이 있으면 이어서 받는다
  async list(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const result: { key: string; lastModified: Date }[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) result.push({ key: o.Key!, lastModified: o.LastModified! });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return result;
  }
```

### 작업 3. 고아 정리 작업 만들고 등록하기

#### OrphanImageCleanupJob 클래스

```ts
// src/leader/orphan-image-cleanup.job.ts
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { LeaderElection } from "./leader-election.js";

// 저장소에는 올라갔지만 어떤 상품도 가리키지 않는 이미지(고아)를 지운다. 리더 인스턴스에서만 돈다
// 생기는 경우: 업로드 후 confirm을 안 했다(창을 닫음), confirm이 거절됐다, confirm 직전에 서버가 죽었다
@Injectable()
export class OrphanImageCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrphanImageCleanupJob.name);
  private timer?: NodeJS.Timeout;
  // 이보다 최근에 올라간 파일은 건드리지 않는다. 지금 막 올리고 confirm을 보내려는 중일 수 있다
  private readonly minAgeMs = Number(process.env.ORPHAN_MIN_AGE_SECONDS ?? 3600) * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly leaderElection: LeaderElection,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.ORPHAN_CLEANUP_INTERVAL_MS ?? 10 * 60_000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader) return;
    const objects = await this.storage.list("products/");
    const rows = await this.prisma.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } });
    const used = new Set(rows.map((r) => r.imageKey));
    const cutoff = Date.now() - this.minAgeMs;
    const orphans = objects.filter((o) => !used.has(o.key) && o.lastModified.getTime() < cutoff);
    for (const o of orphans) await this.storage.delete(o.key);
    if (orphans.length > 0) this.logger.log(`고아 이미지 ${orphans.length}개 삭제`);
  }
}
```

`04`의 `TokenCleanupJob`과 같은 모양이다. 타이머는 모든 인스턴스에서 돌지만, 리더가 아니면 `run()` 첫 줄에서 바로 돌아간다.

"가리키는 파일" 집합은 DB에서, "있는 파일" 목록은 저장소에서 가져와 차집합을 구한다. 두 시스템 사이에 트랜잭션이 없으니(0장 개념 4) 이렇게 나중에 맞춰 보는 수밖에 없다.

#### LeaderModule에 등록하기

```ts
// src/leader/leader.module.ts
// import 한 줄과 providers 배열의 OrphanImageCleanupJob만 추가한다
import { Module } from "@nestjs/common";
import { LeaderElection } from "./leader-election.js";
import { OrphanImageCleanupJob } from "./orphan-image-cleanup.job.js";
import { TokenCleanupJob } from "./token-cleanup.job.js";

@Module({ providers: [LeaderElection, TokenCleanupJob, OrphanImageCleanupJob] })
export class LeaderModule {}
```

`providers`에 없으면 Nest가 이 클래스를 만들지 않으므로, 에러 없이 정리 작업만 조용히 돌지 않는다.

#### 짧은 주기로 켜서 확인

확인을 위해 기준을 10초, 주기를 2초로 줄여 켠다.

```sh
ORPHAN_MIN_AGE_SECONDS=10 ORPHAN_CLEANUP_INTERVAL_MS=2000 npm run start:dev
```

```text
LOG [LeaderElection] 리더가 됐다(pid 65385, PORT 4000)
LOG [OrphanImageCleanupJob] 고아 이미지 2개 삭제
```

`list-objects.mjs`로 다시 보면 상품 1이 가리키는 파일 하나만 남는다.

확인했으면 환경변수 없이 다시 켠다. `.env`의 기본값(1시간, 10분)으로 돌아간다.

### 용어 | S3 SDK API (목록)

- `ListObjectsV2Command({ Prefix })`: 키가 `Prefix`로 시작하는 파일을 나열한다. 한 번에 최대 1000개씩 온다. 그보다 많을 때는 아래 "목록은 쪽 단위로 온다"에서 다룬다.

- `IsTruncated` / `NextContinuationToken`: 아직 남은 쪽이 있는지와, 다음 쪽을 받을 때 `ContinuationToken`으로 넘길 값이다.

- `Contents[].Key` / `LastModified`: 파일의 키와 마지막으로 올라간 시각이다.

### 개념 | 목록은 쪽 단위로 온다

`ListObjectsV2Command` 한 번은 최대 1000개만 돌려준다. 남은 것이 있으면 `IsTruncated: true`와 함께 "다음은 여기서부터"라는 표시(`NextContinuationToken`)를 준다.

그 값을 다음 요청의 `ContinuationToken`에 넣어 다시 부르기를 `IsTruncated`가 `false`가 될 때까지 반복해야 전체 목록이 된다.

C에서 큰 파일을 고정 크기 버퍼로 `read()`를 반복해 끝까지 읽는 것과 같은 모양이다. 한 번의 `read()`가 파일 전체를 준다고 가정하면 안 되듯, 한 번의 목록 요청이 전부를 준다고 가정하면 안 된다.

```ts
let token: string | undefined; // 첫 요청은 토큰 없이 보낸다
do {
  const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
  // ... res.Contents를 모은다
  token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token); // 토큰이 없으면 방금 받은 것이 마지막 쪽이다
```

`while`이 아니라 `do...while`인 이유는 첫 요청을 토큰 없이 반드시 한 번 보내야 하기 때문이다.

- 이 반복을 빼먹어도 파일이 1000개 미만인 동안에는 아무 문제가 없다. 그래서 개발 중에는 드러나지 않다가, 파일이 쌓인 운영 환경에서 앞쪽 1000개에 들지 못한 고아가 정리되지 않는 식으로 나타난다.

- 위의 `scripts/list-objects.mjs`는 눈으로 보는 용도라 첫 쪽만 읽는다. 정리 작업처럼 전부를 다뤄야 하는 코드는 `list`처럼 끝까지 받는다.

> 목록 API가 다 줬다고 가정하지 않는다. `IsTruncated`를 확인하는 것까지가 목록 읽기다.

### 개념 | 최소 나이가 필요한 이유

URL을 받아 파일을 올리기만 하고(confirm 없이) 바로 목록을 보면, 그 파일은 4초 뒤에도 고아로 남아 있다. 10초가 지난 다음 회차에 지워진다.

기준이 없으면 "방금 올리고 confirm을 보내려는 참"인 파일을 지워 버린다. 그러면 confirm이 `업로드된 파일이 없다`로 실패한다.

> 기준은 업로드 URL 유효 시간(60초)보다 넉넉히 길게 잡는다.

### 남길 것

- **찾아보면 되는 것**: `ListObjectsV2Command`의 칸 이름(`Prefix`, `ContinuationToken`, `IsTruncated`), `console.table`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 트랜잭션으로 묶을 수 없는 두 시스템은 "막기"가 아니라 "나중에 맞춰 보고 치우기"로 설계한다. 이때 진행 중인 작업을 치우지 않도록 최소 나이를 둔다.
  
  - 목록 API는 쪽 단위로 온다. 개발 중에는 한 쪽에 다 들어와서 빼먹어도 드러나지 않는다.

- **에러 신호**:
  
  - 고아가 있는데 `고아 이미지 N개 삭제`가 안 찍힌다 → 이 인스턴스가 리더인지(`리더가 됐다`), `LeaderModule`의 `providers`에 `OrphanImageCleanupJob`이 있는지, 파일이 `ORPHAN_MIN_AGE_SECONDS`보다 오래됐는지
  
  - 올린 직후 confirm이 `업로드된 파일이 없다` → `ORPHAN_MIN_AGE_SECONDS`가 너무 짧지 않은지

## 7. 6단계: e2e 테스트

`05`의 Playwright 테스트 옆에 업로드 테스트를 더한다.

### 작업 1. 견본 파일 복사

픽셀 PNG를 `e2e/fixtures/`에 복사해 둔다. 테스트는 `__dirname` 기준으로 `fixtures/pixel.png`를 읽는다.

```sh
cd order-console-next
mkdir -p e2e/fixtures
cp ../order-api-nest/scripts/fixtures/pixel.png ../order-api-nest/scripts/fixtures/not-an-image.png e2e/fixtures/
```

`not-an-image.png`는 같이 복사해 두지만, 아래 두 번째 테스트는 파일 대신 메모리의 `buffer`로 같은 내용을 만들어 넣는다.

### 작업 2. 업로드 테스트 작성·실행

#### 테스트 코드

```ts
// e2e/upload.spec.ts
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다", async ({ page }) => {
  await loginAsKim(page);
  // 응답을 기다리는 약속을 먼저 걸어 두고 나서 파일을 고른다(고른 뒤에 걸면 이미 지나간 응답을 놓칠 수 있다)
  const storagePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().startsWith("http://localhost:9000/"));
  const confirm = page.waitForResponse((r) => r.url().endsWith("/products/2/image/confirm"));
  await page.getByTestId("image-input-2").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));

  expect((await storagePut).status()).toBe(200);
  const { key } = (await (await confirm).json()) as { key: string };
  const img = page.getByTestId("image-2");
  // 이번에 올린 키로 바뀔 때까지 기다린다(이전 실행에서 올린 이미지가 이미 있을 수 있다)
  await expect(img).toHaveAttribute("src", new RegExp(`^http://localhost:9000/product-images/${key}\\?`));
  // 브라우저가 그 URL에서 실제로 이미지를 받아 그렸는지 확인한다
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("이미지가 아닌 파일은 확장자가 .png여도 거절된다", async ({ page }) => {
  await loginAsKim(page);
  await page.getByTestId("image-input-2").setInputFiles({
    name: "not-an-image.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect(page.getByTestId("image-error-2")).toContainText("이미지 파일이 아니다");
});
```

#### 실행

Playwright 설정은 프론트만 띄운다. 백엔드(`order-api-nest`의 `npm run start:dev`)와 저장소 컨테이너는 미리 켜 둔다.

```sh
npm run test:e2e -- --reporter=list

# 출력
Running 6 tests using 1 worker

  ✓  1 e2e/shop.spec.ts:10:5 › 장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다 (836ms)
  ✓  2 e2e/shop.spec.ts:26:5 › 결제하면 재고와 내 주문이 다시 받아 와진다 (619ms)
  ✓  3 e2e/shop.spec.ts:39:5 › 새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다 (1.2s)
  ✓  4 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (1.1s)
  ✓  5 e2e/upload.spec.ts:11:5 › 이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다 (458ms)
  ✓  6 e2e/upload.spec.ts:24:5 › 이미지가 아닌 파일은 확장자가 .png여도 거절된다 (438ms)

  6 passed (5.6s)
```

### 개념 | 화면 상태만 보는 테스트의 함정

처음 쓴 첫 번째 테스트는 "이미지가 보이는가"만 확인했다.

그랬더니 이전 실행에서 올린 이미지가 이미 있을 때 업로드가 끝나기도 전에 통과해 버렸다(저장소 PUT 응답이 0개로 기록됐다).

**화면 상태만 보는 테스트는 "이미 그 상태였던 경우"를 구별하지 못한다.**

그래서 이번 동작이 만든 결과(confirm 응답의 키)를 기준으로 기다리게 바꿨다.

- `waitForResponse`는 파일을 고르기 **전에** 건다. 고른 뒤에 걸면 그사이 지나간 응답을 놓쳐 테스트가 타임아웃으로 끝날 수 있다.

- `src` 속성이 맞아도 이미지를 실제로 받았는지는 모른다. `naturalWidth`가 0보다 커질 때까지 기다려 "브라우저가 그 URL에서 받아 그렸다"까지 확인한다.

### 용어 | Playwright API

- `locator.setInputFiles(경로 또는 { name, mimeType, buffer })`: 파일 선택 창 없이 `<input type="file">`에 파일을 넣는다. 객체를 주면 디스크에 없는 파일도 만들어 넣을 수 있다.

- `page.waitForResponse(조건)`: 조건에 맞는 응답이 올 때까지 기다리는 Promise를 돌려준다.

- `img.naturalWidth`: 이미지 요소의 원래 너비다. `0`보다 크면 브라우저가 이미지를 실제로 받아 그렸다는 뜻이다.

### 남길 것

- **찾아보면 되는 것**: `setInputFiles`의 두 가지 인자 모양, `waitForResponse`, `expect.poll`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 화면 상태만 보는 테스트는 "이미 그 상태였던 경우"를 구별하지 못한다. 이번 동작이 만든 결과(응답의 키)를 기준으로 기다린다.

- **에러 신호**:
  
  - 테스트가 업로드 전에 통과한다(저장소 PUT 응답 0개) → 화면 상태가 아니라 이번 응답(`confirm`의 `key`)을 기다리는지
  
  - 화면에 `상품을 불러오지 못했다: ...` → 백엔드가 4000번에 떠 있는지(Playwright는 프론트만 띄운다)
  
  - `setInputFiles`가 파일을 못 찾는다 → `e2e/fixtures/pixel.png`를 복사했는지

## 8. 7단계: 디버깅

### 진단 1. 저장소에 정말 있는가

`node scripts/list-objects.mjs`로 저장소와 DB를 나란히 보거나, 웹 콘솔(`http://localhost:9001/rustfs/console/`)에서 버킷을 연다.

"업로드는 성공했는데 화면에 안 보인다"면 순서대로 본다.

1. 파일이 있는가: 없으면 PUT이 실패했다.

2. DB가 가리키는가: 안 가리키면 confirm이 실패했다.

3. 목록 응답의 `imageUrl`이 `null`이 아닌가: 값이 있는데도 안 보이면 프론트의 캐시 무효화를 본다.

### 진단 2. presigned URL 뜯어보기

```sh
node -e 'const u=new URL(process.argv[1]); for (const [k,v] of u.searchParams) console.log(k, "=", v)' "<받은 uploadUrl>"
```

```text
X-Amz-Algorithm = AWS4-HMAC-SHA256
X-Amz-Content-Sha256 = UNSIGNED-PAYLOAD
X-Amz-Credential = localaccess/20251004/us-…
X-Amz-Date = 20251004T152424Z
X-Amz-Expires = 60                              # 유효 시간(초)
X-Amz-Signature = f4ba7fe8508f0eb73046ee54…
X-Amz-SignedHeaders = content-length;content-type;host   # 이 헤더들이 서명에 들어갔다
x-id = PutObject
```

`X-Amz-SignedHeaders`에 없는 헤더는 저장소가 검사하지 않는다(2단계의 깨뜨려보기 ①).

`X-Amz-Date`와 `X-Amz-Expires`로 언제까지 유효한지 계산할 수 있다.

1단계의 `requestChecksumCalculation: "WHEN_REQUIRED"`를 빼고 URL을 만들면 쿼리에 두 개가 더 붙는다.

```text
x-amz-checksum-crc32 = AAAAAA==
x-amz-sdk-checksum-algorithm = CRC32
```

`AAAAAA==`는 **빈 본문**의 CRC32다.

최근의 AWS SDK v3는 요청 본문의 체크섬을 기본으로 계산해 붙이는데, presigned URL을 만들 때는 아직 본문이 없으니 빈 값의 체크섬이 박힌다.

이 문서의 로컬 저장소는 이 값을 검사하지 않아 업로드가 통과했다. 하지만 이 값을 검사하는 저장소라면 실제 파일의 체크섬과 맞지 않아 거절될 수 있다.

> 실제 S3에서 어떻게 되는지는 이 로컬 환경으로는 확인할 수 없으므로, 처음부터 꺼 두었다.

### 진단 3. 저장소의 에러 코드

저장소는 XML로 에러를 돌려준다. `<Code>`만 보면 된다.

| 코드 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `SignatureDoesNotMatch` | 서명과 요청이 다르다 | 서명된 헤더(`Content-Type`, 크기)를 요청과 다르게 보냈는가, 서버와 저장소의 시계가 크게 어긋났는가 |
| `AccessDenied` | 권한 없음 | URL이 만료됐는가(`X-Amz-Date` + `X-Amz-Expires`), 서명 없이 열었는가 |
| `NotFound`(HEAD) / `NoSuchKey`(GET) | 그 키에 파일이 없다 | PUT이 실패했는가, 키를 잘못 옮겼는가 |
| `NoSuchBucket` | 버킷이 없다 | `S3_BUCKET` 값, 서버 시작 로그의 `버킷 생성` |

### 진단 4. CORS 사전 요청을 직접 보내 보기

브라우저가 보내는 사전 요청을 `curl`로 똑같이 보낸다.

```sh
curl -i -X OPTIONS "http://localhost:9000/product-images/products/1/test.png" \
  -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type'
```

```text
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:3000
access-control-allow-methods: PUT, GET
access-control-allow-headers: content-type
access-control-max-age: 600
```

`Origin`을 `http://evil.example`로 바꾸면 `403 Forbidden`이 온다.

4단계의 깨뜨려보기처럼 화면에서만 실패할 때, 이 응답에 `access-control-allow-origin`이 없거나 다른 값이면 버킷 CORS 설정 문제다.

> `access-control-max-age: 600`은 브라우저가 이 허락을 10분 동안 기억한다는 뜻이라, 설정을 고친 뒤에도 브라우저에서는 잠깐 예전 결과가 보일 수 있다.

### 진단 5. 서버가 쓰는 주소와 브라우저가 쓰는 주소

presigned URL에는 서명할 때 쓴 주소(`S3_ENDPOINT`)가 그대로 들어간다. 지금은 서버도 브라우저도 `localhost:9000`으로 저장소에 닿으니 문제가 없다.

하지만 서버를 컨테이너 안에서 돌려 `http://storage:9000`(compose 안의 서비스 이름)으로 저장소에 붙으면, 그 주소가 URL에 들어가 **브라우저는 그 주소를 찾을 수 없다.**

서명에는 주소(`host`)도 들어가므로 URL의 주소만 바꿔 끼울 수도 없다.

이럴 때는 브라우저용 URL을 만드는 클라이언트를 브라우저가 닿는 주소로 따로 만든다.

> 실제 S3는 서버와 브라우저가 같은 공개 주소를 쓰므로 이 문제가 없다.

### 진단 6. 에러 신호 모아 보기

각 단계 `남길 것`의 "에러 신호"를 한 표에 모았다. 메시지를 외우는 게 아니라 어느 칸으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `pull access denied` | 그 이미지를 받을 수 없다 | 같은 S3 API를 쓰는 다른 저장소 이미지(준비) |
| 웹 콘솔 로그인이 안 된다 | 콘솔 계정은 compose의 키 두 개다 | `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`, 컨테이너를 다시 만들었는지(준비) |
| 2MB보다 큰 파일도 upload-url이 내준다 | 크기 제한이 `NaN`이 되어 꺼졌다 | `.env`의 `MAX_IMAGE_BYTES`가 계산된 숫자인지(준비) |
| 서버가 뜨지 않고 `onModuleInit`에서 연결 에러 | 저장소에 닿지 않는다 | `docker compose ps`의 `storage`, `S3_ENDPOINT`(1단계) |
| 서버가 뜨지 않고 `onModuleInit`에서 `SignatureDoesNotMatch` | 서버와 저장소의 비밀 키가 다르다 | compose의 `RUSTFS_SECRET_KEY`와 `.env`의 `S3_SECRET_KEY`, 컨테이너를 다시 만들었는지(1단계) |
| 처음 켰는데 `버킷 생성`이 안 찍히고 버킷도 없다 | `StorageService`가 만들어지지 않았다 | `app.module.ts`의 `imports`에 `StorageModule`(1단계) |
| `Nest can't resolve dependencies of the ProductImagesController (PrismaService, ?)` | `StorageService`를 넣어 줄 수 없다 | `app.module.ts`의 `imports`에 `StorageModule`(2단계) |
| `POST /products/1/image/upload-url`만 404 | 컨트롤러가 등록되지 않았다 | `ProductsModule`의 `controllers`(2단계) |
| `400 이미지는 2097152바이트 이하여야 합니다` / `contentType must be one of the following values: ...` | URL을 내주기 전에 걸렀다 | 보낸 `size`와 `contentType`(2단계) |
| 저장소 PUT이 `403 SignatureDoesNotMatch` | 서명과 요청이 다르다 | 서명된 헤더와 실제 요청, 진단 2·3(2단계) |
| 저장소 PUT이 `403 AccessDenied` | URL이 만료됐다 | `UPLOAD_URL_TTL_SECONDS`, `X-Amz-Date` + `X-Amz-Expires`(2단계) |
| 다른 `Content-Type`으로 PUT 했는데 200 | 타입이 서명에 없다 | `X-Amz-SignedHeaders`, `signableHeaders`(2단계) |
| confirm이 `400 업로드된 파일이 없다` | 저장소에 그 키가 없다 | PUT 결과, 고아 정리의 최소 나이(3단계, 5단계) |
| confirm이 `400 이 상품의 키가 아니다` | 다른 상품의 키다 | 키의 `products/<id>/`와 경로의 상품 id(3단계) |
| confirm이 `400 이미지 파일이 아니다` | 매직 넘버가 다르다 | 파일 내용(`xxd 파일 \| head -1`)(3단계) |
| `key must match ... regular expression` | 키 모양이 틀렸다 | upload-url이 돌려준 `key`를 그대로 보냈는지(3단계) |
| 서명 없이 이미지 주소를 열면 403 | 비공개 버킷이라 정상 | 목록의 `imageUrl` 전체(3단계) |
| 화면에 `Failed to fetch`, PUT `(failed) net::ERR_FAILED` | 사전 요청에서 막혔다 | 버킷 CORS의 `AllowedOrigins`와 `FRONTEND_URL`, 진단 4(4단계) |
| 스크립트로는 되는데 화면에서만 안 된다 | 브라우저만 지키는 규칙에 걸렸다 | CORS(4단계) |
| 화면에 `저장소 업로드 실패(403)` | 저장소가 서명을 거절했다 | 진단 2·3(4단계) |
| 업로더가 안 보인다 | 로그인 상태가 아니다 | `loggedIn`(4단계) |
| 고아가 있는데 `고아 이미지 N개 삭제`가 안 찍힌다 | 정리 작업이 돌지 않거나 대상이 아니다 | `리더가 됐다` 로그, `LeaderModule`의 `providers`, 최소 나이(5단계) |
| 테스트가 업로드 전에 통과한다 | 화면 상태가 이미 맞았다 | 이번 응답(`confirm`의 `key`)을 기다리는지(6단계) |
| 화면에 `상품을 불러오지 못했다: ...` | 백엔드에 닿지 않는다 | `order-api-nest`가 4000번에 떠 있는지(6단계) |
| `setInputFiles`가 파일을 못 찾는다 | 견본 파일이 없다 | `e2e/fixtures/pixel.png`(6단계) |
| `NoSuchBucket` | 버킷이 없다 | `S3_BUCKET`, 서버 시작 로그(7단계) |
| 브라우저가 서명된 URL의 주소를 찾지 못한다 | 서버가 쓰는 주소가 URL에 들어갔다 | `S3_ENDPOINT`, 진단 5(7단계) |

### 도전 과제

#### 1. 관리자만 업로드 URL 받게 하기

업로드 URL은 로그인한 누구나 받을 수 있다. `03`의 도전 과제 1에서 만든 관리자 Guard를 `ProductImagesController`에 건다.

무엇이 달라지는가?

**답**

1. `users`에 `role` 컬럼(기본값 `"user"`)을 추가하고 시드에서 `kim`만 `"admin"`으로 둔다. Guard는 `req.user.userId`로 DB에서 역할을 읽어 `admin`이 아니면 `ForbiddenException`을 던진다.

2. 컨트롤러에 `@UseGuards(AuthGuard("jwt"), AdminGuard)`로 건다. 왼쪽부터 차례로 돌아서, 관리자 Guard가 돌 때는 `req.user`가 이미 채워져 있다.

3. `kim`으로는 전과 같이 ①②③이 모두 성공한다. `lee`로는 `① upload-url → 403 관리자만 할 수 있다`에서 멈추고, confirm도 같은 403이다. 토큰 없이 부르면 첫 Guard에서 401이다.

4. 역할을 토큰에 넣지 않고 매 요청 DB에서 읽으므로, `kim`의 `role`을 `user`로 바꾸면 같은 액세스 토큰으로도 다음 요청부터 403이 된다.

> 대신 요청마다 쿼리가 한 번 늘어난다. 역할을 JWT payload에 넣으면 쿼리는 없지만, 권한을 빼도 토큰이 만료될 때까지(15분) 통한다.

#### 2. 썸네일을 큐로 만들기

업로드된 원본을 그대로 보여 주지 말고, 작은 크기(예: 200px)로 줄인 사본을 만들어 그걸 보여 준다.

confirm에서 바로 줄이지 말고, `04`의 BullMQ 큐에 "썸네일 만들기" job을 넣어 워커가 하게 한다.

confirm 응답이 왜 빨라지는가? 썸네일이 아직 없을 때 화면은 무엇을 보여 줘야 하는가?

**답**

1. `products`에 `thumbnail_key` 컬럼을 더한다. confirm은 `imageKey`를 새 키로, `thumbnailKey`를 `null`로 바꾸고 `thumbnail` 큐에 `{ productId, key }` job을 넣은 뒤 바로 응답한다. 이전 원본과 이전 썸네일은 지운다.

2. 워커가 원본을 저장소에서 읽어 이미지 처리 라이브러리(`sharp`)로 긴 변 200px의 WebP로 줄이고, `products/1/<uuid>.thumb.webp`로 올린 다음 상품에 연결한다. 800×600 PNG(8592B)가 200×150 WebP(146B)가 됐다.

3. confirm이 빨라지는 이유는 원본 내려받기 → 줄이기 → 올리기를 기다리지 않기 때문이다. confirm이 하는 일은 DB 쓰기와 Redis에 job 넣기뿐이라, 원본 크기나 변환 시간이 confirm 응답 시간에 더해지지 않는다. 변환은 워커 로그에 따로 찍힌다(`썸네일 생성: ... 8592B → 146B (16ms)`).

4. 썸네일이 아직 없을 때는 원본을 보여 준다. 목록은 `thumbnailKey ?? imageKey`로 읽기 URL을 만들고, `thumbnailReady`를 함께 내려준다. confirm 직후 목록은 `thumbnailReady=false`에 원본 `.png` 주소였고, 1초 뒤에는 `thumbnailReady=true`에 `.thumb.webp` 주소였다.

> 워커가 썸네일을 다 만든 순간 이미지가 이미 다른 것으로 바뀌었을 수 있다. 그래서 연결은 `imageKey`가 아직 그 원본일 때만 하고(`updateMany`의 조건), 아니면 만든 썸네일을 지운다. 고아 정리 작업도 `thumbnailKey`를 "가리키는 파일"로 세야 썸네일을 지우지 않는다.

### 남길 것

- **찾아보면 되는 것**: 진단 3의 저장소 에러 코드 표, URL 쿼리를 뜯어보는 한 줄 명령, 사전 요청 `curl`의 헤더 세 개. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 업로드 문제는 "파일이 있는가(저장소) → DB가 가리키는가 → 목록이 URL을 내려주는가" 순서로 층을 가른다.
  
  - presigned URL은 읽히는 문자열이다. 무엇이 서명됐고 언제 만료되는지는 URL에 다 적혀 있다.

- **에러 신호**:
  
  - `NoSuchBucket` → `S3_BUCKET` 값과 서버 시작 로그의 `버킷 생성`
  
  - 브라우저가 서명된 URL의 주소를 찾지 못한다 → URL에 들어간 `S3_ENDPOINT`가 브라우저에서 닿는 주소인지(진단 5)

## 9. 완성 확인

### 시험해보기

```sh
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1 # ①②③ 모두 성공
node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1 # ③ 400 이미지 파일이 아니다
node scripts/list-objects.mjs # 상품 1이 가리키는 파일 + 방금 거절된 것은 지워져 없다
```

### 체크리스트

- [ ] 이미지 바이트가 우리 서버를 거치지 않고 저장소로 바로 간다(Network 탭에서 PUT의 목적지가 9000번)

- [ ] 허가받지 않은 타입·크기로 PUT 하면 `SignatureDoesNotMatch`, 만료된 URL은 `AccessDenied`

- [ ] 확장자가 `.png`인 HTML은 confirm에서 거절되고 저장소에서도 지워진다

- [ ] 남의 상품 키, 올리지 않은 키로는 confirm할 수 없다

- [ ] 버킷 CORS를 틀리게 하면 브라우저에서만 실패하는 것을 재현했다

- [ ] 고아 파일이 리더의 정리 작업으로 지워지고, 막 올린 파일은 최소 나이 전까지 남는다

- [ ] `npm run test:e2e`(프론트) 6개가 통과한다

## 10. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 파일을 우리 API 서버로 받아서 저장소로 넘기는 방식의 비용은 무엇인가? presigned URL은 그 비용을 어떻게 없애는가?

2. presigned URL과 `03`의 액세스 토큰은 무엇이 닮았고, 그래서 둘 다 무엇을 짧게 하는가?

3. `X-Amz-SignedHeaders`에 `content-type`이 없으면 무슨 일이 생겼는가?

4. 서명 검사를 다 통과한 HTML 파일을 confirm이 어떻게 걸러 냈는가? `Content-Type`을 믿으면 안 되는 이유는?

5. 키를 클라이언트가 아니라 서버가 정하는 이유는?

6. 스크립트로는 되는데 브라우저에서만 업로드가 실패한다면, 무엇을 먼저 의심하는가?

7. 고아 파일은 왜 막을 수 없고, 정리할 때 최소 나이가 필요한 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 큰 파일을 여러 조각으로 나눠 올리기(멀티파트 업로드), 중간에 끊긴 업로드 이어 하기

- 크기 제한을 POST 정책(`content-length-range`)으로 거는 presigned POST 방식

- 이미지 변환·썸네일, 바이러스 검사

- CDN을 앞에 두고 서명된 쿠키/URL로 배포하기, 공개 버킷과 비공개 버킷 나누기

- 저장소 자체의 수명 주기 규칙(일정 기간이 지난 파일 자동 삭제)
