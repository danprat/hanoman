# ADR-0096 — Telegram gateway: transport ke session operator tmux persisten, bukan runtime agen

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-476
- Terkait: **memperluas** [0016](0016-sesi-terminal-hidup-di-tmux.md),
  [0065](0065-ai-agent-capability-agent-token.md), [0079](0079-history-sesi-terminal-store-lokal-plus-transkrip.md),
  dan [0094](0094-custom-agent-katalog-materialisasi-native.md); **mengikuti**
  [0024](0024-sesi-interaktif-menggantikan-run.md), [0039](0039-realtime-lewat-websocket-siar.md),
  dan [0086](0086-sqlite-satu-satunya-provider.md); **tidak menghidupkan kembali** worker/headless
  flow/tool bus/Redis; **tidak mencabut** keputusan mana pun.

## Konteks

Operator ingin mengelola seluruh workspace Hanoman lewat percakapan Telegram seperti pengalaman
Hermes: memilih project/backlog/session, melihat progress, memulai atau menghentikan pekerjaan,
men-steer sesi, menjawab keputusan, dan tetap memiliki personality + memory setelah restart.

Cara termurah yang tampak menarik — satu proses agen headless per pesan — justru merusak fondasi
produk. Ia membuat context terpisah per update, memaksa gateway menjadi perangkai memory/otak kedua,
menghidupkan lagi bentuk run yang dicabut ADR-0024, dan mengabaikan tmux yang sudah memecahkan
durabilitas proses pada ADR-0016.

Telegram sendiri memberi dua transport update: webhook atau `getUpdates` long polling. MVP hanya satu
bot, satu VPS/process, private chat, dan tidak memerlukan endpoint publik. Bot API menyatakan offset
yang lebih tinggi mengonfirmasi update dan long polling tidak dapat dipakai bersama webhook.

Ada dua batas non-transactional yang harus diputuskan eksplisit: SQLite→tmux saat input diketik dan
SQLite→Telegram saat `sendMessage`. Retry otomatis sesudah crash dapat menduplikasi pesan/action;
tidak retry dapat meninggalkan outcome tidak pasti. Brief mengunci syarat terkuatnya: satu pesan tidak
pernah dieksekusi dua kali.

## Keputusan

### 1. Telegram hanya transport; satu private chat = satu session operator tmux

Gateway berjalan in-process dari `server.ts` dan memakai `getUpdates` long polling. Id session
deterministik diturunkan dari chat+user allowlisted. Update pertama menjadi bagian prompt kelahiran;
update berikutnya di-steer ke pane hidup yang sama. Restart API tidak membunuh pane. Bila pane hilang,
binding memulihkannya pada update berikut dengan id/personality/summary/memory yang sama.

Command Telegram dan bahasa natural mengikuti jalur identik. Gateway tidak memahami `/new` sebagai
`prisma.spec.create`; session operator yang memahami maksudnya lalu memanggil endpoint Hanoman.

### 2. Session memakai API Hanoman + AgentToken, bukan shell executor/tool bus gateway

Plaintext AgentToken diberikan ke proses session sebagai environment. Prompt hanya menyebut nama env,
tidak nilainya. Semua action produk memakai `/api` existing dan melewati auth/capability ADR-0065.
Domain `telegram` baru hanya mengelola channel context/memory/reply/audit; ia tidak menjadi proxy
action generik. Dua primitive kontrol yang belum punya REST parity (`steer`, `interrupt`) ditambahkan
di bawah `/terminal/sessions`, tetap capability `sessions:write`.

Request token gateway wajib membawa correlation update id. Hook Fastify mengaudit method/path/status
tanpa body/header dan menolak request token itu yang menghilangkan correlation.

### 3. State channel local-only di SQLite

Offset, binding, update dedupe/status, outbox, curated memory, summary, confirmation, dan audit adalah
data baru yang tak dapat diturunkan ulang. Semuanya model SQLite local-only: bot/chat/tmux melekat pada
satu mesin dan pointer-nya tidak bermakna di sync hub lain. Mereka tidak punya `version` dan tidak
masuk changefeed, tetapi tetap ikut `PG_ORDER` untuk migrasi instalasi Postgres lama.

Teks inbound **tidak disimpan**; update hanya menyimpan digest + metadata/status. Transcript mentah
tidak menjadi memory. Curated memory + summary hanya datang dari session operator yang sama dan dapat
diperiksa/dilupakan/reset.

### 4. Crash policy = at-most-once, fail-closed, dengan `uncertain`

Insert update dan kenaikan offset terjadi satu transaksi. Sebelum menyentuh tmux, baris diklaim
atomik `received → dispatching`; hanya penulis yang mengubah satu baris boleh mengeksekusi. Sisa
`received|dispatching` saat boot menjadi `uncertain` dan tidak dikirim ulang. Dengan begitu crash
mungkin meminta operator mengulangi pesan secara sadar, tetapi update Telegram yang sama tidak pernah
masuk pane dua kali.

Outbox memakai aturan simetris: `pending → sending` sebelum network; crash/outcome tak diketahui
menjadi `uncertain`, bukan retry otomatis. Reply idempoten per chat/update/kind.

Ini bukan exactly-once — transaksi atomik lintas SQLite, tmux, dan Telegram tidak tersedia — tetapi
ia memenuhi batas produk yang dapat dibuktikan tanpa broker/worker kedua.

### 5. Reply eksplisit; raw PTY dilarang menjadi output Telegram

Session menerbitkan amplop user-facing `progress|final|decision|failure|confirmation` ke
`POST /api/telegram/replies`. Gateway tidak mengubah `capture-pane` menjadi chat. Dengan demikian
ANSI, screen furniture, command echo, dan reasoning TUI tidak mempunyai jalur otomatis ke Telegram.
Teks reply/summary/memory tetap melewati redaksi exact secret + pola credential dan batas ukuran.

Progress yang dibuat gateway hanya fakta server: received/dispatched, session lahir/pulih, fase,
decision, finish, atau exit failure. Tidak ada streaming reasoning.

### 6. Confirmation inline adalah gerbang tambahan untuk identitas token gateway

Action sulit dibatalkan meminta confirmation inline. Approval terikat chat/update/session,
method/path, expiry, dan single-use. `preHandler` untuk AgentToken gateway menolak DELETE,
integrate/reset/clean/drop, update apply, harden/remediate, dan revert destruktif tanpa approval yang
cocok. Approval dikonsumsi sebelum handler; pagar route existing tetap berjalan sesudahnya dan
confirmation tidak memberi capability baru.

Gerbang ini spesifik jalur Telegram, bukan guardrail perintah sesi umum; ADR-0037 tetap utuh.

### 7. Personality memakai katalog CustomAgent; parity agent mengikuti default sesi

Binding menyimpan custom-agent id. Instruksi personality dimasukkan inline ke main operator session
untuk claude maupun codex. Katalog, scope, dan UI tetap milik ADR-0094; tidak ada entitas persona
kedua, subagent wajib, atau proses baru.

Session operator lahir lewat `sessionAgentDefaults()` dan `ensureCodexTrust` berdasarkan hasil helper.
Tidak ada `Setting.telegram.agent`; pilihan claude/codex global tetap satu sumber. Kontrak input,
reply, API, memory, audit, dan acceptance suite sama untuk keduanya.

## Konsekuensi

- Satu bot hanya boleh dipoll satu proses. Telegram `409 Conflict` diperlakukan sebagai error
  actionable dan poller berhenti; tidak ada election/leader lock lintas proses pada MVP.
- Toggle gateway mati menghentikan polling, tetapi tidak membunuh tmux atau menghapus memory.
- At-most-once memilih keselamatan dari duplikasi di atas retry otomatis. `uncertain` wajib terlihat
  di status/audit agar kehilangan tidak menjadi diam.
- Session operator hidup di cwd netral `$HANOMAN_HOME/telegram/<hash>` karena ia melintasi banyak
  project; seluruh mutasi produk wajib lewat API capability. Ini bukan worktree project dan tidak
  boleh dipakai sebagai jalan menulis repo langsung.
- AgentToken plaintext tetap sebuah credential client seperti ADR-0065. Ia datang dari env, DB hanya
  menyimpan hash existing, dan tidak pernah diteruskan ke bot/output.
- Tujuh tabel local-only adalah harga eksplisit untuk state yang memang tidak dapat diturunkan dari
  tmux/Telegram setelah restart. Mereka bukan message broker atau queue pekerja; outbox hanya batas
  delivery channel.

## Gotcha yang wajib diingat

1. **Offset bukan bukti eksekusi.** Naikkan setelah update durable, lalu gunakan state dispatch
   terpisah. Menunggu sampai sesudah tmux justru membuat replay Telegram mengetik pesan kedua kali.
2. **Update pertama jangan diketik sesudah spawn.** Masukkan ke prompt kelahiran; TUI belum tentu siap
   menerima keystroke ketika `createSession()` sudah mengembalikan id.
3. **Jangan retry status `dispatching`/`sending` sesudah restart.** Itu kelas duplikasi yang ADR ini
   dipilih untuk mencegah. Ubah ke `uncertain` dan surface.
4. **Bot token tidak pernah masuk session.** Hanya gateway transport yang membutuhkannya. Session
   mendapat AgentToken, chat id, dan base URL.
5. **Jangan bentuk reply dari `capturePane()`.** Teks polos tanpa ANSI pun masih dapat memuat reasoning,
   command echo, path, atau secret. Hanya amplop reply eksplisit yang boleh keluar.
6. **Confirmation tidak mengalahkan capability/pagar route.** Ia satu kondisi tambahan khusus token
   gateway; handler existing tetap otoritatif.
7. **Correlation harus ditegakkan berdasarkan id AgentToken terverifikasi, bukan nama/prefix env.**
   Nama dapat diedit dan prefix bukan identitas unik/rahasia.
8. **`callback_data` harus opaque dan pendek.** Deskripsi/action hidup di DB; jangan memasukkan path,
   token, atau brief ke payload callback Telegram.
9. **Model local-only tetap ikut migrasi Postgres.** `LOCAL-only` berarti tidak sync, bukan boleh
   dilupakan `PG_ORDER`.
10. **Klasifikasi destruktif harus membaca dispatch aktual.** Route IDE `POST /projects/:id/git`
    memilih operasi lewat `body.op`; revert stage hanya destruktif ketika `confirmDelete:true`, bukan
    pada request preview. Mencocokkan method/path saja dapat melewatkan reset/clean atau memblokir
    preview yang aman.

## Alternatif yang ditolak

- **Webhook.** Butuh endpoint publik/TLS/secret webhook dan operasi deploy lebih berat tanpa manfaat
  untuk satu bot volume kecil. Bisa menjadi adapter transport kelak.
- **Proses agen per pesan.** Membuat otak/memory kedua dan menghidupkan ulang run headless ADR-0024.
- **Gateway mengeksekusi command langsung.** Command dan natural text akan punya dua otoritas serta
  jalur audit/capability berbeda; bertentangan dengan satu session operator.
- **Raw PTY diff sebagai reply.** Sulit membedakan jawaban user-facing dari reasoning, TUI furniture,
  ANSI, command echo, dan secret; penapis kosmetik tidak cukup.
- **Retry otomatis untuk "exactly once".** Tanpa transaksi lintas DB/tmux/Telegram, retry justru
  mengubah outcome tak diketahui menjadi duplikasi nyata.
- **Memory vector/LLM summarizer gateway.** Menambah model loop/otak kedua. Session operator yang sama
  mengkurasi ringkasan dan memory melalui protokol reply.
