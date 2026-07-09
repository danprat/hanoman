import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDecision, phasePrompt, DECISION_FILE, QA_PLANNING } from "../src/phases";
import type { RunInput } from "../src/types";

const wt = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-dec-"));
  if (content !== undefined) writeFileSync(join(dir, DECISION_FILE), content);
  return dir;
};
const input = (): RunInput => ({ runId: "RUN-1", repoDir: "/repo", branchFrom: "main",
  branchTo: "feat/x", flow: "qa", steps: {} as any });

describe("readDecision (SPEC-145, fail-safe)", () => {
  it("takes the fast path only on an explicit execute", () =>
    expect(readDecision(wt('{"path":"execute","reason":"satu predikat"}')))
      .toEqual({ path: "execute", reason: "satu predikat" }));

  it("carries no reason when reason is absent or not a string", () =>
    expect(readDecision(wt('{"path":"execute","reason":42}'))).toEqual({ path: "execute" }));

  it("falls back to the full path when the file is absent", () =>
    expect(readDecision(wt())).toEqual({ path: "spec" }));

  it("falls back to the full path on malformed JSON", () =>
    expect(readDecision(wt("{not json"))).toEqual({ path: "spec" }));

  it("falls back to the full path on an explicit spec", () =>
    expect(readDecision(wt('{"path":"spec"}'))).toEqual({ path: "spec" }));

  // `none` belum ada. Kalau suatu saat ditambahkan, ia TIDAK boleh diam-diam mengeksekusi.
  it("falls back to the full path on an unknown path value", () =>
    expect(readDecision(wt('{"path":"none"}'))).toEqual({ path: "spec" }));

  it("falls back to the full path when the json is not an object", () =>
    expect(readDecision(wt('"execute"'))).toEqual({ path: "spec" }));
});

describe("phasePrompt · instruksi keputusan", () => {
  it("asks the qa Audit phase to write the decision file", () => {
    const p = phasePrompt("qa", "Audit", input());
    expect(p).toContain(DECISION_FILE);
    expect(p).toContain('"path":"execute"|"spec"');
  });

  it("asks no other qa phase for a decision", () => {
    for (const phase of [...QA_PLANNING, "Execute"])
      expect(phasePrompt("qa", phase, input())).not.toContain(DECISION_FILE);
  });

  it("asks no feature phase for a decision", () => {
    for (const phase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute"])
      expect(phasePrompt("feature", phase, { ...input(), flow: "feature" })).not.toContain(DECISION_FILE);
  });
});
