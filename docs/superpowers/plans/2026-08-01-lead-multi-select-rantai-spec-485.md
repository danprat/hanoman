# SPEC-485 — Pilihan lead jamak & rantai keputusan · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: gunakan `superpowers:executing-plans` +
> `superpowers:test-driven-development` untuk mengerjakan plan ini task demi task. Langkah memakai
> checkbox (`- [ ]`).

**Goal:** Lead bisa memilih **beberapa** opsi sekaligus (termasuk dengan mencentang kotak di dialog
`multiSelect` claude), dan satu urusan bisa berjalan sebagai **rantai** pertanyaan berstatus sampai
di-submit — dengan riwayat yang bisa dibaca ulang utuh.

**Architecture:** Empat lapis di atas choke point yang sudah tunggal. (1) Kosakata murni di
`@hanoman/shared` — `resolveChoices` memanggil `resolveChoice` per item, bukan menyalinnya.
(2) Model `LeadFlow` + empat kolom aditif di `LeadDecision`; alur dibuat & ditutup **di dalam
`decide()`**. (3) `tui-dialog.ts` belajar membaca & mencentang widget `multiSelect`.
(4) `LeadScreen` menampilkan radio/checkbox dan kartu rantai.

**Tech Stack:** TypeScript strict · Fastify · Prisma 6 + SQLite · zod · React + Vite · vitest ·
tmux/node-pty.

## Global Constraints

- ADR acuan: **ADR-0102** (`internal/docs/adr/0102-lead-multi-select-dan-rantai-keputusan.md`).
  Design doc: `docs/superpowers/specs/2026-08-01-spec-485-lead-multi-select-rantai-design.md`.
- **Kompatibel mundur wajib:** baris `LeadDecision` lama (hanya `choice`/`choiceIndex`) harus tetap
  memancarkan `choices` berisi satu elemen; verdict agen lama (hanya `choice`) harus tetap terpakai.
- **Bentuk jawaban selalu daftar di penyimpanan.** `choice`/`choiceIndex` tinggal turunan
  `choices[0]`.
- **`resolveChoice`, `clampProse`, `LEAD_ACTIONS`, `LEAD_FORBIDDEN` tidak boleh diubah perilakunya.**
- **Tak ada timer/queue/kanal WS baru** (ADR-0024/0039). Penyapu alur menumpang `tick()` lead.
- **Tak ada `kind` yang ditulis ulang** oleh validasi pilihan (idempotensi denyut, SPEC-432).
- Migration **ditulis tangan** + `prisma migrate deploy` — `migrate dev` me-reset DB saat ada drift
  worktree tetangga.
- Perintah test WAJIB memakai DB terisolasi karena mesin ini menjalankan beberapa sesi:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism <path>`
  (dijalankan dari root worktree; `pnpm vitest` bisa gagal lewat proxy rtk).
- Bahasa komentar & doc: Indonesia. Nama simbol & pesan API: apa adanya seperti sekitarnya.

---

## Struktur berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/lead.ts` (M) | kosakata pilihan jamak: `zLeadSelect`, `normalizeSelect`, `resolveChoices`, `checkChoiceCount`, `LeadDelivery.choices`, `leadReplyText` jamak, `zLeadVerdict.choices`, `zLeadAsk.select/chain/flowId` |
| `shared/src/dto.ts` (M) | `zLeadDecisionView.choices/select/flowId/step`, `zLeadAnswer.choices/flowId/flowStatus`, `zLeadFlowView` |
| `shared/src/entities.ts` (M) | `zLead.flowTtlMin` |
| `shared/src/api.ts` (M) | path `leadFlows`, `leadFlowSubmit`, `leadFlowCancel` |
| `server/prisma/schema.prisma` (M) | model `LeadFlow`; `LeadDecision.flowId/step/choices/select` |
| `server/prisma/migrations/20260801230000_lead_flow/migration.sql` (C) | tabel + kolom aditif |
| `cli/src/commands/migrate-pg.ts` (M) | `LeadFlow` masuk `PG_ORDER` |
| `server/src/services/lead/flow.ts` (C) | daur hidup alur: `openFlow`/`joinFlow`/`markFlowStep`/`closeFlow`/`expireFlows`/`toFlowView` + `LeadFlowClosedError` |
| `server/src/services/lead/decide.ts` (M) | resolusi pilihan jamak, validasi, pemasangan alur |
| `server/src/services/lead/trail.ts` (M) | tulis & baca `choices`/`select`/`flowId`/`step` |
| `server/src/services/lead/prompt.ts` (M) | blok `min`/`max` opsi + blok rantai |
| `server/src/routes/lead.ts` (M) | `select`/`chain`/`flowId` di ask, endpoint alur, filter `flowId`, override ber-`choices` |
| `server/src/services/lead/engine.ts` (M) | penyapu alur kedaluwarsa di `tick()` |
| `server/src/services/tui-dialog.ts` (M) | baca kotak centang, tombol kirim, `answerMultiSelectDialog`, `dialogKey` multi |
| `server/src/services/pty.ts` (M) | `sendToPane(id, text, chunkMs, choices)` |
| `server/src/services/lead/detect.ts` (M) | teruskan `delivery.choices` ke pane |
| `src/src/ds/components/forms.tsx` (M) | `Radio` baru + `role`/`aria-checked` pada `Checkbox` |
| `src/src/ds/index.ts` (M) | ekspor `Radio` |
| `src/src/api/client.ts` (M) | `getLeadFlows`, `submitLeadFlow`, `cancelLeadFlow`, `overrideLeadDecision` ber-`choices` |
| `src/src/screens/LeadScreen.tsx` (M) | tampilan pilihan jamak, pemilih radio/checkbox di Timpa, kartu rantai |
| `internal/docs/architecture/data-model.md` (M) | `LeadFlow` + kolom baru |
| `internal/docs/architecture/api-contract.md` (M) | endpoint & field baru |
| `internal/skills/hanoman/SKILL.md` (M) | butir SPEC-485/ADR-0102 |

---

### Task 1: Kosakata pilihan jamak (shared, murni)

**Files:**
- Modify: `shared/src/lead.ts`
- Modify: `shared/src/dto.ts`
- Modify: `shared/src/entities.ts`
- Modify: `shared/src/api.ts`
- Test: `shared/src/lead.test.ts`

**Interfaces:**
- Consumes: `resolveChoice(raw, options)`, `clampProse`, `optionActionHint` (sudah ada, tak diubah).
- Produces:
  - `type LeadSelect = { mode: "single" | "multi"; min: number; max: number | null }`
  - `zLeadSelect` (default `{mode:"single",min:0,max:null}`)
  - `normalizeSelect(sel: LeadSelect, optionCount: number): { mode: "single"|"multi"; min: number; max: number }`
  - `resolveChoices(raw: string[], options: string[]): { choices: LeadChoice[]; rejected: string[] }`
  - `checkChoiceCount(n: number, b: { min: number; max: number }): string | null`
  - `LeadDelivery.choices: LeadChoice[]` (field `choice` tetap ada = `choices[0] ?? null`)
  - `zLeadVerdict.choices: string[]`
  - `zLeadAsk.select`, `zLeadAsk.chain: boolean`, `zLeadAsk.flowId: string | null`
  - `zLeadFlowView`, `type LeadFlowView`
  - `zLead.flowTtlMin` (default 60)
  - `paths.leadFlows`, `paths.leadFlowSubmit(id)`, `paths.leadFlowCancel(id)`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `shared/src/lead.test.ts` (dan tambahkan simbol baru ke blok `import` di atasnya:
`zLeadSelect, normalizeSelect, resolveChoices, checkChoiceCount`):

```ts
describe("SPEC-485 · ADR-0102 · pilihan jamak", () => {
  const OPTS = ["alpha — paket alpha", "beta", "gamma"];

  it("resolveChoices memetakan nomor & label, membuang duplikat", () => {
    const r = resolveChoices(["2", "gamma", "beta"], OPTS);
    expect(r.choices.map((c) => c.index)).toEqual([2, 3]);
    expect(r.choices.map((c) => c.option)).toEqual(["beta", "gamma"]);
    expect(r.rejected).toEqual([]);
  });

  it("yang di luar daftar & yang ambigu masuk `rejected`, bukan ditebak", () => {
    const r = resolveChoices(["delta", "9"], OPTS);
    expect(r.choices).toEqual([]);
    expect(r.rejected).toEqual(["delta", "9"]);
  });

  it("urutannya urutan OPSI, bukan urutan lead menyebutnya", () => {
    expect(resolveChoices(["3", "1"], OPTS).choices.map((c) => c.index)).toEqual([1, 3]);
  });

  it("normalizeSelect: single selalu 0..1, apa pun yang diminta", () => {
    expect(normalizeSelect({ mode: "single", min: 0, max: 5 }, 3)).toEqual({ mode: "single", min: 0, max: 1 });
  });

  it("normalizeSelect: multi dijepit ke jumlah opsi", () => {
    expect(normalizeSelect({ mode: "multi", min: 2, max: null }, 3)).toEqual({ mode: "multi", min: 2, max: 3 });
    expect(normalizeSelect({ mode: "multi", min: 0, max: 9 }, 3)).toEqual({ mode: "multi", min: 0, max: 3 });
  });

  it("checkChoiceCount menolak di bawah min & di atas max, dengan alasan terbaca", () => {
    expect(checkChoiceCount(2, { min: 0, max: 1 })).toMatch(/paling banyak 1/);
    expect(checkChoiceCount(0, { min: 1, max: 3 })).toMatch(/paling sedikit 1/);
    expect(checkChoiceCount(2, { min: 1, max: 3 })).toBeNull();
  });

  it("leadReplyText menyebut SEMUA label terpilih, verbatim", () => {
    const line = leadReplyText({
      decision: "d", reason: "karena X.", reply: "",
      choices: [{ index: 1, option: "alpha — paket alpha" }, { index: 3, option: "gamma" }],
      choice: { index: 1, option: "alpha — paket alpha" }, missing: [],
    });
    expect(line).toContain("alpha — paket alpha");
    expect(line).toContain("gamma");
  });

  it("zLeadVerdict menerima `choices`, dan `choice` lama tetap sah", () => {
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choices: ["1", "2"] }).choices).toEqual(["1", "2"]);
    expect(zLeadVerdict.parse({ decision: "d", reason: "r", choice: "2" }).choices).toEqual([]);
  });

  it("zLeadAsk membawa select/chain/flowId dengan default yang meniru perilaku hari ini", () => {
    const a = zLeadAsk.parse({ projectId: "p", question: "q" });
    expect(a.select).toEqual({ mode: "single", min: 0, max: null });
    expect(a.chain).toBe(false);
    expect(a.flowId).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-485
./node_modules/.bin/vitest run --no-file-parallelism shared/src/lead.test.ts
```
Expected: FAIL — `resolveChoices is not a function` / `normalizeSelect is not exported`.

- [x] **Step 3: Implementasi di `shared/src/lead.ts`**

Sisipkan setelah `resolveChoice` (jangan ubah `resolveChoice` sendiri):

```ts
/**
 * SPEC-485 · ADR-0102 · bentuk pilihan yang diminta PEMINTA. `single` adalah keadaan hari ini dan
 * karena itu default: permintaan lama parse tanpa berubah satu bit pun.
 */
export const zLeadSelect = z.object({
  mode: z.enum(["single", "multi"]).default("single"),
  min: z.number().int().min(0).max(20).default(0),
  max: z.number().int().min(1).max(20).nullable().default(null),
});
export type LeadSelect = z.infer<typeof zLeadSelect>;

/**
 * Batas yang BENAR-BENAR berlaku. `single` selalu 0..1 — mode itu yang menentukan, bukan angka
 * yang kebetulan dikirim, supaya "single tapi max 5" tak pernah jadi keadaan yang harus ditangani
 * di hilir. `max` null berarti "sebanyak opsinya".
 */
export function normalizeSelect(sel: LeadSelect, optionCount: number): { mode: "single" | "multi"; min: number; max: number } {
  const n = Math.max(0, optionCount);
  if (sel.mode === "single") return { mode: "single", min: Math.min(sel.min, 1), max: 1 };
  const max = Math.min(sel.max ?? n, n);
  return { mode: "multi", min: Math.min(sel.min, max), max };
}

/**
 * Cermin jamak `resolveChoice`. Ia MEMANGGIL `resolveChoice` per item alih-alih mengulang
 * pencocokannya: satu definisi, karena hanoman sudah empat kali membayar kelas bug
 * "satu definisi, N call site" (SPEC-431/448/475/481).
 *
 * Hasilnya diurutkan menurut urutan OPSI, bukan urutan lead menyebutnya — jejak yang dibaca ulang
 * harus cocok dengan menu yang dilihat manusia.
 */
export function resolveChoices(raw: string[], options: string[]): { choices: LeadChoice[]; rejected: string[] } {
  const seen = new Set<number>();
  const choices: LeadChoice[] = [];
  const rejected: string[] = [];
  for (const r of raw) {
    const t = (r ?? "").trim();
    if (!t) continue;
    const hit = resolveChoice(t, options);
    if (!hit) { rejected.push(t); continue; }
    if (seen.has(hit.index)) continue;      // duplikat bukan kesalahan, cuma tak menambah apa pun
    seen.add(hit.index);
    choices.push(hit);
  }
  choices.sort((a, b) => a.index - b.index);
  return { choices, rejected };
}

/** Alasan penolakan jumlah pilihan yang bisa dibaca manusia; `null` = jumlahnya sah. */
export function checkChoiceCount(n: number, b: { min: number; max: number }): string | null {
  if (n > b.max) return `pilihan terlalu banyak (${n}) — paling banyak ${b.max}`;
  if (n < b.min) return `pilihan terlalu sedikit (${n}) — paling sedikit ${b.min}`;
  return null;
}
```

Ubah `LeadDelivery` & `leadReplyText`:

```ts
export type LeadDelivery = {
  decision: string;
  reason: string;
  reply: string;
  /** SPEC-485 · SELALU daftar. `choice` di bawah tinggal turunannya, demi pembaca lama. */
  choices: LeadChoice[];
  choice: LeadChoice | null;
  missing: string[];
};
```

```ts
export function leadReplyText(d: LeadDelivery): string {
  const budget = LEAD_DECISION_MAX + LEAD_REASON_MAX;
  if (d.missing.length)
    return clampProse(`Belum bisa kuputuskan. Yang kurang: ${d.missing.join("; ")}.`, budget);
  // Label VERBATIM, dipisah `; ` — koma dipakai di dalam label opsi denyut sendiri.
  const picked = d.choices.length ? d.choices : (d.choice ? [d.choice] : []);
  if (picked.length) return clampProse(`Pilih: ${picked.map((c) => c.option).join("; ")}. ${d.reason}`, budget);
  return clampProse(d.reply || d.decision, budget);
}
```

Tambahkan ke `zLeadVerdict` (setelah `choice`):

```ts
  /**
   * SPEC-485 · pilihan JAMAK. `string[]` dengan alasan yang sama seperti `choice`: pilihan di luar
   * daftar harus BISA MASUK supaya server menolaknya secara sadar & mencatatnya. Kosong + `choice`
   * terisi = satu pilihan (keluaran agen bentuk ADR-0098 tetap terpakai).
   */
  choices: z.array(z.string().max(2000)).max(20).default([]),
```

Tambahkan ke `zLeadAsk`:

```ts
  /** SPEC-485 · bentuk pilihan yang diminta peminta. Default = perilaku hari ini (single). */
  select: zLeadSelect.default({ mode: "single", min: 0, max: null }),
  /** `true` = peminta akan mengajukan pertanyaan lanjutan; alurnya dibiarkan terbuka. */
  chain: z.boolean().default(false),
  /** Lanjutkan rantai yang sudah ada. Alur tertutup ditolak 409 di route. */
  flowId: z.string().min(1).nullish().default(null),
```

- [x] **Step 4: Tambah DTO & path & knob**

`shared/src/dto.ts` — tambahkan ke `zLeadDecisionView` (setelah `missing`):

```ts
  // SPEC-485 · ADR-0102 · jawaban SELALU daftar. Baris pra-migrasi diturunkan di `toDecisionView`.
  choices: z.array(zLeadChoice).default([]),
  select: zLeadSelect.nullable().default(null),
  flowId: z.string().nullable().default(null),
  step: z.number().nullable().default(null),
```

tambahkan ke `zLeadAnswer`:

```ts
  choices: z.array(zLeadChoice).default([]),
  flowId: z.string().nullable().default(null),
  flowStatus: zLeadFlowStatus.nullable().default(null),
```

dan model baru di `shared/src/dto.ts`:

```ts
// SPEC-485 · ADR-0102 · satu RANTAI keputusan sebagai objek berstatus.
export const zLeadFlowView = z.object({
  id: z.string(), projectId: z.string(),
  specId: z.string().nullable(), sessionId: z.string().nullable(),
  gate: zLeadGate, status: zLeadFlowStatus,
  title: z.string(), steps: z.number(),
  closeReason: z.string().nullable(),
  openedAt: z.string(), closedAt: z.string().nullable(), expiresAt: z.string(),
});
export type LeadFlowView = z.infer<typeof zLeadFlowView>;
```

`shared/src/lead.ts` — status alur hidup bersama kosakata lead lain:

```ts
/** SPEC-485 · status satu rantai keputusan (outcome #4). */
export const zLeadFlowStatus = z.enum(["menunggu", "sebagian", "selesai", "dibatalkan"]);
export type LeadFlowStatus = z.infer<typeof zLeadFlowStatus>;
/** Alur yang masih boleh menerima langkah baru. */
export const LEAD_FLOW_OPEN: readonly LeadFlowStatus[] = ["menunggu", "sebagian"];
```

(dan `zLeadFlowStatus`, `zLeadSelect` ditambahkan ke `import` di kepala `shared/src/dto.ts`.)

`shared/src/entities.ts` — di dalam `zLead`, setelah `queueWaitSec`:

```ts
  // SPEC-485 · ADR-0102 · umur maksimum satu rantai keputusan yang dibiarkan terbuka. Peminta bisa
  // mati di tengah rantai; tanpa batas ini alurnya "sebagian" selamanya dan tak ada yang tahu
  // apakah ia masih ditunggu. Penyapunya menumpang tick lead (ADR-0024: tanpa timer baru).
  flowTtlMin: z.number().int().min(1).max(1440).default(60),
```

`shared/src/api.ts` — setelah `leadDecisionCancel`:

```ts
  leadFlows: `${API}/lead/flows`,
  leadFlowSubmit: (id: string) => `${API}/lead/flows/${encodeURIComponent(id)}/submit`,
  leadFlowCancel: (id: string) => `${API}/lead/flows/${encodeURIComponent(id)}/cancel`,
```

Pastikan simbol baru terekspor lewat `shared/src/index.ts` (berkas itu mem-`export *` dari
`lead.ts`/`dto.ts`/`entities.ts`/`api.ts`; verifikasi dan tambahkan bila tidak).

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest run --no-file-parallelism shared/src/lead.test.ts
```
Expected: PASS, termasuk seluruh test SPEC-409/480 yang sudah ada (bukti `resolveChoice` &
`clampProse` tak berubah perilaku).

- [x] **Step 6: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar 0. Bila `leadReplyText` dipakai pemanggil lain yang belum punya `choices`, tsc akan
menunjuk berkasnya — biarkan gagal di sini dan perbaiki di Task 4 (pemanggilnya `detect.ts`).
Untuk menjaga langkah ini hijau, beri `choices` nilai default di `decide.ts` sekarang juga:
`lastDelivery.set(row.id, { …, choices: choice ? [choice] : [], choice, missing })`.

- [x] **Step 7: Commit**

```bash
git add shared/src/lead.ts shared/src/lead.test.ts shared/src/dto.ts shared/src/entities.ts shared/src/api.ts shared/src/index.ts server/src/services/lead/decide.ts
git commit -m "feat(485): kosakata pilihan jamak + status rantai di shared (ADR-0102)"
```

---

### Task 2: Skema `LeadFlow` + migration + PG_ORDER

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260801230000_lead_flow/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts`
- Test: `server/test/lead-flow-schema.test.ts` (baru)

**Interfaces:**
- Consumes: `LEAD_FLOW_OPEN`, `zLeadFlowStatus` (Task 1).
- Produces: model Prisma `LeadFlow`; kolom `LeadDecision.flowId`, `.step`, `.choices`, `.select`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/lead-flow-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const cols = (m: string) => new Set(models.get(m)!.fields.map((f) => f.name));

// SPEC-485 · ADR-0102 · gotcha 6: model baru yang tak masuk PG_ORDER hilang senyap saat migrasi
// dari Postgres (kelas bug ADR-0094 gotcha 7), dan kolom `version` akan menyeretnya ke mesin sync
// padahal jejak lead LOCAL-only.
describe("skema LeadFlow", () => {
  it("modelnya ada dengan kolom daur hidup yang lengkap", () => {
    expect(models.has("LeadFlow")).toBe(true);
    for (const c of ["id", "projectId", "specId", "sessionId", "gate", "status", "title",
      "steps", "closeReason", "openedAt", "closedAt", "expiresAt"])
      expect(cols("LeadFlow").has(c), c).toBe(true);
  });

  it("LOCAL-only: tanpa kolom `version`", () => {
    expect(cols("LeadFlow").has("version")).toBe(false);
  });

  it("LeadDecision menunjuk alur & menyimpan pilihan sebagai daftar", () => {
    for (const c of ["flowId", "step", "choices", "select"])
      expect(cols("LeadDecision").has(c), c).toBe(true);
  });

  it("masuk PG_ORDER, sebelum LeadDecision yang menunjuknya", () => {
    expect(PG_ORDER).toContain("LeadFlow");
    expect(PG_ORDER.indexOf("LeadFlow")).toBeLessThan(PG_ORDER.indexOf("LeadDecision"));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-flow-schema.test.ts
```
Expected: FAIL — `models.has("LeadFlow")` false.

- [ ] **Step 3: Tambah model & kolom di `server/prisma/schema.prisma`**

Tepat SEBELUM `model LeadDecision {`:

```prisma
// SPEC-485 · ADR-0102 · satu RANTAI keputusan lead. LOCAL-only (tanpa `version`, tak pernah
// disync) dan tanpa FK — cermin LeadDecision: id project/spec/sesi boleh lenyap tanpa menyeret
// jejaknya. Status: menunggu | sebagian | selesai | dibatalkan.
model LeadFlow {
  id          String    @id @default(cuid())
  projectId   String
  specId      String?
  sessionId   String?
  gate        String                              // pintu yang membuka rantai (contract|detected|pulse)
  status      String    @default("menunggu")
  title       String                              // pertanyaan pertama, terpangkas
  steps       Int       @default(0)
  closeReason String?                             // tunggal | submit | operator | kedaluwarsa
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  expiresAt   DateTime
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([projectId, createdAt])
  @@index([status])
}
```

Di dalam `model LeadDecision`, setelah baris `missing`:

```prisma
  // SPEC-485 · ADR-0102 · aditif & nullable: baris lama sah apa adanya. `choices` adalah bentuk
  // penyimpanan yang berlaku; `choice`/`choiceIndex` di atas tinggal turunan `choices[0]`.
  flowId         String?   // rantai tempat langkah ini duduk
  step           Int?      // urutan langkah dalam rantai, 1-basis
  choices        Json?     // {index,option}[] — SELALU daftar
  select         Json?     // {mode,min,max} sebagaimana dikirim peminta
```

- [ ] **Step 4: Tulis migration tangan**

`server/prisma/migrations/20260801230000_lead_flow/migration.sql`:

```sql
-- SPEC-485 · ADR-0102 · rantai keputusan lead + pilihan jamak.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu tabel baru + empat kolom NULLABLE tanpa default, tak ada tabel
-- diredefinisi, tak ada baris disentuh, jadi larangan SQLite atas `ADD COLUMN … DEFAULT
-- <non-konstan>` tak berlaku.
CREATE TABLE "LeadFlow" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "projectId"   TEXT NOT NULL,
    "specId"      TEXT,
    "sessionId"   TEXT,
    "gate"        TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'menunggu',
    "title"       TEXT NOT NULL,
    "steps"       INTEGER NOT NULL DEFAULT 0,
    "closeReason" TEXT,
    "openedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"    DATETIME,
    "expiresAt"   DATETIME NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL
);
CREATE INDEX "LeadFlow_projectId_createdAt_idx" ON "LeadFlow"("projectId", "createdAt");
CREATE INDEX "LeadFlow_status_idx" ON "LeadFlow"("status");

ALTER TABLE "LeadDecision" ADD COLUMN "flowId" TEXT;
ALTER TABLE "LeadDecision" ADD COLUMN "step" INTEGER;
ALTER TABLE "LeadDecision" ADD COLUMN "choices" JSONB;
ALTER TABLE "LeadDecision" ADD COLUMN "select" JSONB;
CREATE INDEX "LeadDecision_flowId_idx" ON "LeadDecision"("flowId");
```

Tambahkan indeks itu ke schema.prisma juga: `@@index([flowId])` di blok `LeadDecision`.

- [ ] **Step 5: `PG_ORDER`**

`cli/src/commands/migrate-pg.ts` — ganti baris
`"SchedulerQueueItem", "RuntimeConfig", "LeadDecision",` menjadi:

```ts
  // SPEC-485 · ADR-0102 · LeadFlow SEBELUM LeadDecision: `flowId` menunjuk ke sana (tanpa FK, tapi
  // urutan tabel harus tetap mencerminkan arah tautannya bagi pembaca berikutnya).
  "SchedulerQueueItem", "RuntimeConfig", "LeadFlow", "LeadDecision",
```

- [ ] **Step 6: Generate + deploy + jalankan test**

```bash
cd server && ./node_modules/.bin/prisma generate && cd ..
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-flow-schema.test.ts server/test/webhook-catalog-dmmf.test.ts
```
Expected: PASS keduanya (webhook DMMF ikut dijalankan sebagai bukti katalog tak pecah).

- [ ] **Step 7: Commit**

```bash
git add server/prisma cli/src/commands/migrate-pg.ts server/test/lead-flow-schema.test.ts
git commit -m "feat(485): model LeadFlow + kolom pilihan jamak di LeadDecision (ADR-0102)"
```

---

### Task 3: Daur hidup alur (`services/lead/flow.ts`)

**Files:**
- Create: `server/src/services/lead/flow.ts`
- Test: `server/test/lead-flow.test.ts` (baru)

**Interfaces:**
- Consumes: `prisma`, `LEAD_FLOW_OPEN`, `LeadFlowStatus`, `LeadFlowView` (Task 1/2).
- Produces:
  - `class LeadFlowClosedError extends Error { constructor(id: string, status: string) }`
  - `openFlow(i: { projectId; specId?; sessionId?; gate; title; ttlMin: number }): Promise<LeadFlow>`
  - `joinFlow(id: string): Promise<LeadFlow>` — melempar `LeadFlowClosedError` bila tertutup/tak ada
  - `markFlowStep(id: string, answered: boolean): Promise<void>` — `steps++`, `menunggu → sebagian` bila `answered`
  - `closeFlow(id: string, reason: "tunggal"|"submit"|"operator"|"kedaluwarsa"): Promise<LeadFlow | null>`
  - `listFlows(f: { projectId?; status?; take?; skip? }): Promise<LeadFlow[]>`
  - `expireFlows(now: Date): Promise<LeadFlow[]>`
  - `toFlowView(r: LeadFlow): LeadFlowView`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/lead-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import {
  openFlow, joinFlow, markFlowStep, closeFlow, expireFlows, listFlows, toFlowView,
  LeadFlowClosedError,
} from "../src/services/lead/flow";

const base = { projectId: "p485", gate: "contract" as const, title: "Pertanyaan pertama", ttlMin: 60 };

beforeEach(async () => { await prisma.leadFlow.deleteMany({ where: { projectId: "p485" } }); });

describe("SPEC-485 · ADR-0102 · daur hidup rantai keputusan", () => {
  it("alur baru lahir `menunggu` dengan expiresAt di depan", async () => {
    const f = await openFlow(base);
    expect(f.status).toBe("menunggu");
    expect(f.steps).toBe(0);
    expect(f.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("langkah yang terjawab memindahkannya ke `sebagian`; yang gagal tidak", async () => {
    const f = await openFlow(base);
    await markFlowStep(f.id, false);
    expect((await prisma.leadFlow.findUnique({ where: { id: f.id } }))!.status).toBe("menunggu");
    await markFlowStep(f.id, true);
    const after = (await prisma.leadFlow.findUnique({ where: { id: f.id } }))!;
    expect(after.status).toBe("sebagian");
    expect(after.steps).toBe(2);
  });

  it("alur tertutup MENOLAK langkah baru (batasan: tak bisa menyisipkan ke rantai ter-submit)", async () => {
    const f = await openFlow(base);
    await closeFlow(f.id, "submit");
    await expect(joinFlow(f.id)).rejects.toBeInstanceOf(LeadFlowClosedError);
  });

  it("alur yang tak ada juga ditolak, bukan dibuatkan diam-diam", async () => {
    await expect(joinFlow("tak-ada")).rejects.toBeInstanceOf(LeadFlowClosedError);
  });

  it("menutup dua kali tak mengubah alasan penutupan pertama", async () => {
    const f = await openFlow(base);
    await closeFlow(f.id, "submit");
    expect(await closeFlow(f.id, "operator")).toBeNull();
    expect((await prisma.leadFlow.findUnique({ where: { id: f.id } }))!.closeReason).toBe("submit");
  });

  it("expireFlows menutup yang lewat batas & TIDAK menyentuh yang sudah tertutup", async () => {
    const stale = await openFlow({ ...base, ttlMin: 60 });
    await prisma.leadFlow.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const closed = await openFlow(base);
    await closeFlow(closed.id, "submit");
    await prisma.leadFlow.update({ where: { id: closed.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const out = await expireFlows(new Date());
    expect(out.map((f) => f.id)).toEqual([stale.id]);
    expect((await prisma.leadFlow.findUnique({ where: { id: stale.id } }))!.status).toBe("dibatalkan");
    expect((await prisma.leadFlow.findUnique({ where: { id: closed.id } }))!.closeReason).toBe("submit");
  });

  it("listFlows menyaring per project & status, terbaru dulu", async () => {
    const a = await openFlow(base);
    const b = await openFlow(base);
    await closeFlow(b.id, "submit");
    expect((await listFlows({ projectId: "p485", status: "selesai" })).map((f) => f.id)).toEqual([b.id]);
    expect((await listFlows({ projectId: "p485" })).map((f) => f.id)).toContain(a.id);
  });

  it("toFlowView memancarkan tanggal sebagai string ISO", async () => {
    const v = toFlowView(await openFlow(base));
    expect(typeof v.openedAt).toBe("string");
    expect(v.closedAt).toBeNull();
    expect(v.status).toBe("menunggu");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-flow.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/lead/flow'`.

- [ ] **Step 3: Implementasi `server/src/services/lead/flow.ts`**

```ts
import type { LeadFlow } from "@prisma/client";
import { LEAD_FLOW_OPEN, type LeadFlowStatus, type LeadFlowView, type LeadGate } from "@hanoman/shared";
import { prisma } from "../../db";

// SPEC-485 · ADR-0102 · satu RANTAI keputusan sebagai objek berstatus.
//
// Sampai spec ini, "alur" hanya ada sebagai kebetulan: beberapa baris `LeadDecision` yang
// berdekatan waktunya. Karena itu tak ada tempat untuk menegakkan "pertanyaan lanjutan hanya boleh
// masuk ke alur yang masih aktif", dan tak ada yang bisa ditanya "sudah di-submit belum".
//
// Modul ini sengaja TIDAK punya fungsi hapus — cermin `trail.ts` (AC-32): jejak keputusan tak
// dihapus lead maupun operator, dan alur adalah bagian dari jejak itu.

/** Alasan sebuah alur ditutup. Konstanta terbatas supaya jejaknya bisa disaring, bukan prosa. */
export type FlowCloseReason = "tunggal" | "submit" | "operator" | "kedaluwarsa";

/**
 * Alur yang tak ada atau sudah tertutup. Dibedakan dari galat lain karena route menerjemahkannya
 * jadi **409** — "tak ada yang rusak, kesempatannya yang sudah lewat".
 */
export class LeadFlowClosedError extends Error {
  constructor(readonly flowId: string, readonly status: string) {
    super(`rantai keputusan ${flowId} sudah ${status === "tak-ada" ? "tidak ada" : status}`);
    this.name = "LeadFlowClosedError";
  }
}

const isOpen = (s: string): boolean => (LEAD_FLOW_OPEN as readonly string[]).includes(s);

/** Judul alur = pertanyaan pertama, terpangkas. Ia yang dibaca operator di daftar. */
const flowTitle = (q: string): string => q.replace(/\s+/g, " ").trim().slice(0, 200);

export async function openFlow(i: {
  projectId: string; specId?: string | null; sessionId?: string | null;
  gate: LeadGate; title: string; ttlMin: number;
}): Promise<LeadFlow> {
  return prisma.leadFlow.create({
    data: {
      projectId: i.projectId, specId: i.specId ?? null, sessionId: i.sessionId ?? null,
      gate: i.gate, title: flowTitle(i.title),
      expiresAt: new Date(Date.now() + Math.max(1, i.ttlMin) * 60_000),
    },
  });
}

/** Lanjutkan rantai. Tertutup / tak ada → `LeadFlowClosedError`; TAK PERNAH dibuatkan diam-diam. */
export async function joinFlow(id: string): Promise<LeadFlow> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row) throw new LeadFlowClosedError(id, "tak-ada");
  if (!isOpen(row.status)) throw new LeadFlowClosedError(id, row.status);
  return row;
}

/**
 * Satu langkah selesai dijalankan. `answered` = langkah itu melahirkan keputusan yang BERLAKU;
 * langkah yang gagal tetap menaikkan `steps` (ia benar-benar terjadi & memakai giliran agen) tapi
 * tak memindahkan status — alur yang semua langkahnya gagal masih "menunggu jawaban", dan itu
 * pembacaan yang benar bagi operator.
 */
export async function markFlowStep(id: string, answered: boolean): Promise<void> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row || !isOpen(row.status)) return;
  await prisma.leadFlow.update({
    where: { id },
    data: {
      steps: { increment: 1 },
      ...(answered && row.status === "menunggu" ? { status: "sebagian" } : {}),
    },
  });
}

/**
 * Tutup alur. `null` bila ia sudah tertutup — penutupan pertama yang berlaku, dan alasannya tak
 * boleh ditulis ulang: "operator membatalkan" dan "peminta men-submit" adalah dua peristiwa
 * berbeda yang harus tetap terbedakan di jejak.
 */
export async function closeFlow(id: string, reason: FlowCloseReason): Promise<LeadFlow | null> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row || !isOpen(row.status)) return null;
  const status: LeadFlowStatus = reason === "operator" || reason === "kedaluwarsa" ? "dibatalkan" : "selesai";
  return prisma.leadFlow.update({
    where: { id }, data: { status, closeReason: reason, closedAt: new Date() },
  });
}

export async function listFlows(f: {
  projectId?: string; status?: string; take?: number; skip?: number;
} = {}): Promise<LeadFlow[]> {
  return prisma.leadFlow.findMany({
    where: {
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.status ? { status: f.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(f.take ?? 50, 200),
    skip: f.skip ?? 0,
  });
}

/**
 * Alur yang ditinggalkan punya UJUNG. Peminta bisa mati di tengah rantai (sesi ditutup, agen
 * crash), dan tanpa penyapu ini alurnya "sebagian" selamanya — tak ada yang tahu apakah ia masih
 * ditunggu. Dipanggil dari tick lead; tak pernah membuat timer sendiri (ADR-0024).
 */
export async function expireFlows(now: Date): Promise<LeadFlow[]> {
  const due = await prisma.leadFlow.findMany({
    where: { status: { in: [...LEAD_FLOW_OPEN] }, expiresAt: { lt: now } },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  const out: LeadFlow[] = [];
  for (const f of due) {
    const closed = await closeFlow(f.id, "kedaluwarsa");
    if (closed) out.push(closed);
  }
  return out;
}

export function toFlowView(r: LeadFlow): LeadFlowView {
  return {
    id: r.id, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    gate: r.gate as LeadFlowView["gate"], status: r.status as LeadFlowView["status"],
    title: r.title, steps: r.steps, closeReason: r.closeReason,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    expiresAt: r.expiresAt.toISOString(),
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-flow.test.ts
```
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lead/flow.ts server/test/lead-flow.test.ts
git commit -m "feat(485): daur hidup rantai keputusan lead (open/join/step/close/expire)"
```

---

### Task 4: `decide()` — pilihan jamak, validasi, pemasangan alur

**Files:**
- Modify: `server/src/services/lead/decide.ts`
- Modify: `server/src/services/lead/trail.ts`
- Modify: `server/src/services/lead/prompt.ts`
- Test: `server/test/lead-decide.test.ts`, `server/test/lead-trail-choice.test.ts`, `server/test/lead-prompt.test.ts`

**Interfaces:**
- Consumes: `resolveChoices`, `normalizeSelect`, `checkChoiceCount`, `zLeadSelect` (Task 1);
  `openFlow`, `joinFlow`, `markFlowStep`, `closeFlow`, `LeadFlowClosedError` (Task 3).
- Produces:
  - `DecideRequest` bertambah `select?: LeadSelect`, `chain?: boolean`, `flowId?: string | null`
  - `LeadDecision` yang dikembalikan memuat `flowId`/`step`/`choices`/`select`
  - `TrailInput` bertambah `choices`, `select`, `flowId`, `step`
  - `toDecisionView` memancarkan `choices` (diturunkan untuk baris lama)
  - `LeadContext` bertambah `select?`, `chainSteps?: { question: string; options: string[]; picked: string[] }[]`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/lead-decide.test.ts` (ikuti pola `deps` stub yang sudah ada di berkas itu —
`think` disuntik, jadi tak ada agen sungguhan yang dijalankan):

```ts
describe("SPEC-485 · ADR-0102 · pilihan jamak & rantai", () => {
  const OPTS = ["alpha", "beta", "gamma"];
  const verdict = (o: Record<string, unknown>) =>
    "```json\n" + JSON.stringify({ decision: "d", reason: "r", ...o }) + "\n```";

  it("menyimpan beberapa pilihan sebagai daftar, dan `choice` jadi turunannya", async () => {
    const row = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q", options: OPTS,
        select: { mode: "multi", min: 1, max: 3 } },
      deps(verdict({ choices: ["1", "3"] })),
    );
    expect((row!.choices as unknown[])).toHaveLength(2);
    expect(row!.choice).toBe("alpha");
    expect(row!.choiceIndex).toBe(1);
  });

  it("jumlah di luar max MEMBATALKAN seluruh pilihan + weighty, tanpa menulis ulang `kind`", async () => {
    const row = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q", options: OPTS,
        select: { mode: "multi", min: 0, max: 1 } },
      deps(verdict({ choices: ["1", "2"] })),
    );
    expect(row!.choices).toBeNull();
    expect(row!.weighty).toBe(true);
    expect(row!.kind).toBe("answer");
    expect(row!.reason).toMatch(/DITOLAK/);
  });

  it("single tetap satu pilihan meski lead mengirim dua", async () => {
    const row = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q", options: OPTS },
      deps(verdict({ choices: ["1", "2"] })),
    );
    expect(row!.choices).toBeNull();
    expect(row!.reason).toMatch(/paling banyak 1/);
  });

  it("`choice` lama tanpa `choices` tetap terpakai (kompatibilitas ADR-0098)", async () => {
    const row = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q", options: OPTS },
      deps(verdict({ choice: "beta" })),
    );
    expect(row!.choice).toBe("beta");
    expect((row!.choices as unknown[])).toHaveLength(1);
  });

  it("permintaan tanpa `chain` melahirkan alur yang LANGSUNG tertutup", async () => {
    const row = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q" },
      deps(verdict({})),
    );
    const flow = await prisma.leadFlow.findUnique({ where: { id: row!.flowId! } });
    expect(flow!.status).toBe("selesai");
    expect(flow!.closeReason).toBe("tunggal");
    expect(row!.step).toBe(1);
  });

  it("permintaan ber-`chain` membiarkan alurnya terbuka, dan langkah kedua memakai alur yang sama", async () => {
    const a = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q1", chain: true },
      deps(verdict({})),
    );
    const b = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q2", chain: true, flowId: a!.flowId },
      deps(verdict({})),
    );
    expect(b!.flowId).toBe(a!.flowId);
    expect(b!.step).toBe(2);
    const flow = await prisma.leadFlow.findUnique({ where: { id: a!.flowId! } });
    expect(flow!.status).toBe("sebagian");
  });

  it("menambah langkah ke alur yang sudah tertutup melempar LeadFlowClosedError", async () => {
    const a = await decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q1" },
      deps(verdict({})),
    );
    await expect(decide(
      { projectId: PROJECT, gate: "contract", kind: "answer", question: "q2", flowId: a!.flowId },
      deps(verdict({})),
    )).rejects.toBeInstanceOf(LeadFlowClosedError);
  });
});
```

Tambahkan ke `server/test/lead-trail-choice.test.ts`:

```ts
it("SPEC-485 · baris LAMA (hanya choice/choiceIndex) tetap memancarkan `choices` satu elemen", () => {
  const view = toDecisionView({
    ...ROW_DASAR, choice: "beta", choiceIndex: 2, choices: null, select: null, flowId: null, step: null,
  } as never);
  expect(view.choices).toEqual([{ index: 2, option: "beta" }]);
});

it("SPEC-485 · baris tanpa pilihan sama sekali memancarkan daftar kosong", () => {
  const view = toDecisionView({ ...ROW_DASAR, choice: null, choiceIndex: null, choices: null } as never);
  expect(view.choices).toEqual([]);
});
```

Tambahkan ke `server/test/lead-prompt.test.ts`:

```ts
it("SPEC-485 · prompt menyebut berapa opsi boleh dipilih saat multi", () => {
  const p = leadPrompt(
    { kind: "answer", question: "q", options: ["a", "b", "c"] },
    { ...CTX, select: { mode: "multi", min: 1, max: 2 } },
  );
  expect(p).toContain("`choices`");
  expect(p).toMatch(/paling sedikit 1/);
  expect(p).toMatch(/paling banyak 2/);
});

it("SPEC-485 · langkah rantai sebelumnya ikut terbawa, terpisah dari keputusan lain", () => {
  const p = leadPrompt({ kind: "answer", question: "q2" }, {
    ...CTX,
    chainSteps: [{ question: "q1", options: ["a", "b"], picked: ["b"] }],
  });
  expect(p).toContain("Rantai keputusan ini");
  expect(p).toContain("q1");
  expect(p).toContain("b");
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-decide.test.ts server/test/lead-trail-choice.test.ts server/test/lead-prompt.test.ts
```
Expected: FAIL — `select` bukan properti `DecideRequest`, `row.flowId` undefined.

- [ ] **Step 3: `trail.ts` — tulis & baca kolom baru**

Tambahkan ke `TrailInput`:

```ts
  /** SPEC-485 · bentuk penyimpanan yang BERLAKU. `choice`/`choiceIndex` tinggal turunannya. */
  choices?: { index: number; option: string }[] | null;
  select?: { mode: string; min: number; max: number } | null;
  flowId?: string | null;
  step?: number | null;
```

Di `recordDecision`, di dalam `data`:

```ts
      choices: i.choices?.length ? i.choices : undefined,
      select: i.select ?? undefined,
      flowId: i.flowId ?? null,
      step: i.step ?? null,
```

Tambahkan `flowId` ke `TrailFilter` dan ke `where` `listDecisions`:

```ts
      ...(f.flowId ? { flowId: f.flowId } : {}),
```

serta urutkan naik saat menyaring satu rantai (langkahnya dibaca dari awal, bukan dari akhir):

```ts
    orderBy: f.flowId ? { createdAt: "asc" } : { createdAt: "desc" },
```

Di `toDecisionView`, setelah `choiceIndex`:

```ts
    // SPEC-485 · ADR-0102 · jawaban SELALU daftar di permukaan baca. Baris pra-migrasi tak punya
    // kolomnya, jadi ia DITURUNKAN dari pasangan skalar lama — itulah yang membuat riwayat lama
    // tetap terbaca sesudah perubahan skema (batasan kompatibilitas mundur).
    choices: Array.isArray(r.choices)
      ? (r.choices as { index?: unknown; option?: unknown }[])
          .map((c) => ({ index: Number(c?.index ?? 0) || 1, option: String(c?.option ?? "") }))
          .filter((c) => c.option !== "")
      : (r.choice ? [{ index: r.choiceIndex ?? 1, option: r.choice }] : []),
    select: (r.select as LeadDecisionView["select"]) ?? null,
    flowId: r.flowId, step: r.step,
```

- [ ] **Step 4: `prompt.ts` — batas pilihan & konteks rantai**

Tambahkan ke `LeadContext`:

```ts
  /** SPEC-485 · berapa opsi boleh dipilih. Tak ada = single, perilaku hari ini. */
  select?: { mode: "single" | "multi"; min: number; max: number };
  /**
   * SPEC-485 · langkah rantai yang SUDAH dijawab, urut naik. Sengaja terpisah dari
   * `priorDecisions` (10 terakhir se-project): yang satu urusan tak boleh tenggelam di antara yang
   * kebetulan berdekatan waktunya.
   */
  chainSteps?: { question: string; options: string[]; picked: string[] }[];
```

Di `leadPrompt`, ganti blok opsi (`if (q.options?.length) { … }`) menjadi:

```ts
  if (q.options?.length) {
    lines.push("");
    lines.push("Opsi yang dilihat peminta:");
    for (const [i, o] of q.options.entries()) lines.push(`${i + 1}. ${o}`);
    lines.push("");
    if (c.select?.mode === "multi") {
      lines.push(`Opsinya TIDAK saling eksklusif. Isi \`choices\` dengan daftar nomor atau label yang kamu pilih (mis. \`["1","3"]\`) — paling sedikit ${c.select.min}, paling banyak ${c.select.max}. Jumlah di luar itu membuat SELURUH pilihanmu dibatalkan, bukan dipangkas.`);
    } else {
      lines.push("Salah satu dari daftar itu WAJIB kamu pilih lewat field `choice` — isi nomornya (\"2\") atau labelnya persis.");
    }
    lines.push("Pilihan di luar daftar ditolak server, dicatat sebagai penolakan, dan peminta kembali menunggu manusia.");
  }
```

Dan sebelum blok `## Yang harus kamu putuskan`, sisipkan:

```ts
  if (c.chainSteps?.length) {
    lines.push("## Rantai keputusan ini (langkah yang sudah dijawab)");
    for (const [i, s] of c.chainSteps.entries()) {
      lines.push(`${i + 1}. "${s.question.slice(0, 200)}" → ${s.picked.length ? s.picked.join("; ") : "(tanpa pilihan)"}`);
      if (s.options.length) lines.push(`   opsi saat itu: ${s.options.map((o) => o.slice(0, 80)).join(" · ")}`);
    }
    lines.push("");
    lines.push("Pertanyaan di bawah adalah lanjutan dari rantai itu. Jangan bertentangan dengan yang sudah kamu putuskan di atas, dan jangan mengulang penjelasannya.");
    lines.push("");
  }
```

Ubah juga blok json contoh: tambahkan `choices: []` tepat setelah `choice`.

- [ ] **Step 5: `decide.ts` — pilihan jamak, validasi, alur**

Tambahkan ke `DecideRequest`:

```ts
  /** SPEC-485 · bentuk pilihan yang diminta peminta. Tak ada = single (perilaku hari ini). */
  select?: LeadSelect;
  /** `true` = peminta akan bertanya lagi; alurnya dibiarkan terbuka sampai di-submit. */
  chain?: boolean;
  /** Lanjutkan rantai. Tertutup/tak ada → `LeadFlowClosedError` (route menerjemahkannya jadi 409). */
  flowId?: string | null;
```

Di awal `decide()`, sesudah gerbang `leadActive`, pasang alurnya — SEBELUM panggilan agen, supaya
`flowId` tertutup ditolak tanpa membakar giliran:

```ts
  // SPEC-485 · ADR-0102 · alur dipasang di sini karena `decide()` adalah choke point tunggal
  // ketiga pintu (ADR-0091 G6) — tempat yang sama yang sudah memegang gerbang konkurensi SPEC-479.
  // Gerbang "alur tertutup" duduk SEBELUM panggilan agen: menolak sesudahnya berarti membakar satu
  // proses `claude -p` untuk permintaan yang memang tak boleh masuk.
  const flow = req.flowId ? await joinFlow(req.flowId) : await openFlow({
    projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
    gate: req.gate, title: req.question, ttlMin: cfg.flowTtlMin,
  });
  const step = flow.steps + 1;
```

Kumpulkan konteks rantai (sesudah `prior`):

```ts
  const chainRows = req.flowId
    ? await prisma.leadDecision.findMany({
        where: { flowId: flow.id }, orderBy: { createdAt: "asc" }, take: 10,
      })
    : [];
```

dan masukkan ke `ctx`:

```ts
    select: bounds,
    chainSteps: chainRows.map((d) => ({
      question: d.question,
      options: Array.isArray(d.options) ? (d.options as unknown[]).map(String) : [],
      picked: Array.isArray(d.choices)
        ? (d.choices as { option?: unknown }[]).map((c) => String(c?.option ?? "")).filter(Boolean)
        : (d.choice ? [d.choice] : []),
    })),
```

di mana `bounds` dihitung sebelum `ctx`:

```ts
  const options = req.options ?? [];
  const bounds = normalizeSelect(req.select ?? { mode: "single", min: 0, max: null }, options.length);
```

(hapus deklarasi `const options = req.options ?? []` yang lama di bawah).

Ganti blok resolusi pilihan SPEC-480 dengan:

```ts
  // SPEC-485 · ADR-0102 · pilihan SELALU daftar. `choices` kosong + `choice` terisi dibaca sebagai
  // satu pilihan: keluaran agen bentuk ADR-0098 harus tetap terpakai, dan menuntut field baru
  // berarti setiap agen lama mendadak "tak memilih apa pun".
  const rawChoices = verdict.choices.length ? verdict.choices
    : (verdict.choice.trim() ? [verdict.choice] : []);
  const resolved = resolveChoices(rawChoices, options);
  const countProblem = options.length && resolved.choices.length
    ? checkChoiceCount(resolved.choices.length, bounds) : null;
  // Jumlah di luar batas MEMBATALKAN seluruh pilihan, bukan memangkasnya: memilih 3 dari maksimum 2
  // adalah pertanda lead salah membaca soal, dan mengambil dua di antaranya secara sewenang-wenang
  // persis tebakan yang ADR-0098 ada untuk menghapusnya.
  const choices = countProblem ? [] : resolved.choices;
  const choice = choices[0] ?? null;
  const choiceRejected = options.length > 0 && rawChoices.length > 0 && (resolved.rejected.length > 0 || !!countProblem);
```

Sesuaikan turunan `action` (hint hanya untuk pilihan tunggal):

```ts
  if (allowed && choices.length === 1) {
    const hint = optionActionHint(choices[0]!.option);
    …   // isi blok tetap seperti sebelumnya, memakai `choices[0]!.option` sebagai label
  }
```

Catatan penolakan:

```ts
  if (resolved.rejected.length)
    notes.push(`DITOLAK: pilihan ${resolved.rejected.map((r) => `"${r.slice(0, 120)}"`).join(", ")} tidak ada di daftar opsi yang dikirim peminta (SPEC-480 · ADR-0098).`);
  if (countProblem)
    notes.push(`DITOLAK: ${countProblem} (SPEC-485 · ADR-0102) — seluruh pilihan dibatalkan.`);
```

`recordDecision(...)` menerima kolom baru:

```ts
    choice: choice?.option ?? null, choiceIndex: choice?.index ?? null,
    choices, select: bounds, flowId: flow.id, step,
    options, missing,
```

Sesudah `recordDecision`, urus alurnya:

```ts
  // Alur yang tak berantai ditutup SEKETIKA, apa pun status barisnya: baris `gagal` di dalam alur
  // `selesai` adalah jejak yang jujur, sementara menandainya `dibatalkan` mencampur "operator
  // membatalkan" dengan "lead tak sanggup" (ADR-0102 gotcha 7).
  await markFlowStep(flow.id, row.status === "berlaku");
  if (!req.chain) await closeFlow(flow.id, "tunggal");
```

`lastDelivery.set` memakai `choices`:

```ts
  lastDelivery.set(row.id, {
    decision: clampProse(verdict.decision, LEAD_DECISION_MAX),
    reason: `${clampProse(verdict.reason, LEAD_REASON_MAX)}${tail}`,
    reply: verdict.reply,
    choices, choice, missing,
  });
```

Jalur `fail()` juga harus memasang alurnya. Ubah tanda tangannya jadi
`fail(req, deps, reason, flow?: { id: string; step: number })` dan teruskan
`flowId: flow?.id ?? null, step: flow?.step ?? null` ke `recordDecision`; di kedua pemanggil di
dalam `decide()` kirim `{ id: flow.id, step }`, lalu **sesudah** `fail()` kembali jalankan
`await markFlowStep(flow.id, false); if (!req.chain) await closeFlow(flow.id, "tunggal");`.
Cara paling ringkas: bungkus dua `return fail(...)` menjadi
`return closeAfter(await fail(...), flow, step, req);` dengan helper lokal:

```ts
/** Satu tempat yang tahu bahwa alur harus ditutup bahkan ketika langkahnya gagal. */
async function closeAfter(row: LeadDecision, flowId: string, chain: boolean | undefined): Promise<LeadDecision> {
  await markFlowStep(flowId, row.status === "berlaku");
  if (!chain) await closeFlow(flowId, "tunggal");
  return row;
}
```

`LeadBusyError` **tidak** lewat sini — ia dilempar ulang sebelum baris apa pun ditulis. Alur yang
sudah terlanjur dibuka untuknya ditutup di `catch` yang sama:

```ts
    if (e instanceof LeadBusyError) { await closeFlow(flow.id, "kedaluwarsa").catch(() => {}); throw e; }
```

- [ ] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-decide.test.ts server/test/lead-trail-choice.test.ts server/test/lead-prompt.test.ts server/test/lead-flow.test.ts
```
Expected: PASS semua, termasuk test SPEC-480 lama di berkas yang sama.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/lead/decide.ts server/src/services/lead/trail.ts server/src/services/lead/prompt.ts server/test/lead-decide.test.ts server/test/lead-trail-choice.test.ts server/test/lead-prompt.test.ts
git commit -m "feat(485): decide() menyusun pilihan jamak & memasang rantai keputusan"
```

---

### Task 5: Permukaan HTTP

**Files:**
- Modify: `server/src/routes/lead.ts`
- Test: `server/test/lead-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 (`listFlows`, `closeFlow`, `toFlowView`, `LeadFlowClosedError`), Task 4 (`decide`).
- Produces: `GET /lead/flows`, `POST /lead/flows/:id/submit`, `POST /lead/flows/:id/cancel`,
  `GET /lead/decisions?flowId=`, `POST /lead/decisions` ber-`select`/`chain`/`flowId`,
  `POST /lead/decisions/:id/override` ber-`choices`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/lead-routes.test.ts` (pola `app.inject` yang sudah dipakai berkas itu):

```ts
describe("SPEC-485 · ADR-0102 · permukaan HTTP rantai & pilihan jamak", () => {
  it("400 saat bentuk select mustahil dipenuhi", async () => {
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", payload: {
      projectId: PROJECT, question: "q", options: ["a", "b"],
      select: { mode: "multi", min: 3, max: 2 },
    } });
    expect(r.statusCode).toBe(400);
  });

  it("400 saat multi tanpa opsi sama sekali", async () => {
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", payload: {
      projectId: PROJECT, question: "q", select: { mode: "multi", min: 1, max: 2 },
    } });
    expect(r.statusCode).toBe(400);
  });

  it("balasan membawa choices + flowId + flowStatus", async () => {
    const r = await app.inject({ method: "POST", url: "/api/lead/decisions", payload: {
      projectId: PROJECT, question: "q", options: ["a", "b", "c"],
      select: { mode: "multi", min: 1, max: 2 }, chain: true,
    } });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(Array.isArray(b.choices)).toBe(true);
    expect(typeof b.flowId).toBe("string");
    expect(b.flowStatus).toBe("sebagian");
  });

  it("submit menutup alur; menambah langkah sesudahnya ditolak 409", async () => {
    const open = await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q1", chain: true } });
    const flowId = open.json().flowId as string;

    const done = await app.inject({ method: "POST", url: `/api/lead/flows/${flowId}/submit`, payload: {} });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe("selesai");

    const late = await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q2", flowId } });
    expect(late.statusCode).toBe(409);

    const again = await app.inject({ method: "POST", url: `/api/lead/flows/${flowId}/submit`, payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it("cancel menutup alur sebagai `dibatalkan`", async () => {
    const open = await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q1", chain: true } });
    const r = await app.inject({ method: "POST", url: `/api/lead/flows/${open.json().flowId}/cancel`, payload: {} });
    expect(r.json().status).toBe("dibatalkan");
    expect(r.json().closeReason).toBe("operator");
  });

  it("GET /lead/flows menyaring per project, GET /lead/decisions?flowId= urut naik", async () => {
    const open = await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q1", chain: true } });
    const flowId = open.json().flowId as string;
    await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q2", chain: true, flowId } });

    const flows = await app.inject({ method: "GET", url: `/api/lead/flows?projectId=${PROJECT}` });
    expect(flows.json().items.some((f: { id: string }) => f.id === flowId)).toBe(true);

    const steps = await app.inject({ method: "GET", url: `/api/lead/decisions?flowId=${flowId}` });
    expect(steps.json().items.map((d: { question: string }) => d.question)).toEqual(["q1", "q2"]);
  });

  it("override menerima `choices` dan mengembalikannya di baris baru", async () => {
    const ask = await app.inject({ method: "POST", url: "/api/lead/decisions",
      payload: { projectId: PROJECT, question: "q", options: ["a", "b", "c"] } });
    const r = await app.inject({ method: "POST", url: `/api/lead/decisions/${ask.json().id}/override`,
      payload: { answer: "pilihan operator", choices: ["a", "c"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().next.choices.map((c: { option: string }) => c.option)).toEqual(["a", "c"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-routes.test.ts
```
Expected: FAIL — 404 untuk `/api/lead/flows/...`, `flowId` undefined di balasan.

- [ ] **Step 3: Validasi bentuk `select` + teruskan ke `decide` di `POST /lead/decisions`**

Sesudah `const ask = parsed.data;` (dan sesudah gerbang project/lead aktif) sisipkan:

```ts
    // SPEC-485 · ADR-0102 · validasi DI SERVER, bukan hanya UI. Bentuk yang mustahil dipenuhi
    // ditolak di pintu masuk: melahirkan baris `gagal` untuk permintaan yang memang salah bentuk
    // hanya memindahkan kesalahannya ke jejak.
    const optionCount = ask.options.length;
    if (ask.select.mode === "multi" && optionCount === 0)
      return reply.code(400).send({ error: "select.mode `multi` menuntut daftar `options`" });
    if (ask.select.max !== null && ask.select.min > ask.select.max)
      return reply.code(400).send({ error: "select.min melebihi select.max" });
    if (ask.select.max !== null && optionCount > 0 && ask.select.max > optionCount)
      return reply.code(400).send({ error: `select.max (${ask.select.max}) melebihi jumlah opsi (${optionCount})` });
    if (ask.select.min > optionCount)
      return reply.code(400).send({ error: `select.min (${ask.select.min}) melebihi jumlah opsi (${optionCount})` });
```

Teruskan ke `decide`: tambahkan `select: ask.select, chain: ask.chain, flowId: ask.flowId ?? null,`
ke objek permintaan, dan tangkap `LeadFlowClosedError` di `catch` yang sudah ada:

```ts
    } catch (e) {
      // 409 · alur yang sudah ditutup tak bisa menerima pertanyaan lanjutan. Bukan 400 (bentuknya
      // sah) dan bukan 404 (alurnya ada, hanya sudah selesai).
      if (e instanceof LeadFlowClosedError) return reply.code(409).send({ error: e.message });
      if (!(e instanceof LeadBusyError)) throw e;
      …
```

Perkaya `answer`:

```ts
      choices: sent?.choices ?? (Array.isArray(row.choices)
        ? (row.choices as { index?: unknown; option?: unknown }[]).map((c) => ({ index: Number(c?.index ?? 1), option: String(c?.option ?? "") }))
        : (row.choice ? [{ index: row.choiceIndex ?? 1, option: row.choice }] : [])),
      flowId: row.flowId,
      flowStatus: row.flowId
        ? ((await prisma.leadFlow.findUnique({ where: { id: row.flowId }, select: { status: true } }))?.status as LeadAnswer["flowStatus"] ?? null)
        : null,
```

- [ ] **Step 4: Endpoint alur + filter `flowId` + override ber-`choices`**

Tambahkan sesudah `GET /lead/decisions`:

```ts
  // SPEC-485 · ADR-0102 · satu rantai bisa dibaca ulang utuh: daftar alur di sini, langkahnya lewat
  // `GET /lead/decisions?flowId=` (urut naik). Sengaja dua endpoint, bukan satu yang bersarang:
  // langkah adalah baris jejak biasa, dan menyalinnya ke serializer kedua berarti dua bentuk yang
  // bisa berselisih.
  app.get("/lead/flows", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const rows = await listFlows({
      projectId: q.projectId, status: q.status,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
    });
    return { items: rows.map(toFlowView) };
  });

  app.post("/lead/flows/:id/submit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await closeFlow(id, "submit");
    if (!row) return reply.code(409).send({ error: "rantai tak ada atau sudah tertutup" });
    return toFlowView(row);
  });

  app.post("/lead/flows/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await closeFlow(id, "operator");
    if (!row) return reply.code(409).send({ error: "rantai tak ada atau sudah tertutup" });
    return toFlowView(row);
  });
```

Teruskan `flowId` di `GET /lead/decisions`: tambahkan `flowId: q.flowId,` ke argumen `listDecisions`.

Override: ubah `zLeadOverride` di `shared/src/lead.ts` menjadi

```ts
export const zLeadOverride = z.object({
  answer: z.string().min(1).max(8000),
  reason: z.string().max(8000).default(""),
  /** SPEC-485 · centang operator, sebagai DATA. Dipetakan ke opsi baris yang ditimpa. */
  choices: z.array(z.string().max(2000)).max(20).default([]),
});
```

dan `overrideDecision(id, answer, reason)` di `trail.ts` menjadi
`overrideDecision(id, answer, reason, rawChoices: string[] = [])`, yang memetakan lewat
`resolveChoices(rawChoices, options lama)` dan menaruh hasilnya di baris baru:

```ts
  const options = Array.isArray(old.options) ? (old.options as unknown[]).map(String) : [];
  const { choices } = resolveChoices(rawChoices, options);
  const next = await recordDecision({
    …,
    choices, choice: choices[0]?.option ?? null, choiceIndex: choices[0]?.index ?? null,
    options, select: old.select as never, flowId: old.flowId, step: old.step,
    …
  });
```

Di route override, teruskan `parsed.data.choices` dan kirim centangnya ke pane:

```ts
      delivered = await sendToPane(r.next.sessionId, parsed.data.answer, 50,
        toDecisionView(r.next).choices.map((c) => c.option)).catch(() => false);
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-routes.test.ts server/test/mcp-capability.test.ts
```
Expected: PASS. `mcp-capability.test.ts` ikut dijalankan karena ia mengunci peta capability terhadap
path `/lead/*` — endpoint baru harus jatuh ke `lead:read`/`lead:write` menurut method tanpa peta baru.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/lead.ts server/src/services/lead/trail.ts shared/src/lead.ts server/test/lead-routes.test.ts
git commit -m "feat(485): endpoint rantai keputusan + validasi select di server"
```

---

### Task 6: Penyapu alur kedaluwarsa di tick lead

**Files:**
- Modify: `server/src/services/lead/engine.ts`
- Test: `server/test/lead-engine.test.ts`

**Interfaces:**
- Consumes: `expireFlows` (Task 3), `getLead` (ada).
- Produces: `LeadTickDeps.expire?: (now: Date) => Promise<{ id: string; projectId: string; specId: string | null; sessionId: string | null; title: string }[]>`
  dan `LeadTickDeps.notify?` — keduanya disuntikkan supaya penyapu teruji tanpa DB nyata.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/lead-engine.test.ts`:

```ts
it("SPEC-485 · tick menutup rantai kedaluwarsa & menotifikasi sekali per alur", async () => {
  const expired = [{ id: "f1", projectId: "p", specId: null, sessionId: "s1", title: "q1" }];
  const seen: string[] = [];
  await tick(Date.now(), {
    detect: stubDetect(), pulse: stubPulse(),
    expire: async () => expired,
    notify: async (_id, title) => { seen.push(title); },
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/rantai keputusan/i);
});

it("SPEC-485 · penyapu yang melempar tak menjatuhkan tick (AC-37)", async () => {
  await expect(tick(Date.now(), {
    detect: stubDetect(), pulse: stubPulse(),
    expire: async () => { throw new Error("db mati"); },
  })).resolves.toBeUndefined();
});
```

(`stubDetect`/`stubPulse` sudah ada di berkas itu; kalau namanya berbeda, pakai helper yang ada.)

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-engine.test.ts
```
Expected: FAIL — `expire` bukan properti `LeadTickDeps`, `seen` kosong.

- [ ] **Step 3: Implementasi di `engine.ts`**

Tambah import:

```ts
import { expireFlows } from "./flow";
import { recordLeadDecision } from "../notifications";
```

Tambah ke `LeadTickDeps`:

```ts
  /**
   * SPEC-485 · ADR-0102 · penyapu rantai yang ditinggalkan. Ia MENUMPANG tick ini, bukan membuat
   * `setInterval` sendiri — ADR-0024 melarang timer/scheduler baru, dan pola ini sama dengan
   * penguras antrean webhook (ADR-0100) & governor scheduler (ADR-0072).
   */
  expire?: (now: Date) => Promise<{ id: string; projectId: string; specId: string | null; sessionId: string | null; title: string }[]>;
  notify?: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
```

Di `tick()`, sesudah blok `busyDetect` (dan sebelum blok denyut), tambahkan:

```ts
  // Penyapu murah (satu query berindeks `status`), jadi ia ikut irama 5 detik tanpa penjaga
  // re-entrancy sendiri: `expireFlows` idempoten — alur yang sudah tertutup dilewatkan `closeFlow`.
  jobs.push((async () => {
    const expire = deps.expire ?? expireFlows;
    const notify = deps.notify ?? recordLeadDecision;
    for (const f of await expire(new Date())) {
      await notify(f.id, `Rantai keputusan lead ditutup karena kedaluwarsa: ${f.title.slice(0, 80)}`,
        f.projectId, f.specId, f.sessionId);
    }
  })().catch((e) => { console.error("lead expire:", e); }));
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/lead-engine.test.ts
```
Expected: PASS, termasuk test irama SPEC-432 yang sudah ada.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lead/engine.ts server/test/lead-engine.test.ts
git commit -m "feat(485): rantai yang ditinggalkan ditutup penyapu di tick lead"
```

---

### Task 7: Dialog `multiSelect` di pane — baca & centang

**Files:**
- Modify: `server/src/services/tui-dialog.ts`
- Modify: `server/src/services/pty.ts`
- Modify: `server/src/services/lead/detect.ts`
- Test: `server/test/tui-dialog.test.ts`, `server/test/lead-detect.test.ts`

**Interfaces:**
- Consumes: `goalChunks`, `PaneIO`, `readChoiceDialog` (ada); `resolveChoices` (Task 1).
- Produces:
  - `ChoiceRow.checked: boolean | null` (null = baris tanpa kotak)
  - `ChoiceDialog.multi: boolean`, `ChoiceDialog.submit: { present: boolean; focused: boolean }`
  - `DialogScreen` varian `question` bertambah `multi`, `submit`
  - `focusedRow(paneText: string): number | null`
  - `answerMultiSelectDialog(io: PaneIO, plan: { pick: number[]; line: string; freeIndex: number | null }, chunkMs: number): Promise<boolean>`
  - `sendToPane(id, text, chunkMs?, choices?: string[])`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/tui-dialog.test.ts` — fixture di bawah adalah tangkapan
`capture-pane -p -J` **sungguhan** dari claude 2.1.220 (probe SPEC-485), bukan karangan:

```ts
const ASKQ_MULTI = `
❯ Panggil tool AskUserQuestion TEPAT SEKALI dengan satu pertanyaan multi-select.
────────────────────────────────────────────────────────────────────────────────
←  ☐ Paket  ✔ Submit  →

Paket mana yang dipakai?

❯ 1. [ ] alpha
  paket alpha
  2. [ ] beta
  paket beta
  3. [ ] gamma
  paket gamma
  4. [ ] Type something
     Submit
────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

const ASKQ_MULTI_TERCENTANG = ASKQ_MULTI
  .replace("2. [ ] beta", "2. [✔] beta")
  .replace("←  ☐ Paket", "←  ☒ Paket");

const ASKQ_MULTI_SUBMIT_FOKUS = ASKQ_MULTI
  .replace("❯ 1. [ ] alpha", "  1. [ ] alpha")
  .replace("     Submit", "❯    Submit");

describe("SPEC-485 · ADR-0102 · dialog multiSelect", () => {
  it("mengupas kotak centang sehingga opsi & kolom bebas terbaca benar", () => {
    const d = readChoiceDialog(ASKQ_MULTI)!;
    expect(d.multi).toBe(true);
    expect(d.options).toEqual(["alpha", "beta", "gamma"]);
    expect(d.freeIndex).toBe(4);          // tanpa pengupasan, "[ ] Type something" tak dikenali
    expect(d.rows.find((r) => r.n === 2)!.checked).toBe(false);
  });

  it("membaca keadaan tercentang", () => {
    const d = readChoiceDialog(ASKQ_MULTI_TERCENTANG)!;
    expect(d.rows.find((r) => r.n === 2)!.checked).toBe(true);
  });

  it("membaca tombol kirim tanpa nomor, termasuk saat ia yang tersorot", () => {
    expect(readChoiceDialog(ASKQ_MULTI)!.submit).toEqual({ present: true, focused: false });
    expect(readChoiceDialog(ASKQ_MULTI_SUBMIT_FOKUS)!.submit).toEqual({ present: true, focused: true });
  });

  it("`Next` juga terbaca sebagai tombol kirim (dialog berantai)", () => {
    const d = readChoiceDialog(ASKQ_MULTI.replace("     Submit", "     Next"))!;
    expect(d.submit.present).toBe(true);
  });

  it("GOTCHA 1 · dialogKey TIDAK berubah saat kotak dicentang", () => {
    expect(dialogKey(ASKQ_MULTI_TERCENTANG)).toBe(dialogKey(ASKQ_MULTI));
  });

  it("dialogKey tetap berubah saat PERTANYAANNYA berganti", () => {
    expect(dialogKey(ASKQ_MULTI.replace("Paket mana yang dipakai?", "Versi mana?")))
      .not.toBe(dialogKey(ASKQ_MULTI));
  });

  it("dialog single-select TIDAK ikut jadi multi (fail-closed)", () => {
    const d = readChoiceDialog(ASKQ_TIGA_OPSI)!;
    expect(d.multi).toBe(false);
    expect(d.submit.present).toBe(false);
  });

  it("focusedRow membaca posisi ❯", () => {
    expect(focusedRow(ASKQ_MULTI)).toBe(1);
    expect(focusedRow(ASKQ_MULTI_SUBMIT_FOKUS)).toBeNull();   // ❯ ada di tombol, bukan di baris
  });

  it("answerMultiSelectDialog: toggle satu karakter, panah satu per satu, Enter hanya di tombol", async () => {
    const frames = [ASKQ_MULTI, ASKQ_MULTI_TERCENTANG, ASKQ_MULTI_TERCENTANG, ASKQ_MULTI_SUBMIT_FOKUS];
    let i = 0;
    const keys: string[] = [];
    const io: PaneIO = {
      capture: () => frames[Math.min(i, frames.length - 1)]!,
      literal: (s) => { keys.push(s); i++; },
      enter: () => { keys.push("<enter>"); },
      sleep: async () => {},
    };
    const ok = await answerMultiSelectDialog(io, { pick: [2], line: "", freeIndex: null }, 0);
    expect(ok).toBe(true);
    expect(keys[0]).toBe("2");                       // toggle sebagai SATU karakter
    expect(keys.filter((k) => k === "<down>")).not.toHaveLength(0);
    expect(keys[keys.length - 1]).toBe("<enter>");   // Enter hanya sesudah tombol tersorot
  });

  it("toggle yang TAK mendarat menggagalkan seluruh jawaban (fail-closed)", async () => {
    const io: PaneIO = {
      capture: () => ASKQ_MULTI,                     // layar tak pernah berubah
      literal: () => {}, enter: () => { throw new Error("Enter tak boleh ditekan"); },
      sleep: async () => {},
    };
    expect(await answerMultiSelectDialog(io, { pick: [2], line: "", freeIndex: null }, 0)).toBe(false);
  });
});
```

`PaneIO` bertambah satu primitif; tambahkan `down: () => void` ke tipenya dan ke stub di atas
(`down: () => { keys.push("<down>"); i++; }`).

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/tui-dialog.test.ts
```
Expected: FAIL — `d.multi` undefined, `answerMultiSelectDialog is not a function`.

- [ ] **Step 3: Pembacaan di `tui-dialog.ts`**

```ts
// SPEC-485 · ADR-0102 · dialog `multiSelect` merender kotak centang DI DEPAN label:
// `1. [ ] alpha` / `2. [✔] beta`. Tanpa dikupas, label yang sampai ke lead penuh ornamen dan
// `[ ] Type something` tak lagi cocok `PLACEHOLDER` — kolom bebasnya jadi tak terlihat.
const CHECK = /^\[([ xX✔✓])\]\s*(.*)$/;

// Tombol kirim multiSelect TANPA nomor (`     Submit`, `❯    Submit`), dan berbunyi `Next` bila
// pertanyaannya belum yang terakhir dalam rantai. Pola ini sengaja menuntut baris tanpa nomor agar
// `N. Submit answers` milik layar rekap (SPEC-474) tak ikut tertangkap.
const SUBMIT_BTN = /^\s*([❯>›])?\s{2,}(Submit|Next)\s*$/;
```

Di `readChoiceDialog`, sesudah `run` disusun, ganti pembentukan `rows`:

```ts
  const rows: ChoiceRow[] = run.map((r) => {
    const m = CHECK.exec(r.label);
    const label = m ? (m[2] ?? "").trim() : r.label;
    return {
      n: r.n, label,
      checked: m ? m[1] !== " " : null,
      free: PLACEHOLDER.test(label),
      chat: CHAT_ROW.test(label),
    };
  });
  let submit = { present: false, focused: false };
  for (const line of lines.slice(0, footer)) {
    const m = SUBMIT_BTN.exec(line);
    if (m) submit = { present: true, focused: !!m[1] };
  }
  return {
    rows,
    multi: rows.some((r) => r.checked !== null),
    submit,
    freeIndex: rows.find((r) => r.free)?.n ?? null,
    options: rows.filter((r) => !r.free && !r.chat).map((r) => r.label),
  };
```

Tambahkan `checked` ke `ChoiceRow`, `multi`/`submit` ke `ChoiceDialog`, dan teruskan keduanya ke
varian `question` di `readDialogScreen`.

Baris tersorot:

```ts
/** Nomor baris yang sedang disorot (`❯`), atau `null` bila sorotannya bukan di baris bernomor. */
export function focusedRow(paneText: string): number | null {
  const lines = paneText.split("\n").map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*[❯>›]\s*(\d{1,2})\.\s+\S/.exec(lines[i] ?? "");
    if (m) return Number(m[1]);
  }
  return null;
}
```

`dialogKey` — buang penanda `☐/☒` untuk layar multi:

```ts
  if (s.kind === "review") return "review";
  // GOTCHA ADR-0102 #1 · mencentang satu opsi sudah membalik tab yang sedang tampil jadi `☒`
  // (terukur) TANPA satu pun pertanyaan berpindah. Kunci yang ikut berubah membaca layar yang
  // MACET sebagai layar yang MAJU — bentuk yang sama persis yang SPEC-474 tutup untuk label kolom
  // bebas, lewat pintu baru. Untuk layar multi kemajuan dibaca dari JUDUL, layar rekap, atau
  // layar yang berhenti jadi dialog.
  const tabs = s.multi
    ? s.tabs.map((t) => t.header).join(",")
    : s.tabs.map((t) => `${t.answered ? "x" : "o"}${t.header}`).join(",");
  return `q|${s.multi ? "multi|" : ""}${tabs}|${s.title || s.options.join("|")}`;
```

- [ ] **Step 4: Penulisan di `tui-dialog.ts`**

Tambahkan `down: () => void` ke `PaneIO`, lalu:

```ts
/** Berapa kali fokus digeser sebelum menyerah. Berbatas: pane yang tak merespons harus punya ujung. */
const NAV_TRIES = 24;

/**
 * SPEC-485 · ADR-0102 · jawab dialog `multiSelect`.
 *
 * Urutannya MENGIKAT, ketiganya hasil pengukuran in-vivo (claude 2.1.220):
 *
 * 1. **Digit MEN-TOGGLE**, bukan memilih-lalu-mengirim (`b = toggleValue` di widget). Jadi tiap
 *    opsi ditekan nomornya sebagai `send-keys` tersendiri berisi SATU karakter, lalu layarnya
 *    DIBACA ULANG untuk membuktikan kotaknya benar-benar berubah. Tanpa pembuktian itu, jawaban
 *    yang tak mendarat tetap berujung `Enter` — bug SPEC-452 lewat pintu baru.
 * 2. **Kolom bebas hanya bisa dicapai lewat navigasi.** Menekan nomornya justru men-toggle
 *    `__other__` dengan teks kosong. Dan panah pun satu keystroke per pemanggilan: terukur, empat
 *    panah dalam satu `send-keys` memindahkan fokus SATU baris (jebakan burst ADR-0085).
 * 3. **`Enter` hanya di tombol kirim.** Di baris opsi ia men-toggle, karena tombolnya ada.
 *
 * Fail-closed di tiap langkah: `false` berarti sesi jatuh ke perilaku pra-ADR-0091 (menunggu
 * manusia), bukan ke tombol yang ditekan asal.
 */
export async function answerMultiSelectDialog(
  io: PaneIO,
  plan: { pick: number[]; line: string; freeIndex: number | null },
  chunkMs: number,
): Promise<boolean> {
  const want = new Set(plan.pick);
  const state = () => readChoiceDialog(io.capture());

  // 1 · samakan kotak centang dengan rencana. Idempoten: yang sudah benar dilewati.
  for (const row of state()?.rows ?? []) {
    if (row.checked === null || row.free || row.chat) continue;
    if (row.checked === want.has(row.n)) continue;
    io.literal(String(row.n));
    await io.sleep(DIALOG_SETTLE_MS);
    const after = state()?.rows.find((r) => r.n === row.n);
    if (!after || after.checked !== want.has(row.n)) return false;
  }

  // 2 · prosa lewat kolom bebas, bila ada yang perlu disampaikan.
  if (plan.line && plan.freeIndex !== null) {
    let hop = 0;
    while (focusedRow(io.capture()) !== plan.freeIndex && hop < NAV_TRIES) {
      io.down(); await io.sleep(DIALOG_SETTLE_MS); hop++;
    }
    if (focusedRow(io.capture()) !== plan.freeIndex) return false;
    for (const chunk of goalChunks(plan.line)) { io.literal(chunk); await io.sleep(chunkMs); }
    await io.sleep(DIALOG_SETTLE_MS);
    if (!freeTextFilled(io.capture(), plan.freeIndex)) return false;
  }

  // 3 · tombol kirim, lalu Enter.
  let hop = 0;
  while (!state()?.submit.focused && hop < NAV_TRIES) {
    io.down(); await io.sleep(DIALOG_SETTLE_MS); hop++;
  }
  if (!state()?.submit.focused) return false;
  io.enter();
  return true;
}
```

`freeTextFilled` harus ikut mengupas kotak — ia sudah memakai `readChoiceDialog`, yang sesudah
Step 3 mengembalikan label terkupas, jadi tak ada perubahan yang perlu di sana.

- [ ] **Step 5: `pty.ts` — pilihan sebagai data**

Tambah `down` ke `dialogIO`:

```ts
  down: () => { tmux("send-keys", "-t", name(id), "Down"); },
```

Ubah tanda tangan & dispatch `sendToPane`:

```ts
export async function sendToPane(id: string, text: string, chunkMs = 50, choices: string[] = []): Promise<boolean> {
  …
    if (screen?.kind === "question") {
      // SPEC-485 · ADR-0102 · dialog multiSelect dijawab dengan MENCENTANG. Labelnya dipetakan ke
      // nomor baris lewat `resolveChoices` terhadap opsi layar itu sendiri, jadi kecocokannya
      // persis. Tanpa satu pun pilihan yang cocok, prosanya tetap disampaikan lewat kolom bebas —
      // dialog tetap maju, hanya tanpa kotak tercentang.
      if (screen.multi && screen.submit.present) {
        const pick = resolveChoices(choices, screen.options).choices.map((c) => c.index);
        return await answerMultiSelectDialog(io, { pick, line, freeIndex: screen.freeIndex }, chunkMs);
      }
      if (screen.freeIndex !== null) return await answerChoiceDialog(io, screen.freeIndex, line, chunkMs);
      if (screen.notes) return await answerNotesDialog(io, line, chunkMs);
    }
```

- [ ] **Step 6: `detect.ts` — teruskan pilihannya**

`DetectDeps.send` jadi
`send: (id: string, text: string, choices: string[]) => Promise<boolean>`; `prodDetectDeps.send`
jadi `(id, text, choices) => sendToPane(id, text, 50, choices)`. Di `runChain`:

```ts
    const sent = deps.delivery(row.id);
    const reply = (sent ? leadReplyText(sent) : "") || row.answer;
    const picked = sent?.choices.map((c) => c.option) ?? [];
    if (!(await deps.send(s.id, reply, picked)))
```

Tambahkan test di `server/test/lead-detect.test.ts`:

```ts
it("SPEC-485 · pilihan lead diteruskan ke pane sebagai data, bukan cuma prosa", async () => {
  const seen: string[][] = [];
  const deps = makeDeps({
    delivery: () => ({ decision: "d", reason: "r", reply: "", missing: [],
      choices: [{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }],
      choice: { index: 1, option: "alpha" } }),
    send: async (_id, _text, choices) => { seen.push(choices); return true; },
  });
  await scanAndAnswer(deps);
  expect(seen[0]).toEqual(["alpha", "gamma"]);
});
```

- [ ] **Step 7: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/tui-dialog.test.ts server/test/lead-detect.test.ts server/test/lead-pane.test.ts server/test/pty.test.ts
```
Expected: PASS. `pty.test.ts` & `lead-pane.test.ts` ikut sebagai bukti jalur single-select
SPEC-452/474 tak bergeser satu byte pun.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/tui-dialog.ts server/src/services/pty.ts server/src/services/lead/detect.ts server/test/tui-dialog.test.ts server/test/lead-detect.test.ts
git commit -m "feat(485): lead mencentang dialog multiSelect claude, bukan mengetik prosa saja"
```

---

### Task 8: Dashboard — radio/checkbox & kartu rantai

**Files:**
- Modify: `src/src/ds/components/forms.tsx`
- Modify: `src/src/ds/index.ts`
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/LeadScreen.tsx`
- Test: `src/test/lead-screen.test.tsx`

**Interfaces:**
- Consumes: `LeadDecisionView.choices/options/select`, `LeadFlowView`, `paths.leadFlows*` (Task 1/5).
- Produces: DS `Radio`; `api.getLeadFlows`, `api.submitLeadFlow`, `api.cancelLeadFlow`;
  `api.overrideLeadDecision(id, answer, reason?, choices?)`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/lead-screen.test.tsx` (ikuti pola mock `api` yang sudah dipakai berkas itu):

```tsx
it("SPEC-485 · Timpa menampilkan RADIO saat pilihannya tunggal", async () => {
  renderLead({ decisions: [row({ options: ["alpha", "beta"], select: { mode: "single", min: 0, max: 1 } })] });
  await userEvent.click(await screen.findByRole("button", { name: /timpa/i }));
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});

it("SPEC-485 · Timpa menampilkan CHECKBOX saat pilihannya jamak, dan mengirim semua yang dicentang", async () => {
  const spy = vi.fn().mockResolvedValue({ old: {}, next: {}, delivered: true });
  renderLead({
    decisions: [row({ options: ["alpha", "beta", "gamma"], select: { mode: "multi", min: 1, max: 3 } })],
    overrideLeadDecision: spy,
  });
  await userEvent.click(await screen.findByRole("button", { name: /timpa/i }));
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes).toHaveLength(3);
  await userEvent.click(boxes[0]!);
  await userEvent.click(boxes[2]!);
  await userEvent.click(screen.getByRole("button", { name: /simpan/i }));
  expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), "", ["alpha", "gamma"]);
});

it("SPEC-485 · baris dengan pilihan jamak menampilkan semua label terpilih", async () => {
  renderLead({ decisions: [row({
    options: ["alpha", "beta", "gamma"],
    choices: [{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }],
  })] });
  expect(await screen.findByText(/alpha/)).toBeTruthy();
  expect(screen.getByText(/gamma/)).toBeTruthy();
  expect(screen.getByText("2 dari 3 opsi")).toBeTruthy();
});

it("SPEC-485 · kartu rantai merender status & tombol hanya untuk alur terbuka", async () => {
  renderLead({ flows: [
    flow({ id: "f1", status: "sebagian", title: "q1", steps: 2 }),
    flow({ id: "f2", status: "selesai", title: "q2", steps: 1 }),
  ] });
  expect(await screen.findByText("sebagian")).toBeTruthy();
  expect(screen.getByText("selesai")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /submit/i })).toHaveLength(1);
});

it("SPEC-485 · respons server lama (tanpa `choices`/`flows`) tak meruntuhkan panel", async () => {
  renderLead({ decisions: [row({ choices: undefined, options: undefined })], flows: undefined });
  expect(await screen.findByText(/Keputusan/)).toBeTruthy();
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism src/test/lead-screen.test.tsx
```
Expected: FAIL — tak ada `role="radio"`, `api.getLeadFlows` bukan fungsi.
(`env -u NODE_ENV` wajib: `NODE_ENV=production` di env sesi membuat RTL `act` gagal massal.)

- [ ] **Step 3: DS `Radio` + peran pada `Checkbox`**

Di `src/src/ds/components/forms.tsx`, pada `Checkbox`, tambahkan pada `<span>` yang bisa diklik:
`role: "checkbox", "aria-checked": on, tabIndex: disabled ? -1 : 0,`.

Lalu tambahkan komponen baru tepat sesudahnya:

```tsx
// SPEC-485 · ADR-0102 · pilihan tunggal butuh kontrol yang MENYATAKAN dirinya tunggal. Cermin
// `Checkbox` di atas — bentuknya saja yang bundar dan `role`-nya `radio`, supaya test & pembaca
// layar bisa membedakan "pilih salah satu" dari "centang beberapa" tanpa membaca teksnya.
type RadioProps = { checked?: boolean; onChange?: (e: React.MouseEvent) => void;
  label?: React.ReactNode; description?: React.ReactNode; disabled?: boolean;
  style?: React.CSSProperties } & Record<string, any>;
export function Radio({ checked = false, onChange, label, description, disabled = false, className = "", style = {}, ...rest }: RadioProps) {
  const pick = (e: React.MouseEvent) => { if (!disabled) onChange && onChange(e); };
  return React.createElement("label", _extends({
    className,
    style: { display: "inline-flex", alignItems: description ? "flex-start" : "center", gap: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...style },
  }, rest),
    React.createElement("span", {
      role: "radio", "aria-checked": checked, tabIndex: disabled ? -1 : 0, onClick: pick,
      style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18,
        marginTop: description ? 2 : 0, borderRadius: "var(--radius-pill)",
        background: "var(--surface-card)",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
        boxShadow: checked ? "none" : "var(--shadow-inset)", transition: "var(--transition-fast)", flex: "0 0 auto" },
    }, checked && React.createElement("span", { style: { width: 8, height: 8,
      borderRadius: "var(--radius-pill)", background: "var(--accent)" } })),
    (label || description) && React.createElement("span", { onClick: pick, style: { userSelect: "none" } },
      label && React.createElement("span", { style: { display: "block", fontSize: "var(--text-md)",
        color: "var(--text-strong)", lineHeight: 1.4 } }, label),
      description && React.createElement("span", { style: { display: "block", fontSize: "var(--text-sm)",
        color: "var(--text-muted)", lineHeight: 1.45 } }, description)));
}
```

`src/src/ds/index.ts`: tambahkan `Radio` ke ekspor `./components/forms`.

- [ ] **Step 4: API client**

```ts
  overrideLeadDecision: (id: string, answer: string, reason = "", choices: string[] = []) =>
    j<{ old: LeadDecisionView; next: LeadDecisionView; delivered: boolean }>(
      paths.leadDecisionOverride(id), { method: "POST", ...body({ answer, reason, choices }) }),
  // SPEC-485 · ADR-0102 · rantai keputusan. Tetap polling HTTP — tak ada kanal WS baru (ADR-0039).
  getLeadFlows: (params: { projectId?: string; status?: string; take?: number } = {}) =>
    j<{ items: LeadFlowView[] }>(paths.leadFlows + qs(params)),
  submitLeadFlow: (id: string) => j<LeadFlowView>(paths.leadFlowSubmit(id), { method: "POST", ...body({}) }),
  cancelLeadFlow: (id: string) => j<LeadFlowView>(paths.leadFlowCancel(id), { method: "POST", ...body({}) }),
```

(tambahkan `LeadFlowView` ke `import type` di kepala berkas.)

- [ ] **Step 5: `LeadScreen.tsx`**

Tambahkan komponen pemilih di atas `DecisionRow`:

```tsx
/** SPEC-485 · kontrol yang menyatakan bentuk pilihannya: radio untuk tunggal, checkbox untuk jamak. */
function ChoicePicker({ options, multi, value, onChange }: {
  options: string[]; multi: boolean; value: string[]; onChange: (next: string[]) => void;
}) {
  const toggle = (o: string) => {
    if (!multi) { onChange([o]); return; }
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {options.map((o) => multi
        ? <Checkbox key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />
        : <Radio key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />)}
    </div>
  );
}
```

Di `DecisionRow`, ganti badge & jawaban:

```tsx
        {picked.length > 0 && (d.options ?? []).length > 0 &&
          <Badge tone="brass" size="sm">
            {picked.length > 1 ? `${picked.length} dari ${d.options.length} opsi` : `opsi ${picked[0]!.index}/${d.options.length}`}
          </Badge>}
```

dengan `const picked = d.choices ?? (d.choiceIndex != null && d.choice ? [{ index: d.choiceIndex, option: d.choice }] : []);`
(di atas `return`), dan baris jawaban:

```tsx
        {picked.length ? picked.map((c) => c.option).join(" · ")
          : (d.answer || <em style={{ fontWeight: 400, color: "var(--text-muted)" }}>tak ada jawaban</em>)}
```

Panel Timpa:

```tsx
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {(d.options ?? []).length > 0 && (
            <ChoicePicker options={d.options} multi={d.select?.mode === "multi"}
              value={draftChoices} onChange={setDraftChoices} />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Input style={{ flex: 1 }} aria-label={`jawaban operator untuk ${d.id}`}
              placeholder="Jawaban kamu — dikirim ke sesi bila panenya masih hidup"
              value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
            <Button size="sm" leftIcon="check"
              disabled={(!draft.trim() && draftChoices.length === 0) || busyId === d.id}
              onClick={() => { onOverride(d.id, draft.trim() || draftChoices.join("; "), draftChoices);
                setOpen(false); setDraft(""); setDraftChoices([]); }}>Simpan</Button>
          </div>
        </div>
      )}
```

dengan `const [draftChoices, setDraftChoices] = React.useState<string[]>([]);` dan
`onOverride: (id: string, answer: string, choices: string[]) => void`.

Kartu rantai, di antara "Sesi menunggu keputusan" dan "Keputusan":

```tsx
      <Card eyebrow="lead · rantai keputusan" title={`Rantai (${flows.length})`}>
        {flows.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada rantai. Satu rantai adalah satu urusan — beberapa pertanyaan berurutan sampai di-submit.
            </div>
          : flows.map((f) => (
            <RowShell key={f.id}>
              <Badge tone={FLOW_TONE[f.status] ?? "neutral"} size="sm">{f.status}</Badge>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>{f.title}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {f.steps} langkah · {ago(f.openedAt)}
              </span>
              {FLOW_OPEN.has(f.status) && <>
                <Button size="sm" leftIcon="check" disabled={busyId === f.id}
                  onClick={() => submitFlow(f.id)}>Submit</Button>
                <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === f.id}
                  onClick={() => cancelFlow(f.id)}>Batalkan</Button>
              </>}
            </RowShell>
          ))}
      </Card>
```

dengan, di dekat `STATUS_TONE`:

```tsx
const FLOW_TONE: Record<string, Tone> = {
  menunggu: "warn", sebagian: "info", selesai: "ok", dibatalkan: "neutral",
};
const FLOW_OPEN = new Set(["menunggu", "sebagian"]);
```

dan di `load()`: `api.getLeadFlows({ projectId: filter === "all" ? undefined : filter, take: 50 })`
ditambahkan ke `Promise.all`, hasilnya `setFlows(f.items ?? [])`. `submitFlow`/`cancelFlow` mengikuti
pola `cancel` yang sudah ada (set `busyId`, panggil api, toast, `load(true)`).

- [ ] **Step 6: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism src/test/lead-screen.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter . typecheck
```
Expected: keluar 0 untuk ketiganya.

- [ ] **Step 8: Commit**

```bash
git add src/src/ds/components/forms.tsx src/src/ds/index.ts src/src/api/client.ts src/src/screens/LeadScreen.tsx src/test/lead-screen.test.tsx
git commit -m "feat(485): dashboard menampilkan radio/checkbox pilihan lead + kartu rantai"
```

---

### Task 9: MCP aditif, docs SoT, smoke end-to-end

**Files:**
- Modify: `shared/src/mcp-catalog.ts`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md`
- Test: `shared/src/mcp-catalog.test.ts`, `shared/src/mcp-schema.test.ts`, `server/test/mcp-capability.test.ts`

**Interfaces:**
- Consumes: `POST /lead/decisions` ber-`select` (Task 5).
- Produces: `hanoman_lead_ask` menerima `multi`, `minChoices`, `maxChoices`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `shared/src/mcp-catalog.test.ts`:

```ts
it("SPEC-485 · lead_ask bisa meminta pilihan jamak, dan defaultnya tetap single", () => {
  const tool = MCP_TOOLS.find((t) => t.name === "hanoman_lead_ask")!;
  expect(Object.keys(tool.inputSchema.properties)).toEqual(
    expect.arrayContaining(["multi", "minChoices", "maxChoices"]));
  expect(tool.build({ project: "p", question: "q" }).body.select).toBeUndefined();
  expect(tool.build({ project: "p", question: "q", options: ["a", "b"], multi: true, minChoices: 1, maxChoices: 2 }).body.select)
    .toEqual({ mode: "multi", min: 1, max: 2 });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest run --no-file-parallelism shared/src/mcp-catalog.test.ts
```
Expected: FAIL — properti `multi` tak ada.

- [ ] **Step 3: Perbarui `hanoman_lead_ask`**

Tambahkan ke `properties`:

```ts
        multi: bool("Opsional. `true` bila opsinya TIDAK saling eksklusif dan lead boleh memilih beberapa sekaligus. Butuh `options`."),
        minChoices: num("Opsional. Paling sedikit berapa opsi harus dipilih (multi saja)."),
        maxChoices: num("Opsional. Paling banyak berapa opsi boleh dipilih (multi saja)."),
```

(pakai helper `bool`/`num` yang sudah ada di berkas; bila belum ada, tambahkan cermin `str`.)

dan ke `build`:

```ts
        ...(a.multi === true
          ? { select: { mode: "multi", min: Number(a.minChoices ?? 0), max: a.maxChoices == null ? null : Number(a.maxChoices) } }
          : {}),
```

Perbarui `description` tool: tambahkan satu kalimat — *"Bila opsinya tidak saling eksklusif, set
`multi: true`; balasannya memuat `choices` (daftar), bukan hanya `choice`."*

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest run --no-file-parallelism shared/src/mcp-catalog.test.ts shared/src/mcp-schema.test.ts shared/src/mcp-shape.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism server/test/mcp-capability.test.ts
```
Expected: PASS. Bila snapshot `MCP_TOOL_SCHEMA_VERSION` menuntut angka baru, naikkan **minor**-nya
(aditif dalam versi) dan perbarui snapshot-nya.

- [ ] **Step 5: Docs SoT**

`internal/docs/architecture/data-model.md` — tambahkan `LeadFlow` ke daftar model LOCAL-only
(mengikuti bentuk entri `LeadDecision` yang ada) dengan kolomnya, dan tambahkan empat kolom baru
`LeadDecision` (`flowId`, `step`, `choices`, `select`) dengan catatan bahwa `choice`/`choiceIndex`
kini turunan `choices[0]` dan baris lama diturunkan balik saat dibaca.

`internal/docs/architecture/api-contract.md` — tambahkan:
`GET /api/lead/flows`, `POST /api/lead/flows/:id/submit`, `POST /api/lead/flows/:id/cancel`;
field baru `select`/`chain`/`flowId` pada `POST /api/lead/decisions` berikut kode 400 & 409;
`choices`/`flowId`/`flowStatus` pada balasannya; `flowId` sebagai filter
`GET /api/lead/decisions`; `choices` pada body override.

`internal/skills/hanoman/SKILL.md` — tambahkan satu butir sesudah butir SPEC-479, ringkas:
SPEC-485/ADR-0102, empat perbedaan widget `multiSelect` yang terukur (label berkotak · digit
men-toggle · tombol `Submit`/`Next` tanpa nomor · panah satu keystroke per pemanggilan), gotcha
`dialogKey` membuang `☐/☒`, jawaban selalu daftar, alur selalu ada & yang tunggal langsung
ditutup, dan penyapu TTL menumpang tick lead.

- [ ] **Step 6: Smoke end-to-end (sekali, di akhir)**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-485
export HANOMAN_HOME="$(mktemp -d)"                    # DB khusus smoke; jangan pakai DB test bersama
cd server && ./node_modules/.bin/prisma migrate deploy && cd ..
pnpm --filter ./server build 2>/dev/null || true
PORT=8791 HANOMAN_HOME="$HANOMAN_HOME" node server/dist/server.js &
```

Lalu (sesudah membuat project ber-`leadOptIn` & menyalakan `lead.enabled` lewat `PUT /api/lead/config`,
dengan `HANOMAN_CLAUDE_BIN` menunjuk `server/test/fixtures/fake-lead-agent.sh` supaya tak memanggil
agen sungguhan):

```bash
# 1 · buka rantai + minta pilihan jamak
curl -sS -X POST localhost:8791/api/lead/decisions -H 'content-type: application/json' \
  -d '{"projectId":"smoke","question":"paket mana?","options":["alpha","beta","gamma"],"select":{"mode":"multi","min":1,"max":2},"chain":true}'
# harapan: 201, `choices` daftar, `flowId` terisi, `flowStatus":"sebagian"`

# 2 · pertanyaan lanjutan pada alur yang sama
curl -sS -X POST localhost:8791/api/lead/decisions -H 'content-type: application/json' \
  -d '{"projectId":"smoke","question":"versi mana?","flowId":"<FLOW>","chain":true}'
# harapan: 201, `flowId` sama

# 3 · submit lalu coba menyisipkan lagi
curl -sS -X POST localhost:8791/api/lead/flows/<FLOW>/submit -d '{}' -H 'content-type: application/json'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST localhost:8791/api/lead/decisions \
  -H 'content-type: application/json' -d '{"projectId":"smoke","question":"telat","flowId":"<FLOW>"}'
# harapan: 409

# 4 · bentuk select yang mustahil
curl -sS -o /dev/null -w '%{http_code}\n' -X POST localhost:8791/api/lead/decisions \
  -H 'content-type: application/json' -d '{"projectId":"smoke","question":"q","select":{"mode":"multi","min":1,"max":2}}'
# harapan: 400

# 5 · rantai terbaca ulang
curl -sS "localhost:8791/api/lead/decisions?flowId=<FLOW>" | head -c 400
curl -sS "localhost:8791/api/lead/flows?projectId=smoke" | head -c 400
```

Matikan server per-PID (`lsof -ti:8791 | xargs kill`), **jangan** `pkill -f node` (SPEC-402).

- [ ] **Step 7: Verifikasi akhir & commit**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/lead-flow.test.ts server/test/lead-flow-schema.test.ts server/test/lead-decide.test.ts \
  server/test/lead-routes.test.ts server/test/lead-engine.test.ts server/test/lead-detect.test.ts \
  server/test/lead-trail-choice.test.ts server/test/lead-prompt.test.ts server/test/tui-dialog.test.ts \
  server/test/lead-pane.test.ts server/test/pty.test.ts server/test/mcp-capability.test.ts \
  server/test/webhook-catalog-dmmf.test.ts
./node_modules/.bin/vitest run --no-file-parallelism shared/src/lead.test.ts shared/src/mcp-catalog.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest run --no-file-parallelism src/test/lead-screen.test.tsx
```
Expected: semuanya PASS, dan tak ada berkas yang melaporkan "no test files" (jebakan
`passWithNoTests`).

```bash
git add shared/src/mcp-catalog.ts shared/src/mcp-catalog.test.ts internal/docs internal/skills
git commit -m "docs(485): kontrak API, data model, skill + lead_ask MCP menerima pilihan jamak"
git push origin HEAD:refs/heads/hanoman/spec-485
```

---

## Self-review

**Cakupan spec:** outcome 1 (multi-select) → Task 1/4/5/7/8; outcome 2 (rantai dalam satu sesi
sampai submit) → Task 2/3/4/5; outcome 3 (riwayat satu rantai terbaca ulang) → Task 3/5/8;
outcome 4 (status alur jelas) → Task 2/3/8. Batasan: kompatibel mundur → Task 1 (verdict lama) +
Task 4 (`toDecisionView` menurunkan) + Task 8 (`?? []`); jawaban selalu daftar → Task 2/4; tak
menggantung → Task 3/6; hanya alur aktif → Task 3/4/5; validasi server → Task 4/5; pola UI dashboard
→ Task 8.

**Placeholder:** nihil — setiap langkah memuat kode atau perintah nyata.

**Konsistensi tipe:** `resolveChoices` (Task 1) dipakai Task 4/5/7 dengan tanda tangan yang sama;
`LeadDelivery.choices` (Task 1) dibaca Task 7 `detect.ts`; `closeFlow(id, reason)` (Task 3) dipakai
Task 4/5/6; `PaneIO.down` ditambahkan di Task 7 dan diimplementasikan `dialogIO` di langkah yang
sama; `LeadFlowView` (Task 1) dipakai Task 3 `toFlowView`, Task 5 route, Task 8 client.
