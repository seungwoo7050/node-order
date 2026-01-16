# 화면 다듬기: 시안을 먼저 그리고 토큰으로 옮기고 시안과 대조하기

## 목표

이 프로젝트는 [`18-deploy`](https://github.com/seungwoo7050/node-order/tree/18-deploy)로부터 시작한다.

`18`에서 배포한 주문 콘솔은 기능은 모두 되지만, 브라우저 기본 스타일 그대로다.

순서는 실무와 같다. **코드보다 시안이 먼저**고, 시안에서 정한 값(토큰)만 코드로 옮긴 뒤, 마지막에 실제 화면을 시안과 대조한다.

과하게 꾸미지 않고, 이 서비스에 필요한 화면만 정돈한다.

1. 대표 화면 하나를 같은 데이터로 방향 몇 가지로 그려 보고 하나를 고른다

2. 화면마다 생길 수 있는 상태(불러오는 중·빈 상태·오류·오프라인)를 빠짐없이 적고, 필요한 만큼 시안을 그린다. 이 과정에서 빠진 기능과 틀린 문구가 드러난다

3. 시안이 요구하는 API를 정리한다: 관리자 역할, 주문 상세의 상품, 결제 취소 안내의 주문 번호

4. 색·글자·간격을 토큰으로 정하고, 화면은 토큰 이름으로만 그린다. 장바구니 수량 조절을 더한다

5. 실제 화면을 데스크톱·휴대폰, 라이트·다크로 바꿔 가며 시안과 대조하고, 어긋난 곳을 고친다

6. 푸시해서 `18`의 길로 운영에 배포하고, 배포한 화면을 사용자 입장에서 써 보며 다시 고친다(데모 로그인, 관리자 페이지, 장바구니 페이지)

```text
https://shop.3-106-98-215.sslip.io/shop
  주문 콘솔                        상품  내 주문  관리  장바구니 3  로그아웃
  상품
  ──────────────────────────────────────────────────
  [한]  한정판 키보드                        [- 1 +]     # 담으면 그 자리가 수량 조절기
        150,000원  재고 10
  ──────────────────────────────────────────────────
  [무]  무선 헤드폰                          [ 담기 ]
        90,000원  재고 30
  ──────────────────────────────────────────────────
                            [ 마우스를 담았습니다.  장바구니 보기 ]

/cart            장바구니:        수량 조절·빼기·합계·결제하기
/admin/products  상품 관리:       관리자에게만(이미지 올리기·바꾸기)
/login           데모로 둘러보기: [일반 사용자로] [관리자로]
```

> 시작 기준점:  
> 저장소 루트가 곧 `18`의 통합본이다(npm 워크스페이스: `order-api-nest`, `order-console-next`, 루트의 `compose.yaml`·`deploy/`·`monitoring/`). 그리고 `18`에서 띄운 운영 서버(`3.106.98.215`, `/opt/node-order`)가 있다. 이 문서에서 **운영**은 실제 사용자가 쓰는 배포 환경(production)을 말한다. 운영 서버, 그 서버가 쓰는 운영 DB(RDS), 사용자가 여는 운영 화면(`https://shop.3-106-98-215.sslip.io`)을 묶어 부르는 말이고, 내 PC의 로컬 환경과 대비된다.  
> 이 문서의 코드는 `order-console-next`(화면)가 대부분이고, 시안이 요구한 만큼 `order-api-nest`(API)를 조금 바꾼다. 경로는 모두 저장소 루트 기준이다.  
> 이 단계의 브랜치는 `19-design`이다. 배포는 `18`과 같은 서버·같은 워크플로로 하고, 배포 브랜치만 저장소 변수 `DEPLOY_BRANCH`로 바꾼다(9장).

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 11장에서 증상이 어느 층(토큰·권한·캐시)에서 생겼는지 가르는 절차 | 친다(브라우저 콘솔, `curl`, `psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 11장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가른다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드·스타일·테스트 작성과 수정, 마이그레이션, 패키지 설치(`package.json`·lock), 워크플로 | 한다 |
| `[실행]` | 저장소 밖의 상태: 로컬 컨테이너와 DB 데이터, GitHub 저장소 변수(`DEPLOY_BRANCH`), 운영 DB의 역할, 서버의 `.env`. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 화면 대조, 결과 비교 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`.

- 8장 작업 1의 대조는 남는 것이 없다(`[확인]`). 대조에서 고친 것은 각 장의 `[커밋]` 작업에 이미 들어 있다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 11장 "진단 5"의 표에 모두 모았다.

- 0장(사전지식)과 2·3장(방향 고르기, 시안)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 확인 명령뿐이고 12·13장은 체크리스트와 자가 점검이라 `남길 것`을 두지 않았다.

- 상점 화면(`app/shop/page.tsx`), 머리글(`app/nav.tsx`), 로그인 화면(`app/login/page.tsx`)은 10장에서 다시 바뀐다. 6장에는 그때 정한 부분만 싣고, 파일 전체의 최종 모양은 10장 작업에 싣는다. 나머지 파일은 처음 나올 때부터 최종 모양이다.

| 단계 | 하는 일 |
|---|---|
| [0. 화면 다듬기에 대한 사전지식](#0-화면-다듬기에-대한-사전지식) | 작업 흐름, 디자인 토큰, 화면과 테스트의 계약(작업 없음) |
| [1. 준비](#1-준비) | 로컬에서 DB·API·웹을 띄운다 |
| [2. 1단계: 방향 고르기](#2-1단계-방향-고르기) | 대표 화면 하나를 같은 데이터로 방향마다 그려 비교하고 하나를 고른다(작업 없음) |
| [3. 2단계: 상태 목록과 시안](#3-2단계-상태-목록과-시안) | 화면마다 상태를 빠짐없이 적고 필요한 만큼 시안을 그리며, 빠진 기능과 틀린 문구를 찾는다(작업 없음) |
| [4. 3단계: 화면이 기대는 API 정리](#4-3단계-화면이-기대는-api-정리) | 관리자 역할과 가드, 프로필, 주문 상세의 상품, 취소 주소의 주문 번호 |
| [5. 4단계: 토큰을 코드로](#5-4단계-토큰을-코드로) | `globals.css`에 토큰·본문 규칙·컴포넌트 클래스를, `layout.tsx`에 글꼴을 넣는다 |
| [6. 5단계: 화면](#6-5단계-화면) | 머리글, 수량 조절, 상품 화면의 상태, 내 주문, 주문 상세, 로그인 |
| [7. 6단계: 테스트](#7-6단계-테스트) | 바뀐 화면에 e2e를 맞추고, 프론트에 Vitest 단위 테스트를 더한다 |
| [8. 7단계: 시안과 대조하기](#8-7단계-시안과-대조하기) | 실제 화면을 시안과 비교하고, 이미지 바꾸기를 관리자에게만 보이게 한 뒤 e2e가 찾은 캐시 버그를 고친다 |
| [9. 8단계: 배포하고, 운영에서 관리자를 지정한다](#9-8단계-배포하고-운영에서-관리자를-지정한다) | 배포 브랜치를 이 브랜치로 바꿔 배포하고, 운영 DB의 관리자를 SQL로 정한다 |
| [10. 9단계: 배포한 화면을 사용자 입장에서 써 보기](#10-9단계-배포한-화면을-사용자-입장에서-써-보기) | 데모 로그인, 장바구니 페이지, 관리자 페이지, 한글 줄바꿈, 넓은 화면 |
| [11. 디버깅](#11-디버깅) | 클래스·글꼴·역할·데모 설정을 차례로 확인하고, 에러 신호를 한 표로 본다 |
| [12. 완성 확인](#12-완성-확인) | 체크리스트 |
| [13. 다음 단계](#13-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 화면 다듬기에 대한 사전지식

### 개념 1 | 작업 흐름

| 단계 | 무엇을 | 결과물 |
|---|---|---|
| 방향 비교 | 같은 화면·같은 데이터로 방향 몇 가지를 나란히 | 방향 하나 |
| 시안 | 모든 화면 × 상태 × 화면 폭 | 확정한 그림과 문구 |
| 토큰 | 색·글자·간격·선을 이름 붙인 값으로 | `globals.css` |
| 구현 | 화면은 토큰 이름으로만 그린다 | 컴포넌트 |
| 대조 | 실제 화면을 시안과 비교 | 고친 목록 |

시안 없이 바로 코드로 가면 "빈 장바구니는 어떻게 보이지?", "휴대폰에서 장바구니는 어디에 두지?" 같은 결정을 코드를 쓰다가 그때그때 하게 된다.

화면마다 결정이 달라지고, 결과물이 들쭉날쭉해진다.

반대로 시안을 끝까지 그려 보면, 화면에 보여 줄 데이터가 API에 없다는 사실까지 코드 전에 드러난다(3장).

### 개념 2 | 디자인 토큰

토큰은 "이 서비스의 색·글자·간격은 이것뿐"이라는 약속이다. 화면 코드에는 `#66665f` 같은 값이 아니라 `text-muted` 같은 이름만 나온다.

다크 모드는 이름은 그대로 두고 값만 바꾸면 된다.

새 화면을 만들 때도 고를 수 있는 것이 정해져 있어서, 화면끼리 어긋나지 않는다.

### 개념 3 | 화면과 테스트의 계약

e2e는 `17`·`18`의 CI가 매번 돌린다.

화면을 다시 그려도 테스트가 기대는 것(역할·이름으로 찾는 버튼, `data-testid`)은 지킨다.

문구나 구조를 일부러 바꾼 곳만 테스트를 고친다(7장).

## 1. 준비

`18`의 통합본을 그대로 이어받는다. 저장소 루트에서 시작한다. 화면을 확인하려면 로컬에서 API와 웹을 띄운다(`16`과 같다).

### 작업 1. [실행] 로컬에서 DB·API·웹 띄우기

```sh
# 저장소 루트에서
docker compose up -d db redis storage
npm ci
cd order-api-nest && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && cd ..
npm run dev:api
```

```sh
# 다른 터미널에서(저장소 루트)
npm run dev:web
```

백엔드 e2e는 개발 DB가 아니라 테스트 전용 DB(`order_api_test`)를 쓴다(`16`의 5단계). 이 폴더의 compose는 새 볼륨이라 테스트 DB가 없으므로 한 번 만들어 둔다. 4장에서 이 DB에 새 마이그레이션을 적용한다.

```sh
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
```

- compose 프로젝트 이름은 폴더 이름(`node-order`)에서 온다. 다른 단계의 폴더에서 띄운 compose가 아직 떠 있으면 포트(`5433`·`6380`·`9000`)가 겹쳐 `port is already allocated`로 실패한다. 그쪽에서 `docker compose down`으로 먼저 내린다.

- `deploy/aws/.local/`(SSH 키, DB 비밀번호, 서버 `.env`의 원본)은 `.gitignore`에 걸려 커밋으로 따라오지 않는다. 9·10장에서 운영 서버에 접속할 때 쓰므로 `18`의 폴더에서 함께 옮겨 와 있어야 한다(`18`의 6단계 "다음 단계 브랜치로 넘어갈 때 할 일").

## 2. 1단계: 방향 고르기

### 개념 | 같은 데이터로 방향 몇 개를 나란히 비교한다

방향을 고를 때는 화면을 다 그리지 않는다. 이 서비스의 얼굴인 화면 하나(상품 + 장바구니)만, 같은 데이터로 방향마다 한 장씩 그려 나란히 놓는다. 완성도는 낮아도 된다. 색·글자·여백의 느낌만 보이면 고를 수 있다.

데이터가 다르면 "상품이 많아 보여서 좋다" 같은, 방향과 상관없는 이유로 고르게 된다.

후보는 네 개였다.

| 방향 | 특징 | 잘 맞는 점 | 주의할 점 |
|---|---|---|---|
| 기능 우선의 절제 | 회색 바탕 + 흰 패널, 강조색은 주 동작 하나, 상태는 표시등 같은 점 | 업무 화면에 맞고 유행을 덜 탄다 | 간격이 정확하지 않으면 밋밋하다 |
| 격자와 글자 위계 | 상자 없이 정렬과 글자 크기 차이만으로 위계 | 목록·숫자가 많은 화면이 읽기 쉽다 | 딱딱해 보일 수 있다 |
| 절제 + 여백 | 넓은 여백, 가는 글자, 거의 무채색, 제목만 명조 | 첫인상이 차분하다. 지금 데이터 양에 맞는다 | 정보 밀도가 낮다. 대비를 계속 확인해야 한다 |
| 촘촘한 도구형 | 낮은 행, 1px 선, 고정폭 숫자, 상태 칩 | 관리 도구에 맞는다 | 흔한 모양이라 비슷해 보이기 쉽다 |

**절제 + 여백**을 골랐다. 이 서비스의 화면은 상품 네 개와 주문 몇 건이라, 밀도보다 차분함이 낫다.

정보 밀도가 낮다는 약점은 목록에서 번호·날짜·금액·상태를 같은 열에 맞추는 것으로 보완한다.

## 3. 2단계: 상태 목록과 시안

### 개념 | 상태는 빠짐없이 적고, 그림은 필요한 만큼만 그린다

고른 방향으로 시안을 그리기 전에, 화면마다 생길 수 있는 상태를 먼저 목록으로 적는다. 목록은 빠짐없이 적되, 모든 칸을 그림으로 그리지는 않는다.

| 화면 | 상태 |
|---|---|
| 상품 + 장바구니 | 기본, 불러오는 중, 오류, 빈 장바구니, 수량 조절, 재고 상한, 품절 |
| 결제 취소 후 돌아옴 | `/shop?checkout=canceled` |
| 주문 상세 | 결제를 확인하는 중(웹훅 대기), 결제 완료 |
| 내 주문 | 목록, 빈 상태 |
| 로그인 | 기본, 비밀번호 오류 |
| 공통 | 오프라인 띠, 다크 모드 |

- **두 폭(데스크톱 1280, 휴대폰 390)으로 그리는 것**: 각 화면의 기본 상태. 배치가 폭에 따라 바뀌는 곳(상품 줄, 주문 목록의 열)이 여기서 드러난다.
- **한 폭으로만 그리는 것**: 나머지 상태. 대개 기본 화면의 한 부분만 바뀌므로(안내 문장 하나, 버튼 하나) 그 부분만 그리거나 문장으로 적어 둔다.
- **다크 모드**: 화면마다 그리지 않는다. 색을 토큰으로 정하면(4단계) 다크는 토큰 값만 바뀐다. 대표 화면 하나로 대비를 확인한다.

상태 목록을 적는 것만으로도 "이 상태에서 화면은 무엇을 보여 주지?"라는 질문이 생긴다. 아래 항목은 대부분 그림을 그리기 전에, 목록을 채우다가 나왔다.

### 개념 | 코드보다 먼저 드러난 것

#### 결제를 취소하고 돌아오면 아무 안내가 없다

`14`의 `cancel_url`은 `/shop?checkout=canceled`인데, 화면은 이 쿼리를 읽지 않는다.

주문이 어떻게 되는지(결제 대기로 남았다가 기한이 지나면 취소, 재고 복원) 알려 줘야 한다. 그러려면 어떤 주문인지 알아야 하는데, 주소에 주문 번호가 없다.

#### 결제 기한을 잘못 알고 있었다

안내 문구에 처음에는 "30분"이라고 썼다.

코드를 확인하니 Checkout 세션을 만들 때 기한(`expires_at`)을 주지 않아 Stripe 기본값인 24시간이 적용된다.

#### 주문 상세에 무엇을 샀는지가 없다

쇼핑 서비스의 주문 상세에는 거의 항상 상품 목록이 있다.

하지만 API는 번호·금액·상태·날짜만 돌려준다.

#### 이미지 바꾸기를 누가 할 수 있는가

시안에서 각 상품 줄에 "이미지 바꾸기"를 그리다가 확인해 보니, `06`의 업로드 API는 로그인만 요구한다.

로컬에서는 문제가 없었지만, 지금은 GitHub 계정만 있으면 누구나 로그인하는 공개 주소다.

#### 보조 글자색의 대비

여백 방향은 회색 글자를 많이 쓴다. 처음 고른 회색은 바탕 위 명암비가 약 3.4:1이라 기준(4.5:1)에 못 미쳤다.

개발자 도구의 색 선택기로 명암비를 보며 `#66665f`(5.6:1)까지 진하게 했다(5장).

> 주문 번호, 주문 상세의 상품, 관리자 역할은 API를 바꿔야 해서 다음 장에서 먼저 처리한다.

## 4. 3단계: 화면이 기대는 API 정리

### 작업 1. [커밋] 사용자 역할을 스키마에 넣고 마이그레이션 만들기

```prisma
// order-api-nest/prisma/schema.prisma
// enum Role을 새로 만들고, User 모델에 role 한 줄을 추가한다
// 사용자 역할. 관리자만 할 수 있는 일(상품 이미지 바꾸기)을 가린다
enum Role {
  user
  admin
}

model User {
  id            String      @id
  name          String
  role          Role        @default(user)
  // ... 나머지 필드(passwordHash, githubId, createdAt, orders, refreshTokens) 그대로 ...
}
```

마이그레이션 파일은 `--create-only`로 만들기만 하고, DB에는 아직 적용하지 않는다.

```sh
cd order-api-nest
npx prisma migrate dev --create-only --name user_role
# prisma/migrations/20260106123456_user_role/migration.sql 이 생긴다
```

Prisma는 폴더 이름 앞에 시각(`20260106123456`)을 붙인다. 폴더 이름의 앞쪽이 적용 순서인데, 이 저장소는 `0001_init`부터 `0016_stripe_checkout`까지 네 자리 번호를 쓴다. 그래서 폴더 이름을 `0017_user_role`로 바꾼다.

```sh
mv prisma/migrations/*_user_role prisma/migrations/0017_user_role
```

시각을 그대로 두어도 `2026…`이 `0016…`보다 뒤에 정렬되니 순서는 맞다. 하지만 번호 규칙이 섞이면 목록에서 몇 번째 변경인지 바로 읽히지 않는다.

생성된 SQL에 왜 이 변경이 안전한지 주석을 붙인다.

```sql
-- order-api-nest/prisma/migrations/0017_user_role/migration.sql
-- 사용자 역할. 기존 사용자는 모두 일반 사용자(user)가 된다
-- 기본값이 있는 열 추가라 이전 버전의 코드도 그대로 돈다 - 배포가 실패해 되돌려도 안전하다(18의 6단계 "되돌리기와 마이그레이션")
CREATE TYPE "Role" AS ENUM ('user', 'admin');

ALTER TABLE "users" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'user';
```

기본값이 있는 열 추가다. 이전 버전의 코드는 이 열을 모르고 그대로 돈다.

그래서 배포가 실패해 이전 버전으로 돌아가도 안전하다(`18`의 6단계 "서버에서 실행하는 배포 스크립트"의 "되돌리기와 마이그레이션").

폴더 이름을 바꾼 뒤에 적용한다. `--create-only` 없이 `migrate dev`를 돌리면 시각이 붙은 이름으로 바로 적용되고, 그 뒤에 이름을 바꾸면 DB에 기록된 이력(`_prisma_migrations`)과 폴더 이름이 어긋난다.

로컬 DB는 지금까지처럼 `migrate dev`로, 테스트 DB는 `migrate deploy`로 적용하고, Prisma Client를 다시 만든다.

```sh
# order-api-nest 폴더에서
npx prisma migrate dev
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npx prisma generate
```

`dev`와 `deploy`는 배포 전·후가 아니라 "스키마를 바꾸는 쪽인가, 이미 만든 파일을 적용만 하는 쪽인가"의 차이다.

`migrate dev`는 개발자의 DB에서 쓴다. 아직 적용하지 않은 폴더(`0017_user_role`)를 적용한 뒤, 스키마 파일과 마이그레이션 이력을 다시 비교해 남은 차이가 있으면 새 마이그레이션을 만든다. 이력과 DB가 어긋나 있으면(drift) DB를 지우고 다시 만들자고(reset) 묻는다. 그래서 shadow DB가 필요하고, 데이터를 잃어도 되는 DB에서만 쓴다.

`migrate deploy`는 폴더를 만들지도, 스키마 파일과 비교하지도, reset을 묻지도 않는다. 적용하지 않은 폴더를 순서대로 적용하기만 한다. 사람이 대답할 수 없는 곳(CI의 테스트 DB, `18`에서 만든 `migrate` 이미지가 운영 DB에 돌리는 명령)은 모두 이 명령이다.

테스트 DB에 `deploy`를 쓰는 것도 같은 이유다. CI(`.github/workflows/ci.yml`)가 테스트 DB를 이 명령으로 만들므로, 로컬 테스트 DB도 똑같이 맞춘다.

`generate`를 빼먹으면 생성된 타입에 `role`이 없어, 아래 코드에서 `role`을 쓰는 곳마다 타입 에러가 난다.

테스트 DB에 적용하지 않으면 백엔드 e2e가 `role` 열이 없다는 에러로 실패한다. 테스트 DB 자체가 없다면 1장의 `createdb`부터 한다.

로컬 시드의 `kim`을 관리자로 만든다.

```ts
// order-api-nest/prisma/seed.ts
// users 배열의 kim 한 줄만 바꾼다
// kim은 관리자(상품 이미지를 바꿀 수 있다)
const users = [
  { id: "kim", name: "김", role: "admin" as const },
  { id: "lee", name: "이" },
  { id: "park", name: "박" },
  { id: "choi", name: "최" },
];
```

```sh
npx prisma db seed
```

### 용어 | Prisma 마이그레이션 명령

- `prisma migrate dev --create-only --name <이름>`: 마이그레이션 이력과 스키마 파일의 차이를 SQL로 만들어 `prisma/migrations/<시각>_<이름>/migration.sql`에 저장한다. 이력을 다시 돌려 볼 임시 DB(shadow DB)를 스스로 만들었다 지운다. `--create-only`가 있으면 설정 파일(`prisma7.config.ts`)이 가리키는 DB에는 적용하지 않는다.

- `prisma migrate dev`: 아직 적용하지 않은 폴더를 적용하고, 스키마 파일과 남은 차이가 있으면 새 마이그레이션을 만든다. drift가 있으면 reset을 묻는다. 개발자의 로컬 DB 전용이다.

- `prisma migrate deploy`: `prisma/migrations/` 안에서 아직 적용하지 않은 폴더를 순서대로 적용하기만 한다. 비교·생성·reset을 하지 않아 묻는 일이 없다. CI의 테스트 DB와 운영 배포가 이 명령을 쓴다.

- `@default(user)`: DB 열의 `DEFAULT 'user'`가 된다. 기존 행에도 이 값이 채워진다.

- `"admin" as const`: 문자열을 `string`이 아니라 `"admin"` 타입으로 고정한다. Prisma의 `Role` 타입은 `"user" | "admin"`이라 그냥 `string`은 넣을 수 없다.

### 작업 2. [커밋] 역할을 액세스 토큰에 담기

역할은 액세스 토큰에 담는다. 토큰을 새로 받을 때(로그인, refresh)마다 DB에서 다시 읽는다.

```ts
// order-api-nest/src/auth/auth.service.ts
// issueTokens 안의 jwtService.sign 한 줄을 이 두 줄로 바꾼다
    // 역할을 토큰에 담는다. 토큰을 새로 받을 때(로그인·refresh)마다 DB에서 다시 읽으므로, 역할이 바뀌면 늦어도 액세스 토큰 수명(15분) 뒤에 반영된다
    const { role } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const accessToken = this.jwtService.sign({ sub: userId, role });
```

```ts
// order-api-nest/src/auth/jwt.strategy.ts
// validate를 바꾼다. 반환값에 role이 더해진다
  validate(payload: { sub: string; role?: string }) {
    // 여기서 반환한 값이 req.user가 된다. 역할이 없는 토큰(역할을 넣기 전에 발급)은 일반 사용자로 본다
    return { userId: payload.sub, role: payload.role === "admin" ? "admin" : "user" };
  }
```

### 개념 | 토큰에 담긴 역할: 서명은 위조를 막을 뿐 내용을 숨기지 않는다

JWT의 가운데 조각(payload)은 암호화가 아니라 base64url 인코딩일 뿐이다. 토큰을 가진 사람은 누구나 `{ sub: "kim", role: "admin", iat, exp }`를 읽을 수 있다.

막는 것은 고치는 쪽이다. `role`을 `"admin"`으로 바꾸면 서명이 맞지 않아, `JwtStrategy`가 `validate`를 부르기 전에 401로 끝난다.

그래서 역할처럼 "읽혀도 되지만 고쳐지면 안 되는 것"은 토큰에 담아도 된다. 비밀번호 해시 같은 것은 담지 않는다.

- 역할이 바뀌면 언제 반영되는가: 액세스 토큰은 15분짜리라, 늦어도 다음 refresh 때 새 역할이 들어간다.

- 역할이 없는 옛 토큰은 일반 사용자로 본다. 배포 직후 이미 로그인해 있던 사람의 토큰에는 `role`이 없다.

> 즉시 막아야 하는 일(권한 회수)이라면 `03`의 "모든 기기에서 로그아웃"으로 refresh 사슬을 끊는다.

### 작업 3. [커밋] 관리자 가드를 만들고 업로드 API에 걸기

```ts
// order-api-nest/src/auth/admin.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

// 관리자만 통과시킨다. AuthGuard("jwt") 뒤에 둔다 - 그 가드가 토큰을 확인하고 req.user를 채운다
// 로그인하지 않았으면 앞의 가드가 401, 로그인했지만 관리자가 아니면 여기서 403
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user;
    if (user?.role !== "admin") throw new ForbiddenException("관리자만 할 수 있습니다");
    return true;
  }
}
```

```ts
// order-api-nest/src/products/product-images.controller.ts
// import 한 줄을 더하고, 클래스 위에 주석을 달고 @UseGuards에 AdminGuard를 더한다(지금은 AuthGuard("jwt") 하나뿐이다)
import { AdminGuard } from "../auth/admin.guard.js";

// 상품 이미지는 관리자만 바꾼다. 지금까지는 로그인만 요구했다 - 공개 주소에 배포하면 누구나 상품 사진을 바꿀 수 있다
// 가드는 적힌 순서대로 돈다: 토큰 확인(401) → 관리자 확인(403)
@Controller("products/:id/image")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductImagesController {
```

`AdminGuard`는 어느 모듈의 `providers`에도 적지 않았다. `@UseGuards()`에 클래스를 넘기면 Nest가 그 컨트롤러의 모듈 안에서 직접 만들어 쓴다.

### 개념 | 가드는 적힌 순서대로 돈다: 401과 403

`@UseGuards(A, B)`는 A가 `true`를 돌려줘야 B를 부른다. 어느 하나가 예외를 던지면 거기서 멈추고 컨트롤러 메서드는 불리지 않는다.

| 요청 | `AuthGuard("jwt")` | `AdminGuard` | 응답 |
|---|---|---|---|
| 토큰 없음 | 401에서 멈춘다 | 불리지 않는다 | 401 |
| lee(일반 사용자) | 통과, `req.user = { userId: "lee", role: "user" }` | `ForbiddenException` | 403 |
| kim(관리자) | 통과, `req.user = { userId: "kim", role: "admin" }` | 통과 | 201 |

순서를 바꿔 `@UseGuards(AdminGuard, AuthGuard("jwt"))`로 쓰면, `AdminGuard`가 돌 때 `req.user`가 아직 없다. 관리자도 `user?.role`이 `undefined`라 403을 받는다.

401과 403은 뜻이 다르다. 401은 "누구인지 모르겠다(다시 로그인하라)", 403은 "누구인지는 알지만 이 일은 안 된다"다.

화면도 이 둘을 다르게 다룬다. 401이면 refresh를 시도하고, 403이면 시도해도 소용없다.

### 작업 4. [커밋] 업로드 권한 e2e

e2e(`test/product-images.e2e-spec.ts`)는 세 경우를 본다. 로그인하지 않음 401, 일반 사용자 403, 관리자 201.

```ts
// order-api-nest/test/product-images.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { adminDb } from "./admin-db.js";

// 상품 이미지는 관리자만 바꾼다 - 로그인하지 않으면 401, 일반 사용자는 403, 관리자만 업로드 URL을 받는다
describe("상품 이미지 업로드 권한", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    const passwordHash = await hashPassword(process.env.DEMO_PASSWORD!);
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", passwordHash, role: "admin" }, { id: "lee", name: "이", passwordHash }] });
    await adminDb.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } }); // id 1
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  // 로그인해서 받은 액세스 토큰 - 역할은 로그인할 때 DB에서 읽어 토큰에 담긴다
  const tokenOf = async (id: string) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: process.env.DEMO_PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  const askUploadUrl = (token?: string) =>
    fetch(`${baseUrl}/products/1/image/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ contentType: "image/png", size: 100 }),
    });

  it("로그인하지 않으면 401", async () => {
    expect((await askUploadUrl()).status).toBe(401);
  });

  it("일반 사용자는 403", async () => {
    const res = await askUploadUrl(await tokenOf("lee"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe("관리자만 할 수 있습니다");
  });

  it("관리자는 업로드 URL을 받는다", async () => {
    const res = await askUploadUrl(await tokenOf("kim"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { key: string }).key).toMatch(/^products\/1\/.+\.png$/);
  });
});
```

### 실험 | 일부러 깨뜨려보기: 가드를 빼면

`@UseGuards(AuthGuard("jwt"), AdminGuard)`에서 `AdminGuard`만 빼고 `npm run test:e2e -w order-api-nest`를 돌리면 이렇게 실패한다.

```text
 × 일반 사용자는 403
AssertionError: expected 201 to be 403
```

`18`에서 배포한 운영 서버가 바로 이 상태였다. GitHub로 로그인한 누구나 상품 사진을 바꿀 수 있었다.

확인했으면 `AdminGuard`를 되돌린다.

### 작업 5. [커밋] 화면이 쓰는 프로필

화면은 "이미지 바꾸기"를 관리자에게만 보여야 한다. 역할을 알려 주는 프로시저를 더한다.

```ts
// order-api-nest/src/trpc/router.ts
// me 라우터의 맨 앞(orders 위)에 추가한다
    // 화면이 이름과 역할(관리자에게만 보이는 버튼)을 알기 위해 쓴다. 역할은 토큰이 아니라 DB에서 읽는다 - 화면 표시용일 뿐, 권한 검사는 서버의 각 API가 한다
    profile: protectedProcedure.query(({ ctx }) =>
      ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true, role: true } }),
    ),
```

화면 쪽에서는 이 프로시저를 부르는 훅을 하나 둔다. 머리글과 관리자 화면이 쓴다.

```ts
// order-console-next/lib/use-profile.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./auth-store";
import { useTRPC } from "./trpc";

// 로그인한 사람의 이름과 역할. 로그인하지 않았으면 묻지 않는다
export function useProfile() {
  const trpc = useTRPC();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  return useQuery({ ...trpc.me.profile.queryOptions(), enabled: loggedIn });
}

// 관리자인가. 화면에 메뉴·버튼을 보일지 정하는 데만 쓴다 - 권한 검사는 서버의 각 API가 한다(AdminGuard)
export function useIsAdmin() {
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  const { data } = useProfile();
  return loggedIn && data?.role === "admin";
}
```

> 화면에서 숨기는 것은 권한 검사가 아니다. 버튼을 숨겨도 누구나 API를 직접 부를 수 있다.  
> 막는 것은 서버의 `AdminGuard`다. 화면의 역할 확인은 쓸 수 없는 버튼을 보여 주지 않으려는 것일 뿐이다.

### 작업 6. [커밋] 주문 상세의 상품, 최신 주문이 위로

```ts
// order-api-nest/src/me/order-select.ts
// 파일 전체다. 지금은 orderSelect 한 줄뿐이다 - 주석을 달고, 아래에 orderDetailSelect를 추가한다
// "내 주문" 응답에 내보낼 칸. REST(me.controller.ts)와 tRPC(trpc/router.ts)가 함께 쓴다
// 데코레이터가 없는 파일로 따로 둔다 - tRPC 라우터가 끌어오는 파일은 프론트의 타입 검사도 받기 때문이다
export const orderSelect = { id: true, price: true, paid: true, canceledAt: true, createdAt: true } as const; // canceledAt(만료로 취소)

// 주문 상세에는 무엇을 몇 개 샀는지도 보낸다. order_items는 "그 주문이 보이면 보인다"는 RLS 정책이라 사용자 트랜잭션 안에서 그대로 읽는다
// unitPrice : 주문할 때의 가격. 상품 가격이 나중에 바뀌어도 주문 내역은 그대로여야 한다
export const orderDetailSelect = {
  ...orderSelect,
  items: { select: { quantity: true, unitPrice: true, product: { select: { id: true, name: true } } }, orderBy: { productId: "asc" } },
} as const;
```

`10`의 RLS에서 `order_items`는 "그 주문이 보이면 보인다"는 정책이었다. 그래서 상품까지 함께 읽어도 사용자 트랜잭션(`asUser`) 안에서 남의 주문 품목은 보이지 않는다.

상세는 이 선택(`orderDetailSelect`)을 쓰고, 목록은 REST·tRPC 모두 `orderBy: { id: "desc" }`로 바꾼다. 두 파일에서 같은 두 군데를 고친다.

```ts
// order-api-nest/src/trpc/router.ts
// import에 orderDetailSelect를 더하고, me.orders의 orderBy와 me.order의 select를 바꾼다
import { orderDetailSelect, orderSelect } from "../me/order-select.js";
// ...
        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "desc" } }), // 최신 주문이 위로
// ...
        tx.order.findFirst({ where: { id: input.id, userId: ctx.userId }, select: orderDetailSelect }),
```

```ts
// order-api-nest/src/me/me.controller.ts
// REST도 같다. import, myOrders의 orderBy, myOrder의 select를 바꾼다
import { orderDetailSelect, orderSelect } from "./order-select.js";
// ...
    return this.prisma.asUser(userId, (tx) => tx.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "desc" } })); // 최신 주문이 위로
// ...
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({ where: { id, userId }, select: orderDetailSelect }));
```

`trpc/router.ts`는 프론트가 타입을 가져가는 파일이다. 저장하면 화면 쪽의 `data.items`도 바로 타입이 생긴다.

프로필과 주문 상세를 tRPC 회귀 테스트에 더한다.

```ts
// order-api-nest/test/trpc.e2e-spec.ts
// beforeEach의 사용자 시드에서 kim에 role: "admin"을 붙이고, 테스트 두 개를 추가한다
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
  ...
  it("me.profile은 이름과 역할을 준다(역할은 DB에서 읽는다)", async () => {
    expect(await callerAs("kim").me.profile()).toEqual({ id: "kim", name: "김", role: "admin" });
    expect(await callerAs("lee").me.profile()).toEqual({ id: "lee", name: "이", role: "user" });
    expect(await codeOf(callerAs(null).me.profile())).toBe("UNAUTHORIZED");
  });

  it("주문 상세에는 산 상품이 붙고, 목록은 최신 주문이 위로 온다", async () => {
    await adminDb.product.createMany({ data: [{ name: "키보드", price: 150000, stock: 5 }, { name: "마우스", price: 30000, stock: 5 }] });
    await adminDb.order.create({
      data: { userId: "kim", price: 210000, paid: false, items: { create: [{ productId: 2, quantity: 2, unitPrice: 30000 }, { productId: 1, quantity: 1, unitPrice: 150000 }] } },
    }); // id 3
    const kim = callerAs("kim");
    expect((await kim.me.orders()).map((o) => o.id)).toEqual([3, 1]);
    const detail = await kim.me.order({ id: 3 });
    expect(detail.items).toEqual([
      { quantity: 1, unitPrice: 150000, product: { id: 1, name: "키보드" } },
      { quantity: 2, unitPrice: 30000, product: { id: 2, name: "마우스" } },
    ]);
  });
```

### 작업 7. [커밋] 결제 취소 주소에 주문 번호

```ts
// order-api-nest/src/payments/stripe.gateway.ts
// Checkout 세션을 만드는 곳의 cancel_url 한 줄만 바꾼다
        success_url: `${frontend}/me/orders/${order.id}?checkout=success`,
        cancel_url: `${frontend}/shop?checkout=canceled&order=${order.id}`, // 어떤 주문이 결제 대기로 남았는지 화면이 알려 줄 수 있게
```

백엔드 테스트를 모두 돌린다.

```sh
# 저장소 루트에서. 단위 테스트(2파일, 3개) 다음에 e2e가 돈다. 아래는 e2e의 결과
npm run test:api
 Test Files  10 passed (10)
      Tests  35 passed (35)
# 기존 e2e 9파일 30개 + 업로드 권한 1파일 3개 + 프로필·주문 상세 2개
```

### 남길 것

- **찾아보면 되는 것**: `prisma migrate dev`의 옵션 이름, `@UseGuards`의 인자 순서 문법, `ForbiddenException`이 만드는 응답 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 화면에서 버튼을 숨기는 것은 권한 검사가 아니다. 막는 것은 서버의 가드이고, 화면의 역할 확인은 쓸 수 없는 버튼을 보여 주지 않으려는 것뿐이다.

  - 역할을 토큰에 담으면 바뀐 역할은 다음에 토큰을 받을 때 반영된다. 즉시 막아야 하면 refresh 사슬을 끊는다.

  - 마이그레이션을 만드는 것(`migrate dev`)은 내 DB에서만, 사람이 대답할 수 없는 곳(테스트 DB, CI, 운영)은 만든 파일을 적용만 한다(`migrate deploy`).

- **에러 신호**:

  - 일반 사용자의 업로드 요청이 201, e2e에서 `AssertionError: expected 201 to be 403` → `@UseGuards`에 `AdminGuard`가 있는지

  - 관리자도 `{"message":"관리자만 할 수 있습니다","error":"Forbidden","statusCode":403}` → 가드 순서(`AuthGuard("jwt")`가 앞인지), 역할을 바꾸기 전에 받은 토큰인지

  - `Object literal may only specify known properties, and 'role' does not exist` → `npx prisma generate`를 했는지

  - 백엔드 e2e만 `P2022`(열이 DB에 없다)로 실패 → 테스트 DB(`order_api_test`)에 `migrate deploy`를 했는지

## 5. 4단계: 토큰을 코드로

### 작업 1. [커밋] 토큰을 정하고 Tailwind 클래스로 연결하기

```css
/* order-console-next/app/globals.css */
/* 처음 만들 때 들어 있던 내용(--background, --foreground, Geist 글꼴)을 지우고 이 내용으로 시작한다. 작업 2·3의 블록을 이 아래에 이어 붙인다 */
@import "tailwindcss";

/* 디자인 토큰. 색은 여기에서만 정하고, 화면은 이름(text-muted, border-line …)으로만 쓴다
   보조 글자(--muted)는 바탕 위 명암비 4.5:1 이상(라이트 5.6, 다크 6.7). --faint는 비활성·장식에만 쓴다 */
:root {
  --bg: #fbfbfa;
  --surface: #f4f4f2;      /* 자리 표시, 불러오는 중 */
  --fg: #2f2f2b;           /* 먹색. 칠한 면은 주 동작 하나뿐 */
  --muted: #66665f;
  --faint: #9a9a92;
  --line: #e6e6e1;
  --line-strong: #cfcfc8;
  --ok: #4f6f53;           /* 결제 완료 */
  --wait: #8a6a32;         /* 결제 대기, 확인하는 중 */
  --danger: #9b3b2f;       /* 오류 */
  --notice: #f1efe8;       /* 오프라인 띠 */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1b1b19;
    --surface: #222220;
    --fg: #e4e3dd;
    --muted: #a3a29b;
    --faint: #75746e;
    --line: #2f2f2c;
    --line-strong: #44443f;
    --ok: #94b197;
    --wait: #cfae74;
    --danger: #e08c7e;
    --notice: #262521;
    color-scheme: dark;
  }
}

/* Tailwind 클래스 이름으로 연결한다(bg-bg, text-muted, border-line …). 간격은 Tailwind 기본 눈금(4px 단위)을 그대로 쓴다 */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-ok: var(--ok);
  --color-wait: var(--wait);
  --color-danger: var(--danger);
  --color-notice: var(--notice);
  --font-sans: var(--font-body), "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --font-serif: var(--font-display), "AppleMyungjo", serif;
}
```

### 용어 | CSS (사용자 정의 속성과 다크 모드)

- 사용자 정의 속성(`--bg: #fbfbfa;`): `--`로 시작하는 이름에 값을 담아 두고, `var(--bg)`로 꺼내 쓴다. 다크 모드가 이것만으로 되는 이유는 아래 "사용자 정의 속성은 쓰는 자리에서 값을 찾는다"에서 다룬다.

- `@media (prefers-color-scheme: dark)`: 운영체제가 다크 모드일 때만 안의 규칙을 적용한다.

- `color-scheme: dark`: 스크롤바·입력 칸 같은 브라우저 기본 요소도 어두운 색으로 그리게 한다.

### 개념 | 사용자 정의 속성은 쓰는 자리에서 값을 찾는다

`--muted` 같은 사용자 정의 속성은 C의 `#define`처럼 빌드할 때 값이 박히는 상수가 아니다.

브라우저가 화면을 그릴 때, `var(--muted)`를 쓴 요소에서 **지금 적용된 `--muted` 값**을 찾는다.

일반 속성(`color` 등)처럼 부모에서 자식으로 상속되므로, `:root`(문서 최상위 `<html>`)에 둔 값은 모든 요소에서 보인다.

```css
:root { --muted: #66665f; }

@media (prefers-color-scheme: dark) {
  :root { --muted: #a3a29b; } /* 같은 이름에 값만 바꾼다 */
}

.label { color: var(--muted); } /* 이 줄은 라이트·다크 어느 쪽에서도 그대로다 */
```

운영체제가 다크로 바뀌면 `@media` 안의 `:root` 규칙이 함께 적용되어 `--muted`의 값이 바뀌고, `var(--muted)`를 쓴 모든 곳이 다시 그려진다.

0장 개념 2의 "이름은 그대로 두고 값만 바꾸면 된다"가 CSS에서는 이렇게 된다.

- 같은 이름을 다시 정의하면 일반 속성과 같은 규칙(나중 것, 더 구체적인 선택자)으로 이긴 값이 쓰인다. 다크 규칙이 라이트 규칙보다 아래에 있어야 하는 이유다.

- 정의되지 않은 이름을 `var()`로 쓰면 에러 없이 그 속성이 없는 것처럼 된다. 이름을 틀리면 색이 부모에게서 물려받은 색으로 조용히 돌아간다.

> 화면 코드는 값이 아니라 이름만 알기 때문에, 다크 모드를 더할 때 컴포넌트를 하나도 고치지 않아도 된다.

### 용어 | Tailwind 문법 (`@import`와 `@theme`)

- `@import "tailwindcss"`: Tailwind의 기본 스타일과 유틸리티 클래스를 불러온다.

- `@theme inline`: 안에 적은 `--color-*`, `--font-*` 변수를 클래스 이름(`text-muted`, `font-serif`)으로 등록한다. `inline`이 무엇을 바꾸는지는 아래 "`@theme`와 `@theme inline`"에서 다룬다.

### 개념 | `@theme`와 `@theme inline`

`@theme` 안에 `--color-이름`을 적으면 Tailwind가 `text-이름`, `bg-이름`, `border-이름` 같은 클래스를 만든다.

이 앱은 실제 색을 `:root`의 `--muted`에 두고, `@theme`에서는 그 변수를 가리키기만 한다. 이때 `inline`이 있느냐에 따라 만들어지는 CSS가 다르다(Tailwind 4.3 CLI로 빌드해 확인한 결과).

```css
/* @theme { --color-muted: var(--muted); } */
.text-muted { color: var(--color-muted); } /* 클래스는 --color-muted를 거쳐 간다 */

/* @theme inline { --color-muted: var(--muted); } */
.text-muted { color: var(--muted); } /* 클래스가 --muted를 직접 쓴다 */
```

`inline`이 없으면 `--color-muted: var(--muted)`가 `:root`에서 한 번 풀린 값으로 아래 요소에 상속된다. 그래서 어떤 요소 안에서 `--muted`만 다시 정의해도 그 안의 `text-muted`는 바뀌지 않는다.

`inline`이면 클래스가 `var(--muted)`를 직접 쓰므로, 쓰는 자리의 `--muted`를 따른다(위 "사용자 정의 속성은 쓰는 자리에서 값을 찾는다").

- `@theme`에 실제 값(`--color-muted: #66665f`)을 적는 것이 기본 쓰임이다. 다른 변수를 가리킬 때 `inline`을 붙인다.

- `@theme`에 `--color-muted`가 없으면 `text-muted` 클래스가 만들어지지 않는다. 화면에 `text-muted`를 써도 아무 CSS가 생기지 않는다(11장 "진단 1").

> 이 앱은 `--muted`를 `:root`에서만 바꾸므로 지금은 어느 쪽이든 같게 보인다. 그래도 "클래스는 토큰을 직접 쓴다"는 쪽이 값의 흐름을 따라가기 쉽다.

### 개념 | 토큰을 정한 기준

#### 색은 여기에서만 정한다

화면 코드에는 `text-muted`, `border-line`, `bg-surface` 같은 이름만 나온다. 다크 모드는 같은 이름의 값만 바꾼다.

#### 간격은 Tailwind 기본 눈금(4px 단위)을 그대로 쓴다

시안의 4·8·12·16·24·32·48·64가 `1·2·3·4·6·8·12·16`에 그대로 맞는다. 눈금 밖의 값(`mt-[13px]`)을 쓰지 않는다.

#### 명암비는 도구로 확인한다

글자색과 바탕색의 명암비는 눈짐작이 잘 맞지 않는다. 같은 회색이라도 초록 성분이 많으면 밝게 보이는 식이라, 비슷해 보이는 두 회색의 명암비가 꽤 다르다.

개발자 도구에서 바로 본다.

1. Elements 탭에서 회색 글자를 고른다.
2. Styles 칸의 `color` 값 앞 작은 색 사각형을 누른다.
3. 색 선택기에 **Contrast ratio**가 나온다. 4.5 이상이면 체크 표시가 붙는다. 선택기에서 색을 끌어 진하게 하면 숫자가 따라 바뀌므로, 기준을 넘는 지점을 찾아 그 값을 토큰에 옮긴다.

시안 단계처럼 아직 화면이 없으면 WebAIM Contrast Checker 같은 웹 도구에 두 색을 넣는다. 기준(WCAG AA)은 본문 글자 4.5:1, 큰 글자 3:1이다.

보조 글자 `#66665f`는 바탕 `#fbfbfa` 위에서 5.6:1, 다크의 `#a3a29b`는 `#1b1b19` 위에서 6.7:1이다.

> `--faint`(2.7:1)는 기준에 못 미치므로 비활성 버튼과 장식(글자 대신 넣은 첫 글자)에만 쓴다.

### 작업 2. [커밋] 본문 기본값, 링크 밑줄, 키보드 포커스

`@theme` 블록 아래에 이어 붙인다.

```css
/* order-console-next/app/globals.css */
/* @theme inline 블록 다음에 이어 붙인다 */
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-weight: 300;
  font-size: 15px;
  line-height: 1.7;
  /* 한글은 기본으로 글자 단위로 줄이 바뀐다("초기화됩니|다") → 어절 단위로. 아주 긴 단어(주소 등)는 넘치지 않게 어디서든 끊는다 */
  word-break: keep-all;
  overflow-wrap: anywhere;
}

/* 본문 속 링크는 밑줄로 알아보게 한다(Tailwind 기본 스타일은 밑줄을 없앤다). 메뉴처럼 일부러 뺄 곳은 no-underline */
@layer base {
  a { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
}
```

`word-break`·`overflow-wrap` 두 줄은 10장에서 배포한 화면을 보고 더한 것이고(10장 "대조에서 하나 더: 한글 줄바꿈"), 링크 밑줄은 8장의 대조에서 더한 것이다. 최종 코드를 한 번에 만들도록 여기에 함께 싣는다.

파일 맨 끝에는 키보드 포커스와 움직임 줄이기 규칙을 둔다. 작업 3의 `@layer components` 블록보다 아래다.

```css
/* order-console-next/app/globals.css */
/* 파일 맨 끝(작업 3의 @layer components 블록 다음)에 둔다 */
/* 키보드로 옮겨 다닐 때만 보이는 먹색 테두리 */
:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

### 용어 | CSS (본문과 접근성)

- `font-weight: 300`: 본문을 가는 굵기로 그린다. 글꼴은 작업 4에서 굵기 300·400·500을 받는다.

- `@layer base`: Tailwind의 기본 스타일 층에 규칙을 넣는다. 유틸리티(`no-underline`)가 이 규칙을 덮어쓸 수 있다. 층이 왜 이기는지는 아래 "`@layer`: 순서가 아니라 층이 이긴다"에서 다룬다.

- `:focus-visible`: 키보드(Tab)로 옮겨 왔을 때처럼 브라우저가 "포커스를 보여 줘야 한다"고 판단한 때만 맞는다. 마우스로 누를 때는 테두리가 생기지 않는다.

- `@media (prefers-reduced-motion: reduce)`: 운영체제에서 "동작 줄이기"를 켠 사람에게는 회전(결제를 확인하는 중의 `animate-spin`) 같은 움직임을 끈다.

### 작업 3. [커밋] 컴포넌트 클래스

여러 화면이 같은 모양으로 쓰는 것만 이름을 붙였다. `body`·`@layer base` 블록 다음, `:focus-visible` 앞에 둔다.

```css
/* order-console-next/app/globals.css */
/* @layer base 블록 다음에 둔다 */
/* 여러 화면이 같은 모양으로 쓰는 것만 이름을 붙인다. 배치는 각 화면에서 Tailwind로 */
@layer components {
  /* 모든 화면이 쓰는 가운데 상자. 넓은 화면에서는 빈 공간이 양쪽으로 나뉘고, 머리글과 본문의 양 끝이 같은 선에 맞는다 */
  .page { width: 100%; max-width: 880px; margin-inline: auto; padding-inline: 16px; }
  @media (min-width: 640px) { .page { padding-inline: 32px; } }

  .title { font-family: var(--font-serif); font-weight: 400; font-size: 1.5rem; line-height: 1.4; }
  .subtitle { font-family: var(--font-serif); font-weight: 400; font-size: 1rem; }
  .label { font-size: 0.75rem; letter-spacing: 0.06em; color: var(--muted); }
  .num { font-variant-numeric: tabular-nums; }

  /* 버튼: 테두리만. 면을 칠하는 것은 주 동작(.btn-primary) 하나뿐. 모서리는 각지게 */
  .btn { border: 1px solid var(--line-strong); padding: 7px 16px; font-size: 0.82rem; font-weight: 400; cursor: pointer; }
  .btn:disabled { color: var(--faint); border-color: var(--line); cursor: not-allowed; }
  .btn-primary { background: var(--fg); color: var(--bg); border-color: var(--fg); padding: 12px 24px; letter-spacing: 0.06em; }
  .btn-primary:disabled { background: var(--line); border-color: var(--line); color: var(--faint); }
  /* 덜 중요한 동작(빼기, 이미지 바꾸기)은 밑줄 글자로 낮춘다 */
  .link-quiet { font-size: 0.8rem; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }

  /* 상태: 색 점 + 글자. 색을 구분하기 어려운 사람도 글자로 읽는다 */
  .status { display: inline-flex; align-items: baseline; gap: 6px; font-size: 0.8rem; color: var(--muted); }
  .status::before { content: ""; width: 6px; height: 6px; border-radius: 9999px; background: var(--faint); transform: translateY(-1px); }
  .status[data-state="paid"] { color: var(--ok); }
  .status[data-state="paid"]::before { background: var(--ok); }
  .status[data-state="pending"] { color: var(--wait); }
  .status[data-state="pending"]::before { background: var(--wait); }

  /* 오류는 빨간 세로선 하나, 안내는 회색 세로선 하나 */
  .alert { border-left: 2px solid var(--danger); padding: 8px 16px; font-size: 0.9rem; }
  .note { border-left: 2px solid var(--line-strong); padding: 8px 16px; font-size: 0.9rem; }
}
```

`.page`는 10장에서 넓은 화면을 보고 더한 것이다(10장 "넓은 화면: 오른쪽만 비어 보인다"). 6장 이후의 화면 코드는 모두 이 클래스를 쓴다.

### 용어 | CSS (컴포넌트 클래스)

- `@layer components`: Tailwind의 컴포넌트 층에 규칙을 넣는다. 같은 속성이면 유틸리티 클래스(`mt-4` 등)가 이긴다. 아래 "`@layer`: 순서가 아니라 층이 이긴다"에서 다룬다.

- `margin-inline` / `padding-inline`: 글이 흐르는 방향의 양옆(가로쓰기에서는 왼쪽·오른쪽) 여백을 한 번에 정한다.

- `font-variant-numeric: tabular-nums`: 숫자를 모두 같은 폭으로 그려, 금액이 세로로 줄을 맞춘다.

- `.status::before`: 요소 앞에 내용 없는(`content: ""`) 상자를 하나 만든다. 여기서는 색 점으로 쓴다. 아래 "`::before`로 그리는 색 점"에서 다룬다.

- 속성 선택자(`[data-state="paid"]`): `data-state` 값이 `paid`인 요소만 고른다.

### 개념 | `@layer`: 순서가 아니라 층이 이긴다

CSS에서 같은 요소에 같은 속성을 두 규칙이 정하면, 보통은 선택자가 더 구체적인 쪽이, 같으면 파일에서 나중에 나온 쪽이 이긴다.

`@layer`는 그보다 먼저 따지는 단계를 하나 더 둔다. **뒤에 선언된 층의 규칙이 앞 층의 규칙을 이긴다.**

Tailwind는 빌드 결과 맨 위에 층의 순서를 선언한다(Tailwind 4.3 CLI로 빌드한 결과에서 옮겼다).

```css
@layer theme, base, components, utilities;
```

같은 빌드 결과에서 `@layer components`의 `.btn`은 `@layer utilities`의 `.px-2`보다 파일 아래쪽에 찍혀 나왔다.

그래도 `px-2`가 이긴다. 파일 순서보다 층 순서를 먼저 보기 때문이다.

```tsx
<button className="btn px-2">담기</button> // 좌우 여백은 .btn의 16px이 아니라 px-2의 8px
```

- 그래서 컴포넌트 클래스는 기본 모양만 정하고, 화면마다 다른 부분은 유틸리티로 덮어쓰면 된다.

- 반대로 `@layer` 없이 적은 규칙은 어느 층보다도 강하다. 컴포넌트 클래스를 층 밖에 두면 유틸리티로 덮어쓰지 못한다.

- 작업 2에서 링크 밑줄을 `@layer base`에 넣은 것도 같은 이유다. 기본값으로 깔아 두고, 메뉴에서는 `no-underline`(유틸리티)으로 뺀다.

> 컴포넌트 클래스와 유틸리티가 부딪힐 때 파일 순서나 선택자 구체성을 따지지 않아도 된다. 층 순서가 먼저 정한다.

### 개념 | `::before`로 그리는 색 점

`::before`는 HTML에 없는 상자를 CSS가 요소의 첫 자식 자리에 하나 만들어 넣는 것이다(가상 요소).

상태 표시는 `<span class="status" data-state="paid">결제 완료</span>` 하나뿐인데, 점은 `::before`가 그린다.

```css
.status { display: inline-flex; align-items: baseline; gap: 6px; }
.status::before { content: ""; width: 6px; height: 6px; border-radius: 9999px; background: var(--faint); }
.status[data-state="paid"]::before { background: var(--ok); }
```

- `content`가 없으면 가상 요소 자체가 생기지 않는다. 글자를 넣지 않을 때도 `content: ""`는 꼭 적는다.

- 가상 요소는 기본으로 글자처럼 흐르는(inline) 상자라 `width`·`height`가 먹지 않는다. 부모를 `inline-flex`로 두면 `::before`가 flex 항목이 되어 크기가 적용되고, `gap`으로 글자와 띄울 수 있다.

- 점은 장식일 뿐이고 상태는 글자로 읽힌다. 색을 구분하기 어려운 사람과 화면 낭독기 모두 "결제 완료"를 읽는다.

> 마크업은 그대로 두고 속성(`data-state`) 하나로 점과 글자의 색이 함께 바뀐다. 화면 코드는 6장 작업 6의 `OrderStatus`처럼 `data-state`만 붙인다.

### 작업 4. [커밋] 글꼴

글꼴은 `next/font`로 받는다. 처음 만들 때 들어 있던 Geist 글꼴을 Noto 두 벌로 바꾼다.

```tsx
// order-console-next/app/layout.tsx
// Geist 두 개를 쓰던 import와 상수를 바꾸고, <html>의 className에 새 변수 두 개를 넣는다
import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";

// 본문은 가는 고딕, 제목만 명조. next/font는 빌드할 때 글꼴을 받아 우리 서버에서 내준다 → CSP의 font-src 'self'를 그대로 둔다
// 한글 글꼴은 글자 수가 많아 수십 조각으로 나뉜다. 미리 받기(preload)를 끄고, 화면에 쓰인 조각만 브라우저가 받게 한다
const body = Noto_Sans_KR({ variable: "--font-body", weight: ["300", "400", "500"], preload: false, display: "swap" });
const display = Noto_Serif_KR({ variable: "--font-display", weight: ["400"], preload: false, display: "swap" });

// ... metadata, RootLayout 위쪽 그대로 ...
    <html lang="ko" className={`${body.variable} ${display.variable} h-full antialiased`}>
```

`next/font`는 빌드할 때 글꼴을 받아 우리 서버에서 내준다. 브라우저가 Google에 요청하지 않으므로 `08`의 CSP(`font-src 'self'`)를 바꾸지 않아도 된다.

한글 글꼴은 글자 수가 많아 여러 조각으로 나뉜다. 이 앱의 빌드 결과(`.next/static/media`)에는 굵기 네 개(고딕 300·400·500, 명조 400)의 조각 249개, 7.0MB가 들어간다.

그래서 미리 받기(`preload`)를 끄고, 화면에 쓰인 글자의 조각만 브라우저가 받게 한다.

> 굵기 하나를 더할 때마다 조각이 60개쯤 늘어나므로 꼭 쓰는 굵기만 고른다.

### 용어 | next/font API

- `Noto_Sans_KR({ ... })`: Google 글꼴을 빌드할 때 받아 오는 함수다. 글꼴마다 같은 이름의 함수가 있다.

- `variable`: 이 글꼴을 가리킬 CSS 변수 이름이다. `@theme`의 `--font-sans`가 `var(--font-body)`로 이 변수를 쓴다. `<html>`에 `body.variable` 클래스를 붙여야 그 변수가 정의된다.

- `display: "swap"`: 글꼴이 오기 전에는 대체 글꼴로 먼저 보여 주고, 오면 바꿔 그린다.

### 남길 것

- **찾아보면 되는 것**: `@theme inline`의 이름 규칙(`--color-*`, `--font-*`), Tailwind 층 이름, WCAG 명암비 기준(4.5:1), 색 선택기의 Contrast ratio 위치, `next/font`의 옵션. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 화면은 값이 아니라 이름만 안다. 다크 모드는 같은 이름의 값만 바꾸고, 컴포넌트는 손대지 않는다.

  - 컴포넌트 클래스는 `@layer components`에 둔다. 그래야 화면에서 유틸리티로 덮어쓸 수 있다.

- **에러 신호**:

  - `text-muted`를 썼는데 색이 안 바뀐다 → `@theme inline`에 `--color-muted`가 있는지

  - 다크 모드에서 일부만 밝게 남는다 → 그 자리에 토큰이 아닌 색(`bg-white`, `#fff`)을 직접 썼는지

  - 유틸리티(`px-2`)로 컴포넌트 클래스의 값이 덮어써지지 않는다 → 그 규칙이 `@layer components` 밖에 있는지

  - 색이 부모 색으로 조용히 돌아간다 → `var(--이름)`의 이름이 틀렸는지

## 6. 5단계: 화면

> 이 장의 상점 화면(`app/shop/page.tsx`)·머리글(`app/nav.tsx`)·로그인 화면(`app/login/page.tsx`)은 그때 바꾼 부분만 싣는다. 파일 전체의 최종 모양은 10장에 있다. 그래서 7장의 e2e 가운데 일부는 10장까지 마쳐야 완성본과 같은 결과가 난다.

### 작업 1. [커밋] 머리글: 지금 있는 화면 표시

| 파일 | 지금 | 바꾼 뒤 |
|---|---|---|
| `app/nav.tsx` | 상품·내 주문이 모양 없는 `Link`라, 어느 화면에 있는지 표시가 없다 | 지금 있는 화면의 링크에 밑줄이 그어지고, 화면 낭독기가 "현재 페이지"라고 읽는다 |
| `app/online-banner.tsx` | 글자 한 줄이 그대로 나온다 | 화면 끝까지 닿는 띠 안에, 무엇을 할 수 없는지까지 말하는 문구가 나온다 |

#### `app/nav.tsx`: 지금 있는 화면을 아는 링크 `NavLink`

```diff
 // order-console-next/app/nav.tsx
 import Link from "next/link";
-import { useRouter } from "next/navigation";
+import { useRouter, usePathname } from "next/navigation";
 import { logout } from "@/lib/api-client";
 import { useAuthStore } from "@/lib/auth-store";
 import { useCartStore } from "@/lib/cart-store";
 
+// 지금 있는 화면의 링크에 aria-current="page" — 화면 낭독기는 "현재 페이지"라고 읽고, 눈으로는 밑줄로 보인다
+function NavLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
+  const current = usePathname().startsWith(href);
+  return (
+    <Link
+      href={href}
+      data-testid={testId}
+      aria-current={current ? "page" : undefined}
+      className="text-sm text-muted no-underline aria-[current=page]:text-fg aria-[current=page]:underline aria-[current=page]:underline-offset-[6px]"
+    >
+      {children}
+    </Link>
+  );
+}
+
 export function Nav() {
   // ...
   return (
     <nav className="flex gap-3">
-      <Link href="/shop">상품</Link>
-      <Link href="/me/orders">내 주문</Link>
+      <NavLink href="/shop">상품</NavLink>
+      <NavLink href="/me/orders">내 주문</NavLink>
       <span data-testid="cart-count">장바구니 {cartCount}</span>
```

- `usePathname()`: 지금 주소의 경로(`/shop`, `/me/orders/12` …)를 돌려주는 훅이다. `startsWith`라서 주문 상세(`/me/orders/12`)에 있어도 "내 주문"이 표시된다.
- `aria-current="page"`는 화면 낭독기에 "현재 페이지"라고 알린다. 같은 속성에 밑줄 스타일을 걸어(`aria-[current=page]:underline`) 눈으로 보이는 표시와 낭독기가 읽는 정보가 한곳에서 나온다.
- 장바구니 개수와 로그인·로그아웃은 손대지 않는다. `testId`는 10장 작업 5에서 장바구니 링크에 쓴다. 머리글 전체의 최종 모양도 그때 싣는다.

#### `app/online-banner.tsx`: 오프라인 띠를 토큰으로

`OnlineBanner`의 마지막 `return`만 바꾼다.

```diff
 // order-console-next/app/online-banner.tsx
 export function OnlineBanner() {
   const online = useOnline();
   if (online) return null;
-  return <p role="status" data-testid="offline-banner">오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다</p>;
+  return (
+    // 띠의 배경은 화면 끝까지, 글자는 가운데 상자 안에
+    <p role="status" data-testid="offline-banner" className="border-y border-line bg-notice py-3 text-sm">
+      <span className="page block">연결이 끊겼습니다. 마지막으로 받은 내용을 보여 주며, 다시 연결될 때까지 결제할 수 없습니다.</span>
+    </p>
+  );
 }
```

- 바깥 `<p>`는 폭 제한이 없어 배경(`bg-notice`)과 위아래 선이 화면 끝까지 닿는다. 안쪽 `<span>`에 `.page`(4단계)를 걸어 글자만 본문과 같은 폭에 맞춘다.
- 띠의 문구는 "무엇을 할 수 없는지(결제)"까지 말한다. "오프라인이다"만으로는 사용자가 무엇을 기다려야 하는지 모른다.

#### 확인

API(`npm run dev:api`)와 화면(`npm run dev:web`)을 띄운다(1장).

- `/shop`에서는 "상품"에, `/me/orders`에서는 "내 주문"에 밑줄이 있다.
- 개발자 도구 Elements에서 밑줄 친 링크에 `aria-current="page"`가 붙어 있다.
- 개발자 도구 Network를 Offline으로 바꾸면 띠가 나온다.

### 개념 | `<nav>`, `Nav`, `Link`, `NavLink`

다른 프로젝트에서도 자주 보는 넷이지만, 정해진 정도가 다르다. `<nav>`와 `Link`는 브라우저와 프레임워크가 정한 이름이다. `Nav`와 `NavLink`는 많은 프로젝트가 같은 역할에 붙이는 **관례적인 이름**일 뿐이다.

| 이름 | 정한 곳 | 하는 일 |
|---|---|---|
| `<nav>` | HTML 표준 | "이 안은 사이트 이동 메뉴다"라는 표시. 화면 낭독기가 랜드마크로 잡아 바로 건너갈 수 있다. 모양은 없다 |
| `Link` | 프레임워크(Next.js는 `next/link`, React Router는 `react-router`) | `<a href>`를 그리되, 누르면 페이지를 새로 받지 않고 화면만 바꾼다(클라이언트 이동). Next.js의 `Link`는 화면에 보이는 링크의 페이지를 미리 받아 두기도 한다(prefetch) |
| `Nav` (`Navbar`, `Header`, `SiteNav` …) | 관례 | 머리글의 이동 메뉴 전체를 묶은 컴포넌트. 대개 `<nav>` 하나를 그리고 그 안에 링크와 로그인 버튼 같은 것을 늘어놓는다 |
| `NavLink` (`ActiveLink` …) | 관례. React Router·Remix는 같은 이름을 라이브러리로 준다 | `Link`를 감싸, 지금 경로와 `href`를 비교해 "지금 있는 화면" 표시(`aria-current`, 스타일)를 붙인다 |

그려진 HTML로 보면 겹쳐 있는 모양이다. 브라우저에 남는 것은 `<nav>`와 `<a>`뿐이고, 컴포넌트 이름은 사라진다.

```html
<nav class="...">                                            <!-- Nav가 그린 것 -->
  <a href="/shop" aria-current="page" class="...">상품</a>   <!-- NavLink → Link가 그린 <a> -->
  <a href="/me/orders" class="...">내 주문</a>
  ...
</nav>
```

`NavLink`를 직접 만들지 여부는 프레임워크가 정한다. React Router는 `NavLink`가 지금 경로를 비교해 `aria-current="page"`까지 붙여 준다. Next.js의 `Link`에는 그 기능이 없어서, 이 저장소처럼 `usePathname`으로 감싼 컴포넌트를 각 프로젝트가 만든다. 그래서 Next.js 프로젝트마다 `NavLink`·`ActiveLink`의 속은 조금씩 다르다(`startsWith`로 비교하는지, 정확히 같은 경로만 보는지 등).

`Link` 대신 `<a href>`를 바로 쓰면 누를 때마다 페이지 전체를 새로 받는다. 그러면 메모리에만 있는 상태(이 저장소의 액세스 토큰 등)가 사라진다.

### 용어 | Tailwind 문법 (변형과 임의 값)

- 변형(`aria-[current=page]:underline`): 앞의 조건을 만족할 때만 뒤의 클래스를 건다. 여기서는 `aria-current="page"`가 붙은 링크에만 밑줄을 긋는다. 아래 "변형은 선택자를 덧붙인 클래스다"에서 다룬다.

- 임의 값(`underline-offset-[6px]`): 대괄호 안에 눈금에 없는 값을 직접 적는다.

### 개념 | 변형은 선택자를 덧붙인 클래스다

`조건:클래스` 꼴의 변형은 실행 중에 조건을 검사하는 코드가 아니다.

Tailwind가 빌드할 때 **조건을 CSS 선택자로 바꾼 규칙**을 하나 더 만들 뿐이다. Tailwind 4.3 CLI로 빌드하면 이렇게 나온다.

```css
.aria-\[current\=page\]\:underline[aria-current="page"] {
  text-decoration-line: underline;
}
.disabled\:text-faint:disabled {
  color: var(--faint);
}
```

클래스 이름의 `[`, `=`, `:`는 CSS에서 특수 문자라 `\`로 이스케이프되어 있다. 뒤에 붙은 `[aria-current="page"]`, `:disabled`가 조건이다.

요소에 클래스가 붙어 있어도 이 선택자에 맞지 않으면 규칙이 적용되지 않는다.

| 변형 | 덧붙는 조건 | 이 문서에서 |
|---|---|---|
| `aria-[current=page]:` | `[aria-current="page"]` | 지금 있는 메뉴(작업 1) |
| `disabled:` | `:disabled` | 재고 상한의 `+` 버튼(작업 3) |
| `sm:` | `@media (width >= 40rem)`로 감싼다 | 넓은 화면의 열 배치(작업 5) |

- 조건은 클래스마다 따로 붙인다. `aria-[current=page]:text-fg aria-[current=page]:underline`처럼 같은 조건을 여러 번 적는 이유다.

- 빌드할 때 소스에 그 클래스 이름이 문자 그대로 있어야 규칙이 만들어진다. `` `aria-[current=${x}]:underline` ``처럼 문자열을 이어 붙여 만들면 Tailwind가 찾지 못한다.

> 상태(현재 페이지, 비활성)를 속성으로 표시하고 스타일은 그 속성에 거는 방식이라, 화면 낭독기가 읽는 정보와 눈에 보이는 표시가 어긋나지 않는다.

### 작업 2. [커밋] 장바구니 store에 수량 정하기

다음 작업의 수량 조절기(`−` `+`)가 부를 함수 `setQuantity`를 장바구니 store에 더한다. 지금 store에는 하나 더하기(`add`)와 통째로 빼기(`remove`)만 있어서, "3개로 정한다"나 "하나 줄인다"를 할 수 없다.

| | 지금 있는 것 | 더할 것 |
|---|---|---|
| 함수 | `add`(1 늘리기), `remove`(빼기) | `setQuantity(productId, quantity)`: 수량을 그 값으로 정한다. 0 이하면 `remove`와 같다 |
| 결제 키 | `add`·`remove`는 `checkoutKey`를 `null`로 버린다 | `setQuantity`도 똑같이 버린다 |

타입에 한 줄, 구현에 한 덩어리를 더한다. 둘 다 `remove` 바로 아래다.

```diff
 // order-console-next/lib/cart-store.ts
 type CartState = {
   items: CartItem[];
   checkoutKey: string | null;
   add: (item: Omit<CartItem, "quantity">) => void;
   remove: (productId: number) => void;
+  // 수량을 정한다. 0 이하면 빼기와 같다. 재고 상한은 화면이 안다(상품 목록) → 화면이 넘기지 않게 막고, 서버가 다시 확인한다
+  setQuantity: (productId: number, quantity: number) => void;
   beginCheckout: () => string;
   finishCheckout: () => void;
 };

 // ...

       remove: (productId) =>
         set((state) => ({ checkoutKey: null, items: state.items.filter((i) => i.productId !== productId) })),
+      setQuantity: (productId, quantity) =>
+        set((state) => {
+          const q = Math.floor(quantity);
+          // 수량이 바뀌어도 "다른 결제"다 → add·remove와 같이 키를 버린다
+          if (q <= 0) return { checkoutKey: null, items: state.items.filter((i) => i.productId !== productId) };
+          return { checkoutKey: null, items: state.items.map((i) => (i.productId === productId ? { ...i, quantity: q } : i)) };
+        }),
       beginCheckout: () => {
```

`remove: (productId) =>`와 다음 줄의 `set(...)),`이 한 덩어리다. 그 `set(...)` 줄을 지우거나 덮어쓰지 말고, 그 아래에 새 줄로 넣는다. 객체 안의 순서는 동작에 상관없고, 비슷한 함수끼리 모으려고 여기에 둔다.

한 줄씩 보면 이렇다.

- `Math.floor(quantity)`: 2.5 같은 값이 들어와도 정수로 자른다.
- `q <= 0`이면: `remove`와 같은 줄이다. 그 상품만 빼고 새 배열을 만든다.
- 아니면: 그 상품만 `{ ...i, quantity: q }`로 수량을 바꾼 새 객체로 갈아 끼우고, 나머지는 그대로 둔 새 배열을 만든다.
- 두 경우 모두 `checkoutKey: null`: 장바구니가 바뀌면 다른 결제라서 `05`의 결제 멱등 키를 버린다.
- 파라미터에 타입을 적지 않아도 된다. 위 타입 줄에서 `productId: number`, `quantity: number`를 가져온다.

타입 줄만 넣고 저장하면 편집기가 `create<CartState>()(...)` 쪽에 "`setQuantity` 속성이 없다"는 빨간 줄을 긋는다. 타입은 약속했는데 실제 객체에 구현이 없어서 나는 것이고, 구현을 넣으면 사라진다.

Zustand의 `set`은 돌려준 객체를 지금 상태에 얕게 합친다. 그래서 `add`·`remove` 같은 함수는 그대로 남고, `items`와 `checkoutKey`만 바뀐다.

`items`는 `map`·`filter`로 새 배열을 만든다. 같은 배열을 고치면(`found.quantity = q`) Zustand가 바뀌었다고 알아채지 못해 화면이 다시 그려지지 않는다.

#### 확인

이 함수를 부르는 화면은 작업 3에서 만든다. 지금은 타입 검사만 통과하면 된다.

```sh
# 저장소 루트에서
npm run typecheck
```

에러 없이 끝나면 된다. `Property 'setQuantity' is missing`이 나오면 구현을 빠뜨렸거나 두 곳의 이름 철자가 다른 것이다.

### 작업 3. [커밋] 수량 조절기

```tsx
// order-console-next/app/shop/stepper.tsx
"use client";

import { useCartStore } from "@/lib/cart-store";

// 수량 조절. 1에서 줄이면 장바구니에서 빠지고, 재고보다 많이 올리지 못한다(서버도 결제할 때 다시 확인한다)
// 상품 목록과 장바구니 페이지가 함께 쓴다
export function Stepper({ productId, name, quantity, max }: { productId: number; name: string; quantity: number; max: number }) {
  const setQuantity = useCartStore((s) => s.setQuantity);
  return (
    <span className="inline-flex items-center border border-line-strong">
      <button type="button" className="size-[30px] cursor-pointer" aria-label={`${name} 수량 줄이기`} onClick={() => setQuantity(productId, quantity - 1)}>-</button>
      <span className="num min-w-8 text-center text-sm">{quantity}</span>
      <button type="button" className="size-[30px] cursor-pointer disabled:cursor-not-allowed disabled:text-faint" aria-label={`${name} 수량 늘리기`}
        disabled={quantity >= max} onClick={() => setQuantity(productId, quantity + 1)}>+</button>
    </span>
  );
}
```

### 용어 | Tailwind 문법 (`disabled:`와 `size-*`)

- `disabled:text-faint`: 버튼이 `disabled`일 때만 적용한다. `aria-[...]:`와 같은 변형이다(위 "변형은 선택자를 덧붙인 클래스다").

- `size-[30px]`: 너비와 높이를 함께 30px로 정한다.

### 개념 | 수량 조절에서 정한 것들

- 0이 되면 빠진다: "빼기"와 같은 결과다. 수량이 바뀌면 `05`의 결제 멱등 키를 버린다. 같은 장바구니로 다시 누른 결제만 같은 키를 쓴다.

- 재고 상한은 화면이 막고, 서버가 다시 확인한다: 화면은 상품 목록의 재고를 보고 `+`와 "담기"를 잠근다. 그 사이 다른 사람이 사 갈 수 있으므로 최종 판단은 `02`의 재고 잠금이 한다.

- 버튼 이름: `-`, `+` 기호만으로는 무엇을 하는 버튼인지 알 수 없다. "마우스 수량 늘리기"처럼 무엇의 무엇인지 붙인다(`aria-label`). e2e도 이 이름으로 찾는다.

### 작업 4. [커밋] 상품 화면의 상태들

| 상태 | 지금 | 바꾼 뒤 |
|---|---|---|
| 불러오는 중 | "상품을 불러오는 중..." 글자 한 줄 | 상품 줄 세 개 자리를 회색 면으로 먼저 그린다(`ProductSkeleton`) |
| Stripe에서 결제를 취소하고 돌아옴(`/shop?checkout=canceled&order=8`) | 쿼리를 읽지 않아 아무 안내가 없다 | 맨 위에 "주문 #8은 결제 대기로 남았다가 24시간 뒤 취소된다"는 안내(`CheckoutNotice`) |

고칠 파일은 `order-console-next/app/shop/page.tsx` 하나다. `ProductList`의 상품 줄 모양과 `CartPanel`은 이 작업에서 건드리지 않는다. 둘은 10장에서 바뀐다.

#### 불러오는 중: `ProductSkeleton`

`ProductList` 위에 새 컴포넌트를 두고, `isPending` 줄이 그것을 돌려주게 한다.

```diff
 // order-console-next/app/shop/page.tsx
 type CheckoutResult = { id: number; price: number; checkoutUrl: string };
 
+// 불러오는 동안에는 자리만 회색 면으로 보여 준다 - 다 불러왔을 때 화면이 덜컥 밀리지 않게
+function ProductSkeleton() {
+  return (
+    <div aria-busy="true">
+      {[0, 1, 2].map((i) => (
+        <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-line py-4">
+          <span className="size-16 bg-surface" />
+          <span className="grid gap-2"><span className="h-3 w-2/5 bg-surface" /><span className="h-3 w-1/4 bg-surface" /></span>
+        </div>
+      ))}
+      <p role="status" className="mt-4 text-sm text-muted">상품을 불러오는 중입니다.</p>
+    </div>
+  );
+}
+
 function ProductList() {
   // ...
-  if (isPending) return <p>상품을 불러오는 중...</p>;
+  if (isPending) return <ProductSkeleton />;
   if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
```

가짜 줄 하나는 왼쪽 64px 사각형(이미지 자리)과 오른쪽 짧은 막대 두 개(이름·가격 자리)다. `[0, 1, 2].map`으로 세 줄을 그린다.

#### 결제 취소 안내: `CheckoutNotice`와 `ShopPage`

import 두 줄을 더하고, `CartPanel`과 `ShopPage` 사이에 `CheckoutNotice`를 새로 두고, `ShopPage`가 그것을 맨 위에 그리게 한다.

```diff
 // order-console-next/app/shop/page.tsx
 import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
 import Link from "next/link";
+import { Suspense } from "react";
+import { useSearchParams } from "next/navigation";
 import { ApiError, authFetch } from "@/lib/api-client";

 // ... ProductList, CartPanel 그대로 ...

+// Stripe 화면에서 취소하고 돌아왔다(/shop?checkout=canceled&order=8). 주문이 어떻게 되는지 알려 준다
+function CheckoutNotice() {
+  const params = useSearchParams();
+  if (params.get("checkout") !== "canceled") return null;
+  const order = params.get("order");
+  return (
+    <p role="status" className="note mb-8">
+      결제를 취소했습니다. {order ? <>주문 <Link href={`/me/orders/${order}`}>#{order}</Link>은</> : "방금 만든 주문은"} 결제 대기로 남아 있다가 24시간이 지나면
+      자동으로 취소되고, 담았던 수량은 재고로 돌아갑니다.
+    </p>
+  );
+}
+
 export default function ShopPage() {
   return (
-    <main>
-      <h1>상품</h1>
-      <ProductList />
+    <main className="page flex-1 pb-12 pt-2">
+      {/* useSearchParams를 쓰는 부분은 Suspense로 감싼다(아래 "상태별로 정한 것") */}
+      <Suspense><CheckoutNotice /></Suspense>
+      <h1 className="title mb-8">상품</h1>
+      <section aria-label="상품 목록"><ProductList /></section>
       <CartPanel />
     </main>
   );
 }
```

- `useSearchParams`: 주소의 쿼리(`?checkout=canceled&order=8`)를 읽는 훅이다. `checkout=canceled`가 아니면 아무것도 그리지 않으므로, 보통 `/shop`으로 들어오면 안내가 없다.
- `order`(3단계에서 `cancel_url`에 붙인 주문 번호)가 있으면 그 주문의 상세로 가는 링크를 건다. 없으면 "방금 만든 주문은"으로 쓴다.
- `24시간`은 Checkout 세션 기한을 따로 주지 않아 Stripe 기본값이 적용되기 때문이다(2단계 "결제 기한을 잘못 알고 있었다").
- `note`: 왼쪽 선이 있는 안내 상자. `page`: 본문 폭과 좌우 여백. `title`: 제목 글꼴. 모두 4단계에서 만들었다.
- `<section aria-label="상품 목록">`: 화면 낭독기가 이 영역을 "상품 목록"으로 건너뛸 수 있게 이름을 붙인다.

> 10장에서 장바구니를 별도 페이지(`/cart`)로 옮기면, `CartPanel` 자리에는 휴대폰용 합계 줄 `CartDock`이 `<main>` 밖에 들어온다. 파일 전체의 최종 모양은 10장 작업 4에 있다.

#### 확인

API(`npm run dev:api`)와 화면(`npm run dev:web`)을 띄운다.

- `/shop?checkout=canceled&order=8`로 들어가면 맨 위에 안내가 나오고, `#8`을 누르면 `/me/orders/8`로 간다. 그냥 `/shop`에는 안내가 없다.
- 개발자 도구 Network의 속도를 Slow 4G로 낮추고 새로 고치면, 상품이 오기 전에 회색 줄 세 개가 잠깐 보인다.

### 용어 | Tailwind 문법 (격자 열)

- `grid-cols-[64px_minmax(0,1fr)]`: 격자의 열을 직접 정한다. 대괄호 안의 `_`는 공백이다. 64px짜리 열과 남은 폭을 다 쓰는 열, 두 개다. 그냥 `1fr`이 아니라 `minmax(0,1fr)`인 이유는 아래 "`1fr`과 `minmax(0,1fr)`"에서 다룬다.

### 개념 | `1fr`과 `minmax(0,1fr)`

`fr`은 격자에서 고정 폭 열을 빼고 남은 폭을 나눠 갖는 단위다.

위의 `64px minmax(0,1fr)`은 64px 열을 먼저 떼고, 남은 폭을 전부 둘째 열에 준다(Tailwind는 대괄호 안을 `grid-template-columns: 64px minmax(0,1fr)`로 그대로 옮긴다).

함정은 `1fr`만 쓸 때다. `1fr`은 사실 `minmax(auto, 1fr)`이라서, 열이 **안에 든 내용의 최소 폭보다 좁아지지 않는다.**

줄바꿈할 곳이 없는 긴 글자(띄어쓰기 없는 상품 이름, 긴 주소)가 들어오면 열이 그만큼 버티고, 격자 전체가 화면 밖으로 넘친다.

```css
grid-template-columns: 64px 1fr;          /* 긴 단어가 있으면 둘째 열이 줄어들지 않아 격자가 넘친다 */
grid-template-columns: 64px minmax(0,1fr); /* 둘째 열이 0까지 줄어들 수 있다. 넘치는 글자는 열 안에서 처리된다 */
```

| 적은 값 | 최소 폭 | 긴 내용이 들어오면 |
|---|---|---|
| `1fr` | 내용의 최소 폭 | 열이 버텨 다른 열과 화면을 밀어낸다 |
| `minmax(0,1fr)` | 0 | 열은 정한 폭을 지키고, 글자는 그 폭 안에서 끊긴다(끊는 방법은 아래) |

- 휴대폰 폭(390)처럼 남는 폭이 적을 때 이 차이가 드러난다. 데스크톱에서만 확인하면 놓치기 쉽다.

- 열 안에서 글자를 어떻게 끊을지는 따로 정한다. 이 앱은 본문에 `overflow-wrap: anywhere`를 걸어 둔다(5장 작업 2, 10장 "대조에서 하나 더: 한글 줄바꿈").

> 남은 폭을 나눠 갖는 열에 글자가 들어간다면 `1fr` 대신 `minmax(0,1fr)`을 습관으로 쓴다.

### 용어 | 접근성 속성

- `aria-busy="true"`: 아직 불러오는 중인 영역이라고 화면 낭독기에 알린다.

- `role="status"`: 내용이 바뀌면 낭독기가 하던 말을 끊지 않고 이어서 읽어 준다.

### 개념 | 상태별로 정한 것

- 불러오는 중: 글자 대신 자리만 회색 면으로 보여 준다. 다 불러왔을 때 화면이 덜컥 밀리지 않는다.

- 결제 취소 안내: `useSearchParams`를 쓰는 부분은 `Suspense`로 감싼다(`ShopPage`). 주소의 쿼리는 요청이 와야 알 수 있다.

  그래서 페이지를 빌드 때 미리 그린다면(정적 렌더링) 이 경계가 없을 때 `useSearchParams() should be wrapped in a suspense boundary at page "/shop"` 에러로 빌드가 실패한다.

  이 앱은 루트 layout의 `connection()` 때문에 모든 페이지를 요청마다 그리므로, 지금은 감싸지 않아도 빌드가 실패하지 않는다. 그래도 경계를 두는 것은 "요청마다 그린다"는 전제가 바뀌어도 깨지지 않게 하려는 것이다.

- 휴대폰 폭: 화면 아래에 합계 줄(`CartDock`)을 붙이고, 누르면 장바구니로 간다. 합계 줄에 결제 버튼을 하나 더 두지 않는다. 같은 일을 하는 버튼이 두 개면 낭독기 사용자와 테스트 모두 헷갈린다.

> 처음에는 장바구니를 상품 화면 오른쪽 칸에 두었다. 10장에서 장바구니 페이지로 옮겼다.

### 작업 5. [커밋] 내 주문 목록

```tsx
// order-console-next/app/me/orders/my-order-list.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc";
import { OrderStatus, orderDate } from "./order-status";

export function MyOrderList() {
  const trpc = useTRPC();
  // queryOptions()가 queryKey와 queryFn을 만들어 준다. data의 타입은 백엔드 프로시저의 반환 타입에서 온다
  const { data, isPending, error } = useQuery(trpc.me.orders.queryOptions());

  if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
  if (error?.data?.code === "UNAUTHORIZED")
    return <p role="alert" className="note">주문을 보려면 <Link href="/login">로그인</Link>해 주세요.</p>;
  if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
  if (data.length === 0)
    return (
      <p className="border-y border-line py-8 text-sm text-muted" data-testid="my-orders">
        <span className="mb-1 block font-serif font-normal text-fg">아직 주문이 없습니다</span>
        <Link href="/shop">상품</Link>에서 담고 결제하면 여기에 쌓입니다.
      </p>
    );
  // 번호·날짜·금액·상태를 같은 열에 맞춘다. 휴대폰 폭에서는 두 줄(번호·금액 / 날짜·상태)로 - order로 순서만 바꾼다
  return (
    <ul data-testid="my-orders" className="border-t border-line">
      {data.map((o) => (
        <li key={o.id} className="border-b border-line">
          <Link href={`/me/orders/${o.id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 no-underline sm:grid-cols-[5rem_minmax(0,1fr)_auto_11rem]">
            <span className="num order-1 text-sm text-muted sm:order-none">#{o.id}</span>
            <span className="num order-3 text-sm text-muted sm:order-none">{orderDate(o.createdAt)}</span>
            <span className="num order-2 text-right sm:order-none">{o.price.toLocaleString("ko-KR")}원</span>
            <span className="order-4 text-right sm:order-none sm:text-left"><OrderStatus order={o} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

데스크톱은 네 열(번호·날짜·금액·상태)이고, 휴대폰은 두 줄(번호·금액 / 날짜·상태)이다.

마크업 순서는 그대로 두고 휴대폰에서만 `order`로 보이는 순서를 바꾼다(8장에서 처음 방식이 어긋난 이야기).

목록 페이지(`app/me/orders/page.tsx`)는 이 목록을 가운데 상자에 넣기만 한다.

```tsx
// order-console-next/app/me/orders/page.tsx
import { MyOrderList } from "./my-order-list";

export default function MyOrdersPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">내 주문</h1>
      <MyOrderList />
    </main>
  );
}
```

### 작업 6. [커밋] 상태 표시와 날짜

상태 표시는 `.status`에 `data-state`만 붙인다.

```tsx
// order-console-next/app/me/orders/order-status.tsx
// 주문 상태. 결제는 Stripe 웹훅이 확인해야 "완료"가 된다
type OrderLike = { paid: boolean; canceledAt: string | null };

export function orderStatus(o: OrderLike) {
  if (o.paid) return "결제 완료";
  if (o.canceledAt) return "취소됨 · 결제 기한 지남";
  return "결제 대기";
}

// 상태를 색 점 + 글자로 그린다(globals.css의 .status). 색은 data-state로 고른다
export function orderState(o: OrderLike) {
  if (o.paid) return "paid";
  if (o.canceledAt) return "canceled";
  return "pending";
}

export function OrderStatus({ order, testId }: { order: OrderLike; testId?: string }) {
  return <span className="status" data-state={orderState(order)} data-testid={testId}>{orderStatus(order)}</span>;
}

// 날짜는 사용자의 언어 형식으로(2026. 10. 5.). 서버 시각(UTC)을 그대로 자르면 한국 시간으로 하루가 어긋날 수 있다
export const orderDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");
```

주문 상세에서 날짜를 `toISOString().slice(0, 10)`으로 자르던 것을 `toLocaleDateString("ko-KR")`로 바꿨다.

`toISOString()`은 항상 UTC로 찍는다. 한국 시간(UTC+9) 새벽 0~9시에 만든 주문은 UTC로는 아직 전날이라, 그대로 자르면 전날로 보인다.

### 작업 7. [커밋] 주문 상세에 산 상품

4장 작업 6에서 API가 보내 주는 `items`를 화면에 그린다. 상세 페이지 전체다.

```tsx
// order-console-next/app/me/orders/[id]/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTRPC } from "@/lib/trpc";
import { MyOrderList } from "../my-order-list";
import { OrderStatus, orderDate } from "../order-status";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function MyOrderDetail({ id }: { id: number }) {
  const trpc = useTRPC();
  // Stripe 결제 화면에서 돌아왔다(?checkout=success). 그래도 웹훅이 아직 안 왔을 수 있다 → 결제 대기인 동안 1초마다 다시 묻는다
  const fromCheckout = useSearchParams().get("checkout") === "success";
  // 목록과 다른 프로시저라 따로 요청된다. 같은 순간에 나가므로 httpBatchLink가 HTTP 요청 하나로 묶는다
  const { data, isPending, error } = useQuery({
    ...trpc.me.order.queryOptions({ id }),
    refetchInterval: (query) => (fromCheckout && query.state.data && !query.state.data.paid && !query.state.data.canceledAt ? 1000 : false),
  });
  if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
  if (error?.data?.code === "NOT_FOUND") return <p className="note">주문 #{id}을 찾을 수 없습니다.</p>;
  if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
  // 결제하고 막 돌아왔는데 아직 결제 대기다 → 웹훅을 기다리는 중이라고 알린다
  const waiting = fromCheckout && !data.paid && !data.canceledAt;
  return (
    <section data-testid="order-detail" className="mb-12">
      <p className="label mb-1"><Link href="/me/orders">내 주문</Link> / #{data.id}</p>
      <h1 className="title mb-8">주문 #{data.id}</h1>
      <dl className="grid items-baseline gap-x-8 gap-y-1 border-y border-line py-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-3">
        <dt className="text-sm text-muted">상태</dt>
        <dd className="mb-3 sm:mb-0">
          {waiting ? (
            <span role="status" className="inline-flex items-center gap-2 text-sm text-wait" data-testid="order-status">
              <span aria-hidden="true" className="size-2.5 animate-spin rounded-full border border-wait border-t-transparent" />
              결제를 확인하는 중입니다
            </span>
          ) : (
            <OrderStatus order={data} testId="order-status" />
          )}
        </dd>
        <dt className="text-sm text-muted">금액</dt>
        <dd className="num mb-3 sm:mb-0">{won(data.price)}</dd>
        <dt className="text-sm text-muted">주문일</dt>
        <dd className="num mb-3 sm:mb-0">{orderDate(data.createdAt)}</dd>
        {/* 산 상품. 가격은 주문할 때의 가격(unitPrice)이다 */}
        <dt className="text-sm text-muted">상품</dt>
        <dd>
          <ul className="grid max-w-md gap-y-1">
            {data.items.map((it) => (
              <li key={it.product.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6">
                <span>{it.product.name}</span>
                <span className="num text-right text-muted">{won(it.unitPrice)} × {it.quantity}</span>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      {waiting && <p className="mt-3 text-[0.78rem] text-muted">Stripe가 결제 결과를 알려 주면 자동으로 바뀝니다. 보통 몇 초 걸립니다.</p>}
    </section>
  );
}

export default function MyOrderPage() {
  // 클라이언트 컴포넌트에서는 useParams로 URL의 [id]를 읽는다
  const { id } = useParams<{ id: string }>();
  return (
    <main className="page flex-1 pb-12 pt-2">
      <MyOrderDetail id={Number(id)} />
      <h2 className="subtitle mb-4">전체 주문</h2>
      <MyOrderList />
    </main>
  );
}
```

`items`에는 `unitPrice`(주문할 때의 가격)를 쓴다. 상품의 지금 가격(`product.price`)은 API가 보내지도 않는다.

`dl` 격자의 `items-baseline`, 상품 목록의 `max-w-md`는 8장의 대조에서 고친 결과다.

### 용어 | Tailwind 문법 (반응형과 순서)

- `sm:grid-cols-[...]`: 화면 폭 640px 이상에서만 적용한다. 앞에 아무것도 붙지 않은 클래스가 휴대폰 값이고, `sm:`가 넓은 화면 값이다. 아래 "`sm:`은 '작은 화면'이 아니라 '640px 이상'이다"에서 다룬다.

- `order-1` ~ `order-4`, `sm:order-none`: 마크업 순서는 그대로 두고 보이는 순서만 바꾼다.

- `items-baseline`: 한 줄의 칸들을 글자 기준선에 맞춘다.

- `minmax(0,1fr)`: 남은 폭을 차지하되, 내용이 길어도 0까지 줄어들 수 있게 한다. 긴 글자가 다른 열을 밀어내지 않는다(위 "`1fr`과 `minmax(0,1fr)`").

### 개념 | `sm:`은 '작은 화면'이 아니라 '640px 이상'이다

이름 때문에 `sm:`을 "휴대폰용"으로 읽기 쉽지만 반대다.

Tailwind는 **접두사 없는 클래스를 가장 좁은 화면의 기본값**으로 두고, `sm:`·`md:` 같은 접두사로 "이 폭 이상이면 이렇게 바꾼다"를 덧붙인다(모바일 우선). Tailwind 4.3 CLI로 빌드하면 `sm:` 클래스는 미디어 쿼리 안에 들어간다.

```css
.order-1 {
  order: 1;
}
@media (width >= 40rem) {
  .sm\:order-none {
    order: 0;
  }
}
```

`40rem`은 640px이다. 그래서 위 목록의 칸 하나에 붙은 `order-1 sm:order-none`은 이렇게 읽는다.

| 화면 폭 | 적용되는 것 | 결과 |
|---|---|---|
| 640px 미만(휴대폰 390) | `order-1` | 휴대폰 두 줄 배치의 첫째 자리 |
| 640px 이상(데스크톱 1280) | `order-1`과 `sm:order-none`, 뒤의 것이 이긴다 | 마크업 순서 그대로 |

- 넓은 화면에서는 두 규칙이 모두 맞는다. 빌드 결과에서 미디어 쿼리 쪽이 뒤에 나오므로 `sm:` 값이 이긴다.

- 휴대폰에서만 무언가를 바꾸고 싶다면 `sm:`에 넣는 것이 아니라, 접두사 없이 휴대폰 값을 쓰고 `sm:`로 데스크톱 값을 되돌린다. 이 목록의 `order-3 sm:order-none`이 그 모양이다.

> 클래스를 읽을 때는 "접두사 없는 값 = 휴대폰, `sm:` = 640px 이상에서 덮어쓰는 값"으로 읽는다. 좁은 화면을 기본으로 정하고, 넓어질 때 바뀌는 것만 덧붙인다.

### 작업 8. [커밋] 로그인 오류 문구와 입력 칸

| | 지금 | 바꾼 뒤 |
|---|---|---|
| 오류 문구 | 서버가 준 메시지(`e.message`)를 그대로 보여 준다 | 401이면 "아이디 또는 비밀번호가 맞지 않습니다.", 그 밖의 실패면 "잠시 뒤 다시 시도해 주세요." |
| 입력 칸 | `placeholder="id"`, `placeholder="password"`가 칸의 이름 역할을 한다 | 칸 위에 `<label>`로 "아이디", "비밀번호"를 붙인다. 오류가 나면 비밀번호 칸이 오류 문장을 가리킨다 |

#### 오류 문구

```diff
 // order-console-next/app/login/page.tsx
-import { login } from "@/lib/api-client";
+import { ApiError, login } from "@/lib/api-client";

 // ...

   async function onSubmit(formData: FormData) {
     try {
       await login(String(formData.get("id")), String(formData.get("password")));
       router.push("/shop");
     } catch (e) {
-      setError(e instanceof Error ? e.message : "로그인 실패");
+      // 401은 "무엇이 틀렸는지"를 말하지 않는다 - 어떤 아이디가 있는지 알려 주지 않기 위해서다. 그 밖의 실패는 다시 해 보게 한다
+      setError(e instanceof ApiError && e.status === 401 ? "아이디 또는 비밀번호가 맞지 않습니다." : "로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
     }
   }
```

- `ApiError`는 `login`·`authFetch`가 서버 오류를 던질 때 쓰는 클래스다. `status`(HTTP 상태 코드)를 들고 있어서 401인지 가릴 수 있다.
- 서버 메시지를 그대로 보여 주면 영어 문장이나 내부 사정이 사용자에게 나간다. 화면이 보여 줄 문구는 화면이 정한다.
- 401은 "아이디가 없다"와 "비밀번호가 틀렸다"를 구분하지 않는다(`03`). 화면 문구도 그 원칙을 따른다. 401이 아닌 실패(서버가 내려갔거나 네트워크가 끊김)는 사용자가 틀린 것이 아니므로 다시 해 보라고만 한다.
- `router.push("/shop")`은 그대로 둔다. 8장 작업 3에서 이전 사용자의 캐시를 버리는 `done()`으로 바뀐다.

#### 입력 칸과 오류 문장

`return` 위에 입력 칸 공통 클래스를 두고, form 안을 바꾼다. form 밖에 있던 오류 줄은 form 안, 버튼 위로 옮긴다.

```diff
 // order-console-next/app/login/page.tsx
+  // 밑줄 하나만 있는 칸. aria-invalid가 붙으면 밑줄이 빨개진다
+  const field = "border-0 border-b border-line-strong bg-transparent py-2 font-light aria-invalid:border-danger";
   return (
     <main>
       <h1>로그인</h1>
       <form action={onSubmit}>
-        <input name="id" placeholder="id" defaultValue="kim" />
-        <input name="password" type="password" placeholder="password" />
+        <label className="grid gap-1">
+          <span className="label">아이디</span>
+          <input name="id" defaultValue="kim" autoComplete="username" className={field} />
+        </label>
+        <label className="grid gap-1">
+          <span className="label">비밀번호</span>
+          <input name="password" type="password" autoComplete="current-password" className={field}
+            aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined} />
+        </label>
+        {error && <p id="login-error" role="alert" className="text-[0.82rem] text-danger">{error}</p>}
         <button type="submit">로그인</button>
       </form>
-      {error && <p role="alert">{error}</p>}
       <form action={signInWithGithub}>
```

- `<label>`이 `<span>`과 `<input>`을 함께 감싸면, 그 글자("비밀번호")가 칸의 이름이 된다. 글자를 눌러도 칸에 커서가 간다. `.label`은 4단계에서 만든 작은 회색 글자 클래스다.
- placeholder는 지운다. 글자를 치는 순간 사라지고 낭독기마다 읽는 방식이 다르다. e2e도 칸을 이름(`getByLabel("비밀번호")`)으로 찾게 바꾼다(7장 작업 1).
- `defaultValue="kim"`은 남긴다. 7장의 e2e는 비밀번호만 채우기 때문이다. 이 기본값은 10장에서 데모 버튼을 넣으면서 없앤다.
- `autoComplete`: 브라우저와 비밀번호 관리자가 "여기가 아이디 칸, 여기가 비밀번호 칸"인 것을 알고 저장한 값을 채워 준다.
- `aria-invalid`와 `aria-describedby="login-error"`: 오류가 있을 때만 붙는다. 낭독기는 비밀번호 칸으로 돌아갔을 때 "잘못됨"과 함께 `id="login-error"`인 문장을 이어서 읽는다. 그래서 오류 문장에 `id`를 주고, 칸 가까이로 옮긴다.

> 화면 배치(가운데 좁은 칸, 버튼 모양)와 데모 버튼은 10장 작업 1에서 바꾼다. 파일 전체의 최종 모양도 그때 싣는다.

#### 확인

API(`npm run dev:api`)와 화면(`npm run dev:web`)을 띄우고 `/login`에 들어간다.

- 칸 위에 "아이디", "비밀번호"가 보이고, 칸 안의 회색 안내 글자는 없다.
- 비밀번호를 틀리게 넣으면 "아이디 또는 비밀번호가 맞지 않습니다."가 버튼 위에 나오고, 칸의 밑줄이 빨개진다.
- API를 끄고(`Ctrl+C`) 로그인하면 "잠시 뒤 다시 시도해 주세요." 쪽 문구가 나온다.

### 작업 9. [커밋] GitHub 로그인 마무리 화면

GitHub 로그인 뒤 잠깐 보이는 화면도 토큰으로 맞춘다.

```tsx
// order-console-next/app/auth/github/complete/page.tsx
// <main>과 <h1>에 클래스를 붙인다
    <main className="page flex-1 pb-12">
      <h1 className="title mb-8 mt-8">GitHub 로그인</h1>
      <ExchangeCode code={session.exchangeCode} />
    </main>
```

```tsx
// order-console-next/app/auth/github/complete/exchange-code.tsx
// 마지막 두 줄(오류와 진행 중 표시)을 바꾼다
  if (error) return <p role="alert" className="alert">로그인을 마무리하지 못했습니다. 다시 시도해 주세요. ({error})</p>;
  return <p role="status" className="text-sm text-muted">로그인을 마무리하는 중입니다.</p>;
```

### 남길 것

- **찾아보면 되는 것**: Tailwind 변형 이름(`aria-[...]:`, `disabled:`, `sm:`), `grid-cols-[...]`의 `_` 규칙, `aria-*` 속성의 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 상태(현재 페이지, 비활성, 오류)는 속성으로 표시하고 스타일은 그 속성에 건다. 눈에 보이는 것과 낭독기가 읽는 것이 한곳에서 나온다.

  - 접두사 없는 클래스가 휴대폰 값이고 `sm:`은 640px 이상에서 덮어쓰는 값이다. 남은 폭을 나눠 갖는 글자 열에는 `minmax(0,1fr)`을 쓴다.

  - store의 상태는 고치지 않고 새로 만든다(`map`·`filter`). 같은 배열을 고치면 바뀐 줄 모르고 화면이 다시 그려지지 않는다.

- **에러 신호**:

  - `Property 'setQuantity' is missing` → store 타입에 약속만 하고 `create` 안에 구현을 넣지 않았는지, 두 곳의 이름 철자

  - 문자열을 이어 붙여 만든 클래스(`` `aria-[current=${x}]:underline` ``)에 스타일이 안 먹는다 → 소스에 클래스 이름이 문자 그대로 있는지

  - 긴 상품 이름이 들어오면 휴대폰에서 격자가 화면 밖으로 넘친다 → 그 열이 `1fr`인지(`minmax(0,1fr)`로)

  - 한국 시간 새벽에 만든 주문의 날짜가 전날로 보인다 → `toISOString().slice(0, 10)`으로 자르고 있는지

## 7. 6단계: 테스트

5단계에서 화면을 바꾼 탓에 깨진 e2e를 고치고, 장바구니 store의 단위 테스트를 더한다.

이 장에서는 **지금 화면에서 통과하는 것만** 고친다. 결제 오류 문구와 수량 조절기는 10장에서 화면이 바뀌므로, 그 e2e도 10장 작업 7에서 함께 고친다.

| 화면에서 바뀐 것 | 테스트에서 바꿀 것 | 언제 |
|---|---|---|
| 비밀번호 칸의 placeholder를 없애고 label을 붙였다(5단계 작업 8) | `getByPlaceholder("password")` → `getByLabel("비밀번호")` | 작업 1 |
| 내 주문이 최신순이다, 주문 상세에 산 상품이 나온다(3단계 작업 6, 5단계 작업 7) | 새 주문은 목록의 `last()`가 아니라 `first()`, 상세에 상품이 보이는지 | 작업 1 |
| `setQuantity`(5단계 작업 2) | Vitest 단위 테스트 | 작업 2 |
| 머리글이 `me.profile`을 부른다(10장) | 요청을 세는 테스트가 그 요청을 세지 않게 | 작업 3(미리) |
| 결제 오류 문구, 상품 목록의 수량 조절기(10장) | `/결제 실패/` → `/결제를 시작하지 못했습니다/`, `cart-quantity.spec.ts` | 10장 작업 7 |

### 작업 1. [커밋] e2e를 새 화면에 맞추기

#### 비밀번호 칸을 label로 찾는다

placeholder가 없어져서, `getByPlaceholder("password")`는 칸을 찾지 못하고 시간 초과로 실패한다. 다섯 파일에서 같은 한 줄을 바꾼다.

```sh
# order-console-next 폴더에서 — 바꿀 줄을 모두 찾는다
grep -n 'getByPlaceholder("password")' e2e/*.ts
```

```diff
 // order-console-next/e2e/shop.spec.ts (upload.spec.ts도 같은 모양)
 async function loginAsKim(page: Page) {
   await page.goto("/login");
-  await page.getByPlaceholder("password").fill("1234");
+  await page.getByLabel("비밀번호").fill("1234");
   await page.getByRole("button", { name: "로그인", exact: true }).click();
```

`offline.spec.ts`(둘째 테스트), `stripe-payment.spec.ts`, `trpc.spec.ts`에는 `loginAsKim`이 없고 테스트 안에 같은 줄이 있다. 그 줄을 똑같이 바꾼다.

`getByLabel("비밀번호")`는 `<label>`의 글자로 칸을 찾는다. 화면 낭독기가 칸을 부르는 이름과 같아서, 테스트가 통과하면 낭독기 사용자도 그 칸을 찾을 수 있다는 뜻이 된다.

#### 새 주문은 목록의 맨 위, 상세에는 산 상품

`shop.spec.ts`의 "결제를 누르면 재고를 예약하고 Stripe 결제 화면으로 간다" 테스트의 끝부분이다.

```diff
 // order-console-next/e2e/shop.spec.ts
   await page.goto("/me/orders");
-  await expect(page.getByTestId("my-orders").getByRole("listitem").last()).toContainText("결제 대기");
+  await expect(page.getByTestId("my-orders").getByRole("listitem").first()).toContainText("결제 대기"); // 최신 주문이 위로
+  // 주문 상세에는 산 상품과 그때의 가격이 나온다
+  await page.getByTestId("my-orders").getByRole("listitem").first().getByRole("link").click();
+  await expect(page.getByTestId("order-detail")).toContainText("마우스");
+  await expect(page.getByTestId("order-detail")).toContainText("30,000원 × 1");
 });
```

- `last()` → `first()`: 3단계 작업 6에서 내 주문을 최신순으로 바꿨다. 방금 만든 주문은 이제 맨 위다. `last()`로 두면 가장 오래된 주문을 보게 되어, 그 주문의 상태에 따라 통과하기도 하고 실패하기도 한다.
- 아래 세 줄: 목록의 각 줄은 주문 상세로 가는 링크다(5단계 작업 5). 눌러서 상세에 마우스(시드 가격 30,000원)가 1개 있는지 본다.

#### 확인

```sh
# 저장소 루트에서. API(npm run dev:api)를 띄워 둔 채로
npm run test:e2e -w order-console-next
  1 skipped
  11 passed
```

화면은 Playwright가 빌드해서 띄운다(`playwright.config.ts`의 `webServer`). 건너뛴 하나는 실제 Stripe로 결제하는 테스트로, `STRIPE_E2E=1`일 때만 돈다.

### 작업 2. [커밋] 프론트에 Vitest 단위 테스트 더하기

`setQuantity`는 화면 없이 도는 함수라, 브라우저를 띄우는 e2e보다 store만 불러 보는 단위 테스트가 맞다. 프론트에는 단위 테스트 도구가 없었으므로 백엔드와 같은 Vitest를 더한다.

```sh
# 저장소 루트에서
npm install -D vitest -w order-console-next
```

#### 설정 파일(새 파일)

```ts
// order-console-next/vitest.config.ts
import { defineConfig } from "vitest/config";

// 화면 없이 도는 로직(장바구니 store)의 단위 테스트. e2e/*.spec.ts는 Playwright 것이므로 집어 가지 않는다
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"] },
});
```

`include`를 좁히는 이유는 아래 "Vitest와 Playwright가 같은 파일을 집으면"에서 다룬다.

#### 테스트 파일(새 파일)

```ts
// order-console-next/lib/cart-store.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "./cart-store";

const mouse = { productId: 2, name: "마우스", price: 30000 };
const keyboard = { productId: 1, name: "한정판 키보드", price: 150000 };
const cart = () => useCartStore.getState();

// 수량 조절(setQuantity). 브라우저 없이 store만 부른다
describe("장바구니 수량", () => {
  beforeEach(() => useCartStore.setState({ items: [], checkoutKey: null }));

  it("정한 수량이 그대로 들어간다", () => {
    cart().add(mouse);
    cart().setQuantity(2, 3);
    expect(cart().items).toEqual([{ ...mouse, quantity: 3 }]);
  });

  it("0 이하로 정하면 빠진다 - 다른 상품은 그대로", () => {
    cart().add(mouse);
    cart().add(keyboard);
    cart().setQuantity(2, 0);
    expect(cart().items.map((i) => i.productId)).toEqual([1]);
  });

  it("수량을 바꾸면 결제 멱등 키를 버린다 - 다른 결제이기 때문이다(05의 5단계)", () => {
    cart().add(mouse);
    const key = cart().beginCheckout();
    expect(cart().beginCheckout()).toBe(key); // 그대로면 같은 키를 다시 쓴다
    cart().setQuantity(2, 2);
    expect(cart().checkoutKey).toBeNull();
    expect(cart().beginCheckout()).not.toBe(key);
  });

  it("소수는 버린다", () => {
    cart().add(mouse);
    cart().setQuantity(2, 2.7);
    expect(cart().items[0].quantity).toBe(2);
  });
});
```

- `useCartStore.getState()`: 컴포넌트 밖에서 store의 지금 상태와 함수를 꺼낸다. 화면 없이 `add`·`setQuantity`를 바로 부를 수 있다.
- `beforeEach`의 `setState`: store는 모듈 하나에 하나뿐이라 테스트끼리 상태가 이어진다. 매번 비운다.

#### 스크립트 두 곳

```diff
 // order-console-next/package.json
     "lint": "eslint",
-    "test:e2e": "playwright test"
+    "test:e2e": "playwright test",
+    "test": "vitest run"
   },
```

```diff
 // package.json (저장소 루트)
-    "test:web": "npm run test:e2e -w order-console-next",
+    "test:web": "npm run test -w order-console-next && npm run test:e2e -w order-console-next",
```

`vitest`만 치면 파일을 지켜보며 끝나지 않는다(watch). `vitest run`은 한 번 돌고 끝난다. CI(`17`)는 `npm run test:web`을 그대로 부르므로 워크플로는 바꾸지 않는다.

#### 확인

```sh
# 저장소 루트에서. API를 띄워 둔 채로
npm run test:web
 Test Files  1 passed (1)
      Tests  4 passed (4)
  1 skipped
  11 passed
```

위 두 줄이 Vitest(단위 4개), 아래 두 줄이 Playwright(e2e)다.

### 개념 | Vitest와 Playwright가 같은 파일을 집으면

두 도구 모두 `test()`·`expect()`라는 같은 이름을 쓰지만 서로 다른 실행기다.

Vitest의 기본 대상에는 `*.spec.ts`도 들어 있다. `include`를 좁히지 않으면 Vitest가 `e2e/*.spec.ts`를 열고, 그 안의 `import { test } from "@playwright/test"`가 Playwright 실행기 밖에서 불려 `Playwright Test did not expect test() to be called here.`로 실패한다.

그래서 단위 테스트는 `lib/**/*.test.ts`, e2e는 `e2e/*.spec.ts`로 이름부터 나누고, Vitest의 `include`를 단위 테스트 쪽으로 한정했다.

### 작업 3. [커밋] 요청을 세는 테스트를 미리 좁히기

`trpc.spec.ts`는 주문 상세 화면이 tRPC 요청 두 개(`me.order`, `me.orders`)를 HTTP 요청 하나로 묶어 보내는지 본다. 테스트의 흐름은 이렇다.

```ts
// order-console-next/e2e/trpc.spec.ts (지금)
  // 1. 로그인한다 → 상점 화면(/shop)에 도착
  // 2. 지금부터 나가는 요청 가운데 /trpc/me.로 시작하는 것의 경로를 calls 배열에 적는다
  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/trpc/me.")) calls.push(url.pathname);
  });
  // 3. 주문 상세로 이동한다
  await page.goto("/me/orders/1");
  // ...
  // 4. 적힌 요청이 "묶인 요청 하나"뿐이어야 한다
  expect(calls).toEqual(["/trpc/me.order,me.orders"]);
```

묶이면 두 요청이 경로 하나(`/trpc/me.order,me.orders`)로 나간다. 그래서 `calls`에 그 하나만 있으면 통과다.

지금은 통과한다. 하지만 10장 작업 5에서 머리글이 관리 메뉴를 보일지 정하려고 `me.profile`을 부르게 되면, CI에서 4번 줄이 이렇게 실패했다. 로컬에서는 통과했던 테스트다.

```text
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 0
+ Received  + 1

  Array [
+   "/trpc/me.profile",
    "/trpc/me.order,me.orders",
  ]
```

읽는 법은 이렇다.

- `Expected`는 테스트가 기대한 값(`["/trpc/me.order,me.orders"]`), `Received`는 실제로 `calls`에 쌓인 값이다.
- 아래 배열은 둘을 겹쳐 보여 준다. 표시가 없는 줄은 둘 다에 있는 것이고, `+`가 붙은 줄은 **실제에만 있는 것**(기대하지 않았는데 들어온 것)이다. `-`가 붙은 줄은 기대했는데 없는 것이다.
- `Expected - 0`, `Received + 1`은 빠진 줄 0개, 더 들어온 줄 1개라는 요약이다.

즉 묶인 요청은 제대로 하나로 나갔고, 그 앞에 `/trpc/me.profile`이 하나 더 적혔다. 묶음이 깨진 것이 아니라, 세지 말아야 할 요청을 센 것이다.

왜 섞였는가. 머리글은 모든 화면에 있으므로 상점 화면에 도착하자마자 `me.profile`을 부른다. 2번(감시 시작)보다 먼저 끝나면 적히지 않고, 늦게 나가면 적힌다. 로컬에서는 감시를 시작하기 전에 끝나서 통과했고, 더 느린 CI 러너에서는 감시를 시작한 뒤에 나갔다.

테스트가 보려는 것은 주문 상세의 두 요청이므로, 세는 대상을 `me.order*`로 좁힌다.

```diff
 // order-console-next/e2e/trpc.spec.ts
   const calls: string[] = [];
   page.on("request", (req) => {
     const url = new URL(req.url());
-    if (url.pathname.startsWith("/trpc/me.")) calls.push(url.pathname);
+    // 주문 요청만 본다 - 머리글이 부르는 me.profile이 이동하는 순간에 섞일 수 있다
+    if (url.pathname.startsWith("/trpc/me.order")) calls.push(url.pathname);
   });
```

`"/trpc/me.order"`로 시작하는지만 보므로, 묶인 요청(`/trpc/me.order,me.orders`)은 세고 `/trpc/me.profile`은 세지 않는다.

화면에 요청 하나가 늘면, 요청을 세는 테스트는 타이밍에 따라 흔들릴 수 있다. "무엇을 세는가"를 테스트가 보려는 것으로 좁혀 두면 화면이 바뀌어도 흔들리지 않는다.

> 참고: 10장 이후에도 `me.profile`은 주문 요청과 묶이지 않고 따로 나간다(`["/trpc/me.order,me.orders", "/trpc/me.profile"]`). `page.goto`로 새로 연 페이지에는 액세스 토큰이 없어서, 머리글의 `useProfile()`(`enabled: loggedIn`)은 주문 요청이 refresh로 토큰을 다시 받은 뒤에야 묻기 때문이다. 이 순서가 바뀌어 셋이 한 묶음(`/trpc/me.order,me.orders,me.profile`)으로 나가면 지금의 `toEqual`은 깨진다. 그때는 경로 문자열 전체 대신 묶음 안의 프로시저 이름(`pathname.slice("/trpc/".length).split(",")`)을 보고, `me.order`와 `me.orders`가 같은 요청 하나에 들어 있는지만 확인하게 바꾼다.

### 남길 것

- **찾아보면 되는 것**: Playwright 찾기 함수(`getByLabel`, `getByRole`, `getByTestId`), Vitest의 `include` 설정 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 테스트는 역할·이름·`data-testid`로 찾는다. 문구나 구조를 일부러 바꾼 곳만 테스트를 고친다.

  - 테스트는 화면을 바꾼 그 시점에 고친다. 아직 없는 화면을 기대하는 테스트를 먼저 커밋하면 CI가 깨진 채로 남는다.

  - 요청을 세는 테스트는 세는 대상을 테스트가 보려는 것으로 좁힌다. 그래야 화면에 요청이 하나 늘어도 타이밍에 흔들리지 않는다.

- **에러 신호**:

  - e2e가 `getByPlaceholder("password")`에서 시간 초과 → placeholder를 없애고 label을 붙였다. `getByLabel("비밀번호")`

  - 로컬에서는 통과하는 e2e가 CI에서만 `+ "/trpc/me.profile"` 차이로 실패 → 세는 요청을 좁혔는지

  - `npm run test -w order-console-next`가 `Playwright Test did not expect test() to be called here.` → `vitest.config.ts`의 `include`가 `lib/**/*.test.ts`인지

## 8. 7단계: 시안과 대조하기

테스트가 통과해도 화면이 시안과 같다는 뜻은 아니다. 화면을 띄워 시안과 나란히 놓고 눈으로 본다.

데스크톱(1280)·휴대폰(390), 라이트·다크를 곱한 네 경우를 화면마다 본다.

### 작업 1. [확인] 개발자 도구로 폭과 색을 바꿔 가며 시안과 나란히 보기

API(`npm run dev:api`)와 화면(`npm run dev:web`)을 띄우고, 시안은 옆 창에 띄워 둔다.

- **폭**: 개발자 도구의 기기 툴바(Toggle device toolbar, `Cmd+Shift+M`)를 켜고 위쪽 칸에 폭을 390, 1280으로 바꿔 넣는다.

- **라이트·다크**: 개발자 도구 메뉴(`⋮`) → More tools → Rendering → "Emulate CSS media feature prefers-color-scheme"에서 `dark`·`light`를 고른다. 운영체제 설정을 바꿀 필요가 없다.

- **상태**: 시안에 그린 상태(불러오는 중, 빈 목록, 오류, 오프라인)도 본다. 불러오는 중은 Network 탭의 속도를 Slow 4G로, 오프라인은 Offline으로 바꾸면 나온다.

> 이번처럼 한 번 대조하는 데는 이것으로 충분하다. 같은 화면을 배포할 때마다 반복해서 확인해야 한다면 Playwright의 `expect(page).toHaveScreenshot()`으로 기준 이미지를 커밋해 두고 CI가 픽셀 차이를 잡게 한다(시각 회귀 테스트). 그때는 상품 목록과 글꼴(`document.fonts.ready`)이 다 온 뒤에 찍어야 매번 같은 이미지가 나온다.

대조에서 나온 것:

| 무엇이 | 원인 | 고친 것 |
|---|---|---|
| 데스크톱 주문 목록의 열 순서가 뒤섞였다(금액이 맨 앞) | 휴대폰 배치를 위해 일부 칸에만 `col-start`·`row-start`를 주었다. 위치를 지정한 칸이 먼저 자리를 잡고 나머지가 빈 곳을 채워, 데스크톱 자동 배치가 흐트러졌다 | 위치 지정 대신 휴대폰에서만 `order`로 보이는 순서를 바꾼다(6장 작업 5) |
| 결제 취소 안내의 "#8", 상세 위의 "내 주문"이 링크인지 보이지 않는다 | Tailwind의 기본 스타일이 링크의 밑줄과 색을 없앤다 | 본문 링크에 밑줄을 기본으로 주고(`@layer base`, 5장 작업 2), 메뉴처럼 일부러 뺄 곳만 `no-underline` |
| 주문 상세의 라벨(상태·금액…)이 값보다 살짝 위에 뜬다 | 라벨과 값의 글자 크기가 달라 줄의 위쪽에 맞춰졌다 | 격자에 `items-baseline`을 걸어 글자 기준선에 맞춘다 |
| 상세의 상품 가격이 화면 오른쪽 끝까지 밀려 있다 | 상품 목록이 칸 너비를 다 쓴다 | `max-w-md`로 폭을 제한 |
| "비어 있습니다"가 고딕처럼 보인다 | 계산된 글꼴은 Noto Serif KR이 맞았다. 본문에서 굵기 300을 물려받는데 명조는 400만 받아 두어, 브라우저가 가장 가까운 400으로 그린 것 | 의도를 분명히 하려고 `font-normal`을 명시 |

마지막 항목은 눈으로만 판단하지 않고 브라우저에 직접 물어 확인했다.

1. Elements 탭에서 "비어 있습니다"를 고른다(화면에서 우클릭 → 검사).
2. 오른쪽 Computed 탭에서 `font-family`와 `font-weight`를 본다. `"Noto Serif KR", …`, `300`이다.
3. 같은 Computed 탭의 맨 아래 **Rendered Fonts**에 실제로 그린 글꼴이 나온다. Noto Serif KR이 나오면 글꼴은 맞고, 굵기만 받아 둔 것(400)으로 대신 그린 것이다.

받아 둔 글꼴과 굵기의 목록은 콘솔에서 한 줄로 볼 수 있다.

```js
[...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight);
// [ "Noto Sans KR 300", "Noto Sans KR 400", "Noto Serif KR 400", ... ]
```

### 작업 2. [커밋] 이미지 바꾸기를 관리자에게만 보이기

2단계에서 "이미지 바꾸기를 누가 할 수 있는가"를 짚었고, 3단계에서 서버는 막았다(`AdminGuard`). 화면은 아직 로그인만 하면 누구에게나 업로드 칸을 보여 준다. 시안대로 관리자에게만 "이미지 바꾸기"를 보이고, 그것을 e2e로 확인한다.

| | 지금 | 바꾼 뒤 |
|---|---|---|
| 누구에게 보이나 | 로그인한 사람 모두(`loggedIn`) | 관리자만(`useIsAdmin()`, 3단계 작업 5) |
| 무엇이 보이나 | `이미지:`와 파일 칸 | `이미지 바꾸기`와 파일 칸 |

#### 상점: 관리자에게만

```diff
 // order-console-next/app/shop/page.tsx
-import { useAuthStore } from "@/lib/auth-store";
+import { useIsAdmin } from "@/lib/use-profile";
 import { useOnline } from "../online-banner";

 // ...

 function ProductList() {
   // ...
   const add = useCartStore((s) => s.add);
-  const loggedIn = useAuthStore((s) => s.accessToken !== null);
+  const isAdmin = useIsAdmin();

 // ...

-          {loggedIn && <ProductImageUploader productId={p.id} />}
+          {/* 관리자에게만 보인다. 막는 것은 서버다(AdminGuard) - 화면은 쓸 수 없는 칸을 보여 주지 않을 뿐이다 */}
+          {isAdmin && <ProductImageUploader productId={p.id} />}
```

`useAuthStore`는 이 파일에서 `loggedIn`에만 쓰였으므로 import도 바꾼다. 남겨 두면 쓰지 않는 import라고 lint가 경고한다.

#### 업로더: 무엇을 하는 칸인지 글자로

```diff
 // order-console-next/app/shop/product-image-uploader.tsx
   return (
     <label>
-      {" "}이미지:{" "}
+      {" "}이미지 바꾸기{" "}
       <input
```

#### e2e: 같은 탭에서 사용자를 바꿔 본다

`upload.spec.ts`의 맨 끝에 테스트 하나를 더한다.

```ts
// order-console-next/e2e/upload.spec.ts
// 관리자에게만 이미지 바꾸기가 보인다. 같은 탭에서 사용자를 바꿔 본다
test("이미지 바꾸기는 관리자에게만 보인다", async ({ page }) => {
  await loginAsKim(page); // 시드의 kim은 관리자
  await expect(page.getByText("이미지 바꾸기")).toHaveCount(4); // 상품 네 개 모두

  // 같은 탭에서 일반 사용자(lee)로 다시 로그인한다
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("아이디").fill("lee");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByTestId("stock-1")).toBeVisible(); // 상품 목록이 그려진 뒤에 센다
  await expect(page.getByText("이미지 바꾸기")).toHaveCount(0);
});
```

- 로그인 화면의 아이디 칸에는 아직 기본값 `kim`이 있다(5단계 작업 8). `fill("lee")`는 칸을 비우고 새로 채운다.
- 마지막 줄 바로 앞에서 상품 목록이 그려지기를 기다린다. 목록이 오기 전에 세면 버튼이 0개라 버그가 있어도 통과해 버린다.

#### 확인

```sh
# order-console-next 폴더에서. API를 띄워 둔 채로
npx playwright test e2e/upload.spec.ts
```

이 테스트는 **실패했다.** 

화면을 잘못 고친 것이 아니라, 테스트가 숨어 있던 버그를 찾았다.

```text
    Error: expect(locator).toHaveCount(expected) failed

    Locator:  getByText('이미지 바꾸기')
    Expected: 0
    Received: 4

        14 × locator resolved to 4 elements
           - unexpected value "4"

    > 45 |   await expect(page.getByText("이미지 바꾸기")).toHaveCount(0);

  1 failed
    e2e/upload.spec.ts:33:5 › 이미지 바꾸기는 관리자에게만 보인다
```

### 작업 3. [커밋] e2e가 찾아낸 버그: 로그아웃해도 이전 사용자의 데이터가 남는다

lee의 화면에 kim의 버튼이 그대로 있었다. 원인은 TanStack Query의 캐시다.

`05`부터 받아 온 데이터를 30초 동안 "신선하다"고 보고(`staleTime`) 다시 요청하지 않는다.

로그아웃이 그 캐시를 비우지 않았으므로, kim의 프로필(관리자)을 lee가 그대로 쓰고 있었다. **같은 이유로 kim의 "내 주문"도 lee의 화면에 잠깐 보일 수 있다.**

버튼은 서버가 403으로 막지만, 남의 주문 목록이 보이는 것은 그 자체로 정보 노출이다.

로그아웃, 비밀번호 로그인, GitHub 로그인 세 곳에서 캐시를 비운다.

#### 로그아웃

```diff
 // order-console-next/app/nav.tsx
+import { useQueryClient } from "@tanstack/react-query";
 import Link from "next/link";

 // ...

 export function Nav() {
   const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
   const router = useRouter();
+  const queryClient = useQueryClient();
   const loggedIn = useAuthStore((s) => s.accessToken !== null);

 // ...

       {loggedIn ? (
-        <button onClick={async () => { await logout(); router.push("/login"); }}>로그아웃</button>
+        <button onClick={async () => {
+          await logout();
+          // 받아 둔 데이터(내 주문, 프로필)를 모두 버린다. 남겨 두면 같은 탭에서 다음에 로그인한 사람에게 잠깐 보인다
+          queryClient.clear();
+          router.push("/login");
+        }}>로그아웃</button>
       ) : (
```

#### 비밀번호 로그인

로그아웃하지 않고 다른 아이디로 다시 로그인할 수도 있으므로, 로그인에 성공했을 때도 비운다.

```diff
 // order-console-next/app/login/page.tsx
+import { useQueryClient } from "@tanstack/react-query";
 import { useRouter } from "next/navigation";

 // ...

 export default function LoginPage() {
   const router = useRouter();
+  const queryClient = useQueryClient();
   const [error, setError] = useState<string | null>(null);

+  // 로그인에 성공하면: 이전 사용자의 캐시를 버리고 상점으로. 10장의 데모 로그인도 이 함수를 쓴다
+  function done() {
+    queryClient.clear();
+    router.push("/shop");
+  }
+
   async function onSubmit(formData: FormData) {
     try {
       await login(String(formData.get("id")), String(formData.get("password")));
-      router.push("/shop");
+      done();
     } catch (e) {
```

#### GitHub 로그인

```diff
 // order-console-next/app/auth/github/complete/exchange-code.tsx
+import { useQueryClient } from "@tanstack/react-query";
 import { useRouter } from "next/navigation";

 // ...

 export function ExchangeCode({ code }: { code: string }) {
   const router = useRouter();
+  const queryClient = useQueryClient();
   const [error, setError] = useState<string | null>(null);

 // ...

         await exchangeCode(code);
         await endAuthjsSession();
+        queryClient.clear(); // 이전 사용자의 캐시를 버린다(비밀번호 로그인과 같다)
         router.replace("/shop");
       } catch (e) {
         setError(e instanceof Error ? e.message : "알 수 없는 오류");
       }
     })();
-  }, [code, router]);
+  }, [code, router, queryClient]);
```

`useEffect` 안에서 `queryClient`를 쓰므로 의존성 배열에도 넣는다. 빠뜨리면 lint(`react-hooks/exhaustive-deps`)가 경고한다.

#### 확인

```sh
# order-console-next 폴더에서. API를 띄워 둔 채로
npx playwright test e2e/upload.spec.ts
```

작업 2에서 실패한 테스트를 포함해 셋 모두 통과한다.

### 개념 | 쿼리 캐시는 사용자를 모른다

TanStack Query의 캐시는 `queryKey`로만 데이터를 찾는다. `me.profile`의 키에는 "누구의 프로필인가"가 들어 있지 않다.

누구인지는 요청할 때 붙는 토큰이 정하는데, 캐시에서 꺼낼 때는 요청을 하지 않는다. 그래서 같은 탭에서 사용자가 바뀌어도 30초 동안은 앞사람의 데이터가 그대로 나온다.

| 방법 | 무엇을 하나 | 사용자가 바뀔 때 |
|---|---|---|
| `invalidateQueries()` | 데이터를 "오래됐다"고 표시하고 다시 요청한다. 새 응답이 올 때까지는 옛 데이터를 보여 준다 | 잠깐이지만 앞사람의 데이터가 보인다 |
| `clear()` | 캐시를 모두 버린다 | 새 사용자의 요청이 처음부터 나간다. 그동안은 불러오는 중이 보인다 |

결제 직후 상품 목록을 갱신할 때(10장 장바구니 페이지)는 `invalidateQueries`가 맞다. 같은 사람의 데이터가 조금 오래된 것뿐이기 때문이다.

사용자가 바뀌는 곳(로그인·로그아웃)에서는 `clear()`가 맞다.

### 남길 것

- **찾아보면 되는 것**: 기기 툴바와 Rendering 탭의 위치, Computed 탭의 Rendered Fonts, `document.fonts`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 테스트 통과와 시안 일치는 다른 일이다. 폭(데스크톱·휴대폰)과 색(라이트·다크)을 곱한 화면을 시안과 나란히 보고, 눈으로 애매하면 브라우저에 묻는다(Computed 탭, Rendered Fonts).

  - "없다"를 확인하는 테스트는 먼저 화면이 다 그려졌음을 확인한 뒤에 센다. 그리기 전에 세면 버그가 있어도 0개라 통과한다.

  - 사용자가 바뀌는 곳에서는 쿼리 캐시를 비운다. 캐시는 누구의 데이터인지 모른다.

- **에러 신호**:

  - 데스크톱 목록의 열 순서가 뒤섞인다 → 일부 칸에만 `col-start`·`row-start`를 줬는지(보이는 순서만 바꾸려면 `order`)

  - 본문 속 링크가 글자와 구별되지 않는다 → `@layer base`의 `a` 규칙

  - e2e `locator resolved to 4 elements` / `unexpected value "4"`(다른 사람으로 로그인했는데 이전 사람의 버튼·주문이 보인다) → 로그인·로그아웃에서 `queryClient.clear()`를 부르는지

## 9. 8단계: 배포하고, 운영에서 관리자를 지정한다

### 작업 1. [실행] 배포 브랜치를 이 브랜치로 바꾸기

워크플로(`.github/workflows/ci.yml`)는 고치지 않는다. `18`에서 트리거는 모든 브랜치(`branches: ["**"]`)로 두고, 배포 작업만 `if: github.ref_name == vars.DEPLOY_BRANCH`로 골랐다(`18`의 6단계 "배포 브랜치를 워크플로에 적지 않는 이유"). 그래서 이 브랜치의 검사·테스트는 지금도 돌고, 배포만 건너뛴다.

배포하는 브랜치는 저장소 변수 하나로 바꾼다. 같은 서버(`3.106.98.215`)의 같은 폴더(`/opt/node-order`)에서 `IMAGE_TAG`가 이 브랜치의 커밋으로 바뀐다.

```sh
R=<계정>/<저장소>
gh variable set DEPLOY_BRANCH -R $R -b 19-design
gh variable list -R $R | grep DEPLOY_BRANCH
DEPLOY_BRANCH	19-design	...
```

#### 배포 환경(`production`)의 허용 브랜치도 바꾼다

워크플로의 배포 작업에는 `environment: production`이 붙어 있다(`ci.yml`의 `deploy`). GitHub의 **Environment**는 "운영에 배포하는 작업"에 거는 별도의 문이다. 저장소 설정에서 이 환경에 **어느 브랜치가 배포할 수 있는지**(Deployment branches and tags)를 정해 둘 수 있다.

그래서 배포 작업이 돌려면 문 두 개를 모두 지나야 한다.

| 문 | 어디서 정하나 | 무엇을 막나 |
|---|---|---|
| `DEPLOY_BRANCH` 변수 | 저장소 변수(위에서 바꿨다) | 배포 작업을 **시작할지**. 다르면 "건너뜀" |
| `production` 환경의 허용 브랜치 | Settings → Environments → `production` | 작업이 시작돼도 **이 환경을 쓸 수 있는지**. 목록에 없으면 실패 |

변수 하나만으로도 배포 브랜치는 정해진다. 그런데 변수는 워크플로 파일 안의 `if`로만 지켜진다. 누군가 옛 브랜치(`18-deploy`)에서 `if`를 고쳐 푸시하면 그 브랜치가 운영에 배포될 수 있다. 환경의 허용 브랜치는 워크플로 파일 밖(저장소 설정)에 있어서 그렇게 우회할 수 없다. 끝난 브랜치의 푸시가 서버를 옛 코드로 되돌리지 못하게 두 곳에서 막는 것이다.

`18`에서 허용 브랜치를 `18-deploy`로 정해 두었다면, 변수만 바꾸고 이것을 잊었을 때 배포 작업이 시작은 되지만 바로 실패한다(아래 "남길 것"의 에러 신호). 정해 두지 않았다면(기본값) 이 문은 열려 있고, 배포 브랜치는 변수 하나로만 정해진다. 혼자 쓰는 학습 저장소라면 그것으로도 충분하다.

먼저 지금 설정을 본다.

```sh
gh api repos/$R/environments/production --jq .deployment_branch_policy
```

| 결과 | 뜻 | 할 일 |
|---|---|---|
| `null` | 제한 없음. 모든 브랜치가 이 환경을 쓸 수 있다 | 없다. 이 절은 여기서 끝난다 |
| `{"protected_branches":false,"custom_branch_policies":true}` | 브랜치 목록으로 제한 중 | 아래로 |

`null`인데 아래의 목록 조회를 치면 `Not Found (HTTP 404)`가 난다. 목록이라는 것 자체가 없어서다.

제한 중일 때만 목록을 본다.

```sh
gh api repos/$R/environments/production/deployment-branch-policies --jq '.branch_policies[] | {id, name}'
{"id":12345678,"name":"18-deploy"}
```

목록이 있으면 `19-design`을 넣고 `18-deploy`를 뺀다. 화면에서는 Settings → Environments → `production` → Deployment branches and tags에서 같은 일을 한다.

```sh
gh api -X POST repos/$R/environments/production/deployment-branch-policies -f name=19-design -f type=branch
gh api -X DELETE repos/$R/environments/production/deployment-branch-policies/12345678   # 위에서 본 18-deploy의 id
gh api repos/$R/environments/production/deployment-branch-policies --jq '.branch_policies[].name'
19-design
```

푸시하면 워크플로가 돈다.

```text
ci  19-design  push
  린트/타입 검사      success    41초
  백엔드 테스트       success    95초
  프론트 e2e          success   150초
  경보 규칙 테스트    success    12초
  이미지 빌드·올리기  success   128초   # 새 브랜치라 캐시가 없었다
  배포                success   100초
```

배포 작업이 "건너뜀"이 아니라 실행되었는지, 서버의 `IMAGE_TAG`가 이 브랜치의 커밋 해시로 바뀌었는지 본다.

배포 스크립트(`18`의 6단계 "서버에서 실행하는 배포 스크립트")가 역할 마이그레이션을 RDS에 적용했다. 기본값이 있는 열 추가라 배포 도중 잠깐 섞여 도는 이전 버전도 문제없다.

### 작업 2. [실행] 운영의 관리자는 시드가 아니라 SQL 한 줄로 정한다

#### 마이그레이션은 이미 적용됐고, 남은 것은 데이터다

배포할 때마다 직접 할 일은 없다. 새 마이그레이션(`0017_user_role`)은 작업 1의 배포에서 이미 적용됐다. 배포 스크립트(`deploy/deploy.sh`)가 앱을 바꾸기 전에 `docker compose run --rm migrate`를 돌리고, 그 이미지가 하는 일이 `prisma migrate deploy`다(`order-api-nest/Dockerfile`의 `migrate` 단계). 앞으로 마이그레이션을 더해도 푸시만 하면 같은 길로 적용된다.

손으로 하는 것은 **스키마가 아니라 데이터**다. 마이그레이션은 `role` 열을 만들고 기존 사용자 모두에게 기본값 `user`를 채웠을 뿐, "누가 관리자인가"는 모른다. 그것은 배포한 뒤 실제로 쌓인 데이터(운영 DB의 데이터)라서 사람이 정한다.

| | 무엇이 | 언제 | 어떻게 |
|---|---|---|---|
| 스키마(열, 타입, 인덱스) | 마이그레이션 | 배포마다 자동 | `deploy.sh` → `prisma migrate deploy` |
| 운영 DB의 데이터(누가 관리자인가) | 이 작업 | 필요할 때 한 번 | 서버에서 SQL 한 줄 |

로컬 DB에서는 시드가 `kim`을 관리자로 만들었다(3단계 작업 1). 운영 DB에서는 시드를 다시 돌리면 안 된다. 시드는 `TRUNCATE`로 시작하므로, 배포한 뒤 실제로 쌓인 주문과 사용자가 사라진다(`18`의 7단계 "시드는 손으로, 한 번만").

#### 내 GitHub 계정의 사용자 id

배포된 화면(`https://shop.3-106-98-215.sslip.io`)에서 GitHub로 로그인하면, 운영 DB의 `users`에 `github-<GitHub 숫자 id>`라는 id로 행이 생긴다(`15`). 내 숫자 id는 이 PC에서 본다.

```sh
gh api user --jq .id
49951648
```

그러면 바꿀 행은 `github-49951648`다. 배포된 화면에서 한 번도 GitHub로 로그인하지 않았다면 그 행이 아직 없으므로, 먼저 그 화면에서 GitHub로 로그인해 둔다.

#### 서버에서 SQL 한 줄

운영 DB(RDS)는 서버에서만 닿는다. 이 PC에서 SSH로 서버에 명령 하나를 보내 실행한다. `18`에서 운영 DB에 시드를 넣을 때와 같은 꼴이고, 서버에서 돌리는 명령만 다르다.

```sh
# 이 PC, 저장소 루트에서 → SSH 키가 있는 폴더로
cd deploy/aws
echo "UPDATE users SET role = 'admin' WHERE id = 'github-49951648';" \
  | ssh -i .local/admin_ed25519 ubuntu@3.106.98.215 'cd /opt/node-order && docker compose run --rm -T migrate npx prisma db execute --stdin'
Script executed successfully.
```

| | `18`의 운영 시드 | 이번 |
|---|---|---|
| 서버에서 돌리는 명령 | `npx prisma db seed` | `npx prisma db execute --stdin`(+ `UPDATE` 한 줄) |
| 하는 일 | 전부 지우고(`TRUNCATE`) 시드로 채운다 | 한 행의 역할만 바꾼다 |
| 운영에서 | 처음 한 번만 | 필요할 때 |

- `ssh -i .local/admin_ed25519 ubuntu@… '…'`: `18`에서 서버를 만들 때 생긴 관리용 키로 접속해, 따옴표 안의 명령만 실행하고 돌아온다. 키는 1장에서 옮겨 왔다.
- `cd /opt/node-order`: CI가 `compose.yml`·`deploy.sh`를 올려 두고, `.env`(DB 주소와 비밀번호)가 있는 폴더다. `docker compose`는 이 폴더의 파일을 읽는다.
- `docker compose run --rm migrate`: 배포 때 마이그레이션을 돌린 그 이미지를 한 번 띄우고 끝나면 지운다. Prisma와 RDS 인증서가 들어 있고, 소유자 계정의 DB 주소(`ADMIN_DATABASE_URL`)를 받는다. 서버에 따로 DB 도구를 설치하지 않아도 된다.
- `echo … |`와 `-T`: `echo`의 출력이 SSH를 거쳐 서버 명령의 표준 입력으로 들어간다. 입력을 파이프로 받으려면 `-T`로 터미널 흉내를 끈다.
- `prisma db execute --stdin`: 표준 입력의 SQL을 그대로 실행한다. 결과 행은 보여 주지 않는다.

`db execute`는 결과를 찍지 않으므로, 확인은 `psql`로 한다. 서버에 `psql`이 없으니 Postgres 이미지의 것을 빌려 쓴다.

```sh
# 이 PC의 deploy/aws에서
ssh -i .local/admin_ed25519 ubuntu@3.106.98.215 'cd /opt/node-order && docker run --rm \
  -v ./rds-ca.pem:/certs/rds-ca.pem:ro -e PGSSLROOTCERT=/certs/rds-ca.pem \
  postgres:17 psql "$(sed -n "s/^ADMIN_DATABASE_URL=//p" .env)" -At -c "SELECT id, role FROM users ORDER BY id"'
choi|user
github-49951648|admin
kim|user
lee|user
park|user
```

- 작은따옴표 안 전체가 서버에서 돈다. `$(sed …)`도 서버에서 풀려 서버 `.env`의 DB 주소가 들어간다.
- `PGSSLROOTCERT`는 주소의 `sslmode=verify-full`이 서버 인증서를 확인할 때 쓸 RDS 인증서다.

역할은 토큰을 새로 받을 때 들어가므로, 배포된 화면에 이미 로그인해 있었다면 다시 로그인해야 "이미지 바꾸기"가 보인다.

### 개념 | 운영 서버에 명령을 보내는 방법들

이 작업처럼 서버에 명령을 보내는 방법은 두 가지가 흔하다.

| 방식 | 주로 쓰는 때 |
|---|---|
| 서버에 들어가서 치기(`ssh` 후 프롬프트에서) | 상황을 보면서 여러 단계를 할 때. 로그·상태를 보고 판단하는 장애 대응, 탐색 |
| 한 줄로 보내기(`ssh host '명령'`) | 할 일이 정해진 명령을 한 번 실행할 때. 문서·런북·스크립트에 적고 그대로 재현한다. CI의 `ssh … bash deploy.sh`도 이 꼴이다 |

이 가이드처럼 정해진 명령을 따라 치는 문서는 한 줄 방식이 맞다. 운영 DB를 손으로 고치면서 결과를 보고 확정하고 싶다면 들어가서 `psql`로 `BEGIN` → `UPDATE` → `SELECT`로 확인 → `COMMIT` 하는 쪽이 낫다.

팀과 서버가 늘면 둘 다 덜 쓴다. SSH 키를 사람마다 나눠 주고 거두는 일이 번거롭고, 누가 무엇을 쳤는지 남지 않기 때문이다. 대신 이렇게 한다.

**1. 접속은 클라우드의 관리 채널로(AWS SSM)**

SSH 포트와 키 없이, IAM 권한으로 서버에 들어가거나 명령을 보낸다. 실행 기록이 CloudTrail에 남는다.

```sh
# 들어가서 치기에 해당한다(Session Manager)
aws ssm start-session --target i-0123456789abcdef0

# 한 줄로 보내기에 해당한다(Run Command)
aws ssm send-command --instance-ids i-0123456789abcdef0 --document-name AWS-RunShellScript \
  --parameters 'commands=["cd /opt/node-order && docker compose ps"]'
```

이 저장소의 서버에 쓰려면 서버 역할(`node-order-server`, `18`의 `30-storage.sh`)에 AWS 관리형 정책 `AmazonSSMManagedInstanceCore`를 붙여야 한다. 지금은 S3 정책만 붙어 있다. 이 PC에는 Session Manager 플러그인도 설치해야 한다.

**2. 일회성 작업은 플랫폼이 띄운다**

서버에 들어가 컨테이너를 돌리는 대신, 같은 이미지를 작업 하나로 띄우고 끝나면 지운다. 이 가이드의 `docker compose run --rm migrate`가 서버 한 대에서 하는 일을 플랫폼이 대신한다.

| 플랫폼 | 명령 |
|---|---|
| ECS | `aws ecs run-task --task-definition <migrate 작업 정의> --overrides …`(명령만 바꿔 같은 이미지를 띄운다) |
| Kubernetes | Job 매니페스트를 `kubectl apply -f migrate-job.yaml`로 띄운다. 잠깐 들여다볼 때는 `kubectl exec` |

**3. 데이터 변경은 코드로 남긴다**

"누가 관리자인가" 같은 운영 데이터 변경을 손으로 친 SQL 대신 코드로 만들어, 리뷰를 거쳐 배포로 적용한다.

- **데이터 마이그레이션**: 스키마 마이그레이션처럼 SQL 파일로 커밋한다. 이 저장소라면 `0018_set_admin/migration.sql`에 `UPDATE users SET role = 'admin' WHERE id = 'github-49951648';`를 두면 다음 배포의 `migrate deploy`가 한 번 적용한다. 다만 로컬·테스트 DB에도 같이 적용되므로, 그 행이 없는 곳에서도 문제없는 SQL이어야 한다(여기서는 행이 없으면 0행이 바뀔 뿐이다).
- **관리용 명령**: `npm run admin:grant -- github-49951648`처럼 앱 안에 작은 CLI를 두고, 2번의 일회성 작업으로 돌린다.

어느 쪽이든 "언제, 누가, 왜 바꿨는지"가 커밋과 리뷰에 남는다.

> 이 프로젝트는 서버 한 대를 혼자 운영한다. 지금은 한 줄 SSH로 충분하고, 위 방법들은 사람이나 서버가 늘 때 바꾸는 순서다.

### 남길 것

- **찾아보면 되는 것**: `gh variable set`, `prisma db execute --stdin`, `docker compose run --rm -T`의 옵션. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 스키마는 배포가 마이그레이션으로 바꾸고, 운영 데이터(누가 관리자인가)는 사람이 필요한 행만 SQL로 고친다. 운영 DB를 시드로 덮지 않는다.

  - 기본값이 있는 열 추가는 배포 중에 섞여 도는 이전 버전에도 안전하다.

  - 배포할 브랜치는 워크플로 파일이 아니라 저장소 변수(`DEPLOY_BRANCH`)가 정한다. 단계를 넘길 때 파일은 그대로 두고 변수만 바꾼다.

- **에러 신호**:

  - 검사·테스트는 모두 초록인데 배포만 건너뜀 → `DEPLOY_BRANCH`가 아직 `18-deploy`이거나 비어 있다

  - `gh api …/deployment-branch-policies`가 `Not Found (HTTP 404)` → 허용 브랜치 제한이 꺼져 있다(`null`). 할 일 없음

  - 배포 작업이 `Branch "19-design" is not allowed to deploy to production due to environment protection rules.` → Environments의 허용 브랜치 목록에 `19-design`이 없다

  - 역할을 바꿨는데 배포된 화면에 "이미지 바꾸기"가 안 보인다 → 역할을 바꾸기 전에 받은 토큰이다. 다시 로그인하고, `me.profile`의 응답도 확인한다

## 10. 9단계: 배포한 화면을 사용자 입장에서 써 보기

테스트와 시안 대조를 통과해도, **이 링크를 받은 사람이 실제로 무엇을 할 수 있는가**는 따로 확인해야 한다.

운영 주소를 처음 받은 사람의 입장에서 써 보니 네 가지가 걸렸다.

| 걸린 것 | 왜 문제인가 |
|---|---|
| 시연하는 사람이 이미지 업로드를 볼 방법이 없다 | 배포된 서비스의 관리자는 내 GitHub 계정 하나뿐이다. 링크를 받은 사람은 일반 사용자로만 들어온다 |
| 상점 목록에 "이미지 바꾸기"가 섞여 있다 | 손님이 보는 화면과 관리하는 화면이 같은 곳에 있다. 관리 기능이 늘수록 상점 화면이 복잡해진다 |
| "상품"과 "장바구니" 메뉴가 같은 페이지를 가리킨다 | 장바구니 개수를 어디서나 보이려고 남긴 링크가 상점 화면의 `#cart`로 갔다. 메뉴 두 개가 같은 곳으로 간다 |
| "담기"는 하나씩만 담긴다 | 둘을 담으려면 같은 버튼을 두 번 누르고 장바구니에서 확인해야 한다 |

시안부터 다시 고쳤다(3장의 흐름 그대로).

- 로그인 화면에 "데모로 둘러보기": 비밀번호 없이 일반 사용자·관리자로 들어간다. 누구나 관리자 기능을 쓰게 되므로 데모 데이터를 매일 초기화한다. 화면에도 그렇게 적는다.

- 관리자 페이지 `/admin/products`: 상품·가격·재고·이미지를 한 표에서. 머리글의 "관리"는 관리자에게만 보인다.

- 장바구니 페이지 `/cart`: 머리글의 "장바구니 N"이 여기로 온다. 상점 화면에서는 장바구니 칸을 없애 목록이 넓어진다.

- 담으면 그 자리가 수량 조절기: 처음에는 "담기", 한 번 담으면 같은 자리가 `- 1 +`가 된다. 담기 전에 수량을 고르는 칸을 따로 두는 것보다 단계가 적다. 담을 때마다 짧은 안내("마우스를 담았습니다. 장바구니 보기")가 뜬다.

이 장에서 할 일과 순서는 이렇다.

| 작업 | 무엇을 | 고칠 파일 |
|---|---|---|
| 1 | 데모 로그인(API 경로 + 로그인 화면 버튼) | `order-api-nest/src/auth/*`, 환경 변수 파일 넷, `lib/api-client.ts`, `app/login/page.tsx` |
| 2 | 데모 로그인 백엔드 e2e | `order-api-nest/test/demo-login.e2e-spec.ts`(새 파일) |
| 3 | 장바구니 페이지 | `app/cart/page.tsx`(새 파일) |
| 4 | 상점 화면: 장바구니 칸과 업로더를 빼고, 담으면 그 자리가 수량 조절기 | `app/shop/page.tsx` |
| 5 | 머리글: 관리 메뉴와 장바구니 링크 | `app/nav.tsx` |
| 6 | 관리자 페이지 | `app/admin/products/*`(업로더를 옮겨 온다) |
| 7 | 새 화면에 맞춘 e2e | `e2e/*.spec.ts` |
| 8 | 운영에 반영 | 서버 `.env`, 운영 DB |

> 작업 4에서 상점 화면의 장바구니 칸과 "이미지 바꾸기"를 빼면, 그것을 쓰던 프론트 e2e(결제·오프라인·업로드)가 작업 7까지 깨진다. 작업마다 커밋은 하되, **푸시는 작업 7까지 마친 뒤에** 한다. 푸시하면 CI가 돌고, 배포 브랜치라면 배포까지 되기 때문이다.

### 작업 1. [커밋] 데모 로그인

#### API: 요청 본문(새 파일)

요청 본문은 누구로 들어갈지만 고른다.

```ts
// order-api-nest/src/auth/demo-login.dto.ts
import { IsIn } from "class-validator";

// 데모 로그인. 누구로 들어갈지만 고른다 - 비밀번호는 받지 않는다
export class DemoLoginDto {
  @IsIn(["user", "admin"]) as!: "user" | "admin";
}
```

`@IsIn`이 두 값 말고는 400으로 돌려보낸다(전역 `ValidationPipe`).

#### API: 서비스

```diff
 // order-api-nest/src/auth/auth.service.ts
 import { createHash, randomBytes, randomUUID } from "node:crypto";
-import { Injectable, UnauthorizedException } from "@nestjs/common";
+import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";

 // ...

   async login(id: string, password: string): Promise<IssuedTokens> {
     // ...
     return this.issueTokens(this.prisma, user.id, randomUUID());
   }

+  // 시연용 로그인. 비밀번호 없이 정해진 데모 계정으로 들어간다. DEMO_LOGIN=1일 때만 열린다(운영은 서버의 .env)
+  // 누구나 관리자 기능을 쓰게 되므로, 데모 데이터는 매일 초기화한다
+  static readonly DEMO_ACCOUNTS = { user: "lee", admin: "kim" } as const;
+
+  demoEnabled(): boolean {
+    return process.env.DEMO_LOGIN === "1";
+  }
+
+  async loginAsDemo(as: "user" | "admin"): Promise<IssuedTokens> {
+    if (!this.demoEnabled()) throw new NotFoundException();
+    const user = await this.prisma.user.findUnique({ where: { id: AuthService.DEMO_ACCOUNTS[as] } });
+    if (!user) throw new NotFoundException("데모 계정이 없다 - 시드를 확인한다");
+    return this.issueTokens(this.prisma, user.id, randomUUID());
+  }
+
   async loginWithGithub(githubAccessToken: string): Promise<string> {
```

토큰은 비밀번호 로그인과 같은 `issueTokens`로 만든다. 데모라고 다른 길로 인증하지 않는다.

#### API: 경로 두 개

```diff
 // order-api-nest/src/auth/auth.controller.ts
-import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
+import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
 import { AuthGuard } from "@nestjs/passport";
 import type { CookieOptions, Request, Response } from "express";
 import { AuthService, REFRESH_TOKEN_TTL_SECONDS } from "./auth.service.js";
 import { LoginDto } from "./login.dto.js";
 import { ExchangeCodeDto, GithubLoginDto } from "./github-login.dto.js";
+import { DemoLoginDto } from "./demo-login.dto.js";

 // ...

   @Post("login")
   @HttpCode(200)
   async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
     // ...
   }

+  // 화면이 데모 버튼을 보일지 묻는다
+  @Get("demo")
+  demo() {
+    return { enabled: this.authService.demoEnabled() };
+  }
+
+  // 데모 계정으로 로그인. 꺼져 있으면 404 - 이런 경로가 있는지도 알리지 않는다
+  @Post("demo")
+  @HttpCode(200)
+  async demoLogin(@Body() dto: DemoLoginDto, @Res({ passthrough: true }) res: Response) {
+    const { accessToken, refreshToken } = await this.authService.loginAsDemo(dto.as);
+    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
+    return { accessToken };
+  }
+
   @Post("github")
```

응답과 쿠키는 바로 위 `login`과 똑같다. 화면은 받은 액세스 토큰을 비밀번호 로그인 때와 같은 방식으로 쓴다.

#### 켜고 끄는 환경 변수: 네 파일

로컬과 로컬 컨테이너는 켜고, 운영의 기본값은 끈다.

```diff
 # order-api-nest/.env (같은 줄을 order-api-nest/.env.example 끝에도)
 ORPHAN_CLEANUP_INTERVAL_MS=600000
+# 로그인 화면의 "데모로 둘러보기"(비밀번호 없이 lee·kim으로). 운영에서는 서버 .env로 켜고 끈다
+DEMO_LOGIN=1
```

이 `.env`는 커밋되는 파일이고, CI의 프론트 e2e도 이 파일로 API를 띄운다. 그래서 작업 7의 데모 e2e가 CI에서도 돈다. 지금 파일은 마지막 줄 끝에 줄바꿈이 없으므로 `echo >>`로 붙이지 말고 편집기로 새 줄을 만들어 넣는다(붙이면 앞줄과 이어진다).

```diff
 # compose.yaml (저장소 루트) - api 서비스
     environment:
       PORT: "4000"
       JWT_SECRET: ${JWT_SECRET:-change-me}
       DEMO_PASSWORD: "1234"
+      DEMO_LOGIN: "1"   # 로그인 화면의 데모 버튼
```

```diff
 # deploy/compose.yml - api 서비스(운영)
     environment:
       PORT: "4000"
       JWT_SECRET: ${JWT_SECRET:?}
+      DEMO_LOGIN: ${DEMO_LOGIN:-0}   # 1이면 로그인 화면에 데모 버튼(데모 데이터는 매일 초기화). 서버 .env에서 정한다
```

```diff
 # deploy/.env.example
 DEMO_PASSWORD=
+# 1이면 로그인 화면에 "데모로 둘러보기"(비밀번호 없이 lee·kim). 누구나 관리자 기능을 쓰게 되므로 데모 데이터를 매일 초기화한다
+DEMO_LOGIN=0
```

`${DEMO_LOGIN:-0}`은 서버 `.env`에 값이 없으면 `0`(꺼짐)이라는 뜻이다. 운영에서 켜는 것은 작업 8에서 한다.

#### 화면: API 함수 두 개

```diff
 // order-console-next/lib/api-client.ts
 export async function login(id: string, password: string): Promise<void> {
   // ...
   useAuthStore.getState().setAccessToken(accessToken);
 }

+// 데모 계정으로 로그인(비밀번호 없이). 서버가 꺼 두었으면 404다. 응답 처리는 login과 같다
+export async function demoLogin(as: "user" | "admin"): Promise<void> {
+  const res = await fetch(`${API_URL}/auth/demo`, {
+    method: "POST",
+    headers: { "Content-Type": "application/json" },
+    body: JSON.stringify({ as }),
+    credentials: "include",
+  });
+  const { accessToken } = await parse<{ accessToken: string }>(res);
+  useAuthStore.getState().setAccessToken(accessToken);
+}
+
+// 로그인 화면이 데모 버튼을 보일지 묻는다
+export async function demoEnabled(): Promise<boolean> {
+  const res = await fetch(`${API_URL}/auth/demo`);
+  return (await parse<{ enabled: boolean }>(res)).enabled;
+}
+
 export async function exchangeCode(code: string): Promise<void> {
```

`credentials: "include"`는 응답의 refresh 쿠키를 브라우저가 받아 두게 한다(`login`과 같다).

#### 화면: 로그인 화면

데모 버튼을 더하고, 아이디 칸의 기본값(`kim`)을 없애고, 화면 배치를 다듬는다. 시연하는 사람은 이제 데모 버튼을 쓴다.

```diff
 // order-console-next/app/login/page.tsx
-import { useQueryClient } from "@tanstack/react-query";
+import { useQuery, useQueryClient } from "@tanstack/react-query";
 import { useRouter } from "next/navigation";
 import { useState } from "react";
-import { ApiError, login } from "@/lib/api-client";
+import { ApiError, demoEnabled, demoLogin, login } from "@/lib/api-client";
 import { signInWithGithub } from "./actions";

 export default function LoginPage() {
   const router = useRouter();
   const queryClient = useQueryClient();
   const [error, setError] = useState<string | null>(null);
+  // 서버가 데모 로그인을 켜 두었는가(DEMO_LOGIN=1). 꺼져 있으면 데모 버튼을 보이지 않는다
+  const { data: demo } = useQuery({ queryKey: ["auth", "demo"], queryFn: demoEnabled, staleTime: Infinity });

   function done() {
     // ...
   }

   async function onSubmit(formData: FormData) {
     // ...
   }

+  async function onDemo(as: "user" | "admin") {
+    try {
+      await demoLogin(as);
+      done();
+    } catch {
+      setError("데모 로그인을 할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
+    }
+  }
+
   const field = "border-0 border-b border-line-strong bg-transparent py-2 font-light aria-invalid:border-danger";

   return (
-    <main>
-      <h1>로그인</h1>
-      <form action={onSubmit}>
+    <main className="page flex-1 pb-12">
+      <div className="mx-auto mt-8 grid max-w-[300px] gap-4">
+        <h1 className="title mb-2">로그인</h1>
+        {/* 시연하는 사람이 비밀번호 없이 일반 사용자·관리자 화면을 모두 볼 수 있게 한다 */}
+        {demo && (
+          <section aria-labelledby="demo-title" className="grid gap-2">
+            <h2 id="demo-title" className="label">데모로 둘러보기</h2>
+            <div className="grid grid-cols-2 gap-2">
+              <button type="button" className="btn" onClick={() => onDemo("user")}>일반 사용자로</button>
+              <button type="button" className="btn" onClick={() => onDemo("admin")}>관리자로</button>
+            </div>
+            <p className="text-[0.78rem] text-muted">비밀번호 없이 들어갑니다. 데모 데이터는 매일 초기화됩니다.</p>
+            <p className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-muted before:border-t before:border-line after:border-t after:border-line">또는</p>
+          </section>
+        )}
+        <form action={onSubmit} className="grid gap-4">
         <label className="grid gap-1">
           <span className="label">아이디</span>
-          <input name="id" defaultValue="kim" autoComplete="username" className={field} />
+          <input name="id" autoComplete="username" className={field} />
         </label>
         {/* 비밀번호 칸과 오류 문장은 그대로 */}
-        <button type="submit">로그인</button>
-      </form>
-      <form action={signInWithGithub}>
-        <button type="submit">GitHub로 로그인</button>
-      </form>
+          <button type="submit" className="btn btn-primary w-full">로그인</button>
+        </form>
+        <form action={signInWithGithub}>
+          <button type="submit" className="btn w-full">GitHub로 로그인</button>
+        </form>
+      </div>
     </main>
   );
 }
```

- `staleTime: Infinity`: 서버가 데모를 켰는지는 실행 중에 바뀌지 않으므로 한 번만 묻는다.
- `demo &&`: 응답이 오기 전(`undefined`)과 꺼져 있을 때(`false`) 모두 버튼을 그리지 않는다.
- `done()`(7단계 작업 3)을 데모 로그인도 쓴다. 다른 사람으로 들어가는 것이므로 앞사람의 캐시를 버린다.
- "또는" 줄은 `before:`·`after:`로 양옆에 선을 긋는다. 가운데 열(`auto`)이 글자, 양쪽 열(`1fr`)이 선이다.
- form 안의 들여쓰기가 한 단계 깊어진다. 비밀번호 칸과 오류 문장은 내용은 그대로 두고 들여쓰기만 맞춘다.

#### 확인

```sh
# API를 다시 띄운다(.env를 바꿨으므로). 저장소 루트에서
npm run dev:api
curl -s localhost:4000/auth/demo
{"enabled":true}

curl -s -X POST localhost:4000/auth/demo -H 'Content-Type: application/json' -d '{"as":"admin"}'
{"accessToken":"eyJ..."}
```

화면(`npm run dev:web`)의 `/login`에 "데모로 둘러보기"와 두 버튼이 보이고, "관리자로"를 누르면 상점으로 간다.

### 개념 | 데모 로그인을 서버 경로로 둔 이유

- 비밀번호를 화면에 두지 않는다: 화면이 데모 계정의 비밀번호로 로그인하게 만들면, 그 비밀번호가 브라우저 코드에 그대로 실린다. 서버가 "데모 계정으로 토큰을 준다"는 경로를 따로 갖는다.

- 환경 변수로 켜고 끈다: 운영 compose의 기본값은 꺼짐(`DEMO_LOGIN=0`)이다. 꺼져 있으면 404를 돌려주고 화면은 버튼을 보이지 않는다.

- 토큰과 refresh 쿠키는 비밀번호 로그인과 똑같다(`issueTokens`): 데모라고 다른 길로 인증하지 않는다.

- `demoEnabled()`는 요청마다 `process.env`를 읽는다. 그래서 테스트가 실행 중에 `process.env.DEMO_LOGIN`을 바꿔 켜짐과 꺼짐을 모두 확인할 수 있다(작업 2).

### 작업 2. [커밋] 데모 로그인 e2e

켜짐·꺼짐과 두 계정, 잘못된 값을 백엔드 e2e로 확인한다. 새 파일이다.

```ts
// order-api-nest/test/demo-login.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { adminDb } from "./admin-db.js";

// 데모 로그인 - DEMO_LOGIN=1일 때만 열리고, 일반은 lee·관리자는 kim으로 들어간다
describe("데모 로그인", () => {
  let app: INestApplication;
  let baseUrl: string;
  const before = process.env.DEMO_LOGIN;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.use(cookieParser());
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
  });

  afterAll(async () => {
    process.env.DEMO_LOGIN = before;
    await app.close();
    await adminDb.$disconnect();
  });

  const demo = (as: string) =>
    fetch(`${baseUrl}/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) });
  const roleOf = async (res: Response) => {
    const { accessToken } = (await res.json()) as { accessToken: string };
    return app.get(JwtService, { strict: false }).decode<{ sub: string; role: string }>(accessToken);
  };

  it("꺼져 있으면 404이고, 화면에도 꺼져 있다고 알린다", async () => {
    process.env.DEMO_LOGIN = "0";
    expect((await demo("admin")).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/auth/demo`)).json()).toEqual({ enabled: false });
  });

  it("켜져 있으면 일반은 lee, 관리자는 kim으로 들어가고 refresh 쿠키도 받는다", async () => {
    process.env.DEMO_LOGIN = "1";
    expect(await (await fetch(`${baseUrl}/auth/demo`)).json()).toEqual({ enabled: true });

    const user = await demo("user");
    expect(user.status).toBe(200);
    expect(user.headers.get("set-cookie")).toMatch(/^refresh_token=/);
    expect(await roleOf(user)).toMatchObject({ sub: "lee", role: "user" });

    expect(await roleOf(await demo("admin"))).toMatchObject({ sub: "kim", role: "admin" });
  });

  it("정해진 두 값 말고는 400", async () => {
    process.env.DEMO_LOGIN = "1";
    expect((await demo("root")).status).toBe(400);
  });
});
```

- `process.env.DEMO_LOGIN`을 테스트 안에서 바꾼다. `demoEnabled()`가 요청마다 환경 변수를 읽기 때문에 가능하다. `afterAll`에서 원래 값으로 돌려놓는다.

- `beforeEach`에서 사용자 두 명만 다시 만든다. 다른 테스트 파일이 남긴 데이터에 기대지 않는다.

- `decode`는 서명을 확인하지 않고 payload만 읽는다. 테스트에서 토큰에 담긴 역할을 보는 데만 쓴다.

#### 확인

```sh
# 저장소 루트에서
npm run test:api
```

백엔드 테스트가 셋 늘어 모두 통과한다(꺼짐 404, 켜짐 lee·kim, 잘못된 값 400).

### 작업 3. [커밋] 장바구니 페이지

상점 화면의 장바구니 칸(`CartPanel`: 합계, 결제 버튼, 결제 오류 안내)을 자기 페이지로 옮긴다. 새 파일이다. 상점 화면에서 칸을 빼는 것은 작업 4에서 한다.

```tsx
// order-console-next/app/cart/page.tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";
import { useTRPC } from "@/lib/trpc";
import { useOnline } from "../online-banner";
import { Stepper } from "../shop/stepper";

// 결제를 누르면 주문(결제 대기)과 Stripe 결제 화면 주소가 온다
type CheckoutResult = { id: number; price: number; checkoutUrl: string };

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

// 장바구니 페이지. 머리글의 "장바구니 N"이 여기로 온다. 수량 조절·빼기·합계·결제를 한곳에서
export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const online = useOnline(); // 오프라인이면 결제를 막는다 - 결제 요청은 서비스 워커가 저장해 둘 수 없다
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  // 수량 상한(재고)을 알기 위해 상품 목록을 본다 - 상점에서 받아 둔 것이 있으면 캐시를 그대로 쓴다
  const { data: products } = useQuery(trpc.products.list.queryOptions());
  const stockOf = (productId: number) => products?.find((p) => p.id === productId)?.stock ?? Infinity;

  // useMutation : 서버의 데이터를 바꾸는 요청. 진행 중/성공/실패 상태를 대신 관리해 준다
  const checkout = useMutation({
    mutationFn: () => {
      const key = useCartStore.getState().beginCheckout();
      return authFetch<CheckoutResult>("/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }),
      });
    },
    onSuccess: (data) => {
      // 주문이 만들어지고 재고가 예약됐다 → 장바구니를 비우고 Stripe 결제 화면으로 간다
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
      window.location.assign(data.checkoutUrl); // 다른 사이트로 가는 이동이라 Next의 router가 아니라 브라우저 이동을 쓴다
    },
  });

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">장바구니</h1>
      {items.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-muted">
          <span className="mb-1 block font-serif font-normal text-fg">비어 있습니다</span>
          <Link href="/shop">상품</Link>에서 담으면 여기에 모입니다.
        </p>
      ) : (
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ul className="border-t border-line">
            {items.map((i) => (
              <li key={i.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto_7rem]">
                <div className="min-w-0">
                  <p className="font-normal">{i.name}</p>
                  <p className="num text-[0.8rem] text-muted">{won(i.price)}</p>
                </div>
                <span className="num text-right sm:order-last">{won(i.price * i.quantity)}</span>
                <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                  <Stepper productId={i.productId} name={i.name} quantity={i.quantity} max={stockOf(i.productId)} />
                  <button type="button" className="link-quiet" onClick={() => remove(i.productId)}>빼기</button>
                </span>
              </li>
            ))}
          </ul>
          <aside aria-label="결제" className="lg:sticky lg:top-6">
            <p className="mb-5 flex items-baseline justify-between">
              <span className="label">합계</span>
              <span className="num text-xl font-normal">{won(total)}</span>
            </p>
            <button type="button" className="btn btn-primary w-full" disabled={checkout.isPending || !online} onClick={() => checkout.mutate()}>
              {checkout.isPending ? "결제 화면을 여는 중…" : "결제하기"}
            </button>
            <p className="mt-3 text-[0.78rem] text-muted">
              {online ? "결제는 Stripe 화면에서 이어집니다. 24시간 안에 결제하지 않으면 주문이 취소됩니다." : "연결되면 결제할 수 있습니다."}
            </p>
          </aside>
        </div>
      )}
      {checkout.isSuccess && <p role="status" className="mt-4 text-sm">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중입니다.</p>}
      {checkout.error && (
        <p role="alert" className="alert mt-4">
          결제를 시작하지 못했습니다: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> - <Link href="/login">로그인</Link>해 주세요.</>}
        </p>
      )}
    </main>
  );
}
```

`CartPanel`과 비교하면 이렇다.

| | 상점의 `CartPanel` | 장바구니 페이지 |
|---|---|---|
| 수량 | `이름 × 2` 글자 | 수량 조절기(`Stepper`, 5단계 작업 3). 상한은 상품 목록의 재고 |
| 결제 버튼 | "결제" | "결제하기", 아래에 24시간 안내 |
| 오류 문구 | "결제 실패: …" | "결제를 시작하지 못했습니다: …" |
| 비었을 때 | "비어 있습니다" | 상품 화면으로 가는 링크까지 |

- 재고 상한을 알려고 상점과 같은 `products.list` 쿼리를 쓴다. 상점에서 받아 둔 캐시가 있으면 요청 없이 그대로 나온다.
- `lg:grid-cols-[minmax(0,1fr)_300px]`: 넓은 화면에서는 목록 오른쪽에 결제 칸을 두고, `lg:sticky`로 스크롤해도 따라오게 한다. 좁으면 아래로 내려간다.

#### 확인

머리글의 링크는 작업 5에서 바꾸므로, 지금은 주소창에 `/cart`를 직접 친다. 상점에서 담은 상품이 보이고, `+`·`−`로 금액이 바뀌고, "결제하기"를 누르면 Stripe 화면으로 간다.

### 작업 4. [커밋] 상점 화면: 담으면 그 자리가 수량 조절기

상점 화면(`app/shop/page.tsx`)은 바뀌는 곳이 많아 파일 전체를 바꾼다.

| | 지금 | 바꾼 뒤 |
|---|---|---|
| 장바구니 | 목록 아래 `CartPanel` | 없다(작업 3의 `/cart`). 휴대폰 폭에서만 화면 아래에 합계 줄(`CartDock`) |
| 담기 | 누를 때마다 1개씩 | 처음 한 번 "담기", 그다음부터 그 자리가 수량 조절기. 담으면 "마우스를 담았습니다" 안내 |
| 이미지 바꾸기 | 관리자에게 상품 줄마다 | 없다(작업 6의 관리자 페이지) |
| 상품 줄 | 글자 한 줄 | 이미지(없으면 첫 글자) · 이름·가격·재고 · 버튼의 세 칸 |

그대로 두는 것: `ProductSkeleton`과 `CheckoutNotice`(5단계 작업 4)는 아래 코드에 그대로 있다.

```tsx
// order-console-next/app/shop/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useCartStore } from "@/lib/cart-store";
import { useTRPC } from "@/lib/trpc";
import { Stepper } from "./stepper";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
// 받침이 있으면 "을", 없으면 "를"(한글 음절의 마지막 소리로 판단). 한글이 아니면 "을(를)"
function eulReul(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 === 0 ? "를" : "을";
}

// 불러오는 동안에는 자리만 회색 면으로 보여 준다 - 다 불러왔을 때 화면이 덜컥 밀리지 않게
function ProductSkeleton() {
  return (
    <div aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-line py-4">
          <span className="size-16 bg-surface" />
          <span className="grid gap-2"><span className="h-3 w-2/5 bg-surface" /><span className="h-3 w-1/4 bg-surface" /></span>
        </div>
      ))}
      <p role="status" className="mt-4 text-sm text-muted">상품을 불러오는 중입니다.</p>
    </div>
  );
}

// 담은 직후 잠깐 보이는 안내. role="status"라 낭독기도 읽는다. 3초 뒤 사라진다
function AddedToast({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [name, onDone]);
  return (
    <p role="status" className="sticky bottom-4 ml-auto mt-6 w-fit max-w-full bg-fg px-4 py-3 text-sm text-bg">
      {name}{eulReul(name)} 담았습니다. <Link href="/cart" className="ml-3 text-bg">장바구니 보기</Link>
    </p>
  );
}

function ProductList() {
  const trpc = useTRPC();
  // queryKey는 프로시저 이름에서 만들어진다(products.list). 상품 타입을 프론트에서 따로 적지 않는다
  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
  const add = useCartStore((s) => s.add);
  const inCart = useCartStore((s) => s.items);
  const [added, setAdded] = useState<string | null>(null);
  const clearAdded = useCallback(() => setAdded(null), []); // 다시 그려질 때마다 새 함수가 되면 안내의 타이머가 다시 걸린다

  if (isPending) return <ProductSkeleton />;
  if (error)
    return (
      <p role="alert" className="alert">
        상품을 불러오지 못했습니다.
        <span className="block text-sm text-muted">잠시 뒤 새로 고침해 주세요. ({error.message})</span>
      </p>
    );
  return (
    <>
      <ul className="border-t border-line">
        {data.map((p) => {
          const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
          const soldOut = p.stock === 0;
          return (
            <li key={p.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4">
              {p.imageUrl ? (
                // next/image는 서버가 이미지를 다시 받아 최적화하는데, 서명이 바뀔 때마다 다른 URL이 되어 캐시가 쌓인다 → 그냥 img를 쓴다
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} width={64} height={64} className="size-16 object-cover" data-testid={`image-${p.id}`} />
              ) : (
                <span aria-hidden="true" className="grid size-16 place-items-center bg-surface font-serif text-xl text-faint">{p.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <p className="font-normal">{p.name}</p>
                <p className="flex flex-wrap gap-x-3 text-[0.8rem] text-muted">
                  <span className="num">{won(p.price)}</span>
                  {soldOut ? <span className="text-fg">품절</span> : <span>재고 <span className="num" data-testid={`stock-${p.id}`}>{p.stock}</span></span>}
                </p>
              </div>
              {/* 처음에는 "담기", 한 번 담으면 같은 자리가 수량 조절기로 바뀐다 */}
              {soldOut ? (
                <button type="button" className="btn" disabled>품절</button>
              ) : quantity > 0 ? (
                <Stepper productId={p.id} name={p.name} quantity={quantity} max={p.stock} />
              ) : (
                <button type="button" className="btn" onClick={() => { add({ productId: p.id, name: p.name, price: p.price }); setAdded(p.name); }}>
                  담기
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {added && <AddedToast name={added} onDone={clearAdded} />}
    </>
  );
}

// 휴대폰 폭에서는 화면 아래에 합계를 붙여 두고, 누르면 장바구니 페이지로 간다
function CartDock() {
  const items = useCartStore((s) => s.items);
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className="sticky bottom-0 border-t border-line-strong bg-bg py-3 sm:hidden">
      <div className="page flex items-center justify-between gap-3">
        <span className="text-sm"><span className="label">장바구니 <span className="num">{count}</span></span><br /><span className="num">{won(total)}</span></span>
        <Link href="/cart" className="btn no-underline">장바구니 보기</Link>
      </div>
    </div>
  );
}

// Stripe 화면에서 취소하고 돌아왔다(/shop?checkout=canceled&order=8). 주문이 어떻게 되는지 알려 준다
function CheckoutNotice() {
  const params = useSearchParams();
  if (params.get("checkout") !== "canceled") return null;
  const order = params.get("order");
  return (
    <p role="status" className="note mb-8">
      결제를 취소했습니다. {order ? <>주문 <Link href={`/me/orders/${order}`}>#{order}</Link>은</> : "방금 만든 주문은"} 결제 대기로 남아 있다가 24시간이 지나면
      자동으로 취소되고, 담았던 수량은 재고로 돌아갑니다.
    </p>
  );
}

export default function ShopPage() {
  return (
    <>
      <main className="page flex-1 pb-12 pt-2">
        {/* useSearchParams를 쓰는 부분은 Suspense로 감싼다. 쿼리는 요청이 와야 알 수 있어서, 페이지를 빌드 때 미리 그린다면 이 경계가 없을 때 빌드가 실패한다. 지금은 루트 layout의 connection()으로 요청마다 그려서 실패하지 않지만, 그 전제에 기대지 않으려고 경계를 둔다 */}
        <Suspense><CheckoutNotice /></Suspense>
        <h1 className="title mb-8">상품</h1>
        <section aria-label="상품 목록"><ProductList /></section>
      </main>
      <CartDock />
    </>
  );
}
```

- `inCart`에서 이 상품의 수량을 찾아, 0이면 "담기", 1 이상이면 `Stepper`를 그린다. 수량 조절기에서 0이 되면 장바구니에서 빠지므로 다시 "담기"로 돌아간다.
- 품절(`stock === 0`)이면 비활성 "품절" 버튼만 둔다.
- `CartDock`의 `sm:hidden`: 넓은 화면에서는 머리글의 "장바구니 N"으로 충분하므로 휴대폰 폭에서만 보인다.
- `ShopPage`가 `<main>` 밖에 `CartDock`을 둔다. `sticky bottom-0`이 본문 끝까지 화면 아래에 붙어 있게 하려는 것이다.

이 파일은 이제 `ProductImageUploader`를 쓰지 않는다. `app/shop/product-image-uploader.tsx`는 지우지 말고 둔다. 작업 6에서 관리자 페이지 폴더로 옮긴다.

담았다는 안내는 3초 뒤 사라진다. 조사(을/를)는 상품 이름의 마지막 글자에 받침이 있는지로 고른다. 아래 두 개념에서 다룬다.

#### 확인

`/shop`에서 "담기"를 누르면 그 자리가 `- 1 +`로 바뀌고 아래에 안내가 뜬다. 휴대폰 폭(390)으로 바꾸면 화면 아래에 합계 줄이 붙는다.

### 개념 | 안내를 닫는 함수는 한 번만 만든다

`AddedToast`의 `useEffect`는 의존성 배열의 `onDone`이 바뀔 때마다 앞의 타이머를 지우고(`clearTimeout`) 새로 건다.

`ProductList`가 `onDone={() => setAdded(null)}`처럼 그릴 때마다 새 함수를 넘기면, 함수의 내용이 같아도 참조가 달라 "바뀌었다"로 본다.

수량을 조절하면 `inCart`가 바뀌어 `ProductList`가 다시 그려진다. 그때마다 타이머가 처음부터 다시 걸려, 계속 조절하는 동안 안내가 사라지지 않는다.

`useCallback(() => setAdded(null), [])`은 처음 만든 함수를 계속 같은 참조로 돌려준다. 그래서 타이머는 담은 순간(`name`이 바뀐 때)에만 새로 걸린다.

### 개념 | 받침으로 조사 고르기

한글 완성형 음절은 유니코드에서 `가`(`0xAC00`)부터 `힣`(`0xD7A3`)까지, 11172자가 규칙대로 놓여 있다.

`(글자 코드 - 0xAC00)`은 `(초성 번호 × 21 + 중성 번호) × 28 + 종성 번호`다. 종성(받침) 자리는 28가지이고, 받침이 없으면 0이다.

| 단어 | 마지막 글자 | `% 28` | 고른 조사 |
|---|---|---|---|
| 마우스 | 스 | 0 | 를 |
| 한정판 키보드 | 드 | 0 | 를 |
| 무선 헤드폰 | 폰 | 0이 아님 | 을 |

`11171`은 `0xD7A3 - 0xAC00`이다. 이 범위 밖(영문, 숫자)이면 받침을 알 수 없으므로 "을(를)"로 둔다.

### 작업 5. [커밋] 머리글: 관리 메뉴와 장바구니 링크

| | 지금 | 바꾼 뒤 |
|---|---|---|
| 겉모양 | `<nav>` 하나에 링크를 늘어놓았다 | `<header>` 안에 왼쪽 "주문 콘솔", 오른쪽 메뉴 |
| 관리 | 없다 | 관리자에게만 "관리"(`/admin/products`, 작업 6) |
| 장바구니 N | 글자(`<span>`) | `/cart`로 가는 링크 |
| 로그아웃·로그인 | 모양 없는 버튼과 `Link` | 메뉴와 같은 글자 모양 |

```diff
 // order-console-next/app/nav.tsx
 import { logout } from "@/lib/api-client";
 import { useAuthStore } from "@/lib/auth-store";
 import { useCartStore } from "@/lib/cart-store";
+import { useIsAdmin } from "@/lib/use-profile";

 // ... NavLink 그대로 ...

 export function Nav() {
   const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
   const router = useRouter();
   const queryClient = useQueryClient();
   const loggedIn = useAuthStore((s) => s.accessToken !== null);
+  const isAdmin = useIsAdmin();

   return (
-    <nav className="flex gap-3">
-      <NavLink href="/shop">상품</NavLink>
-      <NavLink href="/me/orders">내 주문</NavLink>
-      <span data-testid="cart-count">장바구니 {cartCount}</span>
-      {loggedIn ? (
-        <button onClick={async () => {
-          await logout();
-          queryClient.clear();
-          router.push("/login");
-        }}>로그아웃</button>
-      ) : (
-        <Link href="/login">로그인</Link>
-      )}
-    </nav>
+    <header className="page flex flex-wrap items-baseline gap-x-6 gap-y-2 py-4 sm:py-6">
+      <Link href="/shop" className="mr-auto font-serif text-base no-underline">주문 콘솔</Link>
+      <nav aria-label="주요 메뉴" className="flex items-baseline gap-5">
+        <NavLink href="/shop">상품</NavLink>
+        <NavLink href="/me/orders">내 주문</NavLink>
+        {/* 관리자에게만 보인다. 막는 것은 서버다 - 다른 사람이 주소를 직접 열어도 API가 403 */}
+        {isAdmin && <NavLink href="/admin/products">관리</NavLink>}
+        {/* 장바구니는 자기 페이지가 있다. 개수는 어느 화면에서든 보인다 */}
+        <NavLink href="/cart" testId="cart-count">장바구니 <span className="num">{cartCount}</span></NavLink>
+        {loggedIn ? (
+          <button type="button" className="text-sm text-muted cursor-pointer" onClick={async () => {
+            await logout();
+            // 받아 둔 데이터(내 주문, 프로필)를 모두 버린다. 남겨 두면 같은 탭에서 다음에 로그인한 사람에게 잠깐 보인다
+            queryClient.clear();
+            router.push("/login");
+          }}>
+            로그아웃
+          </button>
+        ) : (
+          <NavLink href="/login">로그인</NavLink>
+        )}
+      </nav>
+    </header>
   );
 }
```

- `<header>`가 바깥, `<nav>`가 메뉴만 감싼다. "주문 콘솔"은 사이트 이름이라 메뉴가 아니다. `aria-label="주요 메뉴"`는 화면 낭독기가 랜드마크 이름으로 읽는다.
- `mr-auto`: 사이트 이름이 오른쪽 여백을 모두 가져가 메뉴가 오른쪽 끝으로 밀린다.
- `testId="cart-count"`: e2e가 쓰던 `data-testid`를 링크로 옮긴다. 5단계 작업 1에서 `NavLink`에 `testId`를 받아 둔 이유다.
- `className="page …"`: 본문과 같은 가운데 상자라, 머리글과 본문의 양 끝이 같은 선에 맞는다(아래 "넓은 화면: 오른쪽만 비어 보인다").

#### 확인

`kim`으로 로그인하면 "관리"가 보이고, `lee`로 로그인하면 없다. "장바구니 N"을 누르면 `/cart`로 간다. "관리"는 작업 6 전에는 404 화면이다.

### 작업 6. [커밋] 관리자 페이지

#### 업로더를 관리자 페이지 폴더로 옮긴다

```sh
# order-console-next 폴더에서
mkdir -p app/admin/products
git mv app/shop/product-image-uploader.tsx app/admin/products/product-image-uploader.tsx
```

`git mv`로 옮기면 기록이 이어진다. 업로드 흐름(URL 받기 → 저장소에 PUT → 확인)은 그대로 두고, 표 안에 들어갈 버튼 모양으로 바꾼다.

```diff
 // order-console-next/app/admin/products/product-image-uploader.tsx
-export function ProductImageUploader({ productId }: { productId: number }) {
+// 상품 이미지 올리기: ① 우리 서버에서 업로드 URL 받기 → ② 저장소에 직접 PUT → ③ 우리 서버에 확인 요청
+export function ProductImageUploader({ productId, hasImage }: { productId: number; hasImage: boolean }) {
   const trpc = useTRPC();
   const queryClient = useQueryClient();
   const upload = useMutation({
     // ... 그대로 ...
   });

+  // 파일 입력은 화면에서 숨기고 버튼처럼 보이는 label로 연다 - 키보드로도 열린다
   return (
-    <label>
-      {" "}이미지 바꾸기{" "}
-      <input
-        type="file"
-        accept="image/png,image/jpeg,image/webp"
-        data-testid={`image-input-${productId}`}
-        disabled={upload.isPending}
-        onChange={(e) => {
-          const file = e.target.files?.[0];
-          if (file) upload.mutate(file);
-          e.target.value = "";
-        }}
-      />
-      {upload.isPending && " 올리는 중..."}
-      {upload.error && <span data-testid={`image-error-${productId}`}> {upload.error.message}</span>}
-    </label>
+    <span className="flex flex-wrap items-center gap-2">
+      <label className="btn focus-within:outline-2 focus-within:outline-fg">
+        {upload.isPending ? "올리는 중…" : hasImage ? "바꾸기" : "올리기"}
+        <input
+          type="file"
+          className="sr-only"
+          // accept는 파일 선택 창의 "기본 필터"일 뿐이다 - 사용자가 바꿀 수 있으므로 검증은 서버가 한다
+          accept="image/png,image/jpeg,image/webp"
+          data-testid={`image-input-${productId}`}
+          disabled={upload.isPending}
+          onChange={(e) => {
+            const file = e.target.files?.[0];
+            if (file) upload.mutate(file);
+            e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 오게 비운다
+          }}
+        />
+      </label>
+      {upload.error && <span role="alert" className="text-[0.82rem] text-danger" data-testid={`image-error-${productId}`}>{upload.error.message}</span>}
+    </span>
   );
 }
```

- `sr-only`: 파일 칸을 화면에서는 숨기되 화면 낭독기와 키보드에는 남긴다. `display: none`으로 숨기면 키보드로 열 수 없다.
- `label`이 칸을 감싸므로 버튼처럼 보이는 글자를 눌러도 파일 선택 창이 열린다. `focus-within:`은 안의 칸에 키보드 포커스가 오면 테두리를 그린다.
- `data-testid`(`image-input-*`, `image-error-*`)는 그대로 둔다. 업로드 e2e가 이 이름으로 찾는다.

#### 관리자 페이지(새 파일)

```tsx
// order-console-next/app/admin/products/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc";
import { ProductImageUploader } from "./product-image-uploader";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function ProductTable() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
  if (isPending) return <p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">상품을 불러오지 못했습니다. ({error.message})</p>;
  // 표: 상품·가격·재고·이미지. 휴대폰 폭에서는 가격·재고를 숨기고 상품과 이미지만
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line-strong">
          <th scope="col" className="label py-3 font-normal">상품</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">가격</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">재고</th>
          <th scope="col" className="label py-3 font-normal">이미지</th>
        </tr>
      </thead>
      <tbody>
        {data.map((p) => (
          <tr key={p.id} className="border-b border-line">
            <td className="py-3">
              <span className="flex items-center gap-3">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" width={36} height={36} className="size-9 object-cover" data-testid={`image-${p.id}`} />
                ) : (
                  <span aria-hidden="true" className="grid size-9 place-items-center bg-surface font-serif text-sm text-faint">{p.name.slice(0, 1)}</span>
                )}
                {p.name}
              </span>
            </td>
            <td className="num hidden py-3 sm:table-cell">{won(p.price)}</td>
            <td className="num hidden py-3 sm:table-cell">{p.stock}</td>
            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 관리자 페이지. 화면은 관리자가 아니면 안내만 보인다 - 실제로 막는 것은 업로드 API의 AdminGuard다
export default function AdminProductsPage() {
  const trpc = useTRPC();
  // 메모리의 토큰만 보고 판단하지 않는다 - 주소를 직접 열거나 새로고침하면 토큰이 없다. 일단 물으면 refresh 쿠키로 다시 받아 온다
  const { data: profile, isPending, error } = useQuery({ ...trpc.me.profile.queryOptions(), retry: false });
  let body;
  if (isPending) body = <p role="status" className="text-sm text-muted">확인하는 중입니다.</p>;
  else if (error?.data?.code === "UNAUTHORIZED") body = <p className="note">관리자 계정으로 <Link href="/login">로그인</Link>해 주세요.</p>;
  else if (error) body = <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
  else if (profile.role !== "admin") body = <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
  else
    body = (
      <>
        <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
        <ProductTable />
      </>
    );
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">상품 관리</h1>
      {body}
    </main>
  );
}
```

- 화면에서 막는 것은 안내일 뿐이다. 실제로 막는 것은 업로드 API의 `AdminGuard`다(3단계).
- 프로필을 `useProfile()`이 아니라 `useQuery`로 직접 묻는다. 이유는 아래 "새로 연 페이지에는 액세스 토큰이 없다"에서 다룬다.
- 휴대폰 폭에서는 가격·재고 열을 숨긴다(`hidden sm:table-cell`).

#### 확인

`kim`으로 로그인해 "관리"를 누르면 표가 나오고, "올리기"로 이미지를 올리면 상점 화면에도 보인다. `lee`로 `/admin/products`를 직접 열면 "관리자만 볼 수 있는 화면입니다"가 나온다.

### 개념 | 새로 연 페이지에는 액세스 토큰이 없다

처음에는 머리글처럼 "메모리에 액세스 토큰이 있는가"로 로그인 여부를 판단했다.

그러면 관리자로 로그인한 뒤 주소창에서 `/admin/products`를 직접 열거나 새로고침할 때 "관리자 계정으로 로그인해 주세요"가 나온다.

`05`에서 액세스 토큰은 메모리에만 두기로 했으므로, **새로 연 페이지에는 토큰이 없다.** 일반 사용자가 주소로 직접 들어오는 e2e를 쓰다가 알아챘다.

다른 화면(내 주문)은 요청이 401을 받으면 refresh 쿠키로 토큰을 다시 받는다(`05`의 `fetchWithAuth`). 관리자 페이지도 판단하기 전에 일단 묻게 바꿨다.

`useProfile()`을 쓰지 않고 `useQuery`를 직접 부르는 이유도 여기에 있다. `useProfile()`은 메모리에 토큰이 없으면 묻지 않는다(`enabled: loggedIn`).

### 작업 7. [커밋] 새 화면에 맞춘 e2e

작업 4~6으로 깨진 e2e를 고치고, 새 화면의 e2e를 더한다.

| 화면에서 바뀐 것 | 테스트에서 바꿀 것 | 파일 |
|---|---|---|
| 결제는 장바구니 페이지에서 | "결제" 전에 `cart-count`(장바구니 링크)를 누른다 | `shop`, `stripe-payment` |
| 결제 오류 문구 | `/결제 실패/` → `/결제를 시작하지 못했습니다/` | `shop` |
| 두 번째 "담기"가 수량 조절기로 | 두 번째 클릭을 "마우스 수량 늘리기"로 | `shop` |
| 아이디 칸의 기본값이 없다 | 비밀번호 앞에 아이디도 채운다 | `shop`, `offline`, `stripe-payment`, `trpc`, `upload` |
| 오프라인 결제 잠금은 장바구니 페이지에서 | `/cart`를 미리 열어 캐시에 넣고, 오프라인에서 `/cart`로 간다 | `offline` |
| 이미지 올리기는 관리자 페이지에서 | 관리 메뉴나 `/admin/products`로 간다. "관리자에게만" 테스트를 메뉴·페이지 기준으로 | `upload` |
| 수량 조절기, 데모 로그인 | 새 테스트 | `cart-quantity`, `demo-login`(새 파일) |

#### 아이디도 채운다(다섯 파일)

```diff
 // order-console-next/e2e/shop.spec.ts (upload.spec.ts의 loginAsKim도 같다)
 async function loginAsKim(page: Page) {
   await page.goto("/login");
+  await page.getByLabel("아이디").fill("kim"); // 아이디 칸에 기본값이 없다
   await page.getByLabel("비밀번호").fill("1234");
```

`offline.spec.ts`(둘째 테스트), `stripe-payment.spec.ts`, `trpc.spec.ts`는 테스트 안의 `getByLabel("비밀번호")` 줄 앞에 같은 한 줄을 넣는다.

#### `shop.spec.ts`

```diff
 // order-console-next/e2e/shop.spec.ts
 // "장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다"
   const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
   await mouse.getByRole("button", { name: "담기" }).click();
-  await mouse.getByRole("button", { name: "담기" }).click();
+  await mouse.getByRole("button", { name: "마우스 수량 늘리기" }).click(); // 담으면 그 자리가 수량 조절기가 된다
   await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");

 // "결제를 누르면 재고를 예약하고 Stripe 결제 화면으로 간다"
   await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
+  await page.getByTestId("cart-count").click(); // 결제는 장바구니 페이지에서
   await Promise.all([

 // "결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다"
   await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
+  await page.getByTestId("cart-count").click();
   await page.getByRole("button", { name: "결제" }).click();
-  await expect(page.getByText(/결제 실패/)).toBeVisible();
+  await expect(page.getByText(/결제를 시작하지 못했습니다/)).toBeVisible(); // role="alert"는 Next의 경로 안내 영역에도 있어서 글자로 찾는다
```

`getByRole("button", { name: "결제" })`는 그대로 둔다. 이름 찾기는 기본으로 부분 일치라 "결제하기"도 찾는다.

#### `stripe-payment.spec.ts`

```diff
 // order-console-next/e2e/stripe-payment.spec.ts
   await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
+  await page.getByTestId("cart-count").click(); // 결제는 장바구니 페이지에서
   await Promise.all([page.waitForURL(/^https:\/\/checkout\.stripe\.com\//), page.getByRole("button", { name: "결제" }).click()]);
```

#### `offline.spec.ts`

```diff
 // order-console-next/e2e/offline.spec.ts
 // "오프라인에서도 한 번 본 상품 목록이 보이고, 결제는 막힌다"
   await page.goto("/shop");
   await waitForController(page);
   await expect(page.getByText("한정판 키보드")).toBeVisible();
+  await page.goto("/cart"); // 장바구니 페이지도 온라인일 때 한 번 열어 캐시에 넣는다
+  await expect(page.getByRole("heading", { name: "장바구니" })).toBeVisible();
+  await page.goto("/shop");

   await context.setOffline(true);
   try {
     // ...
     await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
+    await page.goto("/cart"); // 페이지(HTML)는 캐시에서, 장바구니는 localStorage에서
     await expect(page.getByRole("button", { name: "결제" })).toBeDisabled();
```

오프라인에서는 서비스 워커가 캐시해 둔 페이지만 열린다. `/cart`를 온라인일 때 한 번도 열지 않았다면 오프라인에서 열리지 않는다.

#### `upload.spec.ts`

```diff
 // order-console-next/e2e/upload.spec.ts
 test("이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다", async ({ page }) => {
   await loginAsKim(page);
+  await page.getByRole("link", { name: "관리" }).click(); // 이미지는 관리자 페이지에서 올린다
   const storagePut = page.waitForResponse(/* ... */);
   // ...
-  const img = page.getByTestId("image-2");
+  const img = page.getByTestId("image-2").filter({ visible: true }); // 상점 화면도 숨겨진 채 DOM에 남아 있다(cacheComponents의 Activity)

 test("이미지가 아닌 파일은 확장자가 .png여도 거절된다", async ({ page }) => {
   await loginAsKim(page);
+  await page.goto("/admin/products");
   await page.getByTestId("image-input-2").setInputFiles({

-test("이미지 바꾸기는 관리자에게만 보인다", async ({ page }) => {
-  await loginAsKim(page);
-  await expect(page.getByText("이미지 바꾸기")).toHaveCount(4);
+test("관리 메뉴와 관리자 페이지는 관리자에게만", async ({ page }) => {
+  await loginAsKim(page); // 시드의 kim은 관리자
+  await expect(page.getByRole("link", { name: "관리" })).toBeVisible();

+  // 일반 사용자(lee)로 다시 로그인하면 메뉴가 없고, 주소로 직접 와도 표가 보이지 않는다(서버도 403으로 막는다 - 백엔드 e2e)
   await page.getByRole("button", { name: "로그아웃" }).click();
   await expect(page).toHaveURL(/\/login$/);
   await page.getByLabel("아이디").fill("lee");
   await page.getByLabel("비밀번호").fill("1234");
   await page.getByRole("button", { name: "로그인", exact: true }).click();
   await expect(page).toHaveURL(/\/shop$/);
-  await expect(page.getByTestId("stock-1")).toBeVisible();
-  await expect(page.getByText("이미지 바꾸기")).toHaveCount(0);
+  await expect(page.getByRole("link", { name: "내 주문" })).toBeVisible();
+  await expect(page.getByRole("link", { name: "관리" })).toHaveCount(0);
+  await page.goto("/admin/products");
+  await expect(page.getByText("관리자만 볼 수 있는 화면입니다")).toBeVisible(); // 새로 연 페이지도 refresh 쿠키로 lee임을 안다
 });
```

`image-2`에 `.filter({ visible: true })`를 붙이는 이유: 이 테스트는 상점(`/shop`)에서 "관리"를 눌러 관리자 페이지로 간다. 이 프로젝트는 `cacheComponents: true`라서, Next.js가 떠난 페이지를 지우지 않고 React의 `<Activity>`로 숨겨(`display: none`) DOM에 남겨 둔다. 그러면 상점의 상품 이미지(`data-testid="image-2"`)와 관리자 표의 이미지가 둘 다 DOM에 있어서, `getByTestId`가 둘을 찾고 이렇게 실패한다.

```text
Error: strict mode violation: getByTestId('image-2') resolved to 2 elements:
    1) <img alt="" width="36" height="36" data-testid="image-2" …/> aka getByRole('cell', { name: '마우스' }).getByTestId('image-2')
    2) <img alt="마우스" width="64" height="64" data-testid="image-2" …/> aka getByAltText('마우스')
```

`getByRole`·`getByLabel`은 접근성 트리에서 찾으므로 숨겨진 요소를 알아서 뺀다. `getByTestId`나 `locator()`는 빼지 않으므로 `.filter({ visible: true })`로 보이는 것만 고른다(Next.js 문서 "Preserving UI state"의 Testing).

#### 수량 조절 e2e(새 파일)

```ts
// order-console-next/e2e/cart-quantity.spec.ts
import { expect, test } from "@playwright/test";

// 담으면 그 자리가 수량 조절기가 되고, 장바구니 페이지에서도 같은 조절기를 쓴다. 로그인하지 않아도 장바구니는 쓸 수 있다(localStorage)
test("담기 → 그 자리에서 수량 조절 → 0이 되면 다시 담기", async ({ page }) => {
  await page.goto("/shop");
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouse.getByRole("button", { name: "담기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "마우스를 담았습니다" })).toBeVisible();

  await mouse.getByRole("button", { name: "마우스 수량 늘리기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");

  await mouse.getByRole("button", { name: "마우스 수량 줄이기" }).click();
  await mouse.getByRole("button", { name: "마우스 수량 줄이기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 0");
  await expect(mouse.getByRole("button", { name: "담기" })).toBeVisible();
});

test("장바구니 페이지에서 수량을 바꾸면 금액이 따라오고, 빼면 비어 있다고 알린다", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole("button", { name: "마우스 수량 늘리기" }).click();
  await expect(page.getByRole("complementary", { name: "결제" })).toContainText("60,000원");
  await page.getByRole("button", { name: "빼기" }).click();
  await expect(page.getByText("비어 있습니다")).toBeVisible();
});

test("재고보다 많이 담을 수 없다", async ({ page }) => {
  await page.goto("/shop");
  const keyboard = page.getByRole("listitem").filter({ hasText: "한정판 키보드" });
  const stock = Number(await keyboard.getByTestId("stock-1").textContent());
  await keyboard.getByRole("button", { name: "담기" }).click();
  const plus = keyboard.getByRole("button", { name: "한정판 키보드 수량 늘리기" });
  for (let i = 1; i < stock; i++) await plus.click();
  await expect(page.getByTestId("cart-count")).toHaveText(`장바구니 ${stock}`);
  await expect(plus).toBeDisabled();
});

test("결제를 취소하고 돌아오면 남은 주문이 어떻게 되는지 알려 준다", async ({ page }) => {
  await page.goto("/shop?checkout=canceled&order=8");
  await expect(page.getByRole("status").filter({ hasText: "결제를 취소했습니다" })).toContainText("주문 #8은 결제 대기로 남아");
});
```

#### 데모 로그인 e2e(새 파일)

```ts
// order-console-next/e2e/demo-login.spec.ts
import { expect, test } from "@playwright/test";

// 데모로 둘러보기 - API가 DEMO_LOGIN=1(order-api-nest/.env)일 때 버튼이 보인다
test("데모 관리자로 들어가면 관리 메뉴가, 데모 사용자로 들어가면 없다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("link", { name: "관리" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("button", { name: "일반 사용자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("link", { name: "내 주문" })).toBeVisible();
  await expect(page.getByRole("link", { name: "관리" })).toHaveCount(0);
});
```

데모 버튼은 API가 `DEMO_LOGIN=1`일 때만 보인다. 작업 1에서 `order-api-nest/.env`에 넣었으므로 로컬과 CI 모두에서 돈다.

#### 확인

```sh
# 저장소 루트에서. API를 띄워 둔 채로
npm run test:web
 Test Files  1 passed (1)
      Tests  4 passed (4)
  1 skipped
  17 passed
```

e2e는 8파일 18개다. 실제 Stripe 결제 하나는 원래 건너뛴다. 여기까지 통과하면 푸시할 준비가 됐다. 푸시는 작업 8의 순서 3에서 한다.

### 개념 | 대조에서 하나 더: 한글 줄바꿈

배포한 화면을 휴대폰 폭으로 보니 "데모 데이터는 매일 초기화됩니|다", "결제하지 않으면 주|문이"처럼 단어 중간에서 줄이 바뀌었다.

브라우저는 한글을 글자 단위로 끊을 수 있다고 본다. 본문에 어절 단위 줄바꿈을 건다.

코드는 5장 작업 2의 `body` 블록에 이미 넣었다.

```css
  /* 한글은 기본으로 글자 단위로 줄이 바뀐다("초기화됩니|다") → 어절 단위로 */
  word-break: keep-all;
  overflow-wrap: anywhere;
```

- `word-break: keep-all`: 한글·중국어·일본어를 글자가 아니라 어절(띄어쓰기) 단위로만 끊는다.

- `overflow-wrap: anywhere`: 한 줄에 들어가지 않는 아주 긴 단어(주소 등)는 넘치지 않게 어디서든 끊는다.

### 개념 | 넓은 화면: 오른쪽만 비어 보인다

배포한 화면을 넓은 모니터에서 보니 상품과 관리 페이지의 오른쪽 빈 공간이 너무 넓었다.

머리글은 화면 끝까지 퍼져 있는데, 본문은 왼쪽에 붙은 채 폭만 제한되어(`max-w-3xl`) 있었기 때문이다. 시안은 1280 폭으로만 그려서 드러나지 않았다.

보통의 해결은 두 가지다. 페이지 전체를 가운데 정렬된 최대 폭 상자에 넣거나, 넓어질수록 목록을 여러 열(카드 격자)로 바꾼다.

여백 방향을 그대로 지키려고 앞의 것만 했다.

머리글·본문·오프라인 띠·휴대폰 합계 줄이 모두 같은 상자를 쓴다. 띠처럼 배경이 화면 끝까지 가야 하는 것은 바깥은 그대로 두고 안쪽 글자만 상자에 넣는다.

코드는 5장 작업 3의 컴포넌트 클래스에 이미 넣었다. 각 화면의 `<main>`·`<header>`에 붙어 있던 `px-4 sm:px-8`과 `max-w-3xl`·`max-w-4xl`을 `page` 하나로 바꾼 것이다.

```css
  /* 모든 화면이 쓰는 가운데 상자. 넓은 화면에서는 빈 공간이 양쪽으로 나뉘고, 머리글과 본문의 양 끝이 같은 선에 맞는다 */
  .page { width: 100%; max-width: 880px; margin-inline: auto; padding-inline: 16px; }
  @media (min-width: 640px) { .page { padding-inline: 32px; } }
```

1440 폭에서 다시 보면 빈 공간이 양쪽으로 나뉘고, 로고·메뉴와 본문의 양 끝이 같은 선(가운데 816px)에 맞는다.

> 시안을 그릴 때는 가장 흔한 폭 하나가 아니라 좁은 폭, 흔한 폭, 아주 넓은 폭을 함께 보는 것이 좋다.

### 작업 8. [실행] 운영에 반영

로컬에서 된 데모 로그인을 배포된 서비스(`https://shop.3-106-98-215.sslip.io`)에서도 켠다. 코드는 푸시하면 배포되지만, 코드 밖에 있는 두 가지는 손으로 맞춰야 한다.

| 무엇 | 어디에 있나 | 지금 | 맞추는 방법 |
|---|---|---|---|
| ① 데모를 켜는 값 `DEMO_LOGIN` | 서버의 `/opt/node-order/.env` | 없다. `compose.yml`의 `${DEMO_LOGIN:-0}` 때문에 꺼짐 | 순서 1에서 `DEMO_LOGIN=1`을 넣는다 |
| ② 데모 관리자 `kim`의 역할 | 운영 DB의 `users` | `user`. `18`에서 운영 DB에 시드를 넣을 때는 역할 열이 없었다 | 순서 2에서 SQL로 `admin`으로 바꾼다 |
| ③ 코드와 `deploy/compose.yml` | 저장소 | 작업 1~7에서 바꿨다 | 순서 3에서 푸시하면 배포된다 |

①을 빼먹으면 로그인 화면에 데모 버튼이 없고, ②를 빼먹으면 "관리자로" 들어가도 "관리" 메뉴가 없다.

순서는 ① → ② → ③이다. 그래서 작업 8은 **작업 7까지 로컬에만 커밋되어 있고 아직 푸시하지 않은 상태**에서 시작한다. ①·②를 먼저 해 두면 ③의 배포가 끝나는 순간 바로 동작한다.

①·②는 지금 운영에서 도는 이전 버전에 영향이 없다. 이전 버전의 `compose.yml`에는 `DEMO_LOGIN`을 api에 넘기는 줄이 없어서 `.env`에 값이 있어도 쓰이지 않고, `kim`이 관리자가 되어도 이전 버전에는 관리 메뉴가 없다. 그래서 푸시 전에 해 두어도 안전하다.

이미 푸시해서 배포까지 끝났다면, 그 배포의 api는 `DEMO_LOGIN` 없이 떠 있다. `.env`는 컨테이너를 만들 때만 읽히므로 ①·②를 한 뒤 api만 다시 만든다.

```sh
# 이 PC의 deploy/aws에서. 이미 푸시·배포한 경우에만
ssh -i .local/admin_ed25519 ubuntu@3.106.98.215 'cd /opt/node-order && docker compose up -d api'
```

`docker compose up -d`는 설정이 바뀐 서비스만 다시 만든다. `.env`의 `DEMO_LOGIN`이 바뀌어 api의 환경 변수가 달라졌으므로 api만 다시 만들어진다. 이 경우 순서 3은 건너뛴다.

#### 순서 1. 서버 `.env`에 `DEMO_LOGIN=1`

서버의 `.env`는 이 PC의 `deploy/aws/.local/server.env`가 원본이다. `18`의 `60-server-env.sh`는 이 원본 파일을 통째로 서버에 올린다. 그래서 두 곳에 똑같이 넣는다.

- **이 PC의 원본(`server.env`)**: 넣지 않으면, 나중에 `60-server-env.sh`를 다시 돌릴 때 서버 `.env`가 원본으로 덮여 `DEMO_LOGIN`이 사라진다.
- **서버의 `.env`**: 지금 바로 켜려면 서버에도 넣어야 한다. `60-server-env.sh`를 다시 돌려도 되지만, 그 스크립트는 AWS에서 IP·DB 주소를 다시 읽어 오느라 AWS 로그인이 필요하다. 한 줄만 더하는 일이라 SSH로 직접 넣는다.

```sh
# 이 PC, 저장소 루트에서 → SSH 키와 원본이 있는 폴더로
cd deploy/aws

# 이 PC의 원본에 한 줄
grep -q '^DEMO_LOGIN=' .local/server.env || echo 'DEMO_LOGIN=1' >> .local/server.env

# 서버의 .env에 같은 한 줄
ssh -i .local/admin_ed25519 ubuntu@3.106.98.215 \
  'cd /opt/node-order && (grep -q "^DEMO_LOGIN=" .env || echo "DEMO_LOGIN=1" >> .env) && grep "^DEMO_LOGIN=" .env'
DEMO_LOGIN=1
```

`grep -q '^DEMO_LOGIN=' … || echo … >>`는 "그 줄이 없을 때만 붙인다"는 뜻이다. 두 번 쳐도 줄이 겹치지 않는다. 마지막 `grep`은 서버에 실제로 들어갔는지 보여 준다.

#### 순서 2. 운영 DB의 `kim`을 관리자로

8단계 작업 2와 같은 방법이다. 운영자 계정 대신 데모 관리자 `kim`을 바꾼다.

```sh
# 이 PC의 deploy/aws에서
echo "UPDATE users SET role = 'admin' WHERE id = 'kim';" \
  | ssh -i .local/admin_ed25519 ubuntu@3.106.98.215 'cd /opt/node-order && docker compose run --rm -T migrate npx prisma db execute --stdin'
Script executed successfully.
```

`lee`는 데모 일반 사용자라 그대로 `user`로 둔다.

#### 순서 3. 푸시해서 배포

작업 7까지 커밋했으면 푸시한다. 배포 작업이 하는 일은 이렇다(8단계 작업 1과 같다).

1. 저장소의 `deploy/compose.yml`을 서버에 올린다. 이번에 더한 `DEMO_LOGIN: ${DEMO_LOGIN:-0}` 줄이 함께 간다.
2. 서버에서 `deploy.sh`를 돌린다. 새 이미지를 받고, `docker compose up -d`로 api 컨테이너를 다시 만든다.
3. 다시 만들어진 api가 `compose.yml`의 그 줄을 통해 순서 1의 `.env` 값 `DEMO_LOGIN=1`을 받는다.

GitHub Actions에서 배포 작업까지 초록인지 본다.

#### 확인

```sh
# 어디서든
curl -s https://api.3-106-98-215.sslip.io/auth/demo
{"enabled":true}
```

`{"enabled":false}`면 ①이 api까지 가지 않은 것이다. 서버 `.env`에 줄이 있는지, 배포가 끝났는지 본다.

브라우저로 `https://shop.3-106-98-215.sslip.io/login`을 연다.

- "데모로 둘러보기"와 두 버튼이 보인다.
- "관리자로"를 누르면 머리글에 "관리"가 있고, 관리자 페이지에서 이미지를 올릴 수 있다. "관리"가 없으면 ②를 확인한다.
- 로그아웃하고 "일반 사용자로"를 누르면 "관리"가 없다.

> 이제 링크를 받은 누구나 관리자 기능(이미지 올리기)을 쓸 수 있다. 화면에는 "데모 데이터는 매일 초기화됩니다"라고 적었지만, 매일 초기화하는 예약 작업은 이 문서에서 다루지 않는다(13장 "이 문서에서 다루지 않은 것"). 운영 DB에 시드를 다시 돌리면 GitHub로 로그인한 계정까지 모두 지워지므로 초기화 수단으로 쓰지 않는다. 예약 작업을 두기 전까지는 이 문구가 사실이 아니라는 점을 알고 공개한다.

### 남길 것

- **찾아보면 되는 것**: `@IsIn`의 문법, `useCallback`의 의존성 배열, Playwright의 `.filter({ visible: true })`, 한글 음절 코드 범위(`0xAC00`~`0xD7A3`), `word-break`·`overflow-wrap`의 값. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 테스트와 시안 대조를 통과해도, 링크를 받은 사람이 실제로 무엇을 할 수 있는지는 그 사람 입장에서 써 봐야 드러난다.

  - 비밀번호를 화면 코드에 두지 않는다. 시연용 진입은 서버가 환경 변수로 여닫는 경로로 만든다.

  - 액세스 토큰이 메모리에만 있으면 새로 연 페이지에는 토큰이 없다. "로그인했는가"는 일단 서버에 물어 refresh로 확인한다.

- **에러 신호**:

  - 로그인 화면에 데모 버튼이 없다, `GET /auth/demo`가 `{"enabled":false}` → API의 `DEMO_LOGIN`(운영은 서버 `.env`, 로컬은 `order-api-nest/.env`). `.env`는 컨테이너를 만들 때만 읽히므로, 바꾼 뒤 api를 다시 띄웠는지

  - `POST /auth/demo`가 404 `데모 계정이 없다 - 시드를 확인한다` → DB에 `kim`·`lee`가 있는지

  - `POST /auth/demo`가 400 `as must be one of the following values: user, admin` → 요청 본문의 `as`

  - 데모 관리자로 들어갔는데 "관리"가 없다 → 운영 DB의 `kim`이 아직 일반 사용자다(SQL로 바꾼다)

  - 관리자인데 새로고침하면 "관리자 계정으로 로그인해 주세요" → 메모리의 토큰만 보고 판단했는지(프로필을 물어 refresh로 토큰을 다시 받는다)

  - 한글이 단어 중간에서 줄바꿈된다 → `body`에 `word-break: keep-all`이 있는지

  - 넓은 화면에서 오른쪽만 비어 보인다 → 그 화면의 바깥 상자가 `page`인지

  - e2e `strict mode violation: getByTestId(…) resolved to 2 elements`(하나는 떠나온 페이지의 것) → 숨겨진 페이지가 DOM에 남아 있다(`cacheComponents`). `getByRole`을 쓰거나 `.filter({ visible: true })`

  - 수량을 조절하는 동안 "담았습니다" 안내가 사라지지 않는다 → `onDone`을 `useCallback`으로 만들었는지

## 11. 디버깅

화면 문제는 "클래스가 CSS로 만들어졌나 → 값이 무엇으로 풀렸나 → 데이터(역할)가 맞나" 순서로 가른다. 앞의 층이 맞아야 다음 층을 볼 의미가 있다.

### 진단 1. 클래스가 CSS로 만들어졌는지, 무슨 값으로 풀렸는지

개발자 도구에서 요소를 골라 콘솔에 친다. `$0`은 요소 탭에서 고른 요소다.

```js
getComputedStyle($0).color;                                        // 실제로 칠해진 색
getComputedStyle(document.documentElement).getPropertyValue("--muted"); // 지금 적용된 토큰 값
```

- 요소 탭의 스타일 칸에 `.text-muted` 규칙 자체가 없으면 클래스가 만들어지지 않은 것이다. `@theme inline`에 `--color-muted`가 있는지, 클래스 이름이 소스에 문자 그대로 있는지 본다.

- 규칙은 있는데 값이 부모 색과 같으면 `var()`의 이름이 틀렸다. 정의되지 않은 이름은 에러 없이 무시된다.

- 다크에서만 이상하면 개발자 도구의 렌더링 탭에서 `prefers-color-scheme: dark`를 흉내 내고 `--muted`를 다시 읽는다. 값이 그대로면 그 자리에 토큰이 아닌 색을 직접 쓴 것이다.

### 진단 2. 글꼴이 실제로 무엇으로 그려졌는지

8장 작업 1에서 쓴 방법 그대로다. Elements 탭에서 그 글자를 고르고, Computed 탭의 `font-family`·`font-weight`와 맨 아래 Rendered Fonts를 본다. 받아 둔 글꼴 목록은 콘솔에서 본다.

```js
[...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight);
```

- Rendered Fonts에 Noto가 있는데 모양이 다르면, 그 굵기를 받아 두지 않아 가장 가까운 굵기로 그린 것이다(명조는 400뿐).

- 처음 열 때 잠깐 다른 글꼴로 보였다 바뀌는 것은 정상이다. 글꼴 조각이 오기 전에는 대체 글꼴로 먼저 그린다(`display: swap`).

### 진단 3. 역할이 어디서 어긋났는지: 토큰, 프로필, DB

관리자인데 메뉴나 업로드가 안 될 때, 역할이 들어 있는 세 곳을 차례로 본다.

```sh
# 1) 토큰에 담긴 역할. kim으로 로그인해 액세스 토큰을 받는다
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | jq -r .accessToken)
# JWT의 가운데 조각(payload)을 풀어 본다. base64url이라 -, _를 +, /로 바꾼 뒤 디코딩한다
echo "$TOKEN" | jq -R 'split(".")[1] | gsub("-";"+") | gsub("_";"/") | @base64d | fromjson'
{
  "sub": "kim",
  "role": "admin",
  "iat": 1792108389,
  "exp": 1792109289
}
```

`jq`가 없으면 `brew install jq`로 설치한다. 터미널 대신 브라우저로 봐도 된다. 개발자 도구 Network 탭에서 `login` 요청의 응답에 있는 `accessToken`을 복사해 jwt.io에 붙이면 payload가 보인다(로컬 개발용 토큰만. 운영 토큰은 외부 사이트에 붙이지 않는다).

```sh
# 2) 화면이 쓰는 프로필(DB에서 읽는다). 응답의 role을 본다
curl -s localhost:4000/trpc/me.profile -H "Authorization: Bearer $TOKEN"
```

```sh
# 3) DB의 값(저장소 루트에서)
docker compose exec db psql -U order -d order_api -c "SELECT id, role FROM users ORDER BY id"
```

| DB | 프로필 | 토큰 | 뜻 |
|---|---|---|---|
| `admin` | `admin` | `role` 없음 또는 `user` | 역할을 바꾸기 전에 받은 토큰. 다시 로그인한다 |
| `admin` | `admin` | `admin`인데 403 | 가드 순서. `AuthGuard("jwt")`가 `AdminGuard`보다 앞인지 |
| `user` | `user` | `user` | 역할을 아직 바꾸지 않았다. 운영이면 9장의 SQL |

### 진단 4. 데모 로그인이 켜졌는지

```sh
curl -s localhost:4000/auth/demo
{"enabled":true}
```

`{"enabled":false}`면 API 프로세스가 `DEMO_LOGIN=1`을 못 받은 것이다. `.env`를 고친 뒤에는 API를 다시 띄워야 한다(`compose`라면 `up -d`로 컨테이너를 다시 만든다).

### 진단 5. 에러 신호 모아 보기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| 일반 사용자의 업로드 요청이 201, `AssertionError: expected 201 to be 403` | 관리자 가드가 없다 | `@UseGuards`에 `AdminGuard`(3단계) |
| 관리자도 `관리자만 할 수 있습니다`(403) | `req.user`가 채워지기 전에 가드가 돌았거나, 옛 토큰 | 가드 순서, 다시 로그인(3단계, 진단 3) |
| `Object literal may only specify known properties, and 'role' does not exist` | 생성된 Prisma 타입이 옛것이다 | `npx prisma generate`(3단계) |
| 백엔드 e2e만 `P2022`(열이 DB에 없다) | 테스트 DB에 마이그레이션을 안 했다 | `order_api_test`에 `migrate deploy`(3단계) |
| `text-muted`를 썼는데 색이 안 바뀐다 | 클래스가 만들어지지 않았다 | `@theme inline`의 `--color-muted`(4단계, 진단 1) |
| 다크 모드에서 일부만 밝게 남는다 | 토큰이 아닌 색을 직접 썼다 | 그 자리의 `bg-white`·`#fff`(4단계, 진단 1) |
| 유틸리티로 컴포넌트 클래스가 덮어써지지 않는다 | 규칙이 층 밖에 있다 | `@layer components`(4단계) |
| 색이 부모 색으로 조용히 돌아간다 | `var()` 이름이 틀렸다 | 토큰 이름(4단계, 진단 1) |
| `Property 'setQuantity' is missing` | store 타입에는 있는데 구현이 없다 | `create` 안의 구현, 두 곳의 이름 철자(5단계) |
| 이어 붙여 만든 클래스에 스타일이 안 먹는다 | Tailwind가 그 이름을 소스에서 못 찾았다 | 클래스 이름을 문자 그대로(5단계) |
| 휴대폰에서 긴 이름이 들어오면 격자가 넘친다 | 열이 내용의 최소 폭 아래로 줄지 않는다 | `1fr` → `minmax(0,1fr)`(5단계) |
| 새벽에 만든 주문의 날짜가 전날로 보인다 | UTC 날짜를 잘랐다 | `toLocaleDateString("ko-KR")`(5단계) |
| e2e가 `getByPlaceholder("password")`에서 시간 초과 | placeholder를 없애고 label을 붙였다 | `getByLabel("비밀번호")`(6단계) |
| 로컬은 통과, CI에서만 `+ "/trpc/me.profile"` 차이로 실패 | 요청을 세는 테스트가 타이밍에 흔들린다 | 세는 대상을 좁힌다(6단계) |
| `Playwright Test did not expect test() to be called here.` | Vitest가 Playwright 파일을 집었다 | `vitest.config.ts`의 `include`(6단계) |
| 데스크톱 목록의 열 순서가 뒤섞인다 | 일부 칸에만 위치를 지정했다 | `col-start`·`row-start` 대신 `order`(7단계) |
| 본문 속 링크가 글자와 구별되지 않는다 | Tailwind 기본 스타일이 밑줄을 없앤다 | `@layer base`의 `a`(7단계) |
| `locator resolved to 4 elements`, 다른 사람으로 로그인했는데 이전 사람의 버튼·주문이 보인다 | 쿼리 캐시가 남았다 | 로그인·로그아웃의 `queryClient.clear()`(7단계) |
| 검사·테스트는 모두 초록인데 배포만 건너뜀 | 배포 브랜치가 아직 `18-deploy`이거나 비어 있다 | 저장소 변수 `DEPLOY_BRANCH`(8단계) |
| `gh api …/deployment-branch-policies`가 `Not Found (HTTP 404)` | 허용 브랜치 제한이 꺼져 있다(`deployment_branch_policy`가 `null`) | 할 일 없음(8단계) |
| `Branch "19-design" is not allowed to deploy to production …` | Environments의 허용 브랜치에 이 브랜치가 없다 | Settings → Environments → `production`(8단계) |
| 역할을 바꿨는데 "이미지 바꾸기"가 안 보인다 | 역할을 바꾸기 전에 받은 토큰이다 | 다시 로그인, `me.profile`(8단계, 진단 3) |
| 로그인 화면에 데모 버튼이 없다, `{"enabled":false}` | API가 `DEMO_LOGIN=1`을 못 받았다 | 서버·로컬 `.env`, `.env`를 바꾼 뒤 api를 다시 띄웠는지(9단계, 진단 4) |
| `데모 계정이 없다 - 시드를 확인한다`(404) | DB에 데모 계정이 없다 | 시드(9단계) |
| `as must be one of the following values: user, admin`(400) | 정해진 두 값이 아니다 | 요청 본문의 `as`(9단계) |
| 데모 관리자로 들어갔는데 "관리"가 없다 | 운영 DB의 `kim`이 아직 일반 사용자다 | SQL로 역할을 바꾼다(9단계, 진단 3) |
| 관리자인데 새로고침하면 "로그인해 주세요" | 메모리의 토큰만 보고 판단했다 | 프로필을 물어 refresh로 확인(9단계) |
| 한글이 단어 중간에서 줄바꿈된다 | 글자 단위 줄바꿈 | `word-break: keep-all`(9단계) |
| 넓은 화면에서 오른쪽만 비어 보인다 | 본문이 왼쪽에 붙은 채 폭만 제한됐다 | `.page`(9단계) |
| e2e `strict mode violation: getByTestId(…) resolved to 2 elements` | 떠나온 페이지가 숨겨진 채 DOM에 남아 있다(`cacheComponents`의 Activity) | `getByRole`, 또는 `.filter({ visible: true })`(9단계) |
| 수량을 조절하는 동안 "담았습니다" 안내가 사라지지 않는다 | 그릴 때마다 새 `onDone`이 타이머를 다시 건다 | `useCallback`(9단계) |

### 시험해보기

```sh
npm run test:api && npm run test:web
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.3-106-98-215.sslip.io/products/1/image/upload-url
401
```

### 도전 과제

#### 1. 카테고리 필터 더하기

상품 목록에 카테고리(`09`) 필터를 더한다. 시안부터 그리고, 토큰만으로 구현한다.

필터가 많아지면 휴대폰에서 어디에 두는가?

**답**

1. 카테고리 트리는 `09`의 `GET /categories/tree`로 받고, 이미 받은 상품 목록(`categoryId`가 들어 있다)을 화면에서 거른다. 상품은 가장 아래 단계에 붙어 있으므로 고른 카테고리 아래의 모든 카테고리를 함께 본다. "전자기기"를 고르면 키보드·마우스·헤드폰 세 개가, "주방"을 고르면 전기 주전자 하나가 남는다.

2. 단추는 맨 위 단계와 그 바로 아래 단계까지 둔다(전체·전자기기·컴퓨터·음향·생활·주방). 눌린 단추는 `aria-pressed="true"`로 낭독기에 알리고, 같은 속성으로 테두리를 진하게 그린다(6장 작업 1의 `aria-current`와 같은 방식). 색은 `text-muted`·`border-fg` 같은 토큰 이름만 쓴다.

3. 휴대폰 폭(390)에서는 필터를 목록 위에 한 줄로 두고, 옆으로 밀어 넘긴다(`overflow-x-auto`). 단추가 모두 같은 줄에 있고 그 줄만 가로로 스크롤되며, 페이지 자체는 가로로 넘치지 않는다. 넓은 화면에서는 줄을 바꿔 모두 보인다(`sm:flex-wrap`).

> 한 줄로 두면 필터가 몇 개로 늘어나도 차지하는 높이가 같아, 상품 목록이 화면 아래로 밀려나지 않는다.

#### 2. 다크 모드를 사용자가 고르게 하기

다크 모드를 시스템 설정만이 아니라 사용자가 고를 수 있게 한다.

고른 값을 어디에 저장해야 첫 화면이 깜빡이지 않는가? 서버 렌더링과 `localStorage`를 놓고 생각해 본다.

**답**

1. 쿠키에 저장한다. 쿠키는 다음 요청에 함께 실려 오므로, `layout.tsx`가 `cookies()`로 읽어 `<html data-theme="dark">`처럼 첫 HTML에 넣어 보낸다. 서버가 보낸 HTML 자체에 이미 속성이 있어, 브라우저는 처음 그릴 때부터 고른 색으로 그린다.

2. 토큰은 이름도 값도 그대로 두고, 고르는 규칙만 바꾼다. 다크 값을 `:root[data-theme="dark"]`에도 걸고, 시스템 다크 규칙은 `:root:not([data-theme="light"])`로 좁힌다. 화면 컴포넌트는 하나도 고치지 않았다.

3. 운영체제가 라이트인 브라우저에서 "다크"를 고르면 그 자리에서 바탕이 `#1b1b19`가 되고, 새로고침해도 다크다. "시스템"을 고르면 쿠키를 지우고 속성을 떼어 운영체제 설정으로 돌아간다. 원래 있던 하이드레이션 에러 검사(e2e)도 그대로 통과한다.

4. `localStorage`는 요청에 실리지 않으므로 서버는 고른 값을 알 수 없다. 서버가 보내는 첫 HTML에는 넣을 수 없고, 브라우저에서 JS가 돈 뒤에야 속성을 붙일 수 있다.

> 이 앱은 CSP nonce 때문에 이미 요청마다 렌더링한다(`connection()`). 그래서 쿠키를 읽어도 미리 그려 두던 페이지를 잃지 않는다.

#### 3. 관리자 화면에서 가격·재고 고치기

관리자 화면(`/admin/products`)에서 이미지뿐 아니라 가격·재고도 고칠 수 있게 한다.

권한 검사는 어디에서 해야 하는가(화면, API, 둘 다)? 결제가 진행 중인 주문의 금액과 어긋나지 않으려면 무엇을 기준으로 삼는가? 답을 적어 본다.

**답**

1. 둘 다 하지만, 막는 것은 API다. `PATCH /products/:id`에 업로드와 같은 `@UseGuards(AuthGuard("jwt"), AdminGuard)`를 건다. 로그인하지 않으면 401, 일반 사용자(lee)는 403이고 가격은 그대로다. 화면은 4장 작업 5처럼 관리 메뉴와 입력 칸을 관리자에게만 보여 줄 뿐이다.

2. 값의 검사도 서버가 한다. DTO에 `@IsInt() @Min(0)`을 걸어 음수·소수는 400이다. 화면의 `min={0}`을 꺼 두고 `-1`을 보내도 `stock must not be less than 0`으로 거절되고, 화면은 그 문장을 보여 준다.

3. 금액의 기준은 "결제할 때 잠근 상품 행의 가격"이다. `02`의 결제는 `FOR UPDATE`로 잠근 행의 `price`로 `orders.price`와 `order_items.unit_price`(4장 작업 6)를 적고, Stripe 세션 금액도 `orders.price`다. 1000원짜리 2개를 결제 대기로 둔 뒤 관리자가 가격을 5000원으로 바꿔도, 그 주문은 2000원(단가 1000원)이고 Stripe에 넘긴 금액도 2000원 그대로다.

4. 화면에서 고친 가격·재고는 상품 목록의 쿼리를 다시 받아(`invalidateQueries`) 상품 화면에 바로 보인다.

### 남길 것

- **찾아보면 되는 것**: `getComputedStyle`, `document.fonts`, JWT payload를 읽는 `jq`의 `@base64d`(또는 jwt.io), 개발자 도구의 `prefers-color-scheme` 흉내. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 화면 문제는 "클래스가 만들어졌나 → 값이 무엇으로 풀렸나 → 데이터가 맞나" 순서로 가른다.

  - 역할 문제는 DB·프로필·토큰 세 곳의 값을 나란히 놓으면 어디서 어긋났는지 바로 보인다.

- **에러 신호**: 위 "진단 5"의 표가 이 문서의 모든 에러 신호를 모은 것이다.

## 12. 완성 확인

### 체크리스트

- [ ] 방향을 같은 데이터로 비교해 고르고, 화면마다 상태 목록을 적고 기본 화면을 두 폭으로 그렸다

- [ ] 색·글자·간격은 토큰으로만 쓰고, 보조 글자의 명암비가 4.5:1 이상이다

- [ ] 상품 이미지는 관리자만 바꿀 수 있다(401·403·201을 e2e로 확인)

- [ ] 주문 상세에 산 상품이, 결제 취소 후에는 남은 주문의 안내가 보인다

- [ ] 장바구니 수량을 조절할 수 있고, 0이면 빠지고, 재고보다 많이 담을 수 없다

- [ ] 로그아웃·로그인하면 이전 사용자의 데이터가 남지 않는다

- [ ] 실제 화면을 데스크톱·휴대폰, 라이트·다크로 바꿔 가며 시안과 대조했다

- [ ] 푸시해서 운영에 배포했고, 운영의 관리자는 SQL로 지정했다

- [ ] 로그인 화면의 데모 버튼으로 일반 사용자·관리자 화면을 모두 볼 수 있고, 데모 일반 사용자는 업로드 API에서 403을 받는다

- [ ] 장바구니는 자기 페이지가 있고, 상품은 담은 뒤 그 자리에서 수량을 조절한다

## 13. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 시안을 코드보다 먼저 그리면 무엇이 코드 전에 드러나는가? 이 문서에서 실제로 드러난 것 네 가지는?

2. 토큰을 쓰면 다크 모드와 새 화면을 만들 때 무엇이 쉬워지는가?

3. 화면에서 버튼을 숨기는 것과 API의 `AdminGuard`는 각각 무엇을 막는가?

4. 역할을 토큰에 담을 때, 역할이 바뀌면 언제 반영되는가? 즉시 반영해야 한다면?

5. 로그아웃할 때 쿼리 캐시를 비우지 않으면 어떤 정보가 누구에게 보이는가?

6. 역할 열을 더하는 마이그레이션이 배포 실패 후 되돌리기에 안전한 이유는?

7. 휴대폰에서 결제 버튼을 아래 합계 줄에 하나 더 두지 않은 이유는?

8. 데모 로그인을 "화면이 데모 비밀번호로 로그인"하게 만들지 않고 서버 경로로 둔 이유는? 데모 관리자를 공개하면 무엇을 함께 해야 하는가?

9. 테스트와 시안 대조를 통과했는데도 배포 후 사용자 입장에서 써 보며 찾은 것은 무엇이었나? 왜 앞의 단계들에서 드러나지 않았나?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 디자인 도구(Figma)와 개발자 넘기기, 컴포넌트 문서(Storybook)

- 화면 회귀 테스트(스크린숏을 저장해 두고 픽셀 차이를 비교)

- 자동 접근성 검사(axe), 화면 낭독기로 직접 써 보기

- 국제화(문구를 키로 빼서 언어별로)

- 데모 데이터를 매일 초기화하는 예약 작업
