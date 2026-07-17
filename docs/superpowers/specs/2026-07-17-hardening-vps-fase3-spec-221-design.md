# SPEC-221 — Hardening VPS Checklist Fase 3: Drift + App-layer Applicability

> Sumber: `docs/prd/hardening-vps-checklist.md` (Fase 3) · Lanjutan SPEC-220 (Fase 1+2).
> Tanggal: 2026-07-17 · Bergantung pada `VpsAuditSnapshot`/`VpsItemState`/katalog dari SPEC-220.
> Keputusan human: **drift + app-layer keduanya**; app-layer **advisory** (deteksi stack → saran N/A, manusia memutuskan; TIDAK auto-exclude skor).

## Objective (terkunci)

Melengkapi kerangka kepatuhan VPS dengan **monitoring proaktif**:
1. **Deteksi drift + Notification** (AC-19): tiap audit baru, item yang sebelumnya `pass` kini `fail` ditandai **drift** dan memunculkan Notification.
2. **Applicability app-layer — advisory**: audit mendeteksi stack terpasang (aaPanel/web server/DB/SSL); UI menampilkan **saran N/A** untuk seksi app-layer yang stack-nya tak terdeteksi, plus aksi **tandai seksi N/A** sekali klik. Manusia tetap yang menandai (patuh "manusia terakhir yang memutuskan"); **tak** auto-exclude dari skor.

Tetap patuh guardrail: skrip deterministik SSH+sudo (ADR-0025), **tanpa cron/scheduler baru** (ADR-0024) — drift dihitung saat audit dipicu manual/on-view, bukan latar belakang.

**In scope:** AC-19 (drift+Notification), applicability advisory (PRD open Q2, versi konservatif).
**Sudah dipenuhi existing:** AC-18 (re-audit tanpa cron), AC-20 (tanpa scheduler baru).

## Konteks yang membatasi (fakta)

- **Fleet dockerized**: prod hanoman = Caddy + Postgres **di Docker**. Probe paket/port bare-metal akan melaporkan web/DB "tak ada" padahal berjalan di container → itulah alasan app-layer **advisory saja**, bukan auto-N/A. Saran boleh salah; manusia mengoreksi.
- **Notification** (model existing): `type`, `key @unique` (dedup idempoten), `specId?`, `sessionId?`, `projectId?`, `title`, `createdAt`, `readAt?`. Pola: `recordCompletion` pakai `key: "done:<specId>"`. Drift meniru pola ini.
- **Snapshot append-only** (`VpsAuditSnapshot`) sudah menyimpan `results` per-audit → sumber untuk diff drift (bandingkan 2 snapshot terakhir). Tak perlu tabel baru untuk drift.
- **Katalog** menandai `appLayer: true` untuk seksi aapanel/webserver/database/ssl (56 item).

## Arsitektur & keputusan desain

### 1. Deteksi drift (AC-19) — derived, tanpa tabel baru

- **Kapan**: di `runAudit` (server/src/services/vps-audit.ts), **setelah** snapshot baru dibuat, bandingkan dengan snapshot **sebelumnya** (yang kedua-terbaru).
- **Definisi drift**: item yang `pass` di snapshot sebelumnya dan kini `fail` atau `warn` (regresi postur nyata). **`pass→unknown` BUKAN drift** — `unknown` berarti audit tak terbaca (mis. `sshd -T` gagal sesaat), sering transien; menganggapnya drift memicu alarm palsu. (AC-19 menyebut pass→fail; kita perluas ke pass→warn karena warn = degradasi nyata, tapi berhenti sebelum unknown.)
- **Fungsi murni** `server/src/vps/drift.ts`:
  ```ts
  export type DriftItem = { itemId: string; from: string; to: string };
  export function computeDrift(
    prev: Record<string, { status: string }>,
    curr: Record<string, { status: string }>): DriftItem[];
  ```
  Hanya item yang ada di kedua snapshot & `prev=pass` & `curr≠pass`.
- **Notification**: bila drift ≥1, buat **satu** Notification agregat per audit (hindari spam — patuh "instrument panel yang tenang"):
  - `type: "drift"`, `key: "drift:<vpsId>:<snapshotId>"` (idempoten per snapshot), `projectId: null`, `specId: null`, `sessionId: null`,
  - `title`: `Drift di "<vpsName>": N item regresi (ssh-b3, fw-b1, …)` (maks ~5 id ditampilkan, sisanya "+K lagi").
  - Dibuat di `runAudit` via helper baru `recordDrift(vps, driftItems, snapshotId)` di `services/notifications.ts` (konsisten pola `recordCompletion`).
- **UI**: `ChecklistItem` dapat field turunan `drifted: boolean` — `buildChecklist` men-diff 2 snapshot terakhir (tanpa persistensi). Item drift diberi penanda visual (ikon/warna) + ringkasan "N item drift sejak audit sebelumnya" di header checklist.

### 2. Applicability app-layer — advisory (deteksi + saran)

- **Deteksi stack** (`audit.sh`): emit baris `STACK <section> <present|absent> <detail>` untuk seksi app-layer:
  - `aapanel` → `present` bila ada `/www/server/panel` atau perintah `bt`.
  - `webserver` → `present` bila nginx/apache/httpd terpasang (paket ATAU proses).
  - `database` → `present` bila mysql/mariadb/postgresql terpasang (paket ATAU proses ATAU listener 3306/5432).
  - `ssl` → `present` bila ada certbot/letsencrypt atau sertifikat non-self-signed terpasang.
  - Deteksi **best-effort**; container tak terdeteksi → `absent` (itulah kenapa advisory).
- **Persistensi** (perubahan skema — AC-24): `VpsAuditSnapshot` mendapat kolom **`detected Json?`** = `{ [section]: { present: boolean; detail: string } }` (additive; migration + ADR-0051). Diisi `runAudit` dari baris `STACK`.
- **Parse & tampil**: `parseStack(out)` di `vps-audit.ts`. `buildChecklist` menambah ke tiap seksi app-layer field `suggestion?: { applicable: boolean; detail: string }` — bila `detected[section].present === false`, saran = "kemungkinan N/A (stack tak terdeteksi)".
- **UI**: seksi app-layer dengan saran N/A menampilkan banner lembut + tombol **"Tandai seksi N/A"** (bulk). **Tak** mengubah skor sampai manusia mengklik. N/A manual existing tetap berlaku & menang.
- **Bulk N/A endpoint**: `POST /vps/:id/items/na-bulk { itemIds: string[], na: boolean, reason?: string }` — upsert banyak `VpsItemState` sekaligus (satu round-trip, testable). Menggunakan `byId` untuk validasi tiap id.

### 3. Kontrak API (perubahan)

| method | path | perubahan | AC |
|---|---|---|---|
| POST | `/vps/:id/audit` | response tambah `drift: DriftItem[]` (item yang baru regresi) | 19 |
| GET | `/vps/:id/checklist` | item tambah `drifted`; seksi tambah `suggestion?` | 19 |
| POST | `/vps/:id/items/na-bulk` | **baru** — tandai N/A banyak item (untuk "tandai seksi N/A") | (app-layer) |

Drift Notification muncul di feed `GET /notifications` existing (tanpa perubahan endpoint). Semua di bawah gate auth + bind 127.0.0.1.

### 4. Data model (AC-24)

- `VpsAuditSnapshot` + kolom **`detected Json?`** (additive). Migration hand-written `2026071710_spec221_stack_detected/migration.sql`; `migrate deploy` per DB (`hanoman`, `hanoman_test`) + `prisma generate`. **Tak ada tabel/model baru** — drift derived, detected menumpang snapshot.
- **ADR-0051**: "Fase 3 kepatuhan VPS — drift derived dari snapshot + Notification agregat; applicability app-layer advisory (deteksi stack, tak auto-exclude)". Meng-extend ADR-0050.

## Testing (TDD)

- **drift** (`drift.test.ts`): pass→fail = drift; pass→warn = drift; **pass→unknown = BUKAN drift**; fail→fail bukan drift; item baru (tak ada di prev) bukan drift; pass→pass bukan drift.
- **stack parse** (`vps-audit.test.ts`): `parseStack` menangkap `STACK <section> <present|absent>`; section asing diabaikan.
- **audit.sh** (`vps-os-family`/baru): emit `STACK webserver …`, `STACK database …` dst tanpa crash (fixture os-release).
- **routes**:
  - audit menghasilkan `drift[]` saat ada regresi + membuat Notification `type:"drift"` (dedup per snapshot: audit ulang snapshot sama tak dobel) (AC-19).
  - checklist item `drifted` benar; seksi app-layer punya `suggestion` saat `detected.absent`.
  - `na-bulk` menandai banyak item; item asing dalam batch → 400/diabaikan (pilih: tolak seluruh batch bila ada id asing).
- **UI** (`vps-checklist.test.tsx`): item drift diberi penanda; banner saran + tombol "Tandai seksi N/A" memanggil `api.markNaBulk`; item drift terlihat.
- Live: boot server + curl audit (2×, drift muncul di audit kedua bila status berubah), checklist (`drifted`/`suggestion`), na-bulk, dan cek Notification feed berisi drift.

## Rencana PR (garis besar; detail di plan)

1. **PR1 — Skema + drift core**: kolom `detected` (migration + ADR-0051 + docs), `drift.ts` + test, `computeDrift` di runAudit, `recordDrift` Notification, `audit` response `drift[]`.
2. **PR2 — Stack detect + checklist**: `audit.sh` emit `STACK`, `parseStack`, simpan `detected`, `buildChecklist` isi `drifted`+`suggestion`, DTO shared.
3. **PR3 — UI**: penanda drift + ringkasan, banner saran app-layer + tombol bulk N/A, endpoint `na-bulk` + client `markNaBulk`, test UI+route.

Tiap PR hijau (`vitest run --no-file-parallelism`) + endpoint teruji live sebelum lanjut.

## Non-goals (tegas)

- Tanpa cron/scheduler baru — drift on-audit/on-view saja (ADR-0024).
- Tanpa **auto-exclude** skor dari deteksi app-layer (advisory saja; manusia yang menandai N/A).
- Tanpa tabel/model baru (drift derived; detected menumpang snapshot).
- Tanpa rollback, tanpa laporan pihak ketiga, tanpa RBAC, tanpa distro baru (warisan Non-goal SPEC-220).
- Tanpa notifikasi drift per-item (agregat per-audit saja).
