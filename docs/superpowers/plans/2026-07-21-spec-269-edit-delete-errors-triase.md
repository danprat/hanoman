# SPEC-269 — Edit & hapus Errors/Triase + modal konfirmasi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah edit (status untuk Errors; title/detail/category/status untuk Triase) + delete untuk kedua area, dengan modal konfirmasi hapus reusable.

**Architecture:** Endpoint CRUD baru di atas model existing (`ErrorGroup`, `Ticket`) — cascade Prisma sudah menangani `ErrorEvent`/`TicketAttachment`; file lampiran fisik dibersihkan via `deleteUpload`. Frontend memakai komponen `ConfirmDialog` baru (di atas `Modal` DS) untuk semua aksi hapus.

**Tech Stack:** Fastify + Prisma + zod (`@hanoman/shared`), React + TS DS.

## Global Constraints

- TypeScript strict.
- Tanpa perubahan skema → tanpa migration, tanpa ADR baru (SKILL: "Jangan ubah skema tanpa migration + ADR" — kita tak mengubah skema).
- Test repo: `env -u NODE_ENV -u DATABASE_URL pnpm --filter … vitest run --no-file-parallelism`.
- Enum divalidasi via zod di `@hanoman/shared` (`zTicketCategory`, `zTicketStatus`, `zErrorStatus`).
- Agent capability otomatis: `errors`/`tickets` non-GET → `support:write` (tanpa perubahan map).
- Docs tersentuh diperbarui dalam commit yang sama + ter-link di index.

---

### Task 1: Shared — DTO input edit tiket

**Files:**
- Modify: `shared/src/dto.ts`

**Interfaces:**
- Produces: `zTicketEditInput` (zod, partial, refine non-empty), `type TicketEditInput`.

- [ ] **Step 1: Tambah DTO di `shared/src/dto.ts`** setelah `zTicketDetail` (sekitar line 317). Pastikan `zTicketCategory` & `zTicketStatus` ter-import dari `./enums` di atas file (tambahkan bila belum).

```ts
// SPEC-269 · input edit tiket (triase). Semua field opsional; minimal satu.
export const zTicketEditInput = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(20000),
    category: zTicketCategory,
    status: zTicketStatus,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "tak ada field yang diubah" });
export type TicketEditInput = z.infer<typeof zTicketEditInput>;
```

- [ ] **Step 2: Verifikasi import enum.** Cek baris import di atas `dto.ts`; jika `zTicketCategory`/`zTicketStatus` belum diimpor, tambahkan ke import dari `./enums`.

- [ ] **Step 3: Build shared** — `pnpm --filter @hanoman/shared build`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add shared/src/dto.ts
git commit -m "feat(spec-269): shared zTicketEditInput DTO"
```

---

### Task 2: Server — `DELETE /errors/:id`

**Files:**
- Modify: `server/src/routes/errors.ts` (setelah handler `patch("/errors/:id")`, ~line 113)
- Test: `server/test/errors.route.test.ts`

**Interfaces:**
- Produces: `DELETE /api/errors/:id` → `{ ok: true }`; 404 bila tak ada. Events cascade.

- [ ] **Step 1: Tulis test gagal** di `server/test/errors.route.test.ts` (tambah `it` di describe yang ada; sesuaikan helper pembuat grup dengan yang sudah dipakai file itu):

```ts
it("DELETE /errors/:id menghapus grup + events; 404 id asing", async () => {
  const g = await prisma.errorGroup.create({
    data: { projectId: PROJECT_ID, fingerprint: "del-fp", type: "Err", message: "hapus aku", environment: "production", status: "new", count: 2 },
  });
  await prisma.errorEvent.create({ data: { groupId: g.id, projectId: PROJECT_ID, type: "Err", message: "e", environment: "production" } });
  const res = await app.inject({ method: "DELETE", url: `/api/errors/${g.id}` });
  expect(res.statusCode).toBe(200);
  expect(res.json().ok).toBe(true);
  expect(await prisma.errorGroup.findUnique({ where: { id: g.id } })).toBeNull();
  expect(await prisma.errorEvent.count({ where: { groupId: g.id } })).toBe(0);
  expect((await app.inject({ method: "DELETE", url: "/api/errors/tak-ada" })).statusCode).toBe(404);
});
```
> Catatan eksekusi: baca file test dulu untuk `PROJECT_ID`/helper yang benar; sesuaikan nama.

- [ ] **Step 2: Jalankan test → gagal** (route belum ada). Expected: FAIL 404/501.

- [ ] **Step 3: Implementasi** — tambah handler di `errors.ts` setelah `patch`:

```ts
  // SPEC-269 · hapus grup error (events cascade via onDelete: Cascade).
  app.delete("/errors/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: "not found" });
    await prisma.errorGroup.delete({ where: { id } });
    return { ok: true };
  });
```

- [ ] **Step 4: Jalankan test → lulus.**

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/errors.ts server/test/errors.route.test.ts
git commit -m "feat(spec-269): DELETE /errors/:id (cascade events)"
```

---

### Task 3: Server — `PATCH /tickets/:id` (edit) + `DELETE /tickets/:id`

**Files:**
- Modify: `server/src/routes/tickets.ts` (import + dua handler baru)
- Test: `server/test/tickets.test.ts`

**Interfaces:**
- Consumes: `zTicketEditInput` (Task 1), `deleteUpload` (services/uploads).
- Produces: `PATCH /api/tickets/:id` → `TicketDetail`(+spec); `DELETE /api/tickets/:id` → `{ ok: true }`.

- [ ] **Step 1: Tulis test gagal** — tambah describe di `server/test/tickets.test.ts`:

```ts
describe("SPEC-269 · edit & hapus tiket", () => {
  it("PATCH /tickets/:id mengubah title/detail/category/status", async () => {
    const { ticket } = await createTicket({ projectId: "tri-proj", category: "bug", title: "lama", detail: "d lama", reporterEmail: "e@e.co" });
    const res = await app.inject({ method: "PATCH", url: `/api/tickets/${ticket.id}`, payload: { title: "baru", detail: "d baru", category: "fitur", status: "accepted" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("baru");
    expect(res.json().detail).toBe("d baru");
    expect(res.json().category).toBe("fitur");
    expect(res.json().status).toBe("accepted");
  });
  it("PATCH body kosong → 400; id asing → 404", async () => {
    const { ticket } = await createTicket({ projectId: "tri-proj", category: "bug", title: "x", detail: "d", reporterEmail: "e@e.co" });
    expect((await app.inject({ method: "PATCH", url: `/api/tickets/${ticket.id}`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/tickets/tak-ada", payload: { title: "z" } })).statusCode).toBe(404);
  });
  it("DELETE /tickets/:id menghapus tiket + attachment rows; 404 asing", async () => {
    const { ticket } = await createTicket({ projectId: "tri-proj", category: "bug", title: "buang", detail: "d", reporterEmail: "e@e.co" });
    const { storageKey, size } = await saveUpload(Buffer.from("IMG"), "image/png");
    await prisma.ticketAttachment.create({ data: { ticketId: ticket.id, projectId: "tri-proj", filename: "s.png", mimeType: "image/png", size, storageKey } });
    const res = await app.inject({ method: "DELETE", url: `/api/tickets/${ticket.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toBeNull();
    expect(await prisma.ticketAttachment.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect((await app.inject({ method: "DELETE", url: "/api/tickets/tak-ada" })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Jalankan test → gagal.**

- [ ] **Step 3: Implementasi** — di `tickets.ts`: (a) ubah import uploads jadi `import { readUpload, deleteUpload } from "../services/uploads";`; (b) tambah import `import { zTicketEditInput } from "@hanoman/shared";`; (c) tambah handler setelah `reject`:

```ts
  // SPEC-269 · edit isi tiket (triase). Field opsional; minimal satu.
  app.patch("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zTicketEditInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({
      where: { id }, data: parsed.data,
      include: { attachments: true, _count: { select: { attachments: true } } },
    });
    const spec = updated.specId ? await prisma.spec.findUnique({ where: { id: updated.specId } }) : null;
    return {
      ...view(updated), detail: updated.detail,
      attachments: updated.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec,
    };
  });

  // SPEC-269 · hapus tiket + lampiran (rows cascade; file fisik dibersihkan best-effort).
  app.delete("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true } });
    if (!t) return reply.code(404).send({ error: "not found" });
    for (const a of t.attachments) await deleteUpload(a.storageKey);
    await prisma.ticket.delete({ where: { id } });
    return { ok: true };
  });
```

- [ ] **Step 4: Jalankan test → lulus.**

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/tickets.ts server/test/tickets.test.ts
git commit -m "feat(spec-269): PATCH + DELETE /tickets/:id (edit & hapus + cleanup lampiran)"
```

---

### Task 4: Client API — deleteError, editTicket, deleteTicket

**Files:**
- Modify: `src/src/api/client.ts` (import type + 3 metode)

**Interfaces:**
- Consumes: `TicketEditInput` (Task 1).
- Produces: `api.deleteError(id)`, `api.editTicket(id, input)`, `api.deleteTicket(id)`.

- [ ] **Step 1: Tambah `TicketEditInput` ke import `@hanoman/shared`** di header `client.ts` (cari import type yang memuat `TicketDetail`).

- [ ] **Step 2: Tambah metode.** Setelah `patchError` (line 265) tambah:

```ts
  deleteError: (id: string) => j<{ ok: boolean }>(paths.error(id), { method: "DELETE" }),
```
Setelah `rejectTicket` (line 278) tambah:

```ts
  editTicket: (id: string, input: TicketEditInput) =>
    j<TicketDetail & { spec: Spec | null }>(paths.ticket(id), { method: "PATCH", ...body(input) }),
  deleteTicket: (id: string) => j<{ ok: boolean }>(paths.ticket(id), { method: "DELETE" }),
```

- [ ] **Step 3: Typecheck** — `pnpm --filter @hanoman/app exec tsc --noEmit` (atau build client). Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/src/api/client.ts
git commit -m "feat(spec-269): client api deleteError/editTicket/deleteTicket"
```

---

### Task 5: DS — komponen `ConfirmDialog`

**Files:**
- Create: `src/src/ds/ConfirmDialog.tsx`
- Modify: `src/src/ds/index.ts`
- Test: `src/test/confirm-dialog.test.tsx`

**Interfaces:**
- Produces: `<ConfirmDialog open title message eyebrow confirmLabel cancelLabel tone busy onConfirm onCancel />`.

- [ ] **Step 1: Tulis test gagal** `src/test/confirm-dialog.test.tsx` (samakan setup render dengan test DS/screen lain — `@testing-library/react`, `vitest`):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../src/ds/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("render judul & pesan saat open; tak render saat tutup", () => {
    const { rerender } = render(<ConfirmDialog open={false} title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Hapus?")).toBeNull();
    rerender(<ConfirmDialog open title="Hapus?" message="pesan" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Hapus?")).toBeTruthy();
    expect(screen.getByText("pesan")).toBeTruthy();
  });
  it("Batal → onCancel; konfirmasi → onConfirm", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<ConfirmDialog open title="Hapus?" confirmLabel="Hapus" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Batal"));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Hapus"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Jalankan test → gagal** (modul belum ada).

- [ ] **Step 3: Buat `src/src/ds/ConfirmDialog.tsx`:**

```tsx
// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
import React from "react";
import { Modal } from "./kit";
import { Button } from "./components/forms";

export function ConfirmDialog({
  open, title, message, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", busy = false, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; eyebrow?: React.ReactNode;
  confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default"; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={tone === "danger" ? "trash-2" : "help-circle"}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant="primary" leftIcon={tone === "danger" ? "trash-2" : "check"}
            onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
    </Modal>
  );
}
```

- [ ] **Step 4: Ekspor** — tambah ke `src/src/ds/index.ts`:

```ts
export { ConfirmDialog } from "./ConfirmDialog";
```

- [ ] **Step 5: Jalankan test → lulus.**

- [ ] **Step 6: Commit**

```bash
git add src/src/ds/ConfirmDialog.tsx src/src/ds/index.ts src/test/confirm-dialog.test.tsx
git commit -m "feat(spec-269): ConfirmDialog DS component"
```

---

### Task 6: Frontend — ErrorsScreen: selector status + hapus

**Files:**
- Modify: `src/src/screens/ErrorsScreen.tsx`
- Test: `src/test/errors-screen.test.tsx`

**Interfaces:**
- Consumes: `api.patchError`, `api.deleteError`, `ConfirmDialog`.

- [ ] **Step 1: Import ConfirmDialog** — ubah baris import DS jadi menyertakan `ConfirmDialog`:
`import { Button, Badge, Select, StateBlock, Icon, ConfirmDialog } from "../ds";`

- [ ] **Step 2: Ubah signature `GroupDetail`** untuk menerima `onDeleted`:

```tsx
function GroupDetail({ id, onBack, onEscalated, onDeleted, onToast }:
  { id: string; onBack: () => void; onEscalated: (spec: Spec, already: boolean) => void;
    onDeleted: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
```

- [ ] **Step 3: Tambah state confirm** di dalam `GroupDetail` (dekat `const [busy, setBusy] = ...`):

```tsx
  const [confirm, setConfirm] = React.useState(false);
```

- [ ] **Step 4: Ganti fungsi `resolve()`** dengan `changeStatus` + `remove`:

```tsx
  async function changeStatus(status: string) {
    setBusy(true);
    try { await api.patchError(id, status); setG({ ...g!, status: status as ErrorGroupDetail["status"] }); onToast("Status diperbarui", "ok"); }
    catch { onToast("Gagal update status", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteError(id); onToast("Grup error dihapus", "ok", "trash-2"); onDeleted(); }
    catch { onToast("Gagal menghapus", "err", "x-circle"); setBusy(false); }
  }
```

- [ ] **Step 5: Ganti baris aksi** (baris `{g.status !== "resolved" && <Button ... resolve>...}` di ~line 93) dengan selector status + tombol hapus:

```tsx
        <Select size="sm" value={g.status} disabled={busy}
          onChange={(e) => changeStatus(e.target.value)}
          options={[{ value: "new", label: "new" }, { value: "escalated", label: "escalated" }, { value: "resolved", label: "resolved" }]} />
        <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => setConfirm(true)} disabled={busy}>Hapus</Button>
```

- [ ] **Step 6: Tambah `<ConfirmDialog>`** sebelum penutup `</div>` root `GroupDetail` (setelah blok `sampleStack`):

```tsx
      <ConfirmDialog open={confirm} title="Hapus grup error?" eyebrow={g.type}
        message={`Grup "${g.message}" beserta ${g.count} kejadiannya akan dihapus permanen. Tindakan ini tak bisa dibatalkan.`}
        busy={busy} onCancel={() => setConfirm(false)} onConfirm={remove} />
```

- [ ] **Step 7: Teruskan `onDeleted`** di pemanggilan `GroupDetail` dalam `ErrorsScreen` (~line 144):

```tsx
  if (openId) return <GroupDetail id={openId} onBack={() => { setOpenId(null); load(true); }} onEscalated={onEscalated} onDeleted={() => { setOpenId(null); load(true); }} onToast={onToast} />;
```

- [ ] **Step 8: Tambah/perbarui test** `src/test/errors-screen.test.tsx` — baca file dulu untuk gaya mock `api`; tambah kasus: buka detail → klik "Hapus" → modal muncul → klik konfirmasi "Hapus" → `api.deleteError` terpanggil. Contoh assertion:

```tsx
  // dalam test yang membuka GroupDetail:
  fireEvent.click(screen.getByText("Hapus"));               // tombol aksi
  fireEvent.click(screen.getAllByText("Hapus").pop()!);      // tombol konfirmasi di modal
  await waitFor(() => expect(api.deleteError).toHaveBeenCalledWith("grp-1"));
```

- [ ] **Step 9: Jalankan test errors-screen → lulus.**

- [ ] **Step 10: Commit**

```bash
git add src/src/screens/ErrorsScreen.tsx src/test/errors-screen.test.tsx
git commit -m "feat(spec-269): ErrorsScreen status selector + hapus grup (modal konfirmasi)"
```

---

### Task 7: Frontend — TriageScreen: edit tiket + hapus

**Files:**
- Modify: `src/src/screens/TriageScreen.tsx`
- Test: `src/test/triage.test.tsx`

**Interfaces:**
- Consumes: `api.editTicket`, `api.deleteTicket`, `ConfirmDialog`, DS `Input`/`Field`/`HnTextarea`.

- [ ] **Step 1: Import** — ubah baris import DS:
`import { Button, Badge, Select, StateBlock, Icon, Input, Field, HnTextarea, ConfirmDialog } from "../ds";`

- [ ] **Step 2: Ubah signature `TicketDetailView`** untuk menerima `onDeleted`:

```tsx
function TicketDetailView({ id, onBack, onAccepted, onDeleted, onToast }:
  { id: string; onBack: () => void; onAccepted: (spec: Spec, already: boolean) => void;
    onDeleted: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void }) {
```

- [ ] **Step 3: Tambah state** dekat `const [priority, ...]`:

```tsx
  const [editing, setEditing] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [form, setForm] = React.useState({ title: "", detail: "", category: "bug", status: "new" });
```

- [ ] **Step 4: Tambah fungsi** setelah `reject()`:

```tsx
  function startEdit() {
    setForm({ title: t!.title, detail: t!.detail, category: t!.category, status: t!.status });
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    try {
      const d = await api.editTicket(id, { title: form.title, detail: form.detail, category: form.category as never, status: form.status as never });
      setT(d); setEditing(false); onToast("Tiket diperbarui", "ok");
    } catch { onToast("Gagal menyimpan", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteTicket(id); onToast("Tiket dihapus", "ok", "trash-2"); onDeleted(); }
    catch { onToast("Gagal menghapus", "err", "x-circle"); setBusy(false); }
  }
```

- [ ] **Step 5: Render mode edit** — tepat sebelum `const done = t.status !== "new";` tambahkan early-return form:

```tsx
  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => setEditing(false)} disabled={busy}>Batal</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" leftIcon="check" onClick={save} disabled={busy}>Simpan</Button>
        </div>
        <Field label="Judul"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Kategori"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={[{ value: "bug", label: "bug" }, { value: "fitur", label: "fitur" }, { value: "pertanyaan", label: "pertanyaan" }, { value: "lainnya", label: "lainnya" }]} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={[{ value: "new", label: "belum ditinjau" }, { value: "accepted", label: "diterima" }, { value: "rejected", label: "ditutup" }]} /></Field>
        </div>
        <Field label="Detail keluhan"><HnTextarea value={form.detail} rows={6} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
      </div>
    );
  }
```

- [ ] **Step 6: Tambah tombol Ubah + Hapus** di baris aksi header — sisipkan setelah `<span style={{ flex: 1 }} />` (line ~93), sebelum blok `{t.specId ? ...}`:

```tsx
        <Button size="sm" variant="ghost" leftIcon="pencil" onClick={startEdit} disabled={busy}>Ubah</Button>
        <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => setConfirm(true)} disabled={busy}>Hapus</Button>
```

- [ ] **Step 7: Tambah `<ConfirmDialog>`** sebelum penutup `</div>` root (setelah blok `attachments`):

```tsx
      <ConfirmDialog open={confirm} title="Hapus tiket?" eyebrow={`#${t.number}`}
        message={`Tiket "${t.title}" dan seluruh lampirannya akan dihapus permanen. Tindakan ini tak bisa dibatalkan.`}
        busy={busy} onCancel={() => setConfirm(false)} onConfirm={remove} />
```

- [ ] **Step 8: Teruskan `onDeleted`** di pemanggilan `TicketDetailView` (~line 161):

```tsx
  if (openId) return <TicketDetailView id={openId} onBack={() => { setOpenId(null); load(true); }} onAccepted={onAccepted} onDeleted={() => { setOpenId(null); load(true); }} onToast={onToast} />;
```

- [ ] **Step 9: Tambah test** `src/test/triage.test.tsx` — baca dulu; tambah: (a) buka tiket → "Ubah" → ubah judul → "Simpan" → `api.editTicket` terpanggil; (b) buka tiket → "Hapus" → konfirmasi → `api.deleteTicket` terpanggil.

- [ ] **Step 10: Jalankan test triage → lulus.**

- [ ] **Step 11: Commit**

```bash
git add src/src/screens/TriageScreen.tsx src/test/triage.test.tsx
git commit -m "feat(spec-269): TriageScreen edit tiket + hapus (modal konfirmasi)"
```

---

### Task 8: Docs — api-contract + index

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/README.md` (bila perlu catatan)

**Interfaces:** —

- [ ] **Step 1: Dokumentasikan** endpoint baru di `api-contract.md` di bagian Errors & Help Center/triase: `DELETE /api/errors/:id`, `PATCH /api/tickets/:id`, `DELETE /api/tickets/:id` (sertakan body & response ringkas + catatan cascade & cleanup lampiran + capability `support:write`).

- [ ] **Step 2: Verifikasi index** — `api-contract.md` sudah ter-link di `README.md`; tambah baris riwayat bila konvensi file menghendaki.

- [ ] **Step 3: Commit**

```bash
git add internal/docs/architecture/api-contract.md internal/docs/README.md
git commit -m "docs(spec-269): api-contract DELETE errors + PATCH/DELETE tickets"
```

---

### Task 9: Verifikasi menyeluruh

- [ ] **Step 1: Test server** — `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server vitest run --no-file-parallelism` (atau perintah repo). Expected: hijau, termasuk `agent-capabilities.test.ts`.
- [ ] **Step 2: Test client** — jalankan vitest client (errors-screen, triage, confirm-dialog). Expected: hijau.
- [ ] **Step 3: Boot server + curl nyata** — boot terhadap DB throwaway (bukan `hanoman_test`; lihat memory "Live smoke: dedicated DB"), seed 1 grup error + 1 tiket, lalu:
  - `DELETE /api/errors/:id` → 200 `{ok:true}`, GET → 404.
  - `PATCH /api/tickets/:id {title}` → 200 title berubah.
  - `DELETE /api/tickets/:id` → 200 `{ok:true}`, GET → 404.
- [ ] **Step 4:** Bila ada yang merah, fix sampai hijau sebelum menutup Execute.

## Self-Review

- **Spec coverage:** Errors edit(status)=Task 6 · Errors delete=Task 2/6 · Triase edit=Task 3/7 · Triase delete=Task 3/7 · modal konfirmasi=Task 5 (+6/7) · capability=otomatis (verifikasi Task 9) · docs=Task 8. ✅
- **Placeholder scan:** kode lengkap di tiap step; test frontend meminta "baca file dulu" untuk gaya mock — bukan placeholder logika, melainkan penyesuaian harness existing.
- **Type consistency:** `zTicketEditInput`/`TicketEditInput` konsisten Task 1↔3↔4; `onDeleted` konsisten Task 6/7; `deleteError`/`editTicket`/`deleteTicket` konsisten Task 4↔6↔7.
