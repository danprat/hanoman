-- SPEC-337 · ADR-0075 · relasi integrasi/dependency antar project (LOCAL-only, tak disync).
-- Aditif: satu tabel baru. Tak menyentuh kolom mana pun yang sudah ada.
CREATE TABLE "ProjectLink" (
  "id"            TEXT NOT NULL,
  "fromProjectId" TEXT NOT NULL,
  "toProjectId"   TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "note"          TEXT NOT NULL DEFAULT '',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectLink_fromProjectId_toProjectId_key" ON "ProjectLink"("fromProjectId", "toProjectId");
CREATE INDEX "ProjectLink_toProjectId_idx" ON "ProjectLink"("toProjectId");

ALTER TABLE "ProjectLink" ADD CONSTRAINT "ProjectLink_fromProjectId_fkey"
  FOREIGN KEY ("fromProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectLink" ADD CONSTRAINT "ProjectLink_toProjectId_fkey"
  FOREIGN KEY ("toProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
