# Audit SPEC-402 — sesi terminal "Selesai" di tengah jalan padahal belum selesai

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** major · **Tanggal:** 2026-07-30
**Metode:** `superpowers:systematic-debugging`

## Keluhan

> "Issue sesi terminal selesai di tengah running padahal belum selesai dan itu intermitten"

## Ringkasan temuan

Sesi memang **benar-benar mati** di tengah kerja — bukan ilusi UI — dan pembunuhnya adalah **sesi
hanoman lain di mesin yang sama**. `pkill -f <pola>` yang dipakai satu sesi untuk membereskan
proses nyangkut (`pkill -f "tsc"`, `pkill -f "vitest"`) **ikut mengenai proses agen sesi-sesi
lain**, karena hanoman menyerahkan **seluruh prompt sesi sebagai argumen command-line** agen
(`claude "$(cat <promptfile>)"`, SPEC-223) — dan prompt itu memuat persis kata-kata yang dipakai
pola tersebut (`pnpm vitest …`, `satu proses tsc per paket`, `node server/dist/server.js`).
Lebih tepatnya: **klausa scope verifikasi hanoman sendiri** (SPEC-376/ADR-0080) adalah muatan yang
kena match.

Sesudah agennya di-SIGTERM, pane mati dengan status **143** dan hanoman melabelinya
**"Selesai"** — pil hijau `status="done"` yang sama persis dengan sesi yang benar-benar tuntas,
karena kode keluar pane **tak pernah sampai ke UI**. Jadi keluhan "selesai padahal belum selesai"
berlaku dua lapis: sesinya dihentikan orang lain, lalu dilaporkan sebagai sukses.

Tiga cacat, semuanya terukur:

| # | Cacat | Akibat |
|---|-------|--------|
| A | Prompt sesi hidup di argv agen → `pkill -f` sesi lain mengenainya | agen di-SIGTERM di tengah kerja (**akar**) |
| B | `SessionInfo` membuang kode keluar pane | pane mati status ≠ 0 tampil sebagai **"Selesai"** hijau |
| C | `listPanes()` membaca **gagal**-nya `tmux` sebagai **"tak ada sesi"** | satu kegagalan `tmux list-panes` menyiarkan `exit 0` ke SEMUA terminal terbuka |

## Bukti — (A) pkill sesi tetangga

`SessionHistory` (DB prod lokal, 68 baris) hanya punya **dua** baris berkode keluar; keduanya
**143** = `128 + SIGTERM`:

| sessionId | project | stage saat mati | exitCode |
|---|---|---|---|
| `spec-319` | base-tumbuh-ai | `spec-ready` | 143 |
| `spec-390` | kirimchat-multi | `done` | 143 |

Transkrip pane keduanya (ADR-0079) memuat layar perpisahan Claude Code — pola khas **shutdown
sopan sesudah menerima SIGTERM**, bukan crash:

```
Resume this session with:
claude --resume 2cc45899-1d71-4fe1-babc-8680da7b3eca
…
Pane is dead (status 143, Wed Jul 29 22:36:08 2026)     ← spec-319
Pane is dead (status 143, Wed Jul 29 22:36:10 2026)     ← spec-390
```

Dua pane mati **2 detik berselang**. Pembunuhnya ada di transkrip JSONL sesi **`spec-389`**
(kirimchat-multi) — sesi hanoman lain yang saat itu juga hidup:

```
2026-07-29T15:35:50.333Z  pkill -f "tsc --noEmit" ; sleep 1; ps aux | grep -c "[t]sc --noEmit"
2026-07-29T15:36:04.439Z  pkill -f "tsc" ; pkill -f "vitest"; sleep 2; npx tsc --noEmit …
```

`15:36:04.4Z` = **22:36:04 WIB**, empat dan enam detik sebelum kedua pane mati. Korelasinya bukan
kebetulan: waktunya berurutan, sinyalnya SIGTERM, dan mekanismenya bisa direproduksi hari ini.

### Kenapa pola itu mengenai sesi lain

Proses pane sebuah sesi hanoman adalah `claude <prompt>` — **prompt utuh ada di argv**, dan
`pkill -f` mencocokkan *seluruh argument list*. Reproduksi non-destruktif atas tiga sesi yang
hidup saat audit ini ditulis (`pgrep`, bukan `pkill`):

```
$ pgrep -fl vitest
10592  claude hanoman qa. Ikuti internal/docs sebagai Source of Truth …   ← sesi spec-401
20717  claude hanoman feature — MELANJUTKAN sesi backlog …                ← sesi spec-398
16052  node (vitest 1) …                                                  ← vitest sungguhan
```

`pgrep -fl typecheck` mencocokkan dua sesi yang sama. Muatannya adalah klausa `CHANGED` di
`runner/src/verify-scope.ts`: di dalamnya `vitest` muncul **5×**, plus `tsc`, `pytest`, `pnpm test`,
`node server/dist/server.js`, `curl`. Artinya **setiap** sesi ber-`verifyScope=changed` — default
global (ADR-0080) — otomatis cocok dengan `pkill -f vitest` maupun `pkill -f tsc`.

### Kenapa pembunuhnya sendiri selamat (dan kenapa itu justru memperburuk)

`spec-389` menjalankan `pkill` tapi tak mati; `SessionHistory`-nya ditutup 15:41:48Z dengan
`exitCode` **null** (= pane masih hidup saat ditutup operator). Alasannya ada di man page
`pkill(1)` macOS/BSD:

> `-a` Include process ancestors in the match list. By default, the current pgrep or pkill
> process and **all of its ancestors are excluded**.

Agen pemanggil adalah **leluhur** `pkill`-nya sendiri, jadi ia dikecualikan; agen sesi lain
bukan leluhur siapa-siapa, jadi kena. Di lingkungan hanoman, `pkill -f <pola>` karena itu
berperilaku sebagai **"bunuh semua sesi lain, sisakan sesi saya"** — dan itulah bentuk
"intermitten" yang dilaporkan: gejalanya muncul hanya saat ada sesi tetangga yang membereskan
proses nyangkut, dan yang mengalaminya selalu sesi *lain*.

### Yang TIDAK bisa diperbaiki secara mekanis

Prompt harus jadi argumen positional: `claude --help` dan `codex --help` **tak punya** opsi
prompt-dari-berkas (`--system-prompt-file` ada, prompt user tidak), dan stdin dipakai TUI, jadi
prompt tak bisa dipipe. Berkas prompt SPEC-223 pun tetap di-expand `"$(cat …)"` oleh `sh` **sebelum**
exec, jadi argv-nya tetap penuh. Menyuntikkan prompt sebagai keystroke pasca-lahir (pola
`goalChunks`, ADR-0085) bukan jalan keluar: prompt multi-baris akan ter-submit di newline pertama.
Jadi permukaan argv itu **diterima sebagai fakta**, dan yang diperbaiki adalah (a) kontrak
perilaku agen, dan (b) kejujuran laporan hanoman saat sesi memang mati.

## Bukti — (B) pane mati status ≠ 0 dilaporkan "Selesai"

`listPanes()` sudah membaca `#{pane_dead_status}` ke `Pane.code`, tapi `listSessions()`
**membuangnya**: `SessionInfo` hanya membawa `exited: boolean`. Akibatnya `SessionDTO`
(`shared/src/dto.ts`) dan `TerminalSession` (klien) pun tak punya kode keluar, dan
`TerminalScreen.tsx` merender:

```tsx
{session.exited && <StatusPill status="done" size="sm">Selesai</StatusPill>}
```

Sesi yang agennya di-SIGTERM di tengah kerja tampil **identik** dengan sesi yang tuntas: pil
hijau "Selesai" + `--status-ok-tint`. Frame `{t:"exit",code}` sebenarnya membawa kodenya ke
browser, tapi `markExited(id)` menerima `code` lalu **mengabaikannya** — dan sesudah refresh
kode itu hilang total karena daftar sesi tak pernah memuatnya. Ini yang membuat operator percaya
sesi sudah selesai padahal pekerjaannya terputus.

## Bukti — (C) `tmux` gagal dibaca sebagai "tak ada sesi"

```ts
function listPanes(): Pane[] {
  let out: string;
  try { out = tmux("list-panes", "-a", "-F", FMT); }
  catch { return []; }   // ← SEMUA kegagalan, bukan hanya "server belum jalan"
```

`[]` lalu diartikan loop poll 500 ms sebagai "semua sesi dibunuh dari luar":

```ts
const p = live.get(id);
if (!p) end(id, 0);      // → broadcast {t:"exit",code:0} → "— sesi berakhir (exit 0) —"
```

Satu kegagalan invokasi `tmux` (mis. `posix_spawn` EAGAIN saat mesin penuh proses, socket knob
`HANOMAN_TMUX_SOCKET` berubah, atau tmux server kedip) karena itu cukup untuk memberi tahu
**semua** terminal yang sedang terbuka bahwa sesinya berakhir sukses — padahal pane-nya hidup.
Dua hal memperparahnya:

1. **Lengket.** `services/events.ts` menyiarkan grup `sessions` hanya bila signature-nya berubah;
   karena tmux tak berubah, kebenaran (`exited:false`) **tak pernah dikirim ulang** dan pil
   "Selesai" bertahan sampai daftar sesi berubah karena sebab lain.
2. **Bisa merusak data.** Gerbang kelahiran sesi memakai `getSession(id)` yang bersumber sama;
   `undefined` palsu membuat `startSpecSession` menganggap tak ada sesi → `realGit.addWorktree`
   merebut path dengan `remove --force` + `rmSync` **atas worktree sesi yang sedang berjalan**
   (ADR-0084 menyebut helper itu "fatal sebagai lanjutkan"). Kegagalan `tmux` tak boleh dibaca
   sebagai izin untuk itu.

**Kontrol negatif:** 300 invokasi `tmux list-panes -a -F <FMT>` berurutan di socket prod tak sekali
pun gagal (latensi puncak 632 ms, keluaran puncak 842 byte — jauh di bawah `maxBuffer` 1 MiB), jadi
(C) **bukan** pemicu insiden 29 Juli. Ia tetap diperbaiki di sini karena ia satu-satunya jalur lain
yang bisa menghasilkan "Selesai" pada sesi yang masih berjalan, dan biayanya beberapa baris.

## Akar masalah

1. **Prompt sesi = argv agen**, dan prompt hanoman memuat nama-nama perkakas (`vitest`, `tsc`,
   `node server/dist/server.js`). `pkill -f` milik satu sesi karena itu mengenai agen sesi lain,
   sementara BSD `pkill` mengecualikan leluhurnya sendiri → korbannya selalu sesi tetangga.
2. **hanoman tak membedakan "pane mati" dari "pekerjaan selesai".** Kode keluar pane berhenti di
   `Pane.code` dan tak pernah menyeberang ke `SessionInfo`/DTO/UI.
3. **`listPanes()` menyamakan kegagalan alat dengan ketiadaan sesi**, sehingga noise infrastruktur
   bisa menyiarkan `exit 0`.

## Keputusan pasca-Audit (ADR-0040)

**Spec & Plan `skipped`.** Akar masalah pasti dan terbukti; perbaikannya kecil, aditif, tanpa
skema/migration/endpoint/ADR baru. Dokumen ini menjadi doc-of-record.

Perbaikan:

1. `runner/src/verify-scope.ts` — klausa kontrak: **jangan** membunuh proses lewat pola
   (`pkill -f`, `killall`); bunuh per-PID/port, atau sempitkan pola ke path worktree sendiri.
   Menumpang gerbang klausa scope yang sudah ada (satu titik, hanya flow ber-fase Execute).
2. `server/src/services/pty.ts` — `SessionInfo.exitCode` (diisi hanya saat `exited`), diteruskan
   `listSessions()`; `shared/src/dto.ts` `SessionDTO` & klien `TerminalSession` menyusul.
3. `src/src/screens/TerminalScreen.tsx` — pane mati berkode ≠ 0 → pil **"Gagal"** (`status="fail"`),
   bukan "Selesai"; `markExited(id, code)` menyimpan kodenya supaya frame `exit` tak lagi terbuang.
4. `server/src/services/pty.ts` — `listPanes()` mengembalikan `[]` **hanya** untuk sinyal
   "tak ada tmux server"; kegagalan lain dilempar, loop poll melewatkan tick (keadaan tak diketahui
   bukan bukti sesi berakhir) dan `events.ts` melewatkan siaran grup (mekanisme yang sudah ada).
   `sessionPhasesBySpec()` sengaja tetap lunak (peta kosong): overlay stage forward-only, jadi
   tick tanpa overlay tak berbahaya.

Non-goal (ponytail): notifikasi `fail` otomatis untuk sesi yang mati abnormal — deteksinya hanya
mencakup sesi yang sedang ter-attach, jadi butuh pengamat sendiri.
