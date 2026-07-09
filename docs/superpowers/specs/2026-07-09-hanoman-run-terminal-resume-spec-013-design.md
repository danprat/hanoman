# SPEC-013 — Satu backlog, satu sesi Claude, satu worktree

**Date:** 2026-07-09
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (spec ini tunduk padanya)
**Depends on:** SPEC-003 (runner), SPEC-004 (worker), SPEC-012 (`runner/src/claude-cli.ts`)
**Menyentuh ADR:** ADR-0002 (worktree isolation, tetap), ADR-0003 (per-step model, mekanismenya
berubah), ADR-0010 (spawn `claude` CLI, tetap), ADR-0012 (`subtype` adalah sinyal gagal terakhir)

## Asal-usul

Permintaan awalnya: "hapus semua penggunaan Anthropic SDK, ganti dengan terminal."

Premis itu salah, dan dicatat di sini supaya tidak dicari lagi. **Tidak ada SDK Anthropic yang
tersisa.** ADR-0010 sudah mencabut `@anthropic-ai/claude-agent-sdk`; `grep -r '@anthropic'`
menghasilkan nol baris, termasuk di `pnpm-lock.yaml`. Yang tersisa hanya kosakata:
`runner/src/types.ts` masih menamai tipenya `SdkMessage`, `SdkUserMessage`, `QueryFn`, dan
`deps.ts` memanggilnya `queryFn`. Nama peninggalan, bukan dependency.

Permintaan berikutnya lebih tepat: **tidak ada lagi `claude -p` oneshot; setiap backlog jadi satu
spawn di worktree terpisah, dan bisa dimasuki lewat terminal.**

## Fakta yang diverifikasi terhadap binary

`claude` v2.1.205. Diuji langsung, mengikuti preseden ADR-0010 yang menolak menyimpulkan kontrak
dari dokumen.

1. **`claude -p` bukan oneshot.** Satu proses dengan `--input-format stream-json` melayani banyak
   giliran, mempertahankan satu `session_id`, dan **membawa konteks antar giliran** (diuji: ia
   mengingat kata yang dititipkan di giliran pertama). Satu `result` per giliran;
   `total_cost_usd` kumulatif per sesi, `usage.*_tokens` per giliran — persis seperti sudah
   dicatat di `runner/src/phase.ts:22`.

2. **Proses tetap hidup saat idle selama stdin terbuka.** Diuji menganggur 25 detik di antara dua
   giliran, lalu giliran kedua diproses normal dan proses keluar `0` saat stdin ditutup. Inilah
   yang membuat "fase sebagai giliran" mungkin.

3. **`/model <m>` menggeser model di tengah sesi.** Sesi yang dimulai dengan `--model haiku`
   menjalankan giliran berikutnya di `claude-sonnet-5`, dan memancarkan `system/init` baru.

4. **`/effort <l>` juga berlaku di tengah sesi** ("Set effort level to high (this session only)").

   Fakta 3 dan 4 bersama-sama berarti **ADR-0003 selamat**: pemilihan model dan effort per-step
   tidak menuntut satu proses per fase.

5. **Giliran slash-command memancarkan `result` sintetis sendiri** (`assistant` dengan
   `model: <synthetic>`). Orkestrator tidak boleh menganggapnya hasil fase.

6. **`--output-format`/`--input-format` bertuliskan "only works with --print".** Sesi PTY
   interaktif secara struktural tidak dapat memancarkan `stream-json`, karena itu tidak dapat
   melaporkan `subtype`. ADR-0012 mencatat `subtype` adalah satu-satunya sinyal gagal yang
   tersisa, setelah rem anggaran dicabut. Eksekusi fase **tidak** dipindahkan ke PTY.

7. **`--resume` bersifat cwd-scoped.** Session id yang benar-benar ada tetap dijawab
   `No conversation found` bila dijalankan dari cwd lain; dari worktree asalnya, sesi yang sama
   menjawab normal. Transcript disimpan di `~/.claude/projects/<slug-cwd>/<session-id>.jsonl`.

## Bug yang ditemukan dalam perjalanan

**Fase Execute di worker tidak pernah selesai.**

`runOne` memberi fase Execute prompt berupa `ctl.steer.stream()` (`run.ts:42`). `pump()` menutup
stdin hanya setelah iterable itu habis (`claude-cli.ts:44`); `claude` keluar hanya saat stdin EOF
(fakta 2); dan loop keluaran `runPhase` berakhir hanya saat stdout EOF. `SteerQueue` baru
di-`close()` di `worker.ts` **sesudah** `runOne` selesai. Ketiganya saling menunggu.

`cli/src/commands/_run.ts:31` memanggil `runOne` tanpa `ctl`, jadi prompt Execute tetap string dan
jalur CLI selamat. `worker.ts:66` selalu mengoper `{ abortController, steer }` — jadi jalur yang
dipakai produksi menggantung, dan jalur yang tidak dipakai produksi yang diuji.

Tidak ada test yang menutupinya: `runner/test/run.test.ts` tak pernah mengoper `steer`, dan
`runner/test/phase.test.ts` tak punya satu pun kasus prompt `AsyncIterable`. Diverifikasi dengan
fake `queryFn` yang setia pada semantik `pump()` (termasuk `void pump(...)` yang tak di-await):
`runOne` menembus Brainstorm → Objective → Spec → Plan, lalu menggantung di Execute.

Akar masalahnya: **`runPhase` menyamakan "fase selesai" dengan "stream proses berakhir".** Desain
di bawah menghapus penyamaan itu, jadi perbaikannya menyatu dengan rewrite-nya dan bukan tambalan
terpisah.

## Keputusan

### 1. Satu backlog = satu run = satu spawn = satu worktree = satu `sessionId`

`runOne` mengangkat `queryFn` keluar dari loop fase. Satu proses `claude` hidup sepanjang run,
di worktree run itu (`.worktrees/<run-id>`, sudah berlaku lewat ADR-0002).

Fase berhenti menjadi proses dan menjadi **giliran**. `runPhase` tidak lagi men-spawn; ia menulis
pesan dan mengkonsumsi giliran.

Efek samping yang diinginkan: hari ini tiap fase spawn bersih, sehingga penalaran fase Brainstorm
hilang bagi fase Spec kecuali yang sempat ditulis ke file. Satu sesi menyembuhkan itu.

### 2. Batas giliran dihitung, tidak ditebak

Orkestrator mengirim N pesan pengguna dan mengkonsumsi N `result`, berpasangan **berdasarkan
urutan**. Tidak ada parsing heuristik, tidak ada screen-scraping.

Untuk tiap fase, bila `step.model` atau `step.effort` berbeda dari yang sedang aktif:

1. kirim `/model <m>` → konsumsi tepat satu `result`, buang (fakta 5)
2. kirim `/effort <e>` → konsumsi tepat satu `result`, buang
3. kirim prompt fase → konsumsi satu `result` → **inilah hasil fase**: `subtype`, `usage`

Pesan `steer` yang masuk saat sebuah fase berjalan menjadi giliran tambahan; giliran-giliran itu
dikuras sampai habis sebelum fase berikutnya dimulai. Karena tiap pesan pengguna menghasilkan
tepat satu `result`, jumlahnya selalu cocok.

Run berakhir dengan menutup stdin — bukan dengan menunggu proses mati atas kemauannya sendiri.
Itu yang menghapus deadlock di atas.

### 3. `sessionId` naik jadi fakta tingkat-run

Dengan satu sesi per run, `sessionId` bukan lagi milik fase. Tambah kolom
`Run.sessionId String?` — **migration + ADR-0014**, sesuai `CLAUDE.md`. `runPhase` sudah
menangkapnya hari ini (`phase.ts:30`) dan `runOne` membuangnya; sekarang ia disimpan.

### 4. Terminal masuk lewat sesi yang sama

Layar Terminal membuka `claude --resume <run.sessionId>` dengan `cwd` = `run.worktree` (kolom
sudah ada). Bukan sesi baru yang menyerupai run — **sesi run itu sendiri**, dengan seluruh
riwayatnya, di device pengguna.

| Status run | Cara ikut campur |
|---|---|
| `running` | `steer` → Redis `run:<id>:control` → giliran baru di sesi yang sama (sudah jalan) |
| `paused` / `failed` / `stopped` | `claude --resume` interaktif di worktree |
| `done` | tidak ada — worktree sengaja dihapus, kerja sudah di-commit |

`runOne` hanya memanggil `removeWorktree` di jalur sukses (`run.ts:56`), jadi worktree masih utuh
persis pada status yang ingin dicampuri. Cleanup tidak berubah.

`--fork-session` tidak dipakai. Dua agen menulis satu worktree adalah bug yang menunggu giliran,
dan `steer` sudah menjadi kanal aman untuk run yang masih hidup.

### 5. Guard PreToolUse di PTY — utang keamanan yang ada sebelum spec ini

`pty.ts:35` men-spawn `claude --dangerously-skip-permissions` **tanpa `--settings`**, sehingga
layar Terminal hari ini berjalan tanpa PreToolUse guard sama sekali. ADR-0010 menyebut hook itu
"satu-satunya gerbang yang tersisa" di bawah flag tersebut.

Ditutup di sini: `pty.ts` memasang `--settings` berisi `guardSettings(guardCommand())`. Keduanya
sudah diekspor — `guardSettings` dari `runner/src/claude-cli.ts:16`, `guardCommand` dari
`server/src/runner/deps.ts`. Berlaku untuk sesi project maupun sesi resume.

## Komponen

| Unit | Tanggung jawab | Bergantung pada |
|---|---|---|
| `runner/src/claude-cli.ts` | spawn sekali; `pump` menulis pesan sesuai permintaan, tutup stdin saat diminta | — |
| `runner/src/turns.ts` (baru) | antrean pesan → giliran; pasangkan N pesan dengan N `result` | `types.ts` |
| `runner/src/phase.ts` | kirim `/model`+`/effort`+prompt, kembalikan hasil fase | `turns.ts` |
| `runner/src/run.ts` | buka sesi sekali, urutkan fase, tutup stdin di akhir | `phase.ts`, `GitOps` |
| `server/src/runner/events-io.ts` | simpan `sessionId` ke `Run` | Prisma |
| `server/src/services/pty.ts` | argv resume + guard `--settings` | `@hanoman/runner` |
| `server/src/routes/terminal.ts` | terima `{ runId }`, tolak bila worktree/sesi tidak ada | `pty.ts`, Prisma |

## Penanganan galat

- **`subtype` `error_*`** → fase gagal, run gagal, tanpa commit. Perilaku ADR-0012 dipertahankan
  utuh; ini alasan pokok eksekusi tidak dipindahkan ke PTY.
- **Proses mati di tengah run** → sisa fase tidak berjalan; run gagal dengan stderr yang terbaca
  (`claude-cli.ts:80` sudah melakukannya).
- **Worktree hilang** saat membuka terminal → `400` yang menyebut path. Jangan diam-diam jatuh ke
  `repoDir`: itu membuka sesi di working tree utama dan melanggar ADR-0002.
- **Run belum punya `sessionId`** (masih mengantre) → `400`, bukan sesi kosong.
- **Run `done`** → `400` dengan alasan eksplisit, bukan `404`.
- **`--resume` gagal** (transcript dipangkas) → `claude` mencetak `No conversation found` lalu
  keluar; PTY memancarkan frame `exit` dan UI menampilkan sesi berakhir.

## Rencana pengujian

Regresi yang menjadi alasan spec ini harus punya test yang gagal sebelum diperbaiki:

- `runner/test/run.test.ts` — **`runOne` dengan `steer` menyelesaikan fase Execute.** Ini test
  yang hari ini tidak ada dan yang menggantung bila dijalankan terhadap kode sekarang.
- `runner/test/turns.ts` — N pesan menghasilkan N `result`; giliran slash-command dibuang dan
  tidak pernah terbaca sebagai hasil fase.
- `runner/test/phase.test.ts` — `/model` dan `/effort` hanya dikirim saat step berubah; hasil fase
  membaca `result` yang benar, bukan `result` sintetis.
- `runner/test/run.test.ts` — satu spawn untuk seluruh run (`queryFn` dipanggil tepat sekali).
- `runner/test/claude-cli.test.ts` — argv tetap membawa `--settings` guard dan
  `--setting-sources user,project,local`.
- `server/test/pty.test.ts` — argv resume berisi `--resume <id>` **dan** `--settings`; argv project
  tetap berisi `--settings`. Guard tidak boleh bisa hilang tanpa membuat test merah.
- `server/test/terminal-route.test.ts` — worktree hilang → `400`; run `done` → `400`; run tanpa
  `sessionId` → `400`.
- `runner/test/live-smoke.test.ts` — perluas: satu sesi, dua fase berurutan dengan model berbeda,
  konteks fase pertama masih terlihat di fase kedua.
- Verifikasi nyata (wajib per `CLAUDE.md`): boot server + worker, jalankan satu backlog sampai
  Execute, lalu `curl` endpoint terminal untuk run `stopped` dan pastikan `claude` benar-benar
  melanjutkan percakapan yang sama.

## Konsekuensi

- (+) `claude -p` oneshot per fase hilang. Satu backlog, satu spawn, satu worktree, satu sesi.
- (+) Konteks terbawa antar fase, seperti sesi terminal harian — tujuan yang sama dengan ADR-0010.
- (+) Deadlock Execute hilang, karena batas fase dihitung dari `result`, bukan dari matinya proses.
- (+) `sessionId` tingkat-run membuat terminal membuka sesi run yang asli, bukan tiruannya.
- (+) `subtype`, token, cost, `steer`, dan ADR-0003 semuanya utuh.
- (−) **Token per giliran tumbuh**: konteks menumpuk lintas fase alih-alih bersih tiap fase. Ini
  harga dari "menyerupai sesi harian", dan ADR-0012 sudah menetapkan biaya tidak menggerakkan
  apa pun. Rate limit, bukan biaya, adalah plafon sesungguhnya.
- (−) Satu proses menahan seluruh run: matinya proses mematikan sisa fase. Sebelumnya matinya satu
  spawn juga menggagalkan run, jadi ini bukan kemunduran, tapi jendelanya kini lebih panjang.
- (−) Ketergantungan baru pada slash command `/model` dan `/effort` sebagai antarmuka. Keduanya
  tidak dijamin stabil lintas versi `claude`; `runner/test/live-smoke.test.ts` mengunci perilakunya
  terhadap binary asli, seperti ADR-0010 mengunci kontrak `stream-json`.

## Yang sengaja tidak dikerjakan

- Rename kosakata `Sdk*`/`queryFn` → pekerjaan mekanis terpisah; mencampurnya akan menenggelamkan
  diff spec ini.
- Memindahkan eksekusi fase ke PTY. Fakta 6 menjelaskan alasannya. Bila suatu saat `claude`
  memancarkan batas giliran di mode interaktif, timbang ulang.
- `--fork-session` untuk run `running`. Tambahkan bila `steer` terbukti kurang, dengan bukti dari
  pemakaian nyata.
- Memangkas konteks (compaction) saat sesi memanjang. Tambahkan saat run nyata menabrak rate limit,
  bukan sebelumnya.
