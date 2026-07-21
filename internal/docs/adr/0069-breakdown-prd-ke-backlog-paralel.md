# ADR-0069 — Breakdown PRD → backlog paralel-independen (sesi breakdown + manifest + materialize)

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-273
**Terkait:** [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (**memperluas** — PRD sebagai dokumen),
[ADR-0015](0015-one-session-per-backlog.md) (satu backlog satu sesi),
[ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree),
[ADR-0032](0032-branch-adalah-properti-backlog-item.md) (branch properti backlog),
[ADR-0059](0059-kontinuitas-branch-take-to-backlog-dan-skip-audit.md) (kontinuitas branch take-to-backlog)

## Konteks

"Take ke backlog" membuat **tepat satu** spec dari sebuah PRD (`PrdScreen` → `App.takeToBacklog` →
`createSpec`, prefill satu title/context/outcome). Untuk PRD **kompleks**, satu backlog tak cukup:
pekerjaannya terlalu besar untuk dituntaskan dalam satu sesi, sehingga sebagian isi PRD tak pernah
dikerjakan.

Paralelisme eksekusi **sudah** ditanggung arsitektur: hanoman menjalankan **satu backlog = satu
sesi di worktree terisolasi** (ADR-0002/0015). Begitu N spec independen ada, mereka sudah jalan
paralel tanpa konflik. Yang kurang adalah **dekomposisi**: 1 PRD → N spec independen. Dekomposisi
butuh kecerdasan, dan di hanoman semua kerja cerdas berjalan sebagai **sesi `claude` interaktif** —
tak ada jalur headless/SDK (ADR-0010/0024). Maka dekomposisi harus lahir dari sesi.

## Keputusan

Tambah **flow sesi `breakdown`** (pipeline `Analisis → Breakdown`), project-level seperti `prd`.
Alurnya tiga tahap:

1. **Sesi breakdown** membaca PRD (isinya **disematkan ke prompt**, jadi lepas dari status merge PRD)
   dan menulis manifest `docs/prd/<slug>.breakdown.md`: prosa human-readable + **tepat satu blok
   ```json kanonik** `{ "items": [ { title, context, outcome, priority } ] }`. Worktree isolasi dari
   `HEAD`, push ke `breakdown/<slug>`; manusia me-review lalu merge (pola prd/reverse).
2. **Server mem-parse** manifest freshest-wins (`project-breakdowns.ts`: cwd sesi breakdown hidup >
   repoDir) dan mengeksposnya di `GET /api/projects/:id/breakdown?prd=<path>` → `{ items, live }`.
   Manifest = sibling PRD; ia **bukan** PRD, jadi dikecualikan dari daftar/preview PRD.
3. **Materialize (human-reviewed)**: `PrdScreen` menampilkan usulan backlog untuk di-review/seleksi,
   lalu `POST /api/specs/batch` membuat N spec (`source:"brief"`) — id berurutan via `nextSpecId` +
   retry P2002. Provenance PRD dicantumkan di teks Konteks payload (bukan kolom baru).

**Parallel-safety by-construction:** prompt mewajibkan cakupan non-overlapping + eksplisit tanpa
cross-dependency (dengan rasional per item di prosa manifest untuk disanity-check manusia); semua N
spec di-branch dari basis yang sama sehingga jalan paralel di worktree terpisah.

## Konsekuensi

- **Tanpa perubahan skema.** Breakdown = dokumen + baris `Spec` biasa. Additive, aman untuk VPS live.
- **Manusia terakhir memutuskan** (aturan produk): usulan tak auto-jadi backlog — di-review dulu.
- "Take ke backlog" single **tetap ada** untuk PRD sederhana.
- Kompanion: `isPrd` di `project-prds.ts` kini mengecualikan `*.breakdown.md` (manifest bukan PRD).
- **Batas:** kualitas parallel-safety bergantung dekomposisi agen; gerbang review manusia menutupinya.
