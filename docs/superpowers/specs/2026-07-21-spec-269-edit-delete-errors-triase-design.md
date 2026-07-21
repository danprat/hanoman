# SPEC-269 — Edit & hapus item Errors & Triase + modal konfirmasi hapus

**Status:** design · **Prioritas:** tinggi · **Flow:** feature (spec → plan → execute)

## Konteks & masalah

Dua area monitoring belum punya kontrol edit/hapus di UI:

- **Errors** (`ErrorGroup`/`ErrorEvent`, SPEC-249/ADR-0060) — hanya bisa eskalasi & "Tandai resolved". Tak ada cara menghapus grup error yang sudah usang/salah, dan editing status terbatas (hanya → resolved).
- **Triase** (Help Center `Ticket`, SPEC-253/ADR-0062) — hanya accept/reject. Tak bisa mengoreksi isi tiket (title/detail/category) maupun menghapus tiket. Reject memakai `window.confirm` native, bukan modal.

Objektif: tambahkan **edit** & **delete** untuk item errors dan triase, plus **modal konfirmasi** untuk aksi penghapusan data.

## Keputusan cakupan (dikonfirmasi human)

| Area | Edit | Delete |
|------|------|--------|
| **Errors** | **Status saja** (`new`/`escalated`/`resolved`) — message/type/fingerprint berasal dari SDK, tak diedit manual. `PATCH /errors/:id {status}` sudah ada; UI diberi selector status penuh (bukan cuma "resolved"). | `DELETE /errors/:id` (baru) — cascade `ErrorEvent`. |
| **Triase** | **Penuh**: `title`, `detail`, `category`, `status`. `PATCH /tickets/:id` (baru). | `DELETE /tickets/:id` (baru) — cascade `TicketAttachment` (DB) + hapus file fisik di upload dir. |

**Tanpa perubahan skema** → tanpa migration, tanpa ADR baru. Semua memakai model & cascade yang sudah ada. Endpoint baru rutin di atas model existing.

## Arsitektur & perubahan

### Server (Fastify)

**`server/src/routes/errors.ts`**
- `PATCH /errors/:id` — tetap (validasi `zErrorStatus`). Ini "edit" errors.
- **`DELETE /errors/:id`** (baru) — `prisma.errorGroup.delete({ where:{id} })`; events cascade. 404 bila tak ada. Return `{ ok: true }`.

**`server/src/routes/tickets.ts`**
- **`PATCH /tickets/:id`** (baru) — body `zTicketEditInput` (semua opsional: `title`, `detail`, `category`, `status`). Update kolom yang dikirim. Return `zTicketDetail`. 404 bila tak ada.
- **`DELETE /tickets/:id`** (baru) — ambil attachments dulu → hapus file fisik via `services/uploads.ts` (best-effort, tak gagalkan request bila file hilang) → `prisma.ticket.delete` (rows attachment cascade). Return `{ ok: true }`.

**Sync/outbox:** `ErrorGroup`/`Ticket` bukan record-type yang disync (outbox hanya untuk `spec` dsb.); delete/edit **tidak** meng-`enqueueOutbox`. Konsisten dengan handler accept/escalate yang hanya enqueue `spec` yang mereka buat, bukan error/ticket-nya.

**Agent capability:** otomatis tercakup — `capabilityForRoute` memetakan `errors`/`tickets` → `support`, dan method non-GET → `support:write` (`agent-capabilities.ts:14,25`). Tak ada perubahan map.

### Shared

- **`shared/src/dto.ts`** — tambah `zTicketEditInput = z.object({ title, detail, category (zTicketCategory), status (zTicketStatus) }).partial()` dengan `.strict()`; minimal satu field (refine non-empty).
- **`shared/src/api.ts`** — reuse `paths.error(id)` & `paths.ticket(id)`. Tanpa path baru.

### Client (`src/src`)

- **`src/src/api/client.ts`** — tambah `deleteError(id)`, `deleteTicket(id)`, `editTicket(id, input)`. (`patchError` untuk status sudah ada.)
- **DS baru — `src/src/ds/ConfirmDialog.tsx`** — komponen konfirmasi reusable di atas `Modal` (`ds/kit.tsx`). Props: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `tone` (`danger`|`default`), `busy`, `onConfirm`, `onCancel`. Dua tombol footer (Batal + konfirmasi). Diekspor via `ds/index.ts`.
- **`ErrorsScreen.tsx` `GroupDetail`** — ganti tombol tunggal "Tandai resolved" jadi **selector status** (new/escalated/resolved via `patchError`) + tombol **Hapus** (icon `trash-2`) → `ConfirmDialog` → `deleteError` → keluar dari detail + refresh list.
- **`TriageScreen.tsx` `TicketDetailView`** — tambah mode **Edit** (form title/detail/category/status → `editTicket`) + tombol **Hapus** → `ConfirmDialog` → `deleteTicket` → refresh. Accept/reject tetap. (Reject `window.confirm` di luar cakupan; opsional diseragamkan nanti.)

## Error handling

- DELETE/PATCH pada id tak dikenal → 404 (`{ error }`), UI tampilkan pesan & refresh list.
- Hapus file attachment best-effort: kegagalan unlink di-log, tak menggagalkan penghapusan tiket (baris DB adalah sumber kebenaran; file yatim jarang & tak fatal).
- Optimistic-ish: tombol konfirmasi `busy` selama request; modal tertutup on success.

## Testing (TDD)

- **`server/test/errors.route.test.ts`** — `DELETE /errors/:id` menghapus grup + events; 404 untuk id asing.
- **`server/test/tickets.test.ts`** — `PATCH /tickets/:id` mengubah title/detail/category/status; `DELETE /tickets/:id` menghapus tiket + attachment rows; 404 asing; edit dgn body kosong → 400.
- **`server/test/agent-capabilities.test.ts`** — pastikan `DELETE /errors/:id` & `PATCH/DELETE /tickets/:id` → `support:write` (kemungkinan sudah lulus lewat mapping generik).
- **`src/test/errors-screen.test.tsx`** — selector status + hapus (modal konfirmasi muncul, konfirmasi memanggil `deleteError`).
- **`src/test/triage.test.tsx`** — edit tiket + hapus via modal.
- **`src/test/confirm-dialog.test.tsx`** (baru) — modal render, Batal menutup tanpa aksi, konfirmasi memanggil `onConfirm`.

## Docs tersentuh (commit sama)

- `internal/docs/architecture/api-contract.md` — dokumentasikan `DELETE /errors/:id`, `PATCH /tickets/:id`, `DELETE /tickets/:id`.
- `internal/docs/README.md` — index tetap (link api-contract sudah ada); tambah baris audit/riwayat bila perlu.

## Non-goals (YAGNI)

- Bukan edit message/type/fingerprint error (data SDK).
- Bukan hapus per-event individual (hanya per-grup).
- Bukan menyeragamkan reject `window.confirm` (opsional, di luar cakupan).
- Tanpa perubahan sync/outbox.
