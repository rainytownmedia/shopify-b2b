-- EnsureTableExists
-- NOTE: This migration must be replayable on an empty (shadow) database.
-- In some environments the FormSubmission table pre-existed (e.g. created via db push),
-- so the original migration only altered the table. Shadow DBs start empty, so we
-- create the table defensively here to keep migrate dev working.
CREATE TABLE IF NOT EXISTS "FormSubmission" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formData" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submission_customer_tags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN IF NOT EXISTS "submission_customer_tags" TEXT;
