# SPEC-337 — Agen audit lintas project (integrasi & dependency)

**Tanggal:** 2026-07-27 · **Sumber:** brief · **Prioritas:** tinggi · **ADR:** 0074

## Masalah

> "Saat ini ketika ada 2 project atau lebih yang mau di audit atau cek log issue antar
> integrasi nya harus di masing-masing ai agent dan itu menyulitkan untuk dilakukan."

Setiap sesi `claude` hanoman lahir di **satu** worktree milik **satu** project (ADR-0002/0015).
Konsekuensinya, issue yang justru hidup **di antara** dua project — kontrak API yang bergeser,
SDK yang tertinggal versi, error di service B yang muncul sebagai 500 di project A — tak pernah
punya satu pengamat. Operator harus membuka dua sesi, menyalin temuan bolak-balik, dan
mengkorelasikan waktu error secara manual.

Tiga hal yang hilang hari ini:

1. hanoman **tak tahu** project mana yang saling bergantung. Tak ada relasi antar `Project`.
2. Sesi **tak bisa melihat** kode/docs project lain (worktree tunggal).
3. Log error **ter-scope per project**: `GET /errors?project=…` dipakai UI per area, tak ada
   timeline gabungan yang membuat "error di A pukul 10:03:11 setelah B gagal pukul 10:03:10"
   terlihat sebagai satu peristiwa.

## Objective (MVP, terkunci)

**Satu sesi `claude` yang lahir sudah tahu project mana saja yang saling bergantung, bisa membaca
kode & docs semuanya, dan bisa menarik timeline error gabungan mereka kapan saja selama sesi
berjalan** — sehingga issue integrasi antar-project bisa diaudit dan ditanya-tanya dari satu
tempat, tanpa membuka sesi terpisah per project.

Terukur: operator membuka **satu** sesi lalu bertanya "apa yang salah antara A dan B"; agen
menjawab dengan bukti dari **kedua** sisi — error yang berkorelasi waktu dari timeline gabungan
dan kutipan kode/kontrak dari kedua checkout — tanpa operator menyalin apa pun antar sesi.

## Keputusan bentuk (dari brainstorm dengan operator)

| Pertanyaan | Keputusan |
|---|---|
| Relasi antar project | **Dideklarasikan sebagai data** (model baru), bukan dipilih ad-hoc tiap sesi |
| Bentuk sesi | **Keduanya**: backlog item (berdokumen) **dan** sesi lepas (tanya-jawab) |
| "Cek log" itu apa | **Error monitoring hanoman** (`ErrorGroup`/`ErrorEvent`), bukan journald VPS |
| Akses log saat sesi jalan | **Live query ber-scope sesi**, bukan snapshot beku di prompt |
| Siapa agennya | **hanoman sendiri** membuka sesi `claude` — bukan AI agent eksternal (SPEC-257) |
| Kode project sekunder | **Path checkout read-only**; hanya project utama yang punya worktree |

## Arsitektur

```
ProjectLink (data)         Sesi cross-audit                 Endpoint ber-scope
─────────────────          ─────────────────                ──────────────────
hanoman-web ──api──▶ api   claude di worktree project        GET /api/audit/logs
hanoman-api ──sdk──▶ sdk   utama; path repo tetangga         X-Hanoman-Audit-Key: hnm_xa_…
                           read-only di prompt          ───▶ scope = project sesi itu saja
                           HANOMAN_AUDIT_KEY di env          timeline error lintas project
```

### 1. `ProjectLink` — relasi jadi pengetahuan tetap

```prisma
model ProjectLink {
  id            String   @id @default(cuid())
  fromProjectId String   // yang BERGANTUNG
  toProjectId   String   // yang DIBERGANTUNGI
  kind          String   // api | sdk | data | event | lainnya (String + zod, bukan enum Prisma)
  note          String   @default("")   // bentuk integrasinya — dibaca agen apa adanya
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  from Project @relation("ProjectLinkFrom", fields: [fromProjectId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  to   Project @relation("ProjectLinkTo",   fields: [toProjectId],   references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@unique([fromProjectId, toProjectId])
  @@index([toProjectId])
}
```

- **Berarah**, karena "A memakai B" bukan kalimat simetris; tetapi **tetangga** sebuah project
  = union kedua arah (yang ia pakai + yang memakainya). Itulah "grup" yang diaudit.
- **Satu hop**, bukan closure transitif. Cukup untuk "issue antar integrasi", dan batasnya jelas.
- `onUpdate: Cascade` → rename project (ADR-0064) merambat gratis; tak ada ref longgar baru.
- **LOCAL-only** (tak masuk `SYNCED`): id `cuid` + `@@unique(pair)` berarti dua device yang
  membuat edge sama akan bertabrakan unique saat upsert-by-id. Sync ditunda sadar — lihat ADR-0074.
- `note` adalah field paling berharga bagi agen: "web memanggil `/api/orders`, auth lewat cookie
  sesi, retry 3×". Prompt menyalinnya apa adanya.

**API** (di `routes/projects.ts`, cookie/agent-token biasa):

| Endpoint | Perilaku |
|---|---|
| `GET /api/projects/:id/links` | `{ links: [{id, fromProjectId, toProjectId, kind, note, direction}] }` — kedua arah, `direction` = `keluar`\|`masuk` relatif `:id` |
| `POST /api/projects/:id/links` | body `{ to, kind, note? }` → 201. Self-link → 400; target tak ada → 404; pasangan sudah ada → 409 |
| `DELETE /api/projects/:id/links/:linkId` | 204; link yang bukan milik `:id` (kedua arah) → 404 |

Tanpa PATCH: ubah = hapus + tambah (YAGNI).

### 2. Kunci audit ber-scope sesi

Sesi cross-audit lahir membawa kunci acak `hnm_xa_<32 hex>`. Kunci **tidak** disimpan di DB —
ia hidup sebagai tmux option pada sesinya, karena **tmux adalah satu-satunya sumber kebenaran
pekerjaan berjalan** (ADR-0016). Konsekuensinya gratis: kunci selamat dari restart API, dan
**mati saat pane-nya mati** tanpa perlu revoke.

- `@hanoman_audit_key` — kunci
- `@hanoman_audit_projects` — daftar projectId yang boleh dibaca (utama + tetangga), dipisah koma

Sesi menerimanya lewat env: `HANOMAN_AUDIT_KEY`, `HANOMAN_AUDIT_URL`
(`http://127.0.0.1:<PORT>/api/audit`).

**Kunci tak pernah keluar lewat API.** `listSessions()` (dan `GET /terminal/sessions`) tetap
mengembalikan `SessionInfo` apa adanya — field kunci hidup hanya di tipe `Pane` internal.

**Pengecualian gate auth** (`app.ts`), sempit dan sejajar dengan DSN ingest (ADR-0060):

```
if (path.startsWith("/api/audit/") && auditScopeFromReq(req)) return;
```

`auditScopeFromReq` memindai pane tmux hidup untuk kunci di header `X-Hanoman-Audit-Key`;
tak cocok / pane sudah mati → gate lanjut ke jalur normal (cookie / agent token) → 401.
Cookie sesi tetap boleh memanggil endpoint yang sama (berguna untuk debugging di dashboard).

### 3. `GET /api/audit/logs` — timeline error lintas project

Query: `since` (`24h` | `7d` | ISO, default `24h`) · `environment?` · `q?` (substring type+message)
· `projects?` (subset scope; di luar scope → 403) · `limit?` (default 200, max 1000).

```jsonc
{
  "window": { "since": "…Z", "until": "…Z" },
  "scope": [{ "id": "hanoman-web", "name": "…" }, { "id": "hanoman-api", "name": "…" }],
  "groups": [ { "id", "projectId", "type", "message", "environment", "release",
                "status", "count", "firstSeenAt", "lastSeenAt", "specId" } ],
  "timeline": [ { "at", "projectId", "groupId", "type", "message", "environment", "release" } ]
}
```

`timeline` = `ErrorEvent` semua project ter-scope **dicampur dan diurut waktu** — inilah bukti
korelasi yang hari ini harus dirakit manual. `groups` = agregat, untuk melihat pola berulang.

`GET /api/audit/logs/:groupId` → detail satu grup: `sampleStack`, `sampleFrames`
**ter-symbolicate** (reuse `symbolicateFrames` + `findSourceMap`, SPEC-276), dan 50 event terakhir
lengkap dengan `context`. Grup milik project di luar scope → 404 (bukan 403: keberadaannya pun
tak perlu bocor).

### 4. Flow `cross-audit` — dua pintu, satu prompt

Enum melebar tanpa migration (String + zod, presedens ADR-0057):
`zFlow` += `cross-audit`, `zSpecSource` += `cross-audit`, `flowForSource("cross-audit")` →
`"cross-audit"`, `PIPELINES["cross-audit"] = ["Audit", "Laporan"]` (nama fase dipakai ulang dari
audit-only; `REACHED.Laporan = "done"` sudah ada, `planComplete` true karena tak ada plan).

`startCrossAuditPrompt(ctx, mode)` di `runner/src/prompt.ts` — satu builder, dua mode:

| | `backlog` (Spec) | `live` (sesi lepas) |
|---|---|---|
| Pintu | Backlog source `cross-audit` → Start | Tombol di kartu Integrasi detail Project |
| Worktree | `.worktrees/<spec-id>` project utama | `.worktrees/xaudit-<projectId>` |
| Fase | `Audit → Laporan` + phase file | tak ada |
| Deliverable | dokumen `internal/docs/research/audit-<spec-id>-<slug>.md`, commit, push | jawaban di terminal |
| Stage | bergerak sampai `done` | tak menggerakkan apa pun |

Isi prompt yang sama di kedua mode:

1. **Peta project**: untuk tiap project — id, nama, stack, path checkout, dan **arah + kind + note**
   relasinya terhadap project utama.
2. **Aturan tulis**: hanya worktree sendiri yang boleh ditulis; checkout project lain **read-only**.
   (Flow audit-only memang tak menulis kode — ADR-0057.)
3. **Cara menarik log**, dengan contoh `curl` siap tempel memakai `$HANOMAN_AUDIT_URL` dan
   `$HANOMAN_AUDIT_KEY`, termasuk filter waktu/environment/kata kunci dan endpoint detail grup.
4. **Fokus audit lintas**: kontrak API yang bergeser antara pemanggil & penyedia, versi SDK/paket
   tertinggal, error yang berkorelasi waktu di dua project, environment/release yang tak sejalan,
   asumsi auth/format data yang berbeda.
5. **Tak ada data error** untuk sebuah project → katakan itu terang-terangan lalu jatuh ke
   pembandingan kontrak di level kode; jangan mengarang.

Mode `backlog` menambahkan: instruksi fase, klausa autonomy, skill `systematic-debugging`, dan
perintah commit+push ke `hanoman/<spec-id>`.

### 5. UI

- **`ProjectDetailScreen` — kartu "Integrasi antar project"**: daftar link (arah, kind, note,
  hapus), form tambah (select project + kind + note), dan tombol **"Audit lintas project"**
  (sesi lepas → pindah ke Terminal). Tanpa link → kartu menjelaskan gunanya, tombol audit mati.
- **`NewSpecModal`**: pilihan source "Audit lintas" (payload brief-shaped, sama seperti audit).
- **`BacklogScreen`**: entri `SOURCE_META` untuk `cross-audit` (label "audit lintas").
- **`TerminalScreen`**: sel sesi `xaudit-*` berlabel jelas.

## Alur data

```
operator men-set link  ──▶ ProjectLink
                              │
Start (backlog / lepas) ──────┼──▶ resolve tetangga (1 hop, 2 arah)
                              │      + resolveRepoDir tiap tetangga
                              │      + generate kunci audit
                              ▼
                        createSession(worktree utama,
                          env {HANOMAN_AUDIT_KEY,HANOMAN_AUDIT_URL},
                          tmux @hanoman_audit_key/@hanoman_audit_projects,
                          prompt = startCrossAuditPrompt(…))
                              │
             agen ──curl──▶ GET /api/audit/logs (kunci → scope) ──▶ timeline lintas project
             agen ──Read──▶ checkout tetangga (read-only)
                              ▼
        backlog: dokumen audit + push          lepas: jawaban di terminal
```

## Penanganan error

| Keadaan | Perilaku |
|---|---|
| Project utama belum di-bind checkout | 400 `needsBind` (jalur `startSpecSession` yang ada) |
| Tetangga belum di-bind | Tetap masuk scope log; path ditandai `(tak ada checkout lokal)` di prompt |
| Project tanpa link sama sekali | Backlog `cross-audit` tetap boleh jalan (scope = dirinya sendiri) dengan catatan tegas di prompt; tombol sesi lepas dimatikan di UI |
| Kunci audit tak cocok / pane mati | Gate jatuh ke auth normal → 401 |
| `projects=` memuat id di luar scope | 403, tanpa membocorkan apakah project itu ada |
| Grup di luar scope | 404 |
| `since` tak terparse | 400 |

## Testing

- **Unit** — parser `since`; resolusi tetangga (dua arah, dedup, self-exclusion); `auditScopeFromReq`
  (kunci cocok/tak cocok/pane mati); scope filter query; builder prompt kedua mode (memuat path
  tetangga, note link, contoh curl; mode live tanpa instruksi fase/push).
- **Route** — CRUD link (happy path, self-link, duplikat, cross-project delete); `/audit/logs`
  (timeline tercampur & terurut, filter since/environment/q, 403 di luar scope, 401 tanpa kunci);
  `/audit/logs/:id` (404 di luar scope, symbolication terpanggil).
- **Sesi** — `POST /terminal/sessions {project, flow:"cross-audit"}` melahirkan sesi ber-worktree
  dengan tmux option kunci + scope terisi, dan `GET /terminal/sessions` **tidak** memuat kunci.
- **Smoke nyata** — boot server, seed dua project + link + error di keduanya, curl `/api/audit/logs`
  dengan kunci sesi sungguhan, verifikasi timeline bercampur.

## Non-goals

- Log runtime VPS (journald/systemd) — dipilih keluar scope saat brainstorm.
- Closure dependency transitif (>1 hop) dan visualisasi graf.
- Sync `ProjectLink` antar device (ADR-0074 mencatat alasan & jalan keluarnya).
- Perubahan pada `ErrorEvent`/ingest: SPEC-337 murni pembaca.
- Auto-eskalasi temuan lintas jadi Spec — tetap lewat promosi manual "Jadikan Finding QA".
