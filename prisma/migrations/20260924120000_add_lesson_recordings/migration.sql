-- CreateEnum
CREATE TYPE "LessonRecordingStatus" AS ENUM ('RECORDING', 'TRANSCRIBING', 'ANALYSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "LessonRecording" (
    "id" TEXT NOT NULL,
    "teacherUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "LessonRecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "mimeType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "transcriptJobId" TEXT,
    "transcript" JSONB,
    "metrics" JSONB,
    "feedback" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonRecordingChunk" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonRecordingChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonRecording_teacherUserId_createdAt_idx" ON "LessonRecording"("teacherUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonRecordingChunk_recordingId_seq_key" ON "LessonRecordingChunk"("recordingId", "seq");

-- AddForeignKey
ALTER TABLE "LessonRecording" ADD CONSTRAINT "LessonRecording_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRecordingChunk" ADD CONSTRAINT "LessonRecordingChunk_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "LessonRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

