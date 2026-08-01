# SPEC-484 — Form Custom Agent berbasis katalog: dropdown tools/model/mention + runtime claude|codex

- Tanggal: 2026-08-01
- Sumber: brief, prioritas tinggi
- ADR yang lahir: **ADR-0101** (memperluas [ADR-0094](../../../internal/docs/adr/0094-custom-agent-katalog-materialisasi-native.md))
- Menyentuh skema: **ya** (`CustomAgent.runtime`) → migration + ADR wajib

## Konteks

Form Custom Agent (`src/src/screens/CustomAgentsPanel.tsx`, SPEC-450) masih memakai **teks bebas**
untuk tiga field yang sebenarnya punya sumber data pasti:

| Field | Kontrol hari ini | Sumber data yang sebenarnya ada |
|---|---|---|
| Tools | `<Input>` koma-terpisah → `parseTools()` | `DEFAULT_AGENT_TOOLS` (shared) + MCP server di konfigurasi |
| Model | `<Input>` mono, bebas | `MODELS` (claude) & `CODEX_MODELS` (codex) di `shared/src/entities.ts` |
| Mention | daftar `<Checkbox>` datar | `GET /custom-agents?projectId=` (sudah dipanggil panel) |
| Runtime | **tak ada** | — |

Akibatnya salah ketik baru ketahuan saat agen dijalankan, dan kegagalannya **senyap**: ADR-0094 M4
sudah mengukur bahwa claude **membuang nama tool tak dikenal tanpa satu pun pesan**. Operator yang
mengetik `read, bash` (huruf kecil) mendapat agen **tanpa alat apa pun** — exit 0, sesi jalan, tak
ada keluhan. Model pun sama: `Setting.model` di tempat lain sudah punya picker, tapi di sini masih
diketik tangan.

Field keempat belum ada sama sekali: **runtime**. hanoman punya dua mesin sesi (ADR-0074) dan
materialisasi custom agent **berbeda** di antara keduanya — claude mendapat subagent sungguhan
lewat `--agents`, codex mendapat blok roster prosa yang diadopsi inline. Persona yang ditulis untuk
salah satu mesin hari ini tetap disodorkan ke keduanya.

## Keputusan yang diambil bersama operator

Tiga percabangan yang mengubah bentuk kerja ditanyakan lebih dulu; jawabannya mengikat desain ini:

1. **`runtime` adalah PENYARING, dengan opsi warisi.** Kolom nullable: `null` = "ikut sesi induk"
   (dipakai sesi claude **maupun** codex — persis perilaku hari ini, jadi seluruh baris lama aman
   tanpa backfill); `"claude"` = hanya dimaterialisasi di sesi claude; `"codex"` = hanya di sesi
   codex.
2. **MCP masuk katalog pada tingkat SERVER** (`mcp__<server>__*`), ditemukan dari berkas
   konfigurasi. Menyambung ke tiap server untuk mendapat nama tool aslinya berarti melahirkan
   proses baru dari server hanoman — arah yang ditolak ADR-0094 dan pelajaran SPEC-448.
3. **Validasi server KERAS untuk semua field.** Nilai di luar katalog ditolak `400` saat simpan.
   Chip invalid di UI karena itu hanya untuk baris **lama** yang sudah terlanjur tersimpan — ia
   dibaca & ditampilkan, tapi tak bisa disimpan ulang apa adanya.

## Arsitektur

Empat lapis, masing-masing punya satu tugas:

```
shared/src/agent-catalog.ts   kontrak murni: AGENT_RUNTIMES · ALL_TOOLS · BUILTIN_AGENT_TOOLS
                              · modelsForRuntime() · expandTools()          (nol I/O)
        ↑                                   ↑                        ↑
server/src/services/            server/src/routes/            src/src/screens/
  agent-tool-catalog.ts           custom-agents.ts              CustomAgentsPanel.tsx
  (temukan MCP server dari        (GET …/catalog + validasi     (4 dropdown, chip,
   berkas konfigurasi)             keras di POST/PATCH)          pencarian)
        ↓
server/src/services/custom-agents.ts
  agentDefsFor(projectId, agent) — menyaring runtime + meng-EXPAND `*`
        ↓
server/src/services/pty.ts  createSession  (titik cekik, ADR-0094 keputusan 7)
```

### 1. `shared/src/agent-catalog.ts` — kontrak murni (baru)

```ts
export const AGENT_RUNTIMES = ["claude", "codex"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];
export const zAgentRuntime = z.enum(AGENT_RUNTIMES);

/** Pintasan "semua tools". Disimpan sebagai `tools: ["*"]`, BUKAN `null`. */
export const ALL_TOOLS = "*";

export type AgentToolInfo = { id: string; label: string; group: "builtin" | "mcp" | "shortcut" };

/** Katalog tool bawaan = PERSIS `DEFAULT_AGENT_TOOLS`. Satu sumber, bukan dua daftar. */
export const BUILTIN_AGENT_TOOLS: AgentToolInfo[];

/** Nama server MCP → entri katalog `mcp__<server>__*`. */
export function mcpToolEntry(server: string): AgentToolInfo;

/** Model yang sah untuk sebuah runtime. `null` (warisi) → GABUNGAN keduanya. */
export function modelsForRuntime(rt: AgentRuntime | null): { id: string; label: string; runtime: AgentRuntime }[];

/** `["*"]` → seluruh id katalog. Selain itu apa adanya. Idempoten. */
export function expandTools(tools: string[] | null, catalog: string[]): string[] | null;
```

`resolveTools()` yang sudah ada **tidak berubah tanda tangannya** — ekspansi `*` terjadi sebelum ia
dipanggil, di `agentDefsFor()` (server) dan di panel (UI, dengan katalog dari endpoint). Alasannya:
`runner/src/custom-agents.ts` harus tetap murni dan tak boleh tahu apa pun tentang MCP.

**Kenapa katalog bawaan = `DEFAULT_AGENT_TOOLS` dan tidak lebih.** ADR-0094 M4 mengukur `TodoWrite`
dibuang senyap; menambah nama yang belum diukur ke katalog berarti menawarkan pilihan yang **tidak
melakukan apa-apa** — persis kelas kegagalan yang spec ini mau tutup. Memperluasnya kelak adalah
perubahan satu baris, setelah diukur.

### 2. `server/src/services/agent-tool-catalog.ts` — penemuan MCP (baru)

`mcpServerNames(repoDir?: string): string[]` membaca **tiga** sumber, semuanya **gagal-terbuka**
(berkas hilang/rusak → sumber itu dilewati, bukan 500):

| Sumber | Yang dibaca |
|---|---|
| `~/.claude.json` | `.mcpServers` (global) **dan** `.projects[<repoDir>].mcpServers` |
| `<repoDir>/.mcp.json` | `.mcpServers` |
| `~/.codex/config.toml` | nama seksi `[mcp_servers.<name>]` (regex, tanpa dependensi TOML) |

Terukur di mesin ini (2026-08-01): `~/.claude.json` memuat 6 server global
(`web-reader`, `zai-mcp-server`, `web-search-prime`, `zread`, `gitnexus`, `context7`) plus entri
per-path — jadi sumbernya nyata, bukan hipotetis.

`agentToolCatalog(repoDir?)` → `[{id:"*",group:"shortcut"}, ...BUILTIN, ...mcp]`, nama server
di-dedup & diurutkan agar deterministik.

**Kenapa gagal-terbuka.** Katalog agen tak pernah boleh menggagalkan apa pun (ADR-0094 keputusan 7).
Konsekuensinya diterima sadar: `~/.claude.json` yang tak terbaca membuat katalog menyusut ke tool
bawaan, dan validasi keras akan menolak nilai MCP yang sebenarnya sah. Itu terlihat operator (pesan
menyebut nama yang ditolak), bukan senyap.

### 3. Skema + validasi

**Migration `20260801230000_custom_agent_runtime`** — `ALTER TABLE "CustomAgent" ADD COLUMN
"runtime" TEXT;` Kolom **nullable tanpa default** → baris lama tetap `NULL` = "ikut sesi induk",
jadi tak ada satu pun perilaku yang berubah untuk katalog yang sudah ada. Ditulis tangan lalu
`migrate deploy` (bukan `migrate dev`, yang me-reset di bawah drift worktree tetangga).

`runtime` **wajib** ditambahkan ke `FIELDS.customAgent` di `server/src/services/sync.ts` —
ADR-0094 gotcha 7: `upsert` yang tak menyebut kolom ber-default **tetap berhasil**, jadi kolom yang
terlewat menyeberang sebagai default palsu **tanpa satu pun error**.

**Endpoint baru** `GET /api/custom-agents/catalog?projectId=<id>` → capability `agents:read`
(dipetakan menurut method — `capabilityForRoute` sudah begitu untuk prefix ini):

```jsonc
{
  "tools":    [{ "id": "*", "label": "Semua tools", "group": "shortcut" }, …],
  "models":   [{ "id": "claude-opus-5", "label": "Opus 5", "runtime": "claude" }, …],
  "runtimes": [{ "id": "claude", "label": "Claude Code" }, { "id": "codex", "label": "Codex CLI" }]
}
```

Daftar **mention** sengaja **tidak** ada di sini: panel sudah memanggil
`GET /custom-agents?projectId=` dan himpunan efektifnya (dengan aturan project-menimpa-global) hidup
di sana. Dua sumber untuk satu daftar adalah cara dua daftar mulai berbeda.

**Validasi keras di `POST`/`PATCH`**, dijalankan **hanya atas field yang ADA di payload** — ini
yang menjaga `PATCH {enabled:false}` pada baris lama tetap bekerja:

| Field | Aturan | Penolakan |
|---|---|---|
| `runtime` | `zAgentRuntime.nullable()` | `400 { error, field:"runtime" }` |
| `tools` | tiap entri ∈ katalog; `"*"` harus **satu-satunya** entri | `400 { error, unknownTools: [] }` |
| `model` | ∈ `modelsForRuntime(runtime efektif)` | `400 { error, model, runtime }` |
| `mentions` | tak dikenal / bersiklus (sudah ada) | `400 { unknown }` · `409 { scope, cycle }` |

`model` divalidasi juga saat **hanya `runtime` yang berubah** — menukar runtime bisa membuat model
tersimpan jadi tak sah, dan menerimanya diam-diam mengembalikan bug yang spec ini tutup.

### 4. Materialisasi — penyaring runtime

`registerCustomAgentSource` berubah tanda tangan: `(projectId, agent) => AgentDef[]`.
`agentDefsFor(projectId, agent)` menyaring `r.runtime == null || r.runtime === agent`, lalu
meng-expand `*` memakai katalog project itu.

Di `pty.ts` panggilannya jadi `customAgentsFor(projectId, agentForDefs)` — `agentForDefs` sudah
dihitung di sana (baris ~305) untuk memutuskan roster codex. **Satu titik**, sesuai ADR-0094
keputusan 7; tak ada call site lain yang perlu tahu.

### 5. UI

**Komponen DS baru `MultiSelect`** (`src/src/ds/components/forms.tsx`, diekspor dari `ds/index.ts`):
chip untuk yang terpilih (masing-masing ber-tombol ×), tombol pembuka, dan saat terbuka sebuah
`<input>` pencarian + daftar opsi ber-`role="option"`. **Tanpa portal/popover** — daftarnya inline
di bawah kontrol. Alasan: portal butuh outside-click & focus-trap, dan panel ini bukan tempat untuk
membayar itu; inline juga membuatnya bisa diuji lewat `getByRole` alih-alih menembak `<span>` di
dalam `<label>` seperti `Checkbox`/`Switch` DS (jebakan SPEC-299/360/447).

Chip untuk nilai yang **tidak ada di katalog** dirender ber-tone `warn` + judul "tak ada di
katalog"; tombol Simpan **dinonaktifkan** selama masih ada chip invalid, dengan satu `Callout` yang
menyebut nilainya. Itu terjemahan jujur dari "validasi keras": nilai lama tetap terbaca, tapi tak
bisa disimpan ulang apa adanya.

**Empat field:**

| Field | Kontrol | Default |
|---|---|---|
| Tools | `MultiSelect` (cari + chip), opsi `Semua tools (*)` di paling atas | kosong = `DEFAULT_AGENT_TOOLS` |
| Model | DS `Select` | `Ikut sesi induk` (`""` → `null`) |
| Mention | `MultiSelect` (cari + chip) | kosong |
| Runtime | DS `Select` | `Ikut sesi induk` (`""` → `null`) |

Memilih `Semua tools (*)` **mengosongkan** pilihan lain dan sebaliknya — cerminan aturan server
"`*` harus satu-satunya entri", ditegakkan di kontrol supaya operator tak pernah bisa menyusun
kombinasi yang akan ditolak.

Daftar model **menyusut mengikuti runtime**: `claude` → `MODELS`, `codex` → `CODEX_MODELS`,
warisi → keduanya (ber-label grup). Menukar runtime yang membuat model terpilih jadi tak sah
**mengosongkan** model dan menampilkan catatan — bukan mengirim kombinasi yang pasti 400.

Kartu daftar agen menampilkan pil runtime (`claude` / `codex`; warisi tak menampilkan apa-apa) di
samping badge yang sudah ada.

## Aliran data

```
buka panel ──► GET /custom-agents?projectId   (baris + daftar mention)
          └──► GET /custom-agents/catalog?projectId   (tools + models + runtimes)

simpan ──► POST/PATCH ──► validasi keras (bentuk zod → katalog → rujukan mention → siklus)
                     └──► loadCustomAgents()  (cache di-refresh: tanpa ini sesi berikutnya
                                               memakai katalog basi, dan gejalanya senyap)

sesi lahir ──► createSession(projectId, cwd, {agent}) 
           └──► customAgentsFor(projectId, agent)
                 ├── saring runtime (null | == agent)
                 ├── expand "*" dengan katalog project
                 └── claude → renderAgentsJson | codex → agentRosterBlock
```

## Penanganan galat

- **Katalog gagal dibaca** (`~/.claude.json` rusak, HOME tak terbaca) → sumber itu dilewati,
  katalog menyusut ke tool bawaan. Tak pernah 500, tak pernah menggagalkan kelahiran sesi.
- **Nilai tak dikenal saat simpan** → 400 yang **menyebut nilainya** (`unknownTools`, `model`).
  `errorText()` di panel diperluas untuk menerjemahkannya jadi kalimat Indonesia.
- **Baris lama ber-nilai tak dikenal** → tetap dikembalikan `GET` apa adanya, ditandai chip
  invalid, Simpan terkunci sampai operator membuang chip itu.
- **`runtime` tak dikenal dari sync** (client versi lebih baru) → dibaca defensif seperti kolom
  `Json` lain: nilai di luar `AGENT_RUNTIMES` diperlakukan sebagai `null` (warisi) di lapis
  materialisasi, bukan menyaring habis seluruh roster.

## Testing

| Lapis | Berkas | Yang diuji |
|---|---|---|
| shared | `shared/src/agent-catalog.test.ts` | `expandTools` (`["*"]`→katalog, idempoten, `null` apa adanya), `modelsForRuntime` (claude/codex/gabungan), `resolveTools` sesudah ekspansi tetap mencabut `Task` |
| server | `server/test/agent-tool-catalog.test.ts` | penemuan MCP dari tiga sumber (tmp HOME), dedup, urutan, gagal-terbuka atas JSON rusak |
| server | `server/test/custom-agents.route.test.ts` (perluas) | `GET …/catalog`; 400 tools/model/runtime tak dikenal; `"*"` bercampur ditolak; `PATCH {enabled}` pada baris ber-nilai lama **tetap 200** |
| server | `server/test/custom-agents.pty.test.ts` (perluas) | penyaring runtime: agen `codex` tak muncul di argv sesi claude & sebaliknya; `null` muncul di keduanya; `["*"]` ter-expand di JSON `--agents` |
| server | `server/test/custom-agent-sync.test.ts` (perluas) | `runtime` ada di `FIELDS.customAgent` & menyeberang `applyPush` |
| web | `src/test/custom-agents-panel.test.tsx` (perluas) | tools/mention lewat `MultiSelect` (pencarian + chip), `*` saling meniadakan, model menyusut mengikuti runtime, chip invalid + Simpan terkunci |
| web | `src/test/ds-multiselect.test.tsx` | komponen DS sendiri: filter pencarian, toggle, hapus chip, `aria-label` |

Smoke nyata sekali di akhir (task menyentuh endpoint): boot server di DB & port khusus, `curl`
`GET /custom-agents/catalog`, `POST` yang sah, `POST` yang ditolak 400.

## Docs yang tersentuh

- **Baru** `internal/docs/adr/0101-form-custom-agent-katalog-runtime.md`
- `internal/docs/README.md` (daftar ADR) + `internal/docs/adr/README.md` (narasi)
- `internal/docs/architecture/data-model.md` (kolom `runtime`)
- `internal/docs/architecture/api-contract.md` (endpoint katalog + validasi keras)
- `internal/docs/design-system/design-system.md` (komponen `MultiSelect`)
- `internal/skills/hanoman/SKILL.md` (butir custom agent)

## Yang SENGAJA tidak dikerjakan

- **Tool MCP tingkat-tool.** Butuh menyambung ke tiap server = titik spawn baru (ditolak ADR-0094).
- **Runtime yang benar-benar menjalankan biner berbeda per agen.** Custom agent claude adalah
  subagent **di dalam proses yang sama**; melahirkan codex dari dalam sesi claude adalah titik spawn
  ketiga, dan setiap pelajaran spawn di repo ini harus dibayar ulang di tiap titik (SPEC-448).
- **Rename agen.** Tetap "hapus lalu buat baru" (ADR-0094 keputusan 2).
- **Katalog tool yang lebih luas dari `DEFAULT_AGENT_TOOLS`.** Menunggu pengukuran, bukan ingatan.
