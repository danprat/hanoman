-- SPEC-144: salinan DB dari state filesystem, tanpa produsen, append-only. Diturunkan
-- ulang dari git oleh services/run-changes.ts. Lihat ADR-0019.
ALTER TABLE "Run" DROP COLUMN "files";
