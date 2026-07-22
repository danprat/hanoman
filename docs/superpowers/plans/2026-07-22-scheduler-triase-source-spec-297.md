# SPEC-297 — Source-checker Triase (pick) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah scheduler source-checker `triase` yang, per `Ticket` eligible (status `new`, kategori `bug`/`fitur`, project opt-in, belum ber-specId), memanggil jalur accept lalu meng-enqueue peluncuran sesinya — dibatasi hanya oleh cap governor; kategori `pertanyaan`/`lainnya` tak pernah auto-accept.

**Architecture:** Ekstrak inti accept dari `routes/tickets.ts` ke `services/ticket-accept.ts` (route mendelegasikan; kontrak HTTP tak berubah) agar checker memakai ulang **jalur yang sama** (pemetaan kategori→source SPEC-291 + direktif lampiran SPEC-286 ikut pindah). Checker baru `services/scheduler/sources/triase.ts` menyaring tiket di query (idempotensi gratis), accept tiap tiket, lalu `enqueue({ source:"triase", priority:"sedang" })`. Registrasi di `server.ts` sebelum `startScheduler()`.

**Tech Stack:** Node + TypeScript (strict), Fastify, Prisma (Postgres), Vitest. Fondasi scheduler SPEC-294/ADR-0072 (registry/queue/governor/engine/config); config knob `sources.triase` **sudah ada** sejak fondasi.

## Global Constraints

- TypeScript strict; ikuti pola file scheduler yang ada (`sources/errors.ts`, `sources/backlog.ts`, `queue.ts`) dan preseden ekstraksi `services/error-escalate.ts`.
- **Tanpa** perubahan skema, migration, ADR baru, atau endpoint baru — murni aditif pada kontrak fondasi + refactor internal. Config knob `triase` sudah ada di `zScheduler` (SPEC-294).
- `SchedulerQueueItem.source` = **asal checker** (`"triase"`), bukan `spec.source`.
- Enqueue **idempoten** via `specId @unique` (upsert `update:{}`); checker tak dedup manual.
- Definisi "eligible triase" = `status:"new"` ∧ `category ∈ {bug,fitur}` ∧ `project.schedulerOptIn` ∧ `specId=null`. Kategori `pertanyaan`/`lainnya` **tak pernah** ter-query (tetap manual, PRD Non-goal).
- Prioritas Spec scheduler-triase = `"sedang"` (mencerminkan default body `POST /tickets/:id/accept`).
- Pemetaan kategori→source (SPEC-291) tak berubah: bug→`qa`, fitur→`brief`, pertanyaan→`audit`, lainnya→`brief`.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** (konvensi SoT).
- Test WAJIB `cd server && npx vitest run --no-file-parallelism` (race DB tanpa flag). Shell env bisa menunjuk prod → override `DATABASE_URL` per perintah; DB base khusus `hanoman297` → vitest.config derive `hanoman297_test`. Buat + `migrate deploy` `hanoman297_test` sebelum test pertama.
- Commit message diakhiri `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 0: Siapkan DB test terisolasi

Cegah truncation oleh sesi sibling: pakai base `hanoman297` (→ `hanoman297_test`).

**Files:** (tak ada perubahan kode)

- [ ] **Step 1: Buat + migrate `hanoman297_test`**

Run:
```bash
docker exec hanoman-db-1 psql -U hanoman -d postgres -c "CREATE DATABASE hanoman297_test;" 2>/dev/null; \
cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297_test' npx prisma migrate deploy
```
Expected: "All migrations have been applied" (atau "No pending migrations" bila sudah ada).

- [ ] **Step 2: Sanity — prisma client ter-generate untuk worktree ini**

Run: `cd server && npx prisma generate`
Expected: "Generated Prisma Client".

---

### Task 1: Ekstrak jalur accept → `services/ticket-accept.ts`

Refactor murni: pindahkan inti accept (+ helper `attachmentInstruction` SPEC-286 + peta `SOURCE_BY_CATEGORY` SPEC-291) ke fungsi service; route mendelegasikan. Perilaku HTTP dijaga oleh test regresi yang sudah ada (`tickets.test.ts`).

**Files:**
- Create: `server/src/services/ticket-accept.ts`
- Modify: `server/src/routes/tickets.ts` (hapus helper `attachmentInstruction` baris 15-29 + peta `SOURCE_BY_CATEGORY` baris 31-36; ganti handler accept baris 95-143; rapikan import baris 4-13)
- Test (regresi, sudah ada): `server/test/tickets.test.ts`
- Docs: `internal/docs/architecture/api-contract.md` (§Help Center/accept)

**Interfaces:**
- Produces: `acceptTicket(t: Ticket & { attachments: TicketAttachment[] }, opts: { author: string; priority: string }): Promise<{ spec: Spec; created: boolean }>` — `created:false` bila `t.specId` sudah ada (idempoten), else buat Spec (source per kategori) + link + `notifySynced` ×2.

- [ ] **Step 1: Jalankan test regresi untuk memastikan HIJAU sebelum refactor**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297' npx vitest run test/tickets.test.ts --no-file-parallelism`
Expected: PASS (semua describe triase/accept/unlink/reject/patch/delete hijau)

- [ ] **Step 2: Buat `server/src/services/ticket-accept.ts`**

```ts
import { join } from "node:path";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";
import { uploadDir } from "./uploads";
import type { Spec, Ticket, TicketAttachment } from "@prisma/client";

// SPEC-286 · saat accept tiket → backlog, ubah lampiran dari catatan pasif jadi DIREKTIF aktif: agen
// wajib memeriksa isinya (biasanya screenshot bug) sebelum bekerja, dengan nama asli + jalur konkret.
// Dipindah dari routes/tickets.ts agar dipakai ulang scheduler source-checker triase (JALUR sama).
const attachmentInstruction = (t: Ticket, atts: TicketAttachment[]): string => {
  if (atts.length === 0) return "Tanpa lampiran.";
  const list = atts
    .map((a) => `- ${a.filename} (${a.mimeType}) → ${join(uploadDir(), a.storageKey)}`)
    .join("\n");
  return `LAMPIRAN (${atts.length}) dari pelapor — biasanya screenshot yang menunjukkan masalah. `
    + `PERIKSA setiap lampiran untuk memahami konteks keluhan sebelum bekerja; jangan berasumsi `
    + `dari teks saja. Berkas ada di direktori upload server (baca langsung dengan tool Read):\n${list}\n`
    + `Bila berkas tak ada di path itu (sesi jalan di mesin lain), buka lampiran lewat triase `
    + `tiket #${t.number} atau API GET /api/tickets/${t.id}/attachments/<id>.`;
};

// SPEC-291 · kategori tiket → source Spec (menentukan flow via flowForSource & tampilan backlog via
// SOURCE_META). bug=finding QA, fitur=feature brief, pertanyaan=audit-only. Kategori tak dikenal
// (mis. `lainnya`) jatuh ke `brief` (feature brief) sebagai default.
const SOURCE_BY_CATEGORY: Record<string, "qa" | "brief" | "audit"> = {
  bug: "qa", fitur: "brief", pertanyaan: "audit", lainnya: "brief",
};

// SPEC-297 · inti accept tiket → Spec, dipisah dari routes/tickets.ts agar dipakai ulang oleh scheduler
// source-checker triase (JALUR yang sama, bukan duplikat). Kontrak HTTP route tak berubah. Idempoten
// via ticket.specId (tiket sudah tertaut → kembalikan Spec tanpa membuat kedua).
export async function acceptTicket(
  t: Ticket & { attachments: TicketAttachment[] }, opts: { author: string; priority: string },
): Promise<{ spec: Spec; created: boolean }> {
  if (t.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: t.specId } });
    return { spec: spec!, created: false };
  }
  const backlink = `Dari tiket Help Center #${t.number} (projek ${t.projectId}).`;
  // SPEC-291 · eskalasi mengikuti kategori keluhan, bukan selalu feature.
  const source = SOURCE_BY_CATEGORY[t.category] ?? "brief";
  const detail = `${t.detail}\n\nKategori: ${t.category}\nPelapor: ${t.reporterEmail}\n${backlink}\n\n`
    + attachmentInstruction(t, t.attachments);
  // Bentuk payload harus cocok dengan source (dto superRefine: qa ⇒ QaPayload). Untuk qa keluhan
  // pelapor + direktif lampiran masuk ke `actual`; selebihnya ke `context` brief.
  const payload = source === "qa"
    ? { severity: "major" as const, steps: "Reproduksi dari keluhan pelapor & lampiran.",
        expected: "Perilaku yang diharapkan pelapor.", actual: detail, env: "" }
    : { context: detail, outcome: "", constraints: "" };
  const repoDir = await resolveRepoDir(t.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs & error-escalate.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: t.projectId, title: t.title, source,
          stage: "brainstorming", priority: opts.priority, author: `Help · ${opts.author}`,
          objective: `${t.category}: ${t.title}. ${backlink}`, payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.ticket.update({ where: { id: t.id }, data: { status: "accepted", specId: spec!.id } });
  await notifySynced("spec", spec!.id);  // SPEC-213/268 · spec ke feed
  await notifySynced("ticket", t.id);     // SPEC-268 · status tiket ke feed
  return { spec: spec!, created: true };
}
```

- [ ] **Step 3: Ganti handler accept di `server/src/routes/tickets.ts` agar mendelegasikan**

Ganti seluruh blok `app.post("/tickets/:id/accept", …)` (baris 95–143, sampai sebelum handler `unlink`) dengan:

```ts
  // SPEC-253/291/297 · ADR-0062 · Terima → Spec (inti di services/ticket-accept.ts, dipakai ulang
  // scheduler source-checker triase). Idempoten via ticket.specId (cermin escalate errors).
  app.post("/tickets/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const priority = (req.body as { priority?: string } | undefined)?.priority ?? "sedang";
    const { spec, created } = await acceptTicket(t, { author: req.user?.email ?? "system", priority });
    return created
      ? reply.code(201).send({ spec })
      : reply.code(200).send({ alreadyPromoted: true, spec });
  });
```

- [ ] **Step 4: Hapus helper lama + rapikan import `server/src/routes/tickets.ts`**

Hapus blok helper `attachmentInstruction` (komentar SPEC-286 + fungsi, baris 15-29) dan peta `SOURCE_BY_CATEGORY` (komentar SPEC-291 + const, baris 31-36) — kini di service.

Rapikan import (kini tak terpakai di route setelah pindah): hapus `join`, `nextSpecId`, `resolveRepoDir`, `uploadDir`, type `TicketAttachment`. Tambah import service.

Hapus baris:
```ts
import { join } from "node:path";
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
```
Ubah baris uploads (buang `uploadDir`, sisakan yang masih dipakai handler attachments/delete):
```ts
import { readUploadOrFetch, deleteUpload } from "../services/uploads";
```
Ubah import tipe (buang `TicketAttachment`, sisakan `Ticket` yang dipakai `view`):
```ts
import type { Ticket } from "@prisma/client";
```
Tambah (dekat import service lain):
```ts
import { acceptTicket } from "../services/ticket-accept";
```

- [ ] **Step 5: Jalankan test regresi + typecheck**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297' npx vitest run test/tickets.test.ts --no-file-parallelism && npx tsc -p . --noEmit`
Expected: PASS (perilaku accept 201/200 `alreadyPromoted`/404 + payload per kategori tak berubah) + tsc exit 0

- [ ] **Step 6: Catat di `internal/docs/architecture/api-contract.md`**

Di §Help Center, di baris `POST /tickets/:id/accept`, tambahkan satu kalimat: inti accept kini di `services/ticket-accept.ts` (`acceptTicket`), dipakai route **dan** scheduler source-checker triase; kontrak HTTP (201/200 `alreadyPromoted`/404) tak berubah.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/ticket-accept.ts server/src/routes/tickets.ts internal/docs/architecture/api-contract.md
git commit -m "refactor(spec-297): ekstrak accept tiket ke services/ticket-accept.ts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Source-checker `checkTriase`

Checker baru: query tiket eligible → accept (jalur Task 1) → enqueue. TDD.

**Files:**
- Create: `server/src/services/scheduler/sources/triase.ts`
- Create (test): `server/test/scheduler-source-triase.test.ts`

**Interfaces:**
- Consumes: `acceptTicket` (Task 1); `enqueue` (`queue.ts`); `registerSchedulerSource` (`registry.ts`).
- Produces: `checkTriase(): Promise<void>`; `registerTriaseSource(): void`.

- [ ] **Step 1: Tulis test yang gagal `server/test/scheduler-source-triase.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { checkTriase, registerTriaseSource } from "../src/services/scheduler/sources/triase";
import { listQueue } from "../src/services/scheduler/queue";
import { listSources, clearSources } from "../src/services/scheduler/registry";

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const mkProject = (id: string, schedulerOptIn: boolean) =>
  prisma.project.create({ data: { id, name: id, desc: "", kind: "existing", schedulerOptIn } });
let n = 0;
const mkTicket = (over: { projectId: string; category?: string; status?: string; specId?: string | null }) =>
  prisma.ticket.create({ data: {
    projectId: over.projectId, number: ++n, category: over.category ?? "bug",
    title: "keluhan", detail: "detail keluhan", reporterEmail: "r@e.co",
    status: over.status ?? "new", accessKeyHash: `k-${n}`, specId: over.specId ?? null,
  } });

describe("triase source-checker", () => {
  it("accepts + enqueues only eligible tickets (new, bug/fitur, opt-in)", async () => {
    await mkProject("opt", true);
    const t = await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    const q = await listQueue();
    expect(q.length).toBe(1);
    expect(q[0]!.source).toBe("triase");
    expect(q[0]!.priority).toBe("sedang");
    expect(q[0]!.status).toBe("queued");
    const after = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(after!.status).toBe("accepted");
    expect(after!.specId).toBe(q[0]!.specId);
  });

  it("maps category→source (SPEC-291): bug→qa, fitur→brief", async () => {
    await mkProject("opt", true);
    const bug = await mkTicket({ projectId: "opt", category: "bug" });
    const fitur = await mkTicket({ projectId: "opt", category: "fitur" });
    await checkTriase();
    const sBug = await prisma.spec.findUnique({ where: { id: (await prisma.ticket.findUnique({ where: { id: bug.id } }))!.specId! } });
    const sFitur = await prisma.spec.findUnique({ where: { id: (await prisma.ticket.findUnique({ where: { id: fitur.id } }))!.specId! } });
    expect(sBug!.source).toBe("qa");
    expect(sFitur!.source).toBe("brief");
  });

  it("never auto-accepts pertanyaan/lainnya categories", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "pertanyaan" });
    await mkTicket({ projectId: "opt", category: "lainnya" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
    expect(await prisma.spec.count()).toBe(0);
    expect(await prisma.ticket.count({ where: { status: "new" } })).toBe(2);
  });

  it("skips tickets from non-opt-in projects", async () => {
    await mkProject("noopt", false);
    await mkTicket({ projectId: "noopt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("is idempotent: accepted/rejected/linked tickets are not re-accepted", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug", status: "accepted", specId: "SPEC-EXIST" });
    await mkTicket({ projectId: "opt", category: "bug", status: "rejected" });
    await mkTicket({ projectId: "opt", category: "bug", status: "new", specId: "SPEC-LINK" });
    await checkTriase();
    expect((await listQueue()).length).toBe(0);
  });

  it("processes many eligible tickets in one window (no per-checker cap)", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await mkTicket({ projectId: "opt", category: "fitur" });
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    expect((await listQueue()).length).toBe(3);
    expect(await prisma.ticket.count({ where: { status: "accepted" } })).toBe(3);
  });

  it("double check → one queue row per spec, tickets accepted once", async () => {
    await mkProject("opt", true);
    await mkTicket({ projectId: "opt", category: "bug" });
    await checkTriase();
    await checkTriase();
    expect((await listQueue()).length).toBe(1);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("registerTriaseSource registers a source with id 'triase'", () => {
    registerTriaseSource();
    expect(listSources().map((s) => s.id)).toContain("triase");
  });
});
```

- [ ] **Step 2: Jalankan test → pastikan GAGAL (modul belum ada)**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297' npx vitest run test/scheduler-source-triase.test.ts --no-file-parallelism`
Expected: FAIL — `Cannot find module '.../sources/triase'`

- [ ] **Step 3: Buat `server/src/services/scheduler/sources/triase.ts`**

```ts
import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";
import { acceptTicket } from "../../ticket-accept";

// SPEC-297 · daun #3 scheduler otonom (di atas fondasi SPEC-294/ADR-0072, cermin SPEC-296).
// Checker "triase": tiap Ticket eligible (status new, kategori bug/fitur, project opt-in, belum
// ber-specId) → accept (jalur bersama services/ticket-accept.ts, pemetaan kategori→source SPEC-291)
// → enqueue peluncuran. Idempotensi gratis: filter query menyaring tiket accepted/rejected/ber-specId;
// enqueue upsert specId @unique. Kategori pertanyaan/lainnya tak pernah ter-query → tak pernah
// auto-accept (tetap manual). "Banyak tiket satu window" — checker tak punya limit; cap = governor.
// PRD §Source — Triase + User Story #3.
export async function checkTriase(): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: "new",                       // accepted/rejected tersaring di query
      category: { in: ["bug", "fitur"] },  // pertanyaan/lainnya tak pernah auto-accept
      specId: null,                        // tiket ber-specId tersaring di query
      project: { schedulerOptIn: true },   // non-opt-in tak pernah ter-query
    },
    include: { attachments: true },
  });
  for (const t of tickets) {
    try {
      // Jalur accept yang sama dengan route: Spec (source per kategori) + tautan dua arah tiket.
      const { spec } = await acceptTicket(t, { author: "scheduler", priority: "sedang" });
      await enqueue({ specId: spec.id, projectId: spec.projectId, source: "triase", priority: spec.priority });
    } catch { /* satu tiket gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }
  }
}

export function registerTriaseSource(): void {
  registerSchedulerSource({ id: "triase", check: checkTriase });
}
```

- [ ] **Step 4: Jalankan test → pastikan HIJAU**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297' npx vitest run test/scheduler-source-triase.test.ts --no-file-parallelism`
Expected: PASS (8 test)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/scheduler/sources/triase.ts server/test/scheduler-source-triase.test.ts
git commit -m "feat(spec-297): triase source-checker accept+enqueue tiket bug/fitur eligible

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Registrasi boot + docs arsitektur

Daftarkan checker di `server.ts` (sebelum `startScheduler`), perbarui docs SoT yang tersentuh.

**Files:**
- Modify: `server/src/server.ts` (import dekat baris 6; panggilan setelah `registerErrorsSource()` baris 37)
- Docs: `internal/docs/architecture/stack.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: `registerTriaseSource` (Task 2).

- [ ] **Step 1: Wire registrasi di `server/src/server.ts`**

Tambah import (dekat baris 6, setelah import errors source):
```ts
import { registerTriaseSource } from "./services/scheduler/sources/triase";
```
Tambah panggilan tepat setelah `registerErrorsSource();`:
```ts
  registerTriaseSource(); // SPEC-297 · daftarkan checker triase sebelum engine tick pertama
```

- [ ] **Step 2: Typecheck server**

Run: `cd server && npx tsc -p . --noEmit`
Expected: exit 0

- [ ] **Step 3: Perbarui `internal/docs/architecture/stack.md`**

Di baris pipeline scheduler (yang menyebut "checker konkret: backlog SPEC-295, errors SPEC-296"), tambahkan checker `triase` konkret (SPEC-297): tiket bug/fitur eligible → accept → antrean, satu tiket = satu backlog.

- [ ] **Step 4: Perbarui `internal/docs/architecture/data-model.md`**

Di §`SchedulerQueueItem` (deskripsi kolom `source`), catat nilai `triase` kini diisi checker konkret (SPEC-297), sejajar `backlog`/`errors`.

- [ ] **Step 5: Perbarui `internal/docs/architecture/api-contract.md` §Scheduler**

Tambah paragraf "Source-checker konkret ketiga (SPEC-297): `triase`" — saat cadence triase jatuh-tempo, untuk tiap `Ticket` eligible (`status:"new"` ∧ `category ∈ {bug,fitur}` ∧ `specId=null` ∧ project `schedulerOptIn`) memakai ulang `acceptTicket` (`services/ticket-accept.ts`, pemetaan kategori→source SPEC-291) → Spec, lalu enqueue (queue item `source:"triase"`, priority `sedang`). Idempoten (tiket accepted/rejected/ber-specId tersaring di query); `pertanyaan`/`lainnya` tak pernah auto-accept. Terdaftar di `server.ts` (`registerTriaseSource()`) sebelum `startScheduler()`.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts internal/docs/architecture/stack.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "feat(spec-297): register triase source at boot + docs arsitektur

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verifikasi penuh — full suite + live curl smoke

**Files:** (tak ada perubahan kode; hanya verifikasi)

- [ ] **Step 1: Full server suite + shared + tsc**

Run: `cd server && env DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5432/hanoman297' npx vitest run --no-file-parallelism`
Expected: PASS (semua, termasuk `tickets.test.ts` regresi + `scheduler-source-triase.test.ts` baru)
Run: `cd shared && npx vitest run` + `cd server && npx tsc -p . --noEmit`
Expected: PASS + exit 0

- [ ] **Step 2: Build server + boot ke DB throwaway ter-migrate, seed via SQL**

Build: `cd server && npm run build` (esbuild → `dist/server.js`; **jangan** `tsc -p .` tanpa `--noEmit` — mengotori src/test dgn .js/.d.ts).
Buat DB smoke `hanoman297_smoke`, `prisma migrate deploy`. Seed via `docker exec -i hanoman-db-1 psql` (INGAT: `"updatedAt"=now()` untuk kolom `@updatedAt`; `accessKeyHash` unik per tiket):
- project A `schedulerOptIn=true`: tiket eligible (`status='new'`, `category='bug'`), (`status='new'`, `category='fitur'`); tiket non-eligible (`category='pertanyaan'`), (`category='lainnya'`), (`category='bug'`,`status='accepted'`).
- project B `schedulerOptIn=false`: tiket `status='new'`, `category='bug'`.
Boot `node dist/server.js` di PORT≠8787 dengan `DATABASE_URL` → `hanoman297_smoke` (+ `HANOMAN_UPLOAD_DIR` throwaway).

- [ ] **Step 3: Nyalakan scheduler (Pause) + trigger tick, verifikasi state**

- Login/cookie sesuai pola smoke (atau boot `buildApp({ requireAuth:false })` skrip; ikuti cara smoke SPEC-296).
- `PUT /api/scheduler/config` body `{ enabled:true, paused:true, sources:{ triase:{ enabled:true } } }` (Pause ⇒ enqueue teruji tanpa launch nyata; merge dengan default lewat `setScheduler` — kirim blok penuh hasil GET lalu ubah field).
- Tunggu boot-pass tick (atau restart) menjalankan `checkTriase`.
- `GET /api/scheduler/state` → `queue` berisi **2** item (tiket bug & fitur eligible project A), `source:"triase"`, `priority:"sedang"`. Tiket `pertanyaan`/`lainnya`/`accepted` & project B **absen**.
- `GET /api/tickets?project=A` → tiket eligible kini `status:"accepted"` + `specId`; tiket `pertanyaan`/`lainnya` tetap `status:"new"`. `GET /api/tickets/<specId-bug>`… cek Spec bug `source:"qa"`, fitur `source:"brief"` via `GET /api/specs`.

Expected: seleksi & idempotensi cocok dengan design; tak ada item dari project non-opt-in / kategori non-actionable / tiket accepted.

- [ ] **Step 4: Bersihkan DB smoke + tandai plan**

Drop `hanoman297_smoke`; hapus `dist` build sementara bila perlu; pastikan `git status` bersih (tak ada artefak .js/.d.ts di src/test). Centang semua `- [ ]` → `- [x]` di plan ini. Tulis `Execute done` ke `$HANOMAN_PHASE_FILE`.

---

## Self-Review

**Spec coverage** (design → task):
- Accept reuse (jalur sama, pemetaan kategori→source SPEC-291) → Task 1 (ekstraksi) + Task 2 (dipakai checker). ✓
- Hanya bug/fitur dari project opt-in → Task 2 Step 1 test ("eligible" + "non-opt-in") + Step 3 query `category:{in:[bug,fitur]}` ∧ `project.schedulerOptIn`. ✓
- pertanyaan/lainnya tak pernah auto-accept → Task 2 test "never auto-accepts pertanyaan/lainnya" + query filter. ✓
- Idempoten (accepted/rejected/ber-specId dilewati) → Task 2 test "idempotent" + query `status:"new"`∧`specId:null`. ✓
- Banyak tiket satu window, dibatasi hanya cap → Task 2 test "processes many" (checker tanpa limit; cap = governor, di luar leaf). ✓
- Registrasi boot → Task 3. ✓
- Unit test + curl di local → Task 2 (+ regresi Task 1) + Task 4. ✓
- Docs tersentuh commit sama → Task 1 Step 6, Task 3 Steps 3-5. ✓
- DB terisolasi (anti sibling-truncate) → Task 0. ✓

**Placeholder scan:** tak ada TBD/TODO; tiap step berisi kode/perintah nyata. ✓

**Type consistency:** `acceptTicket(t & {attachments}, { author, priority }) → { spec, created }` konsisten Task 1↔2; `enqueue({ specId, projectId, source, priority })` cocok `queue.ts`; `checkTriase`/`registerTriaseSource` konsisten Task 2↔3. ✓
