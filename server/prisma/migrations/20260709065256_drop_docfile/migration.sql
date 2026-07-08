-- SPEC-011 / ADR-0010: docs are read live from the filesystem, not a DB copy.
-- DropForeignKey
ALTER TABLE "DocFile" DROP CONSTRAINT IF EXISTS "DocFile_projectId_fkey";

-- DropTable
DROP TABLE IF EXISTS "DocFile";
