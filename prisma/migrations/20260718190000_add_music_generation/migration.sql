-- CreateEnum
CREATE TYPE "MusicGenerationSource" AS ENUM ('USER', 'EDITORIAL');

-- CreateEnum
CREATE TYPE "MusicGenerationStatus" AS ENUM ('QUEUED', 'GENERATING', 'VALIDATING', 'PUBLISHED', 'FAILED', 'BLOCKED');

-- AlterTable
ALTER TABLE "tracks" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'catalog';

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "ageConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "ageConfirmationVersion" TEXT;

-- CreateTable
CREATE TABLE "music_generations" (
  "id" TEXT NOT NULL,
  "source" "MusicGenerationSource" NOT NULL,
  "userId" TEXT,
  "username" TEXT,
  "ipHash" TEXT,
  "title" TEXT NOT NULL,
  "originalPrompt" TEXT NOT NULL,
  "normalizedPrompt" TEXT NOT NULL,
  "promptHash" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'pt',
  "mood" TEXT,
  "bpm" INTEGER,
  "durationSeconds" INTEGER NOT NULL DEFAULT 180,
  "status" "MusicGenerationStatus" NOT NULL DEFAULT 'QUEUED',
  "provider" TEXT NOT NULL DEFAULT 'google-lyria',
  "model" TEXT NOT NULL DEFAULT 'lyria-3-pro-preview',
  "providerOperationId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
  "actualCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moderationResult" JSONB,
  "validationResult" JSONB,
  "failureCode" TEXT,
  "failureReason" TEXT,
  "originalObjectKey" TEXT,
  "streamingObjectKey" TEXT,
  "audioSha256" TEXT,
  "idempotencyKey" TEXT,
  "trackId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "music_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "music_generations_audioSha256_key" ON "music_generations"("audioSha256");
CREATE UNIQUE INDEX "music_generations_idempotencyKey_key" ON "music_generations"("idempotencyKey");
CREATE UNIQUE INDEX "music_generations_trackId_key" ON "music_generations"("trackId");
CREATE INDEX "music_generations_userId_source_createdAt_idx" ON "music_generations"("userId", "source", "createdAt");
CREATE INDEX "music_generations_source_status_createdAt_idx" ON "music_generations"("source", "status", "createdAt");
CREATE INDEX "music_generations_status_createdAt_idx" ON "music_generations"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "music_generations" ADD CONSTRAINT "music_generations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "music_generations" ADD CONSTRAINT "music_generations_trackId_fkey"
  FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
