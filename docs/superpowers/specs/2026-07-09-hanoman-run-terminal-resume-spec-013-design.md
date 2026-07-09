# SPEC-013 — Pintu terminal interaktif ke sebuah run

**Date:** 2026-07-09
**Status:** design approved, pending implementation plan
**Source of Truth:** `internal/docs/**` (spec ini tunduk padanya)
**Depends on:** SPEC-003 (runner), SPEC-004 (worker), SPEC-012 (`runner/src/claude-cli.ts`),
ADR-0002 (worktree isolation), ADR-0010 (runner spawn `claude` CLI)

## Asal-usul

Permintaan awalnya: "hapus semua penggunaan Anthropic SDK, ganti dengan terminal."

Premis itu salah, dan ini perlu dicatat supaya tidak dicari lagi nanti. **Tidak ada SDK
Anthropic yang tersisa di repo ini.** ADR-0010 sudah mencabut
`@anthropic-ai/claude-agent-sdk` dari `server` dan `cli`; `grep -r '@anthropic'` menghasilkan
nol baris, termasuk di `pnpm-lock.yaml`. Runs sudah men-spawn binary `claude` yang sama persis
dengan yang dipakai layar Terminal.

Yang tersisa hanyalah **kosakata**: `runner/src/types.ts` masih menamai tipenya `SdkMessage`,
`SdkUserMessage`, `QueryFn`, dan `deps.ts` memanggilnya `queryFn`. Nama peninggalan, bukan
dependency. Siapa pun yang meng-grep "SDK" akan menemukannya dan menyimpulkan hal yang keliru.

Kebutuhan sebenarnya, setelah digali: **melihat backlog dikerjakan dan sesekali ikut campur,
memakai claude code device sendiri.** Bukan mengganti transport.

## Konteks

`runOne` (`runner/src/run.ts`) menjalankan fase secara berurutan. Tiap fase memanggil
`runPhase`, yang memanggil `queryFn`, yang **men-spawn satu proses `claude` baru**. Karena itu
satu run menghasilkan **beberapa sesi Claude, satu per fase** — bukan satu sesi.

Terverifikasi terhadap disk, bukan disimpulkan: direktori
`~/.claude/projects/-Users-…-hanoman--worktrees-run-1/` berisi dua file transcript `.jsonl`
untuk satu run.

`runPhase` sudah menangkap `session_id` dari stream dan mengembalikannya
(`runner/src/phase.ts:30`). **`runOne` membuangnya** — `run.ts:43` hanya memakai `costUsd`,
`tokensIn`, `tokensOut`, dan `subtype`. Gagang pintu yang dibutuhkan sudah terhitung, lalu
dibiarkan jatuh.

## Fakta yang diverifikasi terhadap binary

`claude` v2.1.205. Diuji langsung, bukan dibaca dari dokumen (mengikuti preseden ADR-0010).

1. **`--output-format` dan `--input-format` bertuliskan "only works with --print".**
   Sesi PTY interaktif secara struktural tidak dapat memancarkan `stream-json`. Karena itu
   memindahkan eksekusi fase ke PTY berarti kehilangan batas-giliran, `usage`, dan `subtype`
   sekaligus. Ini alasan pokok penolakan pendekatan "tukar transport".

2. **`--resume` bersifat cwd-scoped.** Session id yang benar-benar ada tetap dijawab
   `No conversation found with session ID: …` bila dijalankan dari cwd lain; dari worktree
   asalnya, sesi yang sama menjawab normal. Transcript disimpan per-slug-cwd di
   `~/.claude/projects/<slug>/<session-id>.jsonl`.

3. **`--settings`, `--setting-sources`, dan `--session-id` tidak print-gated.** Guard hook
   bisa dipasang pada sesi interaktif.

4. **Transcript menyimpan `usage` per pesan assistant, tetapi tidak menyimpan
   `total_cost_usd`, dan tidak punya record bertipe `result`.** Tidak ada pengganti untuk
   `subtype` di luar mode `--print`.

## Keputusan

Jangan ganti transport. Tambahkan pintu.

### 1. Simpan `sessionId` per fase — tanpa migration

Kolom `Run.phases` sudah bertipe `Json` dan sudah berisi array `{ name, state }`.
`persistEvent` (`server/src/runner/events-io.ts`) sudah me-map array itu saat menerima event
`phase`. Tambahkan field opsional `sessionId` pada varian `phase` dari `RunEvent`, diisi saat
fase selesai.

Tidak ada perubahan skema, jadi tidak ada migration dan tidak ada ADR — larangan di
`CLAUDE.md` ("jangan ubah skema tanpa migration + ADR") tidak tersentuh. `Run.worktree` juga
sudah ada, sehingga cwd yang dibutuhkan `--resume` sudah tersimpan.

### 2. Mode resume pada layar Terminal

`createSession` (`server/src/services/pty.ts`) menerima `{ runId }` sebagai alternatif
`{ projectId }`:

- `cwd` = `run.worktree`
- argv = `claude --resume <sessionId fase terakhir yang punya sessionId>`

Sesi hanya ditawarkan bila `run.worktree` masih ada di disk. Pengecekan ini wajib, bukan
kehati-hatian berlebih: sebuah worktree dapat lenyap di tengah run ketika sesi lain
mendaratkan pekerjaan yang sama.

### 3. Pembagian kanal

| Status run | Cara ikut campur | Status hari ini |
|---|---|---|
| `running` | `steer` → Redis `run:<id>:control` → `SteerQueue` | sudah jalan |
| `paused` / `failed` / `stopped` | `claude --resume` interaktif di worktree | **yang dibangun** |
| `done` | tidak ada | disengaja |

`runOne` hanya memanggil `removeWorktree` di jalur sukses (`run.ts:56`). Jadi worktree masih
utuh persis pada status-status yang ingin dicampuri, dan pintu ini terbuka tanpa mengubah
cleanup sama sekali.

Untuk run berstatus `done`, tidak ada resume. Kerjanya sudah di-commit dan di-push; tidak ada
yang perlu dicampuri, dan worktree-nya memang sengaja dihapus.

`--fork-session` **tidak** dipakai. Dua agen yang menulis satu worktree adalah bug yang
menunggu giliran, dan `steer` sudah menjadi kanal aman untuk run yang masih hidup.

### 4. Guard PreToolUse di PTY — utang keamanan, bukan bagian dari fitur

`pty.ts:35` hari ini men-spawn `claude --dangerously-skip-permissions` **tanpa `--settings`**,
sehingga jalur terminal berjalan tanpa PreToolUse guard sama sekali. ADR-0010 menyebut hook itu
"satu-satunya gerbang yang tersisa" di bawah `--dangerously-skip-permissions`.

Lubang ini ada sebelum spec ini dan ditutup di dalamnya: `pty.ts` memasang `--settings` berisi
`guardSettings(guardCommand())`. Keduanya sudah diekspor — `guardSettings` dari
`@hanoman/runner` (`runner/src/claude-cli.ts:16`), `guardCommand` dari
`server/src/runner/deps.ts`. Berlaku untuk sesi project maupun sesi resume.

## Komponen

| Unit | Tanggung jawab | Bergantung pada |
|---|---|---|
| `runner/src/types.ts` | `RunEvent.phase` membawa `sessionId?` | — |
| `runner/src/run.ts` | teruskan `r.sessionId` ke event `phase` state `done` | `runPhase` |
| `server/src/runner/events-io.ts` | simpan `sessionId` ke entri `phases` | Prisma |
| `server/src/services/pty.ts` | argv resume + guard `--settings` | `@hanoman/runner` |
| `server/src/routes/terminal.ts` | terima `{ runId }`, tolak bila worktree hilang | `pty.ts`, Prisma |
| `src/src/screens/TerminalScreen.tsx` | tab sesi run | API |

## Penanganan galat

- **Worktree hilang** → `400`, pesan menyebut path yang dicari. Jangan diam-diam jatuh ke
  `repoDir`: itu akan membuka sesi di working tree utama, melanggar ADR-0002.
- **Fase belum punya `sessionId`** (run baru mengantre, atau semua fase gagal sebelum sesi
  terbentuk) → `400`, bukan sesi kosong.
- **Run `done`** → `400` dengan alasan eksplisit, bukan `404`.
- **`--resume` gagal** (transcript dipangkas, id asing) → `claude` mencetak
  `No conversation found` lalu keluar; PTY memancarkan frame `exit`, UI menampilkan sesi
  berakhir. Tidak perlu penanganan khusus.

## Rencana pengujian

- `runner/test/run.test.ts` — `sessionId` dari `runPhase` sampai ke event `phase` yang `done`.
- `server/test/events-io.test.ts` — `persistEvent` menulis `sessionId` ke entri `phases` yang
  benar dan tidak menimpa entri lain.
- `server/test/pty.test.ts` — argv resume berisi `--resume <id>` dan `--settings`; argv project
  tetap berisi `--settings`. Guard tidak boleh bisa hilang tanpa membuat test merah.
- `server/test/terminal-route.test.ts` — worktree hilang → `400`; run `done` → `400`; fase
  tanpa `sessionId` → `400`.
- Verifikasi nyata (wajib per `CLAUDE.md`): boot server, `curl` endpoint terminal untuk sebuah
  run `stopped`, pastikan sesi hidup dan `claude` benar-benar melanjutkan percakapan.

## Yang sengaja tidak dikerjakan

- Rename kosakata `Sdk*`/`queryFn` → pekerjaan mekanis terpisah; mencampurnya akan menenggelamkan
  diff spec ini.
- `--fork-session` untuk run `running`. Tambahkan bila `steer` terbukti kurang, dengan bukti
  dari pemakaian nyata.
- Menyimpan riwayat sesi lintas run.
- Memindahkan eksekusi fase ke PTY. Fakta 1 di atas menjelaskan alasannya; bila suatu saat
  `claude` memancarkan batas-giliran di mode interaktif, timbang ulang.
