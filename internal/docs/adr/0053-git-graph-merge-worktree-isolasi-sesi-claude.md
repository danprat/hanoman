# ADR-0053 — Merge via git graph: deterministik di worktree isolasi, konflik → sesi claude

**Status:** accepted · **Date:** 2026-07-19 · **Spec:** SPEC-229
**Terkait:** [ADR-0031](0031-rebase-merge-backlog.md) (integrate backlog — pola yang ditiru),
[ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree), [ADR-0034](0034-ide-mutasi-working-tree-utama.md)
(IDE boleh mutasi working tree utama), [ADR-0016](0016-sesi-terminal-hidup-di-tmux.md) (sesi tmux)

## Context
Merge lewat **git graph IDE** (SPEC-182, `POST /projects/:id/git` → `runGitOp`) menjalankan
`git merge` langsung di **working tree utama**. Audit SPEC-229 menemukan jalur ini **buntu** saat
tak bersih (dua mode, keduanya reproducible):

- **Konflik** meninggalkan working tree utama **mid-merge** (`UU`, `.git/MERGE_HEAD`); route balas
  409; "Force" di UI menjalankan ulang merge yang sama → git menolak (*"unmerged files"*) →
  `confirmForce` **menelan error senyap** (`IdeScreen.tsx:91`). Working tree rusak tanpa jalan keluar.
- **Gerbang sesi aktif** membalas **409 di setiap merge** selama ada sesi tmux untuk project itu —
  kondisi normal saat operator bekerja. Satu-satunya escape (Force) berujung buntu konflik di atas.

Sementara itu jalur **integrate backlog (ADR-0031)** sudah memegang pola yang benar untuk hal ini:
git deterministik di **worktree isolasi** `.worktrees/merge-*`, working tree utama tak pernah
disentuh, dan **konflik → spawn sesi claude** di worktree itu. Git graph tak pernah mewarisinya.

Keluhan meminta: *"merge via git graph, jika ada issue atau 409 maka buka sesi claude untuk
memperbaiki, prioritas tetap deterministic, harus bisa merge local branch dan remote branch."*

## Decision
**Merge via git graph mengikuti pola integrate: SELALU dijalankan di worktree isolasi, bersih →
fast-forward branch current di working tree utama, konflik/error → spawn sesi claude di worktree.**
Working tree utama **tak pernah** ditinggal rusak.

Endpoint project-level **`POST /projects/:id/git/merge`** (terpisah dari `POST /projects/:id/git`
agar bentuk response tak mencampur — mirror `POST /specs/:id/integrate`):

- **Body**: `{ source: string, ff?: "no-ff"|"ff-only", deleteBranch?: string }`. `source` = ref/sha
  yang di-merge (branch lokal, `origin/<b>`, atau sha commit dari graph) — mendukung **local & remote**.
- **Target = branch current** working tree utama (`rev-parse --abbrev-ref HEAD`). HEAD **detached** →
  409 "checkout sebuah branch dulu" (tak ada branch untuk di-ff, sejajar batasan integrate).
- **Deterministik dulu**: worktree `.worktrees/merge-<current>` detach di tip branch current →
  `git merge --no-edit [--ff/--no-ff] --end-of-options <source-sha>` (source di-resolve ke sha,
  cegah flag-injection, SPEC-197).
- **Bersih** → **fast-forward branch current DI worktree pemiliknya** (`git -C <main> merge --ff-only
  <hasil>`), reuse `runFinalize` kind `branch-f` checked-out (ADR-0031/SPEC-185). `deleteBranch` →
  hapus branch (local + origin bila ada) sesudahnya. Hapus worktree merge. Balas
  `{ status:"clean", detail }`.
- **Konflik** → tinggalkan worktree, **spawn sesi claude interaktif** di sana (tanpa flow → tak
  menggerakkan stage) dengan instruksi finalisasi (`git add -A && git commit --no-edit`, lalu
  ff branch current), UI pindah ke Terminal. Balas `{ status:"conflict", sessionId }`. Worktree
  dibersihkan saat sesi ditutup (`DELETE /terminal/sessions/:id`, ADR-0031).

Gerbang sesi aktif **dicabut untuk merge**: karena merge kini isolasi + ff-aman (git membatalkan ff
bila working tree utama akan tertimpa), sesi aktif tak lagi jadi alasan 409 — "issue atau 409" yang
lama digantikan alur deterministik→sesi-claude ini.

**Scope**: hanya `merge`. Op git graph lain (checkout/branch/cherry-pick/revert/delete-branch) tetap
di working tree utama lewat `runGitOp` (ADR-0034) — tak diubah. (cherry-pick/revert punya potensi
buntu serupa; dicatat sebagai kerja lanjutan, di luar SPEC-229.)

## Alternatif ditolak
- **Fast-path di working tree utama, escalate hanya saat konflik** (`git merge --abort` lalu redo di
  worktree): mempertahankan merge bersih instan, tapi working tree utama sempat kotor lalu dipulihkan
  — lebih banyak state transisi & jalur gagal. Isolasi-selalu lebih sederhana & tak pernah menyentuh
  working tree utama (dipilih operator).
- **Minimal: abort + tombol manual "Buka sesi claude"**: diff terkecil tapi tak "otomatis buka sesi"
  seperti diminta; tetap membebani operator memutuskan.
- **Generalisasi `integrate()` in-place** untuk menerima source arbitrer: menyentuh jalur teruji yang
  terkunci ke id spec. Dipilih: fungsi baru yang **reuse helper** integrate (`reclaim`,
  `worktreeForBranch`, `runFinalize`, `finalizeInstruction`) tanpa mengubah `integrate()` sendiri.

## Consequences
- Merge git graph deterministik dulu, konflik selalu punya rumah jujur (sesi claude di worktree),
  working tree utama tak pernah rusak. Sejajar penuh dengan integrate backlog.
- Merge branch **lokal maupun origin** didukung lewat satu `source` (afordans origin jadi kelas-satu
  di menu graph).
- Tanpa perubahan skema/migration. Response merge git graph berubah bentuk (`{status,...}` bukan
  `GitOpResult`) → frontend `GitGraph`/`IdeScreen` menyesuaikan (navigasi ke Terminal saat conflict).
- `runGitOp` merge lama tetap ada untuk kompat/uji unit, tapi UI graph tak lagi memakainya.
