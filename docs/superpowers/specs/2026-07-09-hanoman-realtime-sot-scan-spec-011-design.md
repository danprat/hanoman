# SPEC-011 — Realtime Source-of-Truth scan (whole-repo Markdown, edit/delete on disk)

**Status:** approved (design)
**Date:** 2026-07-09
**Replaces:** the DB-backed `DocFile` docs storage from the earlier docs-guardrail work

## Objective

Make hanoman's Source-of-Truth view reflect the **real project on disk in realtime**,
covering **every Markdown document in the repo** — not just `internal/docs/**`, and not a
Postgres copy. The user browses, edits, and deletes the **actual files** from the dashboard,
and hanoman scores **SoT Coverage** from those live files.

## Why

Docs are 100% DB-backed today. `DocFile` (Postgres) holds `path/content/linked/category`.
`POST /scan` reads that table, `GET/PUT /docs` read/write it. The demo seed was removed
(DB kept empty for real use), so **the table is empty → scan yields 0%, the docs workspace
is blank**. The feature is dead in real use. Meanwhile a real-file scanner already exists in
the CLI (`walkDocs` + `parseIndex` + `catStatus`) but only walks `internal/docs/**` during run
guardrails. This spec deletes the DB copy and points the whole feature at `Project.repoDir`.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Document corpus | **Markdown only** — every `**/*.md` in the repo |
| SoT Coverage meaning | **% categories reachable from a root index** (transitive link graph) |
| `DocFile` table | **Removed** — Prisma migration + ADR |
| Edit/delete target | **The real file on disk** (not DB) |
| Freshness / staleness | Out of scope (coverage = reachability only) |

## Architecture

### 1. Corpus & walk (server-side, live)

List Markdown with git so `.gitignore` does the exclusion work:

```
git ls-files --cached --others --exclude-standard -- '*.md'   # run in repoDir
```

This yields tracked + new-untracked `.md`, and skips `node_modules/.worktrees/dist` for free —
no hand-maintained denylist. If `repoDir` is null (from-scratch project) or not a git repo:
empty tree, coverage 0, a "no repo linked" state. No throw.

### 2. SoT Coverage scoring

- **Root index resolution:** config `indexPath` → else `internal/docs/README.md` if it exists
  → else repo `README.md`. No index found → all unlinked, coverage 0.
- **Linked = transitively reachable** from the root index, following Markdown links
  (`](path)`) file→file (BFS over the `.md` link graph). Direct-links-from-one-file (today's
  `parseIndex`) would mark a normal hierarchical docs tree as mostly unlinked repo-wide, so we
  walk the graph.
- **Coverage = % of top-level categories fully reachable** — reuses existing
  `coverageOf({category, linked}[])` and `docStatusFor` **unchanged**, so the category tree UI
  and status thresholds don't move.

**Metric lives in `@hanoman/shared`, pure, no `node:fs`:**

```ts
// shared/src/coverage.ts (extend) — pure, safe for the web bundle
export function linkedSetFrom(
  indexRel: string,
  docs: string[],
  read: (rel: string) => string | null,   // caller supplies fs
): Set<string>
```

BFS from `indexRel`: read each file, extract `](link)` targets, resolve relative to the file's
dir, keep those in `docs`, enqueue unvisited. Returns the reachable set (index included).
`node:fs` stays out of the shared barrel (`index.ts`) — the **web** bundles that barrel and Vite
would break on `node:*`. Server and CLI each supply a ~10-line fs adapter that passes `readFileSync`
as `read`. One definition, no drift.

### 3. API — realtime, disk-backed

All paths already exist except `DELETE`. Handlers switch from Prisma to fs under `repoDir`.

| Route | Behavior |
|-------|----------|
| `GET /projects/:id/docs` | Walk + score on the spot; return `{ coverage, tree }` |
| `GET /projects/:id/docs/*path` | Read the real file |
| `PUT /projects/:id/docs/*path` | Write the real file |
| `DELETE /projects/:id/docs/*path` | **New** — `fs.rm` the real file |
| `POST /projects/:id/scan` | Recompute from disk, persist `Project.coverage` + `docStatus` |

**Path-safety guard** (write + delete): `resolve(repoDir, rel)` must stay inside `repoDir` and
end in `.md` — rejects `../` traversal and any `.git` write. Reuses the containment posture from
`routes/fs.ts` (localhost single-user tool).

`GET /docs` re-scans per request (naive; `ponytail:` comment marks it — add a HEAD/mtime cache
only if a big repo makes it slow). Browsing is therefore always live; `scan` only refreshes the
cached `Project.coverage` number that the projects/overview lists read without re-walking.

### 4. Web

- **Per-project "Scan" button** in the Docs workspace header → `api.scanProject(id)`, then
  refresh tree + coverage. ("Scan semua" already loops `scanProject` and now hits real files.)
- **"Hapus" button** beside Edit → confirm → `api.deleteDoc(id, path)` → drop from tree, select
  a sibling.
- Remove hardcoded `internal/docs` labels (breadcrumb, eyebrow, `displayPath`) — show the real
  repo-relative path / repo name.
- `api.deleteDoc` added to `src/src/api/client.ts`; `paths.docFile` already covers the URL.

### 5. DB / migration / tests

- Drop `DocFile` model + relation on `Project` → Prisma migration + **ADR** (per CLAUDE.md
  "jangan ubah skema tanpa migration + ADR").
- Rewrite `server/src/services/docs.ts` fs-backed; delete `writeDoc` DB upsert.
- `server/test/factory.ts` + docs tests: point a project at a **temp git repo** seeded with real
  `.md` files instead of inserting `DocFile` rows.

## Out of scope (noted, not built)

- File watcher / SSE push for docs — polling `scan` + live `GET` is enough.
- Migrating the CLI run-guardrail (`collectViolations`) onto `linkedSetFrom` — it *can* adopt the
  shared metric later for free, but that's a separate change; this spec leaves the guardrail on
  `internal/docs`.
- Creating brand-new docs from the UI (edit/delete existing only).
- Non-Markdown documents (json/toml/yaml/code) — Markdown only.

## Testing

- `linkedSetFrom` — pure unit tests: transitive reach, cyclic links, external/anchor links
  ignored, missing index.
- Coverage end-to-end against a temp repo fixture (tracked + untracked `.md`, gitignored dir
  excluded).
- API: `PUT` then read-back on disk; `DELETE` removes the file; traversal + non-`.md` rejected
  (400); missing `repoDir` → empty/0, no crash.
- Real local smoke per CLAUDE.md: boot server, `curl` `GET/PUT/DELETE /docs` + `POST /scan`
  against a real repo, confirm the file on disk actually changed.

## Open questions — resolved

- Per-file vs per-category coverage → **per-category** (reuse `coverageOf`, keep tree UI).
- Soft-delete/trash vs real `fs.rm` → **real `fs.rm`** (user asked to delete the original file).
