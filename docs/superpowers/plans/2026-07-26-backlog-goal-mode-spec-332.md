# Backlog goals mode (SPEC-332) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi backlog hanoman bisa lahir dengan **mode goal** — Claude Code menolak berhenti sampai kondisi selesai terbukti — dipasang deterministik lewat `--settings` dan ditampilkan di TUI lewat keystroke `/goal`.

**Architecture:** Empat lapis. (1) `runner/src/goal.ts` merakit kondisi (library murni). (2) `runner/src/settings.ts` menyisipkannya sebagai Stop hook bertipe `prompt` ke JSON `--settings` yang sudah dipakai `createSession`. (3) `server/src/services/pty.ts` meneruskan `goal` ke argv dan, best-effort, mengetik `/goal <kondisi>` ke pane tmux. (4) `startSpecSession` meresolusi kebijakan (override per sesi → template global → default) sehingga Start manual dan governor scheduler memakai jalur yang sama.

**Tech Stack:** TypeScript strict · pnpm workspace (`shared`, `runner`, `server`, `src`) · zod · Fastify · Prisma (Postgres) · node-pty + tmux · vitest · React 18 + Vite.

## Global Constraints

- Batas panjang kondisi goal Claude Code: **4000 karakter** (`GOAL_MAX`).
- Bentuk hook yang dipasang persis: `{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"<kondisi>"}]}]}}`.
- **Tanpa migration Prisma.** Blok `goal` masuk kolom `Setting.data` (Json) lewat `zGoal.default(GOAL_DEFAULTS)`, meniru `scheduler` (SPEC-294).
- Semua default **MATI** (`goal.enabled = false`, `goal.condition = ""`) — perilaku sesi yang ada tidak berubah sampai operator menyalakannya.
- Cakupan hanya sesi backlog (spec-flow). Jangan menyentuh jalur `prd`/`reverse`/`scaffold`/`breakdown`/`audit`/terminal biasa.
- ADR baru bernomor **0073** (0072 adalah tertinggi di semua branch; sudah dicek).
- Test repo dijalankan `vitest run --no-file-parallelism` dengan `env -u NODE_ENV -u DATABASE_URL`.
- Typecheck memakai `tsc --noEmit` (tanpa `--noEmit` ia menulis `.js`/`.d.ts` ke `src/`).
- Prosa kode/komentar bahasa Indonesia, mengikuti gaya file sekitarnya.

---

### Task 1: Kondisi goal — `runner/src/goal.ts`

**Files:**
- Create: `runner/src/goal.ts`
- Create: `runner/src/goal.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: `Flow` dari `./types`, `PIPELINES` dari `./prompt`.
- Produces: `GOAL_MAX: 4000`, `type GoalArgs = { flow: Flow; specId: string; branchTo: string }`,
  `defaultGoalCondition(a: GoalArgs): string`,
  `resolveGoalCondition(a: GoalArgs, override?: string | null, template?: string | null): string`,
  `goalOneLine(cond: string): string`.

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/src/goal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GOAL_MAX, defaultGoalCondition, resolveGoalCondition, goalOneLine } from "./goal";

const args = { flow: "feature" as const, specId: "SPEC-332", branchTo: "hanoman/spec-332" };

describe("goal condition", () => {
  it("default memuat identitas backlog, seluruh fase, gate plan, dan push", () => {
    const c = defaultGoalCondition(args);
    expect(c).toContain("SPEC-332");
    expect(c).toContain("Brainstorm → Objective → Spec → Plan → Execute");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("docs/superpowers/plans/");
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-332");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("flow tanpa Plan+Execute tak membawa gate plan", () => {
    const c = defaultGoalCondition({ ...args, flow: "audit" });
    expect(c).toContain("Audit → Laporan");
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c).toContain("git push");
  });

  it("resolve: override menang atas template, template menang atas default", () => {
    expect(resolveGoalCondition(args, "pakai ini", "template")).toBe("pakai ini");
    expect(resolveGoalCondition(args, "  ", "template")).toBe("template");
    expect(resolveGoalCondition(args, undefined, "")).toBe(defaultGoalCondition(args));
    expect(resolveGoalCondition(args, null, null)).toBe(defaultGoalCondition(args));
  });

  it("resolve memangkas kondisi di atas batas Claude Code", () => {
    expect(resolveGoalCondition(args, "x".repeat(GOAL_MAX + 500)).length).toBe(GOAL_MAX);
  });

  it("goalOneLine meratakan baris (Enter di tmux = submit)", () => {
    expect(goalOneLine("baris satu\n  baris dua\n\nbaris tiga ")).toBe("baris satu baris dua baris tiga");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run src/goal.test.ts`
Expected: FAIL — `Failed to resolve import "./goal"`.

- [x] **Step 3: Implementasi minimal**

Buat `runner/src/goal.ts`:

```ts
import type { Flow } from "./types";
import { PIPELINES } from "./prompt";

// SPEC-332 · ADR-0073 — mode goal. Claude Code memasang `/goal` sebagai Stop hook bertipe `prompt`
// dan menolak kondisi > 4000 karakter; angka ini menyalin batas itu.
export const GOAL_MAX = 4000;

export type GoalArgs = { flow: Flow; specId: string; branchTo: string };

// Evaluator hook `prompt` berjalan dengan instruksi "Answer based on transcript evidence only" —
// ia TIDAK punya tool, dan transkrip Stop yang panjang DIPOTONG (bukti di prefix yang dibuang
// dianggap tak cukup). Karena itu kondisi ini menuntut BUKTI SEGAR: output perintah verifikasi di
// transkrip terbaru, bukan klaim agen bahwa pekerjaannya sudah selesai.
export function defaultGoalCondition({ flow, specId, branchTo }: GoalArgs): string {
  const phases = PIPELINES[flow];
  // Gate plan hanya berlaku untuk flow ber-fase Plan+Execute (cermin phaseInstruction & ADR-0029).
  const planGate = phases.includes("Plan") && phases.includes("Execute");
  const clauses = [
    `1. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${phases.join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
  ];
  if (planGate) {
    clauses.push(
      `2. output \`grep -rn -- "- \\[ \\]" docs/superpowers/plans/\` yang KOSONG untuk plan backlog `
      + `ini — tak ada task yang masih \`- [ ]\` (atau bukti bahwa backlog ini memang tak berplan);`,
    );
  }
  clauses.push(
    `${planGate ? 3 : 2}. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES `
    + `sesudah commit terakhir.`,
  );
  return [
    `Sesi backlog hanoman ${specId} (flow ${flow}) hanya boleh berhenti bila transkrip TERBARU `
      + `memuat bukti langsung semua hal berikut:`,
    ...clauses,
    `Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan perintah `
      + `verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.`,
  ].join("\n");
}

// Presedens: override per sesi → template global → default bawaan. String kosong/hanya-spasi
// dianggap tak ada. Dipangkas ke GOAL_MAX supaya Claude Code tak menolak kondisinya.
export function resolveGoalCondition(
  a: GoalArgs, override?: string | null, template?: string | null,
): string {
  const picked = [override, template].find((c) => typeof c === "string" && c.trim() !== "");
  return (picked ? picked.trim() : defaultGoalCondition(a)).slice(0, GOAL_MAX);
}

// tmux `send-keys`: satu Enter = submit. Kondisi multi-baris harus diratakan sebelum diketik ke
// TUI, kalau tidak ia terkirim separuh dan sisanya jadi pesan liar.
export const goalOneLine = (cond: string): string => cond.replace(/\s+/g, " ").trim();
```

Tambahkan ke `runner/src/index.ts`, sesudah baris `export * from "./settings";`:

```ts
export * from "./goal";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run src/goal.test.ts`
Expected: PASS — 5 test.

- [x] **Step 5: Commit**

```bash
git add runner/src/goal.ts runner/src/goal.test.ts runner/src/index.ts
git commit -m "feat(spec-332): kondisi goal DoD hanoman di runner (library murni)"
```

---

### Task 2: `guardSettings` memasang Stop hook bertipe `prompt`

**Files:**
- Modify: `runner/src/settings.ts`
- Create: `runner/src/settings.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `guardSettings(decisionFile?: string, goal?: string)` — argumen kedua baru; tanpa `goal` hasilnya identik dengan sebelumnya.

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/src/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { guardSettings } from "./settings";

type Hooks = { hooks: Record<string, { hooks: { type: string; prompt?: string; command?: string }[] }[]> };

describe("guardSettings", () => {
  it("tanpa goal: tak ada hook Stop sama sekali", () => {
    const s = guardSettings("/tmp/dec") as Hooks;
    expect(s.hooks.Stop).toBeUndefined();
    expect(s.hooks.Notification).toBeDefined();      // marker keputusan SPEC-184 tetap
    expect(s.hooks.UserPromptSubmit).toBeDefined();
  });

  it("dengan goal: Stop hook bertipe prompt berisi kondisinya", () => {
    const s = guardSettings("/tmp/dec", "berhenti hanya bila X") as Hooks;
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: "prompt", prompt: "berhenti hanya bila X" }] }]);
    expect(s.hooks.Notification).toBeDefined();      // tak merusak hook yang sudah ada
  });

  it("goal boleh berdiri tanpa decisionFile", () => {
    const s = guardSettings(undefined, "kondisi") as Hooks;
    expect(s.hooks.Stop?.[0]!.hooks[0]!.prompt).toBe("kondisi");
    expect(s.hooks.Notification).toBeUndefined();
  });

  it("goal kosong tidak memasang hook", () => {
    expect((guardSettings("/tmp/dec", "") as Hooks).hooks.Stop).toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run src/settings.test.ts`
Expected: FAIL — `expected undefined to deeply equal [ { hooks: [...] } ]`.

- [x] **Step 3: Implementasi minimal**

Ubah `runner/src/settings.ts` — ganti tanda tangan dan tambahkan blok goal sebelum `return`:

```ts
export const guardSettings = (decisionFile?: string, goal?: string) => {
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
  // SPEC-332 · ADR-0073 · mode goal: mesin yang SAMA dipasang `/goal` di dalam sesi
  // (sessionHooksRegistry.add(cwd,"Stop","",{type:"prompt",prompt})), tapi dari luar dan saat sesi
  // lahir — jadi ia tak bergantung timing TUI maupun kepatuhan agen. BUKAN guardrail deny: ADR-0037
  // tetap dicabut, hook ini tak pernah menolak tool call, ia hanya menahan sesi BERHENTI sebelum
  // kondisinya terbukti di transkrip. Interrupt manusia (Esc) bukan event Stop → kendali tetap ada.
  if (goal) hooks.Stop = [{ hooks: [{ type: "prompt", prompt: goal }] }];
  return { hooks };
};
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run`
Expected: PASS — `goal.test.ts` (5) + `settings.test.ts` (4).

- [x] **Step 5: Commit**

```bash
git add runner/src/settings.ts runner/src/settings.test.ts
git commit -m "feat(spec-332): guardSettings memasang Stop hook prompt untuk mode goal"
```

---

### Task 3: Kontrak — `Setting.goal` + body `POST /terminal/sessions`

**Files:**
- Modify: `shared/src/entities.ts` (blok setelah `SCHEDULER_DEFAULTS`, lalu `zSetting`)
- Modify: `shared/src/dto.ts:192` (varian spec `zTerminalSession`)
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING`)
- Create: `shared/src/goal.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `zGoal`, `type Goal = { enabled: boolean; condition: string }`, `GOAL_DEFAULTS: Goal`, field `Setting.goal`, field opsional `goal?: boolean` & `goalCondition?: string` pada varian spec `zTerminalSession`.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/goal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zGoal, GOAL_DEFAULTS, zSetting } from "./entities";
import { zTerminalSession } from "./dto";

describe("zSetting.goal", () => {
  it("default mati dengan template kosong", () => {
    expect(GOAL_DEFAULTS).toEqual({ enabled: false, condition: "" });
    expect(zGoal.parse({})).toEqual(GOAL_DEFAULTS);
  });

  it("baris Setting lama tanpa blok goal tetap parse (tanpa migration)", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short",
      notifyDecision: true, notifyDecisionSound: "alert",
    };
    expect(zSetting.parse(old).goal).toEqual(GOAL_DEFAULTS);
  });

  it("menolak kondisi di atas 4000 karakter", () => {
    expect(zGoal.safeParse({ enabled: true, condition: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("zTerminalSession varian spec", () => {
  it("menerima goal + goalCondition", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-332", flow: "feature", goal: true, goalCondition: "kondisi" });
    expect(r.success && "goal" in r.data && r.data.goal).toBe(true);
    expect(r.success && "goalCondition" in r.data && r.data.goalCondition).toBe("kondisi");
  });

  it("tetap sah tanpa keduanya (ikut default global)", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-332", flow: "feature" });
    expect(r.success).toBe(true);
  });

  it("menolak goalCondition di atas 4000 karakter", () => {
    const r = zTerminalSession.safeParse({ spec: "S", flow: "feature", goalCondition: "x".repeat(4001) });
    expect(r.success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run src/goal.test.ts`
Expected: FAIL — `zGoal` tidak diekspor dari `./entities`.

- [x] **Step 3: Implementasi minimal**

Di `shared/src/entities.ts`, sisipkan tepat sesudah baris `export const SCHEDULER_DEFAULTS: Scheduler = zScheduler.parse({});`:

```ts
// SPEC-332 · ADR-0073 · mode goal untuk sesi backlog: Claude Code menolak berhenti sampai kondisi
// terbukti. Default MATI; `condition` kosong = pakai template DoD bawaan runner
// (defaultGoalCondition). Batas 4000 = batas kondisi `/goal` di Claude Code. Dipasang ke zSetting
// lewat .default() seperti `scheduler` (SPEC-294) → baris Setting lama tetap parse, tanpa migration.
export const zGoal = z.object({
  enabled: z.boolean().default(false),
  condition: z.string().max(4000).default(""),
});
export type Goal = z.infer<typeof zGoal>;
export const GOAL_DEFAULTS: Goal = zGoal.parse({});
```

Di `zSetting`, tambahkan baris terakhir sesudah `scheduler`:

```ts
  goal: zGoal.default(GOAL_DEFAULTS),                                     // SPEC-332 · ADR-0073 · mode goal (default mati)
```

Di `shared/src/dto.ts`, ganti varian spec (baris 191–192) menjadi:

```ts
  // SPEC-252 · ADR-0061 — model & effort per SESI: override opsional saat Start; kosong → global.
  // SPEC-332 · ADR-0073 — mode goal per SESI: `goal` undefined → ikut Setting.goal.enabled,
  // false → mati walau global nyala; `goalCondition` kosong → template global → default bawaan.
  z.object({
    spec: z.string(), flow: zFlow, model: z.string().optional(), effort: z.string().optional(),
    goal: z.boolean().optional(), goalCondition: z.string().max(4000).optional(),
  }),
```

Di `server/src/services/settings.ts`, ubah impor dan `DEFAULT_SETTING`:

```ts
import { zSetting, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, type Setting } from "@hanoman/shared";
```

```ts
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · ADR-0072 · semua knob scheduler default mati
  goal: GOAL_DEFAULTS,             // SPEC-332 · ADR-0073 · mode goal default mati
};
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run`
Expected: PASS — termasuk 6 test baru; `scheduler.test.ts` tetap hijau.

- [x] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/src/dto.ts shared/src/goal.test.ts server/src/services/settings.ts
git commit -m "feat(spec-332): kontrak Setting.goal + goal/goalCondition di POST /terminal/sessions"
```

---

### Task 4: `pty.createSession` meneruskan goal ke argv `--settings`

**Files:**
- Modify: `server/src/services/pty.ts` (`CreateOpts`, pemanggilan `guardSettings`)
- Modify: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: `guardSettings(decisionFile?, goal?)` (Task 2).
- Produces: `CreateOpts.goal?: string`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/pty.test.ts`, di dalam `describe("pty service", …)`:

```ts
  // SPEC-332 · ADR-0073 · mode goal: Stop hook bertipe prompt ikut lahir bersama sesi.
  it("goal opt menaruh Stop hook bertipe prompt di argv --settings", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("goal1", process.cwd(), { goal: "berhenti hanya bila SELESAI-332" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    const out = allData(c).replace(/\s+/g, " ");
    expect(out).toContain('"Stop"');
    expect(out).toContain('"type":"prompt"');
    expect(out).toContain("SELESAI-332");
  });

  it("tanpa goal opt tak ada hook Stop di argv", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("goal2", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).not.toContain('"Stop"');
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism -t "goal opt"`
Expected: FAIL — TypeScript menolak `goal` pada `CreateOpts` / asersi `"type":"prompt"` gagal.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/pty.ts`, ubah `CreateOpts`:

```ts
export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
  // SPEC-332 · ADR-0073 · kondisi mode goal; kosong = mode goal mati untuk sesi ini.
  goal?: string;
};
```

dan pemanggilan `guardSettings` di dalam blok `flags`:

```ts
      "--settings", JSON.stringify(guardSettings(opts.decisionFile, opts.goal)),
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism`
Expected: PASS — seluruh `pty.test.ts` termasuk 2 test baru.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(spec-332): createSession meneruskan goal ke argv --settings"
```

---

### Task 5: `armGoalInTui` — keystroke `/goal` ke pane (best-effort)

**Files:**
- Modify: `server/src/services/pty.ts` (fungsi baru + pemanggilan di akhir `createSession`)
- Modify: `server/test/pty.test.ts`

**Interfaces:**
- Consumes: `goalOneLine` dari `@hanoman/runner` (Task 1); helper internal `tmux`, `name`, `getSession`.
- Produces: `armGoalInTui(id: string, condition: string, o?: GoalArmOpts): Promise<boolean>` dan
  `type GoalArmOpts = { pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number }`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/pty.test.ts` (dan tambahkan `armGoalInTui` ke daftar impor dari `../src/services/pty`):

```ts
  // SPEC-332 · ADR-0073 · jalur KEDUA: teks `/goal …` benar-benar sampai ke pane. fake-claude
  // (`exec cat` di atas tty) memantulkan apa pun yang diketik, jadi capture-pane membuktikannya
  // tanpa memanggil claude sungguhan.
  it("armGoalInTui mengetik /goal ke pane dan meratakan kondisi multi-baris", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("goal3", process.cwd());
    const ok = await armGoalInTui(s.id, "baris satu\nbaris dua", {
      pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 30,
    });
    expect(ok).toBe(true);
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("/goal"));
    expect(allData(c).replace(/\s+/g, " ")).toContain("/goal baris satu baris dua");
  });

  it("armGoalInTui menyerah diam-diam pada sesi yang tak ada", async () => {
    expect(await armGoalInTui("tidak-ada", "kondisi", { pollMs: 5, readyTries: 2, settleMs: 5, verifyTries: 2 }))
      .toBe(false);
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism -t "armGoalInTui"`
Expected: FAIL — `armGoalInTui is not a function` / import error.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/pty.ts`, ubah impor runner menjadi:

```ts
import { guardSettings, goalOneLine, type Flow } from "@hanoman/runner";
```

Tambahkan sesudah fungsi `createSession`:

```ts
// SPEC-332 · ADR-0073 — jalur KEDUA mode goal. Hook Stop di `--settings` adalah jaminannya; ini
// murni untuk VISIBILITAS: mengetik `/goal <kondisi>` membuat Claude Code men-set `activeGoal`
// miliknya, jadi `/goal` menampilkan status dan goal ikut dipulihkan saat sesi di-resume.
// Keduanya tak saling menghapus: sumber yang dibaca `/goal` saat mencari goal lama hanya
// session hooks registry, sementara hook kita hidup di settings. Konsekuensi yang diterima sadar —
// saat keduanya terpasang, satu percobaan stop dievaluasi dua kali.
// SEKALI kirim (bukan kirim-ulang tiap percobaan): mengetik dua kali akan melahirkan dua pesan.
export type GoalArmOpts = { pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paneText = (id: string): string => {
  try { return tmux("capture-pane", "-p", "-t", name(id)); } catch { return ""; }
};

export async function armGoalInTui(id: string, condition: string, o: GoalArmOpts = {}): Promise<boolean> {
  const pollMs = o.pollMs ?? 500, readyTries = o.readyTries ?? 20;
  const settleMs = o.settleMs ?? 1200, verifyTries = o.verifyTries ?? 12;
  const line = goalOneLine(condition);
  if (!line) return false;
  // Tunggu pane menggambar sesuatu (TUI sudah hidup). Habis percobaan → kirim saja: yang hilang
  // hanyalah visibilitas, sementara jaminan sudah dipegang hook settings.
  for (let i = 0; i < readyTries; i++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    if (paneText(id).trim()) break;
    await sleep(pollMs);
  }
  await sleep(settleMs);
  const p = getSession(id);
  if (!p || p.exited) return false;
  try {
    // `-l` = literal: tmux tak menafsirkan isi kondisi sebagai nama tombol.
    tmux("send-keys", "-t", name(id), "-l", `/goal ${line}`);
    tmux("send-keys", "-t", name(id), "Enter");
  } catch { return false; }   // sesi lenyap di tengah jalan
  for (let i = 0; i < verifyTries; i++) {
    if (paneText(id).includes("/goal")) return true;
    await sleep(pollMs);
  }
  return false;
}
```

Di akhir `createSession`, tepat sebelum `return { id, projectId, … }`, tambahkan:

```ts
  // Fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam (hook settings tetap).
  if (opts.goal && !opts.command) void armGoalInTui(id, opts.goal).catch(() => { /* best-effort */ });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism`
Expected: PASS — seluruh `pty.test.ts` termasuk 2 test `armGoalInTui`.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(spec-332): armGoalInTui mengetik /goal ke pane (best-effort, visibilitas TUI)"
```

---

### Task 6: Resolusi kebijakan di `startSpecSession` + route

**Files:**
- Modify: `server/src/services/session-launch.ts`
- Modify: `server/src/routes/terminal.ts:67-69`
- Modify: `server/test/session-launch.test.ts`

**Interfaces:**
- Consumes: `resolveGoalCondition` (Task 1), `getSetting()` (`../services/settings`), `CreateOpts.goal` (Task 4).
- Produces: `startSpecSession(spec, { flow, model?, effort?, autonomy?, goal?: boolean, goalCondition?: string })`.
- Governor scheduler **tidak berubah**: ia memanggil tanpa `goal`, jadi otomatis mengikuti `Setting.goal.enabled`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-launch.test.ts` — ubah impor teratas menjadi:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/db";
import { startSpecSession, LaunchError, sessionIdForSpec } from "../src/services/session-launch";
import { killAll, killSession } from "../src/services/pty";
import { resolveGoalCondition } from "@hanoman/runner";
```

dan tambahkan blok berikut di dalam `describe("session-launch", …)`:

```ts
  // SPEC-332 · ADR-0073 · resolusi mode goal: override per sesi → template global → default bawaan.
  async function seedRepo(id: string) {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-goal-"));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "root"],
      { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    await prisma.project.create({ data: { id: "pg", name: "PG", desc: "", kind: "existing", repoDir: dir } });
    return prisma.spec.create({ data: { id, projectId: "pg", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "o" } });
  }
  const argvOf = (id: string) =>
    execFileSync("tmux", ["-L", "hanoman", "-f", "/dev/null", "list-panes", "-a", "-F", "#{session_name}\t#{pane_start_command}"],
      { encoding: "utf8" }).split("\n").find((l) => l.startsWith("hanoman-" + id)) ?? "";

  it("Setting.goal mati & tanpa override → sesi lahir tanpa hook Stop", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-G1");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(argvOf(r.id)).not.toContain('"Stop"');
    killSession(r.id);
  });

  it("goal:true memakai default bawaan; goalCondition menang atas template global", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { data: { goal: { enabled: false, condition: "TEMPLATE-GLOBAL" } } },
      create: { id: 1, data: { goal: { enabled: false, condition: "TEMPLATE-GLOBAL" } } },
    });
    const spec = await seedRepo("SPEC-G2");
    const r = await startSpecSession(spec, { flow: "feature", goal: true });
    expect(argvOf(r.id)).toContain("TEMPLATE-GLOBAL");
    killSession(r.id);
    await prisma.spec.deleteMany(); await prisma.project.deleteMany();

    const spec2 = await seedRepo("SPEC-G3");
    const r2 = await startSpecSession(spec2, { flow: "feature", goal: true, goalCondition: "KONDISI-SESI" });
    const argv = argvOf(r2.id);
    expect(argv).toContain("KONDISI-SESI");
    expect(argv).not.toContain("TEMPLATE-GLOBAL");
    killSession(r2.id);
  });

  it("goal:false mengalahkan Setting global yang menyala", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { data: { goal: { enabled: true, condition: "" } } },
      create: { id: 1, data: { goal: { enabled: true, condition: "" } } },
    });
    const spec = await seedRepo("SPEC-G4");
    const r = await startSpecSession(spec, { flow: "feature", goal: false });
    expect(argvOf(r.id)).not.toContain('"Stop"');
    killSession(r.id);
  });

  it("resolveGoalCondition dipakai apa adanya untuk branch sesi", async () => {
    expect(resolveGoalCondition({ flow: "feature", specId: "SPEC-G5", branchTo: "hanoman/spec-g5" }))
      .toContain("hanoman/spec-g5");
  });
```

Tambahkan pula pembersihan tmux ke `clean`:

```ts
const clean = async () => { killAll(); await prisma.setting.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany(); };
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/session-launch.test.ts --no-file-parallelism`
Expected: FAIL — `goal` bukan properti `opts` yang dikenal / argv tak memuat `TEMPLATE-GLOBAL`.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/session-launch.ts`, ubah impor:

```ts
import { realGit, startPrompt, continuePrompt, resolveGoalCondition, type Flow, type Autonomy } from "@hanoman/runner";
import { resolveRepoDir } from "./local-binding";
import { getSetting } from "./settings";
```

(hapus impor `sessionModel` yang tak lagi dipakai), lalu ubah tanda tangan dan blok resolusi:

```ts
export async function startSpecSession(
  spec: Spec,
  opts: {
    flow: Flow; model?: string; effort?: string; autonomy?: Autonomy;
    // SPEC-332 · ADR-0073 · mode goal per sesi. undefined → ikut Setting.goal.enabled;
    // false → mati walau global menyala. Governor scheduler tak memasoknya → ikut global.
    goal?: boolean; goalCondition?: string;
  },
): Promise<StartSpecResult> {
```

Ganti blok model/effort (`const g = await sessionModel(); …`) menjadi:

```ts
  // SPEC-252 · ADR-0061 · model/effort per SESI: default global, override per-instance opsional.
  // Satu bacaan Setting dipakai bersama resolusi mode goal di bawah.
  const setting = await getSetting();
  const model = opts.model ?? setting.model;
  const effort = opts.effort ?? setting.effort;
  const isContinue = spec.stage === "done";
  // SPEC-332 · ADR-0073 · kondisi goal: override sesi → template global → default DoD bawaan.
  const goal = (opts.goal ?? setting.goal.enabled)
    ? resolveGoalCondition(
        { flow: opts.flow, specId: spec.id, branchTo: `hanoman/${id}` },
        opts.goalCondition, setting.goal.condition)
    : undefined;
```

dan tambahkan `goal` ke pemanggilan `createSession`:

```ts
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort, goal,
```

Di `server/src/routes/terminal.ts`, teruskan field baru:

```ts
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
        });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/session-launch.test.ts test/terminal.route.test.ts --no-file-parallelism`
Expected: PASS — `session-launch` (6) dan `terminal.route` tetap hijau.

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-launch.ts server/src/routes/terminal.ts server/test/session-launch.test.ts
git commit -m "feat(spec-332): resolusi mode goal di startSpecSession (manual + scheduler)"
```

---

### Task 7: UI — toggle mode goal di modal "Mulai sesi"

**Files:**
- Modify: `src/src/api/client.ts:179-181`
- Modify: `src/src/App.tsx:46-86` (`StartSessionModal`)
- Create: `src/test/start-session-goal.test.tsx`

**Interfaces:**
- Consumes: `api.getSettings()` (mengembalikan `Setting` dengan `goal`), `api.startSession`.
- Produces: `api.startSession(b: { spec; flow; model?; effort?; goal?: boolean; goalCondition?: string })`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/start-session-goal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StartSessionModal } from "../src/App";
import * as api from "../src/api/client";

const spec: any = { id: "SPEC-332", source: "brief", title: "t", stage: "planned" };
const settings: any = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: true, condition: "TEMPLATE-GLOBAL" },
};

beforeEach(() => { vi.restoreAllMocks(); });

describe("StartSessionModal · mode goal", () => {
  it("prefill dari Setting global dan mengirim goal + goalCondition", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const start = vi.spyOn(api, "startSession").mockResolvedValue({ id: "spec-332" } as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByDisplayValue("TEMPLATE-GLOBAL")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ spec: "SPEC-332", goal: true, goalCondition: "TEMPLATE-GLOBAL" })));
  });

  it("toggle mati → goal:false dan kondisi tak dikirim", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const start = vi.spyOn(api, "startSession").mockResolvedValue({ id: "spec-332" } as any);
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Mulai"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ goal: false, goalCondition: undefined })));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/start-session-goal.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "switch"`.

- [x] **Step 3: Implementasi minimal**

Di `src/src/api/client.ts`, ubah tanda tangan `startSession`:

```ts
  // SPEC-252 · ADR-0061 · model/effort per sesi (opsional; kosong → default global di server).
  // SPEC-332 · ADR-0073 · mode goal per sesi (opsional; kosong → default global di server).
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string }) =>
```

(biarkan badan fungsi apa adanya).

Di `src/src/App.tsx`, pastikan `Switch` dan `HnTextarea` ada di impor design-system, lalu ubah `StartSessionModal`:

```tsx
export function StartSessionModal({ open, spec, onClose, onStarted, onError }:
  { open: boolean; spec: Spec | null; onClose: () => void; onStarted: (id: string) => void; onError?: (e: unknown) => void }) {
  const [model, setModel] = React.useState("claude-opus-5");
  const [effort, setEffort] = React.useState("xhigh");
  // SPEC-332 · ADR-0073 · mode goal per sesi. Prefill dari default global; kondisi kosong =
  // pakai template DoD bawaan hanoman (dirakit di server).
  const [goalOn, setGoalOn] = React.useState(false);
  const [goalCond, setGoalCond] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => {
      setModel(s.model); setEffort(s.effort);
      setGoalOn(s.goal.enabled); setGoalCond(s.goal.condition);
    }).catch(() => {});
  }, [open]);
  if (!spec) return null;
  const s = spec;
  const flow = flowForSource(s.source);
  async function start() {
    setBusy(true);
    try {
      const { id } = await api.startSession({
        spec: s.id, flow, model, effort,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
      });
      onStarted(id); onClose();
    }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} icon="play" eyebrow={`${s.id} · ${flow}`} title="Mulai sesi"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={busy} onClick={start}>Mulai</Button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Model & effort untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan pilihan
        ini untuk seluruh hidupnya (satu proses) — <code>/model</code> di terminal tetap bisa mengubahnya.
      </div>
      <Field label="Model">
        <Select aria-label="Model" value={model} style={{ width: "100%" }}
          options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} style={{ width: "100%" }}
          options={EFFORTS.map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
      <Field label="Mode goal"
        hint="Sesi menolak berhenti sampai kondisinya terbukti. Kosongkan kondisi untuk memakai bawaan hanoman: semua fase tercatat, plan tak menyisakan task, push sukses.">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: goalOn ? 10 : 0 }}>
          <Switch checked={goalOn} onChange={(v: boolean) => setGoalOn(v)} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{goalOn ? "aktif" : "nonaktif"}</span>
        </div>
        {goalOn && <HnTextarea value={goalCond} rows={4} mono
          placeholder="Kosong = kondisi bawaan hanoman"
          onChange={(v: string) => setGoalCond(v)} />}
      </Field>
    </Modal>
  );
}
```

Catatan: `HnTextarea` menerima `onChange(value: string)`. Bila tanda tangannya di `kit.tsx` berbeda, sesuaikan pemanggilannya — jangan mengubah komponen design-system.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/start-session-goal.test.tsx`
Expected: PASS — 2 test.

- [x] **Step 5: Commit**

```bash
git add src/src/App.tsx src/src/api/client.ts src/test/start-session-goal.test.tsx
git commit -m "feat(spec-332): toggle mode goal + kondisi di modal Mulai sesi"
```

---

### Task 8: UI — kartu "Mode goal" di Settings

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx` (`S_DEFAULTS` + cabang `tab === "sesi"`)
- Create: `src/test/settings-goal.test.tsx`

**Interfaces:**
- Consumes: `api.getSettings()`, `api.putSettings()`, `Setting.goal` (Task 3).
- Produces: —

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/settings-goal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import * as api from "../src/api/client";

const settings: any = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
};

beforeEach(() => { vi.restoreAllMocks(); });

describe("SettingsScreen · kartu mode goal", () => {
  it("menyalakan default global mode goal → PUT settings", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const put = vi.spyOn(api, "putSettings").mockResolvedValue(settings);
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByText("Sesi"));
    const sw = await screen.findByLabelText("Mode goal default");
    fireEvent.click(sw);
    await waitFor(() => expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ goal: { enabled: true, condition: "" } })));
  });
});
```

Catatan: bila `SettingsScreen` butuh props wajib (mis. `me`/`onToast`), pasok stub minimal di `render` — baca tanda tangan komponennya lebih dulu, dan sesuaikan label tab ("Sesi") dengan yang benar-benar dirender.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/settings-goal.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Mode goal default`.

- [x] **Step 3: Implementasi minimal**

Di `src/src/screens/SettingsScreen.tsx`, tambahkan impor `GOAL_DEFAULTS` dari `@hanoman/shared` bersama `SCHEDULER_DEFAULTS`, lalu lengkapi `S_DEFAULTS`:

```ts
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · knob scheduler (panel dibangun daun #6)
  goal: GOAL_DEFAULTS,             // SPEC-332 · ADR-0073 · mode goal (default mati)
};
```

Ganti cabang terakhir (`return ( // sesi`) menjadi fragment dua kartu:

```tsx
    return ( // sesi
      <>
        <Card eyebrow="sesi" title="Sesi & notifikasi">
          {/* … isi kartu yang sudah ada, TIDAK diubah … */}
        </Card>
        {/* SPEC-332 · ADR-0073 · mode goal: Claude Code menolak berhenti sampai kondisi terbukti.
            Ini default global untuk sesi backlog; setiap Start masih bisa meng-override. */}
        <Card eyebrow="goal" title="Mode goal — sesi backlog">
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Sesi backlog lahir dengan gate <code>Stop</code>: ia menolak berhenti sampai kondisinya terbukti
            di transkrip. Interupsi manusia (<code>Esc</code>) tetap bekerja; melepas gate sepenuhnya =
            hentikan sesinya. Sesi scheduler mengikuti setelan ini.
          </div>
          <SettingRow title="Aktif sebagai default"
            desc="Sesi backlog baru lahir dengan mode goal. Masih bisa dimatikan per sesi saat Start.">
            <Switch aria-label="Mode goal default" checked={s.goal.enabled}
              onChange={(v: boolean) => save({ goal: { ...s.goal, enabled: v } },
                "Mode goal" + (v ? " · aktif" : " · nonaktif"))} />
          </SettingRow>
          <SettingRow title="Kondisi (template global)" last
            desc="Kosong = kondisi bawaan hanoman: semua fase tercatat di phase file, plan tak menyisakan task, push sukses.">
            <div style={{ width: 320 }}>
              <HnTextarea value={s.goal.condition} rows={4} mono
                placeholder="Kosong = kondisi bawaan hanoman"
                onChange={(v: string) => persist({ ...s, goal: { ...s.goal, condition: v } })} />
            </div>
          </SettingRow>
        </Card>
      </>
    );
```

Pastikan `HnTextarea` ikut diimpor dari `../ds`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman-web exec vitest run test/settings-goal.test.tsx`
Expected: PASS — 1 test.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-goal.test.tsx
git commit -m "feat(spec-332): kartu Mode goal di Settings (default global)"
```

---

### Task 9: Docs Source of Truth — ADR-0073 + kontrak + index

**Files:**
- Create: `internal/docs/adr/0073-mode-goal-stop-hook-per-sesi.md`
- Modify: `internal/docs/README.md` (bagian `## adr`, baris pertama daftar)
- Modify: `internal/docs/architecture/api-contract.md` (body `POST /terminal/sessions` + `PUT /settings`)
- Modify: `internal/docs/architecture/data-model.md` (blok JSON `Setting`)
- Modify: `internal/skills/hanoman/SKILL.md` (Aturan Sesi & Eksekusi)

**Interfaces:**
- Consumes: seluruh keputusan Task 1–8.
- Produces: dokumen SoT; tak ada kode.

- [x] **Step 1: Tulis ADR-0073**

Buat `internal/docs/adr/0073-mode-goal-stop-hook-per-sesi.md` dengan bagian: Status (accepted, 2026-07-26) · Konteks · Keputusan · Konsekuensi · Alternatif yang ditolak. Isi wajib memuat:

- Mesin `/goal` Claude Code = Stop hook bertipe `prompt`; tipe hook itu warga kelas satu di `--settings`; tak ada flag CLI `--goal`; batas kondisi 4000 karakter.
- Evaluator hook `prompt` menilai **hanya dari transkrip** (`{"ok":bool,"reason":string}`, model kecil-cepat) dan transkrip panjang dipotong → kondisi hanoman menuntut bukti segar.
- Dua jalur sadar: hook `--settings` (jaminan, saat sesi lahir) + keystroke `/goal` (visibilitas TUI, best-effort). Sumber yang dibaca `/goal` hanya session hooks registry → keduanya tak saling hapus; saat keduanya terpasang, satu percobaan stop dievaluasi dua kali.
- **ADR-0037 tidak dibalik**: ini gate kelanjutan di event `Stop`, bukan deny PreToolUse; `runner/src/safety.ts` tetap tiada; isolasi worktree tetap satu-satunya batas keamanan.
- Memperkuat ADR-0035 (otonomi lintas-fase jadi mekanisme) dan memberi cermin runtime bagi ADR-0029 (gate plan terceklist); mengikuti pola ADR-0061 (knob dipilih saat Start → argv saat lahir).
- Cakupan sesi backlog saja; default mati; tanpa migration (blok JSON `Setting.goal`).
- Konsekuensi negatif yang diterima: evaluasi ganda, `/goal clear` tak melepas hook settings, biaya model kecil per percobaan stop.

- [x] **Step 2: Tautkan di index**

Di `internal/docs/README.md`, sisipkan sebagai baris **pertama** daftar `## adr` (di atas 0072):

```md
- [0073 — Mode goal sesi backlog: Stop hook bertipe `prompt` saat sesi lahir + keystroke `/goal`](adr/0073-mode-goal-stop-hook-per-sesi.md) — **memperkuat 0035**, memberi cermin runtime bagi 0029, mengikuti pola 0061, **tidak membalik 0037** (SPEC-332): `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt"}]` ke `--settings` (jaminan) + `armGoalInTui` mengetik `/goal` ke pane (visibilitas TUI); knob `Setting.goal` + `goal`/`goalCondition` di `POST /terminal/sessions`; default mati, tanpa migration
```

- [x] **Step 3: Perbarui kontrak API & data model**

Di `internal/docs/architecture/api-contract.md`, pada entri `POST /terminal/sessions`, tambahkan field opsional `goal` (boolean) dan `goalCondition` (string ≤ 4000) untuk varian backlog, dengan catatan presedens `override → template global → default bawaan` dan bahwa `goal:false` mengalahkan Setting global. Pada entri `GET/PUT /settings`, tambahkan blok `goal: { enabled, condition }`.

Di `internal/docs/architecture/data-model.md`, pada bagian `Setting` (kolom `data` Json), tambahkan blok `goal` sejajar `scheduler`, catat default mati dan bahwa ia tak menambah kolom/migration.

- [x] **Step 4: Perbarui skill project**

Di `internal/skills/hanoman/SKILL.md`, bagian **Aturan Sesi & Eksekusi**, tambahkan satu butir:

```md
- **Mode goal per sesi backlog** (SPEC-332/ADR-0073): sesi bisa lahir membawa gate `Stop` — `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` ke `--settings` (mesin yang sama dipasang `/goal`), plus keystroke `/goal` best-effort ke pane untuk visibilitas TUI. Kondisi default = DoD hanoman (semua fase tercatat di phase file, plan tak menyisakan `- [ ]`, push sukses) dan menuntut BUKTI SEGAR karena evaluator hook hanya membaca transkrip. Knob `Setting.goal` (default mati) + override `goal`/`goalCondition` saat Start; sesi scheduler mengikuti default global. Bukan guardrail deny — ADR-0037 tetap berlaku.
```

- [x] **Step 5: Verifikasi index & commit**

Run: `node --experimental-strip-types cli/src/index.ts docs index --check` (atau `hanoman docs index --check` bila CLI terpasang)
Expected: index konsisten, exit 0.

```bash
git add internal/docs/adr/0073-mode-goal-stop-hook-per-sesi.md internal/docs/README.md \
  internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md \
  internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-332): ADR-0073 mode goal + kontrak API, data model, skill project"
```

---

### Task 10: Verifikasi nyata — suite penuh, smoke server, smoke `claude`

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-backlog-goal-mode-spec-332.md` (centang seluruh kotak)

**Interfaces:**
- Consumes: seluruh Task 1–9.
- Produces: bukti bahwa gate benar-benar menahan stop pada CLI terpasang.

- [x] **Step 1: Typecheck seluruh workspace**

Run: `pnpm -r exec tsc --noEmit`
Expected: exit 0, tanpa error. (Jangan pakai `tsc -p .` tanpa `--noEmit` — ia menulis `.js`/`.d.ts` ke `src/`.)

- [x] **Step 2: Suite penuh**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm vitest run --no-file-parallelism`
Expected: seluruh paket hijau. Bila `server` gagal karena DB dipakai sesi lain, jalankan ulang dengan basis khusus:
`DATABASE_URL=postgresql://hanoman:hanoman@127.0.0.1:5433/hanoman332 env -u NODE_ENV pnpm --filter @hanoman/server exec vitest run --no-file-parallelism`
(sebelumnya: `createdb`/`prisma migrate deploy` untuk `hanoman332_test`).

- [x] **Step 3: Smoke server + curl (WAJIB per CLAUDE.md)**

```bash
# DB khusus smoke — jangan pakai hanoman_test (sesi lain memangkasnya di tengah jalan)
export DATABASE_URL='postgresql://hanoman:hanoman@127.0.0.1:5433/hanoman332'
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman332;' || true
pnpm --filter @hanoman/server exec prisma migrate deploy
pnpm --filter @hanoman/server exec prisma generate
pnpm --filter @hanoman/server run build
PORT=8799 node server/dist/server.js &
# bootstrap akun + login (cookie), lalu:
curl -s -b c.txt -X PUT localhost:8799/api/settings -H 'content-type: application/json' \
  -d '{"model":"claude-opus-5","effort":"xhigh","autoDefault":true,"autoScaffold":true,"notifyFail":true,"notifyDone":true,"notifySound":"short","notifyDecision":true,"notifyDecisionSound":"alert","agentAccessEnabled":false,"goal":{"enabled":true,"condition":""}}'
curl -s -b c.txt localhost:8799/api/settings | grep -o '"goal":{[^}]*}'
# spec + project ber-repoDir sudah di-seed → start sesi, lalu buktikan hook Stop ada di argv:
curl -s -b c.txt -X POST localhost:8799/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"spec":"SPEC-SMOKE","flow":"feature","goal":true,"goalCondition":"SMOKE-332"}'
tmux -L hanoman -f /dev/null list-panes -a -F '#{pane_start_command}' | grep -c 'SMOKE-332'
```

Expected: `GET /settings` mengembalikan blok `goal`; `POST /terminal/sessions` → 201; `grep -c` ≥ 1.
Bersihkan sesudahnya: `tmux -L hanoman kill-server`, hentikan server, `DROP DATABASE hanoman332`.

- [x] **Step 4: Smoke `claude` nyata — buktikan gate menahan stop**

```bash
cd "$(mktemp -d)" && git init -q .
claude --debug hooks --dangerously-skip-permissions \
  --settings '{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"Kondisi terpenuhi HANYA bila transkrip memuat kata SUDAH-SELESAI-332. Jika belum ada, ok:false."}]}]}}' \
  -p 'Balas dengan satu kata: halo' 2>&1 | tail -40
```

Expected: log memuat `Hooks: Processing prompt hook with prompt:` dan `Hooks: Prompt hook condition was not met` (atau agen melanjutkan giliran alih-alih berhenti) — membuktikan hook `prompt` dari `--settings` benar-benar dieksekusi pada event Stop di CLI terpasang. Catat keluaran nyatanya di pesan commit. Bila ternyata TIDAK dieksekusi, **hentikan dan laporkan** — jalur keystroke (Task 5) menjadi satu-satunya mekanisme dan design harus ditinjau ulang.

- [x] **Step 5: Centang plan, commit, push**

```bash
git add docs/superpowers/plans/2026-07-26-backlog-goal-mode-spec-332.md
git commit -m "chore(spec-332): tandai plan selesai + hasil verifikasi nyata"
git push origin HEAD:refs/heads/hanoman/spec-332
```

---

## Self-Review

**Spec coverage:** Lapis 1 → Task 1–2 · Lapis 2 (settings hook) → Task 4 · Lapis 3 (keystroke) → Task 5 · Lapis 4 (kebijakan) → Task 6 · kontrak/penyimpanan → Task 3 · UI modal → Task 7 · UI Settings → Task 8 · docs+ADR → Task 9 · testing & smoke nyata → Task 10. Non-goals tidak dikerjakan (tak ada task untuk `prd`/`reverse`/hook `agent`/tombol lepas-goal).

**Type consistency:** `GoalArgs { flow, specId, branchTo }` dipakai identik di Task 1 dan Task 6. `resolveGoalCondition(a, override, template)` — urutan argumen sama di kedua tempat. `guardSettings(decisionFile?, goal?)` dipanggil dengan urutan itu di Task 4. `Setting.goal.{enabled,condition}` konsisten di Task 3/6/7/8. `armGoalInTui(id, condition, GoalArmOpts)` sama di Task 5 dan testnya.
