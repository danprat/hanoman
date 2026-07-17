# SPEC-220 — Hardening VPS Checklist (Fase 1 + Fase 2)

> Sumber: `docs/prd/hardening-vps-checklist.md` · Rujukan checklist: https://bzn2026.lovable.app/
> Tanggal: 2026-07-17 · Scope keputusan human: **Fase 1 + Fase 2**, katalog **di-fetch dari app rujukan**, state **model Prisma baru**.

## Objective (terkunci)

Memperluas modul VPS hanoman dari "5 langkah harden + ±9 audit" menjadi **kerangka kepatuhan berbasis checklist 232 item / 16 seksi**, sehingga tiap VPS Nafanesia punya **skor kepatuhan terukur**, checklist per-seksi, penandaan N/A + attestasi manual, dan **remediasi selektif AUTO dengan preview dry-run**. Tetap patuh guardrail arsitektur: skrip deterministik SSH+sudo (ADR-0025), tanpa scheduler/cron baru (ADR-0024), multi-distro, idempoten, anti-lockout.

**In scope (spec ini):** AC-1…AC-17, AC-21…AC-24.
**Deferred ke Fase 3 (bukan spec ini):** deteksi drift + Notification (AC-19), auto-deteksi applicability app-layer. AC-18/AC-20 (re-audit tanpa cron) sudah dipenuhi perilaku existing + guardrail.

## Sumber katalog (fakta terverifikasi)

Isi 232 item ditarik dari bundle JS app rujukan (`const ua=[…]`), tersimpan di `scratchpad/bzn_catalog.json` (juga `/tmp/bzn_catalog.json`). Bentuk tiap item: `{ id, text, code? }`. Terverifikasi **232 item / 16 seksi**, tiap seksi punya `subsections[{ level, items[] }]`:

| section id | judul | jumlah | levels |
|---|---|---|---|
| ssh | SSH Hardening | 14 | Basic4/Inter6/Adv4 |
| firewall | Firewall & Network | 14 | 3/5/6 |
| aapanel | aaPanel Security | 14 | 6/5/3 |
| user | User & Permission Management | 14 | 5/5/4 |
| system | System Hardening (OS Level) | 16 | 3/6/7 |
| webserver | Web Server Hardening | 14 | 3/6/5 |
| database | Database Security | 15 | 4/6/5 |
| ssl | SSL/TLS & Enkripsi | 13 | 3/5/5 |
| ids | Intrusion Detection & Prevention | 9 | 1/3/5 |
| logging | Logging & Monitoring | 13 | 3/5/5 |
| backup | Backup & Disaster Recovery | 12 | 3/4/5 |
| ddos | DDoS Protection | 11 | 2/4/5 |
| kernel | Kernel Hardening | 12 | 5/6/1 |
| malware | File Integrity & Malware Detection | 7 | 3/3/1 |
| enterprise | Advanced Enterprise & Government Level | 31 | (6 subsections) |
| checklist | Checklist Rutin | 23 | Harian/Mingguan/Bulanan/Tahunan |

`id` item **stabil** (mis. `ssh-b1`, `fw-i3`) → dipakai sebagai kunci kanonik lintas skrip/DB/katalog.

## Arsitektur & keputusan desain

### 1. Katalog di git (`server/src/vps/catalog/`) — AC-1, AC-2

- `catalog.data.ts` — **generated** dari `bzn_catalog.json`: 232 item mentah (`id, section, sectionTitle, level, title, code?`). Ada generator sekali-jalan `scripts/gen-catalog.mjs` yang membaca JSON → menulis `.data.ts` (deterministik, tanpa runtime fetch).
- `catalog.ts` — menggabung data mentah dengan **overrides** metadata hanoman:
  ```ts
  type Mode = "AUTO" | "AUDIT" | "INFO";
  type Severity = "critical" | "high" | "medium" | "low";
  type CatalogItem = {
    id: string; section: string; sectionTitle: string; level: string; title: string; code?: string;
    mode: Mode;               // default INFO; override per item
    severity: Severity;       // default dari level (Basic→high, Inter→medium, Adv→low); override
    probe?: string;           // itemId juga = nama CHECK yang diemit audit script (item ber-probe)
    remediable?: boolean;     // true → AUTO harden script bisa apply idempoten & anti-lockout
    appLayer?: boolean;       // hint UI "kemungkinan N/A" (aapanel/webserver/database/ssl); v1 TIDAK auto-exclude
  };
  ```
  - **Default:** semua item `INFO`, `severity` dari `level`. `code` dari rujukan jadi panduan remediasi.
  - **Overrides (curated map):** item core yang punya probe deterministik → `AUDIT` (diaudit) atau `AUTO` (diaudit + boleh di-apply). Item berisiko-lockout (ganti port SSH, buat/hapus user, matikan service) **dipaksa** `AUDIT`/`INFO`, tak pernah `AUTO` (AC-16).
- **Invarian teruji:** tepat 232 item, semua `id` unik, `mode`∈enum, tiap `probe` punya emitter di script, tiap `remediable` punya step di harden script. `CHECK <itemId>` tak dikenal → diabaikan + warn (AC-3).

### 2. Data model — model Prisma baru + migration + ADR-0050 (AC-5, AC-24)

Dua model baru, relasi ke `Vps` (cascade delete):

```prisma
model VpsAuditSnapshot {          // append-only hasil satu audit (fondasi drift Fase 3)
  id             String   @id @default(cuid())
  vpsId          String
  createdAt      DateTime @default(now())
  results        Json     // { [itemId]: { status: "pass"|"fail"|"warn"|"na"|"unknown", detail } }
  scoreTotal     Float    // 0..100 (pass+attested)/applicable
  scoreBySection Json     // { [section]: number }
  vps            Vps      @relation(fields: [vpsId], references: [id], onDelete: Cascade)
  @@index([vpsId, createdAt])
}

model VpsItemState {              // keputusan human durable per item (N/A + attest)
  id         String   @id @default(cuid())
  vpsId      String
  itemId     String
  na         Boolean  @default(false)
  naReason   String?
  attested   Boolean  @default(false)
  attestNote String?
  actorEmail String?              // jejak pelaku (dari sesi auth)
  updatedAt  DateTime @default(now())
  vps        Vps      @relation(fields: [vpsId], references: [id], onDelete: Cascade)
  @@unique([vpsId, itemId])
}
```

- `Vps` mendapat back-relations `snapshots VpsAuditSnapshot[]` dan `itemStates VpsItemState[]`.
- Kolom lama `Vps.audit/hardened/lastAuditAt` **dipertahankan** (kompat monitor + VpsScreen lama selama transisi); `runAudit` mengisi keduanya (legacy JSON **dan** snapshot baru) supaya tak ada regresi. `hardened` tetap = semua CHECK kritis pass.
- Migration **hand-written** `server/prisma/migrations/2026071700_spec220_vps_compliance/migration.sql`; `migrate deploy` per DB (`hanoman`, `hanoman_test`) dengan env override (bukan `migrate dev`). `prisma generate` sesudahnya.

### 3. Audit engine → mapping katalog + scoring (AC-4, AC-6, AC-7, AC-8)

- `audit.sh` diperluas: selain baris legacy, mengemit `CHECK <itemId> <pass|fail|warn|na> <detail>` untuk **item ber-probe** (memakai itemId katalog, mis. `CHECK ssh-i2 pass`). Probe baru lintas seksi core (SSH, Firewall, Kernel/sysctl, Updates, Fail2ban/IDS, Logging dasar) — hanya yang punya cara deteksi deterministik & multi-distro. Distro tak didukung → `os_supported fail` + berhenti (AC-8).
- `vps-audit.ts` / `vps-scoring.ts` (baru): `mapToCatalog(checks)` → status per itemId; item ber-probe tanpa hasil / tak terbaca → `unknown`/`fail` (bukan `pass`, AC-7); itemId asing diabaikan + warn (AC-3).
- **Scoring (equal weight, PRD open Q1 v1):** `score = (pass + attested) / applicable`. `applicable` = item **tidak** ber-`na`. Item `INFO` dihitung terpenuhi hanya bila `attested`. Item non-probe non-attest = belum-terpenuhi. Hitung per-seksi + total → simpan di snapshot.

### 4. Checklist UI (`VpsScreen.tsx`) — AC-9, AC-10, AC-11, AC-12

- Detail pane VPS jadi **checklist per-seksi**: header seksi + skor per-seksi (bar), skor total di atas. Tiap baris item: ikon status, judul, badge `mode`+`severity`, aksi kontekstual.
- **Filter** (AC-12): seksi, mode, status, severity.
- **N/A** (AC-10): toggle per item + alasan → `POST /vps/:id/items/:itemId/na`; item keluar dari denominator, pelaku+alasan tercatat.
- **Attest** (AC-11): item `INFO` → tombol Attest + catatan opsional → `POST …/attest`; tercatat pelaku+timestamp, dihitung terpenuhi.
- Pelaku = email dari sesi auth (`req.user`).

### 5. Remediasi selektif AUTO (Fase 2) — AC-13…AC-17, AC-15, AC-16, AC-22

- `harden.sh` (atau `remediate.sh` baru) menerima seleksi item via `ITEMS=<id,id,…>` dan mode `DRY_RUN=1`.
  - **Dry-run** (AC-13): cetak `STEP <item> would <detail>` **tanpa** menyentuh VPS.
  - **Apply** (AC-14): `STEP <item> <ok|fail> <detail>`, idempoten (AC-22).
  - Anti-lockout dipertahankan: firewall allow port SSH sebelum enable; **`sshd -t` wajib pass sebelum reload**, batal bila gagal (AC-15).
  - Hanya item `remediable=AUTO` yang bisa dieksekusi; itemId berisiko/di luar AUTO ditolak skrip (AC-16).
- Endpoint:
  - `POST /vps/:id/remediate/preview { items[] }` → dry-run, kembalikan transcript `would` (AC-13).
  - `POST /vps/:id/remediate { items[] }` → apply, verifikasi koneksi baru, lalu **re-audit** (AC-17), kembalikan transcript + audit + skor baru.
- UI: multi-select item `AUTO` → **Preview** (tampilkan diff/would) → **Apply**.

### 6. Kontrak API (ringkas)

| method | path | fungsi | AC |
|---|---|---|---|
| POST | `/vps/:id/audit` | audit → map katalog → snapshot + skor (existing, diperluas) | 4,5,6 |
| GET | `/vps/:id/checklist` | katalog + status terkini + itemStates + skor | 9 |
| POST | `/vps/:id/items/:itemId/na` | tandai/lepas N/A + alasan | 10 |
| POST | `/vps/:id/items/:itemId/attest` | attest INFO + catatan | 11 |
| POST | `/vps/:id/remediate/preview` | dry-run item AUTO terpilih | 13 |
| POST | `/vps/:id/remediate` | apply item AUTO + re-audit | 14,15,16,17 |

Checklist bisa juga difoldkan ke `VpsView` (WS siar grup `vps`) agar konsisten realtime; keputusan detail di plan. Semua di bawah gate auth + bind 127.0.0.1 (ADR-0028), seperti route vps lain.

### 7. Docs & ADR (AC-24; konvensi SoT)

- **ADR-0050** (baru): "Kerangka kepatuhan VPS — katalog 232 item di git + model state per-VPS + scoring + remediasi dry-run". Mencatat: katalog di git bukan DB, dua model baru, taksonomi mode/severity, equal-weight scoring v1, dry-run sebagai pengaman pengganti rollback, item berisiko tetap non-AUTO. Meng-extend ADR-0025.
- Update `internal/docs/architecture/data-model.md` (dua model baru + relasi), `api-contract.md` (endpoint baru), dan doc baru `internal/docs/architecture/vps-compliance.md` (katalog, mode, scoring). Link semua di `internal/docs/README.md`. Semua dalam commit yang menyentuhnya.

## Testing (TDD)

- **catalog**: 232 item, id unik, mode/severity valid, tiap probe/remediable punya emitter/step (unit, dep-free).
- **scoring**: `(pass+attested)/applicable`, N/A keluar denominator, INFO tanpa attest tak dihitung, per-seksi vs total (unit).
- **parse/map**: `CHECK <itemId>` → status; itemId asing diabaikan+warn (AC-3); un-auditable→fail bukan pass (AC-7); distro asing gagal dini (AC-8) — fixture os-release.
- **routes** (server suite): audit menyimpan snapshot+skor (AC-5); na/attest mengubah skor + jejak pelaku (AC-10/11); preview tak mengubah (AC-13); apply idempoten + sshd-t guard (AC-14/15/22); item non-AUTO ditolak (AC-16); re-audit pasca-apply (AC-17).
- **UI** (`vps-screen.test.tsx`): render checklist per-seksi + skor; filter; aksi N/A/attest; select→preview→apply. Terminal test viewport-fragile → perhatikan ukuran render.
- Live: boot server + curl tiap endpoint (kontrak repo). Audit/remediate nyata butuh VPS ber-SSH → uji parser/scoring dengan fixture + endpoint dengan VPS dummy (mock sshExec bila perlu, pola test existing).

## Rencana PR (garis besar; detail di plan)

1. **PR1 — Katalog + data model:** generator + `catalog.data.ts`/`catalog.ts`, overrides awal, DTO shared, model Prisma + migration + `migrate deploy`, ADR-0050 + docs, unit test katalog+scoring.
2. **PR2 — Audit → katalog + skor:** perluas `audit.sh` probe core, `vps-audit.ts`/`vps-scoring.ts`, `POST /audit` simpan snapshot, `GET /checklist`, test parse/map/skor/distro.
3. **PR3 — Checklist UI + N/A + attest:** rework VpsScreen, endpoint na/attest, jejak pelaku, test UI+route.
4. **PR4 — Remediasi selektif (Fase 2):** dry-run + seleksi di harden script, endpoint preview/apply + re-audit, UI select→preview→apply, test anti-lockout/idempoten.

Tiap PR harus hijau (`vitest run --no-file-parallelism`) + endpoint teruji live sebelum lanjut (ADR-0029 menahan `executing` selama plan punya `- [ ]`).

## Non-goals (tegas)

Tanpa cron/scheduler baru, tanpa rollback otomatis, tanpa laporan pihak ketiga, tanpa RBAC/multi-tenant, tanpa distro baru, tanpa remediasi otomatis item berisiko-lockout, dan **tanpa** deteksi drift/Notification (itu Fase 3).
