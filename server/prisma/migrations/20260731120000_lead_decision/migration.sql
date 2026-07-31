-- SPEC-409 · ADR-0091 · hanoman-lead: jejak keputusan + opt-in lead per project.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. Keduanya ADITIF — tak ada tabel yang diredefinisi, tak ada data yang disentuh.
--
-- `Project.leadOptIn` boleh lewat ALTER TABLE karena default-nya KONSTAN (`false`); larangan SQLite
-- hanya berlaku untuk default non-konstan seperti CURRENT_TIMESTAMP (lihat migration SPEC-408).
ALTER TABLE "Project" ADD COLUMN "leadOptIn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LeadDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "specId" TEXT,
    "sessionId" TEXT,
    "gate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refs" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'none',
    "status" TEXT NOT NULL DEFAULT 'berlaku',
    "weighty" BOOLEAN NOT NULL DEFAULT false,
    "supersededById" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'lead',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "LeadDecision_projectId_createdAt_idx" ON "LeadDecision"("projectId", "createdAt");
CREATE INDEX "LeadDecision_specId_idx" ON "LeadDecision"("specId");
CREATE INDEX "LeadDecision_sessionId_idx" ON "LeadDecision"("sessionId");
