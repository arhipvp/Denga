CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "notBefore" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_status_notBefore_createdAt_idx"
ON "Job"("status", "notBefore", "createdAt");

CREATE INDEX "Job_jobType_status_idx"
ON "Job"("jobType", "status");

ALTER TABLE "Job"
ADD CONSTRAINT "Job_householdId_fkey"
FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;
