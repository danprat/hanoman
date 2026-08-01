# SPEC-476 — Telegram sebagai kanal chat session operator Hanoman persisten

Tanggal: 2026-08-01 · Sumber: brief · Prioritas: tinggi · Branch: `hanoman/spec-476`

## Brainstorm

### Konteks yang sudah ada

Hanoman sudah mempunyai empat fondasi yang tidak boleh dibangun ulang:

1. `server/src/services/pty.ts` menjadikan tmux sumber kebenaran sesi hidup dan mempertahankan sesi
   melewati restart API (ADR-0016).
2. `AgentToken` memberi agen akses ke API yang sama dengan dashboard, dibatasi capability per domain
   dan master switch `Setting.agentAccessEnabled` (ADR-0065).
3. `CustomAgent` memberi katalog persona global/per-project dan materialisasi claude/codex dari satu
   sumber (ADR-0094).
4. `SessionHistory`, phase file, marker keputusan, dan status pane sudah menyediakan fakta sesi yang
   dibutuhkan untuk progress/failure tanpa membuat runtime kedua.

Kontrak resmi Telegram Bot API yang diverifikasi pada 2026-08-01:

- `getUpdates` long polling menerima `offset`, `limit` 1–100, `timeout`, dan `allowed_updates`;
  update dianggap dikonfirmasi ketika request berikutnya memakai offset yang lebih tinggi;
- long polling tidak dapat dipakai bersamaan dengan webhook;
- `sendMessage` adalah kanal keluaran teks; callback inline wajib dijawab lewat
  `answerCallbackQuery`.

### Pendekatan yang dibandingkan

#### A. Long polling in-process + satu sesi tmux per private chat — dipilih

Server menjalankan satu loop `getUpdates` dari `server.ts`. Setiap private chat/user allowlisted
diikat ke id sesi tmux deterministik. Pesan natural, command, dan callback dikirim ke pane yang sama.
Sesi memakai agent pilihan Settings, persona dari katalog custom-agent, dan API Hanoman melalui
`AgentToken` khusus yang diberikan sebagai secret environment.

Kelebihan: mengikuti pola timer in-process yang sudah berlaku, tidak membutuhkan endpoint publik,
tmux tetap menjadi otak/session sebenarnya, restart API murah, dan test dapat memakai Telegram palsu.
Harga: hanya satu proses server boleh melakukan polling untuk satu bot; benturan `409 Conflict` dari
Telegram harus terlihat sebagai status gateway gagal/degraded.

#### B. Webhook Telegram ke Fastify — ditolak untuk MVP

Webhook mengurangi satu loop polling, tetapi menuntut URL publik/TLS, secret webhook, routing baru di
luar gate `/api`, dan prosedur deploy yang lebih berat. Ia juga tidak memberi manfaat nyata bagi satu
bot/satu VPS dengan volume kecil. Webhook dapat ditambahkan kelak sebagai transport lain di balik
adapter yang sama, bukan sebagai fondasi state/session.

#### C. Agen headless/stateless per pesan — ditolak

Setiap update melahirkan `claude -p`/`codex exec`, lalu gateway merangkai memory sendiri. Ini persis
"otak kedua": konteks terpecah, ongkos spawn berulang, tmux tidak lagi menjadi sumber kebenaran, dan
satu pesan berpotensi melahirkan pekerjaan baru. Pendekatan ini bertentangan dengan ADR-0016/0024,
brief, serta pengalaman operator yang diminta.

### Keputusan desain

- Transport MVP adalah **satu bot, long polling, private chat saja**, di dalam proses server.
- Identitas kerja adalah **satu session operator tmux per chat/user allowlisted**. Pesan berikutnya
  selalu di-steer ke sesi itu; tidak ada spawn per pesan.
- Command Telegram tetap berupa pesan ke session operator yang sama. Gateway tidak menjadi command
  executor paralel.
- Session operator memanggil endpoint Hanoman yang sudah ada memakai `AgentToken`; gateway tidak
  menambah shell executor, tool bus, antrean broker, Redis, worker, atau runtime agen baru.
- Jawaban Telegram tidak diambil dari layar PTY mentah. Sesi menerbitkan amplop jawaban eksplisit ke
  endpoint gateway ber-capability, sehingga reasoning, ANSI, dan screen furniture TUI tidak pernah
  dijadikan pesan bot.
- Offset Telegram, update dedupe, binding chat, outbox, memory, ringkasan, confirmation, dan audit
  disimpan di SQLite lokal. Semuanya menunjuk bot/tmux mesin ini dan karena itu **tidak ikut sync**.
- Bot token dan agent token hanya datang dari env/secret; plaintext tidak masuk DB, log, prompt,
  transkrip, memory, audit, atau respons.
- Progress otomatis dibatasi pada kejadian yang dapat dibuktikan server: diterima/di-steer, sesi
  lahir/pulih, fase/status berubah, menunggu keputusan, selesai, dan gagal. Tidak ada streaming
  reasoning.

## Objective

Bangun MVP Telegram gateway yang membuat Hanoman dapat dioperasikan lewat percakapan tanpa
mengubah Telegram menjadi runtime agen kedua.

Selesai berarti seluruh kondisi berikut terbukti:

1. **Satu identitas, satu sesi.** Setiap private chat dari Telegram user id yang masuk allowlist
   mempunyai tepat satu binding durable ke session operator tmux deterministik. Pesan natural,
   command, dan callback berikutnya di-steer ke pane hidup yang sama; bila pane hilang setelah
   reboot, session dipulihkan sekali dengan memory/ringkasan terakhir, bukan satu sesi per pesan.
2. **Kendali Hanoman lengkap untuk MVP.** Operator dapat melihat/memilih project, backlog, dan sesi;
   membaca status; memulai, menghentikan, melanjutkan, menginterupsi, dan men-steer pekerjaan lewat
   endpoint/service Hanoman yang sudah ada. `/help`, `/status`, `/projects`, `/project`, `/backlog`,
   `/sessions`, `/use`, `/new`, `/stop`, `/memory`, `/personality`, dan `/skills` tersedia, tetapi
   kalimat natural tetap jalan utama.
3. **Capability tidak dibypass.** Session operator memakai agent pilihan Settings dan satu
   `AgentToken` dari environment. Semua permintaan API melewati auth/capability yang sama dengan agen
   eksternal lain; gateway tidak mempunyai jalur shell, tool bus, atau mutasi DB langsung untuk aksi
   produk yang diminta operator.
4. **Durable dan at-most-once.** Offset `getUpdates`, id update unik, status dispatch, binding,
   cursor keluaran, confirmation, dan outbox bertahan restart. Replay Telegram maupun crash pada
   batas dispatch tidak pernah membuat update yang sama diketik dua kali ke session.
5. **Personality dan memory tetap satu otak.** Personality mengambil instruksi dari katalog
   `CustomAgent`. Curated memory dan ringkasan percakapan dihasilkan oleh session operator yang sama,
   disimpan lokal, dipakai saat recovery, dapat diperiksa/dilupakan/reset, dan tidak berubah menjadi
   loop LLM atau penyimpanan transcript mentah kedua.
6. **Keluaran aman dan berguna.** Telegram menerima progress ringkas berbasis fakta server, jawaban
   final eksplisit dari session, kegagalan, serta permintaan keputusan/confirmation inline. Gateway
   tidak meneruskan ANSI, screen dump TUI, chain-of-thought/reasoning, atau credential.
7. **Operasional terlihat.** Settings menjelaskan onboarding env/allowlist/token/capability dan
   menunjukkan status bot, poller, binding, update terakhir, antrean keluaran, serta error terakhir
   tanpa membuka secret. Jejak audit menghubungkan update Telegram → session → request API → respons.
8. **Parity terukur.** Kontrak yang sama berjalan untuk session `claude` dan `codex`; test argv/prompt,
   routing, recovery, memory, fake Telegram, serta smoke hidup membuktikan keduanya tidak jatuh ke
   jalur session atau auth yang berbeda.

### Non-goal MVP

- group/channel chat, topic/thread, voice, gambar/video/file, dan message editing kolaboratif;
- multi-bot, webhook, Telegram cron/scheduler, Redis, broker, worker, atau antrean kedua;
- model/agent Telegram tersendiri, pencarian semantic/vector memory, atau sinkronisasi memory;
- menyalin semua layar PTY/transkrip ke Telegram;
- memberi Telegram akses langsung ke shell atau endpoint cookie-only.

## Spesifikasi

### 1. Bentuk sistem

```text
Telegram private chat
       │ getUpdates(offset durable) / sendMessage / callback query
       ▼
TelegramGateway (timer in-process, satu bot)
       │ claim update at-most-once
       ▼
session operator tmux `tg-<hash(chatId:userId)>`
       │ AgentToken dari env · x-hanoman-telegram-update
       ▼
Fastify /api ── auth + capability + audit + confirmation gate
       │
       ├─ services Hanoman yang sudah ada (projects/specs/terminal/docs/…)
       └─ /api/telegram/replies + context/memory (channel output saja)
                         │ outbox durable, teks tersanitasi
                         └──────────────────────────────► Telegram
```

`TelegramGateway` dimulai dari `server.ts` setelah listen, sama seperti monitor VPS, scheduler, dan
lead. `app.ts` tetap bebas timer. Transport diisolasi lewat interface `TelegramClient`, sehingga test
memakai server Telegram palsu tanpa network publik.

Gateway **bukan** command router produk. Ia hanya memvalidasi update, mengklaim id, memastikan session
operator, mengirim amplop input, memproses callback confirmation, dan menguras outbox. Makna command
dan bahasa natural diputuskan session operator yang sama lalu diwujudkan melalui API Hanoman.

### 2. Konfigurasi dan readiness

Secret hanya dibaca dari environment:

| Env | Isi | Masuk session? |
|---|---|---|
| `HANOMAN_TELEGRAM_BOT_TOKEN` | token BotFather | **tidak pernah** |
| `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` | daftar id numerik dipisah koma | tidak |
| `HANOMAN_TELEGRAM_AGENT_TOKEN` | plaintext `AgentToken` yang sudah diterbitkan dashboard | ya, sebagai env; tak pernah di prompt |

`Setting.telegram = { enabled:false, progress:true }` adalah knob non-secret, tanpa migration
Setting. Agent/model/effort session operator **mewarisi** `Setting.agent` + blok model agen aktif
melalui `sessionAgentDefaults()`; tidak ada setelan agen Telegram kedua yang dapat drift.

Poller hanya aktif bila setting hidup, ketiga env sah, allowlist tidak kosong, bot lolos `getMe`,
master agent access hidup, dan token mempunyai minimal `telegram:write`. Capability lain tetap
menentukan aksi apa yang sungguh boleh dilakukan; onboarding merekomendasikan read/write untuk
projects, backlog, sessions, docs, ide, support, vps, settings, notifications, lead, agents, dan
telegram bila operator memang diminta mengelola semuanya.

`GET /api/telegram/status` mengembalikan readiness tanpa secret: enabled/running, bot username,
allowlist count, token valid + capability id yang kurang, offset/update/poll terakhir, binding count,
pending/uncertain outbox, dan error terakhir. Error menyimpan kelas/status singkat, tidak pernah URL
yang mengandung token maupun body/header request.

### 3. Data local-only (ADR-0096, migration tulis tangan)

Seluruh model berikut **LOCAL-only**: bot, tmux, chat, dan token melekat pada satu mesin. Tidak masuk
`SYNCED`, tidak mempunyai `version`, dan tidak memanggil `notifySynced()`.

| Model | Peran dan field penting |
|---|---|
| `TelegramGatewayState` | singleton `id=1`; `offset`, `botUsername?`, `lastPollAt?`, `lastUpdateAt?`, `lastError?`, `updatedAt` |
| `TelegramChat` | `id=chatId`, `userId`, `username?`, `sessionId @unique`, `activeProjectId?`, `activeSessionId?`, `personalityAgentId?`, `summary`, `lastProgressKey?`, `lastSeenAt`, timestamps |
| `TelegramUpdate` | `id=update_id @id`, chat/user/message id, `kind`, `status`, digest SHA-256, timestamps, error; **tanpa teks pesan** |
| `TelegramMemory` | id opaque, `chatId`, curated `content`, `sourceUpdateId?`, timestamps |
| `TelegramOutbox` | id, `dedupeKey @unique`, chat/update, `kind`, teks tersanitasi, markup inline opsional, `pending|sending|sent|uncertain|failed`, telegram message id, timestamps |
| `TelegramConfirmation` | id pendek-opaque, chat/update/session, deskripsi, expected method/path, `pending|approved|rejected|used|expired`, expiry + timestamps |
| `TelegramAudit` | append-only: chat/update/session/agent token id, event, method/path/status, detail non-rahasia, timestamp; tidak menyimpan body/header/pesan |

Tidak ada FK ke `Project`, `Spec`, atau sesi tmux: ketiganya bisa hilang/rename sementara audit harus
tetap terbaca. Id chat disimpan sebagai `String`, bukan `Int`, agar tidak bergantung lebar integer
platform Telegram. `TelegramUpdate.id` memakai `Int` karena Bot API mendefinisikan `update_id` sebagai
integer dan JavaScript/SQLite aman pada rentang itu.

Memory dipisah menjadi baris agar `/memory forget <id>` tidak menulis ulang array besar dan auditnya
tepat. Ringkasan tetap satu string pada binding karena hanya ada satu ringkasan aktif. Keduanya dibatasi
ukuran dan melalui sanitizer secret yang sama dengan outbox.

Semua model baru ditambahkan ke `PG_ORDER` agar `hanoman migrate-from-postgres` tetap dapat membawa
instalasi lama yang sudah memakai gateway; local-only berarti tidak sync, bukan tidak dimigrasikan.

### 4. Identitas session dan prompt operator

`telegramSessionId(chatId,userId)` adalah fungsi murni: SHA-256 identitas → prefix aman `tg-` + 20
hex. Binding adalah sumber durable; tmux tetap sumber kebenaran apakah prosesnya hidup.

Pada update pertama atau saat pane lama sudah mati/hilang, gateway membuat session melalui
`createSession()` dengan:

- project id sintetis `telegram:<hash>` dan cwd netral di `$HANOMAN_HOME/telegram/<hash>`;
- agent/model/effort dari `sessionAgentDefaults()` dan `ensureCodexTrust(cwd)` bila codex;
- env `HANOMAN_API_BASE`, `HANOMAN_TELEGRAM_AGENT_TOKEN`, dan chat id; **bot token tidak ikut**;
- prompt awal yang memuat personality terpilih, summary, curated memory, command contract, API/auth
  contract, serta **update pertama itu sendiri**.

Menyematkan update pertama ke prompt menutup race "spawn lalu mengetik sebelum TUI siap". Untuk pane
yang sudah hidup, gateway memakai `sendToPane()`; tidak ada `createSession()` baru. Pane mati dibuang
oleh titik cekik `createSession` sesuai ADR-0084. `SessionKind` mendapat nilai `telegram` agar riwayat
dan observability tidak menyamarkannya sebagai terminal biasa; ia tidak restartable dari modal history
karena recovery milik binding gateway.

Prompt operator bersifat protokol, bukan otak kedua:

1. setiap input berbentuk `[Telegram update <id> · chat <id> · kind <text|command|callback>]`;
2. action produk hanya melalui `$HANOMAN_API_BASE` dengan bearer env dan header
   `x-hanoman-telegram-update: <id>`;
3. jawaban user-facing diterbitkan lewat `POST /api/telegram/replies`, bukan dibiarkan di layar saja;
4. endpoint reply menerima hanya `progress|final|decision|failure|confirmation`, satu output per kind
   per update melalui `dedupeKey` server;
5. summary/memory yang disertakan adalah hasil kurasi session itu sendiri, bukan transcript;
6. jangan pernah mengirim reasoning, ANSI, command echo, token/env, atau isi credential;
7. aksi sulit dibatalkan harus menerbitkan confirmation dulu, lalu menunggu callback approval sebelum
   request API yang sebenarnya.

Personality mengambil `instructions` dari `CustomAgent` efektif. Claude dan codex sama-sama menerima
blok personality inline sebagai instruksi main session; ini **memakai katalog/fondasi ADR-0094** tanpa
menambah subagent atau proses. Mengganti `/personality` memperbarui binding dan session yang sedang
hidup mengadopsinya dalam giliran yang sama; recovery berikutnya memuat nilai itu lagi.

### 5. Routing input dan jaminan tidak ganda

Gateway meminta hanya `allowed_updates:["message","callback_query"]`, `limit≤100`, dan timeout long
poll. Tiap batch diproses berurutan.

1. Dalam satu transaksi SQLite, insert `TelegramUpdate(update_id)` dan naikkan
   `TelegramGatewayState.offset = max(offset, update_id + 1)`. Konflik PK berarti replay dan langsung
   dilewati. Offset baru hanya berarti update **sudah durable**, bukan sudah dieksekusi.
2. Validasi private chat, sender bukan bot, user id allowlisted, payload text/callback sah, ukuran, dan
   rate limit durable. Penolakan dicatat tanpa menyimpan body.
3. Tepat sebelum menyentuh tmux, transisi atomik `received → dispatching`. Hanya caller yang berhasil
   mengubah satu baris boleh spawn/steer.
4. Session dibuat dengan input pertama atau input diketik sekali ke pane hidup; lalu status menjadi
   `dispatched`.
5. Saat boot, sisa `received|dispatching` diubah ke `uncertain` dan **tidak diulang otomatis**.
   Ini memilih at-most-once pada batas non-transactional SQLite↔tmux: crash boleh menghasilkan satu
   pesan berstatus tidak pasti, tetapi tidak pernah dua eksekusi. Operator diberi audit/status untuk
   mengulang secara sadar dengan update Telegram baru.

Teks inbound tidak disimpan di DB, log, audit, memory, atau outbox. Audit menyimpan digest sehingga
dua laporan dapat dicocokkan tanpa mempertahankan credential yang mungkin diketik pengguna.

Rate limit dihitung dari baris update terakhir per user (durable melewati restart), bukan hanya `Map`
in-memory. Callback confirmation tidak dapat dipakai user/chat lain dan hanya sekali.

### 6. Command contract

Semua command di bawah tetap dikirim ke session operator yang sama. Session memakai endpoint yang
sudah ada dan context gateway untuk mewujudkannya.

| Command | Perilaku minimum |
|---|---|
| `/help` | daftar command + contoh percakapan natural |
| `/status` | binding aktif, session operator, project/session terpilih, progress/failure terakhir |
| `/projects` | daftar project dari `GET /projects` |
| `/project <id>` | pilih project di context setelah membuktikan id ada |
| `/backlog [query]` | backlog project aktif, status dan blocker ringkas |
| `/sessions` | daftar sesi tmux + decision/exit/fase yang relevan |
| `/use <session-id>` | pilih sesi kerja yang akan dibaca/di-steer |
| `/new <brief>` | buat backlog brief pada project aktif; bila bentuk belum cukup, tanyakan natural |
| `/stop [session-id]` | minta confirmation inline, lalu DELETE sesi yang dipilih setelah approval |
| `/memory` | tampilkan ringkasan + memory id; `forget <id>` dan `reset` tersedia |
| `/personality` | tampilkan/pilih/reset custom agent efektif |
| `/skills` | tampilkan custom-agent/skill yang tersedia dan kapan dipakai |

Bahasa natural dapat melakukan hal yang sama: misalnya "project raciklaba sekarang", "lihat yang
menunggu keputusan", atau "steer SPEC-455 agar cek migration dulu". `/use` tidak mengambil alih
session kerja menjadi session chat; ia hanya memilih target yang dikendalikan session operator.

Untuk parity kontrol sesi, terminal API ditambah dua endpoint kecil di domain capability `sessions`:

- `POST /api/terminal/sessions/:id/steer { text }` → `sendToPane()`;
- `POST /api/terminal/sessions/:id/interrupt` → primitive tmux `Escape` per-id.

Stop tetap memakai endpoint DELETE yang sudah ada. Tidak ada endpoint shell/string-command.

### 7. Reply, memory, dan context API

Domain capability baru `telegram` dipetakan **menurut method** (kelas bug SPEC-405):

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/telegram/status` | observability/readiness untuk Settings |
| `GET` | `/api/telegram/chats/:chatId/context` | binding + summary + curated memory, tanpa secret |
| `PATCH` | `/api/telegram/chats/:chatId/context` | active project/session, personality, summary |
| `POST` | `/api/telegram/chats/:chatId/memories` | tambah memory hasil kurasi |
| `DELETE` | `/api/telegram/chats/:chatId/memories/:id` | lupa satu memory |
| `DELETE` | `/api/telegram/chats/:chatId/memories` | reset memory + summary |
| `POST` | `/api/telegram/replies` | enqueue progress/final/decision/failure/confirmation idempoten |
| `GET` | `/api/telegram/audit` | jejak paginated untuk operator cookie/capability read |

Reply body mengikat `chatId`, `updateId`, `kind`, `text`, serta opsional `summary`, `remember[]`, dan
confirmation `{description,method,path}`. Header correlation dan body update wajib cocok. Route
memvalidasi update benar milik chat itu dan sudah `dispatching|dispatched`.

Sanitizer outbox/summary/memory:

- buang ANSI, NUL, control character non-whitespace, dan screen-control;
- redaksi exact bot token/agent token serta pola token Hanoman/Telegram/Anthropic umum;
- batasi final/decision/failure, summary, dan item memory; kosong sesudah redaksi ditolak;
- pecah pesan user-facing di batas aman ≤4096 karakter tanpa `parse_mode` sehingga markup tidak
  dapat mengubah arti/link secara diam-diam.

Gateway tidak pernah membaca `capturePane()` untuk membentuk balasan. Capture boleh dipakai hanya
untuk diagnosis server dan tetap tidak dikirim.

### 8. Confirmation inline dan capability gate

Reply `kind:"confirmation"` membuat `TelegramConfirmation` dan outbox ber-inline keyboard
`Lanjutkan`/`Batalkan`. Callback data hanya memuat id opaque pendek + pilihan; uraian action hidup di
DB. Gateway memanggil `answerCallbackQuery`, memverifikasi chat/user/expiry, mengubah status, lalu
mengirim hasil callback ke session operator yang sama.

`HANOMAN_TELEGRAM_AGENT_TOKEN` didaftarkan runtime sebagai identitas gateway. `preHandler` Fastify
mewajibkan header correlation pada request token itu dan header confirmation approved, cocok
method/path/chat, untuk operasi sulit dibatalkan:

- seluruh `DELETE`;
- update apply, integrate/merge/rebase/drop/reset/clean/delete branch/tag;
- harden/remediate VPS;
- revert stage yang menghapus artefak.

Klasifikasi mengikuti operasi nyata, bukan hanya method/path: `POST /projects/:id/git` membaca
`body.op`, dan revert stage hanya memerlukan approval saat `confirmDelete:true`; preview tidak
dianggap destruktif.

Confirmation dikonsumsi atomik `approved → used` sebelum route dijalankan. Gagal route berarti minta
confirmation baru; ini sengaja fail-closed. Pagar existing pada route tetap berlaku sesudahnya —
confirmation tidak memberi capability baru, tidak mengubah body, dan tidak mengalahkan 403/409.

Request gateway-token tanpa correlation ditolak. Dengan demikian session tidak dapat melewati audit
atau confirmation hanya dengan menghilangkan header yang disebut prompt.

### 9. Progress, failure, recovery, dan outbox

Progress langsung yang boleh dibuat gateway sendiri hanya fakta channel: update diterima, diikat ke
session hidup/dipulihkan, dan dispatch tidak pasti. Progress pekerjaan berasal dari state server:
binding `activeSessionId`, daftar sesi, phase file, `sessionFinished`, marker decision, serta exit code.
`lastProgressKey` pada chat mencegah notifikasi sama setelah restart.

Outbox memakai `pending → sending → sent`. Status dipindah ke `sending` **sebelum** network. Crash atau
network outcome tak diketahui menghasilkan `uncertain`, bukan retry otomatis yang dapat mengirim dua
pesan. Error Telegram eksplisit sebelum acceptance menjadi `failed`; operator melihatnya di status.

Restart API:

- tmux session operator yang hidup dibiarkan apa adanya;
- offset, dedupe, binding, outbox, context, memory, confirmation, dan audit dibaca SQLite;
- update/outbox di batas crash menjadi `uncertain`, tidak direplay;
- binding dengan pane hilang dipulihkan pada update berikutnya menggunakan personality + summary +
  memory; id session tetap sama;
- callback expired dijawab singkat dan tidak dikirim ke pane sebagai approval.

Telegram `409 Conflict` karena bot sedang di-long-poll proses lain menghentikan loop dan tampil sebagai
error actionable; gateway tidak membuat dua poller saling merebut offset.

### 10. Settings dan onboarding

Settings mendapat tab **Telegram** dengan satu kartu kendali/readiness dan satu kartu onboarding:

1. buat bot lewat BotFather dan simpan token sebagai env;
2. isi allowlist Telegram numeric user id;
3. di Settings → Akses AI Agent, hidupkan master switch dan buat token capability yang diperlukan;
4. simpan plaintext token sekali itu ke env Telegram agent token;
5. restart service, lalu nyalakan `Setting.telegram.enabled`;
6. kirim `/status` dan pastikan binding + session muncul.

UI tidak menyediakan input bot/agent token dan tidak menampilkan masked prefix-nya. Ia hanya
menampilkan `configured: ya/tidak`, capability, username bot, dan fakta operasional. Toggle off
menghentikan poll baru dan detach gateway, **tidak** membunuh session tmux atau menghapus memory.

### 11. Testing dan verifikasi hidup

1. **Shared murni:** schema setting/DTO/reply, capability `telegram`, session id, redaksi secret,
   splitting, state transition, destructive matcher.
2. **Transport palsu:** kontrak URL Bot API, offset/allowed updates, private/allowlist validation,
   answer callback, sendMessage tanpa secret/log.
3. **Routing/session:** satu chat berulang → satu id/pane; dua chat → dua pane; pesan pertama lewat
   prompt, pesan berikutnya lewat steer; pane hidup selamat restart; pane hilang dipulihkan dengan
   context; claude/codex argv memakai default Settings masing-masing.
4. **Durabilitas/idempotensi:** replay update id, crash statuses, offset transaction, outbox dedupe,
   callback single-use/expiry, rate limit lintas instans service.
5. **Memory/personality:** inspect/add/forget/reset, size/redaction, recovery prompt, custom-agent
   override efektif.
6. **API/auth:** capability per method, correlation wajib untuk gateway token, confirmation gate,
   audit method/path/status tanpa body/header, steer/interrupt endpoint.
7. **Web:** Settings loading/error/readiness/onboarding/toggle; tidak pernah merender secret.
8. **E2E lokal sekali di akhir:** boot server dengan DB test, Telegram HTTP palsu, dan fake agent;
   kirim update natural + command + callback, buktikan satu tmux session, reply final ke fake bot,
   restart API tanpa membunuh pane, replay update tidak masuk dua kali, memory pulih. Jalankan matriks
   agent `claude` dan `codex` dengan fixture yang merekam argv/env tanpa membuka token.

### 12. Acceptance criteria (EARS)

- WHEN gateway menerima update Telegram yang sama lebih dari sekali, THE SYSTEM SHALL men-steer
  session operator paling banyak satu kali.
- WHEN API restart sementara pane operator hidup, THE SYSTEM SHALL mempertahankan pane dan binding
  yang sama tanpa spawn baru.
- IF pane operator hilang, WHEN update baru tiba, THE SYSTEM SHALL membuat ulang id session yang sama
  dengan summary, memory, personality, dan active context terakhir.
- IF chat bukan private atau user tidak allowlisted, THE SYSTEM SHALL tidak membuat binding/session
  dan SHALL mencatat penolakan tanpa body pesan.
- WHILE Telegram setting mati/readiness gagal, THE SYSTEM SHALL tidak mengonsumsi update dan SHALL
  menampilkan alasan non-rahasia di Settings.
- WHEN natural text, command, atau callback sah tiba, THE SYSTEM SHALL mengirimnya ke session operator
  yang sama dan SHALL tidak menjalankan action produk di gateway transport.
- WHEN session operator memanggil API, THE SYSTEM SHALL menegakkan AgentToken capability dan SHALL
  mengaudit correlation update, method, path, dan status tanpa body/header.
- IF gateway AgentToken meminta action sulit dibatalkan tanpa confirmation approved yang cocok, THE
  SYSTEM SHALL menolak 409/403 sebelum handler produk berjalan.
- WHEN confirmation inline disetujui user/chat yang benar, THE SYSTEM SHALL mengizinkannya tepat satu
  kali dan SHALL tetap menjalankan pagar endpoint existing.
- WHEN reply eksplisit diterbitkan session, THE SYSTEM SHALL mengirim hanya teks tersanitasi tanpa
  ANSI/secret dan SHALL tidak pernah memakai raw PTY sebagai sumber pesan.
- WHEN memory dilupakan/reset, THE SYSTEM SHALL tidak memasukkannya ke prompt recovery berikutnya.
- WHERE agent Settings adalah claude atau codex, THE SYSTEM SHALL memakai helper default sesi yang
  sama, capability yang sama, protocol reply yang sama, dan acceptance suite yang sama.

### 13. Dampak Source of Truth

- ADR baru: `internal/docs/adr/0096-telegram-gateway-session-operator-persisten.md`.
- Perbarui `architecture/{stack,data-model,api-contract,nfr}.md`, `requirements/{prd,frd}.md`,
  `security/security-standard.md`, `product/onboarding.md`, `frontend/frontend-implementation.md`,
  serta index utama + sub-index ADR.
- Perbarui `internal/skills/hanoman/SKILL.md` dengan aturan permanen: Telegram adalah transport ke
  session tmux, update/outbox at-most-once fail-closed, secret env-only, reply eksplisit bukan PTY.

## Self-review Spec

- Placeholder/TODO: tidak ada.
- Konsistensi: command dan natural text sama-sama menuju satu session; gateway tidak mempunyai jalur
  mutasi produk sendiri.
- Scope: group/media/webhook/multi-bot/vector memory dipisahkan sebagai non-goal; satu plan masih
  dapat mengimplementasikan MVP end-to-end.
- Ambiguitas crash: diputuskan eksplisit **at-most-once + status uncertain**, bukan retry otomatis.
- Ambiguitas credential: token bot tak pernah masuk session; agent token hanya env, DB menyimpan hash
  existing dan seluruh persistent Telegram store dilarang memuat plaintext.
