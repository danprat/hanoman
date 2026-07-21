-- SPEC-276 · ADR-0070 · symbolication source-map (additive, aman VPS live)

-- CreateTable
CREATE TABLE "SourceMapArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "debugId" TEXT,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceMapArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceMapArtifact_projectId_release_filename_key" ON "SourceMapArtifact"("projectId", "release", "filename");

-- CreateIndex
CREATE INDEX "SourceMapArtifact_projectId_release_idx" ON "SourceMapArtifact"("projectId", "release");

-- AddForeignKey
ALTER TABLE "SourceMapArtifact" ADD CONSTRAINT "SourceMapArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (additive columns; NULL-able → aman untuk baris lama)
ALTER TABLE "ErrorEvent" ADD COLUMN "frames" JSONB;
ALTER TABLE "ErrorGroup" ADD COLUMN "sampleFrames" JSONB;
ALTER TABLE "ErrorGroup" ADD COLUMN "release" TEXT;
