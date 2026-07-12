# Audit Remediation — Bug, Performa, Keamanan (SPEC-197) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup 19 temuan audit (P1–P3: bug korektness, performa event-loop, keamanan) di runner/server/frontend/shared, dan **mencabut guardrail `safety.ts` sepenuhnya** (keputusan user — agen dipercaya penuh; didokumentasikan di ADR-0037).

**Architecture:** Setiap fix diterapkan di **akar** (fungsi bersama yang dilewati semua caller), bukan di tiap pemanggil. Tiga kelas dominan: (1) hapus IO sinkron `spawnSync`/`execFileSync` dari request path → `execFile` async + timeout (pola yang sudah dipakai `scan.ts`/`git-ide.ts`/`spec-review.ts`); (2) stabilkan referensi state frontend supaya poll tak meledakkan re-render + request; (3) hardening lifecycle server (unhandled rejection, graceful shutdown, TOCTOU). Nol dependency baru, nol migrasi skema.

**Tech Stack:** Server Node+TS (Fastify, Prisma, tmux via `pty.ts`, node-pty, Vitest). Runner TS. Client React+TS (Vite), Vitest + @testing-library/react. Shared TS dep-free.

## Global Constraints

- TypeScript strict; **test untuk setiap logika orkestrasi** yang diubah (CLAUDE.md). Fix murni config/wiring diverifikasi lewat boot+curl nyata, bukan unit test.
- **Setiap task ditutup verifikasi nyata di local** (CLAUDE.md): boot server (`env -u NODE_ENV -u DATABASE_URL node server/dist/server.js` atau `pnpm dev`) + curl endpoint tersentuh, atau `pnpm --filter <pkg> build && node ...` untuk runner/cli. Jangan hanya andalkan unit test.
- Jalankan test dengan env bersih: `env -u NODE_ENV -u DATABASE_URL pnpm ...` (shell sesi bisa menunjuk prod — memory `hanoman-shell-env-points-at-prod`).
- Test server = `vitest run --no-file-parallelism` (memory `hanoman-prisma-generate-after-merge`); `hanoman_test` butuh `prisma migrate deploy` sendiri (memory `hanoman-test-db-needs-separate-migrate`).
- **Update `internal/docs` yang tersentuh dalam commit yang sama** (Source of Truth by konvensi, SPEC-160). Task 1 wajib menyentuh ADR-0010 + security-standard.
- Reuse yang ada — jangan bikin util/abstraksi baru (ponytail/YAGNI). Pola async git sudah ada di `services/scan.ts` (`listRepoDocs`) dan `services/git-ide.ts`.
- Fix perf tak boleh mengubah kontrak API (bentuk respons tetap) kecuali disebut eksplisit.
- Commit per task (frequent commits). Pesan commit `fix(area): … (SPEC-197)`.
- Repo dipakai sesi Claude lain secara paralel (memory `hanoman-shared-main-worktree`): **jangan `git stash`, jangan `git add -A`** — `git add` hanya path yang task ini sentuh.

---

### Task 1: Cabut guardrail `safety.ts` sepenuhnya + ADR-0037

Menyelesaikan temuan **#1 (`rm -rf` bypass)** dan **#9 (push-main false pos/neg)** dengan menghapus guardrail, bukan menambalnya. Keputusan user: agen dipercaya penuh, termasuk spawn worktree sendiri. Guard `git worktree add` (invarian orkestrasi) ikut dicabut — konsekuensinya (worktree yatim, commit tak ter-push) dicatat di ADR-0037.

**PENTING:** hook `Notification`/`UserPromptSubmit` di `guardSettings` (marker keputusan SPEC-184) **TETAP** — yang dilepas hanya hook `PreToolUse` Bash.

**Files:**
- Delete: `runner/src/safety.ts`
- Delete: `runner/test/safety.test.ts`
- Delete: `cli/src/commands/hook-pretooluse.ts`
- Modify: `runner/src/index.ts:6` (buang `export * from "./safety"`)
- Modify: `runner/src/settings.ts:9-24` (drop param `guardCommand` + hook `PreToolUse`)
- Modify: `runner/test/settings.test.ts` (signature baru, buang assert PreToolUse)
- Modify: `server/src/services/pty.ts:7,145` + comment `136-138`
- Modify: `server/src/runner/deps.ts` (buang `guardCommand` + `resolveCliEntry`; `repoRoot`/`repoRootFrom` tetap)
- Modify: `cli/src/router.ts:8,14,23` (buang dispatch + HELP `hook pretooluse`)
- Create: `internal/docs/adr/0037-cabut-guardrail-safety.md`
- Modify: `internal/docs/adr/0010-runner-spawns-claude-cli.md`, `internal/docs/security/security-standard.md` (guardrail last-gate tak berlaku lagi)

**Interfaces:**
- Produces: `guardSettings(decisionFile?: string): { hooks: Record<string, unknown[]> }` (satu argumen sekarang).

- [ ] **Step 1: Ubah `runner/src/settings.ts` — hapus hook PreToolUse & param guardCommand**

```ts
export const guardSettings = (decisionFile?: string) => {
  const hooks: Record<string, unknown[]> = {};
  // SPEC-184 · sinyal "menunggu keputusan manusia" dari Claude sendiri. Notification idle/izin/
  // agent_needs_input menandai marker; UserPromptSubmit (manusia menjawab) mengosongkannya.
  // Path dikutip-single agar aman terhadap spasi. ponytail: path dengan single-quote tak didukung
  // (bagian variabel hanya <sessionId> = [a-z0-9_-]); naikkan bila repoDir bisa memuat "'".
  if (decisionFile) {
    const f = `'${decisionFile.split("'").join("'\\''")}'`;
    hooks.Notification = [{ hooks: [{ type: "command",
      command: `grep -qiE 'idle|permission|waiting for|needs.?input' && echo waiting >> ${f} || true` }] }];
    hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: `: > ${f}` }] }];
  }
  return { hooks };
};
```
Buang komentar blok lama di atasnya yang menyebut PreToolUse sebagai satu-satunya gerbang (ADR-0010) — sudah tak akurat.

- [ ] **Step 2: Update `runner/test/settings.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { guardSettings } from "../src/settings";

describe("guardSettings", () => {
  it("tanpa decisionFile: tak ada hook (guardrail dicabut, ADR-0037)", () => {
    expect(guardSettings().hooks).toEqual({});
  });
  it("dengan decisionFile: Notification + UserPromptSubmit menunjuk berkasnya", () => {
    const s = guardSettings("/repo/.worktrees/.decisions/sess1") as any;
    expect(Object.keys(s.hooks).sort()).toEqual(["Notification", "UserPromptSubmit"]);
    expect(s.hooks.Notification[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
    expect(s.hooks.Notification[0].hooks[0].command).toMatch(/grep/);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/repo/.worktrees/.decisions/sess1");
  });
});
```

- [ ] **Step 3: Hapus file guardrail**

```bash
git rm runner/src/safety.ts runner/test/safety.test.ts cli/src/commands/hook-pretooluse.ts
```

- [ ] **Step 4: `runner/src/index.ts` — buang re-export safety**

Hapus baris 6 `export * from "./safety";`.

- [ ] **Step 5: `server/src/services/pty.ts` — panggil guardSettings tanpa guardCommand**

Baris 7: hapus `import { guardCommand } from "../runner/deps";`.
Baris 145 di `createSession`:
```ts
    "--settings", JSON.stringify(guardSettings(opts.decisionFile)),
```
Perbarui komentar `136-138` (yang menyebut PreToolUse gerbang terakhir) → catat bahwa sejak ADR-0037 sesi jalan tanpa deny hook sama sekali; `--settings` kini hanya memasang marker keputusan.

- [ ] **Step 6: `server/src/runner/deps.ts` — buang guardCommand + resolveCliEntry**

Hapus `resolveCliEntry` dan `guardCommand` (baris ~18-21) beserta komentar yang menyebut hook PreToolUse. Pertahankan `repoRootFrom` + `repoRoot` (dipakai VPS). `existsSync`/`dirname`/`join` masih dipakai `repoRootFrom` → biarkan import.

- [ ] **Step 7: `cli/src/router.ts` — buang perintah hook pretooluse**

Hapus baris 23 (`if (group === "hook" && sub === "pretooluse") …`), baris 14 di `HELP` (`hook pretooluse …`), dan sesuaikan komentar baris 8 (buang kalimat "`hook pretooluse` TETAP …").

- [ ] **Step 8: Tulis `internal/docs/adr/0037-cabut-guardrail-safety.md`** (isi lengkap ada di bagian "ADR-0037" di bawah plan ini). Update ADR-0010 + security-standard.md: tambahkan catatan "Diperbarui SPEC-197/ADR-0037: hook PreToolUse deny dicabut; tak ada lagi gerbang deny perintah — agen dipercaya penuh." Grep sisa klaim basi: `grep -rln "PreToolUse\|deniesDangerous\|skip-permissions" internal/docs` dan rapikan yang menyebut guardrail deny masih ada.

- [ ] **Step 9: Build + verifikasi runner/cli & boot server**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner --filter @hanoman/cli --filter @hanoman/server build
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner test
node -e "const {guardSettings}=require('./runner/dist/settings.js'); console.log(JSON.stringify(guardSettings('/x')))"
```
Expected: build hijau, test hijau, output memuat `Notification`+`UserPromptSubmit`, **tanpa** `PreToolUse`. Boot server, buka satu sesi terminal dari UI, konfirmasi sesi lahir normal (settings tanpa PreToolUse tak bikin claude gagal start).

- [ ] **Step 10: Commit**

```bash
git add runner/src/settings.ts runner/src/index.ts runner/test/settings.test.ts \
  server/src/services/pty.ts server/src/runner/deps.ts cli/src/router.ts \
  internal/docs/adr/0037-cabut-guardrail-safety.md internal/docs/adr/0010-runner-spawns-claude-cli.md \
  internal/docs/security/security-standard.md
git commit -m "feat(safety): cabut guardrail PreToolUse sepenuhnya, agen dipercaya penuh (SPEC-197, ADR-0037)"
```

---

### Task 2: `server.ts` — handler unhandledRejection + graceful shutdown

Temuan **#2**: tak ada `process.on("unhandledRejection")`, `.catch()` di `listen()`, atau SIGTERM/SIGINT. `healthSweep()` (`void`, tiap 5 menit) yang `findMany()`-nya bisa reject → orchestrator mati. Fix akar: handler proses global + tutup app rapi + jaga sweep.

**Files:**
- Modify: `server/src/server.ts`
- Modify: `server/src/services/vps-monitor.ts:9-16` (bungkus sweep supaya `void` tak jadi unhandled)

- [ ] **Step 1: `server/src/services/vps-monitor.ts` — jaga sweep dari reject**

```ts
export async function healthSweep(): Promise<void> {
  try { for (const v of await prisma.vps.findMany()) await runHealth(v).catch(() => {}); }
  catch { /* DB kedip: skip sweep ini, jangan jatuhkan proses */ }
}
```
Terapkan pola `try { … } catch {}` yang sama pada `auditSweep` (bungkus `await prisma.vps.findMany()` loop-nya).

- [ ] **Step 2: `server/src/server.ts` — handler proses + shutdown**

```ts
import { buildApp } from "./app";
import { prisma } from "./db";
import { startVpsMonitor } from "./services/vps-monitor";

const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

// Jangan biarkan satu promise yatim (mis. sweep monitor saat DB kedip) menjatuhkan orchestrator.
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

// Tutup rapi: lepas klien tmux (onClose → detachAll, app.ts) lalu putus Prisma. Sesi claude
// selamat — hidup di tmux server, bukan proses ini (ADR-0016).
async function shutdown(sig: string) {
  console.log(`${sig} — menutup`);
  try { await app.close(); await prisma.$disconnect(); } finally { process.exit(0); }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

app.listen({ port, host }).then(() => {
  console.log(`hanoman api ${host}:${port}`);
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
}).catch((err) => { console.error("listen gagal:", err); process.exit(1); });
```
Pertahankan komentar bind-127.0.0.1 yang sudah ada.

- [ ] **Step 3: Verifikasi**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server build
env -u NODE_ENV -u DATABASE_URL node server/dist/server.js &   # boot
curl -s localhost:8787/api/health   # cek hidup
kill -TERM %1    # cek log "SIGTERM — menutup" lalu exit 0, bukan gantung
```
Expected: health 200, SIGTERM men-trigger shutdown log dan proses keluar bersih. Simulasi reject: sementara set `DATABASE_URL` ke DB mati, boot, tunggu >5 menit sweep pertama → proses **tetap hidup** (error ter-log, tak crash). (ponytail: cukup verifikasi handler terpasang; tak perlu test unit untuk wiring proses.)

- [ ] **Step 4: Commit** — `git add server/src/server.ts server/src/services/vps-monitor.ts && git commit -m "fix(server): handler unhandledRejection + graceful shutdown, jaga sweep monitor (SPEC-197)"`

---

### Task 3: `integrate.ts` — async execFile + timeout (buang spawnSync dari request path)

Temuan **#3**: `integrate()` (dipanggil `POST /specs/:id/integrate`) pakai `spawnSync` untuk `git fetch origin` + `push` tanpa timeout → memblok event loop; origin lambat/auth-prompt → hang tak terbatas. Ubah ke `execFile` promisified dengan `timeout`.

**Files:**
- Modify: `server/src/services/integrate.ts` (semua helper `sh`/`ok`/`out` → async; `integrate`/`runFinalize`/`worktreeForBranch` jadi async)
- Modify: `server/src/routes/specs.ts:163` (`await integrate(...)`)
- Modify: `server/test/*integrate*` bila ada (sesuaikan `await`)

**Interfaces:**
- Produces: `integrate(repoDir, specId, op, target): Promise<IntegrateResult>` (async sekarang).

- [ ] **Step 1: Ganti primitif sinkron jadi async di `integrate.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rmSync } from "node:fs";
import { join } from "node:path";
const exec = promisify(execFile);

// 60s cukup untuk fetch+merge+push repo normal; melewati itu = origin menggantung / auth prompt →
// gagalkan, jangan memblok. maxBuffer besar: diff/porcelain bisa panjang.
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };
const sh = (cwd: string, args: string[]) =>
  exec("git", args, { cwd, ...GIT }).then(
    (r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) =>
      ({ status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));
const ok = async (cwd: string, args: string[]) => (await sh(cwd, args)).status === 0;
const out = async (cwd: string, args: string[]) => (await sh(cwd, args)).stdout.trim();
```

- [ ] **Step 2: Jadikan fungsi turunan async & `await` semua panggilan**

Ubah `refExists`, `worktreeForBranch`, `resolveSource`, `resolveTarget`, `reclaim`, `integrate`, `runFinalize` jadi `async` dan `await` tiap `sh`/`ok`/`out`. Contoh titik kritis (baris 70, 77-78, 84, 93-96):
```ts
  await sh(repoDir, ["fetch", "origin"]); // best-effort; abaikan gagal/offline
  ...
  const baseSha = await out(repoDir, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (!(await ok(repoDir, ["worktree", "add", "--detach", "-q", wt, baseSha])))
    return { status: "error", code: 500, error: "gagal membuat worktree integrasi" };
  ...
  const run = await sh(wt, cmd);
  ...
  if (run.status === 0) {
    const fin = await runFinalize(wt, repoDir, finalize);
    await sh(repoDir, ["worktree", "remove", "--force", wt]);
    return fin.ok ? { status: "clean", detail: fin.detail } : { status: "error", code: 409, error: fin.error };
  }
```
`finalizeInstruction` tetap sinkron (murni string).

- [ ] **Step 3: `server/src/routes/specs.ts:163` — await**

```ts
    const r = await integrate(spec.project.repoDir, spec.id, parsed.data.op, parsed.data.target);
```

- [ ] **Step 4: Test — merge clean tetap jalan async**

Jika sudah ada `server/test/integrate.test.ts`, tambahkan `await` di pemanggilan; jalankan. Jika belum ada test yang menyentuh `integrate`, tulis satu yang mem-setup dua branch di repo tmp dan meng-assert `(await integrate(...)).status === "clean"`. Jalankan:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism integrate
```

- [ ] **Step 5: Verifikasi nyata** — boot server, `POST /specs/:id/integrate` untuk spec done (via UI merge), konfirmasi respons datang & event loop tak beku (buka terminal lain saat merge jalan). Expected: `{status:"clean"|"conflict"}` tanpa server freeze.

- [ ] **Step 6: Commit** — `git add server/src/services/integrate.ts server/src/routes/specs.ts server/test/ && git commit -m "fix(integrate): git async + timeout, buang spawnSync dari request path (SPEC-197)"`

---

### Task 4: `pty.ts` — poll pakai `Pane` yang sudah ada (buang re-scan tmux N×)

Temuan **#4**: loop poll 500ms sudah punya `Pane p` (dengan `flow`+`phaseFile`), tapi `pollPhases(id)` → `sessionPhases(id)` → `getSession(id)` → `listPanes()` lagi. K terminal = 1+K spawn `tmux list-panes` sinkron tiap 500ms.

**Files:**
- Modify: `server/src/services/pty.ts:241-262`

- [ ] **Step 1: `pollPhases` terima `Pane`, baca fase langsung**

```ts
function pollPhases(p: Pane, a: Attachment): void {
  if (!p.flow || !p.phaseFile) return;
  const phases = readPhases(p.phaseFile, p.flow);
  const json = JSON.stringify(phases);
  if (json === a.lastPhases) return;
  a.lastPhases = json;
  broadcast(a, { t: "phase", phases });
}
```

- [ ] **Step 2: Panggil dengan `p` di loop (baris 262)**

```ts
      else pollPhases(p, attached.get(id)!);
```
(`p` sudah = `live.get(id)` di baris 259; tak ada lagi `sessionPhases(id)` di jalur poll.)

- [ ] **Step 3: Verifikasi** — jalankan test pty:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism pty
```
Boot server, buka 2+ sesi terminal, ketik di salah satunya — fase tetap ter-stream live, streaming tak tersendat. Expected: test hijau, phase frame tetap muncul saat berkas fase berubah.

- [ ] **Step 4: Commit** — `git add server/src/services/pty.ts && git commit -m "perf(pty): poll baca Pane yang sudah ada, buang re-scan tmux per sesi (SPEC-197)"`

---

### Task 5: `GET /projects` — satu scan tmux + buang N+1 query

Temuan **#6**: `Promise.all(ps.map(toProjectView(p.id)))` — tiap `toProjectView` re-`findUniqueOrThrow` (N+1, baris sudah ada di `ps`) dan `sessionOf` men-`listSessions()` (`execFileSync` tmux) per project, serial memblok event loop.

**Files:**
- Modify: `server/src/services/project-view.ts` (terima `project` row + `sessions` snapshot)
- Modify: `server/src/routes/projects.ts:9-17,31,41`

**Interfaces:**
- Produces: `toProjectView(p: Project, sessions: SessionInfo[]): Promise<ProjectView>` (row + snapshot dioper, tak fetch ulang).

- [ ] **Step 1: `project-view.ts` — `sessionOf` terima snapshot, `toProjectView` terima row**

```ts
import type { Project } from "@prisma/client";
import type { SessionInfo } from "./pty";

function sessionOf(projectId: string, sessions: SessionInfo[]) {
  const s = sessions.find((x) => x.projectId === projectId && x.specId && !x.exited);
  if (!s) return { session: IDLE, commit: "belum ada commit" };
  const phase = sessionPhases(s.id)?.find((p) => p.state === "active")?.name ?? null;
  return { session: { status: "running" as const, phase, flow: s.flow ?? null }, commit: `→ hanoman/${s.id}` };
}

export async function toProjectView(p: Project, sessions: SessionInfo[]): Promise<ProjectView> {
  const specs = await prisma.spec.findMany({ where: { projectId: p.id } });
  const { coverage } = await scanRepoDocs(p.repoDir);
  const open = specs.filter((s) => s.stage !== "done");
  const { session, commit } = sessionOf(p.id, sessions);
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir,
    stack: p.stack, docStatus: docStatusFor(coverage), coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage, session,
    activity: session.status === "running" ? `running · ${session.flow ?? "sesi"}` : "idle", commit,
  };
}
```
Buang import `listSessions` (tak dipakai lagi di sini); `sessionPhases` tetap.

- [ ] **Step 2: `routes/projects.ts` — scan sekali, oper row + snapshot**

```ts
  app.get("/projects", async () => {
    const [ps, sessions] = [await prisma.project.findMany({ orderBy: { createdAt: "desc" } }), listSessions()];
    return Promise.all(ps.map((p) => toProjectView(p, sessions)));
  });
  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "not found" });
    return toProjectView(p, listSessions());
  });
```
POST (baris 31) & PATCH (baris 41): ganti `toProjectView(id)` → `toProjectView(<row>, listSessions())` (POST sudah `create`; ambil row hasilnya atau `findUnique`; PATCH sudah `update` → tangkap hasilnya). `listSessions` sudah di-import.

- [ ] **Step 3: Verifikasi** — test projects + boot:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism projects
curl -s localhost:8787/api/projects | head -c 300
```
Expected: bentuk respons identik dengan sebelumnya (test hijau), tak ada query `findUniqueOrThrow` kedua.

- [ ] **Step 4: Commit** — `git add server/src/services/project-view.ts server/src/routes/projects.ts && git commit -m "perf(projects): satu scan tmux + buang N+1 di GET /projects (SPEC-197)"`

---

### Task 6: `branches.ts` — execFile async (buang spawnSync dari jalur tulis spec)

Temuan **#8**: `listRepoBranches`/`listRepoRemoteBranches` `spawnSync` blocking, dipanggil di `POST/PATCH /specs` (`branchUnknown`) & `GET /projects/:id/branches`.

**Files:**
- Modify: `server/src/services/branches.ts`
- Modify: `server/src/routes/specs.ts:23,76,110` (`branchUnknown` async), `server/src/routes/projects.ts:60` (await)

**Interfaces:**
- Produces: `listRepoBranches(repoDir): Promise<string[]>`, `listRepoRemoteBranches(repoDir): Promise<string[]>`.

- [ ] **Step 1: `branches.ts` — execFile promisified**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24, encoding: "utf8" as const };

async function refs(repoDir: string | null, glob: string): Promise<string[]> {
  if (!repoDir) return [];
  try {
    const { stdout } = await exec("git", ["for-each-ref", "--format=%(refname:short)", glob], { cwd: repoDir, ...GIT });
    return [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch { return []; }
}
export async function listRepoBranches(repoDir: string | null): Promise<string[]> {
  return (await refs(repoDir, "refs/heads")).sort();
}
export async function listRepoRemoteBranches(repoDir: string | null): Promise<string[]> {
  return (await refs(repoDir, "refs/remotes/origin"))
    .filter((b) => b !== "origin/HEAD" && b !== "origin").map((b) => b.replace(/^origin\//, "")).sort();
}
```

- [ ] **Step 2: `specs.ts` — `branchUnknown` async + await callers**

```ts
const branchUnknown = async (repoDir: string | null, branch: string) =>
  !(await listRepoBranches(repoDir)).includes(branch);
```
Baris 76 & 110: `if (b.branchFrom && await branchUnknown(project.repoDir, b.branchFrom))` / `if (await branchUnknown(project?.repoDir ?? null, branchFrom))`.

- [ ] **Step 3: `projects.ts:60` — await keduanya**

```ts
    return { branches: await listRepoBranches(p.repoDir), remotes: await listRepoRemoteBranches(p.repoDir) };
```

- [ ] **Step 4: Verifikasi** — test specs + projects:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism specs projects
curl -s localhost:8787/api/projects/<id>/branches
```
Expected: test hijau, `{branches, remotes}` sama seperti sebelumnya.

- [ ] **Step 5: Commit** — `git add server/src/services/branches.ts server/src/routes/specs.ts server/src/routes/projects.ts && git commit -m "perf(branches): git async, buang spawnSync dari jalur tulis spec (SPEC-197)"`

---

### Task 7: Terminal session lifecycle — try/catch addWorktree spec-flow, fallback HEAD, removeWorktree toleran

Temuan **#7** (`terminal.ts:64` addWorktree spec tak ditangani + fallback `"main"` salah untuk repo non-hanoman) dan **#10** (`removeWorktree` throw bila worktree sudah dipangkas → DELETE 500).

**Files:**
- Modify: `server/src/routes/terminal.ts:64-65,149`
- Modify: `runner/src/git.ts:37` (`removeWorktree` best-effort)

- [ ] **Step 1: `terminal.ts` — bungkus addWorktree spec + fallback HEAD**

Ganti baris 64-65:
```ts
      // HEAD, bukan "main": repo target belum tentu punya branch bernama main (default bisa
      // master/develop). Gagal (revisi tak resolve, worktree ter-lock) → 422 jelas, bukan 500.
      let baseSha: string;
      try {
        baseSha = realGit.addWorktree(repoDir, `${repoDir}/.worktrees/${id}`, spec.branchFrom ?? "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      await prisma.spec.update({ where: { id: spec.id }, data: { baseSha, headSha: null } });
```

- [ ] **Step 2: `runner/src/git.ts` — removeWorktree best-effort (cermin addWorktree reclaim)**

```ts
export function removeWorktree(repo: string, path: string): void {
  tryGit(repo, ["worktree", "remove", "--force", path]);
  tryGit(repo, ["worktree", "prune"]);
  rmSync(path, { recursive: true, force: true });
}
```
(`tryGit` & `rmSync` sudah dipakai `addWorktree` di file yang sama — reuse, jangan tambah util.) Verifikasi nama helper persis (`tryGit`) sebelum edit.

- [ ] **Step 3: Test — removeWorktree pada path yang sudah hilang tak throw**

Di `runner/test/git.test.ts` (buat bila belum ada), setup repo + worktree, `rmSync` manual worktree-nya, lalu `expect(() => removeWorktree(repo, wt)).not.toThrow()`.

- [ ] **Step 4: Verifikasi nyata** — boot server, `POST /terminal/sessions` untuk spec di repo yang default branch-nya bukan `main` → 201 (bukan 500); double-POST cepat → 201 idempoten. `DELETE` sesi yang worktree-nya sudah dihapus manual → 204.
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner build
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run git
```

- [ ] **Step 5: Commit** — `git add server/src/routes/terminal.ts runner/src/git.ts runner/test/git.test.ts && git commit -m "fix(terminal): fallback HEAD + 422 addWorktree, removeWorktree toleran (SPEC-197)"`

---

### Task 8: `nextSpecId` TOCTOU — retry create pada P2002

Temuan **#11**: dua `POST /specs` konkuren hitung id sama → `prisma.spec.create` (specs.ts:84) melempar P2002 tak tertangkap → 500. Fix: retry sekali dengan id yang dihitung ulang.

**Files:**
- Modify: `server/src/routes/specs.ts:78-90` (region create)

- [ ] **Step 1: Bungkus create dengan retry P2002**

```ts
    // TOCTOU: id diturunkan dari max saat ini; dua create konkuren bisa bentrok. Retry sekali
    // menghitung ulang id — bukan 500 mentah. Prisma.PrismaClientKnownRequestError code P2002 = unik.
    async function createWithId() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = await nextSpecId(project.repoDir);
        try {
          return await prisma.spec.create({ data: { id, ...specData } }); // specData = payload create yang sudah ada
        } catch (e) {
          if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
          throw e;
        }
      }
      throw new Error("unreachable");
    }
    const spec = await createWithId();
```
Sesuaikan `specData` dengan objek `data` create yang sudah ada di baris 84-90 (pindahkan field selain `id` ke `specData`). `id` sekarang dihitung **di dalam** loop, jadi hapus `const id = await nextSpecId(...)` di baris 78 lama.

- [ ] **Step 2: Verifikasi** — test specs (tambah kasus dua create beruntun tak melempar), lalu boot + dua `POST /specs` cepat via curl paralel → keduanya 201 dengan id berbeda.
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism specs
```

- [ ] **Step 3: Commit** — `git add server/src/routes/specs.ts && git commit -m "fix(specs): retry nextSpecId pada P2002, bukan 500 (SPEC-197)"`

---

### Task 9: Hardening server — trustProxy + timeout fetch limits

Temuan **#12** (throttle login satu-bucket karena `trustProxy:false` di belakang reverse proxy) dan **#13** (`fetch(USAGE_URL)` tanpa timeout → menggantung ~300s, poll menumpuk koneksi).

**Files:**
- Modify: `server/src/app.ts:33`
- Modify: `server/src/services/limits.ts:84`

- [ ] **Step 1: `app.ts` — trustProxy true**

```ts
  // Deploy resmi: bind 127.0.0.1 di belakang reverse proxy (server.ts). trustProxy → req.ip
  // membaca X-Forwarded-For, jadi throttle login (services/auth.ts) per-klien, bukan satu bucket.
  const app = Fastify({ logger: false, trustProxy: true });
```

- [ ] **Step 2: `limits.ts` — AbortSignal timeout**

```ts
    const res = await fetch(USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(5000),
    });
```
(`catch` yang sudah ada menangkap AbortError → `fallback()`; tak ada perubahan lain.)

- [ ] **Step 3: Verifikasi** — test auth + limits:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism auth limits
```
Boot server, `GET /api/limits` → tetap balas cepat. `curl -H "X-Forwarded-For: 1.2.3.4"` beberapa login gagal lalu login benar dari IP lain tetap bisa (throttle per-IP). Expected: test hijau.

- [ ] **Step 4: Commit** — `git add server/src/app.ts server/src/services/limits.ts && git commit -m "fix(server): trustProxy untuk throttle per-klien + timeout fetch limits (SPEC-197)"`

---

### Task 10: `advanceStage` — advance bersyarat di DB (tutup TOCTOU revert)

Temuan **#14**: revert stage + hapus docs (`PATCH /specs`) bisa balapan dengan write-through poll `GET /specs` yang re-advance berdasar sesi hidup → docs terhapus tapi stage melompat maju. Fix: advance hanya bila stage DB masih = nilai lama yang dibaca (compare-and-set via `updateMany`).

**Files:**
- Modify: `server/src/routes/terminal.ts:21-33` (`advanceStage`)
- Cek juga write-through di `specs.ts:52-63` — terapkan pola CAS yang sama bila ia meng-`update` stage.

- [ ] **Step 1: `advanceStage` — updateMany where stage = old**

```ts
async function advanceStage(specId, repoDir, sessionId, flow, worktree): Promise<void> {
  const next = stageForRun(readPhases(phaseFilePath(repoDir, sessionId), flow), worktree, specId);
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true, title: true, projectId: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  // CAS: hanya maju bila stage belum berubah sejak dibaca (revert konkuren tak ter-overwrite).
  const { count } = await prisma.spec.updateMany({ where: { id: specId, stage: spec.stage }, data: { stage: next } });
  if (count === 0) return; // stage berubah di bawah kita (mis. revert) — jangan lanjut ke recordCompletion
  if (next === "done") await recordCompletion(specId, spec.title, spec.projectId);
}
```
Terapkan CAS serupa pada write-through `GET /specs` (specs.ts) jika ia `update({ data: { stage } })` — ganti ke `updateMany({ where: { id, stage: <old> }, … })`.

- [ ] **Step 2: Verifikasi** — test specs/terminal:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism specs terminal
```
Expected: transisi stage normal tetap jalan (test hijau); advance tak menimpa stage yang sudah berubah.

- [ ] **Step 3: Commit** — `git add server/src/routes/terminal.ts server/src/routes/specs.ts && git commit -m "fix(stage): advance bersyarat (CAS) tutup TOCTOU revert (SPEC-197)"`

---

### Task 11: Git argument injection — `--end-of-options` sebelum ref/name dari data

Temuan **#15**: `git-ide.ts` `gitArgs` dan `spec-review.ts` `mergeBase` merangkai ref/name (bisa berawalan `-`) tanpa `--end-of-options` → flag confusion (bukan RCE; user terautentikasi). Temuan **#18** (spec-review menghitung ulang change-set per file) di-*note* di Task 14.

**Files:**
- Modify: `server/src/services/git-ide.ts:161-169`
- Modify: `server/src/services/spec-review.ts:51`

- [ ] **Step 1: `gitArgs` — sisipkan `--end-of-options` sebelum arg dari data**

```ts
function gitArgs(op: GitOp): string[] {
  switch (op.op) {
    case "checkout": return ["checkout", ...(op.force ? ["-f"] : []), "--end-of-options", op.ref];
    case "branch": return ["branch", "--end-of-options", op.name, ...(op.at ? [op.at] : [])];
    case "merge": return ["merge", "--no-edit", ...(op.ff ? [`--${op.ff}`] : []), "--end-of-options", op.ref];
    case "cherry-pick": return ["cherry-pick", "--end-of-options", op.sha];
    case "revert": return ["revert", "--no-edit", "--end-of-options", op.sha];
    case "delete-branch": return ["branch", op.force ? "-D" : "-d", "--end-of-options", op.name];
  }
}
```

- [ ] **Step 2: `spec-review.ts:51` — mergeBase**

```ts
  const { stdout } = await exec("git", ["merge-base", "--end-of-options", branchFrom || "main", "HEAD"], { cwd: wt, ...GIT });
```

- [ ] **Step 3: Verifikasi** — test git-ide/spec-review:
```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run --no-file-parallelism git-ide spec-review
```
Boot + jalankan satu op IDE (checkout/merge) via UI → tetap sukses. Expected: test hijau, op git normal tak terpengaruh (`--end-of-options` transparan untuk ref valid).

- [ ] **Step 4: Commit** — `git add server/src/services/git-ide.ts server/src/services/spec-review.ts && git commit -m "fix(git): --end-of-options cegah flag-injection ref dari data (SPEC-197)"`

---

### Task 12: Shared — validasi silang source/payload + resolveLink robust

Temuan **#16** (`zCreateSpec`/`zPatchSpec` tak mengikat `source` ke bentuk `payload` → `deriveSpecFields` salah turunkan objective/priority) dan **#19** (`resolveLink` salah untuk link bertitel `[x](a.md "t")` & absolut `/internal/...` → under-count coverage, laten).

**Files:**
- Modify: `shared/src/dto.ts:15-18,24-32`
- Modify: `shared/src/coverage.ts:19-31`
- Test: `shared/test/coverage.test.ts` (atau buat), `shared/test/dto.test.ts`

- [ ] **Step 1: `dto.ts` — superRefine ikat source↔payload**

```ts
const sourceMatchesPayload = (o: { source?: unknown; payload?: unknown }, ctx: z.RefinementCtx) => {
  if (o.payload == null) return; // PATCH tanpa payload → tak divalidasi di sini
  const isQa = typeof o.payload === "object" && o.payload !== null && "severity" in o.payload;
  // source hanya ada di create; di patch source immutable, jadi cek hanya saat source diberikan.
  if (o.source !== undefined && (o.source === "qa") !== isQa)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
};
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload]),
  branchFrom: z.string().min(1).optional() }).superRefine(sourceMatchesPayload);
```
`zPatchSpec` tak punya `source` (immutable) → tak perlu refine payload-nya untuk source; namun jaga: bila hanya payload dikirim, biarkan (server memvalidasi terhadap `source` tersimpan). Cukup `zCreateSpec` yang di-refine. *(Catatan: kalau `.superRefine` mengganggu inferensi `deriveSpecFields`, gunakan `z.custom`/cek manual di route `POST /specs` — tapi refine adalah tempat paling murah.)*

- [ ] **Step 2: `coverage.ts` — resolveLink potong judul + tangani absolut**

```ts
export function resolveLink(fromRel: string, target: string): string {
  // Link Markdown bisa bertitel: `[x](a.md "judul")` → ambil token pertama. `#anchor` dibuang.
  const clean = target.trim().split(/\s+/)[0]!.split("#")[0]!.split("\\").join("/");
  if (!clean) return "";
  // Absolut dari root repo (`/internal/docs/x.md`) → root-relative, jangan gabung ke dir sumber.
  if (clean.startsWith("/")) return clean.slice(1).split("/").filter((p) => p && p !== ".").join("/");
  const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const parts = (dir ? dir.split("/") : []).concat(clean.replace(/^\.\//, "").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out.join("/");
}
```

- [ ] **Step 3: Test resolveLink**

```ts
import { resolveLink } from "../src/coverage";
it("resolveLink: judul & absolut (SPEC-197)", () => {
  expect(resolveLink("internal/docs/a.md", './b.md "judul"')).toBe("internal/docs/b.md");
  expect(resolveLink("internal/docs/a.md", "/internal/docs/c.md")).toBe("internal/docs/c.md");
  expect(resolveLink("internal/docs/sub/a.md", "../b.md")).toBe("internal/docs/b.md");
});
```

- [ ] **Step 4: Verifikasi**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared test
```
Expected: test hijau; `zCreateSpec` menolak `source:"qa"` dengan brief payload.

- [ ] **Step 5: Commit** — `git add shared/src/dto.ts shared/src/coverage.ts shared/test/ && git commit -m "fix(shared): ikat source↔payload + resolveLink judul/absolut (SPEC-197)"`

---

### Task 13: Frontend — matikan badai request saat sesi aktif + reset focusSession

Temuan **#5** (poll App 3s ganti referensi `sessions` → seluruh tree re-render + `openNotification` tak stabil → poll notifikasi teardown/rebuild tiap 3s, 2 request tiap reset), **#17** (`focusSession` tak pernah di-reset → sesi loncat sel), dan #P2 `getSettings()` tiap tick.

**Files:**
- Modify: `src/src/App.tsx:317-325,338-343`
- Modify: `src/src/notifications/NotificationsContext.tsx:46,54-70,72-85`

- [ ] **Step 1: `App.tsx` — guard signature + skip saat tab hidden**

```ts
  const sigRef = React.useRef("");
  React.useEffect(() => {
    if (!anySessionActive) return;
    const tick = () => {
      if (document.hidden) return; // tab tak terlihat → jangan poll
      Promise.all([api.listSpecs(), api.listTerminals()])
        .then(([s, t]) => {
          const sig = JSON.stringify({ s: s.map((x) => [x.id, x.stage]), t: t.map((x) => [x.id, x.exited, x.decision]) });
          if (sig === sigRef.current) return;   // data identik → jangan set state (bail-out re-render)
          sigRef.current = sig;
          setBacklog(s); setSessions(t);
        })
        .catch(() => {});
    };
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [anySessionActive]);
```

- [ ] **Step 2: `App.tsx` — reset focusSession setelah dipakai (temuan #17)**

Di `openNotification` (baris 341) `setFocusSession(t.focus)` sudah benar; masalahnya efek place di `TerminalScreen` tak reset. Paling murah: setelah TerminalScreen menempatkan sesi fokus, panggil balik untuk clear. Bila App memegang `focusSession`, tambah: `TerminalScreen` menerima `onFocusHandled?: () => void` dan memanggilnya setelah place; App `setFocusSession(null)`. *(Verifikasi bentuk props TerminalScreen sebelum edit; kalau `focusSession` di-derive lokal, cukup guard efek place dengan `W.placedIds(ws)` seperti disarankan audit.)*

- [ ] **Step 3: `NotificationsContext.tsx` — `onOpen` via ref, settings fetch sekali**

```ts
export function NotificationsProvider({ showToast, onOpen, children }: { showToast: ShowToast; onOpen?: (n: Notification) => void; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const baseline = React.useRef<string | undefined>(undefined);
  const prefs = React.useRef<NotifyPrefs>({ notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" });
  // onOpen berubah tiap render App (dep [sessions]); simpan di ref supaya `tick` stabil dan efek
  // poll tak teardown/rebuild tiap 3s (badai request, SPEC-197).
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;

  const loadPrefs = React.useCallback(async () => {
    try { const s = await api.getSettings(); if (s) prefs.current = { notifyDone: s.notifyDone, notifySound: s.notifySound, notifyDecision: s.notifyDecision, notifyDecisionSound: s.notifyDecisionSound }; } catch { /* nilai lama */ }
  }, []);

  const tick = React.useCallback(async () => {
    let data: { items: Notification[]; unread: number };
    try { data = await api.listNotifications(); } catch { return; }
    setItems(data.items); setUnread(data.unread);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; }
    const fresh = newSince(data.items, baseline.current);
    const top = maxAt(data.items);
    if (top > baseline.current) baseline.current = top;
    const latest = fresh[0];
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); notifyOS(t.msg, latest, onOpenRef.current); }
    }
  }, [showToast]); // ← onOpen & getSettings keluar dari deps

  React.useEffect(() => {
    void loadPrefs(); void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    const unlock = () => {
      unlockNotifySound();
      if ("Notification" in window && window.Notification.permission === "default") void window.Notification.requestPermission();
      window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { clearInterval(t); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [tick, loadPrefs]);
```
`notifyOS` sudah menerima `onOpen` param → oper `onOpenRef.current`. Settings sekarang di-fetch sekali saat mount (`loadPrefs`), bukan tiap tick.

- [ ] **Step 4: Test — tick stabil & guard signature**

Tambah test di `src/src/notifications/*.test.tsx` (pola race `let alive` sudah ada di repo): render provider, ubah `onOpen` prop → assert efek poll **tak** re-run (spy `api.listNotifications` tak dipanggil ulang di luar interval). Untuk App guard: test bahwa dua tick dengan data identik tak memicu `setSessions` (assert render count / spy).

- [ ] **Step 5: Verifikasi nyata**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web build   # atau nama paket frontend
env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/web test
```
Boot dev, buka sesi aktif, buka DevTools Network → konfirmasi saat sesi hidup request stabil ~1×/3s (bukan ~4×/3s), dan tak ada request saat tab disembunyikan. React DevTools Profiler: tree tak re-render saat data poll identik.

- [ ] **Step 6: Commit** — `git add src/src/App.tsx src/src/notifications/ && git commit -m "perf(web): guard poll App + onOpen via ref, matikan badai request sesi aktif (SPEC-197)"`

---

### Task 14: Cleanup P3 + spec-review recompute — batch dampak-kecil

Kumpulan temuan P3 + opt yang masing-masing independen (reviewer boleh terima/tolak per item): env.ts parser, git.ts pesan error, coverage BFS, byCol memo, VpsScreen poll guard, IdeScreen highlight, dan #18 spec-review.

**Files (per sub-step):**

- [ ] **Step 1: `runner/src/git.ts:7` — sertakan `r.error` di pesan**
```ts
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout || r.error?.message || "gagal"}`);
```

- [ ] **Step 2: `shared/src/coverage.ts:44` — buang O(n²) `shift()` + return seen**
```ts
  let i = 0;
  while (i < queue.length) {
    const cur = queue[i++]!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    ...
  }
  return seen; // tiap elemen sudah dijamin inCorpus (hanya di-enqueue bila inCorpus.has)
```

- [ ] **Step 3: `server/src/env.ts` — lucuti komentar inline `KEY=val # x`**

Di parser (baris ~13-19), setelah split `=`, buang trailing ` # …` dari value bila tak di-quote: `val.replace(/\s+#.*$/, "").trim()`. Verifikasi tak merusak value yang memang mengandung `#` di dalam quote (baca implementasi dulu; kalau parser tak dukung quote, cukup strip untuk value tanpa quote).

- [ ] **Step 4: `src/src/screens/BacklogScreen.tsx:442` — useMemo byCol**
```ts
  const byCol = React.useMemo(() => { /* build Map yang sudah ada */ }, [specs, activeSpecs]);
```

- [ ] **Step 5: `src/src/screens/VpsScreen.tsx:98-102` — skip poll saat tab hidden**
```ts
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
```

- [ ] **Step 6: `src/src/screens/IdeScreen.tsx:100-105` — batasi highlight file besar**

Sebelum `hljs.highlight`, bila `file.content.length > 100_000` render plain (skip highlight). ponytail: ambang kasar, cukup untuk hindari freeze.

- [ ] **Step 7: `spec-review.ts` (#18) — gerbang keberadaan path murah**

Untuk `reviewFile`/`reviewFileRange`: sebelum menderivasi seluruh change-set, cek path ada dengan `git cat-file -e <head>:<path>` (atau `ls-files -- <path>`) dan diff hanya file tunggal, alih-alih memanggil `specReview()` penuh + `withTempIndex` kedua. *(Opsional bila waktu terbatas — dampak: latency klik file di review; async, tak memblok.)*

- [ ] **Step 8: Verifikasi + commit per sub-area**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm -r build
env -u NODE_ENV -u DATABASE_URL pnpm -r test
```
Boot & smoke: buka Backlog board (drag tetap mulus), VPS screen, IDE file besar (tak freeze), review file. Commit dikelompokkan: `git commit -m "perf(cleanup): P3 batch — env/coverage/byCol/vps/ide/spec-review (SPEC-197)"` (atau pisah per file bila reviewer minta granular).

---

## ADR-0037 — isi lengkap (ditulis di Task 1 Step 8)

```markdown
# ADR-0037 — Cabut guardrail deny perintah (PreToolUse) sepenuhnya

**Status:** aktif (SPEC-197). Memperbarui ADR-0010, ADR-0009; melanjutkan arah ADR-0023 (guardrail SoT dicabut).

## Konteks

Di bawah `--dangerously-skip-permissions`, hook `PreToolUse` `hanoman hook pretooluse`
(`deniesDangerous`, runner/src/safety.ts) adalah satu-satunya gerbang yang tersisa (ADR-0010).
Audit SPEC-197 menunjukkan gerbang ini bocor untuk varian trivial: `rm -fr`, `rm -r -f`,
`rm --recursive --force`, `rm -rfv` semuanya lolos regex `/\brm\s+-rf\b/`; guard push-main
sekaligus false-negative (newline) dan false-positive (memblok branch bernama `…main…`).
Sebuah regex-di-atas-string-perintah tak bisa menutup shell (`eval`, `sh -c $var`, alias) —
ia memberi rasa aman yang keliru sambil sesekali memblok kerja sah.

## Keputusan

**Cabut guardrail deny sepenuhnya.** Hapus `runner/src/safety.ts`, perintah CLI
`hook pretooluse`, dan hook `PreToolUse` di `guardSettings`. Agen dipercaya penuh — sama
seperti developer yang menjalankan `claude --dangerously-skip-permissions` di mesinnya
sendiri. Ketiga guard lama ikut dicabut, termasuk `git worktree add` (yang menjaga invarian
1-backlog-1-worktree).

Yang TETAP: hook `Notification`/`UserPromptSubmit` (marker keputusan SPEC-184) di
`guardSettings` — tak berhubungan dengan deny. Guardrail deny perintah berbahaya di
`runner/src/safety.ts` yang disebut CLAUDE.md "tetap" kini resmi dicabut oleh ADR ini.

## Konsekuensi

- **Isolasi kini murni worktree + trust**: run tetap jalan di `.worktrees/<id>` terpisah dari
  working tree utama (ADR-0002). Itu batas kerusakan yang tersisa — bukan lagi deny list.
- **Agen bisa spawn worktree sendiri** yang tak dibersihkan server, dan commit dari path yang
  tak pernah di-push (persis yang dulu dicegah guard worktree). Bila ini jadi masalah nyata,
  tanganinya lewat pembersihan `.worktrees` periodik, bukan menghidupkan kembali deny hook.
- **`rm -rf` / `git push` destruktif tak lagi diblokir.** Diterima: konteks single-user,
  localhost, repo milik user sendiri; risiko setara menjalankan agen coding mana pun.
- Menghidupkan kembali guardrail deny butuh ADR baru (mencabut yang ini).

## Alternatif yang ditolak

- **Perbaiki regex `rm`/push** (normalisasi flag): menambal satu kelas, tak menutup `eval`/alias/
  skrip; tetap memblok kerja sah sesekali. Kompleksitas untuk keamanan semu.
- **Sandbox sungguhan (container/seccomp)**: di luar scope; worktree + trust cukup untuk
  konteks single-user saat ini.
```
Update CLAUDE.md bagian "Jangan": ganti "(Guardrail deny perintah berbahaya di `runner/src/safety.ts` tetap.)" menjadi rujukan ke ADR-0037 (guardrail dicabut).

---

## Self-Review

**Spec coverage** — 19 temuan audit → task:
- #1, #9 → Task 1 (dicabut, bukan ditambal). #2 → Task 2. #3 → Task 3. #4 → Task 4. #5, #17 → Task 13. #6 → Task 5. #7, #10 → Task 7. #8 → Task 6. #11 → Task 8. #12, #13 → Task 9. #14 → Task 10. #15 → Task 11. #16, #19 → Task 12. #18 → Task 14 Step 7. P3 (env, git.ts msg, coverage BFS, byCol, VpsScreen, IdeScreen) → Task 14. **Semua tercakup.**

**Urutan aman**: Task 1 (runner/cli) & 2 lebih dulu (risiko tinggi, isolasi). Task 3/4/5/6 (perf server, saling lepas). Task 7/8/9/10/11 (bug server). Task 12 (shared — jalankan `pnpm -r build` setelahnya karena dikonsumsi server+web). Task 13 (frontend besar). Task 14 (cleanup). Task boleh dikerjakan paralel oleh subagent kecuali yang berbagi file: Task 3 & 8 & 10 sama-sama menyentuh `specs.ts` — serialkan; Task 1 & 4 sama-sama `pty.ts` — Task 1 dulu.

**Type consistency**: `toProjectView(p, sessions)` dipakai konsisten Task 5 di semua caller. `guardSettings(decisionFile?)` satu-argumen konsisten Task 1. `listRepoBranches → Promise` konsisten Task 6.

**Catatan eksekusi**: sebelum edit, verifikasi nama helper yang direferensikan lintas-file (`tryGit` di git.ts, bentuk props `TerminalScreen`, nama paket frontend untuk `pnpm --filter`) — plan menandai titik-titik ini dengan *(verifikasi …)*.
