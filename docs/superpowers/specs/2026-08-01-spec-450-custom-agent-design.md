# SPEC-450 — Custom agent hanoman (global & per project, saling mention, anti-loop)

Tanggal: 2026-08-01 · Sumber: brief · Prioritas: tinggi · Branch: `hanoman/spec-450`

## Objective

1. Operator dapat menambahkan **custom agent** di hanoman — **global** (dipakai semua project) dan
   **per project** (hanya project itu).
2. Custom agent itu **dipakai oleh sesi claude & codex** yang dilahirkan hanoman.
3. Antar custom agent dapat **saling memanggil / mention** saat perlu.
4. **Tidak boleh ada infinite loop call.**

## Yang sudah terukur (bukan asumsi)

Semua diukur langsung pada biner di mesin ini sebelum desain dikunci.

| # | Probe | Hasil |
|---|---|---|
| M1 | `claude --agents '<json>'` (claude 2.1.220) | **Ada & bekerja.** Bentuk: `{"<name>":{"description","prompt","tools","model"}}`. Agen custom muncul di daftar subagent sesi. |
| M2 | Delegasi antar-subagent | **Bekerja** — `hnm-a` (ber-`tools:["Task","Read"]`) memanggil `hnm-b` dan mengembalikan `I-AM-B`. Tanpa `Task` di `tools`, agen **tak punya alat** untuk memanggil siapa pun. |
| M3 | `claude --agents '{not json'` | **exit 0, sesi jalan normal, NOL agen, tanpa satu pun pesan galat.** JSON rusak diabaikan **senyap**. |
| M4 | `tools:["Read","Write","Edit","Bash","Glob","Grep","WebFetch","WebSearch","Task","TodoWrite"]` | Agen melaporkan `Read, Write, Edit, Bash, WebFetch, WebSearch, Agent`. `Glob`/`Grep`/`TodoWrite` **dibuang senyap**; `Task` yang diminta hadir sebagai `Agent`. |
| M5 | `codex -c 'agent_roles.reviewer.bogus_field="x"'` (codex 0.146.0) | **exit 0, tanpa keluhan.** Codex menerima kunci `-c` yang tak dikenal secara diam-diam ⇒ "konfigurasinya diterima" **bukan bukti** ia dipakai. |
| M6 | `$GIT_DIR/info/exclude` di linked worktree | **Diabaikan git.** git hanya membaca `info/exclude` dari **common dir**; berkas yang ditulis ke worktree pasti muncul di `git status`. |

**Konsekuensi desain langsung:**

- M1+M2 ⇒ claude punya mekanisme custom agent **native, per-invokasi, tanpa berkas**. Ini padanan
  persis `--settings` yang sudah dipakai hanoman (`runner/src/agent-cli.ts`).
- M2 ⇒ **`Task` di `tools` adalah gerbang fisik delegasi.** Agen tanpa `Task` **tak bisa** memanggil
  siapa pun — ini alat anti-loop yang nyata, bukan prosa.
- M3+M4+M5 ⇒ ketiga permukaan **gagal-senyap**. Verifikasi wajib menanyai agen apa yang **benar-benar
  ia miliki**, bukan memeriksa exit code (kelas jebakan yang sama dengan `paneText.includes("/goal")`
  di ADR-0085).
- M5 ⇒ `agent_roles` codex **tidak dipakai**. Tak ada konvensi custom-agent codex yang bisa
  diverifikasi hari ini.
- M6 ⇒ **nol berkas ditulis ke worktree.** Definisi mengalir lewat argv/prompt saja.

## Keputusan manusia (ditanya & dijawab di sesi ini)

1. **Mekanisme** = *native + kontrak prompt (ringan)*. Tanpa endpoint invoke, tanpa titik spawn agen
   ketiga. (`services/lead/brain.ts` tetap satu-satunya titik spawn di luar `pty.ts` — SPEC-448.)
2. **Penyimpanan** = **model DB baru, ikut sync**.

## Arsitektur

```
                    ┌──────────────────────────────────────────┐
   UI Settings ───► │ POST/PATCH/DELETE /api/custom-agents     │
   UI Project  ───► │  · nama immutable · mentions allowlist   │
                    │  · 409 bila menutup SIKLUS               │
                    └───────────────┬──────────────────────────┘
                                    │ tulis + invalidate cache
                    ┌───────────────▼──────────────────────────┐
                    │ services/custom-agents.ts                │
                    │  cache in-memory  ·  agentsFor(projectId)│  ← SINKRON
                    └───────────────┬──────────────────────────┘
                                    │ registerCustomAgentSource()
                    ┌───────────────▼──────────────────────────┐
                    │ pty.ts createSession()  (titik cekik)    │
                    │  claude → --agents "$(cat <file>)"       │
                    │  codex  → blok roster ditempel ke prompt │
                    └──────────────────────────────────────────┘
```

### 1. Data — `CustomAgent` (ADR-0094, migration tulis tangan)

```prisma
model CustomAgent {
  id           String   @id           // "<projectId|global>:<name>" — DETERMINISTIK
  projectId    String?                // null = GLOBAL
  name         String                 // slug [a-z][a-z0-9-]*, IMMUTABLE
  description  String                 // "kapan agen ini dipakai" — dibaca claude untuk memilih
  instructions String                 // system prompt agen
  tools        Json?                  // array nama tool; null = DEFAULT_AGENT_TOOLS
  model        String?                // null = warisi model sesi
  mentions     Json?                  // array nama agen yang BOLEH dipanggil; null/[] = daun
  enabled      Boolean  @default(true)
  version      Int      @default(0)   // sync (ADR-0045)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  project      Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, name])
  @@index([projectId])
}
```

**Kenapa `id` deterministik, bukan cuid.** Ini baris yang **disync**. Dengan cuid, mesin A dan mesin B
yang sama-sama membuat agen global bernama `reviewer` melahirkan **dua baris berbeda** yang keduanya
menyeberang; keduanya lalu masuk ke satu objek JSON `--agents` yang **berkunci nama**, jadi salah satu
hilang tanpa jejak. Dengan `id = "<scope>:<name>"` keduanya adalah **baris yang sama** dan mesin
konflik LWW/`SyncConflict` (ADR-0067) yang sudah ada menanganinya. Ini kelas bug "tabrakan id menimpa
senyap" yang sudah pernah memakan korban di repo ini.

**Kenapa `name` immutable.** Changefeed sync **tidak punya operasi hapus** (`SyncLog` upsert-only).
Rename yang mengubah `id` akan meninggalkan baris yatim di setiap mesin lain. `PATCH` menolak
perubahan `name` dengan 400; ganti nama = hapus + buat baru, keputusan sadar operator. Sejalan dengan
`Spec.id` & `Project.id` yang juga kekal.

**Gotcha SQLite yang wajib diketahui:** pada indeks unik SQLite, **NULL saling berbeda**, jadi
`@@unique([projectId, name])` **tidak** mencegah dua agen global bernama sama. Yang benar-benar
mencegahnya adalah **PK deterministik** di atas; indeks unik itu tinggal jaring kedua untuk baris
ber-project. Jangan pernah mengandalkan indeks itu sendirian.

**Sync:** `SYNCED` += `"customAgent"`, `FIELDS.customAgent = ["projectId","name","description",
"instructions","tools","model","mentions","enabled","createdAt","updatedAt"]`,
`DATE_FIELDS.customAgent = ["createdAt","updatedAt"]`, dan **`PG_ORDER`** di
`cli/src/commands/migrate-pg.ts` (test DMMF merah kalau lupa).

### 2. Resolusi scope — `services/custom-agents.ts`

`effectiveAgents(projectId)` = agen **global** ∪ agen **project**, di mana agen project dengan nama
sama **menimpa** global. Hanya `enabled`. Hasilnya di-cache di memori.

Cache **wajib sinkron** karena `createSession` sinkron dan Prisma tidak. Pola yang sama sudah dipakai
`effectiveStr()` (config runtime, ADR-0049). Titik invalidasi: setiap mutasi route **dan** `applyPush`
sync. Gagal baca → **daftar kosong**, tak pernah menggagalkan kelahiran sesi.

`pty.ts` tetap **nol dependensi DB**: ia memanggil sumber yang mendaftarkan diri
(`registerCustomAgentSource(fn)`, cermin `registerSessionHooks`/`registerSchedulerSource`). Karena ia
dipasang di titik cekik `createSession`, **tak ada satu pun call site yang perlu diubah dan tak ada
yang bisa lupa memasangnya** — ini persis pelajaran `GovernorDeps.blockers` (ADR-0093) dan
`UNSTARTED_SPEC_WHERE` (SPEC-431): predikat yang disalin adalah predikat yang akan menyimpang.

Sesi yang **tidak** menerima custom agent: `opts.command` (shell mentah ADR-0056, konsol VPS) — tak
ada agen di sana sama sekali.

### 3. Materialisasi per agen

**claude — `--agents`.** JSON dirakit fungsi murni di `runner/src/custom-agents.ts`:

```ts
renderAgentsJson(defs: CustomAgentDef[]): string   // {} bila kosong → flag tak dipasang
resolveTools(def): string[]                        // lihat anti-loop lapis 2
```

Ukurannya bisa besar (instruksi = prosa). tmux membatasi **satu** command ±16 KB dan itu sudah pernah
mematikan sesi (SPEC-223) — jadi JSON ditulis ke berkas lalu diserahkan sebagai
`--agents "$(cat <file>)"`, **persis jalur `promptArg` yang sudah ada**: di-expand `sh -c` saat sesi
lahir, hasil command-substitution dikutip ganda sehingga tak dipindai ulang shell (aman dari injeksi),
dan panjangnya dibatasi `ARG_MAX`, bukan 16 KB. Konsekuensi implementasi: flag ini **tidak** boleh
lewat `.map(sq)` seperti flag lain — ia disisipkan seperti `promptArg`.

**codex — blok roster di prompt.** Codex 0.146 tak punya padanan yang bisa diverifikasi (M5), jadi
hanoman memakai kanal yang memang miliknya sendiri: satu blok yang ditempel ke **akhir prompt sesi**
(fungsi murni `agentRosterBlock(defs)` di runner), berisi nama · deskripsi · instruksi · daftar
`mentions` tiap agen. Codex **mengadopsi peran secara inline**, tak melahirkan proses.

**Asimetri ini disengaja dan dinyatakan terbuka**, bukan disembunyikan: untuk claude custom agent
adalah subagent sungguhan dengan isolasi konteks; untuk codex ia adalah persona yang tersedia di
konteks yang sama. Konsekuensi baiknya: **risiko loop di codex secara struktural nol** (tak ada
pemanggilan). Sesi codex tanpa prompt tak mendapat roster — dan itu hanya terjadi pada sesi yang
memang tak berprompt.

### 4. Anti-loop — tiga lapis, dari keras ke lunak

**Lapis 1 — graf mention wajib ASIKLIK (data, ditegakkan server).**
`mentions` hanya boleh menyebut agen yang terlihat dari scope-nya: agen **global** hanya boleh
menyebut agen global; agen **project** boleh menyebut agen project & global. Nama tak dikenal → **400**
(cermin `dependsOn`, ADR-0093).
Setiap mutasi menjalankan `detectCycle()` (fungsi murni di `@hanoman/shared`) atas **graf efektif**,
dan bila menutup siklus → **409** berikut jalur siklusnya.

> **Gotcha yang mengikat:** memeriksa graf global saja **tidak cukup.** Agen project boleh menimpa
> nama global, jadi `G→H` yang aman di scope global bisa menjadi `G→H(project)→G` di dalam satu
> project. Karena itu validasi berjalan atas **scope global DAN setiap project yang punya custom
> agent**, dan pesan 409 menyebut scope mana yang pecah.

**Lapis 2 — kapabilitas (argv, fisik).**
Terukur di M2: delegasi butuh `Task`. Maka `resolveTools()`:

| `mentions` | `tools` operator | yang dikirim ke `--agents` |
|---|---|---|
| kosong | kosong | `DEFAULT_AGENT_TOOLS` (**tanpa `Task`**) |
| kosong | diisi | tools operator **dikurangi `Task`** |
| berisi | kosong | `DEFAULT_AGENT_TOOLS` + `Task` |
| berisi | diisi | tools operator + `Task` |

Artinya **agen daun tak punya alat untuk memanggil siapa pun** — bukan janji, tapi ketiadaan alat.
`Task` yang diketik operator sendiri **dicabut** bila `mentions` kosong: allowlist yang menang, bukan
daftar tool. hanoman **selalu** memancarkan `tools` eksplisit; membiarkannya kosong berarti agen
mewarisi seluruh tool termasuk `Task`, dan lapis ini lenyap.

`DEFAULT_AGENT_TOOLS` adalah **KONSTANTA MODUL, bukan konfigurasi** (pola `LEAD_ACTIONS`, ADR-0091).
Aman terhadap M4: nama tool yang tak dikenal versi claude **dibuang senyap**, dan membuang hanya
**mengurangi** kemampuan — tak pernah memberikan `Task`. Jadi konstanta yang sedikit basi tetap
fail-safe.

**Lapis 3 — anggaran hop (prosa, pertahanan berlapis).**
Instruksi tiap agen diakhiri satu paragraf: siapa yang boleh ia panggil, dan anggaran hop
`MENTION_MAX_HOPS = 3`. Ini **bukan** jaminan — jaminannya lapis 1 & 2 — tapi ia yang membuat agen
melapor alih-alih memanggil lagi saat anggarannya habis. Pelajaran SPEC-432 dipakai di sini:
**agen berbatas wajib diberi tahu batasnya**; agen yang tak tahu anggarannya membakar seluruh anggaran
itu tanpa hasil.

### 5. API

`/api/custom-agents` — domain capability **baru** `agents`, dipetakan **menurut method**
(`rw("agents")`), bukan prefix. Ini kelas bug SPEC-405: `GLOBAL_READ` yang meloloskan endpoint tulis
karena prefix-nya kebetulan sama.

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/custom-agents?projectId=<id>` | tanpa query → global saja; `?projectId=` → **efektif** (global+project, ditandai `inherited`) |
| `POST` | `/api/custom-agents` | body `{projectId?, name, description, instructions, tools?, model?, mentions?, enabled?}` → 201 · 400 nama/rujukan · 409 duplikat/siklus |
| `PATCH` | `/api/custom-agents/:id` | `name` ditolak 400 · 409 siklus |
| `DELETE` | `/api/custom-agents/:id` | mencabut namanya dari `mentions` agen lain (cermin `DELETE /specs/:id` ADR-0093) supaya tak ada rujukan yatim |

`:id` memuat titik dua (`global:reviewer`) — sah di segmen path RFC 3986.

### 6. UI

Satu komponen `CustomAgentsPanel({ projectId })` dipakai **dua** permukaan:

- **Settings → tab "Custom agent"** — `projectId = null`, mengelola agen global.
- **Project detail** — `projectId = <id>`, mengelola agen project; agen global tampil **read-only**
  bertanda "warisan global" supaya operator tak pernah bertanya "lalu yang global mana".

Kartu per agen: nama · deskripsi · toggle enabled · editor instruksi · pemilih `mentions` (checkbox
dari agen yang terlihat) · daftar `tools` **hasil resolusi** (jadi efek "Task dicabut" terlihat, bukan
tersembunyi). Siklus ditolak di server; UI menampilkan jalur siklusnya apa adanya.

Design system: editorial / bone paper / brass accent. Kartu yang memuat pane bergulir memakai
`<Card fill>` (SPEC-393), bukan `style`.

## Testing

Berlapis, dan **setiap lapis menargetkan satu kegagalan-senyap yang terukur**:

1. **Murni (shared)** — `detectCycle` (siklus langsung, tak langsung, self, lintas scope global↔project),
   validasi slug nama, `resolveTools` (empat baris tabel di atas, plus pencabutan `Task` yang diketik
   operator).
2. **Murni (runner)** — `renderAgentsJson` (bentuk `{name:{description,prompt,tools,model}}`, kosong →
   flag tak dipasang, karakter yang harus lolos JSON), `agentRosterBlock` (roster codex memuat nama +
   mentions).
3. **Server** — CRUD, 400 rujukan tak dikenal, 409 duplikat & siklus (**termasuk kasus lintas scope**),
   `effectiveAgents` (project menimpa global), pencabutan mention saat delete, invalidasi cache,
   capability `agents` per method.
4. **pty (kontrak argv)** — argv sesi claude memuat `--agents "$(cat …)"` dan berkasnya berisi JSON
   yang benar; sesi codex **tidak** memuat flag itu tapi prompt-nya memuat roster; sesi `opts.command`
   tak memuat keduanya. Diperiksa lewat **argv pane tmux**, bukan bentuk respons — assert bentuk
   respons lulus palsu (pelajaran `sessionModel()`).
5. **Verifikasi hidup (sekali, di akhir)** — spawn sesi claude sungguhan dan **tanyakan agen apa yang
   benar-benar ia miliki**. M3 membuat ini wajib: `--agents` ber-JSON rusak keluar dengan exit 0 dan
   nol agen, jadi hijau & merah **tak terbedakan** dari sisi proses.

Scope verifikasi sesi ini `changed` (ADR-0080): jalankan test yang tersentuh, typecheck per paket.

## Yang TIDAK dibangun (YAGNI, sadar)

- **Tanpa endpoint `invoke` dan tanpa titik spawn agen ketiga.** Keputusan operator; `lead/brain.ts`
  tetap satu-satunya di luar `pty.ts` (SPEC-448).
- **Tanpa `agent_roles` codex.** M5 membuktikan codex menerima kunci `-c` tak dikenal secara diam-diam,
  jadi ia tak bisa diverifikasi hari ini. Bila codex kelak mendokumentasikannya, adapter codex tinggal
  ditukar — `agentRosterBlock` sudah jadi batas yang jelas.
- **Tanpa berkas apa pun di worktree** (M6).
- **Tanpa rename agen** (changefeed tak punya operasi hapus).
- **Tanpa marketplace/impor definisi**, tanpa versioning definisi, tanpa metrik pemakaian per agen.

## Dampak docs

- **ADR-0094** — Custom agent hanoman: katalog di DB, materialisasi native per agen, anti-loop
  berlapis. Ditaut di `internal/docs/README.md` **dan** `internal/docs/adr/README.md` (SPEC-386).
- `internal/docs/architecture/data-model.md` — model `CustomAgent` + jebakan NULL unik SQLite.
- `internal/docs/architecture/api-contract.md` — `/api/custom-agents` + capability `agents`.
- `internal/skills/hanoman/SKILL.md` — butir custom agent + keenam gotcha terukur.
- `docs/agent-integration.md` — domain capability baru.
