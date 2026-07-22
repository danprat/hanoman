# Tech stack

| Lapis | Pilihan | Alasan |
|---|---|---|
| Dashboard | React + TypeScript + Vite | UI cepat, tim familiar |
| Realtime | WebSocket (terminal) + HTTP polling | terminal butuh stream dua arah; sisanya cukup poll |
| Server | Node.js + TypeScript (Fastify) | satu bahasa lintas stack; `@fastify/websocket`, `cookie`, `static` |
| DB | PostgreSQL (Prisma) | state project/spec/setting/notification/user/session/vps |
| Terminal (server) | node-pty + **tmux** | sesi `claude` interaktif butuh TTY sungguhan; tmux menahannya hidup lintas restart API (ADR-0016) |
| Terminal (web) | xterm.js | render TUI Claude Code apa adanya |
| VCS | git + **git worktree** | isolasi sesi per backlog/branch (ADR-0002) |
| Agent | Claude Code CLI **interaktif** + hooks/skills/plugins | eksekusi brainstorm → objective → spec → plan → execute sebagai giliran satu sesi |
| Auth | cookie sesi opaque revocable | bind `127.0.0.1` + reverse proxy TLS (ADR-0028) |

Tidak ada message queue, Redis, worker terpisah, cron eksternal, maupun webhook GitHub — semuanya
dicabut saat pindah ke sesi interaktif (ADR-0024). Pekerjaan latar belakang berjalan **in-process**
lewat `setInterval` yang di-`start` dari `server.ts` saja (`app.ts` bebas-timer): monitor VPS (health
5 mnt, audit 24 jam) dan — sejak SPEC-294/[ADR-0072](adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md) —
**engine scheduler otonom** (tick governor: checker source enable+cadence → antrean durable
`SchedulerQueueItem` → drain di bawah cap). Scheduler **membalik sebagian ADR-0024** (menghidupkan kembali
antrean durable + cap concurrency), tetap **tanpa** broker eksternal: "antrean durable" = tabel DB hanoman.

## Bentuk sistem
```
Dashboard (React + xterm.js)
   │  WebSocket (PTY terminal)  +  HTTP polling (projects, backlog, notifications, limits, vps)
   ▼
Server (Fastify, bind 127.0.0.1:8787)
   ├─ routes: auth · projects · specs · docs · terminal · vps · fs · settings · notifications · limits · health
   ├─ PTY/tmux  ─► sesi `claude` interaktif per backlog, di git worktree terisolasi
   ├─ VPS monitor (setInterval: health 5 mnt · audit 24 jam)
   ├─ Scheduler engine (setInterval tick: source enable+cadence → antrean durable → rekonsil akhir sesi + scanDecisions → drain di bawah cap · SPEC-294/ADR-0072; checker konkret: backlog SPEC-295, errors SPEC-296 — grup produksi berulang → escalate → antrean, satu grup = satu backlog, triase SPEC-297 — tiket bug/fitur eligible → accept → antrean, satu tiket = satu backlog; SPEC-298 — klausa autonomy per mode saat launch [full-control tembus sampai done / butuh-keputusan berhenti→notif decision, slot tetap] + akhir sesi: done→ringkasan `SessionResult`+notif done tanpa auto-merge, gagal/limit→notif fail tanpa retry)
   ├─ Docs SoT scan (live dari Project.repoDir tiap request — ADR-0011/0018)
   └─ Postgres (Prisma): Project · Spec · Setting · Notification · User · Session · Vps
```

## Eksekusi
`runner/src/*` adalah **library**, bukan proses: operasi git worktree (`git.ts`), pembangun prompt +
definisi pipeline fase (`prompt.ts`), teks standar reverse-docs (`reverse-standard.ts`), dan konfigurasi
guardrail PreToolUse (`safety.ts`/`settings.ts`). Tidak ada lagi invokasi `claude` headless — flow CLI
lama (`execute/spec/plan/qa`) sudah dicabut (ADR-0024).

Mesin eksekusi nyata adalah **`server/src/services/pty.ts`**. `createSession()` men-spawn
`claude <prompt> --model … --effort … --dangerously-skip-permissions --settings <guard>` di dalam
window **tmux** (socket `-L hanoman`, `remain-on-exit on`); sebuah node-pty `tmux attach` menjembatani
sesi itu ke klien WebSocket, dan satu poll 500 ms mengawasi exit + perubahan phase-file lalu mem-broadcast
frame. tmux adalah satu-satunya sumber kebenaran pekerjaan yang berjalan — tidak ada baris `Run` di DB.

**Satu backlog = satu sesi** (ADR-0015): id sesi diturunkan deterministik dari id spec, sehingga menekan
Start dua kali **re-attach**, bukan spawn kedua. Sesi berjalan di worktree-nya sendiri di
`<repoDir>/.worktrees/<id>` yang dibuat `--detach` dari `branchFrom` (default `main`); `baseSha` dicatat
untuk rentang review (SPEC-176/ADR-0030). Jenis sesi: **spec-flow** (`feature`/`qa`), **reverse**
(project-level, `reverse-<project>`), **plain terminal** (claude di repoDir ATAU shell mentah
non-claude `{shell:true}`, SPEC-236/ADR-0056), **integrate-conflict** (`merge-<id>`), **vps**.

**Fase bukan proses melainkan giliran** di dalam sesi itu: `runner/src/prompt.ts` `PIPELINES` mendefinisikan
nama fase per flow, dan prompt menyuruh agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE` selesai tiap fase.
Server membaca file append-only itu (`services/session-phases.ts`) untuk menurunkan fase aktif → `Stage`.
Konteks terbawa antar fase karena semuanya satu sesi. Prompt membawa **kontrak otonomi** (ADR-0035):
agen menembus batas antar-fase tanpa berhenti — checkpoint "review" milik skill superpowers bukan
titik berhenti — dan hanya berhenti untuk bertanya di terminal saat butuh keputusan manusia sejati. Model & effort bersifat **per sesi** (SPEC-252/ADR-0061, mengamandemen ADR-0058): sesi lahir dengan
**satu** `--model`/`--effort` — dipilih saat **Start** (picker default = `Setting.model`/`effort`, body opsional
di `POST /terminal/sessions`) dan berlaku seumur hidup sesi (satu proses); manusia bisa mengetik `/model`
di dalam terminal untuk menggesernya. Matrix per-fase (ADR-0058) dicabut — tak andal. Model-per-step (ADR-0003) usang bersama runner headless (ADR-0024).

Sesi memakai `--dangerously-skip-permissions` (tak berpenunggu), sehingga guardrail perintah berbahaya
bersandar sepenuhnya pada **PreToolUse hook** (`runner/src/safety.ts` `deniesDangerous` lewat
`hanoman hook pretooluse`) yang dipasang di setiap sesi via `--settings` inline — menolak `rm -rf`, push
ke `main`, dan `git worktree add` liar. Hook tetap jalan di bawah flag itu; yang dilewati hanya prompt izin.

Biaya bersifat **estimasi dan tidak menggerakkan apa pun** (ADR-0012): tidak ada `dailyBudget`, tidak ada
budget flag. Indikator limit dibaca langsung dari OAuth usage API Anthropic (`services/limits.ts`,
ADR-0024), bukan dari parsing output terminal.
