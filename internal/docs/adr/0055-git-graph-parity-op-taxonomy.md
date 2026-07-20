# ADR-0055 — Git graph parity: taksonomi operasi + eksekusi berlapis

**Status:** accepted · **Date:** 2026-07-20 · **Spec:** SPEC-233
**Terkait:** [ADR-0034](0034-ide-mutasi-working-tree-utama.md) (IDE mutasi working tree, gate sesi + force),
[ADR-0053](0053-git-graph-merge-worktree-isolasi-sesi-claude.md) (merge isolasi + handoff sesi claude — pola yang ditiru),
[ADR-0018](0018-coverage-nilai-turunan.md) (read diturunkan tiap request), [ADR-0049](0049-config-runtime-store-registry.md)
(config runtime store + registry), [ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree)

## Context
Git graph hanoman (SPEC-182/206/229) baru menutup sebagian kapabilitas ekstensi VS Code **Git Graph**
(mhutchie): visualisasi DAG, detail commit, dan operasi checkout/branch/merge/cherry-pick/revert/
delete-branch. Brief SPEC-233 meminta **parity penuh** — seluruh operasi commit/branch/tag/stash/
uncommitted, compare dua commit, find/search, detail-diff, kontrol tampilan, integrasi (PR/issue/
remote/archive), dan config namespace — langsung dari dashboard, **tanpa** operator jatuh ke terminal
untuk perintah git rutin.

Menambah belasan operasi menuntut satu keputusan sikap: **bagaimana** tiap operasi dijalankan relatif
terhadap working tree utama (yang bisa menampung sesi Claude berjalan) dan gate keamanan yang ada.
Menjalankan semua di working tree utama tanpa pandang bulu berbahaya (reset --hard, clean, rebase bisa
merusak state sesi); menjalankan semua di worktree isolasi tak bermakna untuk operasi yang **memang**
menyasar working tree (reset, stash, clean).

## Decision
**Setiap operasi git graph diklasifikasikan ke salah satu dari tiga kelas eksekusi**, dan jalur
kode + gate mengikuti kelasnya:

1. **Ref-only / non-konflik** — tak menyentuh working tree: `tag`/`delete-tag`/`push-tag`,
   `rename-branch`, `push-branch`, `fetch`, `stash-drop`. Jalan langsung lewat `runGitOp`
   (`POST /projects/:id/git`), **tanpa** gate sesi (predikat `touchesTree(op) === false`). Aman
   dijalankan walau ada sesi aktif — tak memindah HEAD/working tree.
2. **Menyasar working tree** — `reset` (soft/mixed/hard), `reset-worktree`, `clean`, `stash`/
   `stash-apply`/`stash-pop`/`stash-branch`, ditambah op lama (checkout/merge/cherry-pick/revert/
   branch/delete-branch). Jalan di **working tree utama** lewat `runGitOp`, **digerbang sesi aktif +
   escape `force`** (ADR-0034). Isolasi tak bermakna: semantiknya memang working tree utama. Op
   ireversibel (reset --hard, clean, drop) sudah diperingatkan oleh `ForceDialog` yang ada
   ("Paksa bisa membuang perubahan tak ter-commit").
3. **Rawan konflik / rewrite history** — `rebase` (current onto commit/branch), `pull` (remote →
   current), `drop` (buang satu commit). Jalan di **worktree isolasi** (pola `mergeIntoCurrent`,
   ADR-0053): deterministik dulu; bersih → pindahkan ref branch current (`git branch -f` / ff di
   owner) atau push; **konflik → spawn sesi claude** di worktree itu, UI pindah ke Terminal. Endpoint
   terpisah `POST /projects/:id/git/rebase|pull|drop` mirror `POST /projects/:id/git/merge` — bentuk
   response `{ status:"clean"|"conflict", ... }`, bukan `GitOpResult`.

Predikat tunggal **`touchesTree(op: GitOp): boolean`** (di `git-ide.ts`) menentukan gate di
`POST /projects/:id/git`: hanya op kelas-2 (dan op lama) digerbang; kelas-1 lolos. Op kelas-3 tak
lewat `POST /git` sama sekali.

**Read baru diturunkan live tiap request** (ADR-0018) — `status` (`git status --porcelain`), `stashes`
(`git stash list`), `remotes` (`git remote -v`), `commit/:sha/file` (diff vs parent), `compare`
(`git diff a..b`), `graph/search` (`git log --grep/--author`), `archive` (stream `git archive`).
**Tanpa kolom/model Prisma baru, tanpa migration.**

**Preferensi tampilan** (warna, style rounded/angular, show/hide remote/tag/stash/uncommitted, mute,
tanggal, initialLoad, fetchAvatars, issue-link pattern, emoji/markdown) disimpan lewat
**`CONFIG_REGISTRY` grup `gitGraph`** (ADR-0049) — bukan tabel baru.

## Alternatif ditolak
- **Semua op di working tree utama, gate seragam** — sederhana tapi rebase/pull/drop yang konflik
  meninggalkan working tree utama rusak mid-operation (persis bug SPEC-229 yang ADR-0053 perbaiki).
- **Semua op di worktree isolasi** — tak bermakna untuk reset/stash/clean yang memang menyasar
  working tree utama; menambah worktree ephemeral untuk operasi trivial (tag/rename) itu boros.
- **Model/tabel untuk stash & tag** — melanggar ADR-0011/0018 (read = filesystem nyata). Git sendiri
  sudah sumber kebenaran; membaca live tiap request lebih sederhana & tak pernah basi.
- **Config di tabel baru** — ADR-0049 sudah menyediakan store+registry runtime; grup `gitGraph`
  menumpang di sana.

## Consequences
- `GitOp` union membengkak (~13 op baru) di **dua** tempat selaras: `server/src/services/git-ide.ts`
  dan `src/src/api/client.ts`. `validateGitOp`/`gitArgs`/`touchesTree` diperluas seiring.
- Tiga endpoint isolasi baru (`/git/rebase|pull|drop`) menambah fungsi di `integrate.ts` yang
  **reuse** mesin `mergeIntoCurrent` (worktree, finalize, handoff sesi claude) — bukan mesin baru.
- Interactive-rebase (todo-editor) **tidak** ditiru harfiah; hanoman menyerahkan resolusi konflik
  rebase ke **sesi claude/terminal**. SCM panel, tab-icon, status-bar, keybinding-rebindable khas
  VS Code dihilangkan (tak berpadanan di dashboard). Gravatar **default off** (jaringan eksternal).
- Tanpa perubahan skema/migration. Read git graph tetap dep-free & stateless.
