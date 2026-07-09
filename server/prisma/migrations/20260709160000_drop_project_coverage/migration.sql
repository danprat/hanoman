-- SPEC-141 / ADR-0018: coverage is derived from the filesystem at read time, not stored.
ALTER TABLE "Project" DROP COLUMN IF EXISTS "docStatus",
                      DROP COLUMN IF EXISTS "coverage";
