-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- 직접 추가: 주문에 이미 들어 있는 사용자 이름으로 users 행을 먼저 만든다(외래키가 가리킬 대상)
INSERT INTO "users" ("id", "name")
SELECT DISTINCT "user", "user" FROM "orders";

-- Prisma가 만든 DROP COLUMN "user" + ADD COLUMN "user_id" 대신, 값을 보존하는 이름 변경으로 바꿨다
ALTER TABLE "orders" RENAME COLUMN "user" TO "user_id";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
