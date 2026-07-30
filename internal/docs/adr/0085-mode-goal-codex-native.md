# ADR-0085 — Mode goal codex memakai goal native codex, berdampingan dengan gate sh

- Status: Accepted
- Tanggal: 2026-07-30
- SPEC: SPEC-397 (codex support goal mode)
- Terkait: **mengamandemen [0074](0074-codex-sebagai-mesin-sesi.md)** butir (b) — kalimat
  "`armGoalInTui` (`/goal`) tetap **khusus claude**; codex tak punya padanan terverifikasi" dicabut;
  memberi codex jalur kedua [0073](0073-mode-goal-stop-hook-per-sesi.md) yang sampai kini hanya
  dimiliki claude; **tidak** menyentuh [0029](0029-execute-done-butuh-plan-terceklist.md) (gate plan)
  maupun [0037](0037-cabut-guardrail-safety.md) (guardrail deny tetap dicabut).

## Konteks

Mode goal (ADR-0073) punya **dua jalur** untuk claude: hook `Stop` di `--settings` sebagai
**jaminan**, dan `armGoalInTui` yang mengetik `/goal <kondisi>` ke TUI sebagai **mesin continuation
Claude Code + visibilitas**. ADR-0074 memberi codex hanya jalur pertama, dalam bentuk yang lebih
tegas (gate sh deterministik `type="command"` karena codex mendiamkan handler `type="prompt"`), dan
menutup jalur kedua dengan alasan faktual: *codex tak punya padanan `/goal` yang terverifikasi.*

Alasan itu benar pada codex-cli **0.142.5** — versi yang diverifikasi ADR-0074. Ia **tidak lagi
benar** pada **0.146.0**.

### Temuan verifikasi (codex-cli 0.146.0, probe langsung — bukan ingatan)

1. **Codex punya mode goal native.** `codex features list` → `goals   stable   true`. Runtime-nya
   lengkap: tabel `thread_goals` di `$CODEX_HOME/goals_1.sqlite`, tool
   `create_goal`/`update_goal`/`get_goal`, akunting `token_budget`, template continuation
   (`goals/continuation.md`, `goals/budget_limit.md`, `goals/objective_updated.md`), dan tiga status
   di status line: `Pursuing goal (Ns)` · `Goal achieved (Ns)` · `Goal unmet (…)`.
2. **`/goal <objektif>` bekerja end-to-end.** Diketik ke pane tmux → `• Goal active  Objective: …`,
   status line `Pursuing goal (5s)`, codex **melanjutkan sendiri sesudah turn-nya berakhir** sampai
   objektif tercapai, lalu `Goal achieved (9s)`. Itu persis semantik mode goal.
3. **Diterima juga saat turn sedang berjalan** (di-steer). Penting: sesi hanoman lahir membawa prompt
   kerja sebagai argumen positional, jadi arming **selalu** terjadi di tengah turn.
4. **Gate sh yang ada tetap hidup.** Hook `Stop` `type="command"` masih menembak di 0.146.0. Jadi
   mengaktifkan jalur native tak menuntut apa pun dicabut.
5. **Objektif 4000 karakter diterima utuh** — `GOAL_MAX` (batas Claude Code yang disalin ADR-0073)
   tak perlu diturunkan untuk codex.
6. **1,3 detik sesudah spawn sudah cukup**; `/goal` tak kena
   `'…' is unavailable before the session starts`.

### Jebakan pemblokir: burst ≥ 1024 karakter jadi paste, dan `/goal` mati diam

TUI codex mengubah masukan yang **datang dalam satu burst ≥ 1024 karakter** menjadi lampiran
`[Pasted Content N chars]`. Begitu itu terjadi, isi composer bukan lagi teks yang dimulai `/goal`,
sehingga slash-dispatch tak jalan: masukannya terkirim sebagai **pesan chat biasa** — tanpa error,
tanpa goal, tanpa jejak apa pun yang menandai kegagalan.

| Cara kirim | Hasil |
| --- | --- |
| 766 char, satu `send-keys -l` | literal → `Goal active` |
| 1023 char, satu burst | literal |
| **1024 char, satu burst** | `[Pasted Content 1024 chars]` → **tak ada goal** |
| 1206 char, potongan 150 + jeda | literal → `Goal active` |
| 4000 char, potongan 500 + jeda 30 ms | literal → `Goal active` |
| **2000 char, 4×500 TANPA jeda** | `[Pasted Content 1500 chars]` → **tak ada goal** |

Baris terakhir yang menentukan bentuk implementasi: **deteksi paste itu per-burst PTY, bukan
per-invokasi `send-keys`.** Potongan tanpa jeda digabung ulang oleh satu `read()` dan tetap kena.
Memotong keystroke tanpa memberi jeda karena itu **tidak menyelesaikan apa pun**.

## Keputusan

**Sesi codex ber-mode-goal memasang goal NATIVE codex lewat `/goal`, dan gate sh `Stop` tetap
terpasang.** Dua jalur, cermin claude.

1. **Gerbang `agent === "claude"` di call site `createSession` dicabut.** `armGoalInTui` menerima
   agen dan dipanggil untuk keduanya. Tetap fire-and-forget: respons HTTP tak menunggu TUI.
2. **Keystroke dikirim terpotong dan ber-jeda.** Potongan **500** karakter dengan jeda **50 ms**.
   Angka 500 dipilih karena punya margin yang bisa dibuktikan: bila jeda gagal sekali dan dua
   potongan menyatu, 2×500 = 1000 **masih di bawah** 1024. Potongan 1023 tak punya margin —
   penggabungan sekali saja langsung melewati batas. Logikanya hidup sebagai fungsi murni
   `goalChunks()` di `runner/src/goal.ts` supaya bisa dites tanpa tmux.
3. **Verifikasi arming jadi sadar-agen.** codex diverifikasi lewat penanda yang benar-benar
   dipancarkan runtime goal-nya (`Goal active` / `Pursuing goal` / `Goal achieved`), **bukan**
   substring `/goal`. claude tetap memakai penanda lamanya.
4. **Arming yang gagal verifikasi dikirim ulang**, maksimal 3 percobaan.

### Kenapa verifikasi codex tak boleh memakai `includes("/goal")`

Saat degradasi paste terjadi, pane **memang** memuat `/goal …` — sebagai pesan chat. Assertion
`paneText.includes("/goal")` karena itu **lulus palsu tepat untuk kegagalan yang paling mungkin
terjadi**. Verifikasi yang tak bisa membedakan berhasil dari gagal juga yang membuat komentar lama
di `armGoalInTui` melarang kirim-ulang ("mengetik dua kali melahirkan dua pesan"). Dengan
verifikasi akurat, kirim-ulang jadi aman: ia hanya terjadi bila **tak ada** goal yang terpasang,
jadi tak pernah menimpa goal yang sudah hidup.

Verifikasi claude **tidak** diubah. Tak ada bukti terukur soal penanda mana yang dipancarkan Claude
Code saat goal terpasang; menggantinya dengan tebakan hanya memindahkan risiko ke agen yang hari ini
bekerja.

### Kenapa gate sh dipertahankan, bukan dicabut

Gate sh adalah satu-satunya hal yang benar-benar **membaca** berkas fase dan kotak `- [ ]` di plan
(cermin ADR-0029). Goal native menilai dengan prosa. Mencabut gate berarti menukar verifikasi
mekanis dengan penilaian model — untuk kerapian saja.

Konsekuensi yang diterima sadar, dan sama dengan yang sudah berlaku di claude sejak ADR-0073: **satu
percobaan berhenti dievaluasi dua kali**, jadi agen bisa menerima dua dorongan continuation
sekaligus. Keduanya mendorong ke arah yang sama, dan keduanya dibatasi — gate sh oleh
`GOAL_MAX_BLOCKS = 25`, goal native oleh akunting budget codex sendiri (`Goal unmet`).

## Konsekuensi

- **Tanpa migration, tanpa endpoint, tanpa knob baru.** `Setting.goal` + override saat Start sudah
  menggerbangi keduanya. Kontrak `GET/PUT /settings` dan `POST /terminal/sessions` tak berubah.
- **Kondisi goal prosa bebas kini BENAR-BENAR dievaluasi pada codex.** ADR-0074 mencatat sebagai
  konsekuensi jujur bahwa kondisi prosa "ikut sebagai teks alasan" saja pada codex; sejak ADR ini ia
  juga menjadi objektif goal native. Batasan itu dicabut.
- **Operator melihat statusnya.** Status line codex menampilkan `Pursuing goal` / `Goal achieved`,
  dan itu ikut ter-render di terminal web (xterm.js merender TUI apa adanya, ADR-0016).
- **Tak ada gerbang versi CLI.** Pada codex lama `/goal` cuma jadi pesan chat yang tak dipahami;
  verifikasi melaporkan gagal dan jaminannya tetap di gate sh. Menambah percabangan versi berarti
  merawat satu cabang lagi demi kegagalan yang sudah tak berbahaya.
- **ADR-0037 tetap berlaku.** Tak satu pun mekanisme di sini menolak tool call; keduanya menahan
  sesi *berhenti* sebelum DoD terbukti. Interupsi manusia (`Esc`) tetap bekerja.
- **Jebakan burst 1024 juga laten untuk claude.** `armGoalInTui` selalu mengirim satu burst, dan
  `GOAL_MAX` mengizinkan kondisi sampai 4000 karakter — kondisi kustom panjang berisiko degradasi
  senyap yang belum pernah terlihat karena kondisi bawaan hanoman ±766 karakter. Chunking dipakai
  untuk **kedua** agen, jadi perbaikannya sekalian.

### Dua jebakan test yang terukur saat mengeksekusi ADR ini

**(1) Fixture agen palsu bermode tty KANONIKAL tak bisa menerima baris ~1,3 KB+.** Test PTY memakai
agen palsu berupa skrip `sh` yang membaca stdin dengan `read -r line` di atas pty. Antrean masukan tty
punya batas yang bergantung timing pengurasan echo, jadi hasilnya **tidak deterministik di ukuran
besar**: terukur 900–1200 karakter selalu sampai, sementara 1300–1500 kadang sampai kadang tidak
(1500 lolos dengan potongan 500, gagal dengan potongan 400, dan gagal lagi lewat `armGoalInTui`).
Angkanya berdekatan dengan `MAX_CANON` = 1024 (`pathconf`) **dan** dengan batas paste codex yang juga
1024 — kebetulan yang membuatnya sangat mudah disalahatribusikan ke produk. Ini batasan **fixture**:
codex sungguhan membaca tty-nya di mode raw dengan buffer sendiri, dan objektif 4000 karakter terbukti
diterimanya. Karena itu test end-to-end memakai 900 karakter (2 potongan) dan hanya menjaga properti
"tiba utuh & berurutan"; properti "tak ada potongan ≥ 1024" dijaga unit test `goalChunks` di runner,
di mana ia deterministik.

**(2) vitest tidak menjalankan typecheck, dan `-t` menyaring nama test.** Menambah field ke
`GoalArmOpts` **tidak** memunculkan error TS di run vitest — field yang belum dikenal diam-diam
diabaikan saat runtime, jadi kegagalan TDD yang diharapkan bersifat perilaku, bukan tipe; error
tipenya baru muncul di `pnpm --filter ./server typecheck`. Dan menyaring dengan id sesi
(`-t "goal-cx"`) mengembalikan `35 tests | 35 skipped` — **nol test berjalan, dilaporkan tanpa
kegagalan**. Nama project vitest juga nama **paket** (`@hanoman/server`), bukan direktori:
`--project server` membalas "No test files found" tanpa error.

## Alternatif yang ditolak

- **Native `/goal` saja, gate sh dicabut.** Paling bersih dan paling mirip claude secara konseptual,
  tapi membuang verifikasi mekanis berkas fase & kotak plan. Ditolak: yang dibeli hanya kerapian,
  yang dijual adalah satu-satunya cek yang tak bergantung penilaian model.
- **Digerbangi deteksi versi codex** (`GET /api/codex/version` sudah ada). Ditolak: arming yang gagal
  memang sudah tak berbahaya, jadi gerbangnya hanya menambah cabang yang harus dirawat.
- **Mencoba ulang handler hook `type="prompt"`.** Binari 0.146.0 menyebut `prompt` sebagai varian
  `HookHandlerConfig`, jadi temuan "didiamkan" dari 0.142.5 mungkin kedaluwarsa. Ditolak untuk SPEC
  ini: goal native menyelesaikan masalah yang sama dengan mekanisme yang **sudah terverifikasi
  jalan**, dan memverifikasi ulang handler prompt bernilai tambah nol di sini.
- **Potongan 1023 karakter** (sedekat mungkin dengan batas, paling sedikit invokasi `send-keys`).
  Ditolak: nol margin terhadap penggabungan burst, dan penghematannya beberapa milidetik.
- **Menyalakan goal lewat config `-c` saat lahir** alih-alih keystroke. Tak ada knob config maupun
  flag CLI untuk itu di 0.146.0 (`codex --help` tak punya `--goal`); satu-satunya pintu adalah slash
  command di TUI.
