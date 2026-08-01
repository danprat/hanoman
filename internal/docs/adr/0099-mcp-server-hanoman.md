# ADR-0099 — MCP server hanoman: subcommand stdio yang jadi klien REST, katalog tool di `shared`

- Status: Accepted
- Tanggal: 2026-08-01
- SPEC: SPEC-482 (MCP server untuk hanoman agar agen AI luar bisa mengakses backlog dan datanya)
- Terkait: **memperluas** [0065](0065-ai-agent-capability-agent-token.md) (agent token + capability
  per-domain — MCP tak menambah jalur auth, ia memakai yang itu); **mengikuti**
  [0087](0087-distribusi-npm-global-satu-perintah.md) (satu perintah `hanoman`, satu artefak
  distribusi) dan [0038](0038-paginasi-di-response-layer.md) (paginasi di lapis balasan, bukan DB);
  **mengambil pelajaran dari** [0092](0092-cabut-error-monitoring-sdk-cross-audit.md) (`hanoman-sdk`
  sebagai paket kedua terbukti melenceng versinya — dan domain `errors` yang disebut objective
  SPEC-482 sudah tak ada); **tidak menyentuh** [0037](0037-cabut-guardrail-safety.md) — batas eksekusi
  tetap isolasi worktree, dan yang dilakukan spec ini adalah TIDAK menyediakan tool eksekusi, bukan
  menambahkan gerbang; **tidak menyentuh** [0024](0024-sesi-interaktif-menggantikan-run.md) — MCP
  server tak mengerjakan pekerjaan bertahap, ia membaca dan menulis baris backlog;
  **tidak mencabut** apa pun.

## Konteks

Seluruh permukaan fitur hanoman sudah REST di bawah `/api`, dan jalur auth untuk agen sudah ada sejak
ADR-0065: `Authorization: Bearer hnm_agt_…` + capability per-domain, digerbangi satu hook `onRequest`
di `server/src/app.ts`. Yang tak pernah ada adalah **pembungkus yang bisa dipakai agen mana pun**.

Hari ini setiap klien AI harus menulis ulang pembungkusnya. Di lingkungan ini bentuknya skill
`~/.claude/skills/hanoman`: satu helper shell `hnm` plus `api-reference.md` sepanjang 240 baris yang
harus dibaca agen sebelum memanggil apa pun. Isi dokumen itu adalah bukti masalahnya — separuhnya
bukan dokumentasi fitur melainkan **jebakan yang hanya ketahuan lewat 400/403**:

- `payload` `POST /specs` wajib cocok dengan `source`; salah → 400 `"bentuk payload tak cocok dengan
  source"`. Ada **tiga** bentuk terpisah (`brief`-family / `qa` / `goal`).
- `startable` **hanya menerima string `"true"`**; `startable=1` diabaikan **senyap** dan mengembalikan
  seluruh backlog termasuk yang `done` — angka totalnya tetap tampak masuk akal, jadi salahnya tak
  terlihat.
- `q` mencari di `id + title + objective` saja, **tidak** menyentuh isi `payload`.
- Route cookie-only (`/api/auth/*`, `/api/agent-tokens*`, `/api/device-tokens*`, `/api/sync*`)
  **selalu** 403 untuk agent token, apa pun capability-nya.
- Agent token diterbitkan **per-instance**; token lokal di instance lain menjawab **401 telanjang**
  yang tak bisa dibedakan dari "master switch mati" atau "token dicabut".

Dan dokumen terpisah itu sudah **basi tanpa suara**: `api-reference.md` masih memuat domain `errors`
(`/api/errors*`) dan source `cross-audit`, dua-duanya dicabut SPEC-384/ADR-0092. Itulah argumen inti
ADR ini — **skema tool tak bisa basi diam-diam, karena ia dites**.

## Keputusan

### 1. Bentuk: subcommand stdio yang berperan sebagai klien REST

MCP server hanoman adalah **`hanoman mcp`** — subcommand di CLI yang sudah ada, berbicara MCP lewat
**stdio**, dan memanggil `/api` lewat HTTP dengan agent token.

Empat alasan yang mengikat:

1. **Otorisasi tak punya jalur kedua.** Karena ia memanggil endpoint REST yang sama, gate `onRequest`
   (master switch → `authenticateAgent` → `checkAgentCapability`) tetap satu-satunya yang memutuskan.
   Tak ada kode otorisasi baru yang bisa melenceng, dan route cookie-only tetap tak terjangkau
   **secara struktural** — bukan karena kita ingat memagarinya.
2. **stdio didukung merata** (Claude Code, Claude Desktop, Codex, Cursor, Copilot). MCP remote masih
   beragam dukungannya di klien.
3. **Host & instance jadi eksplisit** di konfigurasi klien (`HANOMAN_HOST`), yang memang dituntut
   sifat per-instance agent token.
4. **Satu artefak distribusi** (ADR-0087). Paket kedua akan punya versi sendiri yang melenceng dari
   instance-nya — pelajaran `hanoman-sdk` (ADR-0092).

Dependency protokol: **`@modelcontextprotocol/server@2`** (+ `@modelcontextprotocol/core`, `zod@4`),
**dibundel esbuild** ke `cli/dist/hanoman.js`.

### 2. Katalog tool hidup di `@hanoman/shared`, sebagai data murni

`shared/src/mcp-schema.ts` (fragmen JSON Schema) · `mcp-shape.ts` (pemadat & plafon byte) ·
`mcp-catalog.ts` (17 definisi tool) · `mcp.ts` (versi, `mcpToolsFor`, instructions).

Dipakai **runtime MCP di CLI** dan **panel Settings di web**. Satu sumber: daftar capability yang
harus dicentang manusia tak bisa drift dari yang benar-benar dituntut tool.

### 3. Gerbang anti-bypass yang mekanis, bukan janji prosa

Tiap entri katalog menyatakan `capability` + `samplePath` + `sampleMethod`. Satu test di **server**
(`server/test/mcp-capability.test.ts` — satu-satunya paket yang memiliki `capabilityForRoute`)
menegakkan `capabilityForRoute(tool.sampleMethod, "/api" + tool.samplePath) === tool.capability`,
plus larangan cookie-only, larangan `/vps`, dan larangan `/terminal` non-GET.

### 4. Batas tool: 17, dan yang mengeksekusi tidak ikut

13 baca (`about`, `projects_list`, `project_get`, `backlog_search`, `backlog_get`,
`backlog_docs_list`, `backlog_doc_read`, `sessions_list`, `notifications_list`, `tickets_list`,
`ticket_get`, `github_issues_list`, `lead_decisions_list`) + 4 tulis (`backlog_create`,
`backlog_update`, `notifications_mark_read`, `lead_ask`).

**Sengaja tidak ada:** `POST /terminal/sessions` (men-spawn `claude --dangerously-skip-permissions`
di worktree — RCE efektif), seluruh `/api/vps*` (remote exec), `POST /specs/:id/integrate`,
`DELETE /specs/:id`, dan `PATCH /specs/:id {stage}` (yang menghapus artefak dokumen). Menyediakannya
kelak menuntut opt-in eksplisit **terpisah** dan penandaan berbahaya di deskripsi toolnya.

Tool `errors` **tidak dibuat** meski objective SPEC-482 menyebutnya: permukaannya sudah dicabut
ADR-0092. Kanal masuk yang tersedia adalah tiket Help Center dan issue GitHub (ADR-0095).

### 5. Mode baca-saja MENGHILANGKAN tool, bukan menolaknya

`hanoman mcp --read-only` (atau `HANOMAN_MCP_READ_ONLY=1`) membuat keempat tool tulis tak muncul di
`tools/list`. Tool yang tak terlihat tak bisa dicoba — menolak saat dipanggil hanya menghasilkan
percobaan yang pasti gagal dan konteks yang terbakar.

### 6. Gagal-lunak saat start, jelaskan saat panggil

Konfigurasi kurang (host/token kosong) **tidak** mematikan proses. Klien MCP menyembunyikan stderr,
jadi proses yang mati hanya tampak sebagai "server MCP gagal" tanpa sebab yang bisa dibaca manusia.
Sebagai gantinya server tetap berdiri, `tools/list` tetap jalan, dan setiap panggilan mengembalikan
`isError` berisi kalimat yang menyebut variabel mana yang harus diisi. `hanoman_about` sengaja bisa
dipanggil **tanpa token** dan melaporkan host, mode, versi skema, serta daftar keluhan konfigurasi.

### 7. Versi skema tool

`MCP_TOOL_SCHEMA_VERSION = 1`. **Aditif dalam satu versi** (tool baru, parameter opsional baru,
deskripsi diperluas); **naik versi** untuk mengganti/menghapus nama tool, menghapus parameter,
menjadikan parameter opsional jadi wajib, atau mengubah bentuk hasil. Ditegakkan **test snapshot
katalog** (nama tool + daftar parameter wajib): perubahan yang memutus klien lama tak bisa lolos
tanpa seseorang sengaja memperbarui snapshot **dan** angkanya.

## Konsekuensi

- **Tak ada endpoint server baru, tak ada perubahan skema Prisma, tak ada migration.** MCP adalah
  klien kontrak REST yang sudah ada.
- Bundle `cli/dist/hanoman.js` tumbuh ±750 KB (SDK + validator JSON Schema + zod v4, semuanya
  dibundel esbuild). `RUNTIME_DEPS` paket npm **tidak** bertambah — tak ada dependency baru yang
  harus dipasang npm saat `npm i -g hanoman`.
- Skill/pembungkus per-klien yang ditulis tangan tak lagi menjadi satu-satunya jalan. Ia boleh tetap
  ada, tapi tak lagi menjadi tempat pengetahuan yang bisa basi tanpa ketahuan.
- Panel Settings → Akses AI Agent kini memuat kartu "MCP server" (snippet pasang per klien) dan
  "Tool yang tersedia" (tabel dari katalog).

## Gotcha wajib

Semuanya terukur saat spike; jangan "diperbaiki" tanpa mengulang pengukurannya.

1. **stdout milik JSON-RPC.** Satu byte diagnostik ke stdout merusak protokol, dan klien
   melaporkannya sebagai "server rusak" tanpa sebab. Perintah `mcp` **tak pernah** memanggil
   `ctx.stdout`; seluruh diagnostik ke stderr, dan stderr pun melewati redaksi token.
2. **`allOf`/`if`/`then` di JSON Schema ditegakkan validator SDK.** Terukur: `source: "qa"` dengan
   payload bentuk brief ditolak **di klien** (`isError`, handler tak pernah jalan) dan permintaannya
   tak pernah sampai ke server. Inilah yang membuat "agen dibimbing ke panggilan yang sah alih-alih
   menemukannya lewat 400" benar-benar terjadi, bukan sekadar deskripsi yang lebih baik.
3. **401 telanjang tak bisa dibedakan** antara host salah / master switch mati / token dicabut.
   Probe `GET /api/health` — endpoint **PUBLIK** (`PUBLIC` di `app.ts`, tanpa auth) — dijalankan
   **sekali** saat 401 pertama lalu di-cache; ia satu-satunya yang memisahkan "host salah" dari
   "token salah". Menebaknya salah berarti menyuruh manusia memeriksa hal yang keliru.
4. **`GET /specs/:id` tidak ada** di REST. `hanoman_backlog_get` memakai `GET /specs?q=<id>`, dan `q`
   adalah **substring** — tanpa pencocokan `id` persis di wrapper, `SPEC-48` mengembalikan
   `SPEC-480…489`.
5. **`startable` hanya menerima string `"true"`.** Skema tool memakai **boolean**, dan `false`
   **menghilangkan** parameternya alih-alih mengirim `"false"` yang akan diabaikan senyap.
6. **Token tak pernah dari flag.** Seluruh ARGV terbaca `ps` oleh proses lain di mesin yang sama —
   itu persis cara prompt sesi bocor di SPEC-402. `--token` justru menghasilkan **keluhan**, dan
   keluhannya tak mengutip nilainya.
7. **Redaksi di satu titik keluar, bukan per call site.** SPEC-472 membuktikan satu call site yang
   terlewat sudah cukup: pesan `execFile` memuat argv, dan argv memuat rahasia. `redactToken`
   mengganti nilai token **dan** pola `hnm_agt_[…]` apa pun.
8. **Pemotongan harus tetap JSON sah.** JSON terpotong di tengah dibaca agen sebagai galat parsing,
   bukan batas ukuran. `renderResult` memangkas item demi item sampai muat lalu menyisipkan penanda
   `truncated`/`shown`/`total`/`hint`.

## Alternatif yang ditolak

- **Endpoint MCP HTTP di Fastify (`/mcp`).** Menjahit ulang jalur otorisasi ke gate yang sudah ada —
  persis "jalur baru" yang dilarang batasan spec — dan dukungan MCP remote belum merata di
  Codex/Cursor/Copilot.
- **Paket npm terpisah `hanoman-mcp`.** Artefak publish kedua yang versinya bisa melenceng dari
  instance yang dilayaninya. `hanoman-sdk` sudah membuktikannya (ADR-0092).
- **`@modelcontextprotocol/sdk@1`.** Menarik express, hono, jose, ajv, eventsource, pkce-challenge,
  dan belasan lainnya untuk sebuah server stdio. Generasi v2 hanya butuh `zod` + `core`.
- **Tool `errors`.** Permukaannya tak ada lagi (ADR-0092); menyediakannya berarti menerbitkan tool
  yang pasti menjawab 403 cookie-only.
