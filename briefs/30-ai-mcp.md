```
상태: 확정(오케스트레이터)
브랜치: 30-ai-mcp (앞 브랜치: 29-admin)
문제: 1인 판매자는 하루 업무(처리 대기 주문 확인, 송장 입력, 반품 판단, 재고 부족 확인)를 관리자 화면을 하나씩 열어 처리한다. 이미 쓰는 AI 도우미(Claude 같은 MCP 클라이언트)에게 "오늘 보낼 주문 보여 주고 이 송장 붙여 줘"라고 맡길 통로가 없다. 상품 설명은 판매자가 매번 처음부터 쓴다.
결정:
  - 판매자용 MCP 서버를 API 안에 Streamable HTTP 엔드포인트(`/mcp`)로 둔다. 공식 TypeScript SDK(`@modelcontextprotocol/sdk`)를 쓰고, 도구는 HTTP로 자기 API를 다시 부르지 않고 기존 서비스(28 상태 기계, 27 환불, 29 대시보드·대사, 26 검색 통계)를 직접 부른다 / 대안: stdio로 도는 별도 프로세스. 판매자 컴퓨터에 저장소와 DB 접근이 있어야 하고 원격에서 쓸 수 없다 / 바꿀 신호: 판매자가 아닌 손님용 도구가 필요해지면 엔드포인트와 인증을 분리한다
  - 인증은 관리자 화면에서 발급하는 개인 접근 토큰(Bearer)이다. 해시만 저장하고, 범위(read, write, pii)와 만료가 있으며 폐기할 수 있다. 발급할 때 한 번만 원문을 보인다 / 대안: MCP OAuth 인가 흐름. 관리자 한 명에게는 인가 서버를 운영하는 비용이 크다 / 바꿀 신호: 관리자가 여러 명이 되거나 제3자 클라이언트에 배포할 때
  - 도구(이름은 동사_대상): `list_pending_work`(대시보드 타일), `search_orders`, `get_order`, `register_shipment`, `mark_delivered`, `approve_return`, `reject_return`, `list_low_stock`, `adjust_stock`, `list_zero_result_searches`, `list_reconciliation_issues`. 입력 스키마는 zod로 둔다. 읽기 도구는 `readOnlyHint`, 돈이나 재고를 움직이는 도구는 `destructiveHint`를 단다. 상태 전이가 거부되면 도구 결과에 오류와 현재 상태를 담는다(`isError`) / 대안: REST를 그대로 감싼 범용 `call_api` 도구 하나. 모델이 경로와 권한을 추측하게 되고 감사가 흐려진다
  - 손님 연락처와 주소는 `pii` 범위가 있을 때만 원문이고, 없으면 29의 마스킹 규칙을 따른다. 모든 도구 호출을 `mcp_audit_log`(토큰, 도구, 인자 요약(마스킹), 결과 성공·실패, 시각)에 남기고 관리자 화면에서 본다. demo_admin이 발급한 토큰은 read 범위만 가진다
  - 상품 설명 초안: 관리자 상품 수정 화면의 "설명 초안 만들기"가 `POST /admin/products/:id/description-draft`를 부르고, SSE로 받은 글을 편집 칸에 흘려 넣는다. 저장은 판매자가 직접 누를 때만 한다(자동 저장 없음). 입력은 상품 이름·카테고리 경로·가격·기존 설명과 판매자가 쓴 키워드다
  - 생성은 `LlmProvider` 인터페이스(`streamText(입력, AbortSignal)`) 뒤에 둔다. 첫 구현은 Anthropic 공식 SDK이고, 기본 모델은 `claude-haiku-4-5`(env `LLM_MODEL`로 바꿈)다. 테스트는 대역 공급자로 한다. 기능 목록 `features.llm`은 `LLM_API_KEY`가 있을 때만 true이고, 없으면 버튼을 숨기고 엔드포인트는 404다 / 대안: 로컬 모델(Ollama). 운영 서버 한 대에 GPU가 없고 개발 PC에도 설치돼 있지 않다 / 바꿀 신호: 생성 호출이 하루 수백 건을 넘어 비용이 신경 쓰일 때 캐시나 더 작은 모델을 고려한다
  - 응답 스트리밍: 손님이 연결을 끊으면 AbortSignal로 공급자 호출을 끊는다. 중간 오류는 SSE 오류 이벤트로 보내고, 화면은 그때까지 받은 글을 남긴 채 오류를 보인다. 관리자당 분당 호출 수를 제한하고, 입력·출력 토큰 수를 지표로 남긴다
  - 공급자 SDK 사용법은 `claude-api` 스킬을 불러 확인한다(모델 id, 스트리밍 이벤트 모양)
완료 기준:
  1. MCP 클라이언트 테스트(SDK의 Client + Streamable HTTP 전송)가 도구 목록과 annotations를 받는다. read 토큰으로 write 도구를 부르면 거부되고, 폐기하거나 만료된 토큰은 401이다
  2. `register_shipment`가 28의 상태 기계를 그대로 탄다. 허용된 상태에서는 송장이 붙고, 아니면 `isError`와 현재 상태가 오며 history는 늘지 않는다. 같은 주문에 대해 REST로 본 결과와 MCP로 본 결과가 같다
  3. 모든 도구 호출이 감사 로그에 1행씩 남고, 인자 안의 연락처는 마스킹돼 있다. `pii` 범위가 없으면 `get_order` 결과에 연락처·주소 원문이 없다
  4. 실제 확인: 로컬 API에 Claude Code를 `claude mcp add --transport http`로 붙여 읽기 도구 하나를 실제로 부른다. 오케스트레이터가 확인하고, 명령과 결과를 README에 적는다
  5. LLM 키가 없으면 `features.llm`이 false이고, 초안 버튼이 보이지 않으며, 엔드포인트가 404다
  6. 대역 공급자로 SSE가 조각을 순서대로 보내고, 화면에 글이 차례로 차오른다(웹 e2e). 연결을 끊으면 대역 공급자가 취소 신호를 받는다. 중간 오류가 나면 받은 글은 남고 오류 문구가 보이며 저장되지 않는다
  7. Anthropic 공급자는 로컬 가짜 HTTP 서버(SDK의 base URL을 바꿔서)로 요청 모양(모델, max_tokens, system, stream)과 스트림 파싱을 검증한다. 실제 API는 부르지 않는다
  8. `npm run verify` 통과. 테스트 수가 29 끝보다 늘고 줄지 않는다
범위 밖: 손님용 챗봇, RAG, LLM 결과 자동 반영, 손님용 MCP, MCP OAuth, 프롬프트 관리 화면
외부 의존: LLM API 키(선택. 실제 생성 확인에만 씀. 없으면 blocked)
```
