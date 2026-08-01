# SPEC-482 — MCP server hanoman

Design doc. Sumber: brief SPEC-482, `internal/docs/README.md`, `docs/agent-integration.md`,
ADR-0065 (agent token + capability), ADR-0087 (distribusi npm global), ADR-0092 (error monitoring
dicabut), ADR-0095 (issue GitHub), ADR-0091 (hanoman-lead).

## 1. Masalah

Permukaan fitur hanoman seluruhnya REST di bawah `/api` dan sudah punya jalur auth agen
(`Authorization: Bearer hnm_agt_…` + capability per-domain, ADR-0065). Yang tak ada adalah
**pembungkus yang bisa dipakai agen mana pun**. Hari ini setiap klien AI harus menulis ulang
wrappernya sendiri — di repo ini bentuknya skill `~/.claude/skills/hanoman` berisi helper shell
`hnm` plus 240 baris `api-reference.md` yang harus dibaca agen sebelum memanggil apa pun.

Konsekuensinya terukur dari isi skill itu sendiri: separuh isinya adalah **jebakan yang hanya
ketahuan lewat 400/403**, bukan dokumentasi fitur —

- `payload` `POST /specs` wajib cocok dengan `source`; salah → 400 `"bentuk payload tak cocok
  dengan source"`. Tiga bentuk berbeda (`brief`-family / `qa` / `goal`).
- `startable` **hanya menerima string `true`**; `startable=1` diabaikan **senyap** dan
  mengembalikan seluruh backlog termasuk yang `done` — totalnya tetap tampak masuk akal.
- `q` mencari di `id + title + objective` saja, tidak menyentuh `payload`.
- Route cookie-only (`/api/auth/*`, `/api/agent-tokens*`, `/api/device-tokens*`, `/api/sync*`)
  **selalu** 403 untuk agent token, apa pun capability-nya.
- Token diterbitkan **per-instance**; token lokal di `https://hanoman.nafanesia.id` menjawab 401
  telanjang yang tak bisa dibedakan dari "master switch mati" atau "token dicabut".

Selain itu `api-reference.md` di skill itu sudah **basi**: ia masih memuat domain `errors`
(`/api/errors*`) dan source `cross-audit`, dua-duanya dicabut SPEC-384/ADR-0092. Dokumen terpisah
yang harus dibaca agen adalah dokumen yang bisa basi tanpa suara. Skema tool tidak bisa.

## 2. Keputusan bentuk

**`hanoman mcp` — subcommand stdio di CLI yang sudah ada, yang berperan sebagai HTTP client ke
`/api` dengan agent token.**

Alasan yang mengikat, bukan preferensi:

1. **Otorisasi tak punya jalur kedua.** MCP server memanggil endpoint REST yang sama lewat HTTP,
   jadi gate `onRequest` di `app.ts` (master switch → `authenticateAgent` → `checkAgentCapability`)
   adalah satu-satunya yang memutuskan. Tak ada kode otorisasi baru yang bisa melenceng, dan route
   cookie-only tetap tak terjangkau **secara struktural** — bukan karena kita ingat memagarinya.
2. **stdio didukung merata** (Claude Code, Claude Desktop, Codex, Cursor, Copilot). MCP remote
   masih beragam dukungannya.
3. **Host & instance jadi eksplisit** di konfigurasi klien (`HANOMAN_HOST`), persis yang dituntut
   batasan brief.
4. **Satu artefak distribusi.** Ikut paket npm `hanoman` yang sudah ada (ADR-0087). Tak ada paket
   kedua yang versinya bisa melenceng dari instance-nya — pelajaran `hanoman-sdk` (ADR-0092).

Dependency protokol: **`@modelcontextprotocol/server@2`** (+ `@modelcontextprotocol/core`, `zod@4`).
Ketiganya **dibundel esbuild** ke `cli/dist/hanoman.js`, jadi `RUNTIME_DEPS` paket npm tidak
bertambah. Generasi lama (`@modelcontextprotocol/sdk@1`) menarik express, hono, jose, ajv,
eventsource — belasan dependency untuk sebuah server stdio; ditolak.

## 3. Arsitektur

```
klien MCP (Claude Code / Desktop / Codex / Cursor / Copilot)
   │  stdio · JSON-RPC
   ▼
hanoman mcp                         ← cli/src/commands/mcp.ts + cli/src/mcp/*
   │  HTTP · Authorization: Bearer hnm_agt_…
   ▼
GET/POST /api/…                     ← gate onRequest app.ts (TAK DISENTUH)
   │
   ▼
hanoman server (Fastify + SQLite)
```

Tiga lapis, batas jelas:

| Unit | Isi | Uji |
|---|---|---|
| `shared/src/mcp.ts` | **katalog tool**: nama, judul, deskripsi, JSON Schema input, capability yang dibutuhkan, `mutates`, pemetaan ke `{method, path, query, body}`, dan `shape()` pemadat respons. Data + fungsi murni. | unit, tanpa I/O |
| `cli/src/mcp/*` | klien HTTP, pemetaan galat, pemotongan ukuran, redaksi token, loop MCP | unit (murni) + smoke stdio |
| `src/src/screens/SettingsScreen.tsx` | kartu "MCP server": snippet pasang siap salin + tabel tool dari katalog yang sama | RTL |

Katalog hidup di `shared` supaya **satu sumber**: yang dipakai runtime MCP dan yang dirender
Settings adalah objek yang sama. Manusia yang mencentang capability di Settings melihat daftar
capability yang persis dituntut tool-nya.

### 3.1 Gerbang anti-bypass yang mekanis

Tiap entri katalog menyatakan `capability` secara eksplisit. Satu test di **server**
(satu-satunya paket yang memiliki `capabilityForRoute`) menegakkan bahwa untuk setiap tool:

```
capabilityForRoute(tool.method, tool.samplePath) === tool.capability
```

Jadi bila peta route→capability di server berubah dan katalog tidak, testnya merah. Ini pengganti
mekanis untuk "jangan ada cara memutar capability" — bukan janji di prosa.

Test kedua menegakkan **tak ada tool yang menyentuh route cookie-only** dan **tak ada tool yang
menyentuh `/api/terminal` dengan method selain GET** maupun `/api/vps`.

## 4. Katalog tool (skema versi 1)

17 tool. Prefix `hanoman_` supaya tak bertabrakan dengan MCP server lain di klien yang sama.

**Baca — selalu tersedia (12 + 1):**

| Tool | REST | Capability |
|---|---|---|
| `hanoman_about` | — (lokal + `GET /health`) | — |
| `hanoman_projects_list` | `GET /projects` | `projects:read` |
| `hanoman_project_get` | `GET /projects/:id` | `projects:read` |
| `hanoman_backlog_search` | `GET /specs` | `backlog:read` |
| `hanoman_backlog_get` | `GET /specs?q=<id>` → cocok persis | `backlog:read` |
| `hanoman_backlog_docs_list` | `GET /specs/:id/docs` | `backlog:read` |
| `hanoman_backlog_doc_read` | `GET /specs/:id/docs/*` | `backlog:read` |
| `hanoman_sessions_list` | `GET /terminal/sessions` | `sessions:read` |
| `hanoman_notifications_list` | `GET /notifications` | `notifications:read` |
| `hanoman_tickets_list` | `GET /tickets` | `support:read` |
| `hanoman_ticket_get` | `GET /tickets/:id` | `support:read` |
| `hanoman_github_issues_list` | `GET /projects/:id/github/issues` | `support:read` |
| `hanoman_lead_decisions_list` | `GET /lead/decisions` | `lead:read` |

**Tulis — disembunyikan di mode baca-saja (4):**

| Tool | REST | Capability |
|---|---|---|
| `hanoman_backlog_create` | `POST /specs` | `backlog:write` |
| `hanoman_backlog_update` | `PATCH /specs/:id` | `backlog:write` |
| `hanoman_notifications_mark_read` | `POST /notifications/read` | `notifications:write` |
| `hanoman_lead_ask` | `POST /lead/decisions` | `lead:write` |

**Sengaja TIDAK ada**, dan ini batas keras:

- `POST /terminal/sessions` — men-spawn agen `claude --dangerously-skip-permissions` di worktree:
  RCE efektif. Batasan brief melarangnya ikut secara default; menyediakannya kelak menuntut opt-in
  terpisah + penandaan berbahaya di deskripsi tool. Tak ada di spec ini.
- `/api/vps*` — remote exec.
- `POST /specs/:id/integrate`, `DELETE /specs/:id`, `PATCH /specs/:id {stage}` — merge/rebase,
  penghapusan, dan revert stage yang **menghapus artefak dokumen**.
- Domain `errors` — permukaannya sudah dicabut (SPEC-384/ADR-0092). Tool ini tak dibuat; ADR
  mencatat kenapa objective menyebutnya.

### 4.1 Deskripsi tool memuat jebakannya

Batasan brief: "sebut jebakan yang sudah diketahui langsung di deskripsi parameter". Yang wajib
masuk, karena tiap butir ini adalah 400/hasil salah yang terukur:

- `hanoman_backlog_create.payload` — tiga bentuk terpisah dan **enum `source` menentukan yang
  mana**. Skema memakai `oneOf` + `if/then` sehingga bentuk salah ditolak **oleh klien**, bukan
  oleh 400 server. `source` ∈ `brief|qa|audit|help|goal` (bukan `cross-audit` — dicabut).
- `hanoman_backlog_create` — jangan kirim `id`/`stage`/`objective`: id diturunkan server, stage
  selalu lahir `brainstorming`, objective diturunkan dari payload.
- `hanoman_backlog_search.startable` — tipe **boolean** di skema tool; wrapper menerjemahkannya ke
  string `"true"` dan **menghilangkan parameternya** saat `false`, sehingga jebakan "hanya `true`
  yang berpengaruh, sisanya diabaikan senyap" tak bisa lagi terjadi dari sisi agen.
- `hanoman_backlog_search.q` — dinyatakan mencari `id + title + objective`, **bukan** isi payload.
- `hanoman_backlog_update` — hanya sah selagi item **belum dimulai** (`stage=brainstorming` ∧
  `baseSha=null`); server menjawab 409 dan wrapper menerjemahkannya jadi kalimat yang menyebut
  syaratnya.
- `priority` ∈ `tinggi|sedang|rendah`; `severity` ∈ `critical|major|minor`.
- `from`/`to` = batas **hari** `YYYY-MM-DD`, inklusif di kedua ujung.

## 5. Ukuran balasan & paginasi

`GET /projects` mengembalikan puluhan kilobita. Dua lapis pertahanan:

1. **Pemadat per-tool (`shape()`).** Tool daftar mengembalikan subset field yang sudah dipilih:
   project → `{id, name, kind, desc, backlog, topStage, schedulerOptIn, leadOptIn}`; backlog →
   `{id, projectId, title, source, stage, priority, createdAt, startedAt, blockedBy}` dengan
   `objective` dipotong 200 char. **Field lengkap hanya di tool detail** (`hanoman_project_get`,
   `hanoman_backlog_get`).
2. **Plafon byte.** `page`/`limit` diteruskan ke `GET /specs`; tool tanpa paginasi server
   (`/projects`, `/notifications`, `/tickets`, issue GitHub, jejak lead) dipaginasi **di wrapper**
   dengan `limit` default 20, maks 100. Di atas itu, plafon keras `HANOMAN_MCP_MAX_BYTES`
   (default 24 KiB) memotong dan **menyisipkan penanda terbaca mesin**:
   `{"truncated": true, "shown": n, "total": m, "hint": "…"}` — bukan JSON terpotong di tengah.

## 6. Galat: kalimat yang bisa ditindaklanjuti, bukan dump HTTP

Fungsi murni `explainHttpError(status, body, ctx)`:

| Keadaan | Yang dikembalikan |
|---|---|
| `ECONNREFUSED` / `ENOTFOUND` | "tak ada hanoman di `<host>` — server belum jalan, atau HANOMAN_HOST salah." |
| **401** + `GET /health` menjawab 200 | "`<host>` hidup, tapi token ditolak. Token diterbitkan **per-instance** — token yang dibuat di instance lain akan selalu 401 di sini. Periksa juga master switch Settings → Akses AI Agent." |
| **401** + `/health` tak menjawab | "`<host>` bukan instance hanoman yang sehat." |
| **403** `{need}` | "kurang capability **`<need>`**. Manusia harus menambahkannya di Settings → Akses AI Agent pada token yang dipakai." |
| **403** `cookie session required` | "route ini sengaja hanya untuk sesi manusia; agent token tak akan pernah bisa. Jangan cari jalan lain." |
| **400** zod flatten | field + pesan per field, bukan objek mentah. |
| **404**/**409**/**422** | pesan server + syarat yang dilanggar. |
| lainnya | status + potongan **ekor** body (maks 500 char). |

Probe `/health` dilakukan **sekali** lalu di-cache; ia endpoint publik (`PUBLIC` di `app.ts`) jadi
tak butuh token — itulah yang membuat "host salah" bisa dibedakan dari "token salah".

## 7. Token tak pernah bocor

Tiga lapis, karena satu lapis pernah cukup untuk gagal (SPEC-472: argv memuat prompt, ikut ke pesan
galat):

1. **`redactToken()` dipasang di satu titik keluar** — setiap string yang menjadi hasil tool atau
   pesan galat melewatinya. Ia mengganti nilai token **dan** pola `hnm_agt_[0-9a-f]+` apa pun.
2. **Tak ada logging ke stdout.** stdout adalah kanal JSON-RPC; menulis ke sana merusak protokol.
   Diagnostik → stderr, dan stderr pun melewati redaksi.
3. **Snippet pasang di Settings memakai placeholder** `hnm_agt_…`, tak pernah token nyata — panel
   itu memang tak punya aksesnya (server hanya menyimpan sha256).

## 8. Konfigurasi & mode

| Sumber | Kunci |
|---|---|
| env | `HANOMAN_HOST`, `HANOMAN_AGENT_TOKEN`, `HANOMAN_MCP_READ_ONLY`, `HANOMAN_MCP_MAX_BYTES` |
| flag | `--host <url>`, `--read-only`, `--max-bytes <n>` |

Flag menang atas env. Token **hanya** dari env/berkas `~/.hanoman/agent-token` — tak pernah dari
flag, karena flag hidup di ARGV dan ARGV terbaca `ps` (pelajaran SPEC-402).

**Gagal-lunak saat start, jelaskan saat panggil.** Konfigurasi kurang (host/token kosong) **tidak**
mematikan proses: klien MCP menyembunyikan stderr, jadi proses yang mati hanya tampak sebagai
"server MCP gagal" tanpa sebab. Sebagai gantinya server tetap berdiri, `tools/list` tetap jalan, dan
setiap panggilan mengembalikan `isError` berisi kalimat yang menyebut variabel mana yang harus diisi
di config klien. `hanoman_about` sengaja bisa dipanggil tanpa token.

Mode baca-saja (`--read-only`) **menghapus** keempat tool tulis dari `tools/list` — bukan menolaknya
saat dipanggil. Tool yang tak terlihat tak bisa dicoba.

## 9. Versi skema tool

`MCP_TOOL_SCHEMA_VERSION = 1` di `shared/src/mcp.ts`. Kontraknya:

- **Aditif dalam satu versi**: menambah tool, menambah parameter opsional, memperluas deskripsi.
- **Menuntut naik versi**: mengganti/menghapus nama tool, menghapus parameter, membuat parameter
  yang tadinya opsional jadi wajib, mengubah bentuk hasil.

Ditegakkan test **snapshot katalog** (nama tool + daftar parameter wajib per tool). Perubahan yang
memutus klien lama tak bisa lolos tanpa seseorang sengaja memperbarui snapshot **dan** versinya.
Versinya dilaporkan `hanoman_about` dan disebut di `instructions` server MCP.

## 10. Settings — pemasangan siap salin

Kartu baru **"MCP server"** di tab **Akses AI Agent** (bersebelahan dengan master switch dan daftar
token, karena memasang dan memberi capability adalah satu pekerjaan manusia):

- pemilih klien: **Claude Code · Claude Desktop · Codex · Cursor/Copilot**, masing-masing dengan
  blok siap salin + tombol salin. Host diisi dari `window.location.origin`; token sebagai
  placeholder dengan pointer ke daftar token di kartu yang sama.
- sakelar **baca-saja** yang menambahkan `"--read-only"` ke `args` di snippet.
- tabel tool dari katalog `@hanoman/shared`: nama · mode (baca/tulis) · capability. Ini yang
  memberi tahu manusia capability mana yang perlu dicentang, dan tabelnya tak bisa basi karena
  sumbernya sama dengan runtime.

## 11. Penanganan galat, pengujian, batasan

**Uji unit (murni, tanpa I/O)** — katalog & bentuk skema, `explainHttpError` seluruh baris tabel §6,
`redactToken`, pemadat + plafon byte + penanda truncated, resolusi konfigurasi & precedence flag/env,
penerjemahan `startable`, penyaringan mode baca-saja.

**Uji kontrak di server** — kesesuaian `capability` katalog dengan `capabilityForRoute`, larangan
cookie-only, larangan `/terminal` non-GET & `/vps`.

**Uji integrasi** — MCP server di-drive lewat objek transport in-memory terhadap `fetch` palsu:
`initialize` → `tools/list` (17 vs 13 tool per mode) → `tools/call` sukses & gagal.

**Smoke nyata sekali di akhir** — boot server lokal di DB terpisah, buat agent token, jalankan
`node cli/dist/hanoman.js mcp` sungguhan, kirim `initialize` + `tools/list` + satu `tools/call`
lewat stdin/stdout, dan verifikasi 401/403 memberi kalimat yang benar.

**Batasan yang diterima sadar:**

- Tak ada `GET /specs/:id` di REST, jadi `hanoman_backlog_get` memakai `GET /specs?q=<id>` lalu
  mencocokkan `id` **persis** di wrapper. `q` adalah substring, jadi tanpa pencocokan persis
  `SPEC-48` akan mengembalikan `SPEC-480…489`.
- `hanoman_github_issues_list` membaca record lokal hasil tarikan (`GithubIssue`), bukan GitHub
  live; menariknya adalah `POST …/github/pull` yang sengaja tak diikutkan.
- Tak ada endpoint server baru, tak ada perubahan skema, tak ada migration.

## 12. Dokumen yang tersentuh

- **ADR-0099** (baru) — doc-of-record; ditaut di `internal/docs/README.md` **dan**
  `internal/docs/adr/README.md`.
- `docs/agent-integration.md` — mencabut kalimat "Tak ada SDK/MCP khusus (belum)"; bagian MCP baru.
- `internal/docs/architecture/api-contract.md` — catatan bahwa MCP adalah klien REST, bukan
  permukaan kedua.
- `internal/docs/operations/npm-readme.md`, `AGENTS.md`, `cli` `--help` — perintah `hanoman mcp`.
- `internal/skills/hanoman/SKILL.md` — butir arsitektur.
- `internal/docs/frontend/frontend-implementation.md` — kartu Settings baru.
