import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaseFilePath, readPhases, stageFor, type Phase } from "../src/services/session-phases";

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
