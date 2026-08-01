-- SPEC-485 · ADR-0102 · rantai keputusan lead + pilihan jamak.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu tabel baru + empat kolom NULLABLE tanpa default, tak ada tabel
-- diredefinisi, tak ada baris disentuh. Larangan SQLite atas `ADD COLUMN … DEFAULT <non-konstan>`
-- (lihat migration SPEC-408) tak berlaku di sini karena tak ada default sama sekali pada ALTER.
--
-- `LeadFlow` LOCAL-only: tanpa kolom `version`, tak pernah masuk changefeed sync — barisnya
-- menunjuk sesi tmux & worktree di MESIN INI, persis alasan `LeadDecision` juga tak disync.
CREATE TABLE "LeadFlow" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "projectId"   TEXT NOT NULL,
    "specId"      TEXT,
    "sessionId"   TEXT,
    "gate"        TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'menunggu',
    "title"       TEXT NOT NULL,
    "steps"       INTEGER NOT NULL DEFAULT 0,
    "closeReason" TEXT,
    "openedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"    DATETIME,
    "expiresAt"   DATETIME NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL
);
CREATE INDEX "LeadFlow_projectId_createdAt_idx" ON "LeadFlow"("projectId", "createdAt");
CREATE INDEX "LeadFlow_status_idx" ON "LeadFlow"("status");

-- `choices` menggantikan pasangan skalar `choice`/`choiceIndex` sebagai bentuk yang berlaku; yang
-- lama DIPERTAHANKAN dan diisi dari `choices[0]` supaya pembaca lama (dan baris pra-migrasi) tetap
-- terbaca tanpa backfill apa pun.
ALTER TABLE "LeadDecision" ADD COLUMN "flowId" TEXT;
ALTER TABLE "LeadDecision" ADD COLUMN "step" INTEGER;
ALTER TABLE "LeadDecision" ADD COLUMN "choices" JSONB;
ALTER TABLE "LeadDecision" ADD COLUMN "select" JSONB;
CREATE INDEX "LeadDecision_flowId_idx" ON "LeadDecision"("flowId");
