# SPEC-397 — Mode goal codex memakai goal native codex

**Tanggal:** 2026-07-30 · **Sumber:** brief · **Prioritas:** tinggi
**Objective:** support codex menggunakan goal mode
**Status:** design — satu percabangan dibawa ke operator (mekanisme jaminan) dan sudah dijawab;
sisanya dijawab bukti terukur di codex-cli 0.146.0

## Masalah

Mode goal (SPEC-332 · [ADR-0073](../../../internal/docs/adr/0073-mode-goal-stop-hook-per-sesi.md))
punya **dua jalur** untuk claude:

| Jalur | Peran | Mekanisme |
| --- | --- | --- |
| hook `Stop` di `--settings` | **jaminan** | evaluator prosa (`type: "prompt"`) menahan sesi berhenti |
| `armGoalInTui` mengetik `/goal <kondisi>` | **visibilitas + mesin continuation Claude Code** | keystroke tmux ke TUI |

Untuk codex ([ADR-0074](../../../internal/docs/adr/0074-codex-sebagai-mesin-sesi.md)) hanya jalur
pertama yang ada, dan bentuknya berbeda: gate **sh deterministik** (`codexGoalScript`) dipasang
sebagai `Stop` hook `type="command"`, karena codex mendiamkan handler `type="prompt"`. Jalur kedua
sengaja ditutup di satu baris:

```ts
// server/src/services/pty.ts:349
if (opts.goal && !opts.command && agent === "claude") void armGoalInTui(id, opts.goal)...
```

dengan alasan yang ditulis di komentarnya: *"codex tak punya padanan terverifikasi"*.

**Alasan itu sudah kedaluwarsa.** Benar di codex-cli 0.142.5 (versi yang diverifikasi ADR-0074),
salah di **0.146.0** yang terpasang sekarang.

## Bukti terukur (codex-cli 0.146.0, probe langsung — bukan ingatan)

1. **Codex punya mode goal native.** `codex features list` → `goals   stable   true`. Binarinya
   memuat runtime goal penuh: tabel `thread_goals` di `$CODEX_HOME/goals_1.sqlite`, tool
   `create_goal`/`update_goal`/`get_goal`, akunting `token_budget`, template continuation
   (`goals/continuation.md`, `goals/budget_limit.md`, `goals/objective_updated.md`), dan tiga status
   di status line: `Pursuing goal (Ns)` · `Goal achieved (Ns)` · `Goal unmet (…)`.
2. **`/goal <objektif>` bekerja end-to-end.** Diketik ke pane tmux → transcript menampilkan
   `• Goal active  Objective: …`, status line `Pursuing goal (5s)`, codex **melanjutkan sendiri
   sesudah turn-nya berakhir** sampai objektif tercapai, lalu `Goal achieved (9s)`. Itu persis
   semantik yang dituntut mode goal.
3. **Diterima juga saat turn sedang berjalan** (di-steer) — penting, karena sesi hanoman lahir
   membawa prompt kerja sebagai argumen positional, jadi arming selalu terjadi di tengah turn.
4. **Gate sh yang ada sekarang masih hidup.** Hook `Stop` `type="command"` tetap menembak di 0.146.0
   (marker terbukti tertulis oleh hook saat turn berakhir). Jadi mengaktifkan jalur native **tidak**
   menuntut apa pun dicabut.
5. **`GOAL_MAX` 4000 aman untuk codex.** Objektif 4000 karakter ter-arm penuh.
6. **1,3 detik sesudah spawn sudah cukup.** `/goal` pada t≈1,3 s tidak kena
   `'…' is unavailable before the session starts`.

### Gotcha pemblokir: burst ≥ 1024 karakter jadi paste, dan `/goal` mati diam

TUI codex mengubah masukan yang **datang dalam satu burst ≥ 1024 karakter** menjadi lampiran
`[Pasted Content N chars]`. Begitu itu terjadi, isi composer bukan lagi teks yang dimulai `/goal`,
jadi slash-dispatch **tidak jalan**: masukannya terkirim sebagai **pesan chat biasa**, tanpa error,
tanpa goal.

| Cara kirim | Hasil |
| --- | --- |
| 766 char, satu `send-keys -l` | literal → `Goal active` |
| 1023 char, satu burst | literal |
| **1024 char, satu burst** | `[Pasted Content 1024 chars]` → **tak ada goal** |
| 1206 char, satu burst | `[Pasted Content 1206 chars]` → **tak ada goal** |
| 1206 char, potongan 150 + jeda | literal → `Goal active` |
| 4000 char, potongan 500 + jeda 30 ms | literal → `Goal active` |
| **2000 char, 4×500 TANPA jeda** | `[Pasted Content 1500 chars]` → **tak ada goal** |

Baris terakhir yang paling penting: **deteksi paste itu per-burst PTY, bukan per-invokasi
`send-keys`.** Potongan tanpa jeda digabung ulang oleh satu `read()` dan tetap kena. Jadi
"potong saja" bukan solusi — potongan **harus** ber-jeda.

Ini juga jebakan laten untuk claude: `armGoalInTui` hari ini selalu mengirim satu burst, jadi
kondisi kustom panjang (`GOAL_MAX` mengizinkan sampai 4000) sudah berisiko degradasi senyap.
Kondisi **bawaan** hanoman ±766 karakter — di bawah 1024, jadi bug ini belum pernah terlihat.

## Keputusan operator

Ditanyakan di terminal, dijawab: **native `/goal` + gate sh tetap.**

Alasannya sejalan dengan pola claude: hook adalah **jaminan**, `/goal` adalah **mesin continuation +
visibilitas**. Gate sh adalah satu-satunya hal yang benar-benar **membaca** berkas fase dan kotak
`- [ ]` di plan; goal native menilai dengan prosa. Mencabut gate berarti menukar verifikasi mekanis
dengan penilaian model. Konsekuensi yang diterima sadar — sama seperti yang sudah tertulis di
komentar `armGoalInTui` untuk claude: satu percobaan berhenti dievaluasi **dua kali**, jadi agen bisa
menerima dua dorongan continuation sekaligus. Keduanya mendorong ke arah yang sama.

## Rancangan

Tidak ada skema, migration, endpoint, kontrak API, atau knob baru. Yang berubah: satu gerbang, cara
keystroke dikirim, dan cara arming diverifikasi.

### 1. `runner/src/goal.ts` — chunking sebagai fungsi murni

```ts
export const GOAL_TUI_PASTE_LIMIT = 1024;   // terukur: ≥ ini dalam satu burst → [Pasted Content]
export const GOAL_CHUNK = 500;              // 2×500 = 1000 < 1024
export function goalChunks(line: string, size = GOAL_CHUNK): string[]
```

Ukuran potongan **500**, bukan 1023, dengan alasan yang bisa dibuktikan: bila jeda gagal sekali dan
dua potongan menyatu, 2×500 = 1000 **masih di bawah** 1024. Potongan 1023 tidak punya margin —
penggabungan sekali saja langsung melewati batas.

`goalChunks` murni & tanpa I/O supaya bisa dites tanpa tmux: potongan direkonstruksi utuh, tak ada
potongan ≥ `GOAL_TUI_PASTE_LIMIT`, dan gabungan dua potongan bersebelahan pun tetap di bawah batas.

### 2. `server/src/services/pty.ts` `armGoalInTui` — sadar-agen

Tanda tangannya menerima agen:

```ts
armGoalInTui(id, condition, { agent, ...timings })
```

Tiga perubahan perilaku:

| Aspek | Sekarang | Sesudah |
| --- | --- | --- |
| kirim keystroke | satu `send-keys -l "/goal <line>"` | `/goal ` lalu `goalChunks(line)`, **ber-jeda** `chunkMs` (default 50 ms) |
| verifikasi | `paneText.includes("/goal")` | claude: apa adanya · **codex: penanda goal sungguhan** |
| kegagalan | menyerah | kirim ulang, maksimal `sendTries` (default 3) |

**Verifikasi codex tidak boleh memakai `includes("/goal")`.** Saat degradasi paste terjadi, pane
**memang** memuat `/goal …` — sebagai pesan chat. Assertion hari ini karena itu **lulus palsu tepat
untuk bug yang sedang diperbaiki**. Penanda codex diambil dari string yang benar-benar dipancarkan
runtime goal: `Goal active`, `Pursuing goal`, `Goal achieved`.

Verifikasi claude **tidak** diubah. Tak ada bukti terukur soal penanda mana yang dipancarkan Claude
Code saat goal terpasang, dan menggantinya dengan tebakan hanya memindahkan risiko ke agen yang
hari ini bekerja.

Kirim-ulang aman justru **karena** verifikasinya akurat: retry hanya terjadi bila tak ada goal yang
terpasang, jadi ia tak pernah menimpa goal yang sudah hidup. (Komentar lama "SEKALI kirim, mengetik
dua kali melahirkan dua pesan" berlaku saat verifikasinya tak bisa membedakan berhasil dari gagal.)

### 3. Call site `createSession`

Gerbang `agent === "claude"` dicabut; agen diteruskan ke helper:

```ts
if (opts.goal && !opts.command) void armGoalInTui(id, opts.goal, { agent }).catch(() => {});
```

Tetap fire-and-forget: respons HTTP tak boleh menunggu TUI, dan gagal arming tak berbahaya — gate sh
memegang jaminannya. Tak perlu gerbang versi CLI: pada codex lama `/goal` cuma jadi pesan chat yang
tak dipahami, dan verifikasi akan melaporkan gagal tanpa merusak apa pun.

### Yang sengaja TIDAK dikerjakan

- **Gate sh tidak disentuh.** `codexGoalScript`, `codexHookArgs`, `GOAL_MAX_BLOCKS` utuh.
- **Handler `prompt` codex tidak dicoba lagi.** Binari 0.146.0 memang menyebut `prompt` sebagai
  varian `HookHandlerConfig`, jadi temuan "didiamkan" dari 0.142.5 mungkin kedaluwarsa — tapi goal
  native menyelesaikan masalah yang sama dengan mekanisme yang **sudah terverifikasi jalan**.
  Memverifikasi ulang handler prompt adalah pekerjaan lain dengan nilai tambah nol di sini.
- **Tak ada knob baru.** `Setting.goal` + override saat Start sudah menggerbangi keduanya.
- **Copy UI tidak diubah.** Kartu Settings dan field Start sudah netral-agen ("Sesi menolak berhenti
  sampai kondisinya terbukti"); hanya komentar kode yang menyebut "Claude Code" dan itu ikut
  diperbarui.

## Testing

| Berkas | Yang dijaga |
| --- | --- |
| `runner/test/goal.test.ts` | `goalChunks`: rekonstruksi utuh · tak ada potongan ≥ 1024 · dua potongan bersebelahan < 1024 · kondisi `GOAL_MAX` terpotong sah · potongan kosong/pendek |
| `server/test/pty.test.ts` | `armGoalInTui`: sesi codex **tidak** dianggap ter-arm hanya karena pane memuat `/goal` · sesi codex ter-arm saat pane memuat penanda runtime goal · kondisi multi-potongan tiba **utuh & berurutan** · claude tetap lolos dengan penanda lamanya · `createSession` ber-agen codex ikut memanggil arming |

Test `armGoalInTui` memakai tmux nyata seperti test SPEC-332 yang sudah ada, dengan fixture `sh`
sebagai agen palsu — keystroke yang masuk terbaca dari isi pane, jadi kontraknya bisa diukur tanpa
memanggil model.

**Batas fixture yang harus dihormati (terukur saat eksekusi, bukan diperkirakan):** fixture itu
membaca tty di mode **kanonikal**, dan antrean masukan tty punya batas yang bergantung timing
pengurasan echo — 900–1200 karakter selalu sampai, 1300–1500 kadang sampai kadang tidak. Angkanya
berdekatan dengan `MAX_CANON` 1024 **dan** dengan batas paste codex yang juga 1024, kebetulan yang
membuatnya mudah disalahatribusikan ke produk. Karena itu test end-to-end memakai **900** karakter
(2 potongan) dan hanya menjaga "tiba utuh & berurutan"; properti "tak ada potongan ≥ 1024" dijaga
`goalChunks` di runner, di mana ia deterministik. Menaikkan panjangnya hanya melahirkan flake.

**Verifikasi live wajib** terhadap codex sungguhan, karena unit test hanya membuktikan kontrak
hanoman: `createSession` ber-mode-goal di worktree scratch dengan `CODEX_HOME` sekali-pakai harus
menghasilkan `Goal active` → prompt kerja berakhir → codex **melanjutkan sendiri** → `Goal achieved`.

## Docs yang tersentuh

- `internal/docs/adr/0085-mode-goal-codex-native.md` — **baru**, mengamandemen ADR-0074.
- `internal/docs/README.md` + `internal/docs/adr/README.md` — ADR baru ditaut di **keduanya**
  (SPEC-386).
- `internal/skills/hanoman/SKILL.md` — butir ADR-0074 & mode goal: `armGoalInTui` tak lagi khusus
  claude, plus gotcha burst 1024.
