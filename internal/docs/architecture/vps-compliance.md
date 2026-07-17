# VPS Compliance — kerangka kepatuhan berbasis checklist

> SPEC-220 · [ADR-0050](../adr/0050-vps-compliance-katalog-scoring.md) (extends [ADR-0025](../adr/0025-modul-vps-script-deterministik.md))

Memperluas modul VPS dari "5 langkah harden + ±9 audit" menjadi **checklist 232 item / 16 seksi** dengan
skor kepatuhan per-VPS, penandaan N/A, attestasi manual, dan remediasi selektif AUTO dengan preview
dry-run. Semua audit/apply tetap **skrip deterministik SSH+sudo**, tanpa cron baru (ADR-0024).

## Katalog (sumber kebenaran di git)

Direktori `server/src/vps/catalog/`:

- `catalog.data.ts` — **di-generate** oleh `server/scripts/gen-catalog.mjs` dari checklist rujukan
  (https://bzn2026.lovable.app/). Berisi 232 item mentah `{ id, section, sectionTitle, level, title, code? }`
  dan 16 `RAW_SECTIONS`. Regenerasi bila rujukan berubah:
  `node server/scripts/gen-catalog.mjs <bzn_catalog.json>` (ekstraktor: `scratchpad/extract_catalog.mjs`).
- `overrides.ts` — metadata hanoman per itemId: `mode`, `severity`, `probe`, `remediable`.
- `catalog.ts` — menggabung keduanya jadi `CATALOG: CatalogItem[]` + `SECTIONS` + `byId()`.

### Mode & severity

| mode | arti |
|---|---|
| `AUTO` | diaudit **dan** boleh di-apply idempoten & anti-lockout (`remediate.sh`) |
| `AUDIT` | diaudit (probe), remediasi **manual** — termasuk item berisiko-lockout (AC-16) |
| `INFO` | attestasi manual (checkbox + catatan), tanpa probe |

Default item = `INFO`, `severity` dari level (Basic→high, Intermediate→medium, Advanced→low). `remediable`
hanya untuk `AUTO`. Item berisiko-lockout (`ssh-b1/b2/b3`, `usr-b2`, …) **tak pernah** `AUTO`.

## Audit → mapping → skor

1. `audit.sh` mengemit `CHECK <itemId> <pass|fail|warn|na> <detail>` untuk item ber-`probe` (di samping
   baris legacy). Distro tak didukung → gagal dini.
2. `vps-audit.ts` `mapToCatalog()` memetakan tiap `CHECK` ke item katalog; itemId asing **diabaikan** +
   warn (AC-3), item ber-probe tanpa hasil → `unknown` (bukan `pass`, AC-7).
3. `scoring.ts` `scoreCompliance()` menghitung **`(pass + attested) / applicable`** per-seksi & total
   (equal-weight v1). Item ber-`na` keluar dari pembilang & penyebut.
4. Hasil disimpan sebagai `VpsAuditSnapshot` (append-only) + tetap mengisi `Vps.audit/hardened/lastAuditAt`.

## Keputusan human per item

`VpsItemState` (unik per `vpsId,itemId`) menyimpan:
- **N/A** — item dikeluarkan dari skor, dengan `naReason` + `actorEmail`.
- **Attest** (item `INFO`) — `attested` + `attestNote` + `actorEmail`; dihitung terpenuhi.

## Remediasi selektif AUTO (Fase 2)

- `remediate.sh` — env `ITEMS=<id,…>` + `DRY_RUN=1`. Preview: `STEP <item> would …` (tak menyentuh VPS,
  AC-13). Apply: `STEP <item> ok|fail …`, idempoten (AC-22). Item non-AUTO ditolak (AC-16). Anti-lockout:
  firewall allow SSH sebelum enable; `sshd -t` wajib pass sebelum reload (AC-15).
- Endpoint `POST /vps/:id/remediate/preview` (dry-run) dan `POST /vps/:id/remediate` (apply → verifikasi
  koneksi → re-audit, AC-17).

## Endpoint

Lihat [api-contract.md](api-contract.md#vps) bagian VPS. Semua di bawah gate auth + bind 127.0.0.1.

## Di luar cakupan (Fase 3)

Deteksi drift + Notification (AC-19), auto-deteksi applicability app-layer (aaPanel/web/DB/SSL). Snapshot
append-only menyiapkan datanya.
