# Design — Konfigurasi Runtime via Settings (SPEC-215)

> Asal: permintaan "tambahkan di client side untuk input device token dari server hanoman", diperluas menjadi
> "semua .env yang bukan credential harus bisa di-setting via setting". Deliverable ini = spec teknis
> kontrak untuk plan + execute. Nomor ADR-0049 & SPEC-215 provisional — verifikasi lintas-branch saat commit
> (catatan memori: tabrakan nomor ADR/SPEC di worktree sibling).

## Ringkasan arsitektur

Satu **resolver konfigurasi terpusat** menggantikan pembacaan `process.env.*` yang tersebar. Nilai efektif
tiap knob = **override DB → variabel env → default registry**. Operator lokal mengatur knob non-bootstrap
lewat layar Settings (same-origin, cookie-authed ke instance lokalnya sendiri); nilai tersimpan di store
local-only (tak pernah disync) dan berlaku **live** bila knob mendukung.

Ini sebagian menggantikan keputusan SPEC-213 **OQ-4** (yang menaruh `SYNC_SERVER_URL`/`SYNC_DEVICE_TOKEN`
sebagai env-only sisi-server). Sekarang: config sync (dan knob lain) boleh diatur runtime via DB; **env tetap
jadi fallback bootstrap** sehingga instance yang di-provision lewat env tetap jalan tanpa perubahan. Browser
tetap same-origin — **secret tak pernah balik plaintext** ke browser.

Permintaan awal (input device token sisi client) terpenuhi sebagai **satu entri registry** ber-`kind: secret`
di grup `sync`, memakai pola termask yang sama seperti semua kredensial lain.

## Keputusan desain (dari brainstorming)

| Topik | Keputusan |
|---|---|
| Cakupan | Semua env non-bootstrap dapat diatur via Settings: knob non-kredensial (plain) + kredensial (termask). |
| Presedensi | **DB menang** atas env; env = fallback bootstrap; default registry = fallback terakhir. |
| Bootstrap | `DATABASE_URL`, `TEST_DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV` **env-only**, ditampilkan read-only (info nilai efektif; connection string dimask). Tak bisa diedit — menghindari chicken-egg (config store ada di dalam DB) & bind/port yang butuh restart penuh. |
| Kredensial | `SYNC_DEVICE_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` — settable via pola secret termask (plaintext-at-rest, GET balik `••••1234`, blank = pertahankan, DELETE = clear). |
| Berlaku | `live` (dibaca ulang otomatis), `new-session` (hanya proses claude/SSH baru), `restart` (perlu boot ulang, UI beri catatan). |
| Storage | Model Prisma baru `RuntimeConfig` (local-only KV, tak pernah disync — seperti `SyncState`/`LocalBinding`). |
| Registry | Satu daftar entri di `shared/` sebagai sumber tunggal untuk validasi (server) & render (web). |
| UI | Tab Settings baru **"Konfigurasi"** yang me-render semua grup dari registry. |

## Registry konfigurasi (`shared/src/config-registry.ts`)

Sumber tunggal. Tiap entri:

```ts
type ConfigKind = "url" | "int" | "bool" | "string" | "path" | "secret";
type ApplyMode = "live" | "new-session" | "restart";
type ConfigCategory = "knob" | "credential" | "bootstrap";
type ConfigEntry = {
  key: string;            // nama env, mis. "SYNC_SERVER_URL"
  group: string;          // grup UI: sync | claude | vps | runtime | bootstrap
  label: string;
  help?: string;
  kind: ConfigKind;
  default?: string;       // default registry (string; di-parse per kind)
  apply: ApplyMode;
  category: ConfigCategory;
  min?: number; max?: number;  // untuk kind:int
};
```

Entri (final):

| key | group | kind | apply | category | default |
|---|---|---|---|---|---|
| `SYNC_SERVER_URL` | sync | url | live | knob | — |
| `SYNC_DEVICE_TOKEN` | sync | secret | live | credential | — |
| `SYNC_TICK_MS` | sync | int (≥1000) | live | knob | 15000 |
| `CLAUDE_CODE_OAUTH_TOKEN` | claude | secret | new-session | credential | — |
| `ANTHROPIC_API_KEY` | claude | secret | new-session | credential | — |
| `HANOMAN_CLAUDE_BIN` | claude | path | new-session | knob | claude |
| `CLAUDE_CONFIG_DIR` | claude | path | new-session | knob | ~/.claude |
| `HANOMAN_SSH_KEY_DIR` | vps | path | new-session | knob | ~/.hanoman |
| `HANOMAN_SSH_BIN` | vps | path | new-session | knob | ssh |
| `HANOMAN_EVENTS_TICK_MS` | runtime | int (≥100) | live | knob | 1000 |
| `HANOMAN_UPDATE_FETCH` | runtime | bool | live | knob | 1 |
| `HANOMAN_REPO_ROOT` | runtime | path | restart | knob | — |
| `HANOMAN_TMUX_SOCKET` | runtime | string | restart | knob | hanoman |
| `DATABASE_URL` | bootstrap | secret | restart | bootstrap | — |
| `TEST_DATABASE_URL` | bootstrap | secret | restart | bootstrap | — |
| `PORT` | bootstrap | int | restart | bootstrap | 8787 |
| `HOST` | bootstrap | string | restart | bootstrap | 127.0.0.1 |
| `NODE_ENV` | bootstrap | string | restart | bootstrap | — |

`HANOMAN_TMUX_SOCKET` diberi peringatan UI: mengubahnya tak memindahkan sesi tmux yang sudah hidup (mereka
tetap di socket lama sampai restart). `category: bootstrap` selalu read-only di UI.

## Perubahan data model (migration + ADR)

Model baru **local-only, tak pernah disync** (masuk pengecualian whitelist sync bersama `Setting`,
`Notification`, `LocalBinding`, `SyncState`):

```prisma
model RuntimeConfig {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

`value` disimpan string; di-parse per `kind` registry. Secret disimpan **plaintext-at-rest** (server wajib
mengirimnya sebagai `Bearer`/argv — sama seperti nilainya di env dulu). Migration **ditulis tangan** +
`migrate deploy` per DB (`hanoman` dan `hanoman_test`) dengan override env eksplisit (catatan memori: `migrate
dev` mereset saat drift worktree; `_test` butuh migrate terpisah).

## Resolver terpusat (`server/src/config.ts`)

- **Cache in-memory** dimuat saat boot (`loadConfig()` membaca semua `RuntimeConfig` → `Map<string,string>`),
  agar hot-path tetap **sinkron**. Di-refresh saat PUT/DELETE.
- `effectiveStr(key)`, `effectiveInt(key)`, `effectiveBool(key)`: cache DB → `process.env[key]` → default registry.
- `rawDbValue(key)`: hanya override DB (untuk menentukan `source` di GET).
- **Refactor**: ganti pembacaan `process.env.*` tersebar (services & routes) dengan `cfg.effective*`. Kunci
  tersentuh: `SYNC_SERVER_URL`, `SYNC_DEVICE_TOKEN`, `SYNC_TICK_MS`, `HANOMAN_EVENTS_TICK_MS`,
  `HANOMAN_UPDATE_FETCH`, `HANOMAN_CLAUDE_BIN`, `CLAUDE_CONFIG_DIR`, `HANOMAN_SSH_KEY_DIR`, `HANOMAN_SSH_BIN`,
  `HANOMAN_REPO_ROOT`, `HANOMAN_TMUX_SOCKET`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`. Bootstrap
  (`DATABASE_URL` dll) tetap dibaca dari env langsung.

### Side-effect saat PUT/DELETE (dispatch per key)

- Kunci sync (`SYNC_SERVER_URL`/`SYNC_DEVICE_TOKEN`/`SYNC_TICK_MS`) → `applySyncConfig()`: `stopSyncClient()`
  lalu `startSyncClient()` bila `serverUrl`+`token` efektif ada (re-init live tanpa restart).
- Knob `live` lain → tak ada aksi; pembacaan berikutnya memakai cache baru.
- `new-session`/`restart` → tak ada aksi runtime; hanya berlaku untuk proses baru / setelah boot ulang.

`server.ts` boot: panggil `loadConfig()` lalu resolusi efektif config sync → apply (bukan baca `process.env`
langsung). Backward-compatible: tanpa DB override & tanpa env → tetap murni HUB.

## Kontrak API (cookie-authed, prefix `/api`, warisan gate seperti `device-tokens`)

- `GET /api/config` → `{ entries: ConfigEntryView[], sync: { running: boolean; connected: boolean } }`.
  `sync` = status sync client aktif (dari state modul `sync-client.ts`), dipakai indikator grup Sync di UI.
  Tiap `ConfigEntryView` = metadata registry +:
  - non-secret: `value: string | null`, `source: "db" | "env" | "default"`, `editable: boolean`.
  - secret: `masked: "••••1234" | null`, `hasValue: boolean` (tanpa `value`). Connection string bootstrap
    (`DATABASE_URL`/`TEST_DATABASE_URL`) juga diperlakukan secret → dimask.
- `PUT /api/config` → body `{ key: string, value: string }`. Validasi via registry (kind/min/max/url).
  - Secret dengan `value` kosong/absen → **pertahankan** nilai lama (no-op pada DB).
  - Key `category: bootstrap` → **400** (tak dapat diedit).
  - Key tak dikenal registry → **400**. Value tak valid untuk kind → **400** dengan pesan.
  - Sukses → tulis `RuntimeConfig`, refresh cache, jalankan side-effect, balas `ConfigEntryView` terbaru.
- `DELETE /api/config/:key` → hapus override DB (revert ke env/default); untuk secret = clear. Bootstrap → 400.
  Jalankan side-effect (mis. sync re-apply memakai fallback env).

Route mendaftar di bawah gate `/api` yang sudah ada (cookie auth); tak menyentuh middleware `requireDeviceToken`.

## Frontend

- `shared/src/api.ts`: tipe `ConfigEntryView` + `paths.config = ${API}/config`, `paths.configKey(k)`.
- `src/src/api/client.ts`: `getConfig()`, `putConfig(key, value)`, `deleteConfig(key)`.
- `src/src/screens/SettingsScreen.tsx`: tab baru **"Konfigurasi"** (icon `sliders`) di daftar tab. Render
  registry per grup (Sync, Claude, VPS, Runtime, lalu Bootstrap read-only). Field bertipe:
  - `url`/`string`/`path` → text input; `int` → number input (honor min/max); `bool` → checkbox/toggle.
  - `secret` → tampil mask + tombol **"Ganti"** membuka input; simpan blank = pertahankan; tombol **"Hapus"**.
  - `bootstrap` → read-only (nilai/mask), badge "env".
  - Tiap field tampil badge `source` (db/env/default) + catatan `apply` (mis. "berlaku untuk sesi baru",
    "perlu restart"). Grup Sync tampilkan indikator tersambung/tidak dari `sync.running`/`sync.connected`
    di `GET /api/config`.
- Panel penerbit device token sisi hub (`DeviceTokensPanel`) **tetap** di tab "Perangkat". Koneksi client
  (URL + token + interval) ada di Konfigurasi → grup Sync. Keduanya bisa hidup berdampingan (satu codebase,
  dua peran).

## Dekomposisi fase (urut; tiap fase = grup task di plan)

- **Fase 0 — ADR & migrasi.** ADR-0049 (config runtime store + registry + resolver DB→env→default; sebagian
  menggantikan OQ-4). Model `RuntimeConfig`; migration tangan + `migrate deploy` per DB.
- **Fase 1 — Registry + resolver + refactor.** `shared/src/config-registry.ts`; `server/src/config.ts`
  (cache, effective*, loadConfig); ganti pembacaan `process.env.*` tersentuh → `cfg.*`; `server.ts` pakai
  resolver. Unit test resolver & precedence.
- **Fase 2 — API config.** Routes `GET/PUT/DELETE /api/config`; masking; source; validasi kind; reject
  bootstrap; secret blank-keeps & clear. Side-effect dispatch (sync re-apply). Integrasi Fastify inject.
- **Fase 3 — Frontend.** api client + tab "Konfigurasi" render dari registry; field per kind; secret termask;
  bootstrap read-only; badge source/apply; indikator sync. Test komponen.
- **Fase 4 — Docs & parity.** Update `.env.example`/`.env.production.example` (tandai "juga via Settings");
  update spec SPEC-213 (OQ-4 sebagian digantikan) + operations doc; pastikan suite lama hijau, 0 endpoint hilang.

## Strategi test

- **Unit**: resolver (`DB > env > default`, tiap kind parse), cache invalidation saat PUT/DELETE, masking
  (last-4, connection string), registry validation (kind/min/max/url), `applySyncConfig` (stop→start dipanggil
  saat kunci sync berubah).
- **Integrasi (Fastify inject)**: `GET /config` (shape, mask, source, editable), `PUT` (valid, invalid kind
  400, bootstrap 400, unknown key 400, secret blank keeps existing), `DELETE` (revert ke env/default; secret
  clear), side-effect sync re-apply terpicu.
- **Realtime/live**: ubah `SYNC_*` via PUT → sync client re-init tanpa restart (dua "instance" in-proc seperti
  test SPEC-213), state konsisten.
- **Frontend**: tab Konfigurasi render grup dari registry; secret tampil mask & "Ganti"; bootstrap read-only;
  PUT memanggil api client benar.
- **Per task execute**: boot server lokal + curl `GET/PUT/DELETE /api/config` (CLAUDE.md), bukan hanya unit test.

## Non-goals

- Bukan mengedit var **bootstrap** (`DATABASE_URL`/`PORT`/`HOST`/`NODE_ENV`/`TEST_DATABASE_URL`) — read-only.
- Bukan enkripsi-at-rest untuk secret (sejajar dengan env hari ini; TLS via reverse-proxy, ADR-0028). Secret
  tetap tak pernah balik plaintext ke browser.
- Bukan sync `RuntimeConfig` antar-instance (local-only, per-mesin — konsisten AC-30 SPEC-213).
- Bukan hot-migrasi sesi tmux/proses yang sudah jalan saat knob `new-session`/`restart` berubah.
- Tak menghidupkan kembali guardrail yang dicabut (SPEC-160/197).
