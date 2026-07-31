# SPEC-384 — Hapus `hanoman-sdk`, error monitoring, cross-audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mencabut tiga blok fitur yang sudah digantikan Uptrace — paket npm `hanoman-sdk`, seluruh error monitoring (ingest DSN → grouping → symbolication → eskalasi → scheduler source `errors`), dan cross-audit lintas project — dari kode, skema DB, API, dashboard, dan docs, tanpa menyisakan kode mati, tabel yatim, atau doc yang menunjuk fitur mati.

**Architecture:** Penghapusan berlapis dari daun ke akar. Konsumen dulu (web, runner), lalu server, lalu tipe bersama (`shared`), lalu skema + migration, terakhir docs. Urutan ini menjaga tiap task tetap bisa di-typecheck sendiri: menghapus tipe bersama lebih dulu akan meruntuhkan semua paket sekaligus dan menyembunyikan apa yang sebenarnya rusak.

**Tech Stack:** TypeScript strict · Fastify · Prisma 6 + SQLite · React 18 + Vite · Vitest · pnpm workspace.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-spec-384-hapus-sdk-errors-crossaudit-design.md` — baca sebelum mulai.
- **Nomor ADR baru: 0092.** Enumerasi ulang lintas semua branch **dan** `git worktree list` tepat sebelum push; worktree tetangga (`spec-431`, `spec-432`) berbagi base commit yang sama dan bisa merebut nomornya.
- **Test WAJIB `--no-file-parallelism`** untuk set apa pun yang menyentuh test server — test server berbagi satu berkas DB per checkout.
- **Migration ditulis TANGAN** lalu `prisma migrate deploy`. **Jangan** `prisma migrate dev`: worktree tetangga menimbulkan drift dan `migrate dev` akan me-*reset* DB.
- **Sesudah schema berubah:** `pnpm --filter ./server exec prisma generate` wajib, kalau tidak `prisma.<model>` jadi `undefined` dan puluhan test gagal palsu.
- **`support:*` capability BERTAHAN** — tiket Help Center masih ada. Hanya label/desc-nya yang kehilangan kata "Errors".
- **Yang TIDAK boleh tersentuh:** `Ticket`, `TicketAttachment`, triase, flow `audit` satu-project, ADR-0076 (eskalasi audit dinamis), scheduler source `backlog` & `triase`, governor, panel scheduler.
- **Bahasa komentar & docs: Indonesia**, mengikuti gaya berkas di sekitarnya.
- Commit per task. Pesan commit berbahasa Indonesia, prefix `feat(384):` / `refactor(384):` / `docs(384):` / `chore(384):`.

---

## File Structure

**Dihapus seluruhnya (30 berkas + 1 direktori paket):**

| Path | Blok |
|---|---|
| `sdk/**` (paket workspace) | SDK |
| `server/src/routes/errors.ts` · `ingest.ts` | errors |
| `server/src/services/error-ingest.ts` · `error-fingerprint.ts` · `error-fingerprint.test.ts` · `error-escalate.ts` | errors |
| `server/src/services/sourcemap-store.ts` · `sourcemap-store.test.ts` · `symbolicate.ts` · `symbolicate.test.ts` | errors |
| `server/src/services/ingest-key.ts` · `ingest-key.test.ts` | errors |
| `server/src/services/scheduler/sources/errors.ts` | errors |
| `server/src/routes/audit.ts` · `server/src/services/cross-audit.ts` · `audit-scope.ts` · `project-links.ts` | cross-audit |
| `src/src/screens/ErrorsScreen.tsx` · `IntegrationGuideModal.tsx` · `ProjectLinksCard.tsx` | web |
| `server/test/{error-ingest,errors.route,errors-escalate.route,ingest.route,sourcemaps.route,projects-ingest-key.route,scheduler-source-errors,audit-logs.route,cross-audit-session,project-links.route,project-links.service}.test.ts` | test |
| `src/test/{errors-screen,notifications-error,project-links-card}.test.tsx` · `shared/test/dto-symbolication.test.ts` · `runner/test/cross-audit-prompt.test.ts` | test |
| `internal/docs/adr/0060-…md` · `0063-…md` · `0070-…md` · `0075-…md` · `docs/prd/log-error-monitoring.md` | docs |
| 10 berkas arsip di `docs/superpowers/{specs,plans}` | docs |

**Dibuat:**

| Path | Tanggung jawab |
|---|---|
| `server/prisma/migrations/20260731000000_drop_errors_sdk_crossaudit/migration.sql` | drop tabel + kolom + pembersihan baris enum |
| `server/test/errors-gone.route.test.ts` | membuktikan permukaan HTTP-nya benar-benar 404 |
| `server/test/schema-drop.test.ts` | membuktikan tabel & kolom benar-benar hilang dari berkas DB |
| `internal/docs/adr/0092-cabut-error-monitoring-sdk-cross-audit.md` | ADR pencabutan |

**Disunting:** `server/src/{app,server}.ts`, `routes/{projects,terminal,specs}.ts`, `services/{pty,session-launch,notifications,sync,rename-project,ticket}.ts`, `shared/src/{dto,enums,api,agent,session-kind}.ts`, `src/src/{App.tsx,api/client.ts}`, `src/src/screens/{ProjectDetailScreen,SchedulerScreen,BacklogScreen,TriageScreen}.tsx`, `runner/src/{types,prompt}.ts`, `cli/src/commands/migrate-pg.ts`, `server/prisma/schema.prisma`, `pnpm-workspace.yaml`, `vitest.workspace.ts`, dan 15 berkas docs.

---

## Task 1: Cabut paket `hanoman-sdk`

**Files:**
- Delete: `sdk/` (seluruh direktori)
- Modify: `pnpm-workspace.yaml`, `vitest.workspace.ts`

**Interfaces:**
- Consumes: —
- Produces: tak ada anggota workspace `sdk`. Task 2 menghapus satu-satunya pembacanya (`GET /api/errors/integration-guide` yang membaca `sdk/README.md`).

- [ ] **Step 1: Konfirmasi tak ada import lintas-paket ke `sdk`**

```bash
git grep -n "@hanoman/sdk\|hanoman-sdk" -- server src shared runner cli
```
Expected: hanya kecocokan di `docs/**`, `internal/docs/**`, dan `server/test/project-links.service.test.ts` (string biasa, bukan import). Tak boleh ada `import … from` ke paket ini.

- [ ] **Step 2: Hapus direktori paket**

```bash
git rm -r -q sdk
```

- [ ] **Step 3: Keluarkan dari workspace**

`pnpm-workspace.yaml` — baris `packages:`:

```yaml
packages: [ "shared", "server", "src", "cli", "runner", "!dist-npm" ]   # dist-npm = staging rilis, BUKAN anggota workspace (ADR-0087)
```

`vitest.workspace.ts` — buang entri `"sdk"` dari daftar project.

- [ ] **Step 4: Regenerasi lockfile**

```bash
pnpm install --lockfile-only
```
Expected: `pnpm-lock.yaml` berubah, tanpa error.

- [ ] **Step 5: Verifikasi tak ada sisa**

```bash
git grep -n "\"sdk\"\|'sdk'\|/sdk/" -- pnpm-workspace.yaml vitest.workspace.ts package.json
```
Expected: nol keluaran.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(384): cabut paket hanoman-sdk dari workspace"
```

---

## Task 2: Cabut permukaan HTTP & service error monitoring (server)

**Files:**
- Delete: `server/src/routes/errors.ts`, `server/src/routes/ingest.ts`
- Delete: `server/src/services/{error-ingest,error-fingerprint,error-fingerprint.test,error-escalate,sourcemap-store,sourcemap-store.test,symbolicate,symbolicate.test,ingest-key,ingest-key.test}.ts`
- Delete: `server/src/services/scheduler/sources/errors.ts`
- Delete: `server/test/{error-ingest,errors.route,errors-escalate.route,ingest.route,sourcemaps.route,projects-ingest-key,scheduler-source-errors}.test.ts` (nama tepat: `projects-ingest-key.route.test.ts`)
- Create: `server/test/errors-gone.route.test.ts`
- Modify: `server/src/app.ts`, `server/src/server.ts`, `server/src/routes/projects.ts`, `server/src/services/notifications.ts`, `server/src/services/sync.ts`

**Interfaces:**
- Consumes: —
- Produces: tak ada lagi `prisma.errorGroup` / `prisma.errorEvent` / `prisma.sourceMapArtifact` di `server/src/**` kecuali `routes/audit.ts` (dihapus Task 3). Task 7 mengandalkan itu sebelum menghapus model dari skema.

- [ ] **Step 1: Tulis test yang gagal — permukaannya harus 404**

Buat `server/test/errors-gone.route.test.ts`. Ikuti pola boot app yang dipakai `server/test/errors.route.test.ts` yang lama (baca dulu sebelum menghapusnya) agar helper-nya sama.

```ts
// SPEC-384 · permukaan error monitoring dicabut. Test ini menjaga dua kegagalan senyap:
// (1) route yang lupa dihapus, (2) pengecualian gate `/api/ingest` yang tertinggal di app.ts —
// prefix yatim meloloskan request tanpa cookie ke router lalu menjawab 401/404 dari lapisan yang
// salah, dan bedanya tak kelihatan tanpa assert eksplisit.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await prisma.project.upsert({
    where: { id: "p-gone" },
    create: { id: "p-gone", name: "Gone", desc: "", kind: "app" },
    update: {},
  });
});
afterAll(async () => { await app.close(); });

describe("SPEC-384 · permukaan errors dicabut", () => {
  it("POST /api/ingest/:slug 404 — tanpa auth apa pun", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/ingest/p-gone?key=apa-saja",
      payload: { type: "Error", message: "x", environment: "production" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /api/ingest/:slug/sourcemaps 404", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/ingest/p-gone/sourcemaps?key=apa-saja",
      payload: { release: "1", artifacts: [] },
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /api/errors 401 — tak ada pengecualian gate, jatuh ke auth normal", async () => {
    const r = await app.inject({ method: "GET", url: "/api/errors" });
    expect(r.statusCode).toBe(401);
  });

  it("GET /api/projects/:id/ingest-key 401 — endpoint DSN hilang", async () => {
    const r = await app.inject({ method: "GET", url: "/api/projects/p-gone/ingest-key" });
    expect(r.statusCode).toBe(401);
  });
});
```

Catatan kenapa 404 vs 401 beda: `/api/ingest` **di-bypass** gate, jadi selama prefix bypass-nya masih ada, request tanpa cookie sampai ke router dan menjawab 404 — sama seperti sesudah dicabut. Karena itu assert 404-nya dipasangkan dengan Step 4 yang mencabut prefix-nya; nilai test ini adalah menahan route agar tak pernah kembali. `/api/errors` dan `/api/projects/:id/ingest-key` **tak** di-bypass → tanpa cookie jawabannya 401 dari gate, apakah route-nya ada atau tidak. Keduanya diuji supaya regresi "route dihidupkan lagi" tetap tertangkap oleh Step 8 (`git grep`), dan test ini menjaga kontrak permukaannya.

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
cd server && ./node_modules/.bin/vitest run --no-file-parallelism test/errors-gone.route.test.ts
```
Expected: FAIL — `POST /api/ingest/p-gone` menjawab **401** (`unauthorized`, dari `verifyKey`), bukan 404.

- [ ] **Step 3: Hapus route + service**

```bash
git rm -q server/src/routes/errors.ts server/src/routes/ingest.ts \
  server/src/services/error-ingest.ts server/src/services/error-fingerprint.ts \
  server/src/services/error-fingerprint.test.ts server/src/services/error-escalate.ts \
  server/src/services/sourcemap-store.ts server/src/services/sourcemap-store.test.ts \
  server/src/services/symbolicate.ts server/src/services/symbolicate.test.ts \
  server/src/services/ingest-key.ts server/src/services/ingest-key.test.ts \
  server/src/services/scheduler/sources/errors.ts \
  server/test/error-ingest.test.ts server/test/errors.route.test.ts \
  server/test/errors-escalate.route.test.ts server/test/ingest.route.test.ts \
  server/test/sourcemaps.route.test.ts server/test/projects-ingest-key.route.test.ts \
  server/test/scheduler-source-errors.test.ts
```

- [ ] **Step 4: Cabut wiring di `server/src/app.ts`**

Hapus: `import ingest from "./routes/ingest";`, `import errors from "./routes/errors";`, baris `await api.register(ingest);`, `await api.register(errors);`, dan **pengecualian gate**:

```ts
        // SPEC-249 · ADR-0060 · ingest error dipanggil project eksternal tanpa sesi login;
        // route /api/ingest di-otorisasi DSN per-project sendiri (pengecualian sah gate).
        if (path.startsWith("/api/ingest")) return;
```

- [ ] **Step 5: Cabut registrasi scheduler source di `server/src/server.ts`**

Hapus `import { registerErrorsSource } from "./services/scheduler/sources/errors";` dan baris `registerErrorsSource();`.

- [ ] **Step 6: Cabut endpoint DSN di `server/src/routes/projects.ts`**

Hapus import `generateIngestKey, dsnUrl`, ketiga handler `/projects/:id/ingest-key` (GET/POST/DELETE), dan field `dsnUrl` pada respons rename. Blok rename jadi:

```ts
    const p = await prisma.project.findUnique({ where: { id: newId } });
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    return {
      id: newId,
      helpUrl: p?.helpEnabled ? `${base}/help/${encodeURIComponent(newId)}` : undefined,
      affected: r.affected,
    };
```

Perbarui juga komentar di atasnya yang menyebut DSN:

```ts
  // SPEC-255 · ADR-0064 · rename slug project. Terpisah dari PATCH: efek samping besar (cascade FK +
  // ref longgar + LocalBinding + rambat sync) & guard sendiri (id baru bebas, tak ada sesi aktif).
  // Help URL (/help/<id>) derived → path baru dikembalikan sebagai hint.
```

- [ ] **Step 7: Cabut notifikasi & sync**

`server/src/services/notifications.ts` — hapus fungsi `recordNewErrorGroup()` beserta komentar SPEC-249 di atasnya.

`server/src/services/sync.ts` — `errorGroup` keluar dari empat tempat:

```ts
export const SYNCED = ["project", "spec", "vps", "sessionResult", "ticket", "ticketAttachment"] as const;
```

hapus baris `errorGroup: prisma.errorGroup as unknown as Delegate,` dari `DELEGATE`, baris `errorGroup: [...]` dari `FIELDS` (beserta komentar SPEC-268 di atasnya), dan `errorGroup: [...]` dari peta kolom tanggal. Perbarui komentar berkas di baris 7:

```ts
// SPEC-268 · ADR-0066 · ticket masuk record-sync (metadata tiket). SPEC-384 · errorGroup dicabut
// bersama error monitoring — record kind ini tak lagi dikenal `isSynced()`.
```

- [ ] **Step 8: Sesuaikan test server yang menyinggung (bukan menguji) errors**

```bash
git grep -n "errorGroup\|ingestKey\|monitoringEnabled\|recordNewErrorGroup" -- server/test
```

Untuk tiap kecocokan, hapus case/fixture errors-nya — **bukan** berkasnya:
`sync.service.test.ts`, `sync-notify.test.ts` (record `errorGroup`), `agent-capabilities.test.ts`
(label capability `support`), `rename-project.service.test.ts` (assert `dsnUrl`).

`server/test/sync-exclusions.test.ts` **diperluas** — tambahkan:

```ts
  // SPEC-384 · errorGroup dicabut dari record-sync bersama error monitoring. Klien versi lama
  // bisa saja masih mendorongnya; yang benar adalah menolaknya sebagai kind tak dikenal.
  it("errorGroup bukan lagi entity ter-sync", () => {
    expect(isSynced("errorGroup")).toBe(false);
    expect(isSynced("ticket")).toBe(true);   // kontrol negatif: tiket tetap tersync
  });
```

- [ ] **Step 9: Verifikasi tak ada rujukan tersisa (selain `routes/audit.ts`)**

```bash
git grep -n "errorGroup\|errorEvent\|sourceMapArtifact\|ingestKey\|symbolicate\|recordNewErrorGroup" -- server/src | grep -v "routes/audit.ts"
```
Expected: nol keluaran.

- [ ] **Step 10: Jalankan test baru & yang disesuaikan — harus lulus**

```bash
cd server && ./node_modules/.bin/vitest run --no-file-parallelism \
  test/errors-gone.route.test.ts test/sync-exclusions.test.ts test/sync.service.test.ts \
  test/sync-notify.test.ts test/agent-capabilities.test.ts test/rename-project.service.test.ts
```
Expected: semua PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "refactor(384): cabut route, service, dan scheduler source error monitoring"
```

---

## Task 3: Cabut cross-audit (server)

**Files:**
- Delete: `server/src/routes/audit.ts`, `server/src/services/{cross-audit,audit-scope,project-links}.ts`
- Delete: `server/test/{audit-logs.route,cross-audit-session,project-links.route,project-links.service}.test.ts`
- Modify: `server/src/app.ts`, `server/src/routes/{projects,terminal,specs}.ts`, `server/src/services/{pty,session-launch}.ts`
- Test: `server/test/pty.test.ts`, `server/test/prd-from-audit.route.test.ts` (sesuaikan)

**Interfaces:**
- Consumes: Task 2 (tak ada lagi konsumen error di server selain berkas yang dihapus di sini).
- Produces: tak ada lagi `prisma.projectLink`, `auditSessionScope`, `buildCrossAuditCtx`, `crossAuditSessionOpts`, `linksOf`, `linkViews` di mana pun. `sessionKind()` tak lagi mengembalikan `"cross-audit"`.

- [ ] **Step 1: Hapus berkas**

```bash
git rm -q server/src/routes/audit.ts server/src/services/cross-audit.ts \
  server/src/services/audit-scope.ts server/src/services/project-links.ts \
  server/test/audit-logs.route.test.ts server/test/cross-audit-session.test.ts \
  server/test/project-links.route.test.ts server/test/project-links.service.test.ts
```

- [ ] **Step 2: Cabut wiring di `server/src/app.ts`**

Hapus `import audit from "./routes/audit";`, `import { auditScopeFromReq } from "./services/audit-scope";`, `await api.register(audit);`, dan pengecualian gate:

```ts
        // SPEC-337 · ADR-0075 · sesi cross-audit milik hanoman sendiri memanggil /api/audit tanpa
        // cookie; diotorisasi kunci per-sesi yang hidup di tmux (mati bersama pane). Read-only &
        // ber-scope — cermin pengecualian /api/ingest. Kunci tak cocok → jatuh ke auth normal.
        if (path.startsWith("/api/audit/") && auditScopeFromReq(req)) return;
```

- [ ] **Step 3: Cabut endpoint ProjectLink di `server/src/routes/projects.ts`**

Hapus `import { linksOf, linkViews } from "../services/project-links";` dan ketiga handler `/projects/:id/links` (GET, POST, DELETE `/:linkId`).

- [ ] **Step 4: Cabut cabang flow di `terminal.ts` dan `session-launch.ts`**

`server/src/routes/terminal.ts` — hapus import `buildCrossAuditCtx, crossAuditSessionOpts` dan seluruh blok `if (parsed.data.flow === "cross-audit") { … }`.

`server/src/services/session-launch.ts` — hapus import `buildCrossAuditCtx, crossAuditSessionOpts` dan `startCrossAuditPrompt`, lalu ganti blok:

```ts
  const scopeEnv: Record<string, string> = { HANOMAN_BASE_SHA: baseSha, HANOMAN_VERIFY_SCOPE: verifyScope };
  let extra: { audit?: { key: string; projects: string[] }; env?: Record<string, string> } = {};
  if (opts.flow === "cross-audit") {
    const built = await buildCrossAuditCtx(spec.projectId);
    if (built) {
      prompt = startCrossAuditPrompt(
        { ...built.ctx, worktree, spec: brief, branchTo }, "backlog");
      extra = crossAuditSessionOpts(built.scope);
    }
  }
```

menjadi:

```ts
  const scopeEnv: Record<string, string> = { HANOMAN_BASE_SHA: baseSha, HANOMAN_VERIFY_SCOPE: verifyScope };
```

lalu hapus penyebaran `...extra` di `createSession(...)`. Perbarui komentar SPEC-337 di atas `resumeCtx` — hapus kalimat cross-audit-nya.

- [ ] **Step 5: Cabut kunci audit di `server/src/services/pty.ts`**

Empat titik:

1. Tipe `Pane` — hapus `auditKey?: string; auditProjects?: string;` dan komentar SPEC-337 di atasnya.
2. Parser `listPanes()` — hapus `auditKey, auditProjects` dari destructuring `line.split("\t")` **dan** dua field yang mengisinya di objek hasil. **Penting:** juga hapus dua field-nya dari format string `tmux list-panes -F` di fungsi yang sama, kalau tidak jumlah kolom dan destructuring jadi tak sinkron dan field lain bergeser diam-diam.
3. Fungsi `auditSessionScope()` — hapus seluruhnya beserta komentar SPEC-337.
4. `sessionKind()` — hapus baris `if (o.id.startsWith("xaudit-")) return "cross-audit";`.
5. `CreateOpts`/`createSession` — hapus opsi `audit` bila ada, dan perbarui komentar `// SPEC-337 · env sesi cross-audit (HANOMAN_AUDIT_KEY/URL) lewat jalur yang sama.` menjadi `// Env tambahan dari pemanggil lewat jalur yang sama.`

- [ ] **Step 6: Cabut label sumber di `server/src/routes/specs.ts`**

Hapus cabang `: b.source === "cross-audit" ? \`Audit lintas · ${author}\`` dari rantai ternary label.

- [ ] **Step 7: Sesuaikan test yang menyinggung**

```bash
git grep -n "cross-audit\|crossAudit\|projectLink\|auditKey\|xaudit" -- server/test
```
Untuk tiap kecocokan: hapus case/assertion cross-audit-nya (bukan seluruh berkasnya). `server/test/pty.test.ts` menguji `sessionKind` — hapus case `xaudit-`. `server/test/prd-from-audit.route.test.ts` — hapus fixture bersumber `cross-audit`.

- [ ] **Step 8: Verifikasi**

```bash
git grep -n "cross-audit\|crossAudit\|projectLink\|linksOf\|auditSessionScope\|auditScopeFromReq" -- server
```
Expected: nol keluaran.

- [ ] **Step 9: Jalankan test server yang tersentuh**

```bash
cd server && ./node_modules/.bin/vitest run --no-file-parallelism test/pty.test.ts test/prd-from-audit.route.test.ts test/errors-gone.route.test.ts
```
Expected: semua PASS. (`pty.test.ts` bisa gagal 1–3 test karena sesi tmux bocor dari run lain — jalankan ulang sekali sebelum menganggapnya regresi.)

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor(384): cabut cross-audit dari server (route, service, pty, flow)"
```

---

## Task 4: Cabut ketiganya dari dashboard (web)

**Files:**
- Delete: `src/src/screens/{ErrorsScreen,IntegrationGuideModal,ProjectLinksCard}.tsx`
- Delete: `src/test/{errors-screen.test.tsx,notifications-error.test.tsx,project-links-card.test.tsx}`
- Modify: `src/src/App.tsx`, `src/src/api/client.ts`, `src/src/screens/{ProjectDetailScreen,SchedulerScreen,BacklogScreen,TriageScreen}.tsx`
- Test: `src/test/audit-escalation.test.tsx` (sesuaikan)

**Interfaces:**
- Consumes: Task 2 & 3 (endpoint-nya sudah tak ada).
- Produces: tipe `Flow` di `src/src/api/client.ts` tanpa `"cross-audit"`; tak ada section `errors` di navigasi.

- [ ] **Step 1: Hapus layar & test-nya**

```bash
git rm -q src/src/screens/ErrorsScreen.tsx src/src/screens/IntegrationGuideModal.tsx \
  src/src/screens/ProjectLinksCard.tsx \
  src/test/errors-screen.test.tsx src/test/notifications-error.test.tsx \
  src/test/project-links-card.test.tsx
```

- [ ] **Step 2: Cabut dari `src/src/api/client.ts`**

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal";
```

Hapus method `crossAudit(...)`, `getIntegrationGuide()`, dan semua method errors/DSN (`listErrors`, `getError`, `escalateError`, `unlinkError`, `patchError`, `getIngestKey`, `createIngestKey`, `deleteIngestKey`, `listProjectLinks`, `addProjectLink`, `deleteProjectLink` — nama persis dibaca dari berkasnya). Perbarui komentar SPEC-362 di baris ~251 agar tak lagi menyebut `cross-audit`.

- [ ] **Step 3: Cabut dari `src/src/App.tsx`**

Hapus `import { ErrorsScreen }`, seluruh cabang `} else if (section === "errors") { … }`, entri navigasi `errors` di `Shell`, opsi cross-audit di `StartSessionModal` (termasuk teks penjelas `"Audit lintas melihat project ini BESERTA project yang berelasi…"`), dan baris peringatan DSN di dialog rename:

```ts
          `• DSN error monitoring berubah jadi /api/ingest/${newId} — perbarui kode project.\n` +
```

Perbarui komentar di sekitar baris 577 dan 662 yang menyebut Errors/DSN.

- [ ] **Step 4: Cabut kartu DSN & kartu Integrasi di `src/src/screens/ProjectDetailScreen.tsx`**

Hapus import `IntegrationGuideModal` dan `ProjectLinksCard`, komponen kartu DSN (`<Card eyebrow="error monitoring" title="DSN ingest" …>` beserta state `prefix`/`enabled`/`rotate`/`revoke`), dan pemakaian `<ProjectLinksCard …/>`.

- [ ] **Step 5: Cabut panel source `errors` di `src/src/screens/SchedulerScreen.tsx`**

Hapus entri source `errors` (label, cadence, `minCount`) dari daftar source yang dirender.

- [ ] **Step 6: Cabut label sumber `cross-audit` di Backlog & Triase**

`BacklogScreen.tsx` dan `TriageScreen.tsx` — hapus cabang label/ikon untuk `source === "cross-audit"`.

- [ ] **Step 7: Sesuaikan `src/test/audit-escalation.test.tsx`**

Hapus case yang memakai `cross-audit`; sisakan yang menguji `audit` satu-project.

- [ ] **Step 8: Verifikasi**

```bash
git grep -n "cross-audit\|crossAudit\|ErrorsScreen\|IntegrationGuide\|ProjectLinksCard\|ingest-key\|ingestKey" -- src
```
Expected: nol keluaran.

- [ ] **Step 9: Jalankan test web yang tersentuh**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src/test audit-escalation
```
Expected: PASS. (`env -u NODE_ENV` wajib — `NODE_ENV=production` di shell ini membuat React menolak `act` dan seluruh test web gagal palsu.)

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor(384): cabut area Errors, DSN, panduan SDK, dan cross-audit dari dashboard"
```

---

## Task 5: Cabut cross-audit dari runner

**Files:**
- Modify: `runner/src/types.ts`, `runner/src/prompt.ts`
- Delete: `runner/test/cross-audit-prompt.test.ts`
- Test: `runner/test/types.test.ts`, `runner/test/escalation-prompt.test.ts` (sesuaikan)

**Interfaces:**
- Consumes: Task 3 (`session-launch.ts` sudah tak memanggil `startCrossAuditPrompt`).
- Produces: `Flow` di `runner/src/types.ts` tanpa `"cross-audit"`; `PIPELINES` tanpa kunci `"cross-audit"`.

- [ ] **Step 1: Hapus test prompt**

```bash
git rm -q runner/test/cross-audit-prompt.test.ts
```

- [ ] **Step 2: Cabut tipe**

`runner/src/types.ts`:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal";
```

Hapus `export type CrossAuditProject = { … }` dan `export type CrossAuditCtx = { … }`.

- [ ] **Step 3: Cabut prompt**

`runner/src/prompt.ts` — hapus dari daftar import tipe `CrossAuditCtx, CrossAuditProject`, entri `"cross-audit": ["Audit", "Laporan"],` di `PIPELINES`, fungsi `projectLine()`, `crossAuditLogGuide()`, dan `startCrossAuditPrompt()`. Perbarui dua komentar yang mendaftar flow dokumen (baris ~189 dan ~347) agar tak lagi menyebut `cross-audit`.

- [ ] **Step 4: Sesuaikan test**

```bash
git grep -n "cross-audit\|CrossAudit" -- runner/test
```
Hapus case cross-audit di `types.test.ts` dan `escalation-prompt.test.ts`.

- [ ] **Step 5: Verifikasi & jalankan**

```bash
git grep -n "cross-audit\|CrossAudit" -- runner
./node_modules/.bin/vitest run --dir runner/test
```
Expected: grep nol keluaran; test PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(384): cabut flow dan prompt cross-audit dari runner"
```

---

## Task 6: Cabut tipe bersama (`shared`)

**Files:**
- Modify: `shared/src/{dto,enums,api,agent,session-kind}.ts`
- Delete: `shared/test/dto-symbolication.test.ts`
- Test: `shared/test/enums.test.ts`, `shared/src/session-kind.test.ts` (sesuaikan)

**Interfaces:**
- Consumes: Task 2–5 (semua konsumen sudah dihapus).
- Produces: `zFlow` & `zSpecSource` tanpa `cross-audit`; tipe `Notification` tanpa `"error"`; config scheduler tanpa `sources.errors`. Task 7 mengandalkan `zSpecSource` yang sudah menyempit saat menormalkan baris DB.

- [ ] **Step 1: Hapus test symbolication**

```bash
git rm -q shared/test/dto-symbolication.test.ts
```

- [ ] **Step 2: Cabut dari `shared/src/dto.ts`**

Hapus schema: `zStackFrame`, `zSymbolicatedFrame`, `zSourceMapUpload`, `zIngestPayload`, `zErrorGroupView`, `zErrorEventView`, `zErrorGroupDetail`, `zIngestKeyView` (+ tipe turunannya), dan blok komentar SPEC-249/SPEC-276 di atasnya.

Hapus field: `monitoringEnabled` & `ingestKeyPrefix` dari view project, `minCount` dari filter daftar, `fromErrorGroup` dari payload spec.

`zFlow` jadi:

```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "goal"]);
```

Hapus cabang `: source === "cross-audit" ? "cross-audit"` di peta sumber→flow, komentar SPEC-337 di atasnya, dan varian body sesi `z.object({ project: z.string(), flow: z.literal("cross-audit") })`.

Hapus `zErrorStatus` dari daftar import di baris 5.

- [ ] **Step 3: Cabut dari `shared/src/enums.ts`**

Hapus `export const zErrorStatus = …` (baris 12). `zSpecSource` jadi:

```ts
// SPEC-253 · +help (tiket → backlog) · SPEC-384 · −cross-audit (dicabut bersama error monitoring)
export const zSpecSource = z.enum(["brief","qa","audit","help","goal"]);
```

Hapus `errors: z.object({ … })` dari config scheduler `sources`. Tipe notifikasi jadi:

```ts
  // SPEC-253 · +ticket; SPEC-298 · +fail (sesi scheduler gagal/limit); SPEC-384 · −error
  type: z.enum(["done", "decision", "ticket", "fail", "lead"]).default("done"),
```

- [ ] **Step 4: Cabut dari `shared/src/api.ts`**

Hapus blok path: `ingest`, `errors`, `errorsGuide`, `error`, `errorEscalate`, `errorUnlink`, `projectIngestKey`, dan path ProjectLink bila ada.

- [ ] **Step 5: Perbarui label capability di `shared/src/agent.ts`**

`support:*` **tetap ada**; ganti teksnya:

```ts
  { id: "support:read", domain: "support", access: "read", label: "Tiket — baca", desc: "Lihat tiket Help Center." },
  { id: "support:write", domain: "support", access: "write", label: "Tiket — tulis", desc: "Terima/tolak tiket, ubah status." },
```

dan domain-nya:

```ts
  { domain: "support", label: "Help Desk", desc: "Tiket Help Center (Help Desk): lihat, terima/tolak, promosikan ke backlog." },
```

Perbarui juga komentar SPEC-264 di atas `CAPABILITY_DOMAINS` yang menyebut "PRD/Errors".

- [ ] **Step 6: Cabut dari `shared/src/session-kind.ts`**

Hapus `"cross-audit"` dari daftar kind, dari peta label (`"cross-audit": "Audit lintas",`), dan dari daftar kind project-level di baris ~29.

- [ ] **Step 7: Sesuaikan test**

`shared/src/session-kind.test.ts` dan `shared/test/enums.test.ts` — hapus `"cross-audit"` dari array ekspektasi.

- [ ] **Step 8: Verifikasi & jalankan**

```bash
git grep -n "cross-audit\|zErrorStatus\|zIngestPayload\|monitoringEnabled\|ingestKeyPrefix\|fromErrorGroup" -- shared
./node_modules/.bin/vitest run --dir shared
```
Expected: grep nol keluaran; test PASS.

- [ ] **Step 9: Typecheck tiga paket konsumen**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck
```
Expected: nol error. Perbaiki sisa rujukan yang muncul di sini sebelum lanjut.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor(384): cabut tipe errors, DSN, dan cross-audit dari shared"
```

---

## Task 7: Skema Prisma + migration + CLI

**Files:**
- Modify: `server/prisma/schema.prisma`, `cli/src/commands/migrate-pg.ts`
- Create: `server/prisma/migrations/20260731000000_drop_errors_sdk_crossaudit/migration.sql`
- Create: `server/test/schema-drop.test.ts`

**Interfaces:**
- Consumes: Task 2, 3, 6 (tak ada lagi kode yang menyentuh model-model ini).
- Produces: berkas DB tanpa `ErrorGroup`, `ErrorEvent`, `SourceMapArtifact`, `ProjectLink`, dan `Project` tanpa `ingestKeyHash`/`ingestKeyPrefix`.

- [ ] **Step 1: Tulis test yang gagal — skema harus bersih**

Buat `server/test/schema-drop.test.ts`:

```ts
// SPEC-384 · migration drop diverifikasi terhadap BERKAS DB, bukan terhadap schema.prisma.
// Skema Prisma yang sudah bersih tak membuktikan apa pun kalau migration.sql-nya tak pernah
// jalan — dan `migrate deploy` yang gagal separuh justru meninggalkan keadaan campuran itu.
import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";

const tableNames = async (): Promise<string[]> => {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table'");
  return rows.map((r) => r.name);
};

describe("SPEC-384 · tabel & kolom dicabut dari berkas DB", () => {
  it("empat tabel hilang", async () => {
    const names = await tableNames();
    for (const t of ["ErrorGroup", "ErrorEvent", "SourceMapArtifact", "ProjectLink"])
      expect(names).not.toContain(t);
  });

  it("Project tak lagi punya kolom DSN", async () => {
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(
      "PRAGMA table_info('Project')");
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("ingestKeyHash");
    expect(names).not.toContain("ingestKeyPrefix");
    expect(names).toContain("helpEnabled");   // kontrol negatif: kolom lain selamat
  });
});
```

- [ ] **Step 2: Jalankan — harus gagal**

```bash
cd server && ./node_modules/.bin/vitest run --no-file-parallelism test/schema-drop.test.ts
```
Expected: FAIL — tabel masih ada.

- [ ] **Step 3: Catat `storageKey` source-map sebelum tabelnya hilang**

```bash
node -e '
const { PrismaClient } = require("@prisma/client");
new PrismaClient().sourceMapArtifact.findMany({ select: { storageKey: true } })
  .then((r) => console.log(r.map((x) => x.storageKey).join("\n")))
  .catch(() => console.log("(tabel kosong / DB dev tak punya baris)"));
'
```
Simpan keluarannya. Byte-nya hidup di `uploadDir()` **bersama lampiran tiket** — jangan pernah menghapus direktorinya; hapus tepat berkas-berkas ini saja. Di DB dev biasanya kosong; langkah yang sama ditulis sebagai runbook prod di Task 8.

- [ ] **Step 4: Cabut model dari `server/prisma/schema.prisma`**

Hapus `model ErrorGroup`, `model ErrorEvent`, `model SourceMapArtifact`, `model ProjectLink` beserta komentarnya. Dari `model Project` hapus:

```prisma
  ingestKeyHash   String? // SPEC-249 · sha256(ingest key) hex; null = monitoring off. TAK PERNAH ke client.
  ingestKeyPrefix String? // SPEC-249 · ~12-16 char awal key untuk hint UI (bukan rahasia)
  errorGroups ErrorGroup[]
  sourceMaps  SourceMapArtifact[] // SPEC-276 · source-map ter-upload per release (symbolication)
  linksOut    ProjectLink[] @relation("ProjectLinkFrom") // SPEC-337 · project ini bergantung pada …
  linksIn     ProjectLink[] @relation("ProjectLinkTo")   // SPEC-337 · … yang bergantung pada project ini
```

Perbarui komentar `SchedulerQueueItem.source`:

```prisma
  source     String    // backlog | triase (asal checker) — SPEC-384 · `errors` dicabut
```

Perbarui komentar `LeadDecision` yang menyebut "sesi VPS/cross-audit" menjadi "sesi VPS".

- [ ] **Step 5: Tulis migration**

`server/prisma/migrations/20260731000000_drop_errors_sdk_crossaudit/migration.sql`:

```sql
-- SPEC-384 · ADR-0092 · cabut error monitoring (SPEC-249/254/269/271/276/296) dan cross-audit
-- (SPEC-337). Sumber pemantauan error pindah ke Uptrace; data di bawah ini tak punya pembaca lagi.
-- DESTRUKTIF & tak bisa dibatalkan.

PRAGMA foreign_keys=OFF;

-- 1. Tabel. ErrorEvent dulu (FK → ErrorGroup).
DROP TABLE IF EXISTS "ErrorEvent";
DROP TABLE IF EXISTS "SourceMapArtifact";
DROP TABLE IF EXISTS "ErrorGroup";
DROP TABLE IF EXISTS "ProjectLink";

-- 2. Project kehilangan kolom DSN. Table rebuild (pola Prisma untuk SQLite) — bukan DROP COLUMN,
--    yang tak tersedia di semua versi SQLite yang mungkin membawa berkas DB ini.
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repoDir" TEXT,
    "gitRemote" TEXT,
    "stack" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "helpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "schedulerOptIn" BOOLEAN NOT NULL DEFAULT false,
    "leadOptIn" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Project" ("id","name","desc","kind","repoDir","gitRemote","stack","createdAt","version","updatedAt","helpEnabled","schedulerOptIn","leadOptIn")
SELECT "id","name","desc","kind","repoDir","gitRemote","stack","createdAt","version","updatedAt","helpEnabled","schedulerOptIn","leadOptIn" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";

-- 3. Baris yang nilainya tak lagi sah menurut zod. Dibiarkan hidup, ia akan menggagalkan
--    pembacaan daftar notifikasi / backlog dengan galat parse, bukan dengan pesan yang berguna.
DELETE FROM "Notification" WHERE "type" = 'error';
UPDATE "Spec" SET "source" = 'audit' WHERE "source" = 'cross-audit';
DELETE FROM "SyncLog" WHERE "entity" = 'errorGroup';
DELETE FROM "SyncOutbox" WHERE "entity" = 'errorGroup';
DELETE FROM "SyncConflict" WHERE "entity" = 'errorGroup';
DELETE FROM "SchedulerQueueItem" WHERE "source" = 'errors';

PRAGMA foreign_keys=ON;
```

**Sebelum commit:** cocokkan daftar kolom `new_Project` dengan `model Project` hasil Step 4 satu per satu. Kolom yang terlewat di `INSERT … SELECT` hilang **tanpa error** — kegagalan senyap paling mahal di task ini.

- [ ] **Step 6: Terapkan & regenerasi client**

```bash
cd server && pnpm exec prisma migrate deploy && pnpm exec prisma generate
```
Expected: `1 migration applied`, lalu `Generated Prisma Client`.

- [ ] **Step 7: Jalankan test skema — harus lulus**

```bash
cd server && ./node_modules/.bin/vitest run --no-file-parallelism test/schema-drop.test.ts
```
Expected: 2 passed.

- [ ] **Step 8: Cabut model dari `cli/src/commands/migrate-pg.ts`**

Hapus `"ErrorGroup"`, `"ErrorEvent"`, `"SourceMapArtifact"`, dan `"ProjectLink"` dari daftar model (baris ~23).

- [ ] **Step 9: Verifikasi & typecheck**

```bash
git grep -n "ErrorGroup\|ErrorEvent\|SourceMapArtifact\|ProjectLink\|ingestKeyHash" -- server/src server/prisma/schema.prisma cli/src shared/src src/src runner/src
pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck
```
Expected: grep nol keluaran; typecheck nol error.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(384): migration drop tabel errors, source-map, dan ProjectLink"
```

---

## Task 8: Docs & ADR

**Files:**
- Delete: `internal/docs/adr/{0060-error-monitoring-ingest-ber-dsn,0063-hanoman-sdk-npm-package,0070-symbolication-source-map-server-side,0075-audit-lintas-project-projectlink-kunci-sesi}.md`
- Delete: `docs/prd/log-error-monitoring.md`
- Delete: 10 berkas arsip `docs/superpowers/{specs,plans}` (daftar di Step 3)
- Create: `internal/docs/adr/0092-cabut-error-monitoring-sdk-cross-audit.md`
- Rewrite: `internal/docs/adr/0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md`
- Modify: `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/architecture/{api-contract,data-model}.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/requirements/{frd,rd}.md`, `internal/docs/security/security-standard.md`, `internal/docs/operations/{gtm,release-npm}.md`, `internal/docs/research/market-sizing.md`, `internal/skills/hanoman/SKILL.md`, `docs/agent-integration.md`, dan ADR 0062/0064/0065/0076/0078/0083/0087

**Interfaces:**
- Consumes: Task 1–7 (semua kode sudah hilang; docs mengikuti keadaan akhir).
- Produces: nol tautan menggantung di `internal/docs/**`.

- [ ] **Step 1: Kunci nomor ADR**

```bash
for r in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree -r --name-only "$r" -- internal/docs/adr 2>/dev/null; done | grep -oE '^internal/docs/adr/[0-9]{4}' | sort -u | tail -3
git worktree list
for w in ../spec-*; do ls "$w/internal/docs/adr" 2>/dev/null | tail -2; done
```
Expected: tertinggi `0091` → pakai **0092**. Kalau worktree tetangga sudah memakai 0092, naik ke nomor bebas berikutnya dan ganti seluruh rujukan `0092` di plan & spec ini.

- [ ] **Step 2: Tulis ADR-0092**

`internal/docs/adr/0092-cabut-error-monitoring-sdk-cross-audit.md`. Ikuti struktur ADR yang ada di repo (Status · Terkait · Konteks · Keputusan · Konsekuensi · Alternatif ditolak). Isi wajib:

- **Status:** Diterima · 2026-07-31 · SPEC-384.
- **Mencabut:** 0060, 0063, 0070, 0075 (berkasnya **dihapus** atas perintah eksplisit manusia — catat penyimpangan dari konvensi "ADR usang tidak dihapus" berikut alasannya). **Mengamandemen:** 0066 (bagian errors dicabut; tiket & pemicu sync manual tetap).
- **Konteks:** pemantauan error produksi pindah ke Uptrace; dua sumber kebenaran = ambiguitas.
- **Keputusan:** tiga blok dicabut utuh; daftar permukaan yang hilang (`POST /api/ingest/:slug`, `/sourcemaps`, `GET/PATCH /api/errors*`, `/api/projects/:id/ingest-key`, `/api/projects/:id/links`, `/api/audit/logs*`).
- **Kenapa cross-audit ikut:** `/api/audit/logs` hanya membaca `ErrorEvent`/`ErrorGroup`; seluruh mekanisme kunci `hnm_xa_…` ada semata untuk menggerbanginya. Tanpa sumber data, flow-nya kehilangan pembedanya dari `audit` biasa.
- **Konsekuensi:** data error prod hilang permanen; klien sync versi lama yang mendorong `errorGroup` ditolak `isSynced()`; `Spec` bersumber `cross-audit` dinormalkan ke `audit`.
- **Gotcha yang wajib tercatat:** byte `.map` berbagi `uploadDir()` dengan lampiran tiket dan bernama opaque `<uuid>.map` — menghapus direktorinya akan ikut menghapus lampiran tiket; pembersihan harus memakai daftar `storageKey` yang dibaca **sebelum** tabel di-drop.
- **Alternatif ditolak:** menyisakan endpoint kosong (kode mati), menyisakan tabel tanpa model (drift skema).

- [ ] **Step 3: Hapus berkas docs**

```bash
git rm -q internal/docs/adr/0060-error-monitoring-ingest-ber-dsn.md \
  internal/docs/adr/0063-hanoman-sdk-npm-package.md \
  internal/docs/adr/0070-symbolication-source-map-server-side.md \
  internal/docs/adr/0075-audit-lintas-project-projectlink-kunci-sesi.md \
  docs/prd/log-error-monitoring.md \
  docs/superpowers/specs/2026-07-20-hanoman-sdk-npm-design.md \
  docs/superpowers/plans/2026-07-20-hanoman-sdk-npm.md \
  docs/superpowers/specs/2026-07-20-log-error-monitoring-design.md \
  docs/superpowers/plans/2026-07-20-log-error-monitoring.md \
  docs/superpowers/specs/2026-07-21-spec-269-edit-delete-errors-triase-design.md \
  docs/superpowers/plans/2026-07-21-spec-269-edit-delete-errors-triase.md \
  docs/superpowers/specs/2026-07-21-spec-276-source-map-symbolication-design.md \
  docs/superpowers/plans/2026-07-21-spec-276-source-map-symbolication.md \
  docs/superpowers/specs/2026-07-22-spec-296-source-checker-errors-design.md \
  docs/superpowers/plans/2026-07-22-scheduler-errors-source-spec-296.md \
  docs/superpowers/specs/2026-07-27-spec-337-cross-project-audit-agent-design.md \
  docs/superpowers/plans/2026-07-27-cross-project-audit-agent-spec-337.md
```

- [ ] **Step 4: Tulis ulang ADR-0066**

Judul & isi jadi tiket Help Center + pemicu sync manual saja. Ganti judul berkas-nya di index menjadi *"Ticket masuk record-sync (publish asal-hub) + pemicu sync manual"*. Hapus rujukan ke ADR-0060, kalimat tentang `ErrorGroup` asal-DSN, dan tabel/paragraf khusus errors. Tambahkan satu baris di bagian Status: *"SPEC-384 · bagian errors dicabut bersama error monitoring (ADR-0092); keputusan tiket & pemicu manual tetap berlaku."* Nama berkasnya **tidak** diganti (tautan dari ADR lain tetap hidup).

- [ ] **Step 5: Perbarui index `internal/docs/README.md`**

- Hapus baris integrasi SDK di bagian `integrasi` (baris ~36).
- Hapus empat baris ADR 0060/0063/0070/0075.
- Perbarui judul baris 0066.
- Tambah di puncak daftar ADR:

```markdown
- [0092 — Cabut error monitoring, `hanoman-sdk`, dan cross-audit (pindah ke Uptrace)](adr/0092-cabut-error-monitoring-sdk-cross-audit.md)
```

- [ ] **Step 6: Perbarui narasi `internal/docs/adr/README.md`**

Hapus entri naratif 0060, 0063, 0070, 0075. Perbarui entri 0066, dan bersihkan sebutan ADR yang dihapus dari entri 0064, 0087, dan entri lain yang menyinggungnya. Tambah entri naratif 0092.

- [ ] **Step 7: Bersihkan doc SoT lain**

Untuk tiap berkas, hapus bagian/kalimat yang menjelaskan errors/SDK/cross-audit:

- `architecture/api-contract.md` — blok "Error monitoring", DSN ingest key, source-map upload, catatan SDK, dan endpoint `/audit/logs` + `/projects/:id/links`.
- `architecture/data-model.md` — bagian `ErrorGroup / ErrorEvent / SourceMapArtifact`, `ProjectLink`, dan field `ingestKeyHash`/`ingestKeyPrefix` di `Project`.
- `frontend/frontend-implementation.md` — bagian "Error monitoring — area Errors + DSN", panduan SDK, kartu Integrasi.
- `requirements/frd.md`, `requirements/rd.md` — requirement error monitoring & cross-audit.
- `security/security-standard.md` — pengecualian gate `/api/ingest` dan kunci audit.
- `operations/gtm.md`, `research/market-sizing.md` — klaim `hanoman-sdk` di npm.
- `internal/skills/hanoman/SKILL.md` — sebutan errors/SDK/cross-audit.
- `docs/agent-integration.md` — contoh & capability yang menyebut errors.

Lalu bersihkan lintas-referensi di ADR yang **tetap hidup**: 0062, 0064, 0065, 0076, 0078, 0083, 0087 — ganti tautan `[ADR-0060](…)`/`[ADR-0063](…)`/`[ADR-0070](…)`/`[ADR-0075](…)` yang kini menggantung dengan rujukan ke ADR-0092 atau hapus klausanya, sesuai konteks kalimatnya.

- [ ] **Step 8: Tulis prosedur pencabutan npm**

Tambahkan bagian di `internal/docs/operations/release-npm.md`:

```markdown
## Mencabut `hanoman-sdk` dari npm (SPEC-384 · ADR-0092)

Paket `hanoman-sdk` dicabut bersama error monitoring. Menghapus `sdk/` dari repo **tidak**
mencabutnya dari registry — selama masih terbit, orang bisa `npm i hanoman-sdk` dan mendapat SDK
yang tak punya server tujuan. Tindakan manusia (akun ber-2FA), bukan bagian dari sesi agen:

```bash
# 1. Coba unpublish. npm hanya mengizinkannya dalam 72 jam sejak publish; `hanoman-sdk@0.1.0`
#    terbit 2026-07-21, jadi ini kemungkinan besar DITOLAK. Jalankan tetap — kalau berhasil, selesai.
npm unpublish hanoman-sdk --force --otp=<kode>

# 2. Ditolak karena lewat jendela → deprecate. Ini jalur yang sebenarnya diharapkan.
npm deprecate hanoman-sdk "Dicabut (SPEC-384). Pemantauan error hanoman pindah ke Uptrace; paket ini tak punya server tujuan lagi." --otp=<kode>
```

Verifikasi: `npm view hanoman-sdk` — `deprecated` terisi, atau paket 404 bila unpublish berhasil.
```

- [ ] **Step 9: Tulis runbook pembersihan byte source-map**

Tambahkan di `internal/docs/operations/production.md` (atau `deploy-vps.md` bila lebih cocok dengan runbook prod yang ada):

```markdown
## SPEC-384 · membersihkan byte source-map (sekali, sebelum migrate)

`SourceMapArtifact` menyimpan byte `.map` di `HANOMAN_UPLOAD_DIR` dengan nama opaque `<uuid>.map`
— **direktori yang sama dengan lampiran tiket**. Jangan pernah menghapus direktorinya. Baca daftar
`storageKey` **sebelum** `prisma migrate deploy`, lalu hapus tepat berkas-berkas itu:

```bash
sqlite3 "$HANOMAN_HOME/hanoman.db" "SELECT storageKey FROM SourceMapArtifact" > /tmp/maps.txt
while read -r k; do rm -f "$HANOMAN_UPLOAD_DIR/$k"; done < /tmp/maps.txt
```

Melewatkannya hanya menyisakan byte inert — tak ada yang rusak, cuma disk terpakai.
```

- [ ] **Step 10: Verifikasi tak ada tautan menggantung**

```bash
git grep -n "0060-error-monitoring\|0063-hanoman-sdk\|0070-symbolication\|0075-audit-lintas\|log-error-monitoring.md\|sdk/README" -- internal docs
git grep -ni "hanoman-sdk\|error monitoring\|cross-audit\|ingest key\|DSN" -- internal/docs internal/skills docs/agent-integration.md
```
Expected: kecocokan **hanya** di `internal/docs/adr/0092-…md`, `internal/docs/adr/README.md` (narasi 0092), dan `internal/docs/operations/release-npm.md` (prosedur pencabutan) — semuanya menjelaskan pencabutannya, bukan fiturnya.

- [ ] **Step 11: Cek integritas index**

```bash
node cli/dist/hanoman.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/hanoman.js docs index --check
```
Expected: index konsisten (tak ada doc tak ter-link, tak ada link ke berkas yang hilang).

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "docs(384): cabut docs errors, SDK, dan cross-audit; ADR-0092"
```

---

## Task 9: Verifikasi akhir

**Files:** —

**Interfaces:**
- Consumes: Task 1–8.
- Produces: bukti hijau untuk klaim selesai.

- [ ] **Step 1: Typecheck seluruh paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && \
pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck && pnpm --filter ./src typecheck
```
Expected: nol error. Dijalankan berurutan (`&&`), bukan `pnpm -r` — satu proses tsc pada satu waktu.

Scope diperluas melebihi `--changed` dengan sengaja: perubahan ini menyentuh tipe bersama, skema Prisma, dan berkas yang diimpor banyak modul — kasus "berdampak luas" yang secara eksplisit diizinkan ADR-0080.

- [ ] **Step 2: Test per paket**

```bash
./node_modules/.bin/vitest run --dir shared
./node_modules/.bin/vitest run --dir runner/test
env -u NODE_ENV ./node_modules/.bin/vitest run --dir src/test
cd server && ./node_modules/.bin/vitest run --no-file-parallelism
```
Expected: semua PASS. `--no-file-parallelism` wajib untuk server (satu berkas DB dibagi semua test di paket itu). Bila `pty.test.ts` gagal 1–3 test, jalankan ulang sekali — sesi tmux bocor dari run lain memberi gagal palsu.

- [ ] **Step 3: Boot server & curl permukaan yang dicabut**

```bash
cd server && node dist/server.js &   # atau `pnpm dev` bila dist belum dibangun
sleep 3
curl -s -o /dev/null -w "ingest=%{http_code}\n"  -X POST localhost:8787/api/ingest/apa-saja
curl -s -o /dev/null -w "errors=%{http_code}\n"       localhost:8787/api/errors
curl -s -o /dev/null -w "audit=%{http_code}\n"        localhost:8787/api/audit/logs
curl -s -o /dev/null -w "health=%{http_code}\n"       localhost:8787/api/health
```
Expected: `ingest=404`, `errors=401`, `audit=401`, `health=200`. Health 200 adalah kontrol negatif — membuktikan server memang hidup dan 404/401 di atas bukan karena server mati.

Matikan **per-PID**, jangan pernah `pkill -f`:

```bash
lsof -ti:8787 | xargs -r kill
```

- [ ] **Step 4: Centang seluruh checkbox plan ini**

Semua `- [ ]` di berkas ini jadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

- [ ] **Step 5: Commit akhir & push**

```bash
git add -A && git commit -m "chore(384): centang plan SPEC-384"
git push origin HEAD:refs/heads/hanoman/spec-384
```
