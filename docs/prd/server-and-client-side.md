# PRD — Server & Client Side (Hub Data Pusat + Instance Lokal Sinkron)

> Status: Draft untuk review. Author: PM/PO (nafanesia). Disusun dari brief "Server and Client Side" + brainstorm.
> Deliverable ini adalah **dokumen PRD**, bukan spesifikasi teknis/rencana implementasi. Keputusan implementasi mengikuti PRD ini lewat SPEC/ADR tersendiri.

## Ringkasan

hanoman hari ini adalah **monolit satu-host**: satu proses Fastify (bind `127.0.0.1:8787`) menyajikan SPA + REST + WebSocket, lalu men-spawn Claude Code lewat tmux **di mesin yang sama**, di git worktree di bawah `Project.repoDir` (path lokal host itu), dengan Postgres lokal. Semua data (project, backlog, PRD, VPS) dan semua eksekusi hidup di satu mesin.

PRD ini memisahkan dua peran tanpa mengurangi satu pun fitur:

- **Server side** — satu instance hanoman di-deploy ke VPS sebagai **hub data agregat / "center of development"**. Semua project, backlog, PRD, konfigurasi VPS, dan ringkasan hasil kerja terkumpul di sini. Server bisa menyimpan project **tanpa path lokal**.
- **Client side** — tiap developer menjalankan **instance hanoman lokal penuh** di device-nya. Di sinilah Claude Code, git worktree, dan tmux dijalankan (eksekusi & implementasi). Client mem-bind project ke checkout lokalnya sendiri.

Keduanya **saling sinkron**: data client di-**push** ke server, data server di-**pull** ke client, dengan server sebagai **sumber kebenaran (authoritative)** dan disiplin **pull-before-push**. Saat online, perubahan terpropagasi **realtime lewat WebSocket**; saat offline, client tetap jalan penuh dan mengantre perubahan lokal untuk **auto-sync saat reconnect**. Cakupan: **satu workspace** (`nafanesia`), banyak device, saling percaya.

## Masalah & konteks

### Masalah
1. **Eksekusi dan data terkunci di satu mesin.** Karena runner/tmux/Claude berjalan di proses server dan bekerja di `Project.repoDir` (path lokal host), praktis hanya mesin server yang bisa menjalankan pekerjaan. Tidak ada cara developer bekerja dari device masing-masing sambil tetap berbagi satu sumber data.
2. **Project wajib punya path lokal untuk berguna.** `Project.repoDir` boleh `null`, tetapi hampir semua fitur inti (spawn sesi, worktree, integrate, review) menolak (400/409) bila `repoDir` kosong. Server tak bisa menjadi katalog project murni-data.
3. **Tidak ada agregasi lintas device.** hanoman tidak punya lapisan sinkronisasi antar-instance (ADR-0011: "no sync layer"). Kalau ada beberapa developer/beberapa device, tak ada satu tempat tempat PRD/backlog/VPS/hasil kerja terkumpul.
4. **Tidak ada identitas mesin.** Auth yang ada hanya cookie sesi *same-origin*; tidak ada token machine-to-machine. Sinkronisasi antar-mesin mustahil diautentikasi dengan mekanisme sekarang.

### Konteks arsitektur saat ini (fakta yang mengikat desain)
- **Satu proses, satu host.** Fastify bind `127.0.0.1:8787`, menyajikan SPA build di production; di dev, Vite `:5173` proxy `/api` ke `:8787`. Frontend→server **same-origin, path relatif** (`/api/...`); WebSocket pakai `location.host`. (ADR-0028, ADR-0039)
- **Eksekusi = tmux lokal.** Sesi Claude Code dijalankan `createSession()` di dalam tmux lokal (socket `-L hanoman`) di host server, di worktree `${repoDir}/.worktrees/<id>`. (ADR-0014, ADR-0016)
- **Model data (7 model Prisma):** `Project` (punya `repoDir?` — satu-satunya path project), `Spec` (= "backlog item"; punya `stage`, `payload`, `baseSha/headSha`), `Setting` (singleton), `Notification`, `User`, `Session`, `Vps` (punya `keyPath?` menunjuk berkas key **di mesin server**; isi key tak pernah masuk DB). "PRD" **bukan** entitas DB — ia dokumen file (+ flow project-level). (ADR-0041)
- **Auth sudah ada, tanpa RBAC.** Cookie sesi opaque revocable; multi-user tapi semua setara; belum ada API-key/token mesin. (ADR-0028)
- **Fitur yang sudah tak ada** (relevan untuk batasan "tak boleh dikurangi" — memang sudah tak ada sejak pindah ke sesi interaktif): queue/Redis/worker, scheduler cron endpoint, GitHub webhook. (ADR-0024)
- **VPS = resource yang dikelola** (audit/health/harden/console via SSH), **bukan** target deploy hanoman. (ADR-0025, ADR-0042)

### Kenapa sekarang
Tujuannya menjadikan VPS sebagai **pusat pengembangan**: tempat semua PRD, backlog, VPS, dan jejak hasil kerja terkumpul, sementara pekerjaan Claude Code yang berat & butuh checkout lokal dilakukan di device tiap developer. Tanpa pemisahan ini, hanoman tak bisa tumbuh melampaui satu mesin.

## Persona / pengguna

| Persona | Deskripsi | Kebutuhan utama |
|---|---|---|
| **Developer (client operator)** | Anggota workspace yang menjalankan instance hanoman lokal di device-nya, mengeksekusi Claude Code di repo lokal. | Bind project ke checkout lokal, kerja (termasuk offline), lalu sync hasil ke server tanpa kehilangan data. |
| **PM/PO (curator hub)** | Mengelola PRD & backlog terpusat di server; ingin melihat "apa yang sedang/sudah dikerjakan" lintas device. | Katalog project/backlog/PRD lengkap di server; ringkasan hasil sesi dari semua device. |
| **Ops / VPS owner** | Mengelola VPS (audit, health, harden, console) dari server maupun client. | Aksi VPS bisa dijalankan dari instance mana pun yang memegang key; config VPS tersync. |
| **Server pusat (VPS)** *(aktor sistem)* | Instance hanoman sebagai hub authoritative. | Menyimpan project tanpa path; menerima push, melayani pull; mempertahankan seluruh fitur lama. |
| **Client instance** *(aktor sistem)* | Instance hanoman lokal di device developer. | Instance mandiri offline-capable; sync push/pull dengan server; mengeksekusi Claude Code lokal. |

## Goals & non-goals

### Goals
1. **Server sebagai hub data agregat.** Satu instance di VPS menyimpan project, backlog (`Spec`), PRD/dokumen, konfigurasi VPS, dan ringkasan hasil sesi dari semua device.
2. **Project tanpa path di server.** Server menyimpan project sebagai metadata (+ git remote opsional) tanpa `repoDir`; tiap device memetakan project ke checkout lokalnya sendiri.
3. **Sinkronisasi push/pull yang benar & aman.** Client push → server; server → client pull. Server authoritative dengan pull-before-push; tanpa lost update.
4. **Realtime saat online, tahan saat offline.** Propagasi cepat via WebSocket saat online; client tetap jalan penuh saat offline dan auto-sync saat reconnect.
5. **Identitas mesin.** Token API per-device (terikat ke user, revocable) untuk mengautentikasi sync + WS.
6. **Tanpa fitur dikurangi (additive).** Server mempertahankan **seluruh** fitur hari ini — termasuk kemampuan spawn Claude Code sendiri bila punya checkout lokal — ditambah peran hub + sync. Client (instance lokal penuh) juga punya seluruh fitur.

### Non-goals
1. **Bukan multi-tenant.** Hanya satu workspace (`nafanesia`); isolasi data antar-tim & RBAC berjenjang di luar scope (pasca-MVP; lihat `scope-principles.md`).
2. **Bukan sentralisasi eksekusi.** Server tidak "mengambil alih" eksekusi Claude Code dari client; eksekusi tetap terjadi di mesin yang memegang checkout (client, atau server bila punya checkout).
3. **Bukan sentralisasi kredensial/usage Anthropic.** Token usage/limit tidak diagregasi di server; tiap device membaca kredensial & usage lokalnya sendiri.
4. **Bukan sync transkrip PTY mentah.** Output terminal mentah tidak di-push ke server.
5. **Bukan sync settings & notifikasi.** Model/effort dan notifikasi bersifat per-device (local-only).
6. **Bukan custom line-merge engine.** Resolusi konflik dokumen memakai deteksi konflik record-level + git 3-way merge yang sudah ada, bukan mesin merge per-baris baru.
7. **Tidak menghidupkan kembali** queue/scheduler/webhook yang sudah dicabut (ADR-0024) tanpa ADR baru.

## Scope

### In scope
- **Peran server-as-hub:** instance hanoman yang bisa menyimpan project tanpa `repoDir`, menerima push, melayani pull, dan mempertahankan seluruh fitur lama.
- **Peran client-as-local-instance:** instance hanoman lokal yang mem-bind project ke folder lokal (existing) atau meng-clone dari git remote, menjalankan Claude Code/worktree/tmux lokal, dan sync ke server.
- **Mapping per-device `projectId → repoDir`** yang disimpan lokal (tidak pernah disync).
- **Model sync server-authoritative** dengan version-stamp per record/dokumen dan disiplin pull-before-push.
- **Transport realtime WebSocket** saat online + **antre lokal & drain saat reconnect** saat offline.
- **Token API per-device** (issue, simpan di client, kirim di tiap sync/WS, revoke per-device) terikat ke user untuk atribusi author.
- **Entitas yang tersync (server-authoritative):** project metadata (nama, kind, stack, git remote), backlog `Spec` (item, stage, priority, payload, base/head SHA), PRD & dokumen (isi konten), VPS (config, hasil audit, health, status hardening), dan **ringkasan hasil sesi** (specId, stage transition, commit SHA, branch/PR link, status, timestamp, deviceId/author).
- **Ringkasan hasil = activity log append-only** di server (whitelist field, tanpa auto-expiry, purge manual tersedia).
- **VPS dikelola dari server maupun client** (aksi SSH berjalan di mesin yang memegang key).

### Out of scope
- Multi-tenant, RBAC berjenjang, kuota/billing per-tim.
- Sync transkrip PTY mentah, diff/patch penuh, atau replay sesi dari server.
- Sync settings (model/effort) & notifikasi.
- Agregasi token usage/limit Anthropic lintas device.
- Sentralisasi/sinkronisasi private key VPS (key & `keyPath` tetap per-mesin).
- Custom line-level merge engine untuk dokumen.
- Menghidupkan kembali queue/Redis/worker/scheduler/webhook.

## User stories

1. **Pairing device.** Sebagai developer, saya membuat token device di server dan menempelkannya di instance hanoman lokal saya, supaya instance saya bisa sync ke server sebagai diri saya. Kalau device hilang, saya (atau admin) mencabut token itu saja.
2. **Project tanpa path di server.** Sebagai PM, saya membuat project di server hanya dengan metadata (nama, kind, stack, opsional git remote) tanpa harus menyediakan path, supaya server jadi katalog terpusat.
3. **Bind / clone di client.** Sebagai developer, saya membuka project server di device saya lalu memilih folder lokal existing **atau** clone dari git remote yang tercatat, supaya saya bisa mengeksekusi Claude Code terhadap checkout lokal saya.
4. **Pull sebelum kerja.** Sebagai developer, saya pull dari server untuk mendapat versi terbaru backlog/PRD sebelum mulai, supaya saya tidak bekerja di atas data basi.
5. **Push hasil.** Sebagai developer, setelah backlog berpindah stage / ada commit / PR terbuka, ringkasan itu ter-push ke server, supaya jejak "apa yang terjadi" terkumpul di pusat.
6. **Realtime saat online.** Sebagai anggota workspace, saat rekan mengubah backlog/PRD di server, perubahan itu muncul di instance saya dalam hitungan detik lewat WebSocket, tanpa saya menekan tombol.
7. **Kerja offline.** Sebagai developer di jaringan tak stabil, saya tetap bisa membuat backlog/PRD dan menjalankan Claude Code saat offline; perubahan saya diantre lokal dan otomatis tersync saat koneksi balik.
8. **Konflik yang eksplisit.** Sebagai developer, jika push saya berdasarkan versi yang sudah basi, push ditolak dan saya diberi diff untuk pull-rebase, supaya tidak menimpa perubahan orang lain diam-diam.
9. **Parity di kedua sisi.** Sebagai pengguna, seluruh fitur hanoman yang saya kenal tetap tersedia baik di server (bila punya checkout) maupun di client lokal — tak ada yang hilang.
10. **VPS dari mana saja.** Sebagai ops, saya menjalankan test/audit/harden/console VPS dari instance mana pun yang memegang key VPS, dan config/hasilnya tersync ke server.
11. **Preferensi lokal tetap lokal.** Sebagai developer, model/effort dan notifikasi saya bersifat per-device dan tidak mengganggu setelan rekan lain.

## Acceptance criteria (gaya EARS)

> Konvensi EARS: **Ubiquitous** ("The system shall …"), **Event-driven** ("When …, the system shall …"), **State-driven** ("While …, the system shall …"), **Unwanted** ("If …, then the system shall …"), **Optional** ("Where …, the system shall …").

### Identitas & pairing device
- **AC-1 (Event).** When a user creates a device token on the server, the system shall issue a revocable token bound to that user and display it once for the client to store.
- **AC-2 (Ubiquitous).** The system shall require a valid device token on every sync request and on the WebSocket upgrade; requests without one shall be rejected with 401.
- **AC-3 (Event).** When a device token is revoked, the system shall reject all subsequent sync/WS attempts using that token without affecting other devices' tokens.
- **AC-4 (Ubiquitous).** The system shall attribute records produced by a client (e.g. `Spec.author`) to the user bound to that client's device token.

### Project tanpa path & mapping lokal
- **AC-5 (Optional).** Where a project is created on the server without `repoDir`, the system shall persist and list it as a valid project (metadata + optional git remote) without error.
- **AC-6 (Event).** When a developer binds a server project on a client, the system shall let them select an existing local folder **or** clone from the project's recorded git remote, and store the `projectId → repoDir` mapping **locally on that device only**.
- **AC-7 (Ubiquitous).** The system shall never include a client's local `repoDir` mapping in any data pushed to or pulled from the server.
- **AC-8 (Unwanted).** If a developer attempts to spawn a Claude Code session for a project not yet bound to a local checkout, then the system shall block execution and prompt to bind/clone first (consistent with today's "belum punya repoDir" guard).

### Model sync (server-authoritative, pull-before-push)
- **AC-9 (Ubiquitous).** The system shall treat the server as the single source of truth for all synced entities (project metadata, `Spec`, PRD/documents, VPS config/results, session result summaries).
- **AC-10 (Ubiquitous).** The system shall stamp every synced record/document with a version (hash/etag) that changes on every accepted write.
- **AC-11 (Event).** When a client pushes a record whose base version matches the server's current version, the system shall accept the write and advance the version.
- **AC-12 (Unwanted).** If a client pushes a record whose base version is stale, then the system shall reject the push and require the client to pull first; no server data shall be overwritten.
- **AC-13 (Event).** When a stale push is rejected, the system shall present the client with a diff between local and server versions so a human can pull-rebase and re-push.
- **AC-14 (Optional).** Where a document body is a git-tracked file in the repo, the system shall use the existing git 3-way merge for its contents rather than a custom line-merge engine.
- **AC-15 (Ubiquitous).** The system shall guarantee that a record accepted by the server becomes retrievable by any other device on its next pull, with no lost update and no duplicate.

### Realtime & offline
- **AC-16 (State).** While a client is connected to the server, the system shall propagate accepted changes to other connected clients over WebSocket within a few seconds (target p95 < 3 dtk).
- **AC-17 (State).** While a client is offline, the system shall remain fully usable for local work (create/edit backlog & PRD, spawn Claude Code, run worktrees) and shall queue outgoing changes locally.
- **AC-18 (Event).** When a client reconnects after being offline, the system shall drain the local queue by pulling first, then pushing (pull-before-push), reconciling all queued records without data loss.
- **AC-19 (Unwanted).** If the WebSocket drops mid-session, then the system shall not lose or corrupt any local work and shall resume sync automatically on reconnect.

### Ringkasan hasil (activity log)
- **AC-20 (Event).** When a session changes a `Spec` stage, produces a commit, or opens a branch/PR on a client, the system shall push a **result summary** containing only whitelisted structured fields (specId, old→new stage, commit SHA, branch, PR URL, status, timestamp, deviceId/author).
- **AC-21 (Ubiquitous).** The system shall never push raw PTY transcripts, free-form blobs, credentials, or tokens as part of a result summary.
- **AC-22 (Ubiquitous).** The system shall store result summaries as an append-only activity log without automatic expiry, and shall provide a manual purge scoped by project and/or date range.

### Parity & scope preservation (additive)
- **AC-23 (Ubiquitous).** The system shall preserve every existing feature and endpoint on the server; no feature present today shall be removed by this change.
- **AC-24 (Optional).** Where the server instance has a local checkout for a project, the system shall still be able to spawn Claude Code sessions on the server itself (server execution remains available).
- **AC-25 (Ubiquitous).** The system shall make the full feature set available on a client instance running locally (client is a full instance, not a thin client).

### VPS (dikelola dari server & client)
- **AC-26 (Ubiquitous).** The system shall sync VPS records (config, audit results, health, hardening status) as server-authoritative data.
- **AC-27 (Optional).** Where an instance (server or client) holds the VPS private key locally, the system shall allow that instance to run VPS SSH actions (test/audit/harden/console).
- **AC-28 (Unwanted).** If an instance lacks the VPS private key locally, then the system shall not run SSH actions from that instance and shall surface a clear "key not present on this machine" message.
- **AC-29 (Ubiquitous).** The system shall never sync VPS private keys or their `keyPath` values; these remain per-machine.

### Preferensi per-device
- **AC-30 (Ubiquitous).** The system shall keep settings (model/effort) and notifications local to each device and shall not sync them.

## Metrik sukses

Keempat dijadikan tolok ukur utama:

1. **Parity / tanpa regresi** — Bukti "tak ada fitur dikurangi".
   - Target: **100%** test suite existing (server & client) tetap hijau saat berjalan sebagai hub maupun sebagai instance lokal; **0** endpoint hilang dibanding baseline hari ini.
2. **Konsistensi & keutuhan sync** — Data client sampai ke server & bisa di-pull device lain tanpa hilang/duplikat; konflik tertangani via pull-before-push.
   - Target: **0** lost update terdeteksi; **100%** record ter-reconcile setelah reconnect; **0** duplikat.
3. **Latensi realtime & ketahanan offline** — Propagasi cepat saat online; nol kehilangan data saat offline→reconnect.
   - Target: **p95 propagasi < 3 detik** saat online; **100%** drain antre sukses tanpa kehilangan data setelah reconnect.
4. **Adopsi & sentralisasi data** — Server benar-benar jadi "center of development".
   - Target: **≥ 2 device** aktif sync rutin; **100%** project baru tercatat di server; mayoritas PRD/backlog/VPS terkumpul di server.

## Open questions

Semua open question dari brainstorm telah diputuskan; berikut catatannya untuk transparansi + isu turunan yang muncul saat penyusunan.

**Sudah diputuskan:**
- **Retensi/redaksi ringkasan hasil** → Append-only, **tanpa auto-expiry**; **whitelist field** (bukan mesin redaksi); purge manual tersedia. *(Rekomendasi diterima.)*
- **Settings & notifikasi** → **Per-device, tidak disync.**
- **Granularitas merge dokumen** → **Record-level optimistic concurrency** (version-stamp) + git 3-way merge untuk file ter-git; **tanpa** custom line-merge engine. *(Rekomendasi diterima.)*
- **Agregasi token usage/limit Anthropic** → **Tidak**; tiap device baca kredensial/usage lokalnya sendiri.
- **Manajemen VPS** → **Client juga boleh**; aksi SSH berjalan di instance yang memegang key (key & `keyPath` per-mesin).
- **Auth client→server** → **Token API per-device**, terikat ke user, revocable.

**Isu turunan yang perlu dijawab saat SPEC/desain teknis (belum diputuskan di level PRD):**
- **OQ-1 — Strategi migrasi.** Bagaimana transisi dari deploy single-host sekarang (prod di VPS: satu checkout, dua instance beda DB+port; `operations/production.md`) ke model server-hub + client-instance? Perlu langkah rollout & kompatibilitas mundur.
- **OQ-2 — UX pairing device pertama.** Alur konkret membuat token device pertama & bootstrap client (termasuk saat server baru berdiri). Siapa yang boleh menerbitkan token (semua user setara — apakah cukup?).
- **OQ-3 — Kanal WebSocket sync.** Apakah realtime sync memakai kembali WS siar dashboard yang ada (ADR-0039) atau kanal WS baru terpisah? Implikasi ke otorisasi per-token pada upgrade WS.
- **OQ-4 — Base URL client→server.** Frontend saat ini same-origin path relatif (`/api/...`, `location.host`). Client lokal yang menunjuk server remote butuh konfigurasi base URL/host absolut untuk REST & WS — perlu ditetapkan di desain (dan dampaknya ke CORS/cookie vs token).
- **OQ-5 — Cakupan tepat "ringkasan hasil".** Daftar field whitelist final & pemetaannya ke entitas (`Spec` stage transition, notifikasi lokal yang TIDAK ikut, commit/PR) perlu dikunci sebagai kontrak.
- **OQ-6 — Identitas & idempotensi record lintas device.** Bagaimana ID record dibuat agar push dari device berbeda tidak bentrok/duplikat (mis. ULID/UUID client-generated + dedup server) — penting untuk AC-15.
- **OQ-7 — Keamanan transport.** Diasumsikan TLS via reverse proxy (ADR-0028). Perlu ditegaskan untuk sync token & WS dari internet publik (rate-limit, rotasi token).
- **OQ-8 — Penyimpanan ringkasan di server.** Apakah activity log = model Prisma baru (butuh migration + ADR) atau perluasan model yang ada? (Perubahan skema wajib migration + ADR.)
