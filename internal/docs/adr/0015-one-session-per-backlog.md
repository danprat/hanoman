# ADR 0015 — Satu backlog, satu sesi Claude

**Status:** accepted
**Melengkapi:** ADR-0010 (runner spawn `claude` CLI), ADR-0003 (per-step model selection)
**Menyentuh:** ADR-0012 (`subtype` adalah sinyal gagal terakhir)

## Konteks
`runOne` men-spawn satu proses `claude` per fase. Akibatnya konteks fase Brainstorm hilang bagi
fase Spec kecuali yang sempat ditulis ke file, dan `sessionId` yang sudah dihitung `runPhase`
dibuang begitu saja.

Lebih buruk: fase Execute memakai `SteerQueue.stream()` sebagai prompt. `pump()` menutup stdin
hanya setelah iterable itu habis, `claude` keluar hanya saat stdin EOF, dan `SteerQueue.close()`
baru dipanggil sesudah `runOne` selesai. Ketiganya saling menunggu — **fase Execute di worker
tidak pernah selesai.** `cli/src/commands/_run.ts` memanggil `runOne` tanpa `ctl`, jadi jalur CLI
selamat dan bug ini lolos dari test: `run.test.ts` tak pernah mengoper `steer`, dan
`phase.test.ts` tak punya satu pun kasus prompt `AsyncIterable`.

## Keputusan
Satu backlog dijalankan oleh **satu proses `claude`** di worktree-nya sendiri. Fase menjadi
**giliran** di dalam sesi itu.

Diverifikasi langsung terhadap binary `claude` v2.1.205, bukan disimpulkan dari dokumen:

- Satu proses `-p --input-format stream-json` melayani banyak giliran, mempertahankan satu
  `session_id`, dan membawa konteks antar giliran.
- Proses tetap hidup saat menganggur selama stdin terbuka; ia keluar hanya saat stdin EOF.
- `/model <m>` dan `/effort <l>` menggeser sesi di tengah jalan, jadi **ADR-0003 tetap berlaku**
  tanpa menuntut satu proses per fase.
- Giliran slash-command memancarkan `result` sintetis sendiri, yang harus dibuang. Membacanya
  sebagai hasil fase akan menandai fase selesai sebelum ia sempat bekerja.
- `--output-format` bertuliskan "only works with --print", jadi sesi PTY interaktif tidak dapat
  melaporkan `subtype`. Eksekusi fase karena itu **tidak** dipindahkan ke PTY: ADR-0012 mencatat
  `subtype` adalah satu-satunya sinyal gagal yang tersisa setelah rem anggaran dicabut.

Batas giliran **dihitung**: N pesan pengguna berpasangan dengan N `result` menurut urutan
(`runner/src/turns.ts`). Tidak ada lagi penyamaan "fase selesai" dengan "stream proses berakhir".

`sessionId` naik jadi kolom `Run.sessionId`, dipakai layar Terminal untuk `claude --resume` di
dalam worktree run — sesi run itu sendiri, bukan tiruannya.

## Konsekuensi
- (+) `claude -p` oneshot per fase hilang; satu backlog, satu spawn, satu worktree, satu sesi.
- (+) Konteks terbawa antar fase, seperti sesi terminal harian — tujuan yang sama dengan ADR-0010.
- (+) Deadlock Execute mati, karena batas fase tidak lagi bergantung pada matinya proses.
- (+) `subtype`, token, cost, `steer`, dan ADR-0003 semuanya utuh.
- (−) **Token per giliran tumbuh**: konteks menumpuk lintas fase alih-alih bersih tiap fase. Itu
  harga dari "menyerupai sesi harian"; ADR-0012 sudah menetapkan biaya tidak menggerakkan apa pun,
  dan plafon sesungguhnya adalah rate limit.
- (−) Satu proses menahan seluruh run: matinya proses mematikan sisa fase. Sebelumnya matinya satu
  spawn juga menggagalkan run, jadi ini bukan kemunduran — tapi jendelanya kini lebih panjang.
- (−) Ketergantungan baru pada slash command `/model` dan `/effort` sebagai antarmuka. Keduanya
  tidak dijamin stabil lintas versi `claude`; `runner/test/live-smoke.test.ts` menguncinya terhadap
  binary asli, seperti ADR-0010 mengunci kontrak `stream-json`.
- (−) Pesan steer kini diterapkan di **batas giliran**, bukan di tengah giliran. Sebelumnya ia
  ditulis ke stdin kapan saja — dan justru itulah yang menahan stdin terbuka selamanya.

## Catatan
`total_cost_usd` kumulatif per sesi, `usage.*_tokens` per giliran. Karena seluruh run kini satu
sesi, cost **di-assign** dari `result` terakhir dan token **dijumlah** antar giliran. Sebelumnya
tiap fase adalah sesi tersendiri, sehingga cost harus dijumlahkan antar fase.
