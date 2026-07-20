-- SPEC-249 · ADR-0060 · Error monitoring (Sentry ringan): ingest key per-project + model error.

-- Project: kolom ingest key (additive, nullable)
ALTER TABLE "Project" ADD COLUMN "ingestKeyHash" TEXT;
ALTER TABLE "Project" ADD COLUMN "ingestKeyPrefix" TEXT;

-- ErrorGroup
CREATE TABLE "ErrorGroup" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sampleStack" TEXT,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "count" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "specId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ErrorGroup_projectId_fingerprint_key" ON "ErrorGroup"("projectId", "fingerprint");
CREATE INDEX "ErrorGroup_projectId_lastSeenAt_idx" ON "ErrorGroup"("projectId", "lastSeenAt");
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ErrorEvent
CREATE TABLE "ErrorEvent" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "environment" TEXT NOT NULL,
  "release" TEXT,
  "context" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ErrorEvent_groupId_receivedAt_idx" ON "ErrorEvent"("groupId", "receivedAt");
CREATE INDEX "ErrorEvent_projectId_receivedAt_idx" ON "ErrorEvent"("projectId", "receivedAt");
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
