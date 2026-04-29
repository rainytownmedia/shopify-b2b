-- Hotfix for production: create email queue/log tables if missing.
-- Reason: migration 20260429110024_add_email_queue_log failed on production because "Notification" already existed,
-- causing a transaction rollback and leaving email_jobs/email_logs absent. That migration was later marked applied.

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_jobs" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "providerMsgId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "provider" TEXT,
    "providerMsgId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_jobs_status_nextAttemptAt_idx" ON "email_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_jobs_shopId_createdAt_idx" ON "email_jobs"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_shopId_createdAt_idx" ON "email_logs"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_logs_status_createdAt_idx" ON "email_logs"("status", "createdAt");

-- AddForeignKey (guarded)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_logs_jobId_fkey'
  ) THEN
    ALTER TABLE "email_logs"
      ADD CONSTRAINT "email_logs_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "email_jobs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

