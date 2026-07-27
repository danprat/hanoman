# SPEC-338 — Codex sebagai mesin sesi (paritas dengan Claude Code)

Status: design · 2026-07-27 · sumber brief · prioritas tinggi

## Objective

hanoman bisa menjalankan pekerjaan development memakai **Codex CLI** selain Claude Code —
dari setelannya, dari tombol Start sesi, sampai perilaku sesinya: worktree terisolasi, fase
yang dilaporkan ke phase file, stage yang maju, marker keputusan, review/integrate, dan
mode goal.

## Latar

Mesin eksekusi hanoman adalah `server/src/services/pty.ts` → `createSession()` yang men-spawn
`claude <prompt> --model … --effort … --dangerously-skip-permissions --settings <json>` di window
tmux (ADR-0016/0024). Semua lapis di atasnya — prompt (`runner/src/prompt.ts`), phase file
(`services/session-phases.ts`), stage machine, review, integrate — **sudah agnostik terhadap
agen**. Yang mengikat ke Claude hanya: nama binary, bentuk argv, dan mekanisme hook lewat
`--settings`.

## Temuan verifikasi (codex-cli 0.142.5, diuji langsung)

Semua poin di bawah dibuktikan dengan menjalankan `codex` di mesin ini, bukan dari ingatan.

1. **Prompt positional + TUI.** `codex [FLAGS] "<prompt>"` membuka TUI interaktif dengan prompt
   awal — bentuk yang sama dengan `claude <prompt>`. Jalur file prompt + `"$(cat …)"` milik
   SPEC-223 tetap dipakai apa adanya.
2. **Model & effort.** `-m/--model <slug>`; effort **bukan** flag melainkan config:
   `-c model_reasoning_effort="<v>"`. Katalog (`codex debug models`): model `gpt-5.5` dkk,
   effort `low|medium|high|xhigh`.
3. **Bypass izin.** `--dangerously-bypass-approvals-and-sandbox` = padanan
   `--dangerously-skip-permissions` (ADR-0037 tetap berlaku: agen dipercaya penuh, isolasi
   worktree satu-satunya batas).
4. **Hook injectable saat lahir.** `-c 'hooks.Stop=[{hooks=[{type="command",command="…"}]}]'`
   diterima dan benar-benar dieksekusi — **padanan persis `--settings` Claude**. Butuh
   `--dangerously-bypass-hook-trust`, kalau tidak TUI berhenti di layar "Hooks need review".
5. **Event hook codex:** PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact,
   SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Stop.
   **Tidak ada `Notification`.** Handler bertipe `prompt` **didiamkan** (hanya `command` yang
   terpasang) — diuji: hook `prompt` tak pernah muncul di daftar hook yang jalan.
6. **Stop hook bisa MENAHAN turn.** Exit 2 dengan alasan di stderr → alasan itu jadi
   continuation prompt dan agen dipaksa lanjut. Diuji end-to-end: gate menolak sekali, codex
   mengerjakan kekurangannya, gate lolos di percobaan kedua.
7. **Env diwariskan ke shell tool codex.** `HANOMAN_PHASE_FILE=… codex …` → agen bisa
   `echo "<Fase> done" >> "$HANOMAN_PHASE_FILE"`. Mekanisme fase hanoman jalan tanpa perubahan.
8. **Gerbang trust direktori** (jebakan utama). Di direktori baru TUI berhenti di
   "Do you trust the contents of this directory?" — dan `-c projects."…".trust_level` **tidak**
   membukanya (gerbang membaca config yang tersimpan, bukan override runtime). Tapi trust pada
   **root repo menurun ke worktree-nya**: cukup satu entri `[projects."<repoDir>"]` di config
   codex, bukan satu per sesi.

## Keputusan (dijawab manusia di terminal)

- **Cakupan:** setelan agen berlaku untuk **semua** sesi yang hari ini men-spawn `claude` —
  backlog (feature/qa/audit), reverse, prd, scaffold, breakdown, terminal-claude biasa, dan sesi
  resolusi konflik. Sesi shell mentah & Console VPS tak tersentuh (memang bukan claude).
- **Mode goal:** untuk codex dipakai **hook command deterministik**, bukan evaluator prosa.

## Desain

### 1. `Agent` sebagai dimensi sesi

`Agent = "claude" | "codex"` di `@hanoman/shared` (`enums.ts`, `zAgent`), sejajar `Flow`/`Stage`
— String + zod, bukan enum Prisma.

**Setelan** (`Setting` adalah kolom `Json` → **tanpa migration**, pola yang sama dipakai
`scheduler` SPEC-294 & `goal` SPEC-332):

```ts
agent: zAgent.default("claude"),            // agen default sesi baru
model, effort,                               // TETAP milik claude (kompatibel mundur)
codex: zCodex.default(CODEX_DEFAULTS),       // { model: "gpt-5.5", effort: "xhigh" }
```

Model/effort claude sengaja **tidak** dipindah ke blok bernama: baris `Setting` lama harus tetap
parse, dan `model`/`effort` sudah jadi kontrak `GET /settings`.

**Per sesi:** `POST /terminal/sessions` varian spec menerima `agent?: Agent` (sejajar
`model`/`effort`/`goal` hari ini). Flow project-level tak punya picker — ia memakai default global.

**Di tmux:** opsi `@hanoman_agent` disimpan saat sesi lahir dan dibaca `listPanes()` →
`SessionInfo.agent`. tmux tetap satu-satunya sumber kebenaran sesi berjalan; tak ada baris DB.

### 2. Pembangun argv per agen — `runner/src/agent-cli.ts`

Satu modul murni (tanpa I/O, mudah dites) yang memetakan
`{ agent, bin, prompt, model, effort, decisionFile, goal, cwd }` → daftar argumen.

- **claude** — persis argv hari ini: `--model`, `--effort`, `--dangerously-skip-permissions`,
  `--settings <guardSettings(...)>`.
- **codex** — `-m <model>`, `-c model_reasoning_effort="<effort>"`,
  `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`,
  `-c hooks=<toml>`.

`pty.ts` berhenti merakit flag sendiri; ia memanggil modul ini. Ini menjaga `createSession`
tetap satu jalur untuk kedua agen — cabang `opts.command` (shell mentah/Console VPS) tak berubah.

### 3. Hook codex — `runner/src/codex-settings.ts`

Cermin `guardSettings()` milik claude, menghasilkan nilai untuk `-c hooks=…`.

- **Marker keputusan (SPEC-184).** Claude memakai `Notification` + grep teks; codex tak punya
  event itu. Padanan paling jujur: **`Stop` → tulis marker** (turn berakhir = sesi menunggu
  manusia), **`UserPromptSubmit` → kosongkan marker** (persis seperti claude). Konsekuensi
  yang diterima sadar: pada codex marker juga menyala saat sesi selesai wajar, jadi notifikasi
  "menunggu keputusan" sedikit lebih ramai. Didokumentasikan, bukan disembunyikan.
- **Mode goal (ADR-0073) → gate deterministik.** hanoman menulis skrip gate per sesi ke tmpdir
  (pola `promptFilePath`), dipasang sebagai entri `Stop` kedua. Skrip memeriksa hal yang sama
  yang sudah digerbang server (ADR-0029):
  1. `$HANOMAN_PHASE_FILE` memuat satu baris `done`/`skipped` untuk SETIAP fase pipeline;
  2. `docs/superpowers/plans/**` tak menyisakan `- [ ]` (hanya untuk flow ber-Plan+Execute).

  Terpenuhi → exit 0 (sesi boleh berhenti). Belum → **exit 2** dengan alasan di stderr: apa yang
  masih kurang + teks kondisi goal yang berlaku. Codex melanjutkan dengan alasan itu sebagai
  prompt. Ini **lebih andal** daripada jalur claude, yang menyerahkan penilaian ke evaluator
  tanpa tool di atas transkrip yang bisa terpotong.

  Konsekuensi jujur: kondisi goal **prosa bebas** tak dievaluasi pada codex — ia ikut sebagai
  teks alasan, sementara yang benar-benar menggerbang adalah dua cek deterministik di atas.
  `armGoalInTui` (`/goal`) tetap **khusus claude**; codex tak punya padanan terverifikasi.

### 4. Bootstrap trust — `server/src/services/codex-trust.ts`

`ensureCodexTrust(repoDir)` dipanggil sebelum spawn sesi codex: bila config codex
(`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`) belum memuat `[projects."<repoDir>"]`,
tambahkan `trust_level = "trusted"`. **Idempoten, satu entri per project** (bukan per sesi —
worktree mewarisi trust root repo), append-only, tak pernah menyentuh kunci lain. Ini persis
yang codex tulis sendiri ketika manusia menjawab "Yes, continue".

### 5. Prompt

`skillInstruction()` menyuruh "invoke skill lewat **Skill tool**" — istilah Claude Code. Codex
memuat skill secara native. Klausa dibuat netral-agen sehingga satu prompt melayani keduanya;
tak ada percabangan prompt per agen selain ini.

### 6. Frontend

- **Settings** — kartu "Agen sesi": pilih agen default; saat `codex` dipilih, picker model/effort
  memakai katalog codex (`gpt-5.5`, effort `low|medium|high|xhigh`) dan menulis ke `Setting.codex`.
  Kartu model/effort claude yang ada tetap seperti sekarang.
- **Mulai sesi** (`StartSessionModal`) — dropdown Agen di atas Model/Effort; mengganti agen
  menukar daftar model & effort ke katalog agen itu, prefill dari default global agen tersebut.
- Sesi codex ditandai di daftar sesi Terminal supaya operator tahu mesin apa yang jalan.

### 7. Knob env

`HANOMAN_CODEX_BIN` (default `codex`), cermin `HANOMAN_CLAUDE_BIN` — dipakai test dan operator
yang binary-nya tak di PATH.

## Yang TIDAK berubah

- Skema Prisma: **tanpa migration** (`Setting` adalah `Json`).
- Phase file, stage machine, gate plan terceklist (ADR-0029), review, integrate, worktree
  (ADR-0002), satu-backlog-satu-sesi (ADR-0015), tmux (ADR-0016).
- Scheduler: sesi otonom ikut default global agen; tak ada knob agen per sumber.
- Indikator limit (`services/limits.ts`) tetap membaca OAuth usage Anthropic — **khusus claude**.
  Sesi codex tak muncul di sana. Didokumentasikan sebagai batasan yang diketahui.

## Testing

- Unit murni untuk pembangun argv (kedua agen), hook codex, dan skrip gate goal —
  ini logika orchestrasi, jadi wajib bertest.
- Unit untuk `ensureCodexTrust` (tambah, idempoten, tak merusak config lain) di atas file tmp.
- Test route: `agent` diterima & diteruskan; default global dipakai saat tak dikirim.
- Smoke nyata: boot server + curl `POST /terminal/sessions` untuk sesi codex, lalu verifikasi
  pane tmux lahir dengan argv yang benar (`--dangerously-bypass-hook-trust` hadir, tak ada layar
  trust), dan phase file bergerak.

## Risiko

| Risiko | Mitigasi |
|---|---|
| Layar trust direktori memblok sesi diam-diam | `ensureCodexTrust` sebelum spawn + smoke yang memeriksa isi pane |
| Layar "Hooks need review" memblok sesi | `--dangerously-bypass-hook-trust` selalu ikut |
| Flag/config codex berubah antar versi | Argv terkumpul di satu modul murni bertest; `HANOMAN_CODEX_BIN` untuk pin |
| Marker keputusan lebih ramai di codex | Perilaku didokumentasikan; mode goal menekan Stop dini |
