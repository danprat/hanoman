# SPEC-172 — Reopen Session Backlog

## Objective
Bisa membuka (melanjutkan) sesi Claude lagi untuk backlog item yang stage-nya sudah
`done`. Aksi ini muncul **hanya di detail backlog** (`SpecDetail` modal) — di list, grid,
dan board **tidak perlu**.

Prioritas: sedang.

## Konteks & masalah nyata
hanoman kadang **klaim `done` terlalu dini**. Contoh: SPEC-162 punya 4 PR di spec-nya,
baru 1 PR beres tapi sesi berakhir dan stage naik ke `done`. Human perlu **melanjutkan
sesi claude yang sama** untuk menuntaskan 3 PR sisanya — bukan memulai fitur dari nol.

Fakta codebase yang relevan (semua di worktree ini):
- "Backlog item" = model `Spec`. "Session" = proses `claude` interaktif di tmux + git
  worktree, 1 sesi per spec (ADR-0015, ADR-0024). Bukan baris DB.
- Aksi per-item di **list/grid/board** semuanya lewat satu komponen `SpecActions`
  (`src/src/screens/BacklogScreen.tsx`). Saat `stage === "done"` komponen ini sengaja
  hanya menampilkan badge "selesai", tanpa aksi sesi. **Menaruh tombol reopen di sini
  akan bocor ke ketiga view** — jadi jangan disentuh.
- Detail backlog = komponen `SpecDetail` (modal) di file yang sama. Hari ini ia tak
  merender aksi sesi apa pun. Inilah tempat tombol reopen.
- "Buka sesi" = `startSession(spec)` di `src/src/App.tsx` → `POST /terminal/sessions`
  body `{ spec, flow }` → pindah ke Terminal. Endpoint **sudah** menerima spec `done`
  (tak ada guard stage di server).
- `POST /terminal/sessions` (spec branch, `server/src/routes/terminal.ts:37-63`): kalau
  sesi masih hidup → attach; kalau tidak → `addWorktree(repoDir, .worktrees/<id>,
  spec.branchFrom ?? "main")` lalu spawn `claude <startPrompt>`. **Tidak ada `--resume`** —
  claude selalu lahir fresh dengan prompt.
- `startPrompt` (`runner/src/prompt.ts:45`) menggiring **seluruh pipeline**
  `Brainstorm → Objective → Spec → Plan → Execute` lewat `phaseInstruction`. Untuk fitur
  ini itu **salah**: reopen tak boleh mengulang Brainstorm/Objective/Spec/Plan.
- **Phase file hidup di luar worktree** (`.worktrees/.phases/<id>`,
  `session-phases.ts:11`) → selamat dari penghapusan worktree. Plan
  (`docs/superpowers/plans/**`) memakai checkbox `- [ ]`/`- [x]` per task. Dua hal ini
  adalah mekanisme kontinuitas yang sudah ada: agen baca plan, lihat yang sudah `[x]`,
  selesaikan yang `[ ]`.

## Keputusan yang sudah diambil bersama user
1. **Tombol reopen hanya di `SpecDetail`.** Tidak di list/grid/board — jadi `SpecActions`
   tak disentuh.
2. **Reopen harus tetap di fase Execute** — jangan balik ke Objective/Brainstorm. Yang
   diinginkan adalah *melanjutkan* sesi, bukan me-restart fitur.
3. **Stage tetap `done`.** Tidak di-revert. (Kalau di-revert, item akan muncul lagi di
   list/grid/board sebagai aktif — melanggar keputusan #1.)
4. **Tanpa perubahan server yang menyentuh pemilihan worktree.** Worktree tetap dari
   `branchFrom`/`main`; PR yang sudah selesai umumnya sudah ter-merge ke `main` (pola
   repo ini), dan plan berisi checkbox — cukup untuk agen melanjutkan.

## Desain

### 1. Runner — prompt "lanjutkan" (`runner/src/prompt.ts`)
Tambah `continuePrompt(flow, spec, branchTo)` — varian `startPrompt` yang **tidak**
menggiring pipeline dari awal:
- Nyatakan ini **melanjutkan** backlog item yang ditandai selesai padahal belum tuntas.
- Instruksikan: **JANGAN** ulang Brainstorm/Objective/Spec/Plan — spec & plan sudah ada.
  Lanjut di **Execute**: baca plan di `docs/superpowers/plans/**` untuk backlog item ini,
  periksa task `[x]`, selesaikan yang `[ ]`, verifikasi nyata sebelum klaim selesai.
- Reuse `skillInstruction(["Execute"])` (executing-plans, TDD, verification).
- Tetap tutup dengan instruksi commit + `git push origin HEAD:refs/heads/<branchTo>` dan
  blok "Backlog item …/Objective …" seperti `startPrompt`.
- **Tanpa** `phaseInstruction`: kita tak menjalankan pipeline, jadi tak menuntut agen
  menulis berkas fase. Phase file lama (`Execute done`) tetap ada; stage tetap `done`.

### 2. Server — pilih prompt berdasar stage (`server/src/routes/terminal.ts`)
Di cabang `"spec" in parsed.data`, saat membuat sesi baru, pilih prompt:
```ts
prompt: (spec.stage === "done" ? continuePrompt : startPrompt)(parsed.data.flow, {…}, `hanoman/${id}`),
```
Deteksi otomatis dari `spec.stage === "done"` — tanpa menambah field ke body/tipe request.
Aman karena satu-satunya jalur yang memicu start pada spec `done` adalah tombol reopen
baru (list/grid/board menyembunyikan start untuk done). Jalur worktree, id deterministik,
early-return sesi hidup — **semua tak berubah**.

### 3. Frontend — tombol di `SpecDetail` (`src/src/screens/BacklogScreen.tsx`)
Di modal `SpecDetail`, saat `spec.stage === "done"`, render satu tombol **"Buka sesi
lagi"** yang memanggil handler start yang sudah ada (`onStart(spec)` → `startSession` →
Terminal). Ditempatkan di dekat `StageBar` (area yang sama dengan kontrol revert stage
SPEC-167). `SpecActions` (list/grid/board) **tidak diubah** sama sekali.

Satu tombol saja: kalau ternyata sesi masih/kembali hidup, `POST /terminal/sessions`
early-return sesi itu dan tetap membawa user ke Terminal — jadi tak perlu cabang
"attach vs reopen" di UI.

## Non-goals
- Tak mengubah pemilihan worktree (tak base dari branch kerja `hanoman/<id>` yang belum
  ter-merge). Kalau nanti perlu, itu perubahan server terpisah + fetch branch + ADR.
- Tak menambah endpoint/route/DTO baru, tak menambah field request.
- Tak me-revert stage. Tak menyentuh `SpecActions`, list/grid/board.
- Tak menambah `--resume`/`--continue` claude (codebase memang tak memakainya).
- Tak ada guard stage di server (spec `done` memang sudah boleh di-start).

## Testing
- **Runner** (`runner/test/prompt.*`): `continuePrompt` **tidak** memuat "Brainstorm"/
  "Objective" di instruksi fase, **memuat** arahan Execute + baca plan, dan tetap memuat
  id/objective spec + baris push. Beda nyata dari `startPrompt` (yang memuat pipeline penuh).
- **Server** (`server/test/terminal.*`): `POST /terminal/sessions` untuk spec `done`
  memilih `continuePrompt` (spec non-done tetap `startPrompt`). Verifikasi lewat prompt
  yang di-pass ke createSession (mock) — tanpa spawn tmux nyata.
- **Frontend** (`src/test/backlog-*.test.tsx`): `SpecDetail` merender tombol "Buka sesi
  lagi" saat `stage === "done"` dan tidak saat stage lain; `SpecActions` tetap tak punya
  aksi sesi untuk done (regresi — tombol tak bocor ke list/grid/board).
- **Smoke nyata** (wajib per CLAUDE.md): boot server, `POST /terminal/sessions` untuk spec
  `done`, pastikan 201 dan sesi memakai prompt lanjutan (cek via log/prompt, bukan hanya
  unit test).

## Dokumentasi (commit yang sama saat implementasi)
- `internal/docs/frontend/frontend-implementation.md` — catat aksi "Buka sesi lagi" di
  `SpecDetail` untuk spec `done`.
- `internal/docs/architecture/api-contract.md` — catat `POST /terminal/sessions` memakai
  prompt lanjutan (Execute-only) saat spec-nya `done`.
- `internal/docs/README.md` — daftarkan operations doc SPEC-172 bila dibuat, jaga index
  tetap sinkron.
- ADR: **tidak** diperlukan — tak ada perubahan invariant/skema; hanya pemilihan prompt
  berdasar stage yang sudah ada.
