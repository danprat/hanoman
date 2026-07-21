# SPEC-257 — AI Agent capability (full control via Agent Token + capability scope)

Status: design · Prioritas: tinggi · Sumber: brief · ADR: 0065

## Objektif

AI agent **eksternal** dapat mengelola hanoman — setiap fitur bisa dilakukan agen — dengan
aksesnya **dibukakan manusia via Settings**. Kontrol penuh, tetapi opt-in per-fitur.

## Wawasan kunci

Seluruh permukaan fitur hanoman **sudah** berupa REST API di bawah `/api` (projects, backlog,
sessions/terminal, docs, ide/git, vps, settings, errors, help/tickets, notifications). Dashboard
React hanyalah satu klien dari API itu, digerbang cookie sesi (`onRequest` di `server/src/app.ts`).

Maka "full control untuk AI agent eksternal" **bukan** menulis ulang fitur — melainkan:

1. Kredensial non-interaktif agar agen bisa auth ke `/api` (token Bearer), dan
2. Kontrol akses **per-fitur** yang dibuka manusia di Settings (capability scope), plus
3. Master switch tingkat workspace.

Precedent auth non-cookie yang sudah ada dipakai sebagai cetakan: **DeviceToken** (Bearer,
`sha256` hash-at-rest, revocable, `services/device-token.ts` + `services/device-auth.ts`),
kunci **ingest DSN** (hash-at-rest, `services/ingest-key.ts`), dan cookie sesi (`services/auth.ts`).

## Keputusan (dari brainstorm)

- **Antarmuka:** Agent Token + capability scope atas REST `/api` yang sudah ada. **Tanpa MCP**
  di spec ini (MCP bisa jadi follow-on: lapisan tipis yang meng-auth dengan agent token).
- **Granularitas:** **per-domain read/write** (bukan per-endpoint, bukan satu toggle/domain).

## Model data

### Model baru `AgentToken` (server-local, TAK disync — seperti DeviceToken)

```prisma
model AgentToken {
  id           String    @id @default(cuid())
  name         String
  tokenHash    String    @unique          // sha256(plaintext); plaintext hanya SEKALI saat create
  tokenPrefix  String                      // hint UI, mis. "hnm_agt_ab12cd"
  capabilities Json                        // string[] capability, divalidasi zod (z.array(zCapability))
  enabled      Boolean   @default(true)    // master switch per-token
  createdBy    String?                     // User.id pembuat (jejak audit; SetNull saat user dihapus)
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?                    // best-effort, cermin DeviceToken.lastSeenAt
  revokedAt    DateTime?
}
```

- **Server-local**, tanpa kolom `version`/sync: agent token adalah kredensial untuk mengontrol
  instance INI, seperti DeviceToken (identitas mesin) yang juga tak disync.
- `tokenHash` **TAK PERNAH** ke client/log. `AgentTokenView` mengekspos:
  `{ id, name, tokenPrefix, capabilities, enabled, createdBy?, createdAt, lastUsedAt?, revokedAt? }`.
- `capabilities` disimpan `Json` (array string) + divalidasi zod — konsisten pola project
  ("enum sebagai String + zod; blob terstruktur sebagai Json"), menghindari nuansa scalar-list Prisma.
- Plaintext token: prefix `hnm_agt_` + 24 byte hex (cermin `generateIngestKey`).

### `Setting.agentAccessEnabled` (master kill-switch)

Tambah ke `zSetting` (`shared/src/entities.ts`): `agentAccessEnabled: z.boolean().default(false)`.
Default **false** → seluruh agent token ditolak sampai manusia menyalakannya. Belt-and-suspenders di
atas `enabled` per-token dan capability per-token. Baris `Setting` lama tetap parse (default terisi).

## Capability

`Capability = "<domain>:<access>"`, `access ∈ {read, write}`, `write` **meng-implikasikan** `read`.

**9 domain:**

| Domain          | read                                    | write                                                        | Catatan |
|-----------------|-----------------------------------------|-------------------------------------------------------------|---------|
| `projects`      | list/detail/branches/binding, `/fs/browse` | create/patch/delete/rename/clone/binding/ingest-key/help-center | |
| `backlog`       | `/specs` list/detail/docs/review        | create/patch/delete/integrate                               | |
| `sessions`      | list sesi/phases/review                 | spawn claude/shell, input WS, delete, integrate             | **RCE** (high-risk) |
| `docs`          | `/projects/:id/docs`, `/prds` (baca)    | tulis/hapus file `.md`                                       | |
| `ide`           | tree/file/status/graph/commit/compare/diff | tulis file working tree, `git` ops, remotes CRUD          | mutasi working tree |
| `vps`           | `/vps` list/checklist                   | create/patch/delete/audit/harden/remediate/session/console  | **remote exec** (high-risk) |
| `settings`      | `/settings`, `/config` (baca)           | `/settings`, `/config` (tulis)                              | |
| `support`       | `/errors`, `/tickets` (baca)            | escalate/patch status, accept/reject tiket                  | Errors + Help triase |
| `notifications` | `/notifications` (baca)                 | mark-read/clear                                             | |

**Read-only global** (diizinkan untuk agent token ber-capability apa pun): `/limits`, `/update`,
`/events/ws` (feed status read-only). `/health` tetap publik.

**TAK-BOLEH-didelegasikan (COOKIE-ONLY; agent token → 403 apa pun capability-nya):**
`/auth/*` (kelola user & password), `/agent-tokens*` (anti privilege-escalation — agen tak boleh
mencetak/menaikkan token), `/device-tokens*` (identitas mesin), `/sync*` (mesin-ke-mesin, sudah
digerbang device token).

Katalog capability (`{ id, domain, access, label, desc, risk? }`) hidup di `@hanoman/shared`
(`zCapability` + `CAPABILITIES`) supaya server (map & validasi) dan UI (checkbox) satu sumber.

## Gate auth (perluasan `app.ts onRequest`)

Alur baru (menambah, bukan mengganti, jalur cookie):

1. Isi `req.user` best-effort dari cookie (seperti sekarang).
2. `PUBLIC` (health/auth-status/login/setup) → lanjut. Bypass existing `/api/sync`, `/api/ingest`,
   `/api/help` tetap (punya auth sendiri).
3. Bila **ada** cookie user → **lanjut** (akses penuh; tak ada RBAC, konsisten model sekarang).
4. Bila **tak ada** cookie user, cek `Authorization: Bearer <token>` (WS upgrade: `?agent_token=`):
   - token valid + `Setting.agentAccessEnabled` + token `enabled` + `revokedAt==null` →
     set `req.agent = { id, capabilities }`, bump `lastUsedAt` best-effort.
   - Resolve capability yang dibutuhkan route dari **map** (`server/src/services/agent-capabilities.ts`):
     - entri `COOKIE_ONLY` → **403** `{ error: "cookie session required" }` (tak-boleh-didelegasikan).
     - entri capability → agen punya capability itu (atau `:write` mencakup `:read`)? → **lanjut**;
       else **403** `{ error: "capability required", need: "<cap>" }`.
     - route read-only global → lanjut bila punya capability apa pun.
     - route tak dikenal di map → default **COOKIE_ONLY** (aman: agen tak menyentuh yang belum dipetakan).
   - token tak valid / master switch off / disabled / revoked → **401** `{ error: "unauthorized" }`.
5. Tanpa cookie & tanpa agent token → **401** (seperti sekarang).

`req.agent` di-declare via module augmentation (cermin `req.user`, `req.device`).

## Endpoint baru (COOKIE-ONLY — dikelola manusia)

```
GET    /agent-tokens                    -> { items: AgentTokenView[] }         # tanpa hash/plaintext
POST   /agent-tokens { name, capabilities[] } -> 201 { ...AgentTokenView, token }  # plaintext SEKALI
PATCH  /agent-tokens/:id { name?, capabilities?, enabled? } -> 200 AgentTokenView
DELETE /agent-tokens/:id                # 204 · revoke (set revokedAt)          # 404 tak ada
GET    /agent-tokens/capabilities       -> { capabilities: CapabilityCatalog[] } # katalog untuk UI
```

- `POST` memvalidasi tiap capability terhadap katalog (400 bila asing). Nama wajib (400 kosong).
- Master switch `agentAccessEnabled` diubah lewat `PUT /settings` existing (bagian dari blob Setting).
  Agen dengan `settings:write` bisa mematikannya (self-DoS, tak berbahaya); tak bisa menyalakan bila
  sudah off (ia tak bisa auth) dan tak bisa mencetak token (agent-tokens COOKIE-ONLY) → **tanpa
  privilege escalation**.

## Frontend — Settings "Akses AI Agent"

Section baru di `SettingsScreen.tsx` (design system: editorial, bone paper, brass):

- **Master switch** `agentAccessEnabled` (bagian dari PUT /settings) dengan penjelasan singkat +
  peringatan bahwa ini membuka kontrol terprogram.
- **Daftar token**: nama, `tokenPrefix`, ringkasan capability (chip), toggle `enabled`, `lastUsedAt`,
  aksi revoke (konfirmasi).
- **Modal "Buat token"**: input nama + grid checkbox capability dikelompokkan per-domain (kolom
  read/write), badge "berisiko" untuk `sessions:write`/`vps:write`. Submit → tampilkan **plaintext
  token sekali** dengan tombol salin + peringatan "takkan ditampilkan lagi".

## Keamanan

- Hash-at-rest `sha256(token)` (pola DeviceToken/ingest); plaintext hanya sekali. `timingSafeEqual`
  saat verifikasi. Prefix hint untuk identifikasi tanpa membocorkan.
- Capability default **kosong**; master switch default **off** — akses harus dibukakan eksplisit.
- `sessions:write` = RCE (spawn `claude --dangerously-skip-permissions`), `vps:write` = remote exec;
  ditandai high-risk di UI. Isolasi worktree tetap satu-satunya batas keamanan eksekusi (ADR-0037) —
  agent token **tak** memperluas permukaan eksekusi, hanya membuka pintu API yang sama lewat auth lain.
- Tak-boleh-didelegasikan (`/auth`, `/agent-tokens`, `/device-tokens`, `/sync`) → 403 → tanpa
  privilege-escalation/user-management oleh agen.
- Revoke instan (set `revokedAt`) + master switch instan (matikan semua). `lastUsedAt` untuk audit ringan.

## Non-goal (MVP)

- **MCP server** — follow-on terpisah; agent token adalah fondasinya.
- **Audit log per-aksi** — cukup `lastUsedAt`; log lengkap bisa meniru SessionResult append-only nanti.
- **RBAC / scoping per-project** — capability lintas seluruh workspace (satu workspace, ADR produk).
- **Rate-limit khusus agent token** — pasca-MVP.

## Dokumen SoT tersentuh (commit yang sama)

- `internal/docs/architecture/data-model.md` — model `AgentToken` + `Setting.agentAccessEnabled`.
- `internal/docs/architecture/api-contract.md` — mekanisme auth agent token + gate capability +
  endpoint `/agent-tokens`.
- `internal/docs/security/security-standard.md` — agent token: hash-at-rest, capability, master
  switch, tak-boleh-didelegasikan, RCE via `sessions:write`.
- `internal/docs/adr/0065-ai-agent-capability-agent-token.md` — ADR baru.
- `internal/docs/README.md` — link ADR-0065.
- `internal/skills/hanoman/SKILL.md` — sebut `AgentToken` di daftar model pendukung + aturan keamanan.

## Rencana verifikasi

Test (vitest, `--no-file-parallelism`): capability catalog + zod, service issue/verify/revoke,
capability-check helper, route→capability map, gate matrix (cookie vs agent vs anon × capability),
endpoint `/agent-tokens` CRUD. Lalu boot server lokal + curl: buat token (cookie), pakai token
(Bearer) ke endpoint ber-capability & tanpa-capability (403), master switch off → 401,
tak-boleh-didelegasikan → 403.
