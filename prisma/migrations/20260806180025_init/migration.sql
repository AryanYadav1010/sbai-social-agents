-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'COMPLIANCE_REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'PUBLISH_FAILED');

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "complianceVerdict" JSONB,
    "externalMediaId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");

-- CreateIndex
CREATE INDEX "SocialPost_status_idx" ON "SocialPost"("status");

-- CreateIndex
CREATE INDEX "SocialPost_accountId_idx" ON "SocialPost"("accountId");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
