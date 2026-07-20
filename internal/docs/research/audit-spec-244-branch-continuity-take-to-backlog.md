# audit SPEC-244 — kontinuitas branch: PRD→brief & audit→Finding QA belum meneruskan branch; picker backlog belum melisten origin

**Status:** accepted · **Tanggal:** 2026-07-20 · **Sumber:** qa · **Prioritas:** tinggi
**Keputusan:** luas & menyentuh semantik orkestrasi (prompt/flow) + keamanan argumen git + lintas 4 lapis → **Spec → Plan → Execute penuh** (ADR-0059)

## Keluhan

> Saat melakukan penarikan backlog dari PRD ke brief harusnya meneruskan branch-nya dari yang
> PRD sudah buat, dan untuk audit pun sama — harusnya meneruskan branch yang dari audit buat
> untuk diteruskan dari audit ke Finding QA. Jika diteruskan dari audit ke QA maka lewati proses
> audit langsung decision execute atau buat dulu spec→plan→execute-nya. Saat ini saat pembuatan
> backlog juga belum melisten branch dari origin/remote — ini jadi kendala juga.

Tiga sub-isu:

- **A. PRD → brief** ("Take ke backlog") tak meneruskan branch `prd/<slug>` yang dibuat sesi PRD.
- **B. Audit → Finding QA** ("Jadikan Finding QA") tak meneruskan branch `hanoman/<audit-id>` dan
  **mengulang fase Audit** dari nol, padahal audit sudah punya dokumen doc-of-record.
- **C.** Pembuatan backlog **tak melisten branch origin/remote** — justru di situlah branch PRD &
  audit hidup (worktree detached lalu push ke origin).

## Investigasi (systematic-debugging)

### Fase 1 — akar masalah

**A. PRD → brief tak meneruskan branch.**
`PrdPreviewPane` (`src/src/screens/PrdScreen.tsx:74-77`) memanggil `onTake({ project, title,
context: "Dari PRD: <path>", outcome, prdPath })` — tipe `PrdPrefill` (`PrdScreen.tsx:14`) **tak
punya `branchFrom`**. Handler `takeToBacklog` (`src/src/App.tsx:588-589`) hanya `setSpecPrefill(pf)`.
`NewSpecModal` (`App.tsx:38-64`) menginisialisasi form dengan `branchFrom: ""` **tanpa memandang
prefill** (`App.tsx:46`) — tipe `SpecPrefill` (`App.tsx:35-36`) juga tak punya `branchFrom`. Maka
brief hasil "take" **selalu default `main`**, membuang kerja PRD di `prd/<slug>`
(`server/src/routes/terminal.ts:221`).

**B. Audit → QA tak meneruskan branch + mengulang Audit.**
`promoteToQa` (`App.tsx:592-596`) mem-prefill `{ kind:"qa", title, steps:"Dari audit <id>: …",
actual, severity }` — **tak set `branchFrom`**. Spec qa baru default `main`, membuang
`hanoman/<audit-id>` (`server/src/services/integrate.ts:16` `sourceBranch`) yang **memuat dokumen
audit** `internal/docs/research/audit-<audit-id>-<slug>.md` (ADR-0057). Selain itu flow `qa` =
`["Audit","Spec","Plan","Execute"]` (`runner/src/prompt.ts:6`) **mengulang fase Audit** dari nol —
tak ada sinyal bahwa backlog ini lanjutan dari audit yang sudah selesai.

**C. Picker backlog tak melisten origin/remote.**
`GET /projects/:id/branches` (`server/src/routes/projects.ts:81-88`) **sudah** mengembalikan
`{ branches, remotes }`. Namun `NewSpecModal` hanya mengonsumsi `r.branches` (lokal `refs/heads`)
di `setBranches(r.branches)` (`App.tsx:58`) dan `branchOptions(branches)` (`App.tsx:96`) — `remotes`
diabaikan. Sisi server pun lokal-only:

- Whitelist validasi `branchUnknown` (`server/src/routes/specs.ts:26-27`) hanya cek
  `listRepoBranches` (glob `refs/heads`, `server/src/services/branches.ts:19-21`). `POST/PATCH
  /specs { branchFrom: "prd/<slug>" }` → **400** "branch tidak ada di repo project".
- Resolusi SHA `resolveCommit` (`runner/src/git.ts:18-19`) `git rev-parse --verify
  --end-of-options <rev>^{commit}` — DWIM git **tak** mencoba `refs/remotes/origin/<rev>`, jadi
  nama branch remote-only tak resolve.

Karena `prd/<slug>` dan `hanoman/<audit-id>` di-push dari worktree **detached** (tanpa membuat
`refs/heads` lokal, `runner/src/git.ts:26-36`), keduanya **hanya ada sebagai `refs/remotes/origin/*`**
di mesin. **C adalah prasyarat A & B**: tanpa remote menjadi first-class untuk `branchFrom`,
meneruskan branch PRD/audit mustahil.

### Fase 2 — pola pembanding

- Kontinuitas branch = properti `Spec.branchFrom` (ADR-0032) yang **sudah** ada; yang kurang hanya
  (1) prefill dari take/promote, (2) remote sebagai kandidat & lolos gerbang, (3) resolusi remote.
- `services/integrate.ts` sudah punya pola resolusi yang benar: `resolveSource` mencoba
  `refs/heads/<s>` **lalu** `refs/remotes/origin/<s>` (`integrate.ts:174-176`). `resolveCommit`
  tinggal meniru fallback `origin/<rev>` ini.
- "Lewati fase via keputusan agen, disurface `skipped` di phase file" = mekanisme ADR-0040 yang
  sudah ada (`Audit skipped`). Skip-audit untuk qa-lanjutan-audit adalah perluasan lurus dari itu.
- `listRepoRemoteBranches` (`branches.ts:25-30`) sudah melucuti prefix `origin/` → kandidat remote
  bersih (mis. `prd/foo`, `hanoman/spec-237`).

### Fase 3 — hipotesis

1. Menambah `branchFrom` ke `SpecPrefill`/`PrdPrefill`, mengisinya di `takeToBacklog`
   (`prd/<slugOfPath>`) & `promoteToQa` (`hanoman/<audit-id>`), lalu menerapkannya di form
   `NewSpecModal` → brief/qa baru lahir di branch yang benar. **Verifikasi:** butuh remote lolos.
2. Menyertakan `remotes` ke daftar branch modal + whitelist server + fallback `origin/<rev>` di
   `resolveCommit` → branch remote-only (`prd/<slug>`, `hanoman/<audit-id>`) bisa dipilih, lolos
   400, dan resolve ke SHA saat worktree dibuat. Keamanan argumen ADR-0032 terjaga: `--verify
   --end-of-options` tetap, prefix `origin/` konstan (bukan input yang bisa jadi flag).
3. Sinyal "qa lanjutan audit" dibawa payload eksplisit (mis. `fromAudit: "<audit-id>"`) →
   `startPrompt` qa meng-emit klausa: audit sudah dilakukan (dokumen ada di worktree), **tandai
   `Audit skipped`**, baca dokumen audit, lalu ambil keputusan ADR-0040 (langsung Execute atau
   Spec→Plan→Execute). Konsisten filosofi ADR-0040 (keputusan dielicit prompt, diambil agen).

## Rekomendasi

**Naikkan ke perbaikan (bukan cukup jawaban).** Diff nyata lintas `shared` (prefill + payload
schema), `frontend` (App/NewSpecModal/PrdScreen prefill + remotes), `server` (whitelist remote),
`runner` (resolveCommit fallback + klausa prompt skip-audit), plus test & ADR baru. Karena
menyentuh **semantik orkestrasi** (flow/prompt), **keamanan argumen git**, dan **lintas 4 lapis**,
jalankan **Spec → Plan → Execute penuh** dengan ADR-0059 sebagai keputusan arsitektur (perluasan
ADR-0032/0040/0041/0057). Detail desain di Spec/ADR.
