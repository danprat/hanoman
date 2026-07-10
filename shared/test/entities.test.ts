import { describe, it, expect } from "vitest";
import { zProject, zSpec, zStage, zCreateSpec, zPatchSpec, zProjectView, zRun } from "../src/index";

describe("schemas", () => {
  it("parses a valid project", () => {
    const p = zProject.parse({ id: "arta", name: "arta", desc: "x", kind: "existing",
      docStatus: "ok", coverage: 94, createdAt: new Date().toISOString() });
    expect(p.coverage).toBe(94);
  });
  it("rejects coverage over 100", () => {
    expect(() => zProject.parse({ id: "a", name: "a", desc: "", kind: "existing",
      docStatus: "ok", coverage: 101, createdAt: new Date().toISOString() })).toThrow();
  });
  it("stage enum has the six stages in order", () => {
    expect(zStage.options).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]);
  });
  it("create-spec brief payload validates", () => {
    const b = zCreateSpec.parse({ project: "arta", source: "brief", title: "T",
      priority: "sedang", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });
    expect(b.source).toBe("brief");
  });
  // SPEC-143: branch sumber worktree adalah properti backlog item.
  it("spec carries a nullable branchFrom", () => {
    const base = { id: "SPEC-1", projectId: "p1", title: "t", source: "brief" as const,
      stage: "brainstorming" as const, priority: "sedang" as const, author: "a", objective: "o", payload: null };
    expect(zSpec.parse({ ...base, branchFrom: null }).branchFrom).toBeNull();
    expect(zSpec.parse({ ...base, branchFrom: "release/v2" }).branchFrom).toBe("release/v2");
  });
  it("create-spec takes an optional branchFrom", () => {
    const b = { project: "arta", source: "brief" as const, title: "T", priority: "sedang" as const,
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" as const } };
    expect(zCreateSpec.parse(b).branchFrom).toBeUndefined();
    expect(zCreateSpec.parse({ ...b, branchFrom: "dev" }).branchFrom).toBe("dev");
  });
  // nullable, bukan optional: null = "kosongkan", dan itu harus terbedakan dari "jangan sentuh".
  it("patch-spec: null clears the branch, an absent key is not a valid patch", () => {
    expect(zPatchSpec.parse({ branchFrom: null }).branchFrom).toBeNull();
    expect(zPatchSpec.safeParse({ branchFrom: "" }).success).toBe(false);
    expect(zPatchSpec.safeParse({}).success).toBe(false);
  });
  it("project view adds derived fields", () => {
    const v = zProjectView.parse({ id: "a", name: "a", desc: "", kind: "existing", docStatus: "ok",
      coverage: 94, createdAt: new Date().toISOString(), stack: "Go", backlog: 6, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" });
    expect(v.backlog).toBe(6);
  });
});

describe("SPEC-144 Run sha", () => {
  const base = {
    id: "RUN-1", projectId: "p1", specId: null, kind: "feature" as const, status: "running" as const,
    trigger: "manual" as const, triggerDetail: "", phases: [], plan: [], log: [],
    worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
    model: "", tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
    createdAt: "2026-07-09T00:00:00.000Z", finishedAt: null, pendingAsk: null,
  };
  it("menerima baseSha/headSha null", () => {
    const r = zRun.parse({ ...base, baseSha: null, headSha: null });
    expect(r.baseSha).toBeNull();
    expect(r.headSha).toBeNull();
  });
  it("menerima SHA", () => {
    const r = zRun.parse({ ...base, baseSha: "4e7f6d6", headSha: "db87a19" });
    expect(r.headSha).toBe("db87a19");
  });
});
