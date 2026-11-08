# citeguard

웹에서 수집한 약관과 운송 규정을 Qdrant 벡터 데이터베이스에 증분 적재하고, 로컬 Docker LLM(`Ollama`)이 만든 답변의 원문 인용과 숫자 일치 여부를 검증해 내보내는 Hybrid RAG 서버 및 CLI 도구다.

## 왜 만들었나

온라인 상점(`node-order`)의 청약철회 및 환불 규정이나 외국인 여행 안내 앱(`Horang`)의 공항철도 운임 및 수수료 규정을 다룰 때는 숫자 하나가 틀리면 곧바로 금전 분쟁이나 현장 혼란으로 이어진다. 외부 유료 LLM API 비용을 쓰지 않으려고 로컬 Docker에 가벼운 소형 모델(`qwen2.5:0.5b` 등)을 올려 써 보면 두 가지 문제가 반복해서 터진다.

1. 문서를 단순히 글자 수 단위로 잘라 넣으면 표가 깨지고 상위 조항 제목(`제17조 청약철회등`)이 잘려 나가 엉뚱한 문단이 검색된다. 또한 약관이 개정될 때마다 전체 문서를 다시 임베딩하면 느리고, 삭제된 구버전 조항 벡터가 Qdrant에 남아 있으면 이미 폐지된 요금이나 기간을 근거로 답한다.
2. 의미 중심의 Dense Vector 검색만 쓰면 `'제18조의2'`나 `'AREX-11000'` 같은 정확한 조항 번호와 코드를 구분하지 못해 주변 조항을 가져오고, 소형 로컬 LLM은 원문에 `'7일 이내'`라고 적혀 있어도 `'14일 이내'`처럼 숫자를 지어내는 일이 잦다.

`citeguard`는 이 문제를 풀기 위해 상위 제목 경로(`Breadcrumb`) 보존 청킹, `SHA-256` 해시 비교 기반 Qdrant 증분 동기화 및 구버전 벡터 소거, Qdrant 코사인 검색과 Okapi BM25 역색인을 결합한 RRF(`Reciprocal Rank Fusion`) 하이브리드 검색, 그리고 답변 속 모든 숫자와 인용 문장을 원문과 대조하는 `GroundingVerifier`를 한 파이프라인으로 묶었다.

## 구조와 설계 판단

- **계층 경로 주입(`BreadcrumbChunker`)과 HTML 표 보존(`PolicyHTMLParser`)**: HTML에서 `<script>`, `<nav>`, `<footer>`를 걷어내고 `<table>`을 마크다운 파이프 표로 변환한 뒤 표 행이 중간에 쪼개지지 않게 유지한다. 모든 청크의 인덱싱 텍스트 앞에는 `[전자상거래 표준약관 > 제4장 > 제17조]` 형태의 상위 제목 경로를 붙여 하위 문단만 떨어져 나와도 문맥이 유지되게 했다.
- **`SHA-256` 청크 해시 비교를 이용한 Qdrant 증분 동기화(`IncrementalSyncEngine`)**: 문서를 다시 수집했을 때 기존 `DocumentChunk.chunk_hash`와 일치하는 청크는 로컬 `Ollama` 임베딩 호출과 Qdrant 업서트를 건너뛴다(`skipped_chunks`). 새로 생겼거나 바뀐 청크만 임베딩해 Qdrant에 적재(`added_chunks`)하고, 새 문서에서 사라진 구버전 청크의 `qdrant_point_id`는 Qdrant `/points/delete` API로 즉시 지워(`purged_chunks`) 구버전 규정 오염을 막는다.
- **Qdrant Dense Vector + Okapi BM25 하이브리드 RRF 검색(`HybridRRFRetriever`)**: 먼저 카테고리, 언어, 최소 출처 등급(`A/B/C`), 시행일(`effective_after`) 조건으로 후보를 거른 뒤, Qdrant 코사인 유사도 순위($r_{\text{dense}}$)와 한국어 조사 제거 토큰 기반 BM25 순위($r_{\text{bm25}}$)를 $\text{RRF}(d) = \frac{1}{k + r_{\text{dense}}(d)} + \frac{1}{k + r_{\text{bm25}}(d)}$ ($k=60$)로 합산한다. 일상어 패러프레이즈 질문은 Dense 벡터가 잡고, 조항 번호나 코드 질문은 BM25가 잡는다.
- **인용 스팬 및 숫자 단어 경계 검증(`GroundingVerifier`)**: 로컬 `Ollama` LLM이 JSON 스키마에 맞춰 반환한 응답에 대해 ① `chunk_uid`가 이번 턴 검색 결과에 실제로 존재하는지, ② `quote`가 해당 청크 원문의 실제 부분 문자열인지, ③ 답변 속 모든 숫자(`(?<!\d)\d+(?:,\d{3})*(?:\.\d+)?(?!\d)`)가 인용된 원문 청크의 숫자 집합 안에 존재하는지 검사한다. 하나라도 어긋나면(`NUMERIC_HALLUCINATION` 등) 환각 답변을 버리고 1순위 청크의 원문 문장을 그대로 발췌한 안전 요약(`FALLBACK_EXTRACTIVE`)으로 대체한다.

## 패키지 및 CLI 사용법

### 로컬 Docker 스택 기동 (`Qdrant` + `Ollama`)

```bash
docker compose up -d
bash scripts/init_ollama.sh
```

기본 설정으로 `qdrant/qdrant`(포트 `6333`)와 `ollama/ollama`(포트 `11434`)가 뜨며, 신경망 임베딩 모델 `all-minilm`(45MB)과 생성형 모델 `qwen2.5:0.5b`(397MB)를 받아 사용한다.

### 문서 증분 적재 및 질의 CLI

```bash
# 로컬 파일이나 공식 웹 URL을 Qdrant에 증분 동기화
citeguard sync \
  --doc-key ftc-standard \
  --title "전자상거래 표준약관" \
  --category commerce_policy \
  --file ./policy.md

# 하이브리드 검색 + 로컬 LLM 답변 생성 + 근거 검증
citeguard ask "청약철회는 며칠 이내에 가능한가요?" --category commerce_policy
```

### FastAPI 서버 기동 및 엔드포인트

```bash
citeguard serve --host 127.0.0.1 --port 8090
```

- `POST /v1/documents/sync`: 문서 수집, 청크 해시 비교, 변경분 임베딩 및 Qdrant 업서트/삭제 수행
- `POST /v1/search`: `hybrid`, `dense_only`, `bm25_only` 모드별 검색 결과 및 RRF 점수 조회
- `POST /v1/ask`: 하이브리드 검색 후 로컬 LLM 생성 및 `GroundingVerifier` 검증 결과 반환
- `POST /v1/eval`: Golden QA 케이스 기준 `Recall@K`, `MRR`, `Grounding Pass Rate` 측정
- `GET /metrics`: 적재·생략·삭제 청크 수 및 검증 상태별(`GROUNDED`, `FALLBACK_EXTRACTIVE`, `ABSTAINED`) Prometheus 메트릭 노출

### 테스트 및 정적 검사

```bash
make check
```

## 범위와 한계

- PDF나 이미지 스캔본(OCR) 파서는 포함하지 않으며, HTML과 마크다운 텍스트 문서를 대상으로 동작한다.
- 숫자 경계 검증기는 원문에 없는 숫자가 답변에 새로 등장하는 것을 차단하지만, 원문 안에 여러 숫자가 있을 때 두 숫자의 대소 관계를 반대로 서술하는 논리 오류까지 문맥으로 판별하지는 못한다.
- BM25 역색인은 필터링된 후보 청크 집합 위에서 메모리 연산으로 점수를 계산하므로, 단일 문서군 수만 청크 규모까지는 빠르게 동작하지만 수백만 청크 규모에서는 외부 역색인 엔진 분리가 필요하다.
