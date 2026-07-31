import { describe, it, expect } from "vitest";
import { zSpec } from "./entities";
import { zCreateSpec, zPatchSpec, zTerminalSession } from "./dto";

describe("kontrak dependency backlog (SPEC-447)", () => {
  const base = {
    id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "o", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-07-31T00:00:00.000Z", startedAt: null,
  };
  it("zSpec memberi default [] untuk dependsOn & blockedBy", () => {
    const s = zSpec.parse(base);
    expect(s.dependsOn).toEqual([]);
    expect(s.blockedBy).toEqual([]);
  });
  it("zSpec menerima blockedBy bertipe alasan yang dikenal saja", () => {
    expect(zSpec.parse({ ...base, blockedBy: [{ id: "SPEC-2", reason: "unmerged" }] }).blockedBy)
      .toEqual([{ id: "SPEC-2", reason: "unmerged" }]);
    expect(zSpec.safeParse({ ...base, blockedBy: [{ id: "SPEC-2", reason: "apa-saja" }] }).success)
      .toBe(false);
  });
  it("zCreateSpec menerima dependsOn opsional", () => {
    const r = zCreateSpec.safeParse({
      project: "p1", source: "brief", title: "t", priority: "sedang",
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" },
      dependsOn: ["SPEC-9"],
    });
    expect(r.success && r.data.dependsOn).toEqual(["SPEC-9"]);
  });
  it("zPatchSpec menerima dependsOn (termasuk pengosongan)", () => {
    expect(zPatchSpec.parse({ dependsOn: [] }).dependsOn).toEqual([]);
  });
  it("zTerminalSession varian spec menerima force", () => {
    const r = zTerminalSession.safeParse({ spec: "SPEC-1", flow: "feature", force: true });
    expect(r.success && "force" in r.data && r.data.force).toBe(true);
  });
});
