# SPEC-181 — spec: Indicator Limit (limit Claude realtime di dashboard)

**Status:** spec dikunci 2026-07-11 · prioritas tinggi.
Hulu: [objective SPEC-181](spec-181-indicator-limit-objective.md) ·
[design](../../../docs/superpowers/specs/2026-07-11-indicator-limit-spec-181-design.md).
Hilir: plan di `docs/superpowers/plans/`.

## Objective

Dashboard menampilkan seluruh window limit langganan Claude secara realtime (auto-update ≤60s),
di badge top bar (selalu tampil) dan kartu Overview, tanpa kanal push baru dan tanpa DB.

## Sumber data

Endpoint OAuth yang sama dengan `/usage` Claude Code:

```
GET https://api.anthropic.com/api/oauth/usage
  Authorization: Bearer <accessToken>
  anthropic-beta: oauth-2025-04-20
```

Token diambil dari kredensial Claude Code di host server. **Sumbernya beda per platform** —
diverifikasi nyata: di macOS ini berkas `.credentials.json` **kedaluwarsa** (leftover) sementara
token hidup ada di **Keychain**. Jadi:

```
1. macOS (darwin) tanpa CLAUDE_CONFIG_DIR eksplisit:
     security find-generic-password -s "Claude Code-credentials" -w
     → JSON blob → claudeAiOauth.accessToken     (token hidup, di-refresh claude)
2. Fallback (Linux/prod, atau CLAUDE_CONFIG_DIR di-set):
     <CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json → claudeAiOauth.accessToken
```

`CLAUDE_CONFIG_DIR` di-set → **selalu** pakai berkas (juga seam test: tmp dir + fixture, tanpa
Keychain, tanpa mock fs). Tak di-set + darwin → Keychain dulu. Non-darwin → langsung berkas.
Server & sesi claude berbagi kredensial yang sama (runner men-spawn claude `env: process.env`).

**Respons `/api/oauth/usage` sudah dikonfirmasi nyata (HTTP 200, tier `default_claude_max_20x`).**
Bentuknya punya array `limits[]` yang bersih — inilah yang dipetakan (bukan field top-level legacy):

```jsonc
"limits": [
  { "kind": "session",       "group": "session", "percent": 19, "severity": "normal",
    "resets_at": "2026-07-11T01:59:59Z", "scope": null, "is_active": false },
  { "kind": "weekly_all",     "group": "weekly",  "percent": 40, "severity": "normal",
    "resets_at": "2026-07-11T05:59:59Z", "scope": null, "is_active": true },
  { "kind": "weekly_scoped",  "group": "weekly",  "percent": 23, "severity": "normal",
    "resets_at": "2026-07-11T05:59:59Z",
    "scope": { "model": { "display_name": "Opus" } }, "is_active": false }
]
```

`severity` (`normal|warning|critical`) datang dari API → warna badge dari server, bukan ambang
hardcode. `is_active` menandai window yang sedang mengikat. Fixture test = respons nyata ini
(disimpan `server/test/fixtures/usage-200.json`).

## Kontrak API

`GET /api/limits` (auth-gated otomatis — bukan anggota `PUBLIC` di `app.ts`, jadi 401 tanpa sesi).

```ts
// shared/src/dto.ts
export type LimitsStatus = "ok" | "stale" | "unavailable";
export type LimitSeverity = "normal" | "warning" | "critical";
export type LimitWindow = {
  key: string;               // "session" | "weekly_all" | "weekly_scoped:Opus" ...
  label: string;             // "Sesi 5 jam" | "Mingguan" | "Mingguan Opus"
  usedPct: number;           // 0..100 (dibulatkan dari `percent`)
  resetsAt: string | null;   // ISO 8601 (`resets_at`), atau null
  severity: LimitSeverity;   // dari API `severity`; fallback dari usedPct bila hilang
  isActive: boolean;         // API `is_active` — window yang sedang mengikat
};
export type LimitsDTO = {
  status: LimitsStatus;
  windows: LimitWindow[];    // [] saat unavailable / belum pernah sukses
  fetchedAt: string | null;  // ISO waktu fetch sukses terakhir; null bila belum pernah
};
```

`shared/src/api.ts`: tambah `limits: ${API}/limits`.

### Semantik status

- `ok` — fetch sukses barusan. `windows` dari respons, `fetchedAt` = sekarang.
- `stale` — token expired / 401 / error jaringan, **tapi** ada hasil sukses sebelumnya: kembalikan
  `windows` + `fetchedAt` terakhir yang diketahui. FE menandai "diperbarui X lalu".
- `unavailable` — berkas kredensial tak ada/tak terbaca/tanpa `accessToken`, dan belum pernah ada
  hasil sukses: `windows: []`, `fetchedAt: null`.

## Server

### `server/src/services/limits.ts` (baru)

Satu-satunya modul yang tahu Anthropic & berkas kredensial.

```ts
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TTL_MS = 30_000;

let cache: { dto: LimitsDTO; at: number } | null = null;

// Peta window → label Indonesia. Kunci yang tak dikenal tetap dipetakan (label = key apa adanya)
// supaya window baru dari Anthropic tak diam-diam hilang.
const LABELS: Record<string, string> = {
  five_hour: "Sesi 5 jam", seven_day: "Mingguan", seven_day_opus: "Mingguan Opus",
};

export async function getLimits(): Promise<LimitsDTO> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.dto;
  const token = readAccessToken();                 // null → unavailable/stale
  const dto = await fetchUsage(token);
  if (dto.status === "ok") cache = { dto, at: Date.now() };
  return dto;
}
```

- `readAccessToken()` — Keychain dulu (darwin & `CLAUDE_CONFIG_DIR` tak di-set), lalu berkas:
  - `security find-generic-password -s "Claude Code-credentials" -w` (via `execFileSync`,
    stderr dipipe) → JSON blob → `claudeAiOauth.accessToken`. Non-zero/parse gagal → lanjut.
  - berkas `<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json` → `claudeAiOauth.accessToken`.
  - Semua gagal → `null`.
- `fetchUsage(token)`:
  - token `null` → `stale` (bila ada `cache`) atau `unavailable`.
  - `fetch(USAGE_URL, { headers })`. `401`/non-2xx/throw → sama: `stale`|`unavailable`.
  - `2xx` → `mapWindows(json)` → `{ status: "ok", windows, fetchedAt: nowIso() }`.
- `mapWindows(json)` — petakan **`json.limits[]`** (array bersih, sudah dikonfirmasi):
  `key = kind (+":"+scope.model.display_name bila ada)`, `label = LABELS[kind] ?? humanize(kind)`
  (+ model utk scoped), `usedPct = Math.round(percent)`, `resetsAt = resets_at ?? null`,
  `severity = normalizeSeverity(severity, usedPct)`, `isActive = !!is_active`. Defensif: `limits`
  bukan array → `[]`. Kunci tak dikenal tetap ikut (label = humanize).
- `normalizeSeverity(s, pct)` — `"normal"|"warning"|"critical"` apa adanya; nilai lain/hilang →
  turunkan dari pct (`>=90` critical, `>=70` warning, else normal).
- Pakai global `fetch` (Node 18+) & `execFileSync` (`node:child_process`). Nol dependency baru.

### `server/src/routes/limits.ts` (baru)

```ts
export default async function limits(app: FastifyInstance) {
  app.get("/limits", async () => getLimits());
}
```

Register di `app.ts` (`api.register(limits)`), di dalam scope `/api` yang tergerbang auth.

## Frontend

### `src/src/api/client.ts`
`getLimits(): Promise<LimitsDTO>` — `j(paths.limits)`.

### `useLimits()` — poller singleton (baru, mis. `src/src/api/use-limits.ts`)

Satu interval 60s + satu nilai ter-cache di module scope, dibagi semua pemakai (ref-counted; mulai
saat subscriber pertama mount, berhenti saat terakhir unmount). Selamat dari navigasi (module
scope), tak menghajar endpoint meski dipakai di dua tempat. Pola external store
(`useSyncExternalStore`), ~30 baris. **Bukan** context provider (tak perlu bungkus pohon), **bukan**
poll per-`<Shell>`.

### `<LimitBadge>` di `src/src/ds/shell.tsx`

Dirender di header persisten (sebelum `{actions}`, mis. setelah spacer di baris 113). Karena Shell
membaca `useLimits()` sendiri, **9 call site `<Shell>` di `App.tsx` tak berubah** — badge muncul di
semua layar tanpa prop-drilling.

- Ringkas: ikon + `usedPct` window paling kritis + warna.
- Window paling kritis = severity terburuk (`critical`>`warning`>`normal`), tie-break `usedPct`
  tertinggi. Warna dari severity itu (hijau/amber/merah, token DS yang ada). `stale` → warna
  diredam + titik "stale". `unavailable` → "—".
- Klik → popover berisi `<LimitWindows>`.

### `<LimitWindows>` (presentasi, dipakai ulang)

Daftar window: label · bar/`usedPct` · "reset dalam …" (dari `resetsAt`). Dipakai popover badge
**dan** kartu Overview — satu komponen, dua tempat. Footer: "diperbarui X lalu" / status.

### Kartu di `src/src/screens/OverviewScreen.tsx`
Kartu "Limit Claude" berisi `<LimitWindows>` dari `useLimits()`, di samping kartu sesi live.

## Test (Execute, TDD dulu — minimal satu tes gagal sebelum implementasi)

`server/test/limits.route.test.ts` (build app `{ requireAuth: false }` untuk kasus non-auth; satu
kasus dengan auth untuk gate):

1. `CLAUDE_CONFIG_DIR` → tmp berisi `.credentials.json` fixture + `fetch` di-mock balikin
   `server/test/fixtures/usage-200.json` (respons nyata) → `GET /api/limits` = `status:"ok"`,
   `windows` termapping: session/weekly_all/weekly_scoped dengan `usedPct` 19/40/23, `severity`,
   `isActive` (weekly_all `true`), label scoped memuat nama model.
2. `fetch` mock `401` setelah satu sukses → `status:"stale"`, `windows` = hasil sukses terakhir.
3. `CLAUDE_CONFIG_DIR` menunjuk dir tanpa `.credentials.json` → `status:"unavailable"`, `windows:[]`.
4. TTL cache: dua panggilan dalam <30s → `fetch` dipanggil **sekali**.
5. Auth: `requireAuth:true` tanpa cookie → `401` (konsisten gate `app.ts`).

FE: unit warna badge (`usedPct` → hijau/amber/merah) & render `<LimitWindows>` dari state.

Verifikasi nyata: boot server + `curl -s localhost:<port>/api/limits` dengan token fresh →
cek shape & mapping sebelum tandai selesai.

## Non-tujuan

- Tanpa skema/migration/ADR (data ephemeral, cache in-memory).
- Tanpa self-refresh token (refresh rotating; refresh sendiri me-logout sesi claude). Kita hanya
  **membaca** token hidup yang di-refresh claude sendiri (Keychain macOS / berkas Linux).
- Tanpa `spend`/kredit-usage dan tanpa histori/grafik tren, tanpa SSE/WebSocket app-wide.

## Rujukan

- [objective SPEC-181](spec-181-indicator-limit-objective.md)
- ADR-0024 — sesi interaktif menggantikan run (kenapa tak ada output terstruktur claude).
- `server/src/app.ts` — gate auth (`PUBLIC`, `requireAuth`). `src/src/ds/shell.tsx:120` — slot header.
