# SPEC-233 · Parity Git Graph hanoman vs ekstensi Git Graph (mhutchie)

**Status:** design (brainstorm terkunci) · **Prioritas:** tinggi · **Tanggal:** 2026-07-20
**Sumber:** brief SPEC-233 · **ADR baru:** 0055
**Keputusan scope (dikonfirmasi operator):** **Full parity** (grup 1–10) · **safety = gate sesi + konfirmasi force** (ADR-0034), operasi rawan-konflik pakai worktree isolasi + handoff sesi claude (ADR-0053).

## 1. Objective

Menutup gap kapabilitas antara git graph hanoman (`IdeScreen` → tab Git Graph, SPEC-182/206/229) dengan ekstensi VS Code **Git Graph** (mhutchie), sehingga operator dapat melakukan **seluruh** operasi visual-git ekstensi itu langsung dari dashboard hanoman — tanpa keluar ke terminal untuk perintah git rutin.

Batas yang tetap dijaga: hanoman **bukan** editor lokal — mutasi git tunduk pada **isolasi worktree** dan **gate sesi aktif + escape force** (ADR-0034/0037). Operasi yang bisa konflik dijalankan di worktree isolasi lalu, bila buntu, diserahkan ke sesi claude (pola ADR-0053). Tidak ada mutasi diam-diam terhadap working tree utama yang sedang menampung sesi.

## 2. Yang sudah ada (baseline)

- **Visualisasi**: DAG (`computeLanes`/`rowEdges`, `git log --all --date-order`, limit 200), refs sebagai pill, HEAD ditandai.
- **Detail commit**: subject/body + file berubah (A/M/D + numstat) — flat list, klik file → buka di Explorer (source, bukan diff).
- **Operasi (working tree, `POST /projects/:id/git`, gate sesi + force)**: checkout, branch (+checkout), merge (ff/no-ff/ff-only + deleteBranch), cherry-pick, revert, delete-branch (local/origin/keduanya).
- **Merge terisolasi** (`POST /projects/:id/git/merge`, ADR-0053): merge ke branch aktif di `.worktrees/merge-<b>`; konflik → sesi claude.
- **Integrate done**: `/specs/:id/integrate`, `/terminal/sessions/:id/integrate` (rebase/merge branch done).
- **Review/diff**: `ReviewScreen` + `DiffView` (VSCode-style) untuk spec & sesi.

## 3. Prinsip desain

1. **Reuse mesin yang ada.** `git-ide.ts` (`GitOp`/`runGitOp`/`gitArgs`/`validateGitOp`), `integrate.ts` (worktree isolasi + finalize + handoff claude), `DiffView`/`ReviewScreen` (render diff), `file-tree.tsx` (tree/flat), `CONFIG_REGISTRY` (ADR-0049). Tambah op, bukan mesin baru.
2. **Klasifikasi eksekusi per-op:**
   - **Ref-only / non-konflik** (tag buat/hapus/push, rename branch, fetch/prune, push branch, copy) → jalan langsung; **tidak** menyentuh working tree → **tidak** digerbang sesi.
   - **Menyasar working tree** (reset soft/mixed/hard, stash push/apply/pop/drop, clean untracked) → working tree utama, **gate sesi + force**. Isolasi tak bermakna (semantiknya memang working tree). reset --hard/clean bersifat ireversibel → `ForceDialog` yang ada sudah memperingatkan buang perubahan.
   - **Rawan konflik / rewrite history** (rebase-onto, drop commit, pull) → worktree isolasi (pola `mergeIntoCurrent`); bersih → pindahkan ref (`git branch -f`/ff owner) atau push; konflik → **sesi claude** di worktree itu.
3. **`--end-of-options` sebelum tiap argumen dari data** (SPEC-197) untuk semua op baru — cegah flag-injection, cermin `gitArgs` yang ada.
4. **Read diturunkan tiap request** (ADR-0018) — tak ada cache, tak ada kolom DB baru. Stash/status/tag dibaca live dari git.
5. **Tanpa perubahan skema** (tak ada model/kolom Prisma baru). Preferensi tampilan disimpan lewat CONFIG_REGISTRY (server, ADR-0049) — bukan tabel baru.
6. **Adaptasi, bukan tiruan harfiah VS Code.** Yang tak punya padanan di dashboard (integrated-terminal interactive-rebase, SCM panel, tab-icon, keybinding rebindable) diadaptasi: interactive rebase → serahkan ke sesi claude/terminal; sisanya dihilangkan dengan alasan tercatat.

## 4. Peta parity → paket kerja (PR)

Setiap PR = irisan vertikal (server op + wiring client + test + doc/kontrak) yang bisa mendarat & diuji sendiri. Urut menurun nilai.

### PR1 — Commit menu: reset + copy + tooltip
- **Server**: `GitOp` += `reset {sha, mode:"soft"|"mixed"|"hard"}` (`git reset --<mode> --end-of-options <sha>`, gate sesi + force). `validateGitOp`/`gitArgs`/`touchesTree`.
- **Client**: menu commit += "Reset current ke sini › Soft/Mixed/Hard", "Copy hash", "Copy subject" (clipboard, client-only). Tooltip vertex: berisi cabang/tag yang memuat commit (dihitung client dari refs+lanes; fase awal: refs pada commit).
- **Test**: `validateGitOp` reset; `runGitOp` reset (soft/mixed/hard) atas repo fixture; route 409 gate; menu.

### PR2 — Tag: buat / hapus / push / copy
- **Server**: `GitOp` += `tag {name, message?, at?, push?}` (`git tag [-a -m <msg>] --end-of-options <name> [<at>]`, opsional `git push origin --end-of-options <name>`), `delete-tag {name, remote?}` (`git tag -d` + opsional `git push origin --delete`), `push-tag {name}`. Ref-only → tak digerbang sesi. `listGraph` sudah membawa tag di `refs` (prefix `tag:` dilucuti — tandai tag agar client bisa bedakan: tambah field terpisah `tags:string[]` per commit ATAU pertahankan konvensi & derive).
- **Client**: menu commit += "Add tag…" (nama + pesan opsional + push). Menu ref-tag (klik-kanan pill tag) += "Delete tag", "Push tag", "Copy tag name", "View details" (annotated: `git cat-file tag`).
- **Test**: buat lightweight & annotated; hapus local+remote; validasi; parsing tag di graph.

### PR3 — Uncommitted changes (baris graph + operasi)
- **Server**: `GET /projects/:id/status` → `{ staged, unstaged, untracked, clean }` dari `git status --porcelain=v1 -z` + branch/ahead-behind. `GitOp` += `reset-worktree {mode:"mixed"|"hard"}` (`git reset --<mode>`), `clean {directories?}` (`git clean -fd [-x?]`). Gate sesi + force (ireversibel).
- **Client**: baris **Uncommitted changes** di puncak graph (lingkaran terbuka) bila ada perubahan; klik → panel diff working tree (reuse `DiffView` via endpoint working-tree diff yang ada / `/file?ref=`). Menu baris uncommitted: "Stash…" (→PR4), "Reset (mixed/hard)", "Clean untracked", "Buka Explorer".
- **Test**: status porcelain parse; reset-worktree; clean; baris muncul saat kotor.

### PR4 — Stash penuh
- **Server**: `GET /projects/:id/stashes` → `[{ ref, message, at }]` (`git stash list --format`). `GitOp` += `stash {message?, includeUntracked?}`, `stash-apply {ref, index?}`, `stash-pop {ref, index?}`, `stash-drop {ref}`, `stash-branch {ref, name}`. apply/pop menyasar working tree → gate; buat/drop → gate ringan.
- **Client**: stash tampil di graph (opsional baris/ref) + menu klik-kanan: Apply/Pop/Drop/Create-branch-from/Copy name/Copy hash. "Stash…" dari baris uncommitted.
- **Test**: create→list→apply→pop→drop siklus; stash-branch.

### PR5 — Branch ops: rename / push / pull / fetch
- **Server**: `GitOp` += `rename-branch {from,to}` (`git branch -m`), `push-branch {name, setUpstream?, force?}` (`git push [-u] [--force-with-lease] origin <name>`), `fetch {prune?, pruneTags?}` (`git fetch --all [--prune] [--prune-tags]`). `pull` (remote→current) rawan konflik → **PR6** (isolasi). Ref/remote → tak digerbang sesi kecuali yang memindah working tree.
- **Client**: **menu ref-branch** (klik-kanan pill branch — baru): Checkout, Rename…, Delete (local/remote/both — pindah dari menu commit), Merge into current, Push…, Copy name. Toolbar: tombol Fetch (+prune).
- **Test**: rename; fetch prune; push (butuh remote fixture — bare repo lokal); validasi.

### PR6 — Rebase / pull / drop (isolasi, konflik→claude)
- **Server**: perluas `integrate.ts`: `rebaseOntoCurrent(repoDir, target)` (rebase branch aktif ke commit/branch di worktree isolasi; bersih → `git branch -f`/push; konflik → claude), `pullIntoCurrent(repoDir, remoteBranch, {ff,squash})`, `dropCommit(repoDir, sha)` (`git rebase --onto <sha>^ <sha>` di isolasi). Endpoint baru mirror `/git/merge`: `POST /git/rebase {onto}`, `POST /git/pull {source, ff?}`, `POST /git/drop {sha}` → `{status:"clean"|"conflict"|...}`.
- **Client**: menu commit += "Rebase current ke sini", "Drop commit". Menu ref-branch += "Rebase current ke branch". Menu remote-branch += "Pull into current". Konflik → pindah Terminal (sessionId), pola `mergeGraph`.
- **Test**: rebase clean (branch ref pindah); drop clean; konflik → sessionId; pull ff.

### PR7 — Commit detail: diff + tree + per-file actions + links + signature
- **Server**: `GET /projects/:id/commit/:sha/file?path=` → `{ path, status, binary, truncated, diff, content }` (diff commit vs parent, reuse pola `reviewFile`). `commitDetail` += `signed` (`%G?`), committer, tanggal committer.
- **Client**: panel detail → toggle **tree/flat** (reuse `file-tree.tsx`), klik file → **diff inline** (reuse `DiffView`) dengan tab Diff|Source|Working; aksi per-file: View diff, View at revision, Open, Copy abs/rel path. Body: link URL/issue/parent-hash klik (issue pattern dari config PR11). Badge signature.
- **Test**: commit-file diff endpoint; signature flag; tree toggle.

### PR8 — Compare dua commit
- **Server**: `GET /projects/:id/compare?from=&to=` → `{ from, to, changed[] }` + `.../compare/file?from=&to=&path=` → ReviewFile. (`git diff <from>..<to>`).
- **Client**: Ctrl/Cmd-klik commit kedua → mode **Compare** (banner "membandingkan A…B"), daftar file + diff (reuse `DiffView`), keluar via Esc.
- **Test**: compare changed + per-file; arah from/to.

### PR9 — Find / search commit
- **Server**: `GET /projects/:id/graph/search?q=&by=` (`git log --all` + `-i --grep`/`--author`/`-S`/hash-prefix) → daftar sha match. Fase awal boleh **client-side** atas commit ter-load, server untuk histori lebih dalam.
- **Client**: widget Find (Ctrl/Cmd-F) — cari di subject/author/hash/ref; navigasi match (n/N) + auto-scroll/center; hit di-highlight.
- **Test**: match message/author/hash; navigasi.

### PR10 — Kontrol tampilan graph
- **Server**: `GET /projects/:id/graph` terima `branches`, `showRemote`, `showTags`, `showStashes`, `showUncommitted` (filter `git log` refs / `--branches=<glob>`). Muted diturunkan (merge / non-ancestor HEAD via `--ancestry-path`? — hitung client dari parents).
- **Client**: dropdown filter branch (all / spesifik / glob), toggle show/hide (remote/tag/stash/uncommitted/untracked), muted commit (warna teks redup), tombol **center HEAD** (Ctrl/Cmd-H), kolom (Date/Author/Commit) resizable + show/hide (klik-kanan header), graph style rounded↔angular.
- **Test**: filter branch; toggle; muted derivation.

### PR11 — Integrasi: PR link · issue link · remote mgmt · archive
- **Server**: `GET /projects/:id/remotes` + `POST/PATCH/DELETE` (git remote add/set-url/remove) + fetch/prune. `GET /projects/:id/archive?ref=&format=` → stream `git archive` (download). PR-URL diturunkan dari `Project.gitRemote` (github/gitlab/bitbucket → URL compare/new). Issue-link pattern dari config.
- **Client**: menu branch += "Create Pull Request" (buka URL provider), "Create archive" (download). Body commit: nomor issue → hyperlink. Widget kelola remote (list/add/edit/delete/fetch/prune) di toolbar/settings IDE.
- **Test**: PR-URL derivation per provider; archive endpoint; remote CRUD.

### PR12 — Config namespace git-graph + avatar + emoji/markdown + label styling
- **Server**: tambah entri `CONFIG_REGISTRY` grup **gitGraph**: `graph.style` (rounded|angular), `graph.colours` (CSV), `date.type` (author|commit), `date.format`, `commits.initialLoad`, `commits.loadMore`, `repository.showRemoteBranches|showTags|showStashes|showUncommittedChanges|showUntrackedFiles`, `mute.mergeCommits|commitsNotOnHead`, `fetchAvatars`, `referenceLabels.combineLocalAndRemote|alignment`, `enhancedAccessibility`, `markdown`, `emoji`. `listGraph` bawa `%ae` (email) & committer bila avatar/mailmap aktif; `.mailmap` dihormati (`%aN`).
- **Client**: konsumsi config di render (warna, style, kolom default, mute, initialLoad/loadMore, tanggal). Avatar gravatar (md5 email, `fetchAvatars` default off — jaringan eksternal). Emoji shortcode (peta + gitmoji) & inline markdown di pesan/tag. Reference label combine + alignment.
- **Test**: registry entry valid; parse config; emoji/markdown render (unit); avatar url derivation.

## 5. Perubahan kontrak API (ringkas)

Ditambahkan ke `internal/docs/architecture/api-contract.md` bagian **IDE Visual**:

```
GET  /projects/:id/status                 # { branch, ahead, behind, staged[], unstaged[], untracked[], clean }
GET  /projects/:id/stashes                # [{ ref, message, at }]
GET  /projects/:id/remotes                # [{ name, fetch, push }]
GET  /projects/:id/commit/:sha/file?path= # { path, status, binary, truncated, diff, content }  (diff vs parent)
GET  /projects/:id/compare?from=&to=      # { from, to, changed:{path,add,del,status,binary}[] }
GET  /projects/:id/compare/file?from=&to=&path=  # ReviewFile
GET  /projects/:id/graph/search?q=&by=    # { shas: string[] }
GET  /projects/:id/archive?ref=&format=   # stream (download) git archive
POST /projects/:id/git   { op, ... }      # op += reset|reset-worktree|clean|tag|delete-tag|push-tag|
                                          #        stash|stash-apply|stash-pop|stash-drop|stash-branch|
                                          #        rename-branch|push-branch|fetch
POST /projects/:id/git/rebase { onto }    # { status:"clean"|"conflict", ... } (isolasi + claude)
POST /projects/:id/git/pull   { source, ff? }
POST /projects/:id/git/drop   { sha }
POST /projects/:id/remotes  {name,url} · PATCH · DELETE /projects/:id/remotes/:name
```

`GET /projects/:id/graph` menerima query filter opsional (`branches`, `showRemote`, `showTags`, `showStashes`, `showUncommitted`) — default = perilaku lama (`--all`).

Semua `GitOp` baru diverifikasi `validateGitOp`; yang menyentuh working tree tunduk gate sesi (`touchesTree`), sisanya tidak.

## 6. Di luar scope / adaptasi tercatat

- **Interactive rebase in-terminal** (todo-editor) → hanoman menyerahkan ke sesi claude/terminal, bukan editor todo in-UI.
- **SCM panel / tab-icon / status-bar / keybinding rebindable / retainContextWhenHidden** → khas VS Code, tak berpadanan; keyboard shortcut inti (Find, Center-HEAD, navigasi) tetap diadakan.
- **Gravatar** default **off** (jaringan eksternal; hormati privasi & CSP dashboard) — hanya aktif bila operator menyalakan `fetchAvatars`.
- **Nomor SPEC/ADR**: klaim ADR-0055 (maks lintas branch = 0054). Enumerasi ulang saat commit (sibling worktree bisa mereservasi sama).

## 7. Strategi test & DoD

- Unit per op (`validateGitOp`, `gitArgs`, `runGitOp`, service integrate) atas **repo fixture** (bare + working, buat via `git init` di tmp) — cermin pola test git-ide/integrate yang ada.
- Route test (Fastify inject) untuk tiap endpoint baru: happy path + 400 (validasi) + 409 (gate/konflik) + 404 (project/sha).
- **Test API nyata di local** tiap PR: boot `node server/dist/server.js` (DB throwaway ter-migrate), `curl` endpoint tersentuh (mengikuti wajib CLAUDE.md).
- Client: unit test komponen kritis (`git-graph.test.ts` sudah ada — perluas untuk uncommitted row, compare, find, menu ref-branch).
- **DoD**: `vitest run --no-file-parallelism` hijau · docs+kontrak tersentuh diperbarui & ter-link di `internal/docs/README.md` · ADR-0055 ditulis · tiap kotak plan `- [x]`.
