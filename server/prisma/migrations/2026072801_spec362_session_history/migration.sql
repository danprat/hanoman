-- SPEC-362 · ADR-0077 · riwayat sesi terminal (LOCAL-only, tak disync).
-- Aditif: satu tabel baru. Tak menyentuh kolom mana pun yang sudah ada.
CREATE TABLE "SessionHistory" (
  "id"              TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "specId"          TEXT,
  "title"           TEXT,
  "kind"            TEXT NOT NULL,
  "flow"            TEXT,
  "agent"           TEXT NOT NULL,
  "model"           TEXT,
  "effort"          TEXT,
  "branch"          TEXT,
  "cwd"             TEXT NOT NULL,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"         TIMESTAMP(3),
  "exitCode"        INTEGER,
  "transcriptKey"   TEXT,
  "transcriptBytes" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionHistory_projectId_startedAt_idx" ON "SessionHistory"("projectId", "startedAt");
CREATE INDEX "SessionHistory_specId_idx" ON "SessionHistory"("specId");
CREATE INDEX "SessionHistory_sessionId_idx" ON "SessionHistory"("sessionId");
