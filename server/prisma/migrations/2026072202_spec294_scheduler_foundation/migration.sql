-- SPEC-294 · ADR-0072 · fondasi scheduler: antrean durable (LOCAL-ONLY, tak disync) + opt-in per project.
-- Aditif: satu tabel baru + satu kolom default. Tak menyentuh kolom lama.

-- Antrean durable kandidat peluncuran. specId UNIQUE = idempoten satu-sesi-per-spec (ADR-0015).
CREATE TABLE "SchedulerQueueItem" (
  "id"          TEXT NOT NULL,
  "specId"      TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "priority"    TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'queued',
  "sessionId"   TEXT,
  "note"        TEXT,
  "enqueuedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "launchedAt"  TIMESTAMP(3),
  CONSTRAINT "SchedulerQueueItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchedulerQueueItem_specId_key" ON "SchedulerQueueItem"("specId");
CREATE INDEX "SchedulerQueueItem_status_idx" ON "SchedulerQueueItem"("status");

-- Opt-in per project (gerbang kelayakan semua source). Pola helpEnabled. Tak masuk FIELDS sync -> lokal.
ALTER TABLE "Project" ADD COLUMN "schedulerOptIn" BOOLEAN NOT NULL DEFAULT false;
