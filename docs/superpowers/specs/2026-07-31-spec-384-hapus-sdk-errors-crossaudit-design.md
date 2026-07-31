# SPEC-384 — Hapus `hanoman-sdk`, error monitoring, dan cross-audit

**Tanggal:** 2026-07-31 · **Sumber:** brief · **Prioritas:** tinggi
**ADR:** 0092 (baru) — mencabut 0060, 0063, 0070, 0075; mengamandemen 0066

## Konteks

Pemantauan error produksi nafanesia.id sudah pindah ke **Uptrace** (terpasang di VPS,
`https://uptrace.nafanesia.id`). Sejak itu jalur error milik hanoman sendiri — SDK, ingest ber-DSN,
grouping, symbolication, eskalasi — tak lagi dipakai siapa pun tetapi tetap hidup di kode, skema,
API, dashboard, dan docs. Dua sumber kebenaran untuk hal yang sama adalah ambiguitas; yang mati
harus dicabut, bukan dibiarkan sebagai kode mati.

Objective: hapus `hanoman-sdk` dan errors hanoman **beserta docs-nya**.

## Keputusan yang diambil manusia (2026-07-31)

1. **Migrasi DB drop total** — tabel error dan kolom DSN di `Project` dihapus. VPS prod adalah hub
   hidup; data error di sana hilang permanen. Itu memang yang diminta ("clear dan hapus keseluruhan
   agar tidak menjadi ambiguitas") karena sumbernya sudah pindah ke Uptrace.
2. **`hanoman-sdk` dicabut dari npm** — target *unpublish*. npm hanya mengizinkan unpublish dalam
   72 jam sejak publish (paket terbit 2026-07-21), jadi prosedur ditulis **berjenjang**: coba
   `npm unpublish`, dan bila registry menolak karena lewat jendela, jatuh ke `npm deprecate`.
   Eksekusinya **tindakan manusia** (akun ber-2FA butuh `--otp`), bukan bagian dari sesi ini.
3. **Docs dihapus, termasuk ADR** — konvensi "ADR usang tidak dihapus" sengaja dilanggar atas
   perintah eksplisit. ADR-0060/0063/0070/0075 dihapus berkasnya. **Pengecualian yang saya ambil:**
   ADR-0066 memuat **dua** keputusan — errors *dan* tiket Help Center + pemicu sync manual — dan
   yang kedua masih berlaku. Menghapusnya bulat-bulat akan menghilangkan catatan keputusan yang
   hidup, jadi 0066 **ditulis ulang** tanpa bagian errors, bukan dihapus.
4. **Cross-audit dicabut sekalian** — bukan hanya permukaan lognya. `ProjectLink`, flow
   `cross-audit`, kartu Integrasi, prompt runner, dan ADR-0075 ikut hilang.

## Mengapa cross-audit ikut

`GET /api/audit/logs` (SPEC-337 · ADR-0075) **hanya** membaca `ErrorEvent`/`ErrorGroup`; seluruh
mekanisme kunci `hnm_xa_…` (tmux option → `auditSessionScope` → pengecualian gate di `app.ts`) ada
semata untuk menggerbangi permukaan itu. Tanpa data error, flow cross-audit kehilangan justru hal
yang membedakannya dari `audit` biasa. Menyisakannya berarti menyisakan flow, model DB, layar, dan
prompt yang tak punya sumber data — persis ambiguitas yang spec ini cabut.

## Prinsip

- **Tak ada kode mati.** Setiap berkas yang hanya melayani tiga blok ini dihapus, bukan dikosongkan.
- **Tak ada tabel yatim.** Skema Prisma dan berkas DB harus tetap cocok — satu migration.
- **Tak ada baris yang jadi tak-terparse.** Nilai enum yang dicabut (`Notification.type = "error"`,
  `Spec.source = "cross-audit"`) punya baris nyata di DB prod; migration harus membereskannya,
  bukan membiarkan zod meledak saat dibaca.
- **Tak ada doc yang menunjuk fitur mati.** Termasuk lintas-referensi dari ADR yang tetap hidup.

## Arsitektur perubahan

### 1. Data model — satu migration

`server/prisma/migrations/<ts>_drop_errors_sdk_crossaudit/migration.sql`, **ditulis tangan** dan
diterapkan `prisma migrate deploy` (bukan `migrate dev` — worktree tetangga menyebabkan drift dan
`migrate dev` akan me-*reset* DB).

Urutan wajib (FK):

```sql
DROP TABLE "ErrorEvent";          -- FK → ErrorGroup
DROP TABLE "SourceMapArtifact";
DROP TABLE "ErrorGroup";
DROP TABLE "ProjectLink";
```

`Project` kehilangan `ingestKeyHash` & `ingestKeyPrefix`. SQLite tak punya `DROP COLUMN` yang aman
di semua versi untuk kolom ber-index; ditulis sebagai **table rebuild** (buat `new_Project` → salin
kolom yang bertahan → drop → rename), pola yang sama dipakai Prisma sendiri.

Pembersihan baris yang nilainya tak lagi sah:

```sql
DELETE FROM "Notification"   WHERE "type"   = 'error';
UPDATE "Spec" SET "source" = 'audit' WHERE "source" = 'cross-audit';
DELETE FROM "SyncLog"        WHERE "entity" = 'errorGroup';
DELETE FROM "SyncOutbox"     WHERE "entity" = 'errorGroup';
DELETE FROM "SyncConflict"   WHERE "entity" = 'errorGroup';
DELETE FROM "SchedulerQueueItem" WHERE "source" = 'errors';
```

`Spec` ber-`source='cross-audit'` **dinormalkan ke `audit`**, tidak dihapus: backlog item-nya
pekerjaan nyata dengan branch & dokumen; yang hilang cuma label asalnya.

Setelan scheduler hidup sebagai JSON di `Setting`; kunci `sources.errors` yang tertinggal
**diabaikan zod** saat parse (`.default({})` membuang kunci tak dikenal) — tak perlu bedah baris.

**Jebakan byte source-map.** `sourcemap-store.ts` menulis ke `uploadDir()` yang **sama** dengan
lampiran tiket, bernama opaque `<uuid>.map`. Menghapus direktorinya akan ikut menghapus lampiran
tiket yang masih hidup. Karena migration SQL tak bisa menyentuh filesystem, pembersihan byte jadi
**langkah runbook manual yang didokumentasikan**: baca `SELECT storageKey FROM SourceMapArtifact`
**sebelum** menerapkan migration, hapus tepat berkas-berkas itu. Melewatkannya hanya menyisakan
byte inert, tidak merusak apa pun.

### 2. Server

Dihapus:

| Berkas | Peran |
|---|---|
| `src/routes/errors.ts` | area Errors (list/detail/escalate/unlink/patch/guide) |
| `src/routes/ingest.ts` | ingest publik ber-DSN + upload source-map |
| `src/routes/audit.ts` | `/audit/logs` — cross-audit |
| `src/services/error-ingest.ts` · `error-fingerprint.ts`(+test) · `error-escalate.ts` | jalur ingest → grup → eskalasi |
| `src/services/sourcemap-store.ts`(+test) · `symbolicate.ts`(+test) | symbolication |
| `src/services/ingest-key.ts`(+test) | DSN hash-at-rest |
| `src/services/scheduler/sources/errors.ts` | checker scheduler `errors` |
| `src/services/cross-audit.ts` · `audit-scope.ts` · `project-links.ts` | cross-audit |

Disunting:

- `app.ts` — cabut `register(ingest)`, `register(errors)`, `register(audit)`, pengecualian gate
  prefix `/api/ingest`, dan pengecualian kunci audit.
- `server.ts` — cabut `registerErrorsSource()`.
- `routes/projects.ts` — cabut endpoint `ingest-key` (GET/POST/DELETE), hint `dsnUrl` pada rename,
  dan endpoint ProjectLink.
- `routes/terminal.ts` · `services/session-launch.ts` — cabut cabang `flow === "cross-audit"`.
- `services/pty.ts` — cabut field `auditKey`/`auditProjects`, `auditSessionScope()`, dan kind
  `cross-audit`.
- `services/notifications.ts` — cabut `recordNewErrorGroup()`.
- `services/sync.ts` — `errorGroup` keluar dari `SYNCED`/`DELEGATE`/`FIELDS`/tanggal.
  Konsekuensi: push dari klien versi lama yang membawa `errorGroup` ditolak `isSynced()` —
  perilaku yang benar (record kind tak dikenal).
- `services/rename-project.ts`, `services/ticket.ts` — buang jejak error/ProjectLink.

### 3. Shared

`shared/src/dto.ts` — cabut `zStackFrame`, `zSymbolicatedFrame`, `zSourceMapUpload`,
`zIngestPayload`, `zErrorGroupView`, `zErrorEventView`, `zErrorGroupDetail`, `zIngestKeyView`,
`monitoringEnabled`, `ingestKeyPrefix`, `fromErrorGroup`, `minCount`, literal `cross-audit` pada
`zFlow` & body sesi.
`shared/src/enums.ts` — cabut `zErrorStatus`, `cross-audit` dari `zSpecSource`, `"error"` dari tipe
`Notification`, `sources.errors` dari config scheduler.
`shared/src/api.ts` — cabut path `ingest`, `errors*`, `projectIngestKey`, `projectLinks`.
`shared/src/agent.ts` — capability `support:*` **bertahan** (tiket Help Center masih ada); label &
desc-nya kehilangan kata "Errors".
`shared/src/session-kind.ts` — cabut `cross-audit`.

### 4. Web

Dihapus: `screens/ErrorsScreen.tsx`, `screens/IntegrationGuideModal.tsx`,
`screens/ProjectLinksCard.tsx`.
Disunting: `App.tsx` (nav + section `errors`, modal start cross-audit), `api/client.ts` (tipe
`Flow`, `crossAudit()`, seluruh pemanggil errors/ingest), `screens/ProjectDetailScreen.tsx` (kartu
DSN + kartu Integrasi), `screens/SchedulerScreen.tsx` (panel source `errors`),
`screens/BacklogScreen.tsx` & `screens/TriageScreen.tsx` (label sumber `cross-audit`).

### 5. Runner

`src/types.ts` — cabut `Flow` `cross-audit`, `CrossAuditCtx`, `CrossAuditProject`.
`src/prompt.ts` — cabut `PIPELINES["cross-audit"]`, `startCrossAuditPrompt()`, `projectLine()`,
`crossAuditLogGuide()`.

### 6. CLI

`src/commands/migrate-pg.ts` — cabut `"ErrorGroup"`, `"ErrorEvent"`, `"SourceMapArtifact"`,
`"ProjectLink"` dari daftar model yang dimigrasi. (Perintah ini memindahkan DB Postgres lama;
tabel yang tak ada lagi di skema target tak boleh ikut disalin.)

### 7. Paket

`sdk/` dihapus seluruhnya; `pnpm-workspace.yaml` dan `vitest.workspace.ts` kehilangan anggota
`sdk`. `pnpm-lock.yaml` diregenerasi.

### 8. Docs

**Dihapus:** `sdk/README.md`, `docs/prd/log-error-monitoring.md`,
`internal/docs/adr/0060-…`, `0063-…`, `0070-…`, `0075-…`, dan sepuluh berkas arsip
`docs/superpowers/{specs,plans}` yang subjeknya errors/SDK/cross-audit.

**Ditulis ulang:** `internal/docs/adr/0066-…` — judul & isi menjadi tiket Help Center + pemicu sync
manual saja.

**Baru:** `internal/docs/adr/0092-cabut-error-monitoring-sdk-cross-audit.md` — mencatat pencabutan,
alasannya (Uptrace), apa yang hilang permanen, dan prosedur npm.

**Disunting:** `internal/docs/README.md` (index — baris integrasi SDK, empat baris ADR, satu baris
ADR baru), `internal/docs/adr/README.md` (narasi), `architecture/api-contract.md`,
`architecture/data-model.md`, `frontend/frontend-implementation.md`, `requirements/frd.md`,
`requirements/rd.md`, `security/security-standard.md`, `operations/gtm.md`,
`research/market-sizing.md`, `internal/skills/hanoman/SKILL.md`, `docs/agent-integration.md`, dan
lintas-referensi di ADR yang tetap hidup (0062, 0064, 0065, 0076, 0078, 0083, 0087).

**Baru (operasi):** prosedur pencabutan `hanoman-sdk` dari npm ditulis di
`internal/docs/operations/release-npm.md` — berjenjang unpublish → deprecate, dengan `--otp`.

## Testing

Dihapus bersama subjeknya: `sdk/test/**`, `server/test/error-ingest.test.ts`,
`errors.route.test.ts`, `errors-escalate.route.test.ts`, `ingest.route.test.ts`,
`sourcemaps.route.test.ts`, `projects-ingest-key.route.test.ts`,
`scheduler-source-errors.test.ts`, `audit-logs.route.test.ts`, `cross-audit-session.test.ts`,
`project-links.{route,service}.test.ts`, `shared/test/dto-symbolication.test.ts`,
`src/test/errors-screen.test.tsx`, `notifications-error.test.tsx`,
`project-links-card.test.tsx`, `runner/test/cross-audit-prompt.test.ts`.

Disesuaikan (menyinggung, bukan menguji): `server/test/sync-exclusions.test.ts`,
`sync.service.test.ts`, `sync-notify.test.ts`, `agent-capabilities.test.ts`,
`rename-project.service.test.ts`, `pty.test.ts`, `prd-from-audit.route.test.ts`,
`shared/test/enums.test.ts`, `shared/src/session-kind.test.ts`, `runner/test/types.test.ts`,
`runner/test/escalation-prompt.test.ts`, `src/test/audit-escalation.test.tsx`.

**Test baru** (regresi yang bisa gagal senyap):

1. `server/test/errors-gone.route.test.ts` — `POST /api/ingest/<project>` dan `GET /api/errors`
   menjawab **404**, bukan 401/200. Membuktikan pengecualian gate `/api/ingest` benar-benar dicabut:
   prefix yang tertinggal akan meloloskan request tanpa cookie ke handler yang tak ada dan
   menghasilkan 401 — perbedaan yang tak kelihatan tanpa assert eksplisit.
2. `server/test/sync-exclusions.test.ts` (diperluas) — `isSynced("errorGroup") === false` dan push
   `errorGroup` ditolak.
3. Migration diverifikasi lewat `PRAGMA table_info(Project)` di test: kolom `ingestKeyHash` &
   `ingestKeyPrefix` tak ada, dan `sqlite_master` tak memuat empat tabel yang di-drop.

**Scope verifikasi:** perubahan ini menyentuh tipe bersama (`shared/**`), skema Prisma, dan berkas
yang diimpor banyak modul — itu justru kasus "berdampak luas" yang menurut ADR-0080 boleh
memperluas scope. Verifikasi karena itu menjalankan test per-paket yang tersentuh (`shared`,
`server`, `src`, `runner`, `cli`) dengan `--no-file-parallelism`, bukan hanya `--changed`.

## Yang TIDAK berubah

- **Help Center / tiket** — `Ticket`, `TicketAttachment`, triase, dan sync-nya utuh. Capability
  `support:*` bertahan.
- **Flow `audit` (satu project)** dan eskalasi audit dinamis (ADR-0076) — utuh.
- **Scheduler** — fondasi, source `backlog` & `triase`, governor, panel: utuh. Hanya source
  `errors` yang hilang.
- **Uptrace** — di luar repo, tak disentuh.

## Risiko

| Risiko | Penanganan |
|---|---|
| Data error prod hilang permanen | Diputuskan eksplisit; sumbernya sudah pindah ke Uptrace |
| Klien sync versi lama mendorong `errorGroup` | `isSynced()` menolak — record kind tak dikenal, perilaku yang benar |
| Baris `Notification type='error'` / `Spec source='cross-audit'` membuat zod gagal saat dibaca | Dibereskan di migration yang sama |
| Byte `.map` menghapus lampiran tiket bila direktori dihapus asal | Pembersihan pakai daftar `storageKey`, ditulis sebagai langkah runbook |
| npm unpublish ditolak (>72 jam) | Prosedur berjenjang, jatuh ke `npm deprecate` |
| Nomor ADR 0092 direbut worktree tetangga | Enumerasi ulang lintas branch **dan** `git worktree list` tepat sebelum push |
