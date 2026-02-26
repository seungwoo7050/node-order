-- AlterTable
ALTER TABLE "users" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_expires_at_idx" ON "users"("expires_at");
