-- SPEC-450 · ADR-0094 · katalog custom agent (global & per project), ikut changefeed sync.
--
-- Tabel baru → `CREATE TABLE` polos; tak ada redefinisi tabel seperti migration SPEC-408.
-- `id` deterministik "<projectId|global>:<name>" ditulis aplikasi, bukan default DB.
--
-- CATATAN indeks unik: pada SQLite, NULL saling BERBEDA di indeks unik, jadi baris ini TIDAK
-- mencegah dua agen global bernama sama. Yang mencegahnya adalah PK deterministik. Indeks tetap
-- dipasang sebagai jaring kedua untuk baris ber-project.
CREATE TABLE "CustomAgent" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "projectId"    TEXT,
    "name"         TEXT NOT NULL,
    "description"  TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "tools"        JSONB,
    "model"        TEXT,
    "mentions"     JSONB,
    "enabled"      BOOLEAN NOT NULL DEFAULT true,
    "version"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "CustomAgent_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomAgent_projectId_name_key" ON "CustomAgent" ("projectId", "name");
CREATE INDEX "CustomAgent_projectId_idx" ON "CustomAgent" ("projectId");
