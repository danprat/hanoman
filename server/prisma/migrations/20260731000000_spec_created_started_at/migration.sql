-- SPEC-408 · ADR-0090 · stempel waktu backlog: `Spec.createdAt` + `Spec.startedAt`.
--
-- SQLite melarang `ALTER TABLE … ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (default non-konstan),
-- jadi kolom ber-default waktu HARUS lewat redefinisi tabel. Redefinisi itu sekaligus tempat
-- backfill baris lama: `updatedAt` adalah satu-satunya jejak waktu yang pernah ada, dan `baseSha`
-- adalah penanda "pernah dikerjakan" yang sudah dipakai sistem (scheduler sources/backlog.ts).
-- Backfill ini APROKSIMASI dan dinyatakan terbuka di ADR-0090 — mengisinya dengan waktu migration
-- dijalankan akan membuat seluruh backlog lama tampak dibuat hari ini, yang lebih menyesatkan.
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

CREATE TABLE "new_Spec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "payload" JSONB,
    "branchFrom" TEXT,
    "baseSha" TEXT,
    "headSha" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Spec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Spec" ("id","projectId","title","source","stage","priority","author","objective","payload","branchFrom","baseSha","headSha","version","createdAt","startedAt","updatedAt")
SELECT "id","projectId","title","source","stage","priority","author","objective","payload","branchFrom","baseSha","headSha","version",
       "updatedAt",
       CASE WHEN "baseSha" IS NOT NULL THEN "updatedAt" ELSE NULL END,
       "updatedAt"
FROM "Spec";

DROP TABLE "Spec";
ALTER TABLE "new_Spec" RENAME TO "Spec";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
