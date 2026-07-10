# SPEC-162 — Backlog → Sesi Claude Code Interaktif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ganti eksekusi headless (`runOne` + BullMQ + Redis) dengan satu sesi `claude` interaktif per backlog item di dalam tmux, dan hapus seluruh subsistem `Run`.

**Architecture:** Tekan Start pada backlog item → server membuat worktree `--detach` dari `branchFrom`, lalu `tmux new-session` menjalankan `claude '<prompt>'` interaktif di sana. Fase tetap ada tapi dilaporkan agen sendiri dengan meng-append satu baris ke `$HANOMAN_PHASE_FILE` (di luar worktree). Server hanya membaca berkas itu; ia tak pernah mengetik ke pane. Tak ada antrean, tak ada worker, tak ada Redis.

**Tech Stack:** TypeScript strict · Fastify + `@fastify/websocket` · Prisma/Postgres · tmux (`-L hanoman`) + `node-pty` · Vitest · React + Vite.

## Global Constraints

- Spec sumber: `docs/superpowers/specs/2026-07-10-hanoman-interaktif-tmux-spec-162-design.md`. Baca dulu.
- TypeScript strict. Komentar dan prosa dalam bahasa Indonesia, mengikuti gaya berkas sekitarnya: komentar hanya untuk kendala yang tak terlihat dari kode.
- **Jangan pernah `git add -A` atau `git stash` di repo ini** — sesi Claude lain sedang menyunting checkout yang sama. Stage berkas yang disebut task, satu per satu.
- Test dijalankan tanpa env shell yang menunjuk produksi: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run <path>`.
- DB test terpisah dan butuh migrate sendiri: `env DATABASE_URL=<url hanoman_test> pnpm --filter ./server exec prisma migrate deploy`.
- Postgres berjalan di Docker: `docker exec hanoman-db-1 psql -U hanoman -d hanoman`.
- Setelah tiap task: centang checklist di berkas ini (`- [x]` → `- [x]`), lalu **uji API-nya nyata di local** (`pnpm dev:api` + `curl`), bukan hanya unit test.
- Guardrail Source of Truth telah dicabut (ADR-0023). Jangan menambahkannya kembali. Guardrail deny perintah berbahaya (`runner/src/safety.ts` + `cli hook pretooluse`) **tetap** dan wajib terpasang di setiap sesi.
- Sesi tidak pernah berjalan di working tree utama (ADR-0002).
- `branchTo` sebuah backlog item = `hanoman/<sessionId>`, mis. `hanoman/spec-162`.

---

## File Structure

**Dibuat:**
- `runner/src/prompt.ts` — `PIPELINES`, `startPrompt()`. Satu-satunya sisa `phases.ts`.
- `server/src/services/session-phases.ts` — path berkas fase, `readPhases()`, `stageFor()`.
- `server/prisma/migrations/<ts>_drop_run_trigger_github/migration.sql`
- `internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md`

**Diubah:**
- `runner/src/{index,types,git}.ts` — menyusut
- `server/src/services/pty.ts` — sesi membawa spec/flow/prompt, poll menyiarkan fase
- `server/src/routes/terminal.ts` — POST `{spec, flow}`, GET `/:id/phases`, DELETE membuang worktree
- `server/src/{app,db}.ts`, `server/src/services/{project-view,settings,id}.ts`
- `shared/src/{dto,api,entities,index}.ts`
- `src/src/api/client.ts`, `src/src/App.tsx`, `src/src/screens/{BacklogScreen,TerminalScreen,ProjectsScreen,OverviewScreen}.tsx`
- `server/prisma/schema.prisma`, `docker-compose.yml`, `package.json` (root + server)

**Dihapus:** lihat Task 6–9.

---

## Task 1: Prompt awal + pipeline (runner)

**Files:**
- Create: `runner/src/prompt.ts`
- Create: `runner/test/prompt.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Produces: `PIPELINES: Record<Flow, readonly string[]>`, `startPrompt(flow: Flow, spec: SpecBrief, branchTo: string): string`, `type SpecBrief = { id: string; title: string; source: string; priority: string; objective: string; payload?: unknown }`.
- Consumes: `Flow` dari `runner/src/types.ts` (sudah ada).

- [x] **Step 1: Tulis test yang gagal**

`runner/test/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PIPELINES, startPrompt } from "../src/prompt";

const spec = { id: "SPEC-162", title: "Sesi interaktif", source: "brief",
  priority: "high", objective: "Ganti runOne dengan tmux" };

describe("startPrompt", () => {
  it("memuat identitas backlog item dan objective-nya", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
    expect(p).toContain("Sesi interaktif");
  });

  it("menyebut setiap fase pipeline flow-nya, berurutan", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    for (const phase of PIPELINES.feature) expect(p).toContain(phase);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Execute"));
  });

  it("flow qa memakai pipeline-nya sendiri, bukan feature", () => {
    const p = startPrompt("qa", spec, "hanoman/spec-162");
    expect(p).toContain("Audit");
    expect(p).not.toContain("Brainstorm");
  });

  it("menginstruksikan append ke $HANOMAN_PHASE_FILE, bukan tulis-timpa", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("$HANOMAN_PHASE_FILE");
    expect(p).toContain(">>");
  });

  it("menyuruh agen push ke branchTo-nya sendiri", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("hanoman/spec-162");
    expect(p).toContain("git push");
  });

  it("payload ikut saat ada, dan tak menghasilkan 'undefined' saat tak ada", () => {
    expect(startPrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(startPrompt("qa", spec, "b")).not.toContain("undefined");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run runner/test/prompt.test.ts
```

Diharapkan: FAIL — `Cannot find module '../src/prompt'`.

- [x] **Step 3: Implementasi minimal**

`runner/src/prompt.ts`:

```ts
import type { Flow } from "./types";

export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Doc index"],
};

export type SpecBrief = {
  id: string; title: string; source: string; priority: string;
  objective: string; payload?: unknown;
};

// Agen yang melapor, server yang menonton: di PTY tak ada batas giliran yang terbaca mesin.
// Append, bukan tulis-timpa — keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
// yang bisa terlewat kalau server sedang tidak menonton. Berkasnya di luar worktree, jadi
// `git add -A` milik agen tak mungkin men-stage-nya.
const phaseInstruction = (phases: readonly string[]) =>
  `Kerjakan fase berurutan: ${phases.join(" → ")}.\n` +
  `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas ` +
  `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, ` +
  `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;

export function startPrompt(flow: Flow, spec: SpecBrief, branchTo: string): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh ` +
      `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. ` +
      `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n` +
      `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].join("\n\n");
}
```

Di `runner/src/index.ts`, tambahkan `export * from "./prompt";`.

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run runner/test/prompt.test.ts
```

Diharapkan: PASS, 6 test.

- [x] **Step 5: Commit**

```bash
git add runner/src/prompt.ts runner/src/index.ts runner/test/prompt.test.ts
git commit -m "feat(runner): startPrompt + PIPELINES untuk sesi interaktif (SPEC-162)"
```

---

## Task 2: Membaca fase yang dilaporkan agen (server)

**Files:**
- Create: `server/src/services/session-phases.ts`
- Create: `server/test/session-phases.test.ts`

**Interfaces:**
- Consumes: `PIPELINES`, `Flow` dari `@hanoman/runner`; `STAGES` dari `server/src/services/stage-machine.ts`.
- Produces:
  - `phaseFilePath(repoDir: string, sessionId: string): string`
  - `type Phase = { name: string; state: "done" | "skipped" | "active" | "pending" }`
  - `readPhases(file: string, flow: Flow): Phase[]`
  - `stageFor(phases: Phase[]): Stage | null`

- [x] **Step 1: Tulis test yang gagal**

`server/test/session-phases.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaseFilePath, readPhases, stageFor } from "../src/services/session-phases";

let dir = "";
let file = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-phase-")); file = join(dir, "spec-1"); });
const write = (s: string) => writeFileSync(file, s);
const states = (flow: "feature" | "qa" = "feature") =>
  readPhases(file, flow).map((p) => `${p.name}:${p.state}`);

describe("phaseFilePath", () => {
  it("hidup di luar worktree, di bawah .worktrees/.phases", () => {
    expect(phaseFilePath("/repo", "spec-162")).toBe("/repo/.worktrees/.phases/spec-162");
  });
});

describe("readPhases", () => {
  it("berkas belum ada → fase pertama aktif, sisanya pending, tanpa melempar", () => {
    expect(states()).toEqual([
      "Brainstorm:active", "Objective:pending", "Spec:pending", "Plan:pending", "Execute:pending",
    ]);
  });

  it("baris done menandai fase, dan yang berikutnya menjadi aktif", () => {
    write("Brainstorm done\nObjective done\n");
    expect(states()).toEqual([
      "Brainstorm:done", "Objective:done", "Spec:active", "Plan:pending", "Execute:pending",
    ]);
  });

  it("skipped diperlakukan sebagai tercatat, bukan sebagai aktif", () => {
    write("Audit done\nSpec skipped\nPlan skipped\n");
    expect(states("qa")).toEqual(["Audit:done", "Spec:skipped", "Plan:skipped", "Execute:active"]);
  });

  // "Doc index" mengandung spasi: state adalah token TERAKHIR, bukan token kedua.
  it("nama fase bertspasi terbaca utuh", () => {
    write("Scan done\nDoc index done\n");
    expect(readPhases(file, "reverse").map((p) => p.state)).toEqual(["done", "done"]);
  });

  it("seluruh fase tercatat → tak ada yang aktif", () => {
    write("Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    expect(states().filter((s) => s.endsWith(":active"))).toEqual([]);
  });

  it("baris sampah, fase asing, dan state asing diabaikan diam-diam", () => {
    write("\n???\nBrainstorm done\nMandi pagi\nTidur selesai\nObjective menyala\n");
    expect(states()).toEqual([
      "Brainstorm:done", "Objective:active", "Spec:pending", "Plan:pending", "Execute:pending",
    ]);
  });
});

describe("stageFor", () => {
  const P = (pairs: [string, string][]) => pairs.map(([name, state]) => ({ name, state })) as any;
  it("memetakan fase ke stage seperti ADR-0008", () => {
    expect(stageFor(P([["Brainstorm", "active"]]))).toBe("brainstorming");
    expect(stageFor(P([["Brainstorm", "done"], ["Objective", "done"]]))).toBe("objective");
    expect(stageFor(P([["Spec", "done"]]))).toBe("spec-ready");
    expect(stageFor(P([["Plan", "done"]]))).toBe("planned");
    expect(stageFor(P([["Execute", "active"]]))).toBe("executing");
    expect(stageFor(P([["Execute", "done"]]))).toBe("done");
  });
  it("Audit done setara Objective done (flow qa)", () => {
    expect(stageFor(P([["Audit", "done"]]))).toBe("objective");
  });
  it("skipped tak memundurkan: Spec skipped + Plan skipped tetap planned", () => {
    expect(stageFor(P([["Audit", "done"], ["Spec", "skipped"], ["Plan", "skipped"]]))).toBe("planned");
  });
  it("tak ada yang cocok → null (jangan sentuh stage)", () => {
    expect(stageFor(P([["Brainstorm", "pending"]]))).toBe(null);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/session-phases.test.ts
```

Diharapkan: FAIL — `Cannot find module '../src/services/session-phases'`.

- [x] **Step 3: Implementasi minimal**

`server/src/services/session-phases.ts`:

```ts
import { readFileSync } from "node:fs";
import { PIPELINES, type Flow } from "@hanoman/runner";
import type { Stage } from "@hanoman/shared";
import { STAGES } from "./stage-machine";

export type PhaseState = "done" | "skipped" | "active" | "pending";
export type Phase = { name: string; state: PhaseState };

// Di luar worktree: `git add -A` milik agen tak boleh bisa melihatnya. `.worktrees` sudah
// ada di .gitignore, jadi berkas ini tak pernah mendarat di branch mana pun.
export const phaseFilePath = (repoDir: string, sessionId: string): string =>
  `${repoDir}/.worktrees/.phases/${sessionId}`;

// Satu baris = satu transisi: "<Nama Fase> done" | "<Nama Fase> skipped". Nama fase boleh
// berspasi ("Doc index"), jadi state-nya token TERAKHIR. Baris yang tak dikenali diabaikan —
// berkas ini ditulis agen lewat `echo`, dan tak boleh ada yang bisa menyandera tampilan fase.
function recorded(file: string): Map<string, PhaseState> {
  const out = new Map<string, PhaseState>();
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    const i = line.trimEnd().lastIndexOf(" ");
    if (i < 1) continue;
    const state = line.trimEnd().slice(i + 1);
    if (state !== "done" && state !== "skipped") continue;
    out.set(line.slice(0, i).trim(), state);
  }
  return out;
}

// Fase aktif diturunkan, tidak disimpan: yang pertama belum tercatat.
export function readPhases(file: string, flow: Flow): Phase[] {
  const seen = recorded(file);
  let activeTaken = false;
  return PIPELINES[flow].map((name) => {
    const state = seen.get(name);
    if (state) return { name, state };
    if (activeTaken) return { name, state: "pending" as const };
    activeTaken = true;
    return { name, state: "active" as const };
  });
}

// ADR-0008 · Spec.stage cermin fase, hanya maju. `skipped` dihitung sebagai tercapai:
// jalur cepat qa melewati Spec+Plan justru karena pekerjaannya tak diperlukan.
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned", Execute: "done",
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    if (p.name === "Execute" && p.state === "active") best = Math.max(best, STAGES.indexOf("executing"));
    if (p.state !== "done" && p.state !== "skipped") continue;
    const s = REACHED[p.name];
    if (s) best = Math.max(best, STAGES.indexOf(s));
  }
  if (phases[0]?.state === "active") best = Math.max(best, STAGES.indexOf("brainstorming"));
  return best < 0 ? null : STAGES[best]!;
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/session-phases.test.ts
```

Diharapkan: PASS, 11 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-phases.ts server/test/session-phases.test.ts
git commit -m "feat(server): baca fase yang dilaporkan agen dari berkas append-only (SPEC-162)"
```

---

## Task 3: Sesi membawa spec, flow, prompt, dan menyiarkan fase (pty)

**Files:**
- Modify: `server/src/services/pty.ts`
- Modify: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: `readPhases`, `phaseFilePath`, `Phase` (Task 2); `guardSettings` (`@hanoman/runner`).
- Produces:
  - `SessionInfo = { id, projectId, specId?, flow?, cwd, exited }` (`runId` hilang)
  - `createSession(projectId, cwd, opts?: { specId?: string; flow?: Flow; prompt?: string; phaseFile?: string; model?: string; effort?: string }): SessionInfo`
  - `Frame` bertambah `{ t: "phase"; phases: Phase[] }`
  - `sessionPhases(id: string): Phase[] | null`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/pty.test.ts` (ikuti pola `FAKE_CLAUDE` + `waitFor` yang sudah ada di berkas itu):

```ts
it("sesi backlog membawa specId + flow, dan id-nya diturunkan dari spec", () => {
  const s = createSession("p1", repoDir, { specId: "SPEC-162", flow: "feature", prompt: "halo" });
  expect(s.id).toBe("spec-162");
  expect(listSessions().find((x) => x.id === "spec-162")).toMatchObject({
    specId: "SPEC-162", flow: "feature",
  });
});

it("prompt awal sampai ke argv claude", async () => {
  // fake-claude.sh menggemakan argv-nya ke stdout.
  const s = createSession("p1", repoDir, { specId: "SPEC-A", flow: "feature", prompt: "kerjakan ini" });
  const c = recorder();
  attach(s.id, c);
  await waitFor(() => c.text().includes("kerjakan ini"));
});

it("menyiarkan frame phase saat berkas fase berubah, sekali per perubahan", async () => {
  const phaseFile = join(repoDir, ".worktrees", ".phases", "spec-b");
  const s = createSession("p1", repoDir, { specId: "SPEC-B", flow: "feature", prompt: "x", phaseFile });
  const c = recorder();
  attach(s.id, c);
  appendFileSync(phaseFile, "Brainstorm done\n");
  await waitFor(() => c.frames().some((f) => f.t === "phase"));
  const first = c.frames().filter((f) => f.t === "phase").at(-1)!;
  expect(first.phases.find((p: Phase) => p.name === "Brainstorm").state).toBe("done");
  const count = c.frames().filter((f) => f.t === "phase").length;
  await new Promise((r) => setTimeout(r, 1200)); // dua tick poll tanpa perubahan berkas
  expect(c.frames().filter((f) => f.t === "phase").length).toBe(count);
});

it("sesi project (tanpa spec) tak punya fase", () => {
  const s = createSession("p1", repoDir);
  expect(sessionPhases(s.id)).toBe(null);
});
```

Catatan untuk implementer: `recorder()` adalah `Client` palsu yang menumpuk frame — kalau `pty.test.ts` belum punya helper itu, tulis satu:
```ts
const recorder = () => {
  const msgs: string[] = [];
  return { send: (m: string) => msgs.push(m), close: () => {},
    frames: () => msgs.map((m) => JSON.parse(m)),
    text: () => msgs.map((m) => JSON.parse(m)).filter((f) => f.t === "data").map((f) => f.d).join("") };
};
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/pty.test.ts
```

Diharapkan: FAIL — `createSession` belum menerima `prompt`/`flow`; `sessionPhases` tak ada.

- [x] **Step 3: Implementasi**

Di `server/src/services/pty.ts`:

1. Ganti tipe:

```ts
import { mkdirSync } from "node:fs";
import { PIPELINES, guardSettings, type Flow } from "@hanoman/runner";
import { phaseFilePath, readPhases, type Phase } from "./session-phases";

export type Frame = { t: "data"; d: string } | { t: "exit"; code: number } | { t: "phase"; phases: Phase[] };
export type SessionInfo = { id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean };
type Pane = SessionInfo & { code: number; phaseFile?: string };
```

2. `FMT` dan `listPanes` membaca `@hanoman_spec`, `@hanoman_flow`, `@hanoman_phase_file` menggantikan `@hanoman_run`. `idFor(specId)` menjadi:

```ts
// tmux menolak `.` dan `:` dalam nama sesi. Sesi backlog id-nya bisa ditebak dari spec-nya —
// itulah yang membuat Start dua kali menyambung ke sesi yang sama, bukan melahirkan yang kedua.
const idFor = (specId?: string) =>
  specId ? specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_") : randomUUID().slice(0, 8);
```

3. `createSession`:

```ts
export function createSession(
  projectId: string, cwd: string,
  opts: { specId?: string; flow?: Flow; prompt?: string; phaseFile?: string; model?: string; effort?: string } = {},
): SessionInfo {
  const id = idFor(opts.specId);
  const existing = getSession(id);
  if (existing) return existing;

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa `--settings`
  // di bawah, sesi ini tidak punya gerbang sama sekali (ADR-0010).
  const argv = [
    claudeBin(),
    ...(opts.prompt ? [opts.prompt] : []),
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.effort ? ["--effort", opts.effort] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(guardCommand())),
  ].map(sq).join(" ");

  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan argv-nya ke shell, jadi
  // penugasan env bekerja di semua versi tmux, sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  let cmd = argv;
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    cmd = `HANOMAN_PHASE_FILE=${sq(opts.phaseFile)} ${argv}`;
  }

  tmux(
    "set-option", "-g", "remain-on-exit", "on", ";",
    "set-option", "-g", "status", "off", ";",
    "set-option", "-g", "prefix", "None", ";",
    "set-option", "-g", "default-terminal", "screen-256color", ";",
    "new-session", "-d", "-s", name(id), "-c", cwd, cmd, ";",
    "set-option", "-t", name(id), "@hanoman_project", projectId, ";",
    "set-option", "-t", name(id), "@hanoman_cwd", cwd,
  );
  if (opts.specId) tmux("set-option", "-t", name(id), "@hanoman_spec", opts.specId);
  if (opts.flow) tmux("set-option", "-t", name(id), "@hanoman_flow", opts.flow);
  if (opts.phaseFile) tmux("set-option", "-t", name(id), "@hanoman_phase_file", opts.phaseFile);
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, exited: false };
}
```

4. Fase, dibaca dari berkas — bukan disimpan:

```ts
export function sessionPhases(id: string): Phase[] | null {
  const p = getSession(id);
  if (!p?.flow || !p.phaseFile) return null;
  return readPhases(p.phaseFile, p.flow);
}
```

5. Siarkan lewat poll yang sudah ada. `Attachment` menyimpan `lastPhases: string` (JSON terakhir yang disiarkan) supaya frame hanya lahir saat isinya berubah:

```ts
// ponytail: poll 500ms yang sama sudah berjalan untuk mendeteksi pane mati; ia sekalian
// membaca berkas fase. Tak ada watcher kedua, dan berkasnya kecil.
function pollPhases(id: string, a: Attachment): void {
  const phases = sessionPhases(id);
  if (!phases) return;
  const json = JSON.stringify(phases);
  if (json === a.lastPhases) return;
  a.lastPhases = json;
  broadcast(a, { t: "phase", phases });
}
```

Panggil `pollPhases(id, a)` di dalam loop `startPoll()` untuk tiap sesi yang masih hidup, dan sekali di `attach()` setelah scrollback dikirim (klien baru harus langsung melihat fase, tanpa menunggu perubahan).

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/pty.test.ts
```

Diharapkan: PASS. `runId` sudah tak ada — test lama yang memakainya ikut diperbarui di task ini.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(server): sesi tmux membawa spec/flow/prompt dan menyiarkan fase (SPEC-162)"
```

---

## Task 4: Route terminal — start dari backlog, fase, dan pembersihan worktree

**Files:**
- Modify: `server/src/routes/terminal.ts`
- Modify: `shared/src/dto.ts`, `shared/src/api.ts`
- Modify: `server/src/services/settings.ts`
- Modify: `server/test/terminal.route.test.ts`

**Interfaces:**
- Consumes: `createSession`, `sessionPhases`, `killSession`, `getSession` (Task 3); `phaseFilePath`, `readPhases`, `stageFor` (Task 2); `startPrompt` (Task 1); `realGit.addWorktree`/`removeWorktree`.
- Produces: `POST /api/terminal/sessions` menerima `{ project }` **atau** `{ spec, flow }`; `GET /api/terminal/sessions/:id/phases` → `{ flow, phases }`; `DELETE` membuang worktree.

- [x] **Step 1: Tulis test yang gagal**

Ganti blok test sesi-run di `server/test/terminal.route.test.ts` dengan:

```ts
it("POST { spec, flow } membuat worktree + sesi bernama spec-nya", async () => {
  await makeSpec({ id: "SPEC-900", projectId: "p1", objective: "kerjakan sesuatu" });
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
    payload: { spec: "SPEC-900", flow: "feature" } });
  expect(res.statusCode).toBe(201);
  expect(res.json().id).toBe("spec-900");
  expect(existsSync(join(repoDir, ".worktrees", "spec-900"))).toBe(true);
});

it("POST kedua untuk spec yang sama mengembalikan sesi yang sama, bukan yang kedua", async () => {
  await makeSpec({ id: "SPEC-901", projectId: "p1" });
  const a = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-901", flow: "qa" } });
  const b = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-901", flow: "qa" } });
  expect(a.json().id).toBe(b.json().id);
  expect(listSessions().filter((s) => s.id === "spec-901")).toHaveLength(1);
});

it("spec tak dikenal → 404; project tanpa repoDir → 400", async () => {
  expect((await app.inject({ method: "POST", url: "/api/terminal/sessions",
    payload: { spec: "SPEC-XXX", flow: "feature" } })).statusCode).toBe(404);
  await makeSpec({ id: "SPEC-902", projectId: "p2" }); // p2.repoDir = null
  expect((await app.inject({ method: "POST", url: "/api/terminal/sessions",
    payload: { spec: "SPEC-902", flow: "feature" } })).statusCode).toBe(400);
});

it("GET /:id/phases menurunkan fase dari berkas yang ditulis agen", async () => {
  await makeSpec({ id: "SPEC-903", projectId: "p1" });
  await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-903", flow: "feature" } });
  appendFileSync(phaseFilePath(repoDir, "spec-903"), "Brainstorm done\n");
  const res = await app.inject({ method: "GET", url: "/api/terminal/sessions/spec-903/phases" });
  expect(res.json()).toMatchObject({ flow: "feature" });
  expect(res.json().phases[0]).toEqual({ name: "Brainstorm", state: "done" });
  expect(res.json().phases[1].state).toBe("active");
});

it("GET /:id/phases untuk sesi project → 404", async () => {
  const id = await createProjectSession();
  expect((await app.inject({ method: "GET", url: `/api/terminal/sessions/${id}/phases` })).statusCode).toBe(404);
});

it("DELETE membuang worktree dan memajukan Spec.stage ke keadaan finalnya", async () => {
  await makeSpec({ id: "SPEC-904", projectId: "p1", stage: "brainstorming" });
  await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-904", flow: "feature" } });
  appendFileSync(phaseFilePath(repoDir, "spec-904"), "Brainstorm done\nObjective done\nSpec done\n");
  expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-904" })).statusCode).toBe(204);
  expect(existsSync(join(repoDir, ".worktrees", "spec-904"))).toBe(false);
  const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-904" } });
  expect(spec.stage).toBe("spec-ready");
});

it("Spec.stage tak pernah mundur", async () => {
  await makeSpec({ id: "SPEC-905", projectId: "p1", stage: "planned" });
  await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-905", flow: "feature" } });
  appendFileSync(phaseFilePath(repoDir, "spec-905"), "Brainstorm done\n");
  await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-905" });
  const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-905" } });
  expect(spec.stage).toBe("planned");
});
```

`repoDir` di berkas test ini harus repo git sungguhan dengan satu commit (worktree butuh basis). Tambahkan di `beforeAll`:

```ts
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"], { cwd: repoDir });
```

`makeSpec` sudah ada di `server/test/factory.ts`; kalau belum menerima `stage`, tambahkan.

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/terminal.route.test.ts
```

Diharapkan: FAIL — body `{ spec, flow }` ditolak `zTerminalSession` (400), `/phases` 404.

- [x] **Step 3: Implementasi**

`shared/src/dto.ts` — ganti `zTerminalSession`:

```ts
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse"]);
// Sesi dibuka untuk sebuah project (repoDir-nya, terminal biasa) atau untuk sebuah backlog
// item — yang terakhir lahir di worktree-nya sendiri dengan prompt awal (SPEC-162).
export const zTerminalSession = z.union([
  z.object({ project: z.string() }),
  z.object({ spec: z.string(), flow: zFlow }),
]);
```

`shared/src/api.ts` — tambah `terminalPhases: (id: string) => \`${API}/terminal/sessions/${id}/phases\``.

`server/src/services/settings.ts` — `DEFAULT_SETTING` kehilangan `steps`/`maxConcurrent`/`askTimeoutMin`, mendapat `model` + `effort`; ganti `stepModels()`/`maxConcurrent()`/`askTimeoutMs()` dengan:

```ts
export async function sessionModel(): Promise<{ model: string; effort: string }> {
  const s = await getSetting();
  return { model: s.model, effort: s.effort };
}
```

Sesuaikan `zSetting` di `shared/src/entities.ts`: buang `steps`, `maxConcurrent`, `askTimeoutMin`; tambah `model: z.string().default("claude-opus-4-8")`, `effort: z.string().default("xhigh")`.

`server/src/routes/terminal.ts`:

```ts
import type { Stage } from "@hanoman/shared";
import { realGit, startPrompt, type Flow } from "@hanoman/runner";
import { prisma } from "../db";
import { phaseFilePath, readPhases, stageFor } from "../services/session-phases";
import { sessionModel } from "../services/settings";
import { STAGES } from "../services/stage-machine";
import { createSession, getSession, sessionPhases, killSession, listSessions, attach, detach, writeTo, resize, type Client } from "../services/pty";

// Stage hanya maju (ADR-0008). Agen bisa saja tak pernah menulis berkas fasenya; itu tak
// boleh menyeret backlog item mundur ke `brainstorming`.
async function advanceStage(specId: string, repoDir: string, sessionId: string, flow: Flow): Promise<void> {
  const next = stageFor(readPhases(phaseFilePath(repoDir, sessionId), flow));
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  await prisma.spec.update({ where: { id: specId }, data: { stage: next } });
}

app.post("/terminal/sessions", async (req, reply) => {
  const parsed = zTerminalSession.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

  if ("spec" in parsed.data) {
    const spec = await prisma.spec.findUnique({
      where: { id: parsed.data.spec }, include: { project: true } });
    if (!spec) return reply.code(404).send({ error: "spec not found" });
    const repoDir = spec.project.repoDir;
    if (!repoDir) return reply.code(400).send({ error: `project "${spec.projectId}" belum punya repoDir` });

    const id = spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    // Sesi yang sudah hidup: jangan bangun ulang worktree-nya — di dalamnya ada pekerjaan.
    const live = getSession(id);
    if (live) return reply.code(201).send({ id: live.id });

    const worktree = `${repoDir}/.worktrees/${id}`;
    realGit.addWorktree(repoDir, worktree, spec.branchFrom ?? "main");
    const { model, effort } = await sessionModel();
    const s = createSession(spec.projectId, worktree, {
      specId: spec.id, flow: parsed.data.flow, model, effort,
      phaseFile: phaseFilePath(repoDir, id),
      prompt: startPrompt(parsed.data.flow, {
        id: spec.id, title: spec.title, source: spec.source,
        priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
      }, `hanoman/${id}`),
    });
    return reply.code(201).send({ id: s.id });
  }
  // …cabang { project } tak berubah…
});

app.get("/terminal/sessions/:id/phases", async (req, reply) => {
  const { id } = req.params as { id: string };
  const s = getSession(id);
  const phases = sessionPhases(id);
  if (!s?.flow || !phases) return reply.code(404).send({ error: "not found" });
  return { flow: s.flow, phases };
});

app.delete("/terminal/sessions/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const s = getSession(id);
  if (!s) return reply.code(404).send({ error: "not found" });
  // Bacaan terakhir sebelum worktree-nya lenyap: sesudah ini berkas fasenya tak berarti lagi.
  if (s.specId && s.flow) {
    const project = await prisma.project.findUnique({ where: { id: s.projectId } });
    if (project?.repoDir) {
      await advanceStage(s.specId, project.repoDir, id, s.flow);
      killSession(id);
      realGit.removeWorktree(project.repoDir, s.cwd);
      return reply.code(204).send();
    }
  }
  killSession(id);
  return reply.code(204).send();
});
```

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/terminal.route.test.ts shared
```

Diharapkan: PASS.

- [x] **Step 5: Uji API nyata**

```bash
pnpm dev:api &
curl -sS -XPOST localhost:3000/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"spec":"SPEC-162","flow":"feature"}'
curl -sS localhost:3000/api/terminal/sessions/spec-162/phases
tmux -L hanoman -f /dev/null ls           # sesi hanoman-spec-162 harus terlihat
curl -sS -XDELETE localhost:3000/api/terminal/sessions/spec-162 -o /dev/null -w '%{http_code}\n'
```

Diharapkan: `201 {"id":"spec-162"}`, fase `Brainstorm active`, sesi tmux ada, `204`, worktree hilang.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts server/src/services/settings.ts shared/src/dto.ts shared/src/api.ts shared/src/entities.ts server/test/terminal.route.test.ts server/test/factory.ts
git commit -m "feat(server): start sesi interaktif dari backlog item + endpoint fase (SPEC-162)"
```

---

## Task 5: Frontend — Start membuka sesi, terminal menampilkan fase

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/BacklogScreen.tsx`
- Modify: `src/src/screens/TerminalScreen.tsx`
- Modify: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: `POST /api/terminal/sessions {spec,flow}`, `GET .../phases`, frame WS `{ t: "phase", phases }`.
- Produces: `api.startSession(b: { spec: string; flow: Flow }): Promise<{ id: string }>`, `api.sessionPhases(id): Promise<{ flow: Flow; phases: Phase[] }>`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/terminal-screen.test.tsx`:

```tsx
it("merender strip fase dan menandai yang aktif saat frame phase tiba", async () => {
  const { socket } = renderTerminal({ sessionId: "spec-1" });
  socket.emit("message", JSON.stringify({ t: "phase", phases: [
    { name: "Brainstorm", state: "done" }, { name: "Objective", state: "active" },
    { name: "Spec", state: "pending" },
  ]}));
  expect(await screen.findByText("Objective")).toHaveAttribute("data-state", "active");
  expect(screen.getByText("Brainstorm")).toHaveAttribute("data-state", "done");
});
```

(`renderTerminal` mengikuti helper yang sudah ada di berkas itu.)

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run src/test/terminal-screen.test.tsx
```

Diharapkan: FAIL — tak ada elemen `Objective`.

- [x] **Step 3: Implementasi**

`src/src/api/client.ts` — buang `startRun`, `listRuns`, `getRun`, `deleteRun`, `runCommand`, `runControl`, `runSteer`, `runAnswer`, `runChanges`, `runChangeFile`, `listTriggers`, `createTrigger`, `toggleTrigger`, `deleteTrigger`. Tambah:

```ts
startSession: (b: { spec: string; flow: Flow }) =>
  j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body(b) }),
sessionPhases: (id: string) => j<{ flow: Flow; phases: Phase[] }>(paths.terminalPhases(id)),
```

`TerminalSession` di client: `runId` → `specId?: string; flow?: Flow`.

`BacklogScreen.tsx` — `onStart(spec)` memanggil `api.startSession({ spec: spec.id, flow: spec.source === "qa" ? "qa" : "feature" })` lalu berpindah ke tab terminal sesi itu. `onOpenRun` menjadi `onOpenSession` (id = `spec.id.toLowerCase()`). Aturan `canDrop` tetap; komentarnya diperbarui: drop berujung pada `POST /terminal/sessions`, bukan `POST /runs`.

`TerminalScreen.tsx` — simpan `phases` dari frame `{ t: "phase" }` dan render strip di atas terminal, memakai token design system (`--text-muted`, `--brass`, `--radius-lg`). Tiap fase membawa `data-state`. Ambil keadaan awal lewat `api.sessionPhases(id)` saat tab dibuka — WS hanya mengirim frame saat berubah, dan sesi yang sudah lama jalan tak akan mengirim apa pun sampai fase berikutnya tutup. (Sudah tidak perlu: `pollPhases` juga menyiarkan sekali saat attach; ambil lewat API tetap benar untuk tab yang belum pernah attach.)

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run src/test/terminal-screen.test.tsx
```

Diharapkan: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/src/screens/BacklogScreen.tsx src/src/screens/TerminalScreen.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(web): Start backlog membuka sesi interaktif; strip fase di terminal (SPEC-162)"
```

---

## Task 6: Hapus subsistem run di server

**Files:**
- Delete: `server/src/{worker,queue,redis,schedules,schedule-parse,fire-trigger}.ts`
- Delete: `server/src/routes/{runs,triggers,webhooks}.ts`
- Delete: `server/src/github/` (seluruh direktori)
- Delete: `server/src/runner/{events-io,credentials}.ts`
- Delete: `server/src/services/{run-changes}.ts`
- Delete tests: `server/test/{worker,queue,queue-durability,redis,events-io,fire-trigger,schedules,schedule-parse,run-changes,runner-credentials,runs.route,runs-command,runs-control,runs-changes.route,runs-queue-integration,runs-sse,trigger-validate,triggers-settings.route,webhooks,github-app,github-clone,github-live,github-schema,github-status,github-status-reporter,worktree-selfheal}.test.ts`
- Modify: `server/src/app.ts`, `server/src/services/{project-view,id}.ts`, `server/src/runner/deps.ts`, `server/package.json`

**Interfaces:**
- Produces: `ProjectView.session: { status: "running" | "idle"; phase: string | null; flow: string | null }` menggantikan `ProjectView.run`.

- [x] **Step 1: Tulis test yang gagal**

Ganti `server/test/project-view.test.ts` agar menuntut bentuk baru:

```ts
it("project tanpa sesi hidup → session idle, commit kosong", async () => {
  const v = await toProjectView("p1");
  expect(v.session).toEqual({ status: "idle", phase: null, flow: null });
  expect(v).not.toHaveProperty("run");
});

it("sesi backlog yang hidup muncul sebagai running dengan fase aktifnya", async () => {
  createSession("p1", repoDir, { specId: "SPEC-1", flow: "feature", prompt: "x",
    phaseFile: phaseFilePath(repoDir, "spec-1") });
  const v = await toProjectView("p1");
  expect(v.session).toMatchObject({ status: "running", flow: "feature", phase: "Brainstorm" });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server/test/project-view.test.ts
```

Diharapkan: FAIL — `v.session` undefined.

- [x] **Step 3: Hapus dan sambung ulang**

Hapus berkas di daftar atas dengan `git rm`. Lalu:

`server/src/app.ts` — buang `import`/`register` untuk `runs`, `triggers`, `webhooks`. `addContentTypeParser` tak lagi perlu menyimpan `rawBody` (itu hanya untuk HMAC webhook GitHub) — buang barisnya dan komentarnya.

`server/src/services/id.ts` — buang `nextRunId`; `nextSpecId` tetap (ADR-0021).

`server/src/runner/deps.ts` — buang `prodDeps` dan `makeClaudeCliSession`; sisakan `repoRootFrom`, `resolveCliEntry`, `guardCommand`.

`server/src/services/project-view.ts`:

```ts
import { listSessions, sessionPhases } from "./pty";

const IDLE = { status: "idle" as const, phase: null as string | null, flow: null as string | null };
// Sesi tmux adalah satu-satunya sumber kebenaran soal pekerjaan yang sedang berjalan
// (ADR-0016). Tak ada baris DB yang bisa basi saat proses mati.
function sessionOf(projectId: string) {
  const s = listSessions().find((x) => x.projectId === projectId && x.specId && !x.exited);
  if (!s) return IDLE;
  const phase = sessionPhases(s.id)?.find((p) => p.state === "active")?.name ?? null;
  return { status: "running" as const, phase, flow: s.flow ?? null };
}
```

`toProjectView` memakai `sessionOf(projectId)` untuk `session`, `activity` (`"running · feature"` / `"idle"`), dan `commit` (`"→ hanoman/<id>"` saat ada sesi, `"belum ada commit"` saat tidak). Buang `prisma.run.findMany`.

`shared/src/dto.ts` — ganti `zRunSummary` dengan `zSessionSummary`, dan `zProjectView.run` dengan `session`:

```ts
export const zSessionSummary = z.object({
  status: z.enum(["running", "idle"]),
  phase: z.string().nullable(),
  flow: z.string().nullable(),
});
export const zProjectView = zProject.extend({
  backlog: z.number().int(), topStage: z.string(), session: zSessionSummary,
  activity: z.string(), commit: z.string() });
```

`shared/src/entities.ts` — buang `zRun`, `Run`, `zTrigger`, `Trigger`, `zAsk`, `zAskOption`, `Ask`, dan `zPhase` lama. `shared/src/enums.ts` — buang `zRunStatus`, `zRunKind`, `zTriggerType`, `zTriggerTarget`. `shared/src/dto.ts` — buang `zStartRun`, `zControl`, `zControlAction`, `zSteer`, `zAnswer`, `zCommand`, `zWorktreePatch`, `zCreateTrigger`. `shared/src/api.ts` — buang seluruh `paths.run*` dan `paths.trigger*`/`toggle`.

`server/package.json` — buang script `worker`, dan `--external:bullmq --external:ioredis` dari `build`. Root `package.json` — buang `dev:worker`, `worker`, `prod:worker`, dan sempitkan `prod` ke `prod:api`.

- [x] **Step 4: Jalankan seluruh suite server**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server
env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck
```

Diharapkan: PASS. Kalau `typecheck` masih menyebut `prisma.run`/`prisma.trigger`, berarti ada pemanggil yang terlewat — perbaiki sebelum lanjut (skema-nya baru turun di Task 8).

- [x] **Step 5: Commit**

```bash
git add -u server shared
git add server/src/services/project-view.ts
git commit -m "refactor(server)!: hapus run, queue, worker, redis, trigger, webhook github (SPEC-162)"
```

---

## Task 7: Hapus subsistem run di frontend

**Files:**
- Delete: `src/src/screens/{RunsScreen,TriggersScreen}.tsx`, `src/src/lib/run-reduce.ts`
- Delete tests: `src/test/{run-reduce,run-poll,run-ask,run-order,run-retry}.test.*`
- Modify: `src/src/App.tsx`, `src/src/screens/{ProjectsScreen,OverviewScreen}.tsx`, `src/test/{app-flows,app-states,project-detail,project-filter}.test.tsx`

- [x] **Step 1: Jalankan test untuk melihat apa yang pecah**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run src
```

Catat setiap kegagalan yang menyebut `run`, `runs`, atau `triggers`. Itulah daftar kerja langkah berikutnya.

- [x] **Step 2: Hapus dan sambung ulang**

`App.tsx` — buang state `runs`/`triggers`, `api.listRuns()`/`api.listTriggers()` dari kedua `Promise.all`, rute `runs` dan `triggers` di navigasi, dan importnya. Item sidebar "Runs"/"Triggers" hilang; "Terminal" menggantikan tempatnya sebagai tujuan tombol Start.

`ProjectsScreen.tsx` — `p.run.status` → `p.session.status`; `isRunActive(p.run.status)` → `p.session.status === "running"`; `severity` tak lagi punya `failed` (sesi tak pernah "gagal" — terminalnya yang menunjukkan), jadi tinggal `p.docStatus === "broken"`.

`OverviewScreen.tsx` — kartu "run aktif" menjadi "sesi aktif"; tombol "Buka Runs" → "Buka Terminal" (`onGoto("terminal")`); `a.status` dari `p.session.status`.

- [x] **Step 3: Jalankan, pastikan lulus**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm vitest run src
env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck
```

Diharapkan: PASS, tanpa satu pun referensi `Run` tersisa di `src/`.

- [x] **Step 4: Commit**

```bash
git add -u src
git commit -m "refactor(web)!: hapus RunsScreen + TriggersScreen; project menampilkan sesi (SPEC-162)"
```

---

## Task 8: Migration — turunkan tabel Run, Trigger, GithubInstallation

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_drop_run_trigger_github/migration.sql`

- [x] **Step 1: Sunting skema**

Hapus model `Run`, `Trigger`, `GithubInstallation`. Di `Project`, hapus `runs Run[]`, `triggers Trigger[]`, `installationId Int?`, dan `repoUrl String?`. `Spec` dan `Setting` tak berubah (`Setting.data` adalah `Json` — bentuk barunya dijaga `zSetting`, bukan skema).

- [x] **Step 2: Buat migration**

```bash
env -u NODE_ENV -u DATABASE_URL DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman" \
  pnpm --filter ./server exec prisma migrate dev --name drop_run_trigger_github
```

Isi `migration.sql` yang diharapkan:

```sql
DROP TABLE "Run";
DROP TABLE "Trigger";
DROP TABLE "GithubInstallation";
ALTER TABLE "Project" DROP COLUMN "installationId", DROP COLUMN "repoUrl";
```

Ini destruktif dan disengaja: riwayat run tak dipertahankan (lihat bagian Konsekuensi di spec).

- [x] **Step 3: Migrasikan DB test**

DB test tak tersentuh `migrate dev` dan akan melempar P2022 di setiap test server tanpa langkah ini.

```bash
env -u NODE_ENV DATABASE_URL="postgresql://hanoman:hanoman@localhost:5432/hanoman_test" \
  pnpm --filter ./server exec prisma migrate deploy
```

- [x] **Step 4: Verifikasi**

```bash
docker exec hanoman-db-1 psql -U hanoman -d hanoman -c '\dt'
env -u NODE_ENV -u DATABASE_URL pnpm vitest run server
```

Diharapkan: hanya `Project`, `Spec`, `Setting`, `_prisma_migrations`. Suite server PASS.

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(server)!: drop tabel Run, Trigger, GithubInstallation (SPEC-162)"
```

---

## Task 9: Bersihkan runner, cli, dependensi, dan tulis ADR

**Files:**
- Delete: `runner/src/{run,phases,phase,turns,steer-queue,claude-cli}.ts`
- Delete: `runner/test/{run,phases,phase,turns,steer-queue,claude-cli,live-smoke}.test.ts`
- Delete: `cli/src/commands/{qa,spec,plan,execute,scaffold,reverse,_run,_deps}.ts`
- Delete tests: `cli/test/{execute.cmd,flows.cmd}.test.ts`
- Modify: `runner/src/{index,types,git}.ts`, `cli/src/router.ts`, `cli/package.json`
- Modify: `package.json` (root), `server/package.json`, `docker-compose.yml`
- Create: `internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md`
- Modify: `internal/docs/README.md`, `internal/docs/frontend/frontend-implementation.md`, `internal/docs/adr/{0005,0008,0010,0012,0017,0022}-*.md` (tandai superseded)

- [x] **Step 1: Susutkan runner**

`runner/src/types.ts` menyisakan `Flow` dan `GitOps`. `runner/src/git.ts` kehilangan `commitAndPush` dan `switchBase` — agen yang commit dan push sekarang. `runner/src/index.ts` mengekspor `PIPELINES`, `startPrompt`, `SpecBrief`, `Flow`, `GitOps`, `realGit`, `guardSettings`, `deniesDangerous` (`safety.ts`).

`guardSettings` pindah dari `claude-cli.ts` ke `runner/src/settings.ts` (berkas baru, ~5 baris) karena `claude-cli.ts` dihapus dan `pty.ts` memakainya. Komentarnya ikut: hook `PreToolUse` mengalahkan `--permission-mode`, dan hook dari `--settings` bergabung dengan milik pengguna, bukan menggantinya.

`runner/test/git.test.ts` kehilangan blok `commitAndPush`/`switchBase`; sisanya tetap.

- [x] **Step 2: Susutkan cli**

`cli/src/router.ts` kehilangan perintah `feature`, `qa`, `spec`, `plan`, `execute`, `scaffold`, `reverse`. Yang tersisa: `hook pretooluse`, `docs scan`, `docs index`, `docs link`. `cli/package.json` kehilangan dependensi `@hanoman/runner` jika tak ada lagi yang mengimpornya (`hook-pretooluse.ts` memakai `deniesDangerous` — kalau ya, dependensinya tetap).

`shared/src/cost.ts` (`fmtEstCost`) menjadi mati bersama ADR-0012: `git rm` berkasnya, exportnya di `shared/src/index.ts`, dan `shared/test/`-nya jika ada.

- [x] **Step 3: Buang dependensi**

```bash
pnpm --filter ./server remove bullmq ioredis @octokit/auth-app @octokit/rest
```

`docker-compose.yml` — hapus layanan `redis`. Root `package.json` — `predev` tetap (`db` masih ada).

`.env.example` dan `.env.production.example` — hapus `REDIS_URL`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`.

- [x] **Step 4: Tulis ADR-0024**

`internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md`, mengikuti bentuk ADR lain (Context / Decision / Consequences, bahasa Indonesia). Isinya:

- **Context:** `runOne` men-spawn `claude -p --input-format stream-json`; fase adalah giliran karena batas giliran terbaca mesin. Seluruh mesin — BullMQ, Redis, worker, trigger, webhook, tabel `Run` — ada untuk menjalankan proses yang tak berpenunggu itu.
- **Decision:** pekerjaan dikerjakan `claude` interaktif di dalam tmux, satu sesi per backlog item, di worktree-nya sendiri. Fase dilaporkan agen ke `$HANOMAN_PHASE_FILE` (append-only, di luar worktree); server membaca, tak pernah mengetik ke pane. Agen commit dan push sendiri.
- **Consequences:** tak ada lagi eksekusi tanpa penunggu; tak ada riwayat run; Redis dan proses worker hilang; `Spec.stage` hanya sejauh agen jujur melaporkannya — pelemahan ADR-0008 yang disadari.
- **Supersedes:** ADR-0005, ADR-0010, ADR-0012, ADR-0017, ADR-0022. **Melemahkan:** ADR-0008. **Bersandar pada:** ADR-0002, ADR-0015, ADR-0016.

Tambahkan header `**Status:** superseded oleh ADR-0024` di kelima ADR yang digantikan, dan link ADR-0024 di `internal/docs/README.md`.

- [x] **Step 5: Verifikasi penuh**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm -r typecheck
env -u NODE_ENV -u DATABASE_URL pnpm test
grep -rn "runOne\|bullmq\|ioredis\|prisma.run\b" runner/src server/src src/src cli/src
```

Diharapkan: typecheck bersih, seluruh suite PASS, `grep` tak menemukan apa pun.

- [x] **Step 6: Uji API nyata, ujung ke ujung**

```bash
docker compose up -d --wait          # hanya db sekarang
pnpm dev:api &
curl -sS -XPOST localhost:3000/api/specs -H 'content-type: application/json' \
  -d '{"project":"<id>","source":"brief","title":"Coba sesi","priority":"low","payload":{"context":"c","outcome":"o","constraints":"-","priority":"low"}}'
curl -sS -XPOST localhost:3000/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"spec":"<specId>","flow":"feature"}'
tmux -L hanoman -f /dev/null attach -t hanoman-<specid>   # claude interaktif, prompt sudah terisi
curl -sS localhost:3000/api/terminal/sessions/<specid>/phases
curl -sS -XDELETE localhost:3000/api/terminal/sessions/<specid> -o /dev/null -w '%{http_code}\n'
```

Diharapkan: `claude` benar-benar interaktif di dalam tmux dengan prompt backlog item terisi, `/phases` melaporkan `Brainstorm active`, `DELETE` mengembalikan `204` dan worktree-nya hilang.

- [x] **Step 7: Commit**

```bash
git add -u runner cli server package.json docker-compose.yml .env.example .env.production.example
git add internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md
git add -u internal/docs
git commit -m "refactor!: hapus runner headless + cli flow; ADR-0024 (SPEC-162)"
```

---

## Catatan untuk implementer

- ~~`--effort` di mode interaktif belum diverifikasi.~~ **Terverifikasi 2026-07-10:** `claude --help` mendaftarkannya sebagai *"Effort level for the current session"* — bukan flag khusus `-p`. Dikirim apa adanya.
- **Jalankan test dengan `--no-file-parallelism`** (`pnpm vitest run --no-file-parallelism server`). Tanpa itu berkas test berjalan paralel di atas satu DB dan satu socket tmux, dan ~13 berkas gagal palsu. Script `pnpm test` di root sudah memakainya.
- Task 6 dan 7 mematahkan `typecheck` di tengah jalan. Itu diharapkan; yang tidak boleh adalah mengakhiri task dengan `typecheck` merah.
- Jangan menghidupkan kembali `.hanoman-ask.json`, `.hanoman-decision.json`, atau `steer`. Agen bertanya di terminal; manusia menjawab di terminal.
