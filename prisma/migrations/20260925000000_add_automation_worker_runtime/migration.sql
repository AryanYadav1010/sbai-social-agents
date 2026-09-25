-- AlterEnum
-- Each ADD VALUE is its own statement -- Postgres does not allow adding
-- more than one enum value per statement, and a newly-added value cannot
-- be referenced within the same transaction that added it (not a problem
-- here: nothing below inserts data, only declares column types).
ALTER TYPE "SocialPostStatus" ADD VALUE 'PUBLISH_AMBIGUOUS';
ALTER TYPE "SocialPostStatus" ADD VALUE 'GENERATING_MEDIA';
ALTER TYPE "SocialPostStatus" ADD VALUE 'NEEDS_MEDIA';

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'PLANNING', 'GENERATING_DRAFT', 'AWAITING_VIDEO', 'PENDING_APPROVAL', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkerNodeStatus" AS ENUM ('ONLINE', 'OFFLINE');

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "automationRunId" TEXT;

-- CreateTable
CREATE TABLE "AutomationSchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "postsPerDay" INTEGER NOT NULL DEFAULT 1,
    "allowedDays" INTEGER[] DEFAULT ARRAY[0,1,2,3,4,5,6]::INTEGER[],
    "postingTimes" TEXT[] DEFAULT ARRAY['12:00']::TEXT[],
    "contentPillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "campaignBrief" TEXT,
    "defaultInstructions" TEXT,
    "useVideoAgent" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "plannedTopic" TEXT,
    "planMetadata" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerNode" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "appVersion" TEXT,
    "os" TEXT,
    "concurrency" INTEGER NOT NULL,
    "status" "WorkerNodeStatus" NOT NULL DEFAULT 'ONLINE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runningJobCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkerNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_idempotencyKey_key" ON "AutomationRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_postId_key" ON "PublishAttempt"("postId");

-- CreateIndex
CREATE INDEX "SocialPost_automationRunId_idx" ON "SocialPost"("automationRunId");

-- CreateIndex
CREATE INDEX "AutomationSchedule_enabled_nextRunAt_idx" ON "AutomationSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomationSchedule_accountId_idx" ON "AutomationSchedule"("accountId");

-- CreateIndex
CREATE INDEX "AutomationRun_scheduleId_idx" ON "AutomationRun"("scheduleId");

-- CreateIndex
CREATE INDEX "AutomationRun_status_idx" ON "AutomationRun"("status");

-- CreateIndex
CREATE INDEX "WorkerNode_status_lastHeartbeatAt_idx" ON "WorkerNode"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "PublishAttempt_status_idx" ON "PublishAttempt"("status");

-- CreateIndex
CREATE INDEX "MediaAsset_accountId_idx" ON "MediaAsset"("accountId");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationSchedule" ADD CONSTRAINT "AutomationSchedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AutomationSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
