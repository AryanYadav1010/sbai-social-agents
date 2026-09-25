-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "refreshTokenEncrypted" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3);
