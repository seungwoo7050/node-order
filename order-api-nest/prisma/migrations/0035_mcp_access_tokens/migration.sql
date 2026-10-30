-- 판매자용 MCP 서버(30)
--   access_tokens: 관리자 화면에서 발급하는 개인 접근 토큰. 원문은 저장하지 않고 sha256 해시만 둔다(발급할 때 한 번만 보인다)
--     scopes: read(읽기 도구), write(상태·재고를 바꾸는 도구), pii(손님 연락처·주소 원문)
--   mcp_audit_log: 도구 호출 한 번에 한 행(토큰, 도구, 연락처를 가린 인자 요약, 성공·실패, 시각)
-- 사용자를 지우면(데모 사용자 정리) 토큰과 그 감사 로그도 같이 지운다

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_tokens_scopes_check" CHECK ("scopes" <@ ARRAY['read', 'write', 'pii']::TEXT[] AND cardinality("scopes") > 0)
);

-- CreateTable
CREATE TABLE "mcp_audit_log" (
    "id" SERIAL NOT NULL,
    "token_id" INTEGER NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_token_hash_key" ON "access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "access_tokens_user_id_idx" ON "access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "mcp_audit_log_token_id_id_idx" ON "mcp_audit_log"("token_id", "id");

-- CreateIndex
CREATE INDEX "mcp_audit_log_created_at_idx" ON "mcp_audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
