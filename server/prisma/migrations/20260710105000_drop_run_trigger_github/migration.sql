-- SPEC-162 · Pekerjaan dikerjakan claude interaktif di dalam tmux, satu sesi per backlog
-- item. Tak ada lagi eksekusi headless, jadi tak ada antrean, tak ada worker, dan tak ada
-- state run di database. Lihat ADR-0024.
--
-- DESTRUKTIF DAN DISENGAJA: riwayat run tidak dipertahankan. Yang tersisa dari sebuah run
-- adalah commit-nya di `branchTo` — dan itu memang catatan yang sebenarnya.

-- DropForeignKey
ALTER TABLE "Run" DROP CONSTRAINT "Run_projectId_fkey";
ALTER TABLE "Trigger" DROP CONSTRAINT "Trigger_projectId_fkey";

-- DropTable
DROP TABLE "Run";
DROP TABLE "Trigger";
DROP TABLE "GithubInstallation";

-- AlterTable · `installationId` melayani GitHub App (token push run headless); `repoUrl`
-- tak pernah dibaca untuk apa pun selain diteruskan ke UI.
ALTER TABLE "Project" DROP COLUMN "installationId",
                      DROP COLUMN "repoUrl";
