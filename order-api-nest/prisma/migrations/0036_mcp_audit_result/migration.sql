-- MCP 감사 로그의 결과(31 후속).
--   result: ok | error | rate_limited(호출 제한으로 거절) | pending(쓰기 도구를 실행하기 전에 남긴 행. 끝나면 ok·error로 바뀐다.
--   pending으로 남아 있으면 실행 도중 프로세스가 죽었다는 뜻이다)
-- ok 칸은 그대로 둔다(옛 API가 읽는다. ok = (result = 'ok'))
ALTER TABLE "mcp_audit_log" ADD COLUMN "result" TEXT;
UPDATE "mcp_audit_log" SET "result" = CASE WHEN "ok" THEN 'ok' ELSE 'error' END;
ALTER TABLE "mcp_audit_log" ALTER COLUMN "result" SET NOT NULL;
ALTER TABLE "mcp_audit_log" ALTER COLUMN "result" SET DEFAULT 'ok';
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_result_check" CHECK ("result" IN ('ok', 'error', 'rate_limited', 'pending'));
