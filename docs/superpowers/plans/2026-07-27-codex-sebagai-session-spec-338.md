# Codex sebagai mesin sesi (SPEC-338) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman bisa menjalankan sesi development memakai Codex CLI dengan perilaku setara Claude Code — dari setelan global, picker saat Start, sampai fase/stage/marker keputusan/mode goal.

**Architecture:** `Agent = "claude" | "codex"` jadi dimensi baru sesi. Perakitan argv dipindah dari `pty.ts` ke modul murni `runner/src/agent-cli.ts`; hook codex (padanan `--settings` claude) dibangun `runner/src/codex-settings.ts` dan disuntik lewat `-c hooks.<Event>=…`. Mode goal codex adalah **gate deterministik**: skrip sh yang memeriksa phase file + checkbox plan, exit 2 bila belum → codex dipaksa lanjut. Semua lapis di atas spawn (prompt, phase file, stage machine, review, integrate) tak berubah.

**Tech Stack:** TypeScript strict (ESM), Fastify, Prisma/Postgres, zod (`@hanoman/shared`), node-pty + tmux, React + Vite, vitest.

## Global Constraints

- **Tanpa migration.** `Setting` adalah kolom `Json` — knob baru ditambahkan lewat `.default()` di `zSetting` supaya baris lama tetap parse (pola SPEC-294 `scheduler` & SPEC-332 `goal`).
- **Bahasa komentar & teks UI: Indonesia**, mengikuti seluruh repo.
- **Test repo:** `env -u NODE_ENV -u DATABASE_URL pnpm test` dengan `vitest run --no-file-parallelism`.
- **Docs Source of Truth diperbarui dalam commit yang sama** dan ter-link di `internal/docs/README.md` (ADR-0023).
- **ADR baru = 0074** (0073 terpakai; sudah dienumerasi lintas semua branch).
- Nilai flag codex yang sudah diverifikasi di codex-cli 0.142.5: model slug `gpt-5.5` · `gpt-5.4` · `gpt-5.4-mini` · `gpt-5.3-codex-spark`; effort `low|medium|high|xhigh`; flag `-m`, `-c model_reasoning_effort="<v>"`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `-c hooks.<Event>=[{hooks=[{type="command",command="…"}]}]`.
- **Jangan hidupkan kembali guardrail deny** (ADR-0037). Hook codex yang dipasang hanya marker keputusan + gate goal; tak ada satu pun yang menolak tool call.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/enums.ts` (modify) | `zAgent` — enum validasi agen |
| `shared/src/entities.ts` (modify) | `zCodex`/`CODEX_DEFAULTS`, `CODEX_MODELS`, `CODEX_EFFORTS`, `zSetting.agent` + `zSetting.codex` |
| `shared/src/dto.ts` (modify) | `zTerminalSession` varian spec menerima `agent?` |
| `shared/src/config-registry.ts` (modify) | knob `HANOMAN_CODEX_BIN` |
| `runner/src/types.ts` (modify) | `export type Agent` (cermin `Flow`, dipakai lapis runner/server) |
| `runner/src/codex-settings.ts` (create) | hook codex: marker keputusan (Stop+UserPromptSubmit) & gate goal; generator skrip gate |
| `runner/src/agent-cli.ts` (create) | `agentFlags()` — flag argv per agen, murni & tanpa I/O |
| `server/src/services/codex-trust.ts` (create) | `ensureCodexTrust(repoDir)` — entri `[projects."…"]` di config codex |
| `server/src/services/pty.ts` (modify) | pakai `agentFlags`, tulis skrip gate, simpan `@hanoman_agent` |
| `server/src/services/settings.ts` (modify) | `DEFAULT_SETTING` + helper `sessionAgent()` |
| `server/src/services/session-launch.ts` (modify) | resolusi agen + model/effort per agen |
| `server/src/routes/terminal.ts` (modify) | teruskan `agent` (spec) & pakai default global (project-level) |
| `src/src/screens/SettingsScreen.tsx` (modify) | kartu "Agen sesi" |
| `src/src/App.tsx` (modify) | picker Agen di `StartSessionModal` |
| `internal/docs/adr/0074-*.md` (create) | ADR keputusan |
| `internal/docs/{README,architecture/stack,architecture/api-contract}.md` (modify) | SoT |
| `internal/skills/hanoman/SKILL.md` (modify) | aturan sesi & eksekusi |

---

### Task 1: `Agent` + setelan codex di `@hanoman/shared`

**Files:**
- Modify: `shared/src/enums.ts`
- Modify: `shared/src/entities.ts:42-92`
- Modify: `shared/src/dto.ts:194-197`
- Modify: `shared/src/config-registry.ts:25`
- Test: `shared/src/agent-session.test.ts` (create)

**Interfaces:**
- Consumes: —
- Produces: `zAgent`, `CODEX_MODELS`, `CODEX_EFFORTS`, `zCodex`, `CODEX_DEFAULTS: { model: "gpt-5.5"; effort: "xhigh" }`, `Setting.agent: "claude"|"codex"`, `Setting.codex: { model: string; effort: string }`, `zTerminalSession` varian spec dengan `agent?: "claude"|"codex"`.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/agent-session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zAgent, zCodex, CODEX_DEFAULTS, CODEX_MODELS, CODEX_EFFORTS, zSetting } from "./entities";
import { zTerminalSession } from "./dto";

describe("SPEC-338 · agent sesi", () => {
  it("zAgent hanya menerima claude|codex", () => {
    expect(zAgent.parse("claude")).toBe("claude");
    expect(zAgent.parse("codex")).toBe("codex");
    expect(zAgent.safeParse("gemini").success).toBe(false);
  });

  it("default codex = gpt-5.5 / xhigh", () => {
    expect(CODEX_DEFAULTS).toEqual({ model: "gpt-5.5", effort: "xhigh" });
    expect(zCodex.parse({})).toEqual(CODEX_DEFAULTS);
  });

  it("katalog codex memuat slug & effort yang didukung CLI", () => {
    expect(CODEX_MODELS.map((m) => m.id)).toContain("gpt-5.5");
    expect(CODEX_EFFORTS).toEqual(["xhigh", "high", "medium", "low"]);
  });

  // Baris Setting lama (tanpa blok codex/agent) HARUS tetap parse — tanpa migration.
  it("Setting lama tetap parse dengan default claude", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short",
      notifyDecision: true, notifyDecisionSound: "alert",
    };
    const parsed = zSetting.parse(old);
    expect(parsed.agent).toBe("claude");
    expect(parsed.codex).toEqual(CODEX_DEFAULTS);
  });

  it("POST /terminal/sessions varian spec menerima agent opsional", () => {
    const ok = zTerminalSession.safeParse({ spec: "SPEC-338", flow: "feature", agent: "codex" });
    expect(ok.success && "agent" in ok.data && ok.data.agent).toBe("codex");
    const tanpa = zTerminalSession.safeParse({ spec: "SPEC-338", flow: "feature" });
    expect(tanpa.success && "agent" in tanpa.data && tanpa.data.agent).toBe(undefined);
    expect(zTerminalSession.safeParse({ spec: "S", flow: "feature", agent: "gemini" }).success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run src/agent-session.test.ts`
Expected: FAIL — `zAgent`/`zCodex`/`CODEX_DEFAULTS` tidak diekspor.

- [x] **Step 3: Tambahkan `zAgent` di `shared/src/enums.ts`**

Sisipkan setelah `zProjectKind` (baris 6):

```ts
// SPEC-338 · ADR-0074 · mesin sesi. claude = Claude Code (default & historis), codex = Codex CLI.
export const zAgent = z.enum(["claude", "codex"]);
```

- [x] **Step 4: Tambahkan katalog & knob codex di `shared/src/entities.ts`**

Tambahkan `zAgent` ke import baris 2:

```ts
import { zStage, zSpecSource, zDocStatus, zPriority, zProjectKind, zAgent } from "./enums";
export { zAgent };
export type Agent = z.infer<typeof zAgent>;
```

Sisipkan setelah `EFFORTS` (baris 48):

```ts
// SPEC-338 · ADR-0074 · katalog codex, cermin MODELS/EFFORTS milik claude. Slug diteruskan apa
// adanya ke `codex -m`; effort ke `-c model_reasoning_effort="<v>"` (codex tak punya flag --effort).
// Diverifikasi terhadap `codex debug models` (codex-cli 0.142.5).
export const CODEX_MODELS = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
] as const;
export const CODEX_EFFORTS = ["xhigh", "high", "medium", "low"] as const;

// Default model/effort codex. Model/effort claude sengaja TETAP di `Setting.model`/`Setting.effort`
// (kontrak GET /settings + baris lama), jadi blok ini hanya untuk codex.
export const zCodex = z.object({
  model: z.string().default("gpt-5.5"),
  effort: z.string().default("xhigh"),
});
export type Codex = z.infer<typeof zCodex>;
export const CODEX_DEFAULTS: Codex = zCodex.parse({});
```

Sisipkan dua field ke `zSetting` (setelah `goal`, baris 90):

```ts
  agent: zAgent.default("claude"),                                        // SPEC-338 · ADR-0074 · agen default sesi baru
  codex: zCodex.default(CODEX_DEFAULTS),                                  // SPEC-338 · ADR-0074 · model/effort codex
```

- [x] **Step 5: Terima `agent` di `zTerminalSession` (`shared/src/dto.ts`)**

Ganti varian spec (baris 194-197) menjadi:

```ts
  // SPEC-338 · ADR-0074 — agen per SESI: undefined → ikut Setting.agent (default global).
  z.object({
    spec: z.string(), flow: zFlow, model: z.string().optional(), effort: z.string().optional(),
    goal: z.boolean().optional(), goalCondition: z.string().max(4000).optional(),
    agent: zAgent.optional(),
  }),
```

Tambahkan `zAgent` ke import zod-enum di kepala `dto.ts` (baris 2 mengimpor dari `./enums`):

```ts
import { zStage, zSpecSource, zDocStatus, zPriority, zProjectKind, zAgent } from "./enums";
```

- [x] **Step 6: Daftarkan knob biner codex (`shared/src/config-registry.ts`)**

Sisipkan tepat setelah baris `HANOMAN_CLAUDE_BIN` (baris 25):

```ts
  // codex (SPEC-338 · ADR-0074)
  { key: "HANOMAN_CODEX_BIN", group: "claude", label: "Biner codex", kind: "path", apply: "new-session", category: "knob", default: "codex" },
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/shared exec vitest run`
Expected: PASS — seluruh test shared hijau (termasuk `goal.test.ts` & `scheduler.test.ts` yang menguji kompatibilitas mundur `zSetting`).

- [x] **Step 8: Commit**

```bash
git add shared/src/enums.ts shared/src/entities.ts shared/src/dto.ts shared/src/config-registry.ts shared/src/agent-session.test.ts
git commit -m "feat(spec-338): Agent claude|codex + setelan codex di shared"
```

---

### Task 2: Hook codex — `runner/src/codex-settings.ts`

**Files:**
- Create: `runner/src/codex-settings.ts`
- Modify: `runner/src/types.ts:6`
- Modify: `runner/src/index.ts`
- Test: `runner/test/codex-settings.test.ts` (create)

**Interfaces:**
- Consumes: `Flow`, `PIPELINES` dari `runner/src/prompt.ts`.
- Produces:
  - `type Agent = "claude" | "codex"` (di `types.ts`)
  - `codexHookArgs(o: { decisionFile?: string; goalGate?: string }): string[]` — daftar elemen argv (`-c`, `hooks.X=…`, …), siap dikutip pemanggil.
  - `codexGoalScript(o: { flow: Flow; specId: string; phaseFile: string; worktree: string; condition: string; maxBlocks?: number; stateFile: string }): string` — isi skrip sh gate.
  - `GOAL_MAX_BLOCKS = 25`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/codex-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexHookArgs, codexGoalScript, GOAL_MAX_BLOCKS } from "../src/codex-settings";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-cx-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// Menjalankan skrip gate apa adanya lewat /bin/sh. Mengembalikan {code, stderr}.
function runGate(script: string): { code: number; stderr: string } {
  const f = join(dir, "gate.sh");
  writeFileSync(f, script, { mode: 0o755 });
  try {
    execFileSync("/bin/sh", [f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? "" };
  }
}

const gate = (over: Partial<Parameters<typeof codexGoalScript>[0]> = {}) => codexGoalScript({
  flow: "feature", specId: "SPEC-338",
  phaseFile: join(dir, "phases"), worktree: join(dir, "wt"),
  condition: "KONDISI-GOAL-338", stateFile: join(dir, "state"), ...over,
});

describe("codexHookArgs", () => {
  it("marker keputusan: Stop menulis, UserPromptSubmit mengosongkan", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1" });
    const joined = args.join(" ");
    expect(joined).toContain("hooks.Stop=");
    expect(joined).toContain("hooks.UserPromptSubmit=");
    expect(joined).toContain("'/tmp/d1'");
    // Hook codex hanya mendukung type="command" (type="prompt" didiamkan CLI).
    expect(joined).toContain('type="command"');
    expect(joined).not.toContain('type="prompt"');
  });

  it("tanpa decisionFile & tanpa goalGate tak menghasilkan argumen hook", () => {
    expect(codexHookArgs({})).toEqual([]);
  });

  it("goalGate ikut sebagai entri Stop tambahan", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1", goalGate: "/tmp/g1.sh" });
    const stop = args.find((a) => a.startsWith("hooks.Stop="))!;
    expect(stop).toContain("/tmp/d1");
    expect(stop).toContain("/tmp/g1.sh");
  });

  it("setiap nilai hook didahului flag -c tersendiri", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1" });
    expect(args.filter((a) => a === "-c").length).toBe(2);
    expect(args.length).toBe(4);
  });
});

describe("codexGoalScript", () => {
  it("memblok (exit 2) saat phase file kosong, alasan memuat kondisi", () => {
    writeFileSync(join(dir, "phases"), "");
    const r = runGate(gate());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("KONDISI-GOAL-338");
    expect(r.stderr).toContain("Brainstorm");
  });

  it("meloloskan (exit 0) saat semua fase tercatat & tak ada plan tersisa", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec skipped\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [x] beres\n");
    expect(runGate(gate()).code).toBe(0);
  });

  it("memblok saat plan spec ini masih punya - [ ]", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [ ] belum\n");
    const r = runGate(gate());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("- [ ]");
  });

  it("mengabaikan plan milik spec lain", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-01-lain-spec-299.md"), "- [ ] belum\n");
    expect(runGate(gate()).code).toBe(0);
  });

  it("flow tanpa Plan+Execute tak menggerbang plan sama sekali", () => {
    writeFileSync(join(dir, "phases"), "Audit done\nLaporan done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [ ] belum\n");
    expect(runGate(gate({ flow: "audit" })).code).toBe(0);
  });

  it("melepas gate sesudah GOAL_MAX_BLOCKS penolakan (pagar anti-loop)", () => {
    writeFileSync(join(dir, "phases"), "");
    const s = gate();
    for (let i = 0; i < GOAL_MAX_BLOCKS; i++) expect(runGate(s).code).toBe(2);
    expect(runGate(s).code).toBe(0);   // pagar: berhenti memaksa, serahkan ke manusia
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/codex-settings.test.ts`
Expected: FAIL — modul `../src/codex-settings` tidak ada.

- [x] **Step 3: Tambahkan tipe `Agent` di `runner/src/types.ts`**

Sisipkan setelah `Autonomy` (baris 6):

```ts
// SPEC-338 · ADR-0074 · mesin sesi. Cermin `zAgent` di @hanoman/shared (pola yang sama dipakai
// Flow/zFlow): zod untuk validasi di batas HTTP, union TS untuk lapis runner/server.
export type Agent = "claude" | "codex";
```

- [x] **Step 4: Tulis `runner/src/codex-settings.ts`**

```ts
import { PIPELINES } from "./prompt";
import type { Flow } from "./types";

// SPEC-338 · ADR-0074 — padanan `guardSettings()` milik claude untuk Codex CLI.
//
// Perbedaan mekanis yang menentukan bentuk berkas ini (diverifikasi di codex-cli 0.142.5):
//   1. Codex tak punya `--settings <json>`. Hook disuntik lewat `-c hooks.<Event>=<toml>`,
//      satu flag `-c` per event; nilainya di-parse sebagai TOML.
//   2. Codex TIDAK punya event `Notification`. Padanan "sesi menunggu manusia" yang tersedia
//      adalah `Stop` (right before Codex ends its turn) — turn berakhir = giliran manusia.
//   3. Handler bertipe `prompt` DIDIAMKAN codex; hanya `type="command"` yang benar-benar
//      terpasang. Karena itu mode goal di sini deterministik (skrip sh), bukan evaluator prosa.

// Kutip aman untuk string di dalam TOML (nilai hook = perintah shell).
const tq = (s: string): string => `"${s.split("\\").join("\\\\").split('"').join('\\"')}"`;
// Kutip aman untuk path di dalam perintah shell.
const shq = (s: string): string => `'${s.split("'").join("'\\''")}'`;

const group = (commands: string[]): string =>
  `[{hooks=[${commands.map((c) => `{type="command",command=${tq(c)}}`).join(",")}]}]`;

/**
 * Argumen argv hook codex — daftar datar `["-c", "hooks.X=…", "-c", "hooks.Y=…"]`.
 * Pemanggil (pty) yang mengutipnya untuk tmux. Kosong bila tak ada yang perlu dipasang.
 */
export function codexHookArgs(o: { decisionFile?: string; goalGate?: string }): string[] {
  const stop: string[] = [];
  const submit: string[] = [];
  // SPEC-184 · marker keputusan. Berbeda dari claude, tak ada teks notifikasi untuk di-grep:
  // Stop SELALU berarti turn berakhir, jadi marker langsung ditulis.
  if (o.decisionFile) {
    stop.push(`echo waiting >> ${shq(o.decisionFile)}`);
    submit.push(`: > ${shq(o.decisionFile)}`);
  }
  // SPEC-332/338 · gate mode goal — entri Stop kedua, berdampingan dengan marker.
  if (o.goalGate) stop.push(`sh ${shq(o.goalGate)}`);
  const args: string[] = [];
  if (stop.length) args.push("-c", `hooks.Stop=${group(stop)}`);
  if (submit.length) args.push("-c", `hooks.UserPromptSubmit=${group(submit)}`);
  return args;
}

// Pagar anti-loop. Gate deterministik tak pernah "cukup puas" seperti evaluator prosa claude:
// bila agen benar-benar mentok (mis. plan mustahil diselesaikan), memaksa terus hanya membakar
// token tanpa kemajuan. Sesudah sekian penolakan, gate melepas dan menyerahkan ke manusia.
export const GOAL_MAX_BLOCKS = 25;

/** Isi skrip sh gate mode goal untuk sesi codex. Dipanggil sebagai Stop hook. */
export function codexGoalScript(o: {
  flow: Flow; specId: string; phaseFile: string; worktree: string;
  condition: string; stateFile: string; maxBlocks?: number;
}): string {
  const phases = PIPELINES[o.flow];
  const planGate = phases.includes("Plan") && phases.includes("Execute");
  const max = o.maxBlocks ?? GOAL_MAX_BLOCKS;
  const lines = [
    "#!/bin/sh",
    "# hanoman SPEC-338 · ADR-0074 — gate mode goal sesi codex (deterministik).",
    "# exit 0 = boleh berhenti; exit 2 = stderr jadi continuation prompt, codex lanjut.",
    `PF=${shq(o.phaseFile)}`,
    `ST=${shq(o.stateFile)}`,
    "missing=''",
  ];
  for (const p of phases) {
    lines.push(
      `grep -qE ${shq(`^${p} (done|skipped)[[:space:]]*$`)} "$PF" 2>/dev/null || ` +
      `missing="$missing\n- fase ${p} belum tercatat di \\$HANOMAN_PHASE_FILE"`,
    );
  }
  if (planGate) {
    // Cermin planComplete() di server: hanya berkas plan yang cocok id spec ini yang digerbang.
    lines.push(
      `for f in ${shq(o.worktree)}/docs/superpowers/plans/*${o.specId.toLowerCase()}*; do`,
      `  [ -f "$f" ] || continue`,
      `  grep -qE '^[ \t]*- \\[ \\]' "$f" && ` +
      `missing="$missing\n- plan $f masih punya task - [ ] yang belum selesai"`,
      "done",
    );
  }
  lines.push(
    'if [ -z "$missing" ]; then exit 0; fi',
    // Pagar anti-loop: hitung penolakan, lepaskan sesudah batas.
    'n=$(cat "$ST" 2>/dev/null || echo 0)',
    'n=$((n+1))',
    'echo "$n" > "$ST" 2>/dev/null || true',
    `if [ "$n" -gt ${max} ]; then`,
    `  echo "hanoman: gate mode goal dilepas sesudah ${max} penolakan — butuh manusia." >&2`,
    "  exit 0",
    "fi",
    // `%b` untuk $missing, BUKAN `%s`: di sh POSIX `\n` di dalam kutip ganda tetap literal
    // backslash-n, jadi hanya %b yang memulihkannya jadi baris beneran.
    `printf '%s\\n\\n' ${shq(o.condition)} >&2`,
    `printf 'Belum terpenuhi:%b\\n' "$missing" >&2`,
    `printf '%s\\n' 'Kerjakan yang masih kurang lalu lanjutkan — jangan berhenti.' >&2`,
    "exit 2",
  );
  return lines.join("\n") + "\n";
}
```

- [x] **Step 5: Ekspor dari `runner/src/index.ts`**

Sisipkan setelah `export * from "./goal";`:

```ts
export * from "./codex-settings";
export * from "./agent-cli";
```

> `./agent-cli` dibuat di Task 3. Bila Task 3 belum jalan, tambahkan hanya baris `codex-settings` dulu dan baris `agent-cli` di Task 3.

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/codex-settings.test.ts`
Expected: PASS — 11 test hijau.

- [x] **Step 7: Commit**

```bash
git add runner/src/codex-settings.ts runner/src/types.ts runner/src/index.ts runner/test/codex-settings.test.ts
git commit -m "feat(spec-338): hook codex (marker keputusan + gate mode goal deterministik)"
```

---

### Task 3: Pembangun argv per agen — `runner/src/agent-cli.ts`

**Files:**
- Create: `runner/src/agent-cli.ts`
- Modify: `runner/src/index.ts`
- Test: `runner/test/agent-cli.test.ts` (create)

**Interfaces:**
- Consumes: `guardSettings` (`./settings`), `codexHookArgs` (`./codex-settings`), `Agent` (`./types`).
- Produces: `agentFlags(o: AgentFlagsOpts): string[]` dengan
  `AgentFlagsOpts = { agent: Agent; model?: string; effort?: string; decisionFile?: string; goal?: string; goalGate?: string }`.
  Nilai balik = elemen argv **belum dikutip**; pemanggil yang mengutip.

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/agent-cli.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agentFlags } from "../src/agent-cli";

describe("agentFlags · claude", () => {
  it("mempertahankan argv historis claude", () => {
    const f = agentFlags({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(f.slice(0, 4)).toEqual(["--model", "claude-opus-5", "--effort", "xhigh"]);
    expect(f).toContain("--dangerously-skip-permissions");
    expect(f).toContain("--settings");
  });

  it("goal claude tetap Stop hook bertipe prompt di --settings", () => {
    const f = agentFlags({ agent: "claude", goal: "SELESAI-338" });
    const settings = f[f.indexOf("--settings") + 1]!;
    expect(JSON.parse(settings)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "SELESAI-338" }] }] } });
  });

  it("model/effort kosong tak menghasilkan flag kosong", () => {
    const f = agentFlags({ agent: "claude" });
    expect(f).not.toContain("--model");
    expect(f).not.toContain("--effort");
  });
});

describe("agentFlags · codex", () => {
  it("memakai -m dan model_reasoning_effort, bukan --model/--effort", () => {
    const f = agentFlags({ agent: "codex", model: "gpt-5.5", effort: "high" });
    expect(f.slice(0, 4)).toEqual(["-m", "gpt-5.5", "-c", 'model_reasoning_effort="high"']);
    expect(f).not.toContain("--model");
    expect(f).not.toContain("--effort");
  });

  it("selalu membawa bypass approvals DAN bypass hook trust", () => {
    const f = agentFlags({ agent: "codex" });
    expect(f).toContain("--dangerously-bypass-approvals-and-sandbox");
    // Tanpa ini TUI berhenti di layar "Hooks need review" dan sesi tak pernah mulai.
    expect(f).toContain("--dangerously-bypass-hook-trust");
    expect(f).not.toContain("--dangerously-skip-permissions");
    expect(f).not.toContain("--settings");
  });

  it("meneruskan marker keputusan & gate goal sebagai hook -c", () => {
    const f = agentFlags({ agent: "codex", decisionFile: "/tmp/d", goalGate: "/tmp/g.sh" });
    const joined = f.join(" ");
    expect(joined).toContain("hooks.Stop=");
    expect(joined).toContain("hooks.UserPromptSubmit=");
    expect(joined).toContain("/tmp/g.sh");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/agent-cli.test.ts`
Expected: FAIL — modul `../src/agent-cli` tidak ada.

- [x] **Step 3: Tulis `runner/src/agent-cli.ts`**

```ts
import type { Agent } from "./types";
import { guardSettings } from "./settings";
import { codexHookArgs } from "./codex-settings";

// SPEC-338 · ADR-0074 — satu tempat yang tahu bentuk argv tiap agen. pty.ts hanya mengutip &
// merangkai; perbedaan CLI (claude vs codex) tak bocor ke lapis proses/tmux. Murni & tanpa I/O
// supaya bisa dites tanpa men-spawn apa pun.
export type AgentFlagsOpts = {
  agent: Agent;
  model?: string;
  effort?: string;
  decisionFile?: string;
  /** claude: kondisi prosa untuk Stop hook `prompt`. codex: dipakai lewat `goalGate`. */
  goal?: string;
  /** codex: path skrip gate mode goal (ditulis pemanggil). */
  goalGate?: string;
};

/** Flag agen TANPA binary dan TANPA prompt positional — pemanggil yang mengutip tiap elemen. */
export function agentFlags(o: AgentFlagsOpts): string[] {
  if (o.agent === "codex") {
    return [
      ...(o.model ? ["-m", o.model] : []),
      // Codex tak punya flag effort; ia knob config. Nilai diapit kutip ganda agar di-parse TOML.
      ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
      // Padanan --dangerously-skip-permissions (ADR-0037: agen dipercaya, isolasi = worktree).
      "--dangerously-bypass-approvals-and-sandbox",
      // Hook kita disuntik saat lahir, jadi ia belum pernah "di-trust" manusia. Tanpa flag ini
      // TUI berhenti di layar "Hooks need review" dan sesi tak pernah mulai.
      "--dangerously-bypass-hook-trust",
      ...codexHookArgs({ decisionFile: o.decisionFile, goalGate: o.goalGate }),
    ];
  }
  return [
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(guardSettings(o.decisionFile, o.goal)),
  ];
}
```

- [x] **Step 4: Pastikan `runner/src/index.ts` mengekspor `./agent-cli`**

(Bila belum ditambahkan di Task 2 Step 5.)

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run`
Expected: PASS — seluruh test runner hijau.

- [x] **Step 6: Commit**

```bash
git add runner/src/agent-cli.ts runner/src/index.ts runner/test/agent-cli.test.ts
git commit -m "feat(spec-338): agentFlags — pembangun argv per agen (claude|codex)"
```

---

### Task 4: `pty.ts` men-spawn agen terpilih

**Files:**
- Modify: `server/src/services/pty.ts:41-46,53-57,95-99,103-122,137-229`
- Test: `server/test/pty.test.ts` (modify — tambah blok describe)
- Test fixture: `server/test/fixtures/fake-codex.sh` (create)

**Interfaces:**
- Consumes: `agentFlags`, `codexGoalScript` (`@hanoman/runner`).
- Produces:
  - `CreateOpts.agent?: Agent` (default `"claude"`)
  - `SessionInfo.agent: Agent`
  - `codexBin(): string` (env `HANOMAN_CODEX_BIN`)
  - `goalGatePath(id: string): string` — `${tmpdir()}/hanoman-goal-gates/<id>.sh`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/pty.test.ts`, di dalam `describe("pty service", …)`:

```ts
  // SPEC-338 · ADR-0074 · sesi codex lahir dengan argv codex, bukan claude.
  it("agent codex memakai biner & flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("cx1", process.cwd(), { agent: "codex", model: "gpt-5.5", effort: "high" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    const out = allData(c).replace(/\s+/g, " ");
    expect(out).toContain("-m gpt-5.5");
    expect(out).toContain('model_reasoning_effort="high"');
    expect(out).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(out).toContain("--dangerously-bypass-hook-trust");
    expect(out).not.toContain("--dangerously-skip-permissions");
  });

  it("agent tercatat di tmux & terbaca listSessions", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("cx2", process.cwd(), { agent: "codex" });
    expect(s.agent).toBe("codex");
    expect(getSession("cx2")?.agent).toBe("codex");
    expect(listSessions().find((x) => x.id === "cx2")?.agent).toBe("codex");
  });

  it("tanpa opts.agent sesi tetap claude (default historis)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("cx3", process.cwd());
    expect(s.agent).toBe("claude");
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--dangerously-skip-permissions");
  });

  it("goal codex menulis skrip gate & memasangnya sebagai Stop hook", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const phaseFile = phaseFilePath(repoDir, "cx4");
    const s = createSession("cx4", process.cwd(), {
      agent: "codex", flow: "feature", specId: "SPEC-338", phaseFile,
      goal: "KONDISI-338",
    });
    await waitFor(() => exited(s.id));
    const gate = goalGatePath(s.id);
    expect(readFileSync(gate, "utf8")).toContain("KONDISI-338");
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c).replace(/\s+/g, " ")).toContain(gate);
  });
```

Tambahkan `goalGatePath` ke daftar import dari `../src/services/pty` di kepala berkas.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism`
Expected: FAIL — `goalGatePath` tak diekspor; `opts.agent` diabaikan.

- [x] **Step 3: Tambahkan binary & path gate di `pty.ts`**

Tambahkan `agentFlags`, `codexGoalScript`, `type Agent` ke import `@hanoman/runner` (baris 7):

```ts
import { guardSettings, goalOneLine, agentFlags, codexGoalScript, type Flow, type Agent } from "@hanoman/runner";
```

Sisipkan setelah `shellBin` (baris 57):

```ts
// SPEC-338 · ADR-0074 · cermin HANOMAN_CLAUDE_BIN untuk Codex CLI.
const codexBin = () => effectiveStr("HANOMAN_CODEX_BIN") ?? "codex";
const agentBin = (agent: Agent): string => (agent === "codex" ? codexBin() : claudeBin());
```

Sisipkan setelah `promptFilePath` (baris 64):

```ts
// SPEC-338 · skrip gate mode goal sesi codex. Sekamar dengan berkas prompt: ephemeral, di tmpdir,
// tak bergantung cwd sesi (worktree bisa lenyap saat sesi ditutup). id sudah tersanitasi.
export const goalGatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.sh`;
// Berkas penghitung penolakan gate (pagar anti-loop) — bersebelahan dengan skripnya.
const goalStatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.count`;
```

- [x] **Step 4: Bawa `agent` ke tipe sesi & pembacaan tmux**

Ubah `SessionInfo` (baris 41-44) menjadi:

```ts
export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string; decision: boolean;
  // SPEC-338 · ADR-0074 · mesin sesi. Sesi lama (tanpa opsi tmux ini) dibaca sebagai "claude".
  agent: Agent;
};
```

Tambahkan `#{@hanoman_agent}` ke `FMT` (baris 95-99), setelah `#{@hanoman_branch}`:

```ts
const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}",
].join("\t");
```

Di `listPanes()` (baris 107-121) tambahkan `agent` ke destructuring dan objek hasil:

```ts
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent] = line.split("\t");
```

```ts
      // SPEC-338 · sesi yang lahir sebelum ADR-0074 tak punya opsi ini → claude.
      agent: (agent === "codex" ? "codex" : "claude") as Agent,
```

Di `listSessions()` (baris 124-127) ikutkan `agent`:

```ts
export const listSessions = (): SessionInfo[] =>
  listPanes().map(({ id, projectId, specId, flow, cwd, exited, branch, decision, agent }) => ({
    id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  }));
```

- [x] **Step 5: Rakit argv lewat `agentFlags` di `createSession`**

Tambahkan ke `CreateOpts` (baris 137-142):

```ts
  // SPEC-338 · ADR-0074 · mesin sesi; kosong = claude (default historis).
  agent?: Agent;
```

Ganti blok perakitan argv (baris 174-186) menjadi:

```ts
  const agent: Agent = opts.agent ?? "claude";
  let argv: string;
  if (opts.command) {
    argv = opts.command.map(sq).join(" ");
  } else {
    // SPEC-338 · mode goal codex = gate deterministik (hook codex hanya dukung type="command").
    // Skripnya ditulis sekarang supaya sudah ada saat hook pertama menembak.
    let goalGate: string | undefined;
    if (agent === "codex" && opts.goal && opts.flow && opts.specId) {
      goalGate = goalGatePath(id);
      mkdirSync(dirname(goalGate), { recursive: true });
      writeFileSync(goalGate, codexGoalScript({
        flow: opts.flow, specId: opts.specId, condition: opts.goal,
        phaseFile: opts.phaseFile ?? "", worktree: cwd, stateFile: goalStatePath(id),
      }), { mode: 0o755 });
    }
    // Prompt (bila ada) = argumen positional pertama, TANPA sq (sudah dikutip ganda).
    const flags = agentFlags({
      agent, model: opts.model, effort: opts.effort,
      decisionFile: opts.decisionFile, goal: opts.goal, goalGate,
    }).map(sq).join(" ");
    argv = [sq(agentBin(agent)), promptArg, flags].filter(Boolean).join(" ");
  }
```

- [x] **Step 6: Simpan `@hanoman_agent` & kembalikan `agent`**

Sisipkan setelah baris `if (opts.branch) tmux(…@hanoman_branch…)` (baris 222):

```ts
  // SPEC-338 · mesin sesi ikut tersimpan di tmux — sumber kebenaran sesi tetap tmux, bukan DB.
  tmux("set-option", "-t", name(id), "@hanoman_agent", agent);
```

Ubah `return` (baris 228) menjadi:

```ts
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false, agent };
```

- [x] **Step 7: Batasi `armGoalInTui` ke claude**

Ubah baris 227 (`if (opts.goal && !opts.command) …`) menjadi:

```ts
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook di argv di atas. SPEC-338 · khusus claude: `/goal`
  // adalah perintah Claude Code; codex tak punya padanan terverifikasi — jaminannya gate hook.
  if (opts.goal && !opts.command && agent === "claude") void armGoalInTui(id, opts.goal).catch(() => { /* best-effort */ });
```

- [x] **Step 8: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/pty.test.ts --no-file-parallelism`
Expected: PASS — test lama (claude) tetap hijau, 4 test codex baru hijau.

- [x] **Step 9: Commit**

```bash
git add server/src/services/pty.ts server/test/pty.test.ts
git commit -m "feat(spec-338): pty men-spawn agen terpilih + @hanoman_agent di tmux"
```

---

### Task 5: Bootstrap trust codex — `server/src/services/codex-trust.ts`

**Files:**
- Create: `server/src/services/codex-trust.ts`
- Test: `server/test/codex-trust.test.ts` (create)

**Interfaces:**
- Consumes: —
- Produces: `ensureCodexTrust(repoDir: string, home?: string): void`, `codexConfigPath(home?: string): string`.

> **Kenapa perlu:** TUI codex berhenti di layar "Do you trust the contents of this directory?" untuk direktori yang belum dipercaya, dan `-c projects."…".trust_level` **tidak** membukanya (gerbang membaca config tersimpan). Trust root repo **menurun ke worktree-nya**, jadi cukup satu entri per project. Ini persis yang codex tulis sendiri ketika manusia menjawab "Yes, continue".

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/codex-trust.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCodexTrust, codexConfigPath } from "../src/services/codex-trust";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "hanoman-cxhome-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("ensureCodexTrust", () => {
  it("membuat config + entri trust saat belum ada", () => {
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('[projects."/repo/app"]');
    expect(t).toContain('trust_level = "trusted"');
  });

  it("idempoten — dipanggil dua kali tetap satu entri", () => {
    ensureCodexTrust("/repo/app", home);
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t.split('[projects."/repo/app"]').length - 1).toBe(1);
  });

  it("tak merusak konfigurasi yang sudah ada", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(codexConfigPath(home), 'model = "gpt-5.5"\n\n[mcp_servers.x]\nurl = "http://x"\n');
    ensureCodexTrust("/repo/app", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('model = "gpt-5.5"');
    expect(t).toContain("[mcp_servers.x]");
    expect(t).toContain('[projects."/repo/app"]');
  });

  it("project berbeda mendapat entri sendiri", () => {
    ensureCodexTrust("/repo/a", home);
    ensureCodexTrust("/repo/b", home);
    const t = readFileSync(codexConfigPath(home), "utf8");
    expect(t).toContain('[projects."/repo/a"]');
    expect(t).toContain('[projects."/repo/b"]');
  });

  it("gagal-diam saat home tak bisa ditulis — sesi tetap boleh lahir", () => {
    expect(() => ensureCodexTrust("/repo/app", "/proc/tidak-ada/xyz")).not.toThrow();
    expect(existsSync("/proc/tidak-ada/xyz")).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/codex-trust.test.ts --no-file-parallelism`
Expected: FAIL — modul `../src/services/codex-trust` tidak ada.

- [x] **Step 3: Tulis `server/src/services/codex-trust.ts`**

```ts
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

// SPEC-338 · ADR-0074 — TUI codex menolak jalan di direktori yang belum dipercaya:
// "Do you trust the contents of this directory?". Layar itu memblok sesi selamanya di dashboard,
// dan `-c projects."…".trust_level="trusted"` TIDAK membukanya (gerbangnya membaca config yang
// tersimpan, bukan override runtime — sengaja, ini gerbang keamanan).
//
// Yang menolongnya: trust pada ROOT REPO menurun ke worktree di bawahnya. Sesi hanoman selalu
// lahir di `<repoDir>/.worktrees/<id>`, jadi cukup SATU entri per project — bukan per sesi.
// Isinya persis yang codex tulis sendiri ketika manusia menjawab "Yes, continue".

const codexHome = (home?: string): string =>
  home ?? process.env.CODEX_HOME ?? `${homedir()}/.codex`;

export const codexConfigPath = (home?: string): string => `${codexHome(home)}/config.toml`;

/**
 * Pastikan `repoDir` tercatat trusted di config codex. Idempoten, append-only, tak pernah
 * menyentuh kunci lain. Gagal-diam: sesi lebih baik lahir lalu memperlihatkan layar trust-nya
 * daripada request Start-nya 500 karena home codex tak bisa ditulis.
 */
export function ensureCodexTrust(repoDir: string, home?: string): void {
  const path = codexConfigPath(home);
  const header = `[projects."${repoDir}"]`;
  try {
    let existing = "";
    try { existing = readFileSync(path, "utf8"); } catch { /* belum ada — dibuat di bawah */ }
    if (existing.includes(header)) return;
    mkdirSync(codexHome(home), { recursive: true });
    const lead = existing === "" || existing.endsWith("\n") ? "" : "\n";
    appendFileSync(path, `${lead}\n${header}\ntrust_level = "trusted"\n`);
  } catch { /* home codex read-only — biarkan codex sendiri yang bertanya */ }
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/codex-trust.test.ts --no-file-parallelism`
Expected: PASS — 5 test hijau.

- [x] **Step 5: Commit**

```bash
git add server/src/services/codex-trust.ts server/test/codex-trust.test.ts
git commit -m "feat(spec-338): ensureCodexTrust — buka gerbang trust direktori codex"
```

---

### Task 6: Resolusi & threading `agent` di server

**Files:**
- Modify: `server/src/services/settings.ts:8-16`
- Modify: `server/src/services/session-launch.ts:20-74`
- Modify: `server/src/routes/terminal.ts:63-81,110-227,281-292`
- Test: `server/test/session-launch.test.ts` (modify)
- Test: `server/test/settings.test.ts` (modify)

**Interfaces:**
- Consumes: `Setting.agent`, `Setting.codex`, `ensureCodexTrust`, `CreateOpts.agent`.
- Produces:
  - `sessionAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }>` di `services/settings.ts` — model/effort yang benar untuk agen default.
  - `startSpecSession(spec, opts)` menerima `opts.agent?: Agent`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-launch.test.ts`:

```ts
  // SPEC-338 · ADR-0074 · agen per sesi & default global.
  it("opts.agent codex melahirkan sesi codex dengan model codex", async () => {
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, data: { ...DEFAULT_SETTING, codex: { model: "gpt-5.4", effort: "high" } } },
      update: { data: { ...DEFAULT_SETTING, codex: { model: "gpt-5.4", effort: "high" } } },
    });
    const spec = await makeSpec();
    const r = await startSpecSession(spec, { flow: "feature", agent: "codex" });
    expect(getSession(r.id)?.agent).toBe("codex");
  });

  it("tanpa opts.agent memakai Setting.agent", async () => {
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, data: { ...DEFAULT_SETTING, agent: "codex" } },
      update: { data: { ...DEFAULT_SETTING, agent: "codex" } },
    });
    const spec = await makeSpec();
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(getSession(r.id)?.agent).toBe("codex");
  });

  it("override model/effort per sesi tetap menang atas default agen", async () => {
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, data: { ...DEFAULT_SETTING, agent: "codex" } },
      update: { data: { ...DEFAULT_SETTING, agent: "codex" } },
    });
    const spec = await makeSpec();
    const r = await startSpecSession(spec, { flow: "feature", model: "gpt-5.4-mini" });
    expect(getSession(r.id)?.agent).toBe("codex");
  });
```

> Sesuaikan `makeSpec()`/import dengan helper yang sudah ada di berkas test tersebut (`server/test/factory.ts`). Pastikan `HANOMAN_CODEX_BIN=/bin/echo` diset di `beforeEach` blok ini agar tak men-spawn codex sungguhan.

Tambahkan di `server/test/settings.test.ts`:

```ts
  it("sessionAgentDefaults mengembalikan model codex saat agent=codex", async () => {
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, data: { ...DEFAULT_SETTING, agent: "codex", codex: { model: "gpt-5.4", effort: "low" } } },
      update: { data: { ...DEFAULT_SETTING, agent: "codex", codex: { model: "gpt-5.4", effort: "low" } } },
    });
    expect(await sessionAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.4", effort: "low" });
  });

  it("sessionAgentDefaults default = claude memakai model/effort claude", async () => {
    await prisma.setting.deleteMany({});
    expect(await sessionAgentDefaults()).toEqual({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/settings.test.ts test/session-launch.test.ts --no-file-parallelism`
Expected: FAIL — `sessionAgentDefaults` tak ada; `opts.agent` tak dikenal.

- [x] **Step 3: Tambahkan default & resolver di `server/src/services/settings.ts`**

Tambahkan import:

```ts
import { zSetting, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, CODEX_DEFAULTS, type Setting, type Agent } from "@hanoman/shared";
```

Tambahkan ke `DEFAULT_SETTING` (setelah `goal`):

```ts
  agent: "claude",                 // SPEC-338 · ADR-0074 · mesin sesi default
  codex: CODEX_DEFAULTS,           // SPEC-338 · ADR-0074 · model/effort codex
```

Tambahkan di akhir berkas:

```ts
/**
 * SPEC-338 · ADR-0074 · default sesi yang SUDAH sesuai agennya: memilih model/effort dari blok
 * yang benar. `sessionModel()` lama tetap ada (khusus claude) supaya jalur yang belum sadar-agen
 * tak berubah perilaku.
 */
export async function sessionAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  return s.agent === "codex"
    ? { agent: "codex", model: s.codex.model, effort: s.codex.effort }
    : { agent: "claude", model: s.model, effort: s.effort };
}
```

- [x] **Step 4: Threading di `server/src/services/session-launch.ts`**

Tambahkan import:

```ts
import { getSetting, sessionAgentDefaults } from "./settings";
import { ensureCodexTrust } from "./codex-trust";
import type { Agent } from "@hanoman/shared";
```

Tambahkan ke signature `opts` (baris 22-27):

```ts
    // SPEC-338 · ADR-0074 · mesin sesi. undefined → ikut Setting.agent. Governor scheduler tak
    // memasoknya → ikut default global, seperti model/effort.
    agent?: Agent;
```

Ganti blok resolusi model/effort (baris 41-43) menjadi:

```ts
  const setting = await getSetting();
  // SPEC-338 · agen menentukan blok model/effort mana yang jadi default. Override per sesi
  // (opts.model/opts.effort) tetap menang, apa pun agennya.
  const agent: Agent = opts.agent ?? setting.agent;
  const agentDefaults = agent === "codex"
    ? { model: setting.codex.model, effort: setting.codex.effort }
    : { model: setting.model, effort: setting.effort };
  const model = opts.model ?? agentDefaults.model;
  const effort = opts.effort ?? agentDefaults.effort;
```

Sisipkan sebelum `realGit.addWorktree` (baris 55):

```ts
  // SPEC-338 · buka gerbang trust codex untuk root repo SEBELUM worktree lahir — worktree
  // mewarisi trust root, jadi cukup sekali per project. Gagal-diam di dalam.
  if (agent === "codex") ensureCodexTrust(repoDir);
```

Tambahkan `agent` ke `createSession` (baris 66-73):

```ts
  const s = createSession(spec.projectId, `${repoDir}/.worktrees/${id}`, {
    specId: spec.id, flow: opts.flow, model, effort, goal, agent,
```

- [x] **Step 5: Threading di `server/src/routes/terminal.ts`**

Teruskan `agent` untuk varian spec (baris 67-70):

```ts
        const r = await startSpecSession(spec, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
          agent: parsed.data.agent,                                           // SPEC-338 · ADR-0074
        });
```

Untuk lima jalur project-level (`reverse`, `scaffold`, `prd`, `breakdown`, terminal-claude biasa) dan jalur konflik-integrasi, ganti tiap pemanggilan `const { model, effort } = await sessionModel();` menjadi:

```ts
      // SPEC-338 · ADR-0074 · sesi project-level tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
```

dan tambahkan `agent` ke tiap `createSession({ … })` di jalur-jalur itu. Untuk terminal-claude biasa di akhir handler (baris 226), ganti:

```ts
    // SPEC-338 · terminal claude biasa ikut agen default global.
    const { agent, model, effort } = await sessionAgentDefaults();
    if (agent === "codex") ensureCodexTrust(repoDir);
    const s = createSession(project.id, repoDir, { agent, model, effort });
    return reply.code(201).send({ id: s.id });
```

Untuk jalur konflik-integrasi (baris 281-292) `repoDir` bernama `repoDir` di scope itu — pakai variabel yang tersedia di sana. Perbarui import:

```ts
import { sessionModel, sessionAgentDefaults } from "../services/settings";
import { ensureCodexTrust } from "../services/codex-trust";
```

> `sessionModel()` tetap diekspor untuk pemakai lain; bila sesudah perubahan ini tak ada lagi pemanggilnya di `terminal.ts`, hapus dari daftar import berkas itu saja (jangan hapus fungsinya).

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/server exec vitest run test/settings.test.ts test/session-launch.test.ts test/terminal.route.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 7: Jalankan SELURUH suite**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm test`
Expected: PASS — tak ada regresi di server/runner/shared.

- [x] **Step 8: Commit**

```bash
git add server/src/services/settings.ts server/src/services/session-launch.ts server/src/routes/terminal.ts server/test/settings.test.ts server/test/session-launch.test.ts
git commit -m "feat(spec-338): resolusi agen sesi (default global + override per sesi)"
```

---

### Task 7: UI — kartu agen di Settings & picker saat Start

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx:13-45` + kartu baru
- Modify: `src/src/App.tsx:46-111`
- Modify: `src/src/api/client.ts:181`
- Test: `src/test/start-session-agent.test.tsx` (create)

**Interfaces:**
- Consumes: `CODEX_MODELS`, `CODEX_EFFORTS`, `MODELS`, `EFFORTS`, `Setting.agent`, `Setting.codex`.
- Produces: `api.startSession({ …, agent })`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/start-session-agent.test.tsx` (ikuti pola berkas test frontend yang sudah ada di `src/test/` untuk setup RTL & mock `api`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

vi.mock("../src/api/client", async (orig) => {
  const actual = await orig<typeof import("../src/api/client")>();
  return { ...actual, api: { ...actual.api, getSettings: vi.fn(), startSession: vi.fn() } };
});

const spec = {
  id: "SPEC-338", projectId: "p", title: "t", source: "brief", stage: "brainstorming",
  priority: "tinggi", author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
} as never;

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue({
    model: "claude-opus-5", effort: "xhigh", agent: "claude",
    codex: { model: "gpt-5.5", effort: "xhigh" },
    goal: { enabled: false, condition: "" },
  } as never);
  vi.mocked(api.startSession).mockResolvedValue({ id: "s1" } as never);
});

describe("StartSessionModal · agen (SPEC-338)", () => {
  it("memilih codex menukar daftar model ke katalog codex", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    await userEvent.selectOptions(screen.getByLabelText("Agen"), "codex");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.5"));
    expect(screen.getByLabelText("Model")).toContainHTML("gpt-5.4");
    expect(screen.getByLabelText("Model")).not.toContainHTML("claude-opus-5");
  });

  it("mengirim agent ke POST /terminal/sessions", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Agen")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Agen"), "codex");
    await userEvent.click(screen.getByRole("button", { name: /Mulai/ }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex", model: "gpt-5.5" })));
  });

  it("default tetap claude", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman exec vitest run test/start-session-agent.test.tsx`
Expected: FAIL — tak ada kontrol berlabel "Agen".

- [x] **Step 3: Tambahkan `agent` ke client API (`src/src/api/client.ts:181`)**

```ts
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string; agent?: Agent }) =>
```

Tambahkan `Agent` ke import tipe dari `@hanoman/shared` di berkas itu.

- [x] **Step 4: Picker Agen di `StartSessionModal` (`src/src/App.tsx`)**

Perbarui import (baris 11):

```ts
import { flowForSource, MODELS, EFFORTS, CODEX_MODELS, CODEX_EFFORTS, type Agent } from "@hanoman/shared";
```

Ganti state & efek (baris 48-61) menjadi:

```ts
  // SPEC-338 · ADR-0074 · agen sesi. Model/effort dipilih dari katalog agen terpilih — mengganti
  // agen HARUS menukar keduanya, kalau tidak sesi lahir dengan `codex -m claude-opus-5`.
  const [agent, setAgent] = React.useState<Agent>("claude");
  const [model, setModel] = React.useState("claude-opus-5");
  const [effort, setEffort] = React.useState("xhigh");
  // Default per agen dari setelan global, dipakai saat picker agen berpindah.
  const [defs, setDefs] = React.useState({
    claude: { model: "claude-opus-5", effort: "xhigh" },
    codex: { model: "gpt-5.5", effort: "xhigh" },
  });
  const [goalOn, setGoalOn] = React.useState(false);
  const [goalCond, setGoalCond] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => {
      const d = { claude: { model: s.model, effort: s.effort }, codex: { ...s.codex } };
      setDefs(d);
      setAgent(s.agent); setModel(d[s.agent].model); setEffort(d[s.agent].effort);
      setGoalOn(s.goal.enabled); setGoalCond(s.goal.condition);
    }).catch(() => {});
  }, [open]);
  const pickAgent = (a: Agent) => { setAgent(a); setModel(defs[a].model); setEffort(defs[a].effort); };
  const models = agent === "codex" ? CODEX_MODELS : MODELS;
  const efforts = agent === "codex" ? CODEX_EFFORTS : EFFORTS;
```

Kirim `agent` di `start()` (baris 68-71):

```ts
      const { id } = await api.startSession({
        spec: s.id, flow, model, effort, agent,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
      });
```

Sisipkan Field Agen tepat sebelum `<Field label="Model">` (baris 87), dan ubah kedua `Select` di bawahnya agar memakai `models`/`efforts`:

```tsx
      <Field label="Agen" hint="Mesin yang menjalankan sesi ini. Perilaku sesi sama; hanya CLI-nya berbeda.">
        <Select aria-label="Agen" value={agent} style={{ width: "100%" }}
          options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickAgent(e.target.value as Agent)} />
      </Field>
      <Field label="Model">
        <Select aria-label="Model" value={model} style={{ width: "100%" }}
          options={models.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} style={{ width: "100%" }}
          options={efforts.map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
```

Perbarui teks penjelas (baris 83-86) agar menyebut agen:

```tsx
        Agen, model & effort untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan pilihan
        ini untuk seluruh hidupnya (satu proses) — <code>/model</code> di terminal tetap bisa mengubahnya.
```

- [x] **Step 5: Kartu "Agen sesi" di `SettingsScreen.tsx`**

Perbarui import (baris 6):

```ts
import { CAPABILITY_DOMAINS, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, CODEX_DEFAULTS, CODEX_MODELS, CODEX_EFFORTS } from "@hanoman/shared";
```

Tambahkan ke `S_DEFAULTS` (baris 37-45):

```ts
  agent: "claude",                 // SPEC-338 · ADR-0074
  codex: CODEX_DEFAULTS,
```

Sisipkan kartu baru tepat sebelum kartu `eyebrow="goal"` (baris 562):

```tsx
      {/* SPEC-338 · ADR-0074 · mesin sesi default. Berlaku untuk SEMUA sesi yang men-spawn agen
          (backlog, reverse, prd, scaffold, breakdown, terminal); backlog masih bisa di-override
          saat Start. Model/effort claude tetap di kartunya sendiri. */}
      <Card eyebrow="agen" title="Agen sesi">
        <SettingRow title="Agen default"
          desc="Mesin yang menjalankan sesi baru. Codex CLI memakai flag & hook-nya sendiri; perilaku sesi (worktree, fase, stage, review) sama.">
          <Select aria-label="Agen default" value={s.agent}
            options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ agent: e.target.value as Setting["agent"] })} />
        </SettingRow>
        <SettingRow title="Model codex" desc="Diteruskan apa adanya ke `codex -m`.">
          <Select aria-label="Model codex" value={s.codex.model}
            options={CODEX_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ codex: { ...s.codex, model: e.target.value } })} />
        </SettingRow>
        <SettingRow last title="Effort codex" desc="Diteruskan ke `codex -c model_reasoning_effort`."
          >
          <Select aria-label="Effort codex" value={s.codex.effort}
            options={CODEX_EFFORTS.map((v) => ({ value: v, label: v }))}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => save({ codex: { ...s.codex, effort: e.target.value } })} />
        </SettingRow>
      </Card>
```

> Sesuaikan nama helper `save(...)` dengan yang sudah dipakai kartu lain di berkas itu (lihat kartu `goal`, baris 562-580).

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter hanoman exec vitest run`
Expected: PASS — test frontend hijau.

- [x] **Step 7: Typecheck seluruh workspace**

Run: `pnpm -r typecheck`
Expected: exit 0, tanpa error TS.

- [x] **Step 8: Commit**

```bash
git add src/src/App.tsx src/src/screens/SettingsScreen.tsx src/src/api/client.ts src/test/start-session-agent.test.tsx
git commit -m "feat(spec-338): picker agen saat Start + kartu Agen sesi di Settings"
```

---

### Task 8: Prompt netral-agen, docs Source of Truth, dan smoke nyata

**Files:**
- Modify: `runner/src/prompt.ts:82-90`
- Test: `runner/test/prompt.test.ts` (modify)
- Create: `internal/docs/adr/0074-codex-sebagai-mesin-sesi.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh Task 1-7.
- Produces: docs SoT + verifikasi nyata.

- [ ] **Step 1: Tulis test yang gagal untuk prompt netral-agen**

Tambahkan di `runner/test/prompt.test.ts`:

```ts
  // SPEC-338 · satu prompt melayani claude & codex. "Skill tool" adalah istilah Claude Code;
  // codex memuat skill secara native.
  it("instruksi skill tak menyebut mekanisme khas satu agen", () => {
    const p = startPrompt("feature", brief, "hanoman/x");
    expect(p).toContain("superpowers:brainstorming");
    expect(p).not.toContain("Skill tool");
  });
```

> `brief` = fixture SpecBrief yang sudah dipakai berkas test itu.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/prompt.test.ts`
Expected: FAIL — prompt masih memuat "Skill tool".

- [ ] **Step 3: Netralkan `skillInstruction` (`runner/src/prompt.ts:82-90`)**

```ts
const skillInstruction = (phases: readonly string[]) => {
  const lines = phases
    .filter((p) => PHASE_SKILLS[p])
    .map((p) => `- ${p}: ${PHASE_SKILLS[p]!.join(", ")}`);
  // SPEC-338 · netral-agen: Claude Code meng-invoke skill lewat Skill tool, Codex CLI memuatnya
  // secara native. Prompt menyebut HASIL yang diminta, bukan mekanismenya.
  return lines.length
    ? "Skills superpowers WAJIB: sebelum mengerjakan fase di bawah, muat & ikuti skill-nya "
      + `dengan mekanisme yang tersedia di agenmu — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV -u DATABASE_URL pnpm --filter @hanoman/runner exec vitest run test/prompt.test.ts`
Expected: PASS — snapshot/assert prompt lain tetap hijau (perbarui bila ada assert literal yang menyebut kalimat lama).

- [ ] **Step 5: Tulis ADR-0074**

Buat `internal/docs/adr/0074-codex-sebagai-mesin-sesi.md` dengan struktur ADR repo (`# ADR-0074 — …`, `Status: accepted`, `Konteks`, `Keputusan`, `Konsekuensi`, `Alternatif ditolak`). Isi wajib memuat:
- Keputusan: `Agent = claude|codex` sebagai dimensi sesi; `Setting.agent` + `Setting.codex` (tanpa migration, `Setting` kolom `Json`); override `agent` di `POST /terminal/sessions` varian spec; `@hanoman_agent` di tmux.
- Mekanisme codex terverifikasi (codex-cli 0.142.5): `-m`, `-c model_reasoning_effort`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `-c hooks.<Event>=…`.
- Tiga perbedaan sadar terhadap claude:
  1. **Tak ada event `Notification`** → marker keputusan memakai `Stop` (turn berakhir) + `UserPromptSubmit`. Konsekuensi: marker codex juga menyala saat sesi selesai wajar.
  2. **Hook `type="prompt"` didiamkan codex** → mode goal codex adalah **gate deterministik** (phase file + checkbox plan), bukan evaluator prosa. Kondisi prosa ikut sebagai teks alasan, bukan yang menggerbang. `armGoalInTui` (`/goal`) tetap khusus claude.
  3. **Pagar anti-loop `GOAL_MAX_BLOCKS = 25`** — gate deterministik tak pernah "cukup puas" seperti evaluator LLM; sesudah 25 penolakan gate melepas dan menyerahkan ke manusia. Perbedaan sadar terhadap jalur claude yang tak berpagar.
- Gerbang trust direktori codex & `ensureCodexTrust` (satu entri per project; worktree mewarisi trust root).
- **Tidak membalik ADR-0037** — hook yang dipasang tak pernah menolak tool call.
- Batasan diketahui: indikator limit (`services/limits.ts`) membaca OAuth usage Anthropic → **khusus claude**; sesi codex tak muncul di sana.
- Terkait: memperluas 0024 (sesi interaktif), 0061 (knob → argv saat lahir), 0073 (mode goal), 0016 (tmux), 0002 (worktree); tak mengubah 0029.

- [ ] **Step 6: Tautkan & perbarui docs SoT**

`internal/docs/README.md` — sisipkan di puncak daftar `## adr`:

```markdown
- [0074 — Codex sebagai mesin sesi: `Agent` per sesi, hook lewat `-c`, mode goal deterministik](adr/0074-codex-sebagai-mesin-sesi.md) — **memperluas 0024/0061/0073**, terkait 0002/0016/0037 (SPEC-338): `Setting.agent` + `Setting.codex` (tanpa migration), `agent` di `POST /terminal/sessions`, `@hanoman_agent` di tmux; codex tak punya event `Notification` (marker keputusan pakai `Stop`) dan mendiamkan hook `type="prompt"` (mode goal jadi gate sh deterministik berpagar 25 penolakan); `ensureCodexTrust` membuka gerbang trust direktori; indikator limit tetap khusus claude
```

`internal/docs/architecture/stack.md` — pada bagian yang menyebut mesin sesi, catat bahwa sesi bisa dijalankan Claude Code **atau** Codex CLI, dengan tabel padanan flag/hook singkat.

`internal/docs/architecture/api-contract.md` — pada entri `POST /terminal/sessions`, tambahkan field `agent?: "claude" | "codex"` (varian spec) dan catat `GET/PUT /settings` kini membawa `agent` + `codex: { model, effort }`.

`internal/skills/hanoman/SKILL.md` — di **Aturan Sesi & Eksekusi**, tambahkan butir SPEC-338/ADR-0074 (agen per sesi + perbedaan mekanis codex + `ensureCodexTrust`), dan sesuaikan kalimat pembuka yang menyebut `createSession()` men-spawn `claude` saja.

- [ ] **Step 7: Jalankan seluruh suite + typecheck**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm test
pnpm -r typecheck
```
Expected: seluruh test hijau; typecheck exit 0.

- [ ] **Step 8: Smoke NYATA — boot server + curl (wajib, bukan hanya unit test)**

Ikuti pola smoke SPEC-294/332 (DB khusus, jangan `hanoman_test` yang dipakai sibling):

```bash
# 1. DB khusus smoke
export DATABASE_URL="postgresql://hanoman:hanoman@127.0.0.1:5433/hanoman338"
docker exec hanoman-db-1 psql -U hanoman -d postgres -c 'CREATE DATABASE hanoman338;'
pnpm --filter @hanoman/server exec prisma migrate deploy
pnpm --filter @hanoman/server exec prisma generate

# 2. Boot di port bebas (JANGAN 8787 — ada sesi dev lain)
pnpm build
PORT=8799 HANOMAN_TMUX_SOCKET=smoke338 node server/dist/server.js &

# 3. Setup akun + login (simpan cookie)
curl -s -XPOST localhost:8799/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"a@b.c","password":"password123"}' -c /tmp/c338

# 4. Setelan: agen default codex
curl -s -XPUT localhost:8799/api/settings -b /tmp/c338 -H 'content-type: application/json' \
  -d '{"agent":"codex","codex":{"model":"gpt-5.5","effort":"high"}}' | python3 -m json.tool

# 5. Project + spec, lalu Start sesi codex
#    (buat project ber-repoDir ke repo git nyata; lalu POST /api/specs)
curl -s -XPOST localhost:8799/api/terminal/sessions -b /tmp/c338 -H 'content-type: application/json' \
  -d '{"spec":"SPEC-SMOKE","flow":"feature","agent":"codex","goal":true}'

# 6. Bukti: argv pane BENAR & tak ada layar trust/hook-review
tmux -L smoke338 -f /dev/null list-panes -a -F '#{session_name} #{@hanoman_agent}'
tmux -L smoke338 -f /dev/null capture-pane -p -t hanoman-spec_smoke | head -30
```

Verifikasi eksplisit:
- `@hanoman_agent` = `codex` di output `list-panes`.
- Pane **tidak** menampilkan "Do you trust the contents of this directory?" maupun "Hooks need review".
- `GET /api/terminal/sessions` mengembalikan `agent: "codex"`.
- Skrip gate ada di `${TMPDIR}/hanoman-goal-gates/<id>.sh` dan memuat kondisi goal.
- Ulangi Start dengan `"agent":"claude"` → pane claude lahir seperti biasa (tak ada regresi).

Bila ada yang merah, perbaiki dulu sampai hijau sebelum lanjut.

Bersihkan: `tmux -L smoke338 kill-server`, hentikan server, `DROP DATABASE hanoman338`.

- [ ] **Step 9: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts internal/docs internal/skills
git commit -m "docs(spec-338): ADR-0074 codex sebagai mesin sesi + SoT tersentuh"
```

---

## Verifikasi akhir

- [ ] `env -u NODE_ENV -u DATABASE_URL pnpm test` hijau (server + runner + shared + frontend).
- [ ] `pnpm -r typecheck` exit 0.
- [ ] Smoke Task 8 Step 8 lolos seluruh butir verifikasi.
- [ ] `git status` bersih di worktree.
- [ ] Setiap kotak di plan ini `- [x]`.
- [ ] `git push origin HEAD:refs/heads/hanoman/spec-338`.
