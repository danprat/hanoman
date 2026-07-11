# SPEC-175 · Rebase & Merge Backlog — Design

**Status:** approved (brainstorm)
**Sumber:** brief · prioritas tinggi
**Objective:** tambahkan aksi **rebase** dan **merge** pada backlog & terminal, munculkan dialog target-nya. Kalau ada conflict, selesaikan pakai claude. Hanya untuk backlog item yang sudah **done**.

## Konteks

- Backlog item = baris `Spec` (`stage` `brainstorming`→`done`, `branchFrom`).
- Sebuah spec yang **done** meninggalkan branch hasil kerja `hanoman/<id>` — agen `git push origin HEAD:refs/heads/hanoman/<id>` di akhir run (SPEC-162, `runner/src/prompt.ts`). Lokal branch itu ada sebagai remote-tracking `refs/remotes/origin/hanoman/<id>`; `refs/heads` sendiri umumnya cuma `main`.
- Prompt run menutup dengan: *"Manusia yang me-review dan merge branch."* SPEC-175 memberi manusia tombol untuk rebase/merge itu dari dashboard.
- Sesi = `claude` interaktif di worktree lewat tmux (`createSession(projectId, cwd, { prompt })`, `server/src/services/pty.ts`). **Server tak pernah menyentuh working tree utama** (CLAUDE.md; memory "Shared main worktree").

## Keputusan arsitektur

**Server jalankan git langsung; claude hanya saat conflict.** Untuk operasi yang bersih (mayoritas) tak ada sesi claude — cepat & deterministik. Conflict → spawn sesi claude di worktree konflik itu, dibuka di Terminal untuk resolve + finalisasi. Ini membaca "jika ada conflict solve menggunakan claude" secara harfiah.

Alternatif yang ditolak: *selalu* lewat sesi claude (satu jalur, tapi bayar satu giliran claude tiap merge bersih — boros & kurang deterministik untuk operasi git murni).

## Source & target

- **Source** (implisit, tak dipilih): branch spec `hanoman/<id>` — resolve `refs/remotes/origin/hanoman/<id>` → fallback `refs/heads/hanoman/<id>`. Tak ada → `409`.
- **Target** (dipilih user, "dialog target"): branch **lokal ATAU origin** — user yang tentukan tujuannya. Dialog menampilkan dua grup:
  - **Lokal** — `refs/heads/*` (value `local:<b>`)
  - **Origin** — `refs/remotes/origin/*` minus `HEAD` (value `origin:<b>`)
- `GET /projects/:id/branches` diperluas: `{ branches, remotes }` (aditif; dropdown `branchFrom` SPEC-143 tetap pakai `branches` saja).

## Endpoint — `POST /specs/:id/integrate`

Body: `{ op: "merge" | "rebase", target: string }` (`zIntegrate` di `shared/src/dto.ts`).

Guard berurutan:
1. spec ada (`404`), `spec.stage === "done"` (`409` — hanya done).
2. `target` valid (`local:<b>` cocok `refs/heads`, `origin:<b>` cocok `refs/remotes/origin`) → else `400`.
3. source ref `hanoman/<id>` ada → else `409`.

Best-effort `git fetch origin` (abaikan gagal/offline). Semua git jalan di worktree isolasi `<repoDir>/.worktrees/merge-<id>`, di-reclaim tiap panggil (pola `realGit.addWorktree`: remove+prune+rm-rf lalu add) — **tak menyentuh working tree utama**.

| op | base worktree (detached) | operasi | finalisasi bila **bersih** |
|----|----|----|----|
| **merge** | tip target (`refs/heads/<b>` atau `refs/remotes/origin/<b>`) | `git merge --no-edit <source>` | target **lokal**: `git branch -f <b> HEAD` · target **origin**: `git push origin HEAD:refs/heads/<b>` |
| **rebase** | `<source>` (`hanoman/<id>`) | `git rebase <targetTip>` | selalu `git push --force-with-lease origin HEAD:refs/heads/hanoman/<id>` |

Catatan mekanik:
- **Merge ke lokal + branch sedang di-checkout** (mis. `main` di working tree bersama): `git branch -f` **gagal aman** (git menolak update branch yang ter-checkout) — tak ada korupsi. Respons `409`, toast menyarankan pilih target origin. *ponytail: safe-fail; upgrade = update-ref hanya bila kita pemilik checkout.*
- **Merge ke origin, push non-fast-forward** (origin sudah maju): push ditolak git → `409` "target maju di origin, fetch dulu". Tak ada korupsi.
- **Rebase**: local vs origin cuma memilih tip yang di-rebase-onto; hasil tak pernah menulis target, selalu force-push ke branch spec.

Hasil:
- Bersih → hapus worktree, `{ status: "clean", detail: "<ref yang diperbarui/di-push>" }`.
- Conflict (`git` exit ≠ 0) → **tinggalkan** worktree konflik, `createSession(projectId, wt, { id: "merge-<id>", specId, prompt })`. Prompt: konteks ("kamu di tengah `<op>` `hanoman/<id>` ke/atas `<target>`"), instruksi resolve konflik + selesaikan, lalu **perintah finalisasi persis** (branch-f / push / force-push sesuai op & tujuan). `{ status: "conflict", sessionId }`.

Sesi konflik **tak ber-flow** → tak menggerakkan stage. Worktree-nya dibersihkan saat sesi ditutup (perluas `DELETE /terminal/sessions/:id`: sesi tanpa flow yang cwd-nya di `<repoDir>/.worktrees/*` tetap dihapus worktree-nya).

## UI

- **Backlog** — `SpecDetail` (khusus `done`, dekat "Buka sesi lagi", `src/src/screens/BacklogScreen.tsx`): section **Integrasi** = `Select` target dua-grup (pakai `branches`+`remotes` yang di-fetch di modal) + tombol **Rebase** / **Merge**, tiap tombol lewat konfirmasi kecil (Modal).
- **Terminal** — header `Cell` untuk sesi ber-`specId` (`src/src/screens/TerminalScreen.tsx`): ikon `git-merge` membuka dialog target yang sama (sejajar ikon `git-compare`/`file-text`).
- Callback `onIntegrate(spec, op, target)` bubble ke `App`: `status === "conflict"` → `setSection("terminal")` + toast; `"clean"` → toast sukses. Persis pola `startSession`.
- `api.integrateSpec(id, op, target)` + `paths.specIntegrate(id)` di client.

## Error handling

Non-done → 409 · target asing → 400 · source hilang → 409 · merge-lokal ke branch ter-checkout → 409 · push non-ff → 409. Semua bertoast jelas di UI (pola toast App yang ada).

## Testing

**Server (`server/test`):**
- merge bersih → target lokal: `refs/heads/<b>` maju ke commit merge, worktree terhapus, `{status:"clean"}`.
- merge bersih → target origin: push ref benar (verifikasi lewat remote bare test), worktree terhapus.
- rebase bersih: force-push ke `hanoman/<id>` (commit ter-replay di atas target), worktree terhapus.
- conflict: sesi `merge-<id>` dibuat, worktree konflik tetap ada, `{status:"conflict",sessionId}`.
- guard: non-done → 409, target asing → 400, source hilang → 409.
- DELETE sesi konflik menghapus worktree-nya.

**UI (`src/test`):**
- Dialog Integrasi hanya muncul untuk spec `done`.
- Pilih target + klik Rebase/Merge memanggil `onIntegrate` dengan `(spec, op, target)` benar.
- Terminal Cell menampilkan ikon merge hanya untuk sesi ber-specId.

## Docs tersentuh (di commit yang sama saat Execute)

- `internal/docs/requirements/**` — EARS untuk rebase/merge backlog.
- `internal/docs/entrypoints/**` — `POST /specs/:id/integrate`, `GET .../branches` (field `remotes`).
- `internal/docs/adr/**` — ADR baru (nomor dialokasikan saat execute; enumerate lintas worktree dulu — memory "ADR/SPEC number collisions"): keputusan server-git-with-claude-on-conflict + never-touch-main-working-tree + branch-f safe-fail.
- `internal/docs/README.md` — index ADR baru.
- Tanpa migration (tak ada perubahan skema — source diturunkan, target dipilih saat panggil).

## Skip (YAGNI)

- Tak update `main` lokal diam-diam saat ter-checkout (safe-fail, saran origin).
- Tak ada squash / pembuatan PR / GitHub API.
- Satu endpoint `op` alih-alih dua route.
- Source branch tak disimpan di Spec (diturunkan dari konvensi id).
