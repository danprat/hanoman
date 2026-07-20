# Audit SPEC-245 — Interaksi git graph tak realtime

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major
**Status:** doc-of-record perbaikan (Spec & Plan di-skip — akar jelas, diff kecil, ADR-0040)

## Keluhan

> Ketika ada interaksi dalam git graph diharapkan realtime perubahannya tanpa
> harus di-refresh lagi. Saat ini git graph belum responsive realtime.

## Root cause

`src/src/screens/GitGraph.tsx` memuat data (`api.ideGraph` + `ideStatus` +
`ideStashes`) hanya lewat `load()` yang dipicu **tiga** kondisi:

1. Mount komponen (`React.useEffect(() => { load(); }, [load])`).
2. Perubahan opsi tampilan (`gopts` / `projectId` — dependency `load`).
3. Langsung sesudah aksi **sinkron** miliknya sendiri (`act`, `mergeAct`,
   `rebaseAct`, `pullAct`, `dropAct` → `…then(load)`).

**Tidak ada polling / live-refresh.** Maka perubahan repo yang datang di luar
jalur aksi sinkron itu tak pernah tampil sampai user refresh halaman:

- Sesi `claude` yang sedang berjalan meng-commit ke worktree/branch.
- Konflik merge/rebase/pull/drop yang dirutekan ke Terminal (jalur worktree
  isolasi + sesi claude, ADR-0053/0055) diselesaikan **async** di sana — graph
  yang masih terbuka tak tahu commit baru sudah mendarat.
- Commit/checkout dari sesi Terminal biasa (shell mentah, ADR-0056).
- Edit working tree dari tab Explorer saat tab Git Graph belum di-remount.

Arsitektur hanoman: **WebSocket untuk terminal PTY + HTTP polling untuk sisanya**
(`internal/docs/architecture/stack.md`). Board/specs/sessions memang didorong via
WS siar (ADR-0039), tapi data IDE/git graph **tidak** ada di kanal siar itu —
mekanisme yang disanksikan untuknya adalah HTTP polling, dan git graph kebetulan
tak memilikinya sama sekali.

## Perbaikan

Tambahkan **live-refresh diam** (silent poll) di `GitGraph`:

- Parametri `load(silent?)`: saat `silent`, jangan flip `state` ke `"loading"`
  (agar graph tak berkedip / tak me-reset ke StateBlock tiap tick) dan jangan
  set `"error"` (kegagalan poll transien tak boleh menutupi graph yang sudah ada).
- `setInterval` memanggil `load(true)` tiap `POLL_MS` (4 dtk), hanya saat
  `!document.hidden` (hemat saat tab browser tak aktif). Dibersihkan saat unmount.

Diff terlokalisasi di satu komponen; aksi manual & initial load tak berubah
perilakunya. Tak ada perubahan skema, kontrak API, maupun server — semua data
sudah tersedia lewat endpoint `ideGraph`/`ideStatus`/`ideStashes` yang ada.

## Verifikasi

- Unit: `src/test/git-graph-view.test.tsx` — poll me-refetch `ideGraph` tanpa
  aksi manual (fake timers, advance melewati satu tick).
- Manual: buka Git Graph, commit dari terminal terpisah → baris commit baru
  muncul dalam ≤4 dtk tanpa refresh.
