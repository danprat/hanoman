-- SPEC-270 · ADR-0067 · antrean konflik rekonsil (LOCAL-only) + updatedAt @updatedAt
CREATE TABLE "SyncConflict" (
  "id" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "localData" JSONB NOT NULL,
  "localVersion" INTEGER NOT NULL,
  "localUpdatedAt" TIMESTAMP(3) NOT NULL,
  "serverData" JSONB NOT NULL,
  "serverVersion" INTEGER NOT NULL,
  "serverUpdatedAt" TIMESTAMP(3) NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncConflict_entity_recordId_key" ON "SyncConflict"("entity", "recordId");

-- @updatedAt = perilaku klien Prisma; lepas DEFAULT DB agar tak drift dari schema.
ALTER TABLE "Project"       ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Spec"          ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Vps"           ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SessionResult" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ErrorGroup"    ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Ticket"        ALTER COLUMN "updatedAt" DROP DEFAULT;
