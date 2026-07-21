# Audit SPEC-271 — Unlink backlog dari triase (Errors & Help Desk)

> Nomor doc **271** dipakai karena SPEC-270 sudah terklaim di docs untuk pekerjaan lain
> (`docs(spec-270): design sync self-healing`). Backlog item hanoman tetap SPEC-270; branch
> push tetap `hanoman/spec-270`. ADR-0021 (nomor diklaim docs) → hindari bentrok.

## Keluhan (sumber: qa, prioritas tinggi, severity major)
- **actual:** "saat ini ketika sudah masuk ke backlog tidak bisa unlink"
- **expected:** "dapat melakukan unlink ke backlog dan dapat eskalasi ke backlog lagi"

## Root cause (Phase 1 — systematic-debugging)
Eskalasi triase membuat tautan **dua arah satu kali jalan** yang tak punya operasi kebalikan:

- **Errors** (`server/src/routes/errors.ts` `POST /errors/:id/escalate`): membuat `Spec`
  (source `qa`), lalu `errorGroup.update({ status: "escalated", specId: spec.id })`. Idempoten:
  bila `g.specId` sudah ada → balas `alreadyEscalated`. Tak ada endpoint untuk mereset `specId`.
- **Tickets** (`server/src/routes/tickets.ts` `POST /tickets/:id/accept`): serupa — `Spec`
  (source `help`), `ticket.update({ status: "accepted", specId: spec.id })`. Tak ada kebalikan.
- **UI** (`ErrorsScreen.tsx` baris 98–100, `TriageScreen.tsx` baris 138–139): begitu `specId`
  terisi, tombol aksi diganti **Badge statis** `→ <specId>`. Tak ada jalan mundur di UI, sehingga
  eskalasi ulang pun mustahil (tombol eskalasi/terima tak pernah muncul lagi).

Jadi bukan bug logika — **fitur unlink memang belum ada**. Konfirmasi: enum status
(`shared/src/enums.ts`) sudah punya `new` untuk kedua entitas → reset status aman.

## Keputusan perbaikan (human decision, 2026-07-21)
Unlink = **putus tautan saja, non-destruktif**. Spec hasil eskalasi **tetap** di backlog
(user bisa hapus manual). Alternatif "putus link + hapus Spec" ditolak: berisiko bila Spec
sudah punya sesi/worktree/commit. Diputuskan langsung → **Spec & Plan di-skip**, dokumen ini
jadi doc-of-record.

## Perbaikan (diff kecil, additive)
1. **Server** — dua endpoint idempoten:
   - `POST /errors/:id/unlink` → bila `specId` ada: `{ status: "new", specId: null }` +
     `notifySynced("errorGroup", id)`. Bila sudah lepas / 404 tetap ditangani.
   - `POST /tickets/:id/unlink` → bila `specId` ada: `{ status: "new", specId: null }` +
     `notifySynced("ticket", id)`.
   - Setelah unlink, `escalate`/`accept` berjalan lagi (guard `if (specId)` kini lepas) →
     memenuhi "dapat eskalasi ke backlog lagi". Spec baru dibuat saat re-eskalasi.
2. **shared** — `paths.errorUnlink(id)`, `paths.ticketUnlink(id)`.
3. **Client** — `api.unlinkError(id)`, `api.unlinkTicket(id)`.
4. **UI** — di detail Errors & Triase, saat `specId` terisi tampilkan tombol **Unlink**
   di samping badge `→ specId`; setelah sukses, reload → tombol Eskalasi/Terima muncul lagi.
5. **Docs** — `api-contract.md` menambah dua endpoint; index menaut dokumen ini.

## Verifikasi
- Test server: unlink errors & tickets (mereset status+specId, idempoten, 404, lalu bisa
  eskalasi ulang membuat Spec baru).
- Boot server lokal + curl endpoint yang tersentuh.
