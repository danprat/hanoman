-- SPEC-384 · ADR-0092 · cabut error monitoring (SPEC-249/254/269/271/276/296) dan cross-audit
-- (SPEC-337). Pemantauan error produksi pindah ke Uptrace; data di bawah ini tak punya pembaca
-- lagi. DESTRUKTIF & TAK BISA DIBATALKAN.
--
-- Byte source-map hidup di HANOMAN_UPLOAD_DIR dengan nama opaque `<uuid>.map` — DIREKTORI YANG
-- SAMA dengan lampiran tiket. Migration SQL tak bisa menyentuh filesystem, jadi pembersihannya
-- adalah langkah runbook manual yang dijalankan SEBELUM migration ini: baca
-- `SELECT storageKey FROM SourceMapArtifact` lalu hapus tepat berkas-berkas itu (JANGAN direktorinya
-- — lampiran tiket ikut hilang). Lihat internal/docs/operations/production.md. Melewatkannya hanya
-- menyisakan byte inert.

-- `defer_foreign_keys` wajib berpasangan dengan `foreign_keys=OFF` di sini: Spec & Ticket memegang
-- FK ke "Project", dan rebuild di bawah menjatuhkan tabel itu sebelum penggantinya bernama sama.
-- Idiom yang sama dipakai migration SPEC-408.
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

-- 1. Tabel. ErrorEvent dulu (FK → ErrorGroup).
DROP TABLE IF EXISTS "ErrorEvent";
DROP TABLE IF EXISTS "SourceMapArtifact";
DROP TABLE IF EXISTS "ErrorGroup";
DROP TABLE IF EXISTS "ProjectLink";

-- 2. Project kehilangan kolom DSN. Table rebuild (pola Prisma untuk SQLite), bukan DROP COLUMN:
--    berkas DB ini bisa dibuka SQLite versi mana pun yang dibawa instalasi npm pengguna.
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repoDir" TEXT,
    "gitRemote" TEXT,
    "stack" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "helpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "schedulerOptIn" BOOLEAN NOT NULL DEFAULT false,
    "leadOptIn" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Project" ("id","name","desc","kind","repoDir","gitRemote","stack","createdAt","version","updatedAt","helpEnabled","schedulerOptIn","leadOptIn")
SELECT "id","name","desc","kind","repoDir","gitRemote","stack","createdAt","version","updatedAt","helpEnabled","schedulerOptIn","leadOptIn" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";

-- 3. Baris yang nilainya tak lagi sah menurut zod. Dibiarkan hidup, ia menggagalkan pembacaan
--    daftar notifikasi / backlog dengan galat parse — bukan dengan pesan yang berguna.
DELETE FROM "Notification" WHERE "type" = 'error';
-- Spec bersumber cross-audit DINORMALKAN, bukan dihapus: backlog item-nya pekerjaan nyata dengan
-- branch & dokumen; yang hilang cuma label asalnya.
UPDATE "Spec" SET "source" = 'audit' WHERE "source" = 'cross-audit';
DELETE FROM "SyncLog" WHERE "entity" = 'errorGroup';
DELETE FROM "SyncOutbox" WHERE "entity" = 'errorGroup';
DELETE FROM "SyncConflict" WHERE "entity" = 'errorGroup';
DELETE FROM "SchedulerQueueItem" WHERE "source" = 'errors';

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
