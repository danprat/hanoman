# SPEC-181 — Indicator Limit (limit Claude realtime di dashboard)

## Objective
Memunculkan limit Claude secara realtime — **seluruh window limit langganan** — di dashboard
hanoman, supaya user bisa melihat dan memastikan backlog masih bisa terus di-running. Kasus
nyata: saat ini tidak ada indikator limit sama sekali di dashboard; user baru tahu limit habis
ketika sesi claude sudah berhenti di tengah run.

Prioritas: tinggi. Sumber: brief.

## Konteks
hanoman **tidak** lagi menjalankan claude headless (`claude --output-format stream-json`) —
subsistem itu dicabut di SPEC-162 / ADR-0024. Hari ini claude jalan **interaktif di dalam tmux**
(`server/src/services/pty.ts`), dan hanoman hanya merelay byte terminal mentah ke browser lewat
WebSocket per-sesi. Tidak ada JSON terstruktur yang diparse, dan **tidak ada** tracking
usage/token/cost/limit apa pun — di kode maupun DB. Fitur ini mulai dari nol pada sisi data.

Sumber data limit yang realistis bukanlah output terminal claude, melainkan endpoint OAuth yang
sama yang dipakai `/usage` di Claude Code:

```
GET https://api.anthropic.com/api/oauth/usage
  Authorization: Bearer <accessToken>
  anthropic-beta: oauth-2025-04-20
```

Endpoint ini terbukti nyata: dengan token lokal yang **expired** ia membalas `401`
(authentication_error), sementara path sibling palsu membalas `404`. Token-nya ada di
`~/.claude/.credentials.json` di host yang sama dengan server hanoman — di bawah key
`claudeAiOauth` (`accessToken`, `refreshToken`, `expiresAt`, `subscriptionType`,
`rateLimitTier`). Runner men-spawn claude dengan `env: process.env` (HOME diwariskan), jadi
server membaca `~/.claude` yang sama dengan sesi claude yang jalan.

**Bentuk pasti respons `/api/oauth/usage` belum bisa dikonfirmasi** karena token lokal expired
(401). Task pertama Execute wajib menangkap respons nyata dari token fresh sebagai fixture dan
mengunci nama field. Desain memperlakukan respons sebagai kumpulan "window" (5-jam, mingguan,
mingguan-Opus), tiap window punya persentase terpakai + waktu reset; parser dibuat defensif.

## Keputusan

### Pengambilan & pengiriman data
- **REST endpoint `GET /api/limits` + polling frontend (60s).** Bukan WS/SSE app-wide (tak ada
  channel always-on hari ini; WS terminal per-sesi), bukan file-watch (limit tak diproduksi
  agen). Window limit bergerak dalam skala menit — polling 60s sudah "realtime" yang cukup, dan
  cocok dengan pola polling yang sudah ada (`App.tsx`, `VpsScreen`).
- Endpoint di belakang **auth yang sama** dengan endpoint lain (User/Session cookie).

### Token: opportunistic read (tanpa refresh)
- Baca `accessToken` **apa adanya** — tak pernah refresh sendiri. Refresh token Claude
  *rotating/single-use*; kalau hanoman refresh, token sesi claude yang sedang jalan jadi invalid →
  user ke-logout. Terlalu berisiko. Kita cuma **membaca** token hidup yang di-refresh claude.
- **Sumber token beda per platform (diverifikasi nyata).** Di macOS ini berkas
  `.credentials.json` kedaluwarsa (leftover) sementara token hidup ada di **Keychain**:
  - macOS (darwin) tanpa `CLAUDE_CONFIG_DIR` eksplisit → Keychain:
    `security find-generic-password -s "Claude Code-credentials" -w` → JSON → `accessToken`.
  - Linux/prod, atau `CLAUDE_CONFIG_DIR` di-set → berkas
    `<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json`. (`CLAUDE_CONFIG_DIR`-set = seam test.)
- Konsekuensi yang diterima: token fresh selama claude aktif (claude yang refresh). Indikator
  paling andal justru **saat backlog jalan** — momen yang penting. Idle → bisa `stale`;
  indikator menandainya, bukan diam-diam salah.

### Bentuk respons (dikonfirmasi HTTP 200)
Respons `/api/oauth/usage` punya array `limits[]` yang bersih — **inilah** yang dipetakan (bukan
field top-level legacy). Tiap entri: `kind` (`session`/`weekly_all`/`weekly_scoped`/…), `group`,
`percent` (0–100), `severity` (`normal`/`warning`/`critical` — warna dari server), `resets_at`,
`scope.model.display_name` (utk scoped/per-model), `is_active` (window yang mengikat). Fixture
test = respons nyata (`server/test/fixtures/usage-200.json`).

### Komponen (unit terisolasi)
1. `server/src/services/limits.ts` — satu-satunya yang tahu Anthropic & kredensial. Baca token
   (Keychain/berkas) → panggil endpoint → map `limits[]` ke DTO → cache in-memory **30s** (dedup
   multi-tab). Tiap window → `{ key, label, usedPct, resetsAt, severity, isActive }`. Defensif:
   `limits` non-array → `[]`; `severity` hilang → turunkan dari `usedPct`.
2. `server/src/routes/limits.ts` — `GET /api/limits`, auth-gated. Balikin
   `{ windows: LimitWindow[], fetchedAt: string, status: "ok" | "stale" | "unavailable" }`.
3. `shared/src/api.ts` — tambah path `/api/limits` + tipe DTO (satu sumber tipe FE & BE).
4. Frontend:
   - `useLimits()` — satu poll app-level (60s) di `App.tsx`, state dibagi ke bawah.
   - `<LimitBadge>` — badge ringkas di slot `actions` Shell (`src/src/ds/shell.tsx:120`),
     terlihat di semua layar. Warna = window paling kritis.
   - `<LimitWindows>` — komponen presentasi daftar window (label · %terpakai · reset),
     **dipakai ulang** oleh popover badge **dan** kartu di `OverviewScreen`. "Keduanya" = satu
     data path, dua tempat render (DRY).

### State & warna
- `status`:
  - `ok` — respons segar dari endpoint.
  - `stale` — token expired/401: tampilkan nilai terakhir yang diketahui + "diperbarui X lalu".
  - `unavailable` — file kredensial tak ada/tak terbaca (mis. idle sebelum login, atau install
    yang simpan kredensial di Keychain): badge "—" + tooltip "Claude idle / belum login".
- Warna badge dari `usedPct` window paling kritis: hijau `<70`, amber `70–90`, merah `>90`.

## Yang TIDAK dibangun (ponytail)
- **Tanpa DB/migration.** Data ephemeral, di-fetch on-demand + cache in-memory. Tanpa ADR skema.
- **Tanpa self-refresh token** (alasan di atas) — hanya membaca token hidup.
- **Tanpa `spend`/kredit-usage** dan **tanpa persist histori/grafik tren.** Objective-nya "lihat
  limit realtime", bukan analitik historis. Tambah kalau diminta.

## Testing
- Unit `limits.ts`: fetch di-mock dengan fixture respons → assert mapping window, TTL cache,
  jalur `stale` (401) & `unavailable` (file hilang).
- Route `/api/limits`: auth-gate (401 tanpa cookie), bentuk respons.
- FE: `<LimitBadge>` render + warna dari state; `<LimitWindows>` render daftar.
- Test nyata: boot server + `curl /api/limits` (dengan token fresh) → verifikasi shape & mapping.

## Konsekuensi
- User punya indikator glanceable di top bar (dan kartu rinci di Overview) untuk semua window
  limit, auto-update tiap 60s — bisa memutuskan apakah aman men-trigger backlog berikutnya.
- Indikator jujur soal keterbatasannya: stale saat idle, unavailable saat belum login. Tidak
  pernah menampilkan angka lama seolah-olah segar.
- Docs yang tersentuh: entri baru di `internal/docs/operations/` (objective + spec) dan index
  `internal/docs/README.md`.
