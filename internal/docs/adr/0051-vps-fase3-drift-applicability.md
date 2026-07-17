# ADR-0051 — Kepatuhan VPS Fase 3: drift derived + Notification agregat, applicability app-layer advisory

**Status:** diterima · 2026-07-17 · SPEC-221 · meng-*extend* [ADR-0050](0050-vps-compliance-katalog-scoring.md)

## Konteks

SPEC-220 (Fase 1+2) memberi katalog 232 item, audit→skor, checklist, N/A/attest, dan remediasi selektif.
PRD `hardening-vps-checklist.md` Fase 3 menuntut **monitoring proaktif**: deteksi drift + Notification
(AC-19) dan applicability item app-layer (aaPanel/web/DB/SSL). Batasan tetap: tanpa cron/scheduler baru
(ADR-0024); fleet Nafanesia banyak **dockerized** (Caddy + Postgres di container) sehingga probe paket/port
bare-metal rawan **false-negative** untuk item app-layer.

## Keputusan

1. **Drift adalah nilai turunan, bukan tabel baru.** `runAudit` mem-diff `results` snapshot **sebelumnya**
   dengan snapshot **baru** (`VpsAuditSnapshot`, append-only dari ADR-0050). Drift = item `pass` → `fail`
   atau `warn`. **`pass → unknown` BUKAN drift** — `unknown` berarti audit tak terbaca (mis. `sshd -T`
   gagal sesaat), sering transien → menghindari alarm palsu. `computeDrift` fungsi murni (`vps/drift.ts`).
2. **Notification drift agregat per-audit.** Bila ≥1 item regresi, satu Notification `type: "drift"` dibuat
   (bukan per item — patuh "instrument panel yang tenang"), judul meringkas ≤5 id + "+K lagi". Dedup
   `key: "drift:<vpsId>:<snapshotId>"` idempoten. `recordDrift` di `services/notifications.ts` (meniru
   pola `recordCompletion`). Muncul di feed `GET /notifications` existing.
3. **Applicability app-layer = ADVISORY, bukan auto-exclude.** `audit.sh` mendeteksi stack terpasang dan
   mengemit `STACK <section> <present|absent>`; hasilnya disimpan di kolom additive
   `VpsAuditSnapshot.detected` (`{ [section]: { present, detail } }`). `buildChecklist` menurunkan
   `suggestion` per-seksi app-layer: bila stack tak terdeteksi → **saran** "kemungkinan N/A". UI menampilkan
   banner + tombol "Tandai seksi N/A" (bulk). **Skor TIDAK berubah** sampai manusia menandai N/A. Alasannya:
   host dockerized bisa menjalankan web/DB di container yang tak terdeteksi → auto-exclude akan
   menyembunyikan gap nyata. Manusia tetap yang memutuskan (prinsip produk).
4. **Bulk N/A endpoint** `POST /vps/:id/items/na-bulk { itemIds, na, reason? }` — menandai banyak item
   sekaligus (untuk "tandai seksi N/A"); itemId asing dalam batch menolak seluruh batch (400).
5. **Tanpa cron baru** (AC-20). Drift & deteksi stack dihitung saat audit dipicu manual/on-view; loop
   `setInterval` existing (health 5 mnt, audit 24 jam) tak ditambah.

## Konsekuensi

- Satu-satunya perubahan skema: kolom additive `VpsAuditSnapshot.detected Json?` (migration
  `2026071710_spec221_stack_detected`, `migrate deploy` per DB). Tak ada tabel/model baru.
- `ChecklistItem` dapat field turunan `drifted`; `ChecklistSection` dapat `suggestion?`. `POST /audit`
  response tambah `drift[]`.
- Deteksi stack **best-effort**: `absent` bukan bukti pasti (container tak terlihat) — karena itu advisory.
- Ekstensi masa depan (di luar SPEC-221): auto-deteksi applicability yang lebih pintar (mengintip Docker),
  drift per-severity, atau kebijakan kedaluwarsa attestasi (PRD open questions) — butuh ADR sendiri.
