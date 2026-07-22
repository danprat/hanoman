# SPEC-293 — Link ticket triase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detail triase mendapat aksi buka/salin link backlog (deep-link SPA) + badge status turunan backlog + link publik status tiket yang bisa dibagikan ke pelapor.

**Architecture:** Deep-link SPA berbasis hash `#spec=<id>` (parse sekali-mount di App). `publicStatus` jadi satu sumber di `shared`. Token bagikan `Ticket.shareToken` (opaque, additif) membuat route publik menerima kunci pelapor ATAU token operator.

**Tech Stack:** React+TS (Vite), Fastify+TS, Prisma/Postgres, vitest.

## Global Constraints
- TypeScript strict. Test tiap logika (server + shared + frontend).
- Migration additif saja (VPS hub live) — `shareToken` nullable.
- Route publik tetap scoped ke `slug`. Kunci pelapor asli tetap valid.
- Docs tersentuh diperbarui + link di index dalam commit yang sama.
- Test: `env -u NODE_ENV -u DATABASE_URL` + `vitest run --no-file-parallelism`.

---

### Task 1: `publicStatus` → shared + DTO diperluas

**Files:**
- Create: `shared/src/ticket-status.ts`
- Modify: `shared/src/index.ts` (export), `shared/src/dto.ts` (zTicketDetail), `server/src/services/ticket.ts` (re-export), `server/src/routes/help.ts` (import)
- Test: `shared/src/ticket-status.test.ts`

**Produces:** `publicStatus(ticketStatus: string, specStage?: string|null): string`; `zTicketDetail` kini punya `spec: Spec|null`, `publicStatusUrl: string`.

- [x] **Step 1:** Tulis `shared/src/ticket-status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { publicStatus } from "./ticket-status";
describe("publicStatus", () => {
  it("rejected → Ditutup", () => expect(publicStatus("rejected")).toBe("Ditutup"));
  it("new → Sedang ditinjau", () => expect(publicStatus("new")).toBe("Sedang ditinjau"));
  it("accepted + done → Selesai", () => expect(publicStatus("accepted", "done")).toBe("Selesai"));
  it("accepted + executing → Sedang dikerjakan", () => expect(publicStatus("accepted", "executing")).toBe("Sedang dikerjakan"));
  it("accepted + brainstorming → Diterima", () => expect(publicStatus("accepted", "brainstorming")).toBe("Diterima"));
});
```
- [x] **Step 2:** Jalankan → FAIL (module belum ada).
- [x] **Step 3:** Buat `shared/src/ticket-status.ts` (pindahkan body `publicStatus` dari `server/src/services/ticket.ts` verbatim + komentar SoT ADR-0018/0019).
- [x] **Step 4:** `shared/src/index.ts` tambah `export * from "./ticket-status";`.
- [x] **Step 5:** `shared/src/dto.ts` — perluas `zTicketDetail`:
```ts
export const zTicketDetail = zTicketView.extend({
  detail: z.string(),
  attachments: z.array(zTicketAttachmentView),
  spec: zSpec.nullable(),                 // SPEC-293 · backlog tertaut (stage utk status turunan)
  publicStatusUrl: z.string(),            // SPEC-293 · link publik status tiket (shareToken)
});
```
Pastikan `zSpec` diimpor di dto.ts (cek: `import { ..., zSpec } from "./entities"`); tambah bila belum.
- [x] **Step 6:** `server/src/services/ticket.ts` — hapus definisi lokal `publicStatus`, ganti `export { publicStatus } from "@hanoman/shared";` (help.ts & tempat lain tetap `import { publicStatus } from "../services/ticket"` valid).
- [x] **Step 7:** Build shared + jalankan test shared → PASS. `pnpm --filter @hanoman/shared build`.
- [x] **Step 8:** Commit `feat(spec-293): publicStatus ke shared + zTicketDetail spec/publicStatusUrl`.

---

### Task 2: skema `Ticket.shareToken` + generate saat createTicket

**Files:**
- Modify: `server/prisma/schema.prisma` (model Ticket), `server/src/services/ticket.ts`
- Create: `server/prisma/migrations/2026072201_spec293_ticket_sharetoken/migration.sql`
- Test: `server/src/services/ticket.test.ts`

**Produces:** `generateShareToken(): string` (opaque `hnm_shr_…`); `createTicket` mengisi `shareToken`.

- [x] **Step 1:** Tambah test di `server/src/services/ticket.test.ts` (unit `generateShareToken` prefix + panjang) — bila file sulit di-DB-kan, cukup uji `generateShareToken` murni.
```ts
import { generateShareToken } from "./ticket";
it("generateShareToken opaque prefix", () => {
  const t = generateShareToken();
  expect(t.startsWith("hnm_shr_")).toBe(true);
  expect(t.length).toBeGreaterThan(20);
});
```
- [x] **Step 2:** Jalankan → FAIL.
- [x] **Step 3:** `ticket.ts` tambah `export function generateShareToken(): string { return "hnm_shr_" + randomBytes(24).toString("hex"); }`. Di `createTicket` tambahkan `shareToken: generateShareToken()` ke `data:`.
- [x] **Step 4:** `schema.prisma` model Ticket tambah `shareToken String? @unique // SPEC-293 · token bagikan link status publik`.
- [x] **Step 5:** Tulis `migration.sql`:
```sql
-- SPEC-293 · token bagikan status publik tiket (additif, nullable)
ALTER TABLE "Ticket" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Ticket_shareToken_key" ON "Ticket"("shareToken");
```
- [x] **Step 6:** Terapkan per DB (dev + test) dengan env override:
`env -u NODE_ENV -u DATABASE_URL npx prisma migrate deploy` (dev) lalu untuk test DB set `DATABASE_URL=...hanoman293_test` (base unik, ikut memory) + `migrate deploy`. Lalu `npx prisma generate`.
- [x] **Step 7:** Jalankan test ticket → PASS.
- [x] **Step 8:** Commit `feat(spec-293): Ticket.shareToken + generate di createTicket (migration additif)`.

---

### Task 3: getTicket `publicStatusUrl` (lazy shareToken) + route publik terima shareToken

**Files:**
- Modify: `server/src/routes/tickets.ts` (`GET /tickets/:id`), `server/src/routes/help.ts` (`GET /help/:slug/tickets/:key`)
- Test: `server/test/tickets.test.ts`, `server/test/help.test.ts`

**Consumes:** `generateShareToken` (Task 2), `publicStatus` (Task 1).
**Produces:** `GET /tickets/:id` → `{ ..., spec, publicStatusUrl }`; `GET /api/help/:slug/tickets/:key` menerima `shareToken`.

- [x] **Step 1:** Test di `tickets.test.ts`: buat project+ticket, `GET /api/tickets/:id` → `body.publicStatusUrl` cocok `/\/help\/.*\/status\/hnm_shr_/`, dan DB ticket kini punya `shareToken`.
- [x] **Step 2:** Test di `help.test.ts`: ambil `shareToken` tiket dari DB, `GET /api/help/:slug/tickets/<shareToken>` → 200 & `status` benar; token asing → 404; kunci pelapor asli tetap 200.
- [x] **Step 3:** Jalankan → FAIL.
- [x] **Step 4:** `tickets.ts` `GET /tickets/:id`: setelah fetch `t`, bila `!t.shareToken` → `const st = generateShareToken(); await prisma.ticket.update({ where:{id}, data:{ shareToken: st }}); t.shareToken = st;` (tanpa notifySynced). Bangun `const base = ...(req)`, `publicStatusUrl = ${base}/help/${encodeURIComponent(t.projectId)}/status/${t.shareToken}`. Tambah `publicStatusUrl` ke objek return (spec sudah ada).
  - Import `generateShareToken` dari `../services/ticket`.
  - `base` = `${req.protocol}://${req.headers.host ?? "localhost"}` (pola projects.ts).
- [x] **Step 5:** `help.ts` `GET /help/:slug/tickets/:key`: ganti lookup jadi
```ts
const t = await prisma.ticket.findFirst({
  where: { projectId: slug, OR: [{ accessKeyHash: hashAccessKey(key) }, { shareToken: key }] },
});
if (!t) return reply.code(404).send({ error: "not found" });
```
(hapus cek `t.projectId !== slug` karena where sudah scoped).
- [x] **Step 6:** Jalankan test server → PASS.
- [x] **Step 7:** Commit `feat(spec-293): getTicket publicStatusUrl (lazy shareToken) + route publik terima shareToken`.

---

### Task 4: App deep-link `#spec=` + BacklogScreen `initialDetailId`

**Files:**
- Modify: `src/src/App.tsx`, `src/src/screens/BacklogScreen.tsx`
- Test: `src/test/backlog-deeplink.test.tsx` (baru) atau perluas test App bila ada

**Produces:** membuka `${origin}${pathname}#spec=<id>` → section backlog + SpecDetail terbuka.

- [x] **Step 1:** `BacklogScreen.tsx` tambah prop `initialDetailId?: string | null` ke signature + destructure. Setelah `const [detailId, setDetailId] = React.useState<string|null>(null);` tambah:
```ts
React.useEffect(() => { if (initialDetailId) setDetailId(initialDetailId); }, [initialDetailId]);
```
- [x] **Step 2:** `App.tsx` tambah state `const [openSpecId, setOpenSpecId] = React.useState<string|null>(null);`. Mount effect:
```ts
React.useEffect(() => {
  const m = /(?:^|[#&])spec=([^&]+)/.exec(window.location.hash);
  if (m) {
    setSection("backlog"); setOpenSpecId(decodeURIComponent(m[1]));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}, []);
```
- [x] **Step 3:** Teruskan `initialDetailId={openSpecId}` ke `<BacklogScreen ...>` (section backlog). Reset `openSpecId` saat pindah section bila perlu (opsional; SpecDetail menutup sendiri).
- [x] **Step 4:** Tulis test frontend (RTL/jsdom, pola test app lain): set `window.location.hash = "#spec=SPEC-9"`, render App (auth mock ready), assert section backlog aktif & SpecDetail SPEC-9 muncul — bila boot App terlalu berat, uji unit `BacklogScreen` dengan `initialDetailId` membuka modal (assert judul spec tampil). Pilih yang paling murah & andal.
- [x] **Step 5:** Jalankan test → PASS.
- [x] **Step 6:** Commit `feat(spec-293): deep-link #spec= (App mount) + BacklogScreen initialDetailId`.

---

### Task 5: TriageScreen — badge status turunan + tombol backlog + tombol publik

**Files:**
- Modify: `src/src/screens/TriageScreen.tsx`
- Test: `src/test/triage.test.tsx`

**Consumes:** `publicStatus` (shared), `t.publicStatusUrl`, deep-link helper.

- [x] **Step 1:** Tambah helper inline di TriageScreen: `const specDeepLink = (id: string) => \`${window.location.origin}${window.location.pathname}#spec=${encodeURIComponent(id)}\`;` dan import `publicStatus` dari `@hanoman/shared`.
- [x] **Step 2:** Test di `triage.test.tsx`: mock `getTicket` mengembalikan tiket accepted, `specId:"SPEC-9"`, `spec:{stage:"executing",...}`, `publicStatusUrl:"https://x/help/p/status/hnm_shr_ab"`. Render detail → ada teks "Sedang dikerjakan" (badge status turunan) + tombol "Buka backlog" + "Buka status publik". Klik "Salin link publik" → `navigator.clipboard.writeText` dipanggil dengan URL publik (mock clipboard).
- [x] **Step 3:** Jalankan → FAIL.
- [x] **Step 4:** Di `TicketDetailView` header row, saat `t.specId` ganti blok badge jadi:
```tsx
<Badge tone="ok" icon="link">→ {t.specId}</Badge>
<Badge tone="neutral" size="sm">{publicStatus(t.status, t.spec?.stage)}</Badge>
<Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(specDeepLink(t.specId!), "_blank", "noreferrer")}>Buka backlog</Button>
<Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(specDeepLink(t.specId!)); onToast("Link backlog disalin", "ok", "copy"); }}>Salin link</Button>
<Button size="sm" variant="ghost" leftIcon="unlink" onClick={unlink} disabled={busy}>Lepas tautan</Button>
```
Tambahkan (di luar cabang specId, misalnya baris info) tombol publik yang selalu ada:
```tsx
<Button size="sm" variant="ghost" leftIcon="share-2" onClick={() => window.open(t.publicStatusUrl, "_blank", "noreferrer")}>Buka status publik</Button>
<Button size="sm" variant="ghost" leftIcon="link-2" onClick={() => { void navigator.clipboard?.writeText(t.publicStatusUrl); onToast("Link publik disalin", "ok", "copy"); }}>Salin link publik</Button>
```
Pastikan ikon tersedia di DS `Icon` (fallback ke ikon yang sudah dipakai bila tak ada: `external-link`, `copy`, `link`, `share-2`; cek `ds`).
- [x] **Step 5:** Jalankan test → PASS. Perbarui komentar header TriageScreen (SPEC-293).
- [x] **Step 6:** Commit `feat(spec-293): triase — status turunan backlog + tombol buka/salin link backlog & publik`.

---

### Task 6: ErrorsScreen — paritas tombol buka/salin link backlog

**Files:**
- Modify: `src/src/screens/ErrorsScreen.tsx`
- Test: `src/test/errors-screen.test.tsx`

- [x] **Step 1:** Test: detail grup dengan `specId:"SPEC-9"` → ada tombol "Buka backlog"; klik "Salin link" memanggil clipboard dengan `#spec=SPEC-9`.
- [x] **Step 2:** Jalankan → FAIL.
- [x] **Step 3:** Di `GroupDetail` header, cabang `g.specId` tambah `specDeepLink` helper (inline sama) + dua tombol seperti Task 5 (buka + salin), sebelum tombol "Lepas tautan".
- [x] **Step 4:** Jalankan test → PASS.
- [x] **Step 5:** Commit `feat(spec-293): errors — paritas buka/salin link backlog`.

---

### Task 7: Docs index + api-contract + verifikasi boot/curl

**Files:**
- Modify: `internal/docs/README.md` (link audit + ADR-0071), `internal/docs/architecture/api-contract.md` (getTicket publicStatusUrl + help route shareToken)

- [ ] **Step 1:** `README.md` — tambah baris research audit-spec-293 (di grup research) & ADR-0071 (di grup adr, paling atas).
- [ ] **Step 2:** `api-contract.md` — dokumentasikan `GET /tickets/:id` field `publicStatusUrl` & `spec`, dan `GET /help/:slug/tickets/:key` menerima `shareToken`.
- [ ] **Step 3:** Full suite: `env -u NODE_ENV -u DATABASE_URL pnpm -w vitest run --no-file-parallelism` (atau per-paket) → hijau.
- [ ] **Step 4:** Boot server lokal (DB throwaway ter-migrate) + curl: buat project helpEnabled, submit tiket (multipart), accept, `GET /api/tickets/:id` → verifikasi `publicStatusUrl`; `GET` URL publik itu → 200 status "Sedang dikerjakan/Diterima". Catat hasil.
- [ ] **Step 5:** `hanoman docs index --check` (integritas index).
- [ ] **Step 6:** Commit `docs(spec-293): index + api-contract link ticket triase` (bila belum tergabung di commit sebelumnya).
```
