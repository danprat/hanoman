import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  phaseFilePath, decisionFilePath, readPhases, stageFor, planComplete, stageForRun, type Phase,
} from "../src/services/session-phases";

describe("decisionFilePath (SPEC-184)", () => {
  it("di .worktrees/.decisions/<id> (di dalam .gitignore)", () => {
    expect(decisionFilePath("/repo", "spec_9")).toBe("/repo/.worktrees/.decisions/spec_9");
  });
});

let dir = "";
let file = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-phase-")); file = join(dir, "spec-1"); });
const write = (s: string) => writeFileSync(file, s);
const states = (flow: "feature" | "qa" | "reverse" = "feature") =>
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

  // "Docs teknis" / "Konvensi & index" mengandung spasi: state adalah token TERAKHIR,
  // bukan token kedua. Fase selesai tak berurutan justru menguatkan parsing-nya.
  it("nama fase berspasi terbaca utuh", () => {
    write("Scan done\nDocs teknis done\nKonvensi & index done\n");
    expect(readPhases(file, "reverse").map((p) => p.state))
      .toEqual(["done", "done", "active", "done", "pending"]);
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
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
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

// SPEC-173 · ADR-0029 — `Execute done` hanya sah bila plan spec-nya terceklist penuh.
const mkWorktree = (files: Record<string, string>) => {
  const wt = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
  if (Object.keys(files).length) mkdirSync(join(wt, "docs/superpowers/plans"), { recursive: true });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(wt, "docs/superpowers/plans", name), body);
  return wt;
};

describe("planComplete", () => {
  it("true bila tak ada dir plan sama sekali", () => {
    expect(planComplete(mkWorktree({}), "SPEC-173")).toBe(true);
  });
  it("true bila tak ada file plan yang cocok spec-id (fast-path qa)", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-lain-spec-999.md": "- [ ] belum" }), "SPEC-173")).toBe(true);
  });
  it("false bila plan spec-nya masih punya - [ ]", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-173.md": "- [x] a\n- [ ] b\n" }), "SPEC-173")).toBe(false);
  });
  it("true bila semua kotak plan sudah - [x]", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-173.md": "- [x] a\n- [x] b\n" }), "SPEC-173")).toBe(true);
  });
  it("spec-16 tak menyerempet spec-167", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-167.md": "- [ ] belum" }), "SPEC-16")).toBe(true);
  });
});

describe("stageForRun", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
  const mkPlan = (body: string) => mkWorktree({ "2026-07-11-x-spec-173.md": body });
  it("Execute done + plan belum tuntas → executing, bukan done", () => {
    expect(stageForRun(P([["Execute", "done"]]), mkPlan("- [x] a\n- [ ] b\n"), "SPEC-173")).toBe("executing");
  });
  it("Execute done + plan tuntas → done", () => {
    expect(stageForRun(P([["Execute", "done"]]), mkPlan("- [x] a\n- [x] b\n"), "SPEC-173")).toBe("done");
  });
  it("stage non-done tak terpengaruh gerbang", () => {
    expect(stageForRun(P([["Plan", "done"]]), mkPlan("- [ ] b\n"), "SPEC-173")).toBe("planned");
  });
});
