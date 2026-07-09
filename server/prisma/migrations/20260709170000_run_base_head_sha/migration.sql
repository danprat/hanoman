-- SPEC-144: penunjuk commit milik run. Nullable, tanpa backfill.
ALTER TABLE "Run" ADD COLUMN "baseSha" TEXT;
ALTER TABLE "Run" ADD COLUMN "headSha" TEXT;
