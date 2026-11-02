```
상태: 확정(사람)
브랜치: 36-storefront-designs (앞 브랜치: 35-coupons-reviews)
문제: 스토어프론트가 19-design의 단일 레이아웃(좁은 가로 행 리스트)과 단일 폰트(Noto KR)에 묶여 있고, 상점 이름도 "Brown Store."로 코드에 박혀 있다. 개인 판매자에게 사이트를 팔려면 판매자의 브랜드 성격에 따라 마크업 구조와 탐색 동선, 한글·영문 타이포그래피 자체가 다른 스토어프론트 디자인을 고를 수 있어야 하고, AI가 만든 듯한 흔한 슬롭 스타일이 들어오지 못하게 막아야 한다.
결정:
  - 스토어프론트의 데이터·행동 계약(상품 목록, 카테고리 트리 필터, 정렬 latest|price_asc|price_desc|reviews, 상품 상세, 옵션·수량 선택, 장바구니 담기, 바로 구매하기, 소재·사이즈 가이드, 리뷰, 상점 브랜드 정보)을 공통 커머스 ViewModel(lib/storefront-view-model.ts)로 분리한다
  - 같은 마크업에 색만 바꾸는 테마 대신, DOM 골격과 탐색 동선이 서로 다른 3대 독립 디자인 렌더러(designs/registry.tsx)를 둔다 / 대안: 레퍼런스 5곳을 각각 별도 렌더러로 5개 만들기. 에디토리얼 룩북 계열 3곳은 DOM 골격이 같아 마크업 중복만 늘어나므로, 골격이 확실히 다른 3대 아키타입으로 응축한다 / 바꿀 신호: 새로운 업종(예: 디지털 다운로드, 예약형 서비스)의 골격이 필요해질 때
    1. muji-hara (하라 켄야 · 무인양품 계승 — Object & Tactile Catalog): 무표백 웜 페이퍼(#fbfbfa), 영문 Cormorant Garamond + 한글 Noto Serif KR 타이틀, 영문 Plus Jakarta Sans + 한글 Noto Sans KR 본문, 1:1 정사각 비례와 정돈된 카탈로그 격자/행, 인라인 수량 조절
    2. editorial-atelier (Coor · 더니트컴퍼니 · 퍼스트플로어 통합 계승 — Contemporary Fashion Lookbook): 와이드 캠페인 히어로, 상단 영문/국문 카테고리 바(Instrument Serif + Noto Serif KR / Inter + Gothic A1), 3:4 대형 포트레이트 룩북 갤러리 그리드, 좌우 2단 비대칭 PDP(좌측 대형 비주얼·소재·실측표·리뷰 스크롤 + 우측 고정 Sticky Buy Box 및 장바구니 담기·바로 구매하기)
    3. zavanas-archive (Zavanas · 디터 람스 계승 — Material Code & Spec Matrix): 상단 코드 번호(01, 02, 03...) 소재·카테고리 매트릭스 바, 카드마다 옵션 칩·재고 수량·단가·평점이 계기판처럼 정렬되는 고밀도 기능주의 아카이브 그리드(Space Grotesk + IBM Plex Sans KR / IBM Plex Mono), 스펙 시트형 PDP
  - 판매자는 /admin/settings에서 기본 스토어 디자인(storeDesign), 상점 이름(storeName), 히어로 타이틀·서브카피(heroTitle, heroSubtitle), 상단 공지 바(announcementText)를 코드 수정 없이 바꾸고 배포 없이 즉시 반영한다. 방문자나 바이어는 ?design=<id> 전환기로 세 디자인 렌더러를 실시간으로 비교할 수 있다
  - 하드코딩된 "Brown Store."를 코드에서 없애고 StoreSettings.storeName을 헤더 로고와 메타데이터에 연결한다
  - 하네스 가드(scripts/harness/design-guard.sh)를 더해 AI 슬롭 클래스(bg-gradient-to-, from-purple-, from-indigo-, shadow-xl, shadow-2xl, rounded-2xl, rounded-3xl), "Brown Store." 하드코딩 재유입, 세 디자인 렌더러 폴더 사이의 교차 import를 차단하고 가드 테스트(막을 예·통과할 예)를 verify:fast에 넣는다
완료 기준:
  1. /shop과 /shop/[id]가 storeDesign 설정값(기본 editorial-atelier) 및 ?design=muji-hara|editorial-atelier|zavanas-archive 쿼리에 따라 서로 다른 DOM 구조와 바이링구얼 폰트 스택으로 렌더링되고, 하이드레이션 오류가 없다
  2. 상품 목록에서 카테고리 필터와 정렬(최신순·낮은가격순·높은가격순·리뷰많은순)이 동작하고, 상품 상세에서 옵션 선택 후 [장바구니 담기]와 [바로 구매하기]가 모두 동작한다
  3. 관리자가 /admin/settings에서 상점 이름, 공지 문구, 히어로 문구, 기본 스토어 디자인을 저장하면 헤더 로고·공지 바·스토어 디자인이 배포 없이 즉시 바뀐다
  4. design-guard.sh와 design-guard.test.sh가 슬롭 클래스·상점명 하드코딩·렌더러 교차 import를 막고 정상 코드는 통과시킨다
  5. npm run verify 통과
범위 밖: 드래그 앤 드롭 페이지 빌더, 사용자 정의 CSS 직접 업로드
외부 의존: 없음
```
