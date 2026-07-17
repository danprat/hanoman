# ADR-0050 — Kepatuhan VPS: katalog 232 item di git + model state + scoring + remediasi dry-run

**Status:** diterima · 2026-07-17 · SPEC-220 · meng-*extend* [ADR-0025](0025-modul-vps-script-deterministik.md)

## Konteks

Modul VPS (ADR-0025) hanya menutup 5 langkah harden + ±9 audit. PRD `docs/prd/hardening-vps-checklist.md`
memperluasnya jadi **kerangka kepatuhan berbasis checklist 232 item / 16 seksi** (rujukan
https://bzn2026.lovable.app/) dengan skor kepatuhan per-VPS, checklist UI, penandaan N/A + attestasi,
dan remediasi selektif. Batasan arsitektur tetap: skrip deterministik SSH+sudo (bukan sesi Claude),
tanpa scheduler/cron baru (ADR-0024), multi-distro, idempoten, anti-lockout. Perubahan skema butuh
migration + ADR.

## Keputusan

1. **Katalog kanonik di git, bukan DB** (AC-1/AC-2). 232 item hidup di `server/src/vps/catalog/`:
   `catalog.data.ts` **di-generate** dari checklist rujukan (`server/scripts/gen-catalog.mjs`), dan
   `catalog.ts` menggabungnya dengan metadata hanoman di `overrides.ts`. Perubahan katalog lewat commit,
   tidak pernah diedit runtime lewat DB.
2. **Taksonomi mode per item**: `AUTO` (diaudit + boleh di-apply idempoten & anti-lockout), `AUDIT`
   (diaudit, remediasi manual), `INFO` (attestasi manual). Default item = `INFO`; hanya item ber-probe
   yang di-override. **Item berisiko-lockout** (ganti port SSH, disable root/password login, buat/hapus
   user, matikan service kritis) **wajib** `AUDIT`/`INFO`, tak pernah `AUTO` (AC-16). `severity` default
   dari level rujukan (Basic→high, Intermediate→medium, Advanced→low), bisa di-override.
3. **Dua model Prisma baru** (migration `2026071700_spec220_vps_compliance`, additive):
   - `VpsAuditSnapshot` — **append-only** hasil satu audit (`results` per itemId + skor). Menyimpan riwayat
     dan menjadi **fondasi deteksi drift Fase 3** (di luar spec ini).
   - `VpsItemState` — keputusan human **durable** per item: N/A (`na`/`naReason`) dan attestasi
     (`attested`/`attestNote`), dengan `actorEmail` sebagai jejak pelaku. Unik per `(vpsId, itemId)`.
   Kolom lama `Vps.audit/hardened/lastAuditAt` **dipertahankan** (kompat monitor + UI lama); `runAudit`
   mengisi keduanya.
4. **Scoring equal-weight v1** (PRD open Q1): `skor = (pass + attested) / applicable`, dihitung per-seksi
   & total. Item ber-`na` **keluar** dari pembilang & penyebut (AC-6/AC-10). Item `INFO` dihitung
   terpenuhi hanya bila `attested` (AC-11). Item ber-probe tanpa hasil/tak terbaca → `unknown`, **bukan**
   `pass` (AC-7).
5. **Remediasi selektif dengan dry-run sebagai pengaman** (Fase 2). `remediate.sh` menerima seleksi item
   (`ITEMS=`) + mode `DRY_RUN=1`; preview mencetak `STEP <item> would …` tanpa menyentuh VPS (AC-13),
   apply mencetak `STEP <item> ok|fail`. Anti-lockout dipertahankan (`sshd -t` sebelum reload, firewall
   allow SSH sebelum enable). **Tanpa rollback otomatis v1** — dry-run + pengecualian item berisiko adalah
   penggantinya (PRD Non-goal).
6. **Tanpa scheduler/cron baru** (AC-20). Re-audit dipicu manual/on-view; loop `setInterval` existing
   (health 5 mnt, audit 24 jam) tak ditambah.

## Konsekuensi

- `audit.sh` mengemit baris tambahan `CHECK <itemId> <pass|fail|warn|na> <detail>` (itemId katalog) di
  samping baris legacy; `vps-audit.ts` memetakannya ke katalog & menghitung skor. itemId asing diabaikan
  aman + warn (AC-3), tidak crash.
- Endpoint baru di bawah gate auth + bind 127.0.0.1 (seperti route vps lain): `GET /vps/:id/checklist`,
  `POST /vps/:id/items/:itemId/na`, `POST /vps/:id/items/:itemId/attest`, `POST /vps/:id/remediate/preview`,
  `POST /vps/:id/remediate`.
- Deteksi drift + Notification (AC-19) dan auto-deteksi applicability app-layer **ditunda ke Fase 3** —
  snapshot append-only sudah menyiapkan datanya.
- Cakupan probe awal: seksi core (SSH, Firewall, Fail2ban/IDS, System updates, Kernel sysctl). Item lain
  default `INFO` (attestasi) sampai probe ditambahkan lewat commit berikutnya — bukan `pass` palsu.
