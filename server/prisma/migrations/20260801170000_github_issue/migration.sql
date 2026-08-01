-- SPEC-471 · ADR-0095 · cermin issue GitHub sebagai record lokal (pola Ticket, ADR-0062).
--
-- Tabel baru → `CREATE TABLE` polos; tak ada redefinisi tabel.
-- `id` deterministik "<projectId>:<owner>/<repo>#<number>" ditulis aplikasi, bukan default DB —
-- itulah yang mencegah dua mesin melahirkan dua baris untuk issue yang sama.
-- `specId` sengaja TANPA FOREIGN KEY, cermin Ticket.specId: changefeed bisa memancarkan
-- GithubIssue sebelum Spec-nya mendarat (kelas SPEC-382), dan FK akan menolaknya.
CREATE TABLE "GithubIssue" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "projectId"      TEXT NOT NULL,
    "repoSlug"       TEXT NOT NULL,
    "number"         INTEGER NOT NULL,
    "title"          TEXT NOT NULL,
    "body"           TEXT NOT NULL,
    "authorLogin"    TEXT NOT NULL,
    "labels"         JSONB NOT NULL,
    "url"            TEXT NOT NULL,
    "issueState"     TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'new',
    "specId"         TEXT,
    "issueCreatedAt" DATETIME NOT NULL,
    "issueUpdatedAt" DATETIME NOT NULL,
    "pulledAt"       DATETIME NOT NULL,
    "version"        INTEGER NOT NULL DEFAULT 0,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL,
    CONSTRAINT "GithubIssue_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GithubIssue_projectId_status_idx" ON "GithubIssue" ("projectId", "status");
