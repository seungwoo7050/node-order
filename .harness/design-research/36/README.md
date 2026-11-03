# 36-storefront-designs — 레퍼런스 브랜드 실측 & 시각 진단 기록

## 1. 근본 원인 진단 (Root Cause Analysis)

### 1.1 Turbopack `*.css` 규칙의 CSS Modules 무력화 버그
- **증상**: `designs/*/*.module.css`에 작성한 스타일이 브라우저에서 전혀 적용되지 않고, 모든 컴포넌트의 `className={styles.xxx}`가 `undefined`로 평가되어 클래스 없는 순수 HTML 기본 스타일(16px Times/Sans, 40px `<ul>` 좌측 패딩, 거대한 SVG)로 렌더링됨.
- **원인**: `order-console-next/next.config.ts`의 `turbopack.rules["*.css"]`가 `as: "*.css"`로 모든 CSS 파일을 글로벌 CSS로 강제 변환하여, Turbopack 내장 CSS Modules 해시 생성기(`styles.root → "editorial-atelier-module__...__root"`)를 우회함.
- **해결** (Context7 `/vercel/next.js` Turbopack `condition` 문서 기반):
  ```ts
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ```

### 1.2 Playwright `reuseExistingServer: true` 함정
- `playwright.config.ts`가 `:3000` 포트에 떠 있는 구버전 프로세스를 재사용하므로, 코드 수정 후 반드시 기존 `:3000` 서버를 종료하고 프로덕션 빌드(`npm run build && npm run start`)로 재기동해야 `@modal/(.)[id]` 인터셉팅 라우트와 신규 CSS 청크가 반영됨.

### 1.3 AI Slop 및 시각 위계 결함 (`frontend-design` 스킬 기준)
1. **가짜 메타데이터(Fake Telemetry) 남발**: `ARCHIVE MATRIX · GRID 1.5PX / TELEMETRY #FF4D00`, `REF. 006`, `표본 번호 006 · 무표백 자연소재 기록` 등 실제 브랜드에 존재하지 않는 장식 문구가 카드마다 반복됨.
2. **좌측 정렬축(Left X-Axis) 붕괴**: 글로벌 헤더(`1520px`), 검색바(`1280px`), 카탈로그 본문(`1440px`/`1360px`/`1480px`), 푸터(`1520px`)의 컨테이너 폭과 좌우 패딩이 서로 달라 한 화면에 3~4개의 수직 정렬선이 생김.
3. **11px 미만 마이크로 폰트 & 저대비 텍스트**: `9px`~`10px` 캡션과 `#8c8275` on `#f3eee4` 등 WCAG AA(4.5:1) 미달 조합 다수.
4. **시드 상품 사진의 시각적 부조화**: 12개 시드 상품이 나무 탁자, 잔디, 침실 등 제각각인 Unsplash 생활 사진이어서 룩북/도감/아카이브 그리드의 통일감을 해침 → 단일 `#EFEFEF` 스튜디오 플레이트 12종 + 캠페인 배너 2종으로 교체.

---

## 2. 실제 레퍼런스 사이트 브라우저 캡처 및 Computed CSS 실측 요약

Playwright Chromium(1440×900 데스크톱 / 390×844 모바일)으로 실제 운영 중인 한국 컨템포러리 도메스틱 브랜드 및 MUJI Korea를 방문하여 측정한 수치(`metrics-summary.json` 참조):

| 브랜드 | 배경 / 표면 / 텍스트 | 폰트 스택 | 헤더 높이 | 그리드 & 이미지 비율 | 핵심 시그니처 디테일 |
|---|---|---|---|---|---|
| **Coor (`coor.kr`)** | `#ffffff` / `#efefef` / `#000000` | `Instrument Serif` (워드마크 28px) + `Helvetica Neue`, `Apple SD Gothic Neo` (12~13px) | `60px` | 4열 (`gap: 16px`), **2:3 포트레이트** (`0.67`), `#efefef` 스튜디오 컷 | 소문자 세리프 워드마크, 좌측 고정 카테고리 트리 + 우측 4열 그리드 |
| **Firstfloor (`firstfloor.co.kr`)** | `#ffffff` / `#f5f5f5` / `#000000`, `#1b1b1b` | `Pretendard`, `Inter` (본문 13px, 가격 13px) | `54px` (`rgba(255,255,255,0.8)` 블러) | 4열, **3:4 포트레이트** (`0.72`) | 극도로 절제된 무보더 카드, 썸네일 하단 좌측 정렬 상품명/가격 |
| **The Knit Company (`theknitcompany.com`)** | `#ffffff` / `#f4f4f4` / `#111111`, `#767676` | `Pretendard` (13~14px, `font-weight: 400~500`) | `56px` | 4열 (`gap: 24px 8px`), **3:4 포트레이트** (`0.75`) | PDP 60:40 비대칭 레이아웃, 우측 400px 스티키 바이박스, `#333333` 48px CTA |
| **MUJI Korea (`mujikorea.co.kr`)** | `#ffffff` / `#f5f5f5` / `#000000`, `#666666`, 포인트 `#7f0019` | `Pretendard`, `Noto Sans KR` (페이지 타이틀 32px 700, 카드명 14px, 가격 16px 700) | 상단 공지 `44px` (`#222`) + 헤더 `64px` | 4열 (`gap: 48px 20px`), **1:1 정방형** (`1.00`) | 64px 높이 4분할 카테고리 탭바(활성 `#000`), `#7f0019` 크림슨 배지, 1:1 정방형 도판 |
| **Zavanas (`zavanas.com`)** | `#ffffff` / `#f3f3f3` / `#000000`, `#1c1c1c`, `#888888`, 품절 `#b03a2e` | `Raleway` (`letter-spacing: 8px`, 워드마크 25px) + `Nanum Gothic` (12~14px) | 유틸리티바 + 워드마크 로고바 | `1200px` 컨테이너, 4열 (`gap: 48px 20px`), **1:1 정방형** (`1.00`) | 섹션 타이틀 앞 `—` 대시(`— 전상품`), 카드 내 상품명-요약 사이 `1px solid #ececec` 헤어라인, PDP `136px` `<th>` 스펙 테이블 |

---

## 3. 3대 디자인 시스템 아키텍처 매핑

1. **`editorial-atelier` (Coor × Firstfloor × The Knit Company)**
   - 컨테이너: `1440px` (`padding-inline: 32px`)
   - 워드마크: 소문자 `Instrument Serif` 28px
   - 카탈로그: 16:9 풀블리드 에디토리얼 배너 + 좌측 `224px` 스티키 카테고리 트리 사이드바 + 우측 4열 `2:3` 포트레이트(`#efefef` 배경) 룩북 그리드
   - PDP: 좌측 `2:3` 대형 포트레이트 도판 + 우측 `400px` 스티키 바이박스(`#333333` 48px 버튼 + `<details>` 아코디언)
2. **`muji-hara` (MUJI Korea 플래그십)**
   - 컨테이너: `1360px` (`padding-inline: 32px`)
   - 헤더: `44px` `#222222` 공지바 + `64px` 화이트 헤더 + `#7f0019` 크림슨 장바구니 카운트 배지
   - 카탈로그: `32px` 굵은 카테고리 타이틀 + `64px` 높이 4분할 보더 탭바(활성 `#000000`) + 4열 `1:1` 정방형 그리드(리뷰순 정렬 시 좌상단 순위 배지)
   - PDP: 좌측 `1:1` 정방형 도판 + 우측 정의 목록(`<dl>`) 스펙 행 + `56px` 대형 액션 버튼
3. **`zavanas-archive` (Zavanas × Braun 절제 아카이브)**
   - 컨테이너: `1200px` (`padding-inline: 24px`)
   - 헤더: `48px` 유틸리티바 + 중앙 정렬 대문자 `Raleway` 워드마크(`letter-spacing: 8px`)
   - 카탈로그: `3:1` 메인 비주얼 배너 + `—` 섹션 헤딩 + `|` 구분 인라인 카테고리 필터 + 4열 `1:1` 정방형 그리드(상품명 아래 `1px solid #ececec` 구분선 + `#b03a2e` SOLD OUT 배지)
   - PDP: 상단 `—` 타이틀 바 + 좌측 `1:1` 정방형 도판 + 우측 `136px` `<th>` 스펙 테이블 + 총 상품금액 박스 + `52px` 블랙 구매 버튼
