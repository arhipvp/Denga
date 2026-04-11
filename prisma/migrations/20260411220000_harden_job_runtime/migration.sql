ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Job_jobType_dedupeKey_status_idx"
ON "Job"("jobType", "dedupeKey", "status");
