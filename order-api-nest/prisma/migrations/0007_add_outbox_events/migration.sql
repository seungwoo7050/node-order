-- CreateTable
CREATE TABLE "outbox_events" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
