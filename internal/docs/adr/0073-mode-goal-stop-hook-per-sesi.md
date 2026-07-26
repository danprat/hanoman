# ADR-0073 — Mode goal sesi backlog: Stop hook bertipe `prompt` saat sesi lahir + keystroke `/goal`

- Status: Accepted
- Tanggal: 2026-07-26
- SPEC: SPEC-332 (Backlog goals mode)
- Terkait: **memperkuat [0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)** (otonomi
  lintas-fase kini punya mekanisme, bukan hanya klausa prompt), memberi **cermin runtime** bagi
  [0029](0029-execute-done-butuh-plan-terceklist.md) (gate plan terceklist), mengikuti pola
  [0061](0061-model-effort-per-sesi-picker-start.md) (knob dipilih saat Start → argv saat sesi lahir),
  memperluas [0015](0015-one-session-per-backlog.md)/[0016](0016-sesi-terminal-hidup-di-tmux.md);
  **TIDAK membalik** [0037](0037-cabut-guardrail-safety.md).

## Konteks

Sesi backlog hanoman berjalan tak-berpenunggu dan sering **berhenti sebelum tuntas**: fase jadi
dangkal, plan masih menyisakan `- [ ]`, atau agen `end_turn` setelah subagent async. Yang menahannya
hari ini hanya **teks prompt** — `AUTONOMY_CLAUSE` (ADR-0035) dan cermin gate plan (ADR-0029) — yaitu
imbauan, bukan mekanisme. Server memang menahan stage di `executing` (ADR-0029), tetapi prosesnya
sendiri sudah mati; operator harus menyalakan ulang sesi secara manual.

Claude Code (diverifikasi pada 2.1.220 yang terpasang) punya mekanisme nyata untuk ini:

- `/goal <kondisi>` = slash command built-in, `{type:"local", name:"goal", supportsNonInteractive:true}`,
  "Set a goal — keep working until the condition is met". Sub-perintah `/goal` / `/goal active`
  (status) dan `/goal clear` (lepas). Batas kondisi **4000 karakter**.
- Mesinnya: memasang **Stop hook bertipe `prompt`** —
  `sessionHooksRegistry.add(cwd, "Stop", "", {type:"prompt", prompt:<kondisi>})` — lalu men-set
  `appState.activeGoal`.
- Tipe hook `prompt` adalah **warga kelas satu di schema `--settings`**: `{type:"prompt", prompt, if?,
  timeout?, model?, continueOnBlock?, statusMessage?, once?}`, dideskripsikan "LLM prompt hook type".
- **Tidak ada flag CLI `--goal`.** Satu-satunya jalan non-interaktif adalah memasang hook itu sendiri.
- Gate `/goal`: workspace trusted (sesi hanoman jalan `--dangerously-skip-permissions` → terpenuhi) +
  hooks tak dibatasi (`disableAllHooks`/`allowManagedHooksOnly` mematikannya).
- Evaluator hook `prompt` berjalan dengan system prompt *"You are evaluating a hook condition in Claude
  Code… Answer based on transcript evidence only"*, mengembalikan `{"ok":bool,"reason":string}` lewat
  json_schema, memakai model kecil-cepat (bisa di-override `model`). **Ia tidak punya tool.**
- Transkrip Stop yang panjang **dipotong**; instruksinya: bila bukti mungkin ada di bagian yang
  dibuang, kembalikan `{"ok":false,"reason":"insufficient evidence in transcript"}`.
- Claude Code mengenali "condition judged impossible" → goal gagal ("Goal could not be achieved"),
  jadi kondisi mustahil tidak membuat sesi berputar selamanya.
- `Rlt(appState, cwd, "Stop")` — sumber yang dibaca `/goal` untuk mencari goal lama — membaca **hanya
  `appState.sessionHooks`**, bukan hook dari settings.

hanoman sudah memiliki dan menguasai jalur `--settings` (`runner/src/settings.ts` → `guardSettings`,
sisa SPEC-184 setelah guardrail dicabut). Jadi mekanisme ini bisa dipasang dari luar, saat sesi lahir.

## Keputusan

1. **Mode goal dipasang lewat `--settings`, saat sesi lahir.** `guardSettings(decisionFile?, goal?)`
   menyisipkan `{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"<kondisi>"}]}]}}` — mesin yang
   **sama persis** dipasang `/goal`, tetapi deterministik: tak bergantung timing TUI maupun kepatuhan
   agen mengetik apa pun. Ini mengikuti pola ADR-0061 (knob → argv saat lahir = andal penuh).

2. **Keystroke `/goal` sebagai jalur KEDUA, best-effort, untuk visibilitas.** Sesudah `new-session`,
   `armGoalInTui` (fire-and-forget) menunggu pane menggambar, lalu `tmux send-keys -l "/goal <kondisi
   satu baris>"` + `Enter`, lalu memverifikasi lewat `capture-pane`; gagal → **menyerah diam-diam**.
   Gunanya: Claude Code men-set `activeGoal` miliknya, sehingga `/goal` menampilkan status dan goal
   ikut dipulihkan saat sesi di-resume. Dikirim **sekali** (mengetik dua kali = dua pesan liar).

3. **Keduanya hidup berdampingan.** Karena `/goal` hanya membaca session hooks registry, hook kita di
   settings tak terlihat olehnya: keduanya tak saling menghapus, dan `/goal clear` tak akan pernah
   melepas hook settings. Konsekuensi yang **diterima sadar**: saat keduanya terpasang, satu percobaan
   stop dievaluasi dua kali (dua panggilan model kecil).

4. **Kondisi default = DoD hanoman, menuntut BUKTI SEGAR.** `defaultGoalCondition` (runner, library
   murni) merakit: (1) output `cat "$HANOMAN_PHASE_FILE"` memuat satu baris `done`/`skipped` untuk
   SETIAP fase pipeline; (2) output `grep -rn -- "- \[ \]" docs/superpowers/plans/` kosong (hanya untuk
   flow ber-fase Plan+Execute — cermin ADR-0029); (3) output `git push origin HEAD:refs/heads/<branch>`
   sukses. Bukti diminta **di transkrip terbaru** justru karena evaluator hanya membaca transkrip dan
   transkrip panjang dipotong — klaim agen "sudah selesai" tidak cukup.

5. **Presedens kondisi:** override per sesi (`goalCondition`) → template global
   (`Setting.goal.condition`) → default bawaan. Diresolusi di `startSpecSession`, sehingga Start manual
   **dan** governor scheduler memakai jalur yang sama; governor tak memasok apa pun → ikut default global.

6. **Knob `Setting.goal = { enabled:false, condition:"" }`**, dipasang `.default(GOAL_DEFAULTS)` seperti
   `scheduler` (ADR-0072) → baris `Setting` lama tetap parse, **tanpa migration**. Body
   `POST /terminal/sessions` varian backlog bertambah `goal?: boolean` (undefined → ikut global,
   `false` → mati walau global menyala) dan `goalCondition?: string` (≤ 4000).

7. **Cakupan: sesi backlog saja** (spec-flow `feature`/`qa`/`audit` lewat `startSpecSession`). Sesi
   `prd`, `reverse`, `scaffold`, `breakdown`, dan terminal biasa **tidak** disentuh — `prd`/`reverse`
   memang sesi bergiliran dengan manusia, dan Stop gate melawan sifat interaktifnya.

## Konsekuensi

- **ADR-0037 tetap berlaku sepenuhnya.** Yang dipasang di sini adalah **gate kelanjutan** pada event
  `Stop`: ia tak pernah menolak tool call, tak membatasi apa yang boleh dikerjakan agen, dan tak
  mengembalikan `runner/src/safety.ts`. Isolasi worktree tetap satu-satunya batas keamanan.
  Menambahkan hook `PreToolUse` deny tetap butuh ADR baru tersendiri.
- **Kendali manusia utuh.** Interrupt (`Esc`) bukan event `Stop`, jadi operator selalu bisa memotong
  sesi. Melepas gate sepenuhnya = hentikan sesinya dari dashboard.
- **Biaya.** Setiap percobaan stop membayar satu (atau dua, bila keystroke berhasil) panggilan model
  kecil. Ini disengaja: harganya jauh lebih murah daripada backlog yang mati separuh jalan.
- **Default mati.** Tak ada sesi yang berubah perilaku sampai operator menyalakannya di Settings atau
  per sesi saat Start.
- **Ketergantungan versi CLI.** Mekanisme ini bersandar pada tipe hook `prompt` di `--settings`. Bila
  Claude Code mengubah/menghapusnya, mode goal berhenti bekerja **secara diam** (hook tak dikenal
  diabaikan) — sesi tetap jalan seperti sebelumnya, tak ada kerusakan. Verifikasi ulang saat
  menaikkan versi CLI.

## Alternatif yang ditolak

- **Keystroke `/goal` saja.** Rapuh: balapan dengan boot TUI, pesan bisa masuk antrean saat agen sedang
  bekerja, dan gagal tanpa jejak — justru pada sesi tak-berpenunggu yang paling membutuhkannya.
- **Klausa prompt saja** ("jangan berhenti sebelum selesai"). Itulah yang sudah ada (ADR-0035) dan
  justru yang gagal: imbauan tanpa mekanisme.
- **Hook tipe `agent`** (boleh memakai tool untuk memverifikasi kondisi — ia bisa benar-benar men-`grep`
  plan alih-alih memercayai transkrip). Lebih kuat, tetapi bukan mesin `/goal` yang diminta, jauh lebih
  mahal (satu sub-agen per percobaan stop), dan menambah permukaan baru. Dicatat sebagai kelanjutan
  yang mungkin bila gate transkrip terbukti terlalu longgar.
- **Kolom/tabel baru untuk status goal per sesi.** Tak perlu: tmux tetap satu-satunya sumber kebenaran
  sesi berjalan (ADR-0016), dan kondisi hidup di argv sesi itu sendiri.
