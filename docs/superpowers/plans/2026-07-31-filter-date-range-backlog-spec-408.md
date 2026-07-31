# Filter date range di backlog (SPEC-408) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog bisa disaring rentang tanggal — "Dibuat" atau "Dikerjakan" — dari tanggal A sampai tanggal B, inklusif.

**Architecture:** `Spec` mendapat dua kolom baru (`createdAt` NOT NULL ber-default, `startedAt` nullable) lewat satu migration aditif; `startedAt` ditulis di titik cekik yang sama dengan `baseSha` (`session-launch.ts`) sehingga jalur *resume* ADR-0084 tak menimpanya. Penyaringan dilakukan di **layer response** (`filterSpecs` di `routes/specs.ts`, setelah overlay stage-live — ADR-0038 utuh) memakai helper murni `services/date-range.ts`. UI menambah tiga kontrol view-local di baris penyaring `BacklogScreen`.

**Tech Stack:** Prisma 6 + SQLite · Fastify · zod (`@hanoman/shared`) · React 18 + TS (Vite) · vitest (+ @testing-library/react untuk web).

## Global Constraints

- **Design doc / spec sumber:** `docs/superpowers/specs/2026-07-31-spec-408-filter-date-range-backlog-design.md`. Semua keputusan di sana mengikat.
- **Nomor ADR: 0090.** Sudah dienumerasi lintas semua branch + `git worktree list` (maks saat ini 0089). **Verifikasi ulang tepat sebelum push.**
- **Bahasa komentar & docs: Indonesia**, mengikuti seluruh repo. Kode/identifier tetap Inggris.
- **`from`/`to` inklusif**, format `YYYY-MM-DD`, di-parse **di zona waktu lokal server** (`from` → 00:00:00.000, `to` → 23:59:59.999). String yang tak cocok pola **diabaikan** (bukan 400).
- **`dateField`** ∈ `created` | `started`; nilai lain diperlakukan `created`. `dateField=started` + rentang aktif → item ber-`startedAt = null` tersaring keluar.
- **Tanpa index DB baru** — filter dieksekusi di memori setelah overlay (ADR-0038).
- **Scope verifikasi = `changed`** (ADR-0080): hanya test yang berkaitan berkas yang berubah, typecheck **per paket**, boot-server+curl **sekali di akhir**.
- **Isolasi DB test wajib.** Worktree ini tak punya `.env`, jadi `server/vitest.config.ts` menurunkan DB test ke `~/.hanoman/hanoman.test.db` — **berkas yang sama dipakai worktree tetangga**, dan `global-setup.ts` menghapusnya di awal tiap run. Setiap perintah vitest untuk paket `server` di plan ini **wajib** diawali `TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db`.
- **`pnpm vitest` gagal lewat proxy rtk** — pakai `./node_modules/.bin/vitest` (pelajaran SPEC-407).
- **Jangan `pkill -f`/`killall`** (AGENTS.md §6). Bunuh per-PID.

---

## File Structure

**Dibuat:**
- `server/prisma/migrations/20260731000000_spec_created_started_at/migration.sql` — migration aditif + backfill.
- `server/src/services/date-range.ts` — helper murni parse/uji rentang tanggal (nol dependensi).
- `server/test/date-range.test.ts` — unit test helper (termasuk jebakan zona waktu).
- `internal/docs/adr/0090-stempel-waktu-backlog-created-started.md` — ADR.
- `src/test/backlog-date-filter.test.tsx` — test UI filter tanggal.

**Diubah:**
- `server/prisma/schema.prisma:51-67` — dua kolom di model `Spec`.
- `server/src/services/session-launch.ts:144` — tulis `startedAt` bersama `baseSha` (hanya jalur fresh).
- `server/src/services/sync.ts:31,44` — `createdAt`/`startedAt` masuk `FIELDS.spec` + `DATE_FIELDS.spec`.
- `server/src/routes/specs.ts:56-78` — `filterSpecs` + query `GET /specs`.
- `shared/src/entities.ts:37-44` — `zSpec` + dua field.
- `src/src/api/client.ts:96-99` — `SpecListParams` + tiga param.
- `src/src/screens/BacklogScreen.tsx:607-685` — state + tiga kontrol + reset.
- `server/test/specs.route.test.ts` — test filter tanggal end-to-end route.
- `server/test/session-launch.test.ts` — `startedAt` ditulis saat sesi pertama lahir.
- `server/test/session-resume.test.ts` — `startedAt` tak ditimpa saat resume.
- `server/test/sync.service.test.ts` — dua kolom menyeberang push/pull.
- `internal/docs/architecture/data-model.md` · `api-contract.md` · `README.md` · `adr/README.md` · `internal/skills/hanoman/SKILL.md` — docs SoT.

---

## Task 0: Siapkan worktree (prasyarat, bukan deliverable)

Worktree ini belum punya `node_modules` — tanpa langkah ini `@prisma/client` tak resolve dan setiap test gagal dengan error yang menyesatkan.

- [ ] **Step 1: Install dependency**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-408
pnpm install
```

Expected: selesai exit 0; `node_modules/` dan `server/node_modules/` ada.

- [ ] **Step 2: Generate Prisma client (skema saat ini)**

```bash
pnpm --filter ./server exec prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 3: Buktikan baseline hijau sebelum menyentuh apa pun**

```bash
mkdir -p .tmp
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts
```

Expected: PASS (semua test spesc route hijau). Kalau merah **sekarang**, itu bukan ulah plan ini — perbaiki/laporkan dulu.

---

## Task 1: Kolom `createdAt` & `startedAt` di `Spec`

**Files:**
- Modify: `server/prisma/schema.prisma:51-67`
- Create: `server/prisma/migrations/20260731000000_spec_created_started_at/migration.sql`
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Produces: kolom `Spec.createdAt: DateTime` (NOT NULL, default now) dan `Spec.startedAt: DateTime?`. Dipakai Task 2 (tulis), Task 3 (sync), Task 5 (filter), Task 6 (DTO).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/specs.route.test.ts`, di dalam `describe("specs routes", …)`:

```ts
  // SPEC-408 · ADR-0090 · stempel waktu backlog. `createdAt` diisi DB saat baris lahir;
  // `startedAt` null sampai sesi pertama benar-benar lahir (Task 2).
  it("spec baru punya createdAt terisi dan startedAt null (SPEC-408)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/specs",
      payload: { project: "p1", source: "brief", title: "stempel waktu", priority: "sedang", payload: brief },
    });
    expect(res.statusCode).toBe(201);
    const row = await prisma.spec.findUnique({ where: { id: res.json().id } });
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(row!.startedAt).toBeNull();
  });
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts -t "stempel waktu"
```

Expected: FAIL — TypeScript/Prisma tak mengenal `createdAt`/`startedAt` di `Spec` (`Property 'createdAt' does not exist`).

- [ ] **Step 3: Tambah kolom di schema**

Di `server/prisma/schema.prisma`, model `Spec`, sisipkan tepat sebelum baris `updatedAt`:

```prisma
  // SPEC-408 · ADR-0090 · kapan item difilekan. Ditulis DB (@default), tak pernah oleh route —
  // "dibuat" harus jadi fakta yang tak bisa diedit operator.
  createdAt  DateTime @default(now())
  // SPEC-408 · ADR-0090 · kapan sesi PERTAMA lahir untuk item ini. Ditulis di titik cekik yang
  // sama dengan `baseSha` (services/session-launch.ts); jalur RESUME (ADR-0084) sengaja tidak
  // menimpanya — melanjutkan sesi bukan "mulai lagi". null = belum pernah dikerjakan.
  startedAt  DateTime?
```

- [ ] **Step 4: Tulis migration tangan (SQLite melarang ADD COLUMN ber-default non-konstan)**

Buat `server/prisma/migrations/20260731000000_spec_created_started_at/migration.sql`:

```sql
-- SPEC-408 · ADR-0090 · stempel waktu backlog: `Spec.createdAt` + `Spec.startedAt`.
--
-- SQLite melarang `ALTER TABLE … ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (default non-konstan),
-- jadi kolom ber-default waktu HARUS lewat redefinisi tabel. Redefinisi itu sekaligus tempat
-- backfill baris lama: `updatedAt` adalah satu-satunya jejak waktu yang pernah ada, dan `baseSha`
-- adalah penanda "pernah dikerjakan" yang sudah dipakai sistem (scheduler sources/backlog.ts).
-- Backfill ini APROKSIMASI dan dinyatakan terbuka di ADR-0090 — mengisinya dengan waktu migration
-- dijalankan akan membuat seluruh backlog lama tampak dibuat hari ini, yang lebih menyesatkan.
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

CREATE TABLE "new_Spec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "payload" JSONB,
    "branchFrom" TEXT,
    "baseSha" TEXT,
    "headSha" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Spec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Spec" ("id","projectId","title","source","stage","priority","author","objective","payload","branchFrom","baseSha","headSha","version","createdAt","startedAt","updatedAt")
SELECT "id","projectId","title","source","stage","priority","author","objective","payload","branchFrom","baseSha","headSha","version",
       "updatedAt",
       CASE WHEN "baseSha" IS NOT NULL THEN "updatedAt" ELSE NULL END,
       "updatedAt"
FROM "Spec";

DROP TABLE "Spec";
ALTER TABLE "new_Spec" RENAME TO "Spec";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

- [ ] **Step 5: Regenerate client**

```bash
pnpm --filter ./server exec prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 6: Jalankan test — harus lulus**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts
```

Expected: PASS, termasuk test baru. (`global-setup.ts` menerapkan kedua migration ke berkas DB test dari nol — kalau migration SQL-nya salah sintaks, run ini gagal keras di setup, bukan diam-diam.)

- [ ] **Step 7: Terapkan migration ke DB dev bersama (aditif, aman untuk sesi tetangga)**

```bash
pnpm --filter ./server exec prisma migrate deploy
```

Expected: `1 migration found` → `Applied migration(s)`. Aditif: Prisma menulis daftar kolom eksplisit di setiap query, jadi server sesi tetangga yang masih memakai client lama tak terganggu.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/test/specs.route.test.ts
git commit -m "feat(408): kolom Spec.createdAt & startedAt + migration backfill"
```

---

## Task 2: `startedAt` ditulis saat sesi PERTAMA lahir

**Files:**
- Modify: `server/src/services/session-launch.ts:144`
- Test: `server/test/session-launch.test.ts`, `server/test/session-resume.test.ts`

**Interfaces:**
- Consumes: kolom `Spec.startedAt` dari Task 1.
- Produces: invariant "`startedAt` = waktu sesi pertama, tak pernah ditulis ulang" — diandalkan Task 5 (`dateField=started`).

- [ ] **Step 1: Tulis test yang gagal — sesi fresh menulis `startedAt`**

Tambahkan di `server/test/session-launch.test.ts`, di dalam `describe("session-launch", …)`:

```ts
  // SPEC-408 · ADR-0090 · "dikerjakan" = sesi pertama lahir. Titiknya sama dengan baseSha:
  // satu tulisan, satu makna. Bukti diambil dari DB, bukan dari bentuk respons.
  it("sesi pertama menulis startedAt bersama baseSha (SPEC-408)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-408A");
    expect(spec.startedAt).toBeNull();
    const before = Date.now();
    const r = await startSpecSession(spec, { flow: "feature" });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-408A" } });
    expect(row!.baseSha).toBeTruthy();
    expect(row!.startedAt).toBeInstanceOf(Date);
    expect(row!.startedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    killSession(r.id);
  });
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/session-launch.test.ts -t "startedAt"
```

Expected: FAIL — `expected null to be an instance of Date`.

- [ ] **Step 3: Tulis `startedAt` di jalur fresh saja**

Di `server/src/services/session-launch.ts`, ganti baris 142-144:

```ts
    // Menulis ulang baseSha saat resume akan memotong rentang review jadi "sejak dilanjutkan";
    // headSha yang di-null-kan menghapus ujung yang sudah tercatat sesi sebelumnya.
    // SPEC-408 · ADR-0090 · `startedAt` ikut jalur yang SAMA persis: ia berarti "kapan item ini
    // MULAI dikerjakan", jadi melanjutkan sesi tak boleh memundurkan/memajukannya.
    if (!resume) await prisma.spec.update({
      where: { id: spec.id }, data: { baseSha, headSha: null, startedAt: new Date() },
    });
```

- [ ] **Step 4: Jalankan — harus lulus**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/session-launch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Tulis test yang gagal — resume TIDAK menimpa**

Tambahkan di `server/test/session-resume.test.ts`, di dalam `describe("SPEC-394 · pane mati bukan sesi hidup", …)`:

```ts
  // SPEC-408 · ADR-0090 · melanjutkan bukan "mulai lagi": startedAt harus setua sesi PERTAMA,
  // cermin persis dari baseSha yang juga tak ditulis ulang saat resume (ADR-0084).
  it("resume tidak menulis ulang startedAt (SPEC-408)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const { spec } = await seed("SPEC-408R");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    expect(await waitExited(r1.id)).toBe(true);
    const first = (await prisma.spec.findUnique({ where: { id: "SPEC-408R" } }))!.startedAt;
    expect(first).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 25));
    const fresh = (await prisma.spec.findUnique({ where: { id: "SPEC-408R" } }))!;
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    const after = (await prisma.spec.findUnique({ where: { id: "SPEC-408R" } }))!.startedAt;
    expect(after!.getTime()).toBe(first!.getTime());
    killSession(r2.id);
  });
```

- [ ] **Step 6: Jalankan — harus lulus tanpa perubahan kode**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/session-resume.test.ts
```

Expected: PASS. Test ini menjaga invariant yang sudah benar sejak Step 3 (`if (!resume)`); ia ada supaya siapa pun yang kelak "menyederhanakan" gerbang itu langsung merah.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-launch.test.ts server/test/session-resume.test.ts
git commit -m "feat(408): tulis Spec.startedAt saat sesi pertama lahir, tak ditimpa saat resume"
```

---

## Task 3: Dua kolom menyeberang sync

**Files:**
- Modify: `server/src/services/sync.ts:31,44`
- Test: `server/test/sync.service.test.ts`

**Interfaces:**
- Consumes: kolom dari Task 1.
- Produces: `FIELDS.spec` & `DATE_FIELDS.spec` yang memuat `createdAt`/`startedAt`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/sync.service.test.ts`, di dalam `describe("sync service (SPEC-213 AC-9..15)", …)`:

```ts
  // SPEC-408 · ADR-0090 · tanpa ini, spec yang lahir di hub akan mendapat createdAt = now()
  // di TIAP client (kolom NOT NULL ber-default) alias tanggal palsu per mesin.
  it("createdAt & startedAt menyeberang push (SPEC-408)", async () => {
    await project();
    const created = "2026-01-02T03:04:05.000Z";
    const started = "2026-02-03T04:05:06.000Z";
    await applyPush("spec", "SPEC-1", 0, specData({ createdAt: created, startedAt: started }));
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(row!.createdAt.toISOString()).toBe(created);
    expect(row!.startedAt!.toISOString()).toBe(started);
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap?.data).toMatchObject({ createdAt: created, startedAt: started });
  });

  it("startedAt null menyeberang sebagai null (SPEC-408)", async () => {
    await project();
    await applyPush("spec", "SPEC-2", 0, specData({ createdAt: "2026-01-02T03:04:05.000Z", startedAt: null }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.startedAt).toBeNull();
    expect((await snapshot("spec", "SPEC-2"))?.data).toMatchObject({ startedAt: null });
  });
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync.service.test.ts -t "SPEC-408"
```

Expected: FAIL — `createdAt` bukan tanggal yang dikirim (baris memakai default `now()`), dan `snap.data` tak punya key-nya.

- [ ] **Step 3: Masukkan ke whitelist**

Di `server/src/services/sync.ts`, ganti baris 31:

```ts
  // SPEC-408 · ADR-0090 · createdAt/startedAt ikut menyeberang — sejajar baseSha/headSha. Tanpa
  // ini spec asal-hub mendapat createdAt lokal palsu di tiap client (kolom NOT NULL ber-default).
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "createdAt", "startedAt", "updatedAt"],
```

dan baris 44 (`DATE_FIELDS`):

```ts
  project: ["updatedAt"], spec: ["createdAt", "startedAt", "updatedAt"], vps: ["lastSeenAt", "lastAuditAt", "updatedAt"],
```

- [ ] **Step 4: Jalankan — harus lulus**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/sync.service.test.ts server/test/sync-exclusions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/sync.ts server/test/sync.service.test.ts
git commit -m "feat(408): createdAt & startedAt menyeberang record-sync"
```

---

## Task 4: Helper rentang tanggal murni

**Files:**
- Create: `server/src/services/date-range.ts`
- Test: `server/test/date-range.test.ts`

**Interfaces:**
- Produces:
  - `dayStart(s: string | undefined): Date | null` — awal hari LOKAL; `null` bila bukan `YYYY-MM-DD` valid.
  - `dayEnd(s: string | undefined): Date | null` — akhir hari LOKAL (23:59:59.999).
  - `inDayRange(at: Date | null | undefined, from: Date | null, to: Date | null): boolean` — inklusif; batas `null` = terbuka; `at` null → `false` kecuali kedua batas null.
  Dipakai Task 5.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/date-range.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dayStart, dayEnd, inDayRange } from "../src/services/date-range";

// SPEC-408 · ADR-0090 · jebakan yang dijaga berkas ini: `new Date("2026-07-31")` adalah tengah
// malam UTC, bukan lokal. Dipakai apa adanya sebagai batas `to`, ia membuang hampir seluruh
// hari 31 Juli untuk operator di WIB (UTC+7). Karena itu parsing dilakukan komponen-per-komponen.
describe("date-range (SPEC-408)", () => {
  it("dayStart = tengah malam LOKAL, bukan UTC", () => {
    const d = dayStart("2026-07-31")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(31);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it("dayEnd = akhir hari LOKAL (inklusif sampai 23:59:59.999)", () => {
    const d = dayEnd("2026-07-31")!;
    expect(d.getDate()).toBe(31);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it("string bukan tanggal → null (filter mati, bukan 400)", () => {
    for (const bad of [undefined, "", "kemarin", "2026-07", "31-07-2026", "2026-7-1"])
      expect(dayStart(bad)).toBeNull();
  });

  it("tanggal yang tak ada ditolak, bukan digulirkan diam-diam", () => {
    expect(dayStart("2026-13-01")).toBeNull();   // bulan 13
    expect(dayStart("2026-02-30")).toBeNull();   // 30 Februari
  });

  it("inDayRange inklusif di KEDUA ujung", () => {
    const from = dayStart("2026-07-01"), to = dayEnd("2026-07-31");
    expect(inDayRange(new Date(2026, 6, 1, 0, 0, 0, 0), from, to)).toBe(true);
    expect(inDayRange(new Date(2026, 6, 31, 23, 59, 59, 999), from, to)).toBe(true);
    expect(inDayRange(new Date(2026, 5, 30, 23, 59, 59, 999), from, to)).toBe(false);
    expect(inDayRange(new Date(2026, 7, 1, 0, 0, 0, 0), from, to)).toBe(false);
  });

  it("batas terbuka: hanya from, atau hanya to", () => {
    expect(inDayRange(new Date(2026, 6, 15), dayStart("2026-07-01"), null)).toBe(true);
    expect(inDayRange(new Date(2026, 5, 15), dayStart("2026-07-01"), null)).toBe(false);
    expect(inDayRange(new Date(2026, 6, 15), null, dayEnd("2026-07-31"))).toBe(true);
    expect(inDayRange(new Date(2026, 7, 15), null, dayEnd("2026-07-31"))).toBe(false);
  });

  it("tanggal null lolos hanya saat tak ada rentang aktif", () => {
    expect(inDayRange(null, null, null)).toBe(true);
    expect(inDayRange(null, dayStart("2026-07-01"), null)).toBe(false);
    expect(inDayRange(null, null, dayEnd("2026-07-31"))).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/date-range.test.ts
```

Expected: FAIL — `Failed to load ../src/services/date-range`.

- [ ] **Step 3: Tulis implementasinya**

Buat `server/src/services/date-range.ts`:

```ts
// SPEC-408 · ADR-0090 · rentang tanggal untuk filter backlog. Murni, nol dependensi, nol I/O —
// gampang diuji dan tak menyeret Prisma ke test.
//
// Kenapa parsing manual, bukan `new Date(s)`: `new Date("2026-07-31")` di-spec ECMAScript sebagai
// tengah malam **UTC**. Dipakai sebagai batas `to`, ia membuang hampir seluruh hari 31 Juli untuk
// operator di zona timur (WIB = UTC+7). Operator memilih tanggal di kalendernya sendiri, jadi
// batasnya harus hari LOKAL.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Awal hari lokal untuk `YYYY-MM-DD`. `null` bila bukan tanggal kalender yang valid. */
export function dayStart(s: string | undefined | null): Date | null {
  if (!s || !DAY.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  // `new Date(2026, 12, 1)` menggulir ke Januari 2027 tanpa error — tolak yang tak sesuai input,
  // supaya "2026-02-30" jadi filter mati, bukan filter yang diam-diam menunjuk 2 Maret.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Akhir hari lokal (23:59:59.999) untuk `YYYY-MM-DD` — batas `to` yang INKLUSIF. */
export function dayEnd(s: string | undefined | null): Date | null {
  const start = dayStart(s);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
}

/**
 * Inklusif di kedua ujung; batas `null` = terbuka. Tanpa rentang aktif semuanya lolos.
 * `at` null (mis. `startedAt` item yang belum pernah dikerjakan) TIDAK lolos begitu ada
 * rentang aktif — item tanpa tanggal tak bisa berada di dalam rentang tanggal.
 */
export function inDayRange(at: Date | null | undefined, from: Date | null, to: Date | null): boolean {
  if (!from && !to) return true;
  if (!at) return false;
  const t = at.getTime();
  return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
}
```

- [ ] **Step 4: Jalankan — harus lulus**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/date-range.test.ts
```

Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/date-range.ts server/test/date-range.test.ts
git commit -m "feat(408): helper rentang tanggal lokal (murni + bertest)"
```

---

## Task 5: Filter tanggal di `GET /specs`

**Files:**
- Modify: `server/src/routes/specs.ts:56-78`
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `dayStart`/`dayEnd`/`inDayRange` (Task 4); kolom `createdAt`/`startedAt` (Task 1); invariant `startedAt` (Task 2).
- Produces: query param `dateField` · `from` · `to` di `GET /specs`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/specs.route.test.ts`, sebagai `describe` baru di akhir berkas:

```ts
// SPEC-408 · ADR-0090 · filter rentang tanggal. Diterapkan di layer response SETELAH overlay
// stage-live (ADR-0038), jadi `total` di envelope ikut menyusut — itu yang diuji, bukan hanya items.
describe("filter rentang tanggal (SPEC-408)", () => {
  const at = (iso: string) => new Date(iso);
  beforeAll(async () => {
    await makeProject({ id: "pdate", repoDir: makeTempRepo({ "a.txt": "a" }) });
    await makeSpec({ id: "SPEC-D01", projectId: "pdate", title: "juni",
      createdAt: at("2026-06-15T10:00:00Z"), startedAt: null });
    await makeSpec({ id: "SPEC-D02", projectId: "pdate", title: "juli awal",
      createdAt: at("2026-07-01T00:30:00Z"), startedAt: at("2026-08-10T09:00:00Z") });
    await makeSpec({ id: "SPEC-D03", projectId: "pdate", title: "juli akhir",
      createdAt: at("2026-07-31T16:45:00Z"), startedAt: at("2026-09-02T09:00:00Z") });
  });
  const ids = async (qs: string) => {
    const res = await app.inject({ url: `/api/specs?project=pdate&${qs}` });
    expect(res.statusCode).toBe(200);
    return res.json().items.map((s: any) => s.id).sort();
  };

  it("from..to inklusif di KEDUA ujung", async () => {
    expect(await ids("from=2026-07-01&to=2026-07-31")).toEqual(["SPEC-D02", "SPEC-D03"]);
  });
  it("batas terbuka: hanya from", async () => {
    expect(await ids("from=2026-07-01")).toEqual(["SPEC-D02", "SPEC-D03"]);
  });
  it("batas terbuka: hanya to", async () => {
    expect(await ids("to=2026-06-30")).toEqual(["SPEC-D01"]);
  });
  it("total di envelope ikut menyusut, bukan hanya items", async () => {
    const res = await app.inject({ url: "/api/specs?project=pdate&from=2026-07-01&to=2026-07-31" });
    expect(res.json().total).toBe(2);
  });
  it("dateField=started menyaring startedAt, dan membuang yang belum pernah dikerjakan", async () => {
    expect(await ids("dateField=started&from=2026-08-01&to=2026-08-31")).toEqual(["SPEC-D02"]);
    // SPEC-D01 (startedAt null) tak pernah muncul di rentang mana pun.
    expect(await ids("dateField=started&from=2026-01-01&to=2026-12-31")).toEqual(["SPEC-D02", "SPEC-D03"]);
  });
  it("tanggal ngawur diabaikan (filter mati), bukan 400", async () => {
    expect(await ids("from=kemarin&to=besok")).toEqual(["SPEC-D01", "SPEC-D02", "SPEC-D03"]);
  });
  it("dateField tak dikenal jatuh ke created", async () => {
    expect(await ids("dateField=ngawur&from=2026-07-01&to=2026-07-31")).toEqual(["SPEC-D02", "SPEC-D03"]);
  });
});
```

> Catatan implementasi test: `makeSpec` mem-forward `...over` ke `prisma.spec.create`, jadi `createdAt`/`startedAt` bisa di-set langsung tanpa mengubah factory. Tanggal ditulis dalam UTC agar deterministik, dan rentang yang diuji (`2026-07-01`..`2026-07-31`) berjarak jauh dari batas hari sehingga lulus di zona waktu mana pun mesin CI berada.

- [ ] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts -t "SPEC-408"
```

Expected: FAIL — semua tiga id dikembalikan (param diabaikan server).

- [ ] **Step 3: Terapkan filter di `filterSpecs` + route**

Di `server/src/routes/specs.ts`, tambahkan import setelah baris 21:

```ts
import { dayStart, dayEnd, inDayRange } from "../services/date-range";
```

Ganti `filterSpecs` (baris 54-65) menjadi:

```ts
// SPEC-198 · search/filter di layer response, DITERAPKAN SETELAH overlay stage-live —
// jadi filter `stage`/`startable` mencocokkan stage live, bukan stage DB yang basi.
// SPEC-408 · ADR-0090 · + rentang tanggal. `dateField` memilih SUMBU-nya: `created` (kapan item
// difilekan) atau `started` (kapan sesi pertama lahir). Tanggal tak valid → batas null → filter
// mati; konsisten dengan `stage`/`priority` yang juga lenient di sini, bukan 400.
function filterSpecs<T extends {
  id: string; title: string; objective: string; stage: string; priority: string;
  createdAt: Date; startedAt: Date | null;
}>(
  specs: T[], f: { q?: string; stage?: string; priority?: string; startable?: string;
    dateField?: string; from?: string; to?: string },
): T[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  const from = dayStart(f.from);
  const to = dayEnd(f.to);
  const byStarted = f.dateField === "started";
  return specs.filter((s) =>
    (!f.stage || s.stage === f.stage) &&
    (!f.priority || s.priority === f.priority) &&
    (f.startable !== "true" || s.stage !== "done") &&
    inDayRange(byStarted ? s.startedAt : s.createdAt, from, to) &&
    (needle === "" || `${s.id} ${s.title} ${s.objective}`.toLowerCase().includes(needle)));
}
```

Ganti isi handler `GET /specs` (baris 68-78) menjadi:

```ts
  app.get("/specs", async (req) => {
    const { project, source, q, stage, priority, startable, dateField, from, to, page, limit } =
      req.query as { project?: string; source?: string; q?: string; stage?: string;
        priority?: string; startable?: string; dateField?: string; from?: string; to?: string;
        page?: string; limit?: string };
    // Overlay stage-live + write-through + notifikasi atas SET PENUH (scope project/source) —
    // sekarang di liveSpecs, dibagi dengan hub siar WS (SPEC-199) supaya push & pull tak drift.
    // Filter/paginasi DITERAPKAN SETELAH overlay (SPEC-198): filter `stage`/`startable` mencocokkan
    // stage live, bukan DB basi; spec off-page tetap maju stage & bernotif karena overlay lebih dulu.
    const overlaid = await liveSpecs({ project, source });
    return paginate(filterSpecs(overlaid, { q, stage, priority, startable, dateField, from, to }), page, limit);
  });
```

- [ ] **Step 4: Jalankan — harus lulus**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts
```

Expected: PASS — seluruh berkas, termasuk 7 test SPEC-408 dan semua test filter lama.

- [ ] **Step 5: Typecheck paket server**

```bash
pnpm --filter ./server typecheck
```

Expected: exit 0, tanpa output error.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(408): filter dateField/from/to di GET /specs"
```

---

## Task 6: Kontrak klien — `zSpec` + `SpecListParams`

**Files:**
- Modify: `shared/src/entities.ts:37-44`, `src/src/api/client.ts:96-99`
- Test: `src/test/client.test.ts`

**Interfaces:**
- Consumes: query param dari Task 5.
- Produces: `SpecListParams` + `dateField?: "created" | "started"; from?: string; to?: string` — dipakai Task 7.
- Produces: `Spec.createdAt: string`, `Spec.startedAt: string | null` di `@hanoman/shared`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/client.test.ts` (ikuti pola `describe` yang sudah ada di berkas itu):

```ts
// SPEC-408 · ADR-0090 · tiga param filter tanggal harus sampai ke query string apa adanya.
describe("listSpecs — filter tanggal (SPEC-408)", () => {
  it("dateField/from/to masuk query string", async () => {
    const spy = mockFetchOk({ items: [], total: 0, page: 1, pageSize: 20 });
    await api.listSpecs({ project: "p", dateField: "started", from: "2026-07-01", to: "2026-07-31" });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toContain("dateField=started");
    expect(url).toContain("from=2026-07-01");
    expect(url).toContain("to=2026-07-31");
  });
  it("param kosong dibuang (tak mengirim from= telanjang)", async () => {
    const spy = mockFetchOk({ items: [], total: 0, page: 1, pageSize: 20 });
    await api.listSpecs({ project: "p", from: "", to: "" });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
  });
});
```

> Sebelum menulis, **baca `src/test/client.test.ts`** dan pakai helper mock fetch yang sudah ada di berkas itu; ganti `mockFetchOk` di atas dengan nama helper yang sebenarnya. Kalau berkas itu tak punya helper, buat lokal:
> ```ts
> const mockFetchOk = (json: unknown) => {
>   const spy = vi.fn(async () => new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } }));
>   vi.stubGlobal("fetch", spy);
>   return spy;
> };
> ```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
./node_modules/.bin/vitest --run src/test/client.test.ts -t "SPEC-408"
```

Expected: FAIL — TypeScript menolak `dateField` di `SpecListParams`.

- [ ] **Step 3: Tumbuhkan `SpecListParams`**

Di `src/src/api/client.ts`, ganti baris 96-99:

```ts
export type SpecListParams = {
  project?: string; source?: string; q?: string; stage?: string; priority?: string;
  startable?: boolean; page?: number; limit?: number;
  // SPEC-408 · ADR-0090 · rentang tanggal. `dateField` memilih sumbunya; `from`/`to` = `YYYY-MM-DD`
  // (bentuk yang dipancarkan `<input type="date">`), inklusif, boleh sendirian.
  dateField?: "created" | "started"; from?: string; to?: string;
};
```

- [ ] **Step 4: Tumbuhkan `zSpec`**

Di `shared/src/entities.ts`, ganti blok `zSpec` (baris 37-43):

```ts
export const zSpec = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), source: zSpecSource,
  stage: zStage, priority: zPriority, author: z.string(), objective: z.string(),
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).nullable(),   // SPEC-407 · +goal
  branchFrom: z.string().nullable(),                   // SPEC-143 · null = default project (main)
  baseSha: z.string().nullable(),                      // SPEC-186 · null = belum pernah ada sesi (belum dimulai)
  // SPEC-408 · ADR-0090 · stempel waktu backlog (ISO string di wire — kolom DateTime di DB).
  // `startedAt` null = belum pernah dikerjakan; ia tak pernah ditulis ulang saat sesi dilanjutkan.
  createdAt: z.string(),
  startedAt: z.string().nullable(),
});
```

- [ ] **Step 5: Jalankan test + typecheck**

```bash
./node_modules/.bin/vitest --run src/test/client.test.ts
pnpm --filter ./shared typecheck
pnpm --filter ./src typecheck
```

Expected: test PASS; kedua typecheck exit 0. Bila typecheck web mengeluh soal object literal `Spec` yang kurang field, tambahkan `createdAt`/`startedAt` di literal itu — jangan melonggarkan `zSpec` jadi optional.

- [ ] **Step 6: Commit**

```bash
git add shared/src/entities.ts src/src/api/client.ts src/test/client.test.ts
git commit -m "feat(408): kontrak klien — zSpec createdAt/startedAt + SpecListParams tanggal"
```

---

## Task 7: Kontrol filter tanggal di BacklogScreen

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx:607-685`
- Test: `src/test/backlog-date-filter.test.tsx` (create)

**Interfaces:**
- Consumes: `SpecListParams` dari Task 6.
- Produces: tiga kontrol ber-`aria-label` `"Filter tanggal berdasarkan"`, `"Tanggal dari"`, `"Tanggal sampai"`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/backlog-date-filter.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";
import type { Spec } from "../src/screens/types";

const spec = (over: Partial<Spec> = {}) =>
  ({ id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
     priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
     createdAt: "2026-07-01T00:00:00.000Z", startedAt: null, ...over }) as Spec;

const envelope = (items: Spec[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const lastCall = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;

function backlog(items: Spec[] = [spec()]) {
  vi.mocked(api.listSpecs).mockResolvedValue(envelope(items));
  render(<BacklogScreen backlog={items} projects={[{ id: "p", name: "p" }] as never}
    projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
}

beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); });

// SPEC-408 · ADR-0090 · filter dikirim ke server (ADR-0038: penyaringan di layer response),
// jadi yang diuji adalah PARAM yang menyeberang, bukan jumlah baris yang dirender klien.
describe("filter rentang tanggal backlog (SPEC-408)", () => {
  it("tiga kontrolnya ada di baris penyaring", () => {
    backlog();
    expect(screen.getByLabelText("Filter tanggal berdasarkan")).toBeTruthy();
    expect(screen.getByLabelText("Tanggal dari")).toBeTruthy();
    expect(screen.getByLabelText("Tanggal sampai")).toBeTruthy();
  });

  it("tanpa tanggal terisi, tak ada param tanggal yang dikirim", async () => {
    backlog();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastCall().from).toBeUndefined();
    expect(lastCall().to).toBeUndefined();
    expect(lastCall().dateField).toBeUndefined();
  });

  it("mengisi dari+sampai mengirim from/to/dateField", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Tanggal sampai"), { target: { value: "2026-07-31" } });
    await waitFor(() => expect(lastCall().to).toBe("2026-07-31"));
    expect(lastCall().from).toBe("2026-07-01");
    expect(lastCall().dateField).toBe("created");
  });

  it("memilih Dikerjakan mengubah sumbu yang dikirim", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Filter tanggal berdasarkan"), { target: { value: "started" } });
    await waitFor(() => expect(lastCall().dateField).toBe("started"));
    expect(lastCall().from).toBe("2026-07-01");
  });

  it("satu batas saja sudah mengaktifkan filter", async () => {
    backlog();
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    await waitFor(() => expect(lastCall().from).toBe("2026-07-01"));
    expect(lastCall().to).toBeUndefined();
    expect(lastCall().dateField).toBe("created");
  });

  it("Reset filter mengosongkan tanggal DAN mengembalikan sumbu ke Dibuat", async () => {
    // server mengembalikan 0 item → StateBlock "Tidak ada spec untuk filter ini" muncul
    // (prop `backlog` tetap terisi, itulah cabang yang menampilkan tombol Reset).
    vi.mocked(api.listSpecs).mockResolvedValue(envelope([]));
    render(<BacklogScreen backlog={[spec()]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={() => {}} onStart={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Filter tanggal berdasarkan"), { target: { value: "started" } });
    fireEvent.click(await screen.findByText("Reset filter"));
    expect((screen.getByLabelText("Tanggal dari") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Filter tanggal berdasarkan") as HTMLSelectElement).value).toBe("created");
    await waitFor(() => expect(lastCall().from).toBeUndefined());
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
./node_modules/.bin/vitest --run src/test/backlog-date-filter.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: Filter tanggal berdasarkan`.

- [ ] **Step 3: Tambah state (setelah baris 614)**

Di `src/src/screens/BacklogScreen.tsx`, setelah `const [prioFilter, setPrioFilter] = React.useState("all");`:

```tsx
  // SPEC-408 · ADR-0090 · rentang tanggal. `dateField` memilih sumbunya (dibuat / dikerjakan);
  // `from`/`to` = "YYYY-MM-DD" apa adanya dari <input type="date">, inklusif, boleh sendirian.
  // View-local seperti filter SPEC-178 — tak diangkat ke App.
  const [dateField, setDateField] = React.useState<"created" | "started">("created");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
```

- [ ] **Step 4: Masukkan ke dua effect (baris 631 & 632-646)**

Ganti effect reset-halaman:

```tsx
  React.useEffect(() => { setPage(1); }, [tab, proj, stageFilter, prioFilter, dq, view, dateField, from, to]);
```

Di effect fetch, tambahkan tiga param setelah `priority:` dan lengkapi deps:

```tsx
      priority: prioFilter === "all" ? undefined : prioFilter,
      // Kirim sumbu HANYA saat rentangnya aktif — tanpa itu `dateField` jadi kebisingan di
      // setiap request dan test kontrak param lama ikut goyah.
      dateField: from || to ? dateField : undefined,
      from: from || undefined,
      to: to || undefined,
      page: view === "board" ? undefined : page,
      limit: view === "board" ? undefined : pageSize,
    });
    p?.then((r) => { if (alive) setData({ items: r.items, total: r.total }); }).catch(() => { });
    return () => { alive = false; };
  }, [tab, proj, stageFilter, prioFilter, dq, view, page, pageSize, dataVersion, syncNonce, dateField, from, to]);
```

- [ ] **Step 5: Tambah tiga kontrol di baris penyaring (setelah Select prioritas, baris 671-675)**

```tsx
          {/* SPEC-408 · ADR-0090 · rentang tanggal: satu sumbu + dua batas inklusif. DS `Input`
              meneruskan ...rest ke <input>, jadi type="date" jalan tanpa mengubah design system. */}
          <Select size="sm" aria-label="Filter tanggal berdasarkan" value={dateField}
            onChange={(e) => setDateField(e.target.value as "created" | "started")}
            options={[{ value: "created", label: "Dibuat" }, { value: "started", label: "Dikerjakan" }]} />
          <Input size="sm" type="date" aria-label="Tanggal dari" value={from}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
            style={{ flex: "0 0 auto" }} />
          <span className="hn-eyebrow" aria-hidden="true">→</span>
          <Input size="sm" type="date" aria-label="Tanggal sampai" value={to}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
            style={{ flex: "0 0 auto" }} />
```

- [ ] **Step 6: Ikutkan di Reset filter (baris 685)**

Ganti `action` pada `StateBlock kind="empty" icon="filter"`:

```tsx
            action={() => { setTab("all"); setProj("all"); setQ(""); setStageFilter("all"); setPrioFilter("all"); setDateField("created"); setFrom(""); setTo(""); }} actionLabel="Reset filter" actionIcon="rotate-ccw" />
```

- [ ] **Step 7: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run src/test/backlog-date-filter.test.tsx src/test/backlog-board.test.tsx src/test/backlog-goal.test.tsx src/test/backlog-deeplink.test.tsx
```

Expected: PASS semua. `backlog-board.test.tsx` menjaga `toMatchObject({ page: 1, limit: 20 })` — masih lulus karena `dateField` tak dikirim saat rentang kosong.

- [ ] **Step 8: Typecheck web**

```bash
pnpm --filter ./src typecheck
```

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/backlog-date-filter.test.tsx
git commit -m "feat(408): kontrol filter rentang tanggal di BacklogScreen"
```

---

## Task 8: Docs Source of Truth + ADR-0090

**Files:**
- Create: `internal/docs/adr/0090-stempel-waktu-backlog-created-started.md`
- Modify: `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md`

- [ ] **Step 1: Verifikasi nomor ADR masih bebas**

```bash
for b in $(git branch -a --format='%(refname)'); do git ls-tree -r --name-only "$b" internal/docs/adr 2>/dev/null; done | grep -oE '[0-9]{4}' | sort -n | tail -3
git worktree list
```

Expected: tertinggi `0089`. Bila sudah ada `0090` di branch lain, naikkan nomor di seluruh berkas plan ini sebelum lanjut.

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0090-stempel-waktu-backlog-created-started.md` dengan status `Accepted`, tanggal `2026-07-31`, dan isi yang merekam kelima keputusan berikut (ikuti format ADR tetangga, mis. `0089-backlog-goal-flow-dua-fase.md` — baca dulu satu berkas untuk menyalin strukturnya):

1. **Konteks.** Filter "backlog dibuat & dikerjakan per kapannya" tak bisa dibangun di atas data yang ada: `Spec` hanya punya `updatedAt`; "dikerjakan" cuma kondisi boolean turunan `baseSha !== null`.
2. **Keputusan (a).** Waktu pembuatan jadi **kolom** `Spec.createdAt` (`@default(now())`, NOT NULL) — ditulis DB, tak pernah oleh route, sehingga "dibuat" adalah fakta yang tak bisa diedit operator.
3. **Keputusan (b).** `Spec.startedAt` (nullable) ditulis di **titik cekik yang sama dengan `baseSha`** (`services/session-launch.ts`, cabang `if (!resume)`) dan berarti **mulai pertama**, bukan sentuhan terakhir — cermin ADR-0084 yang juga sengaja tak menulis ulang `baseSha` saat melanjutkan.
4. **Keputusan (c).** `updatedAt` **ditolak** sebagai proksi keduanya: mesin sync menggerakkannya (`publishLocal`/`backfillFeed` mem-bump `version` → `@updatedAt` ikut) dan overlay stage-live menulis kemajuan; item yang tak pernah disentuh manusia bisa tampak baru saja diperbarui.
5. **Keputusan (d).** Baris lama di-backfill dari `updatedAt` (`startedAt` hanya bila `baseSha` ada) — **aproksimasi yang dinyatakan terbuka**. Alternatif "waktu migration dijalankan" ditolak karena membuat seluruh backlog lama tampak dibuat hari ini.
6. **Keputusan (e).** Penyaringan tetap di **layer response** setelah overlay stage-live (**ADR-0038 utuh**), lewat helper murni `services/date-range.ts`; **tanpa index DB baru** karena filter tak pernah menyentuh query planner.
7. **Gotcha wajib.** (i) SQLite melarang `ALTER TABLE … ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` → migration wajib redefinisi tabel, dan redefinisi itulah tempat backfill. (ii) `new Date("2026-07-31")` = tengah malam **UTC** — dipakai sebagai batas `to` ia membuang hampir seluruh hari itu di WIB; parsing karena itu komponen-per-komponen di zona lokal, dengan tolakan rollover (`2026-02-30` → `null`, bukan 2 Maret). (iii) `createdAt`/`startedAt` **wajib** masuk `FIELDS.spec` + `DATE_FIELDS.spec`, kalau tidak spec asal-hub mendapat `createdAt` lokal palsu di tiap client.
8. **Konsekuensi.** Satu migration aditif; `zSpec` bertambah dua field (ISO string di wire); `dateField=started` **membuang** item yang belum pernah dikerjakan; item lama menampilkan tanggal aproksimasi selamanya.

- [ ] **Step 3: Taut ADR di index & sub-index**

Di `internal/docs/README.md`, tepat di atas baris `- [0089 — …]`:

```markdown
- [0090 — Stempel waktu backlog: `Spec.createdAt` & `startedAt` sebagai kolom, bukan turunan](adr/0090-stempel-waktu-backlog-created-started.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasi 0090 di posisi yang sama dengan pola 0089 (baca berkas itu untuk menyalin bentuk paragrafnya): apa yang diperluas (filter backlog SPEC-198/ADR-0038), apa yang ditolak (`updatedAt` sebagai proksi), dan ketiga gotcha di atas.

- [ ] **Step 4: Perbarui data-model**

Di `internal/docs/architecture/data-model.md` §`Spec (backlog item)`, setelah bullet `baseSha?`/`headSha?`:

```markdown
- `createdAt`/`startedAt` (SPEC-408/[ADR-0090](../adr/0090-stempel-waktu-backlog-created-started.md)) —
  stempel waktu backlog. `createdAt` NOT NULL ber-`@default(now())`, ditulis DB dan **tak pernah** oleh
  route. `startedAt` nullable = kapan sesi **pertama** lahir; ditulis di titik cekik yang sama dengan
  `baseSha` (`services/session-launch.ts`, cabang `if (!resume)`) sehingga jalur *melanjutkan*
  (ADR-0084) tak menimpanya — ia berarti "mulai pertama", bukan "sentuhan terakhir". `updatedAt`
  **bukan** penggantinya: mesin sync mem-bump `version` (`publishLocal`/`backfillFeed`) dan overlay
  stage-live menulis kemajuan, jadi ia bergerak tanpa ada manusia yang menyentuh item. Keduanya
  menyeberang record-sync (`FIELDS.spec` + `DATE_FIELDS.spec`). Baris pra-migration di-backfill dari
  `updatedAt` — aproksimasi yang disengaja.
```

- [ ] **Step 5: Perbarui api-contract**

Di `internal/docs/architecture/api-contract.md` §`Backlog / specs`, ganti baris query dan tambahkan catatan:

```
GET  /specs?project=&source=&q=&stage=&priority=&startable=&dateField=&from=&to=&page=&limit=
```

lalu setelah baris `#   Tanpa page/limit → seluruh item terfilter (page 1, pageSize=total). Lihat ADR-0038.`:

```
#   SPEC-408 · ADR-0090 · rentang tanggal: `dateField` = created (default) | started — sumbu
#   `Spec.createdAt` atau `Spec.startedAt`; `from`/`to` = `YYYY-MM-DD` INKLUSIF (boleh sendirian),
#   di-parse di zona waktu LOKAL SERVER (`from` 00:00:00.000, `to` 23:59:59.999) — `new Date("…")`
#   polos akan menaruh batasnya di tengah malam UTC dan membuang hampir seluruh hari `to` di WIB.
#   String bukan-tanggal DIABAIKAN (filter mati), bukan 400 — konsisten dgn stage/priority.
#   `dateField=started` membuang item ber-`startedAt` null (belum pernah dikerjakan). Filternya
#   tetap di layer response bersama yang lain, jadi `total` di envelope ikut menyusut.
```

- [ ] **Step 6: Perbarui skill project**

Di `internal/skills/hanoman/SKILL.md` §"Aturan Arsitektur", tambahkan satu butir setelah butir SPEC-360 (hapus branch):

```markdown
- **Stempel waktu backlog** (SPEC-408/ADR-0090): `Spec` punya `createdAt` (NOT NULL, `@default(now())`)
  dan `startedAt` (nullable). `startedAt` ditulis di **titik cekik yang sama dengan `baseSha`**
  (`session-launch.ts`, cabang `if (!resume)`) → ia berarti **mulai pertama**, bukan sentuhan terakhir;
  jalur melanjutkan (ADR-0084) sengaja tak menimpanya. `updatedAt` **bukan** proksi keduanya — mesin
  sync mem-bump `version` dan overlay stage-live menulis kemajuan, jadi ia bergerak tanpa manusia.
  `GET /specs` menerima `dateField=created|started` + `from`/`to` (`YYYY-MM-DD`, **inklusif**),
  disaring di layer response bersama filter lain (ADR-0038 utuh) lewat helper murni
  `services/date-range.ts`. **Tiga gotcha:** SQLite melarang `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP`
  → migration wajib redefinisi tabel (dan di situlah backfill dari `updatedAt` dilakukan);
  `new Date("2026-07-31")` = tengah malam **UTC** sehingga batas `to` polos membuang hampir seluruh
  hari itu di WIB → parsing komponen-per-komponen di zona lokal + tolak rollover (`2026-02-30` → null);
  dan kedua kolom **wajib** ada di `FIELDS.spec` + `DATE_FIELDS.spec`, kalau tidak spec asal-hub
  mendapat `createdAt` lokal palsu di tiap client.
```

- [ ] **Step 7: Cek integritas index**

```bash
grep -c "0090" internal/docs/README.md internal/docs/adr/README.md
```

Expected: masing-masing ≥ 1.

- [ ] **Step 8: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(408): ADR-0090 + index/sub-index + data-model/api-contract + skill"
```

---

## Task 9: Verifikasi akhir (scope `changed`)

**Files:** tak ada perubahan kode — ini gerbang bukti.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

```bash
TEST_DATABASE_URL=file:$PWD/.tmp/spec408.test.db ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/date-range.test.ts server/test/specs.route.test.ts server/test/session-launch.test.ts \
  server/test/session-resume.test.ts server/test/sync.service.test.ts server/test/sync-exclusions.test.ts \
  src/test/backlog-date-filter.test.tsx src/test/backlog-board.test.tsx src/test/backlog-goal.test.tsx \
  src/test/backlog-deeplink.test.tsx src/test/client.test.ts
```

Expected: PASS semua. **Baca jumlah test yang benar-benar berjalan** — "no test files" bukan bukti (jebakan `passWithNoTests`, ADR-0080).

- [ ] **Step 2: Typecheck tiga paket yang tersentuh (satu per satu, bukan `-r`)**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: exit 0, tanpa output.

- [ ] **Step 3: Smoke endpoint nyata — boot server + curl**

Pakai `HANOMAN_HOME` khusus supaya tak menyentuh DB dev bersama (pelajaran "Live smoke: DB khusus"):

```bash
export SMOKE_HOME=$PWD/.tmp/smoke-home
mkdir -p "$SMOKE_HOME"
HANOMAN_HOME="$SMOKE_HOME" pnpm --filter ./server exec prisma migrate deploy
HANOMAN_HOME="$SMOKE_HOME" PORT=8791 pnpm --filter ./server dev &
sleep 6
```

Lalu seed dua spec ber-tanggal berbeda langsung ke DB smoke dan uji:

```bash
HANOMAN_HOME="$SMOKE_HOME" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  await p.project.upsert({ where: { id: "smoke" }, update: {},
    create: { id: "smoke", name: "smoke", desc: "", kind: "existing" } });
  await p.spec.upsert({ where: { id: "SPEC-S1" }, update: {},
    create: { id: "SPEC-S1", projectId: "smoke", title: "juni", source: "brief", stage: "brainstorming",
      author: "a", priority: "sedang", objective: "o",
      createdAt: new Date("2026-06-15T10:00:00Z"), startedAt: null } });
  await p.spec.upsert({ where: { id: "SPEC-S2" }, update: {},
    create: { id: "SPEC-S2", projectId: "smoke", title: "juli", source: "brief", stage: "brainstorming",
      author: "a", priority: "sedang", objective: "o",
      createdAt: new Date("2026-07-31T16:00:00Z"), startedAt: new Date("2026-08-05T09:00:00Z") } });
  await p.$disconnect();
})();'

curl -s "http://127.0.0.1:8791/api/specs?project=smoke&from=2026-07-01&to=2026-07-31"
curl -s "http://127.0.0.1:8791/api/specs?project=smoke&dateField=started&from=2026-08-01&to=2026-08-31"
curl -s "http://127.0.0.1:8791/api/specs?project=smoke&from=ngawur"
```

Expected: curl #1 → hanya `SPEC-S2`, `total: 1`. curl #2 → hanya `SPEC-S2`, `total: 1`. curl #3 → kedua spec, `total: 2`.

> Bila `/api` membalas 401, server menuntut login (ADR-0028). Buat akun sekali:
> `curl -s -XPOST localhost:8791/api/auth/setup -H 'content-type: application/json' -d '{"email":"s@s.io","password":"smoke-pass-123"}' -c $PWD/.tmp/cj` lalu tambahkan `-b $PWD/.tmp/cj` di ketiga curl.

- [ ] **Step 4: Matikan server smoke per-PID (JANGAN `pkill -f`)**

```bash
lsof -ti:8791 | xargs -r kill
rm -rf "$SMOKE_HOME"
```

- [ ] **Step 5: Pastikan diff bersih & artefak sementara tak ikut**

```bash
git status --porcelain
```

Expected: kosong, atau hanya `.tmp/` — bila `.tmp/` muncul, hapus (`rm -rf .tmp`) sebelum commit terakhir. Jangan pernah `git add -A` di repo ini.

- [ ] **Step 6: Centang plan & push**

```bash
git add docs/superpowers
git commit -m "docs(408): centang plan SPEC-408"
git push origin HEAD:refs/heads/hanoman/spec-408
```

---

## Self-Review

**Spec coverage:** §2 data model → Task 1 (kolom + backfill) & Task 2 (`startedAt`); §2 sync → Task 3; §3 kontrak API (parsing lokal, lenient, `started` buang null) → Task 4 + Task 5; §3 `zSpec` → Task 6; §4 UI (tiga kontrol, reset, board) → Task 7; §6 test → tersebar di Task 1-7, dikumpulkan Task 9; §7 ADR → Task 8. §5 (YAGNI) tak butuh task — tak ada yang dibangun.

**Placeholder scan:** satu-satunya rujukan "baca berkas dulu" adalah nama helper mock di `src/test/client.test.ts` (Task 6 Step 1) — disertai implementasi lengkap sebagai fallback — dan bentuk paragraf ADR tetangga (Task 8), yang isinya sudah dieja butir-per-butir.

**Type consistency:** `dayStart`/`dayEnd`/`inDayRange` dipakai dengan signature identik di Task 4 (definisi) dan Task 5 (konsumsi). `dateField` konsisten bertipe `"created" | "started"` di `SpecListParams` (Task 6) dan state UI (Task 7); di server ia `string` lenient dan dibandingkan `=== "started"` (Task 5) — sengaja, karena query string tak bertipe.
