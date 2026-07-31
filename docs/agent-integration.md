# hanoman — integrasi AI agent (agent capability) · SPEC-257 · ADR-0065

Beri **AI agent eksternal** kendali penuh atas hanoman lewat **agent token** + **capability per-domain**. Seluruh permukaan fitur hanoman sudah berupa REST API di bawah `/api` (projects, backlog, sesi/terminal, docs, ide/git, vps, settings, errors, help/tiket, notifikasi) — dashboard React hanyalah satu klien. Agen memakai API yang sama, hanya jalur auth-nya berbeda: **`Authorization: Bearer <token>`** ketimbang cookie sesi.

> Tak ada SDK/MCP khusus (belum) — agen cukup HTTP client apa pun. Akses dibuka **oleh manusia** di Settings; tanpa itu, semua token ditolak.

## 1. Nyalakan akses & buat token (manusia, sekali)

Di dashboard hanoman: **Settings → Akses AI Agent**.

1. **Aktifkan "Akses AI Agent"** (master switch). Selagi mati, *semua* agent token dibalas **401** apa pun capability-nya.
2. **Buat token:** beri nama (mis. `agent-ci`), centang **capability** yang dibutuhkan (baca/tulis per domain), klik **Buat token**.
3. **Salin token plaintext sekarang** — bentuknya `hnm_agt_<hex>` dan **hanya ditampilkan sekali** (di server hanya `sha256` yang tersimpan). Simpan di rahasia agen (mis. env `HANOMAN_AGENT_TOKEN`).

Cabut/nonaktifkan token atau matikan master switch kapan saja → efek **instan**.

## 2. Autentikasi

Sertakan token di tiap request:

```
Authorization: Bearer hnm_agt_xxxxxxxxxxxx
```

Untuk **WebSocket** (terminal PTY, event stream) yang tak bisa memasang header dari browser, kirim sebagai query: `?agent_token=hnm_agt_...`.

Contoh:

```bash
export HANOMAN_HOST="https://hanoman.example"
export HANOMAN_AGENT_TOKEN="hnm_agt_xxxxxxxxxxxx"

curl -s "$HANOMAN_HOST/api/specs" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN"
```

## 3. Capability

Capability berformat `"<domain>:<access>"`, `access ∈ {read, write}`, dan **write meng-implikasikan read** pada domain yang sama. Ada **10 domain × 2 = 20 capability**. Katalog resmi (dengan label & deskripsi) tampil di panel **Settings → Akses AI Agent** saat manusia membuat token; endpoint katalognya (`GET /api/agent-tokens/capabilities`) bersifat **cookie-only** (lihat §5) — agen tak perlu mengambilnya, cukup rujuk tabel di bawah:

| Domain | Cakupan endpoint | Catatan |
|---|---|---|
| `projects` | `/api/projects*` | project, branch, binding, DSN, Help Center |
| `backlog` | `/api/specs*` | spec/backlog, dokumen, review diff, integrate |
| `sessions` | `/api/terminal*` (+ WS terminal) | jalankan sesi `claude`/shell, kirim input — **high-risk (RCE)** |
| `docs` | `/api/prds*`, `/api/projects/:id/{docs,prds}*` | dokumen SoT project & PRD |
| `ide` | `/api/projects/:id/{tree,file,file-diff,working-status,graph,commit,git,status,stashes,remotes,compare,archive,pr-url}*` | tree/file working tree, operasi git |
| `vps` | `/api/vps*` | kelola VPS, audit, harden, konsol — **high-risk (remote exec)** |
| `settings` | `/api/settings*`, `/api/config*` | setelan & config runtime |
| `support` | `/api/errors*`, `/api/tickets*` | error monitoring & tiket Help Center |
| `notifications` | `/api/notifications*` | notifikasi |
| `lead` | `/api/lead*` | minta putusan ke hanoman-lead & baca jejak keputusan — **`lead:write` bisa menggerakkan sesi** (SPEC-409 · ADR-0091) |

Aturan pemetaan (deterministik, `server/src/services/agent-capabilities.ts`): `GET`/`HEAD` → `:read`, metode lain → `:write`. Itu berlaku untuk domain `lead` juga: **`POST /api/lead/decisions` menuntut `lead:write`**, dan `lead:read` tak pernah cukup — meminta putusan melahirkan baris jejak permanen dan keputusannya bisa menggerakkan sesi. Sub-path `/api/projects/:id/{docs,prds}` dihitung domain **`docs`**; sub-path IDE/git di atas dihitung domain **`ide`**; WebSocket terminal butuh **`sessions:write`**.

## 4. Aturan gate & kode status

Gate `onRequest` yang sama menegakkan semuanya:

| Situasi | Balasan |
|---|---|
| Master switch mati, atau token invalid/nonaktif/dicabut | **401** `{ error: "unauthorized" }` |
| Token valid tapi capability kurang | **403** `{ error: "capability required", need: "<domain>:<access>" }` |
| Route cookie-only (lihat §5) diakses agen | **403** `{ error: "cookie session required" }` |
| Capability cukup | request diproses seperti biasa |

Field **`need`** pada 403 memberi tahu capability persis yang harus ditambahkan ke token.

## 5. Yang tak bisa didelegasikan (cookie-only)

Untuk mencegah privilege-escalation, endpoint berikut **hanya** untuk sesi cookie manusia — agent token selalu **403**:

- `/api/auth/*` — kelola user & password
- `/api/agent-tokens*` — agen tak boleh mencetak/menaikkan token sendiri
- `/api/device-tokens*`, `/api/sync*` — identitas mesin & sync hub

Route yang tak dikenal peta juga default cookie-only (aman). Endpoint `/api/ingest*` (error SDK) dan `/api/help*` (Help Center publik) memiliki otorisasi sendiri (DSN/kunci tiket) dan tak memakai agent token.

## 6. Contoh alur end-to-end

```bash
# 1. Lihat backlog (butuh backlog:read)
curl -s "$HANOMAN_HOST/api/specs" -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN"

# 2. Buat backlog item baru (butuh backlog:write)
curl -s -X POST "$HANOMAN_HOST/api/specs" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Perbaiki X", "source": "qa" }'

# 3. Bila balas 403 { need: "backlog:write" }, tambah capability itu ke token di Settings.
```

## 6b. Minta putusan ke hanoman-lead (SPEC-409 · ADR-0091)

Agen yang menemui persimpangan tak perlu berhenti menunggu manusia — ia boleh **meminta putusan**:

```bash
curl -s -X POST "$HANOMAN_HOST/api/lead/decisions" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "projectId": "hanoman",
        "specId": "SPEC-409",
        "question": "Tambah kolom baru di Spec, atau turunkan dari updatedAt?",
        "options": ["kolom baru", "turunkan dari updatedAt"],
        "context": "Filter rentang tanggal butuh waktu item dibuat."
      }'
# 201 { id, decision, reason, refs: ["ADR-0090", "internal/docs/..."], confidence: "tinggi", action: "none" }
```

Jawabannya **terbaca mesin**, bukan prosa bebas, dan `refs` hanya memuat rujukan yang benar-benar ada
di repo — jadi agen bisa memverifikasi sendiri dasar keputusannya. `confidence: "ragu"` berarti lead
tetap memutuskan tapi memilih opsi yang paling mudah dibatalkan, dan operator sudah dinotifikasi.

Kode balasan yang perlu ditangani:

| Kode | Artinya |
|---|---|
| **409** | lead tak aktif / project belum opt-in → **kembali ke perilaku lama**: berhenti & tunggu manusia |
| **504** | lead tak berhasil memutuskan dalam batas waktu; kegagalannya sudah tercatat & dinotifikasi |
| **403** `{ need: "lead:write" }` | token cuma punya `lead:read` |

Endpoint & payload lengkap: lihat **API contract** (`internal/docs/architecture/api-contract.md`) di repo — permukaan REST-nya identik dengan yang dipakai dashboard.

## 7. Keamanan

- Token = rahasia. Simpan di env/secret manager, jangan commit. Bocor → **Cabut** di Settings (efek instan).
- Beri capability **seminimal** mungkin. `sessions:write` (spawn `claude --dangerously-skip-permissions`) dan `vps:write` (remote exec) adalah RCE efektif — batas eksekusi sesungguhnya tetap **isolasi git worktree** (ADR-0037), tapi tetap tandai high-risk.
- `lastUsedAt` per token = jejak audit ringan. Matikan master switch untuk kill-switch seluruh workspace.

---

*Doc-of-record fitur: [ADR-0065](../internal/docs/adr/0065-ai-agent-capability-agent-token.md). Untuk error monitoring project (bukan agent control), lihat [`hanoman-sdk`](../sdk/README.md).*
