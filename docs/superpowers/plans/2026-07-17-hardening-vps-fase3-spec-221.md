# Hardening VPS Fase 3 (SPEC-221) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`). TDD throughout.

**Goal:** Tambah monitoring proaktif ke kerangka kepatuhan VPS: deteksi drift (pass→fail/warn) + Notification, dan applicability app-layer advisory (deteksi stack → saran N/A, tak auto-exclude).

**Architecture:** Drift = fungsi murni yang mem-diff 2 `VpsAuditSnapshot` terakhir (tanpa tabel baru), dipanggil di `runAudit` → `recordDrift` membuat Notification agregat. Deteksi stack app-layer disimpan di kolom additive `VpsAuditSnapshot.detected`; `buildChecklist` menurunkan `drifted` per item + `suggestion` per seksi. UI menandai drift + banner saran + tombol bulk N/A. Semua deterministik SSH+sudo, tanpa cron baru.

**Tech Stack:** Node/TS Fastify, Prisma/Postgres, React/TS Vite, bash (deb/rhel), vitest.

## Global Constraints

- TypeScript strict. Test tiap logika (drift, parse, route, UI).
- Skrip deterministik SSH+sudo, BUKAN sesi Claude (AC-21). Idempoten. Multi-distro deb/rhel.
- **Tanpa scheduler/cron baru** (AC-20, ADR-0024) — drift dihitung saat audit dipicu manual/on-view.
- **App-layer advisory saja**: deteksi stack → saran N/A. TIDAK auto-exclude dari skor. N/A manual manusia tetap menang.
- **Drift** = item `pass` di snapshot sebelumnya, kini `fail`/`warn`. **`pass→unknown` BUKAN drift** (transien).
- Drift Notification **agregat per-audit** (bukan per-item), dedup `key: "drift:<vpsId>:<snapshotId>"`.
- Perubahan skema → migration hand-written + `migrate deploy` per DB (`hanoman`, `hanoman_test`) + ADR (AC-24). Jangan `migrate dev`.
- Docs tersentuh diperbarui + link di `internal/docs/README.md` dalam commit yang sama.
- Test: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`. Tiap task: centang box + boot server + curl endpoint tersentuh.
- Bergantung pada SPEC-220 (katalog, `VpsAuditSnapshot`/`VpsItemState`, `scoreCompliance`, `buildChecklist`) — sudah ada di worktree ini.
- Kredensial DB dev: `postgresql://hanoman:hanoman@localhost:5432/hanoman` (Docker :5432). Smoke pakai DB throwaway, bukan `hanoman_test`.

---

## PR1 — Skema `detected` + drift core + Notification

### Task 1: Kolom `detected` di VpsAuditSnapshot + migration

**Files:**
- Modify: `server/prisma/schema.prisma` (model `VpsAuditSnapshot`)
- Create: `server/prisma/migrations/2026071710_spec221_stack_detected/migration.sql`

- [x] **Step 1:** Tambah field ke `model VpsAuditSnapshot` (setelah `scoreBySection Json`):
```prisma
  detected       Json?    // SPEC-221 · { [section]: { present: bool, detail } } — deteksi stack app-layer (advisory)
```
- [x] **Step 2:** Tulis `migration.sql`:
```sql
-- SPEC-221 · ADR-0051 · deteksi stack app-layer (advisory) di snapshot (additive).
ALTER TABLE "VpsAuditSnapshot" ADD COLUMN "detected" JSONB;
```
- [x] **Step 3: Apply per DB + generate.**
```bash
cd server
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Expected: `migrate deploy` sukses di dua DB.
- [x] **Step 4:** Smoke: `docker exec hanoman-db-1 psql -U hanoman -d hanoman -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='VpsAuditSnapshot' AND column_name='detected'"` → `detected`.
- [x] **Step 5: Commit.** `git add server/prisma && git commit -m "feat(vps): kolom VpsAuditSnapshot.detected + migration (SPEC-221 AC-24)"`

### Task 2: Fungsi murni computeDrift

**Files:**
- Create: `server/src/vps/drift.ts`, `server/test/vps-drift.test.ts`

**Interfaces (Produces):**
```ts
export type DriftItem = { itemId: string; from: string; to: string };
export function computeDrift(
  prev: Record<string, { status: string }>,
  curr: Record<string, { status: string }>): DriftItem[];
```
Aturan: untuk tiap itemId yang ADA di `prev` DAN `curr`, drift bila `prev.status === "pass"` DAN `curr.status ∈ {"fail","warn"}`. Selain itu bukan drift (termasuk `pass→unknown`, item baru, `pass→pass`).

- [x] **Step 1: Test** `vps-drift.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeDrift } from "../src/vps/drift";
const S = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { status: v }]));
describe("computeDrift (SPEC-221 AC-19)", () => {
  it("pass→fail = drift", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "fail" }))).toEqual([{ itemId: "a", from: "pass", to: "fail" }]);
  });
  it("pass→warn = drift", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "warn" }))).toEqual([{ itemId: "a", from: "pass", to: "warn" }]);
  });
  it("pass→unknown BUKAN drift (transien)", () => {
    expect(computeDrift(S({ a: "pass" }), S({ a: "unknown" }))).toEqual([]);
  });
  it("fail→fail, pass→pass, item baru: bukan drift", () => {
    expect(computeDrift(S({ a: "fail" }), S({ a: "fail" }))).toEqual([]);
    expect(computeDrift(S({ a: "pass" }), S({ a: "pass" }))).toEqual([]);
    expect(computeDrift(S({}), S({ a: "fail" }))).toEqual([]); // tak ada di prev
  });
});
```
- [x] **Step 2: Run (fail).** `env -u NODE_ENV pnpm vitest run --no-file-parallelism server/test/vps-drift.test.ts` → FAIL (module missing).
- [x] **Step 3: Implement** `drift.ts`:
```ts
export type DriftItem = { itemId: string; from: string; to: string };
const REGRESS = new Set(["fail", "warn"]);
export function computeDrift(
  prev: Record<string, { status: string }>,
  curr: Record<string, { status: string }>): DriftItem[] {
  const out: DriftItem[] = [];
  for (const [id, c] of Object.entries(curr)) {
    const p = prev[id];
    if (p && p.status === "pass" && REGRESS.has(c.status)) out.push({ itemId: id, from: p.status, to: c.status });
  }
  return out;
}
```
- [x] **Step 4: Run (pass).**
- [x] **Step 5: Commit.** `git commit -m "feat(vps): computeDrift pass->fail/warn (SPEC-221 AC-19)"`

### Task 3: recordDrift Notification + integrasi runAudit

**Files:**
- Modify: `server/src/services/notifications.ts` (helper `recordDrift`)
- Modify: `server/src/services/vps-audit.ts` (`runAudit` hitung drift, `AuditOk` tambah `drift`)
- Create: `server/test/vps-drift-notify.test.ts`

**Interfaces (Produces):**
- `recordDrift(vpsId: string, vpsName: string, drift: DriftItem[], snapshotId: string): Promise<void>` — buat 1 Notification agregat, dedup `key: "drift:<vpsId>:<snapshotId>"`.
- `AuditOk` tambah `drift: DriftItem[]`.

- [x] **Step 1: Test** `vps-drift-notify.test.ts` (pakai DB test + factory):
```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import { recordDrift } from "../src/services/notifications";
beforeAll(async () => { await resetDb(); });
beforeEach(async () => { await prisma.notification.deleteMany(); });
describe("recordDrift (SPEC-221 AC-19)", () => {
  it("buat 1 notif agregat type drift, dedup per snapshot", async () => {
    const v = await makeVps({ name: "d1", host: "198.51.100.201" });
    await recordDrift(v.id, "d1", [{ itemId: "ssh-b3", from: "pass", to: "fail" }], "snap1");
    await recordDrift(v.id, "d1", [{ itemId: "ssh-b3", from: "pass", to: "fail" }], "snap1"); // ulang → tak dobel
    const n = await prisma.notification.findMany({ where: { type: "drift" } });
    expect(n.length).toBe(1);
    expect(n[0]!.title).toContain("d1");
    expect(n[0]!.key).toBe(`drift:${v.id}:snap1`);
  });
  it("drift kosong → tak buat notif", async () => {
    const v = await makeVps({ name: "d2", host: "198.51.100.202" });
    await recordDrift(v.id, "d2", [], "snap2");
    expect(await prisma.notification.count({ where: { type: "drift" } })).toBe(0);
  });
});
```
- [x] **Step 2: Run (fail).**
- [x] **Step 3: Implement `recordDrift`** di `notifications.ts`:
```ts
import type { DriftItem } from "../vps/drift";
export async function recordDrift(vpsId: string, vpsName: string, drift: DriftItem[], snapshotId: string): Promise<void> {
  if (drift.length === 0) return;
  const ids = drift.map((d) => d.itemId);
  const shown = ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, +${ids.length - 5} lagi` : "");
  const title = `Drift di "${vpsName}": ${drift.length} item regresi (${shown})`;
  await prisma.notification.create({
    data: { type: "drift", key: `drift:${vpsId}:${snapshotId}`, title, projectId: null },
  }).catch(() => { /* P2002: sudah ada */ });
}
```
- [x] **Step 4: Integrasi `runAudit`** (`vps-audit.ts`): sebelum membuat snapshot baru, ambil snapshot terakhir (prev); setelah membuat snapshot baru, `computeDrift(prev.results, results)` → `recordDrift(v.id, vName, drift, snap.id)`. `AuditOk` tambah `drift`. Butuh `name` VPS — perluas `VpsRow` dgn `name: string` ATAU query nama. **Pilih**: query nama sekali di runAudit (`prisma.vps.findUnique select name`) agar `VpsRow` tak berubah (dipakai monitor). Kode:
```ts
// sebelum create snapshot:
const prevSnap = await prisma.vpsAuditSnapshot.findFirst({ where: { vpsId: v.id }, orderBy: { createdAt: "desc" } });
// ... buat snap (simpan hasil ke const snap = await prisma.vpsAuditSnapshot.create({...}))
const prevResults = (prevSnap?.results ?? {}) as Record<string, { status: string }>;
const drift = computeDrift(prevResults, results);
if (drift.length) {
  const row = await prisma.vps.findUnique({ where: { id: v.id }, select: { name: true } });
  await recordDrift(v.id, row?.name ?? v.id, drift, snap.id);
}
return { ok: true, audit, hardened, scoreTotal: scored.total, scoreBySection: scored.bySection, drift };
```
(`results` di sini = objek `{itemId:{status,detail}}` yang sudah dibangun; `computeDrift` hanya baca `.status`.)
- [x] **Step 5: Run (pass) + Commit.** Jalankan `vps-drift-notify.test.ts` + `vps.route.test.ts` (regresi runAudit). `git commit -m "feat(vps): drift di runAudit + Notification agregat (SPEC-221 AC-19)"`

### Task 4: ADR-0051 + docs

**Files:**
- Create: `internal/docs/adr/0051-vps-fase3-drift-applicability.md`
- Modify: `internal/docs/architecture/vps-compliance.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`

- [x] **Step 1:** Tulis ADR-0051 — status diterima · SPEC-221 · extends ADR-0050. Keputusan: (1) drift **derived** dari diff 2 snapshot terakhir (tanpa tabel), pass→{fail,warn}, bukan unknown; (2) Notification drift **agregat per-audit**, dedup per snapshot; (3) app-layer applicability **advisory** — deteksi stack disimpan `VpsAuditSnapshot.detected`, jadi saran N/A, **tak** auto-exclude skor (fleet dockerized rawan false-negative); (4) tanpa cron baru.
- [x] **Step 2:** `vps-compliance.md` — tambah bagian "Drift (Fase 3)" + "Applicability app-layer (advisory)".
- [x] **Step 3:** `data-model.md` — `VpsAuditSnapshot` tambah `detected?`.
- [x] **Step 4:** `api-contract.md` — `/audit` response `drift[]`; checklist item `drifted` + seksi `suggestion`; endpoint `na-bulk`.
- [x] **Step 5:** `README.md` — link ADR-0051. **Commit.** `git commit -m "docs(vps): ADR-0051 + Fase 3 di vps-compliance/data-model/api-contract (SPEC-221)"`

---

## PR2 — Deteksi stack + checklist (drifted + suggestion)

### Task 5: audit.sh emit STACK + parseStack + simpan detected

**Files:**
- Modify: `server/scripts/vps/audit.sh` (blok STACK)
- Modify: `server/src/services/vps-audit.ts` (`parseStack`, simpan `detected`)
- Modify: `server/test/vps-audit.test.ts` (test parseStack)
- Modify: `server/test/fixtures/fake-ssh.sh` (emit STACK di cabang audit)

- [ ] **Step 1:** Di `audit.sh`, setelah blok CHECK itemId, tambah deteksi stack app-layer:
```bash
# =============================== SPEC-221 · deteksi stack app-layer (advisory) ===============================
# STACK <section> <present|absent> <detail>. absent BUKAN bukti pasti (mis. layanan di Docker) — advisory.
has_cmd() { command -v "$1" >/dev/null 2>&1; }
# aaPanel
{ [ -d /www/server/panel ] || has_cmd bt; } && emit_stack aapanel present "aaPanel terdeteksi" || emit_stack aapanel absent "tak ada /www/server/panel"
# web server
if has_cmd nginx || has_cmd apache2 || has_cmd httpd || pgrep -x nginx >/dev/null 2>&1 || pgrep -x apache2 >/dev/null 2>&1 || pgrep -x httpd >/dev/null 2>&1; then
  emit_stack webserver present "nginx/apache terdeteksi"; else emit_stack webserver absent "tak ada nginx/apache (cek Docker manual)"; fi
# database
if has_cmd mysql || has_cmd mariadb || has_cmd psql || pgrep -x mysqld >/dev/null 2>&1 || pgrep -x postgres >/dev/null 2>&1 || ss -tlnH 2>/dev/null | grep -qE ':(3306|5432)\b'; then
  emit_stack database present "db terdeteksi"; else emit_stack database absent "tak ada mysql/postgres (cek Docker manual)"; fi
# ssl
if has_cmd certbot || [ -d /etc/letsencrypt/live ]; then emit_stack ssl present "certbot/letsencrypt"; else emit_stack ssl absent "tak ada certbot"; fi
```
Dan definisikan `emit_stack` di dekat `emit` (baris atas skrip): `emit_stack() { echo "STACK $1 $2 ${3:-}"; }`.
- [ ] **Step 2: Test parseStack** di `vps-audit.test.ts` (tambah describe):
```ts
import { parseStack } from "../src/services/vps-audit";
describe("parseStack (SPEC-221)", () => {
  it("parse STACK present/absent, abaikan noise", () => {
    const d = parseStack("STACK webserver absent tak ada\nSTACK database present db\nnoise\n");
    expect(d.webserver).toEqual({ present: false, detail: "tak ada" });
    expect(d.database).toEqual({ present: true, detail: "db" });
  });
});
```
- [ ] **Step 3: Run (fail).**
- [ ] **Step 4: Implement `parseStack`** di `vps-audit.ts`:
```ts
export function parseStack(out: string): Record<string, { present: boolean; detail: string }> {
  const d: Record<string, { present: boolean; detail: string }> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^STACK (\S+) (present|absent)(?: (.*))?$/);
    if (m) d[m[1]!] = { present: m[2] === "present", detail: (m[3] ?? "").trim() };
  }
  return d;
}
```
Lalu di `runAudit`: `const detected = parseStack(r.out);` dan simpan ke `prisma.vpsAuditSnapshot.create` data `detected: detected as unknown as Prisma.InputJsonValue`.
- [ ] **Step 5:** Update `fake-ssh.sh` cabang audit — tambah beberapa baris STACK sebelum `exit 0`:
```bash
  echo "STACK webserver absent tak ada nginx/apache"; echo "STACK database present postgres"
  echo "STACK aapanel absent"; echo "STACK ssl absent"
```
Jalankan `vps-audit.test.ts` + `bash -n audit.sh` → PASS. **Commit.** `git commit -m "feat(vps): audit emit STACK + parseStack + simpan detected (SPEC-221)"`

### Task 6: buildChecklist isi drifted + suggestion + DTO

**Files:**
- Modify: `shared/src/dto.ts` (`ChecklistItem.drifted`, `ChecklistSection.suggestion`)
- Modify: `server/src/vps/checklist.ts`
- Modify: `server/test/vps-checklist.route.test.ts`

**Interfaces (Produces):**
```ts
// ChecklistItem += drifted: boolean
// ChecklistSection += suggestion?: { applicable: boolean; detail: string }
```

- [ ] **Step 1: Test** di `vps-checklist.route.test.ts` (tambah): audit 2× dengan status berubah → item `drifted:true`; seksi app-layer dengan `detected.absent` → `suggestion.applicable:false`. (Fixture fake-ssh: buat mode agar audit kedua men-fail item yang tadinya pass — pakai `FAKE_SSH_MODE=audit-fail` di audit kedua; item `ssh-b3` pass→fail.)
```ts
it("audit kedua yang meregres → item drifted true (AC-19)", async () => {
  const v = await makeVps({ name: "dr1", host: "198.51.100.211" });
  await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` }); // ssh-b3 pass
  process.env.FAKE_SSH_MODE = "audit-fail";                              // ssh-b3 fail
  const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
  expect(res.json().drift.some((d: { itemId: string }) => d.itemId === "ssh-b3")).toBe(true);
  const cl = await app.inject({ url: `/api/vps/${v.id}/checklist` });
  const item = cl.json().sections.flatMap((s: { items: unknown[] }) => s.items).find((i: { id: string }) => i.id === "ssh-b3");
  expect(item.drifted).toBe(true);
});
it("seksi app-layer stack absent → suggestion applicable false", async () => {
  const v = await makeVps({ name: "dr2", host: "198.51.100.212" });
  await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
  const cl = await app.inject({ url: `/api/vps/${v.id}/checklist` });
  const ws = cl.json().sections.find((s: { id: string }) => s.id === "webserver");
  expect(ws.suggestion.applicable).toBe(false);
});
```
- [ ] **Step 2: Run (fail).**
- [ ] **Step 3: Implement** di `checklist.ts`: ambil **dua** snapshot terakhir (`findMany take:2 orderBy desc`); `computeDrift(prev.results, latest.results)` → set map `driftedIds`. Tiap item `drifted: driftedIds.has(c.id)`. Untuk tiap seksi app-layer (`SECTIONS` + katalog `appLayer`): `detected = latest.detected?.[sectionId]`; bila ada & `!present` → `suggestion: { applicable: false, detail }`. Tambah `drifted`/`suggestion` ke output. DTO shared diperbarui.
- [ ] **Step 4: Run (pass) + live curl** (boot server, audit 2× dgn perubahan, cek `drifted`/`suggestion`).
- [ ] **Step 5: Commit.** `git commit -m "feat(vps): checklist drifted + suggestion app-layer (SPEC-221 AC-19)"`

---

## PR3 — UI drift + banner saran + bulk N/A

### Task 7: Endpoint na-bulk

**Files:**
- Modify: `server/src/routes/vps.ts`, `shared/src/dto.ts` (`zMarkNaBulk`)
- Create: `server/test/vps-na-bulk.route.test.ts`

**Interfaces (Produces):** `POST /vps/:id/items/na-bulk { itemIds: string[], na: boolean, reason?: string }` → 200 `{ ok, count }`. Bila ada itemId asing dalam batch → **400** (tolak seluruh batch, jangan sebagian).

- [ ] **Step 1: Test**: bulk N/A 3 item → checklist ketiganya `na:true`; batch berisi itemId asing → 400 & tak ada yang berubah; batch kosong → 400.
- [ ] **Step 2: Run (fail).**
- [ ] **Step 3: Implement**: `zMarkNaBulk = z.object({ itemIds: z.array(z.string()).min(1).max(64), na: z.boolean(), reason: z.string().max(500).optional() })`. Handler: validasi semua `byId` (asing → 400), lalu `prisma.$transaction` upsert tiap item (`vpsId_itemId`), `actorEmail` dari `req.user`. Return `{ ok:true, count }`.
- [ ] **Step 4: Run (pass) + live curl.**
- [ ] **Step 5: Commit.** `git commit -m "feat(vps): endpoint na-bulk untuk tandai seksi N/A (SPEC-221)"`

### Task 8: UI — penanda drift + banner saran + bulk N/A

**Files:**
- Modify: `src/src/screens/VpsChecklist.tsx`, `src/src/api/client.ts`, `shared/src/api.ts` (path `vpsItemNaBulk`)
- Modify: `src/test/vps-checklist.test.tsx`

- [ ] **Step 1: Test** (viewport-aware): item `drifted:true` menampilkan penanda drift (mis. badge "drift"); seksi dengan `suggestion.applicable:false` menampilkan banner + tombol "Tandai seksi N/A" yang memanggil `api.markNaBulk(vpsId, itemIds, true, ...)`.
- [ ] **Step 2: Run (fail).**
- [ ] **Step 3: Implement**:
  - `shared/src/api.ts`: `vpsItemNaBulk: (id) => ${API}/vps/${id}/items/na-bulk`.
  - `client.ts`: `markNaBulk: (id, itemIds, na, reason?) => j<{ok;count}>(paths.vpsItemNaBulk(id), {method:"POST", ...body({itemIds,na,reason})})`.
  - `VpsChecklist.tsx`: (a) item `drifted` → badge "drift" (warna clay) di ItemRow; (b) ringkasan drift di header ("N item drift sejak audit sebelumnya") bila ada; (c) seksi app-layer dengan `suggestion?.applicable===false` → banner lembut + tombol "Tandai seksi N/A" → `api.markNaBulk(vpsId, s.items.map(i=>i.id), true, "app-layer: stack tak terdeteksi")` lalu reload.
- [ ] **Step 4: Run (pass).**
- [ ] **Step 5: Commit.** `git commit -m "feat(vps): UI penanda drift + banner saran app-layer + bulk N/A (SPEC-221 AC-19)"`

---

## Verifikasi akhir (sebelum selesai)

- [ ] Semua box `- [x]`.
- [ ] `env -u NODE_ENV -u DATABASE_URL pnpm test` hijau (semua paket).
- [ ] Typecheck 5 paket bersih.
- [ ] Live end-to-end: audit → audit-2 (drift muncul di response + Notification feed) → checklist (`drifted`/`suggestion`) → na-bulk (seksi jadi N/A) — semua sesuai kontrak.
- [ ] Docs tersentuh diperbarui + ter-link di `internal/docs/README.md`.
- [ ] Diff bersih; siap push.

## Coverage spec → task

AC-19 (drift+Notification): T2/T3 (core), T6 (UI drifted), T8 (badge). Applicability advisory: T5 (deteksi), T6 (suggestion), T7/T8 (bulk N/A UI). AC-24 (skema): T1. AC-18/AC-20 (tanpa cron): dipertahankan (drift on-audit, tak ada scheduler baru). AC-21 (skrip deterministik): T5.
