-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "audienceProfile" JSONB;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "audienceContext" JSONB,
ADD COLUMN     "trendContext" JSONB;

-- CreateTable
CREATE TABLE "PostPerformance" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER,
    "commentsCount" INTEGER,
    "savedCount" INTEGER,
    "sharesCount" INTEGER,
    "reach" INTEGER,
    "totalInteractions" INTEGER,
    "raw" JSONB NOT NULL,
    "unavailableFields" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PostPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostPerformance_postId_idx" ON "PostPerformance"("postId");

-- CreateIndex
CREATE INDEX "PostPerformance_postId_fetchedAt_idx" ON "PostPerformance"("postId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "PostPerformance" ADD CONSTRAINT "PostPerformance_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
