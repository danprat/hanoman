import { describe, it, expect } from "vitest";
import { zProject, zSpec, zStage, zCreateSpec, zPatchSpec, zProjectView, zNotification, zSetting } from "../src/index";

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
  // SPEC-197 · source harus cocok dengan bentuk payload (qa↔severity), agar deriveSpecFields tak
  // menurunkan objective/priority dari bentuk yang salah.
  it("create-spec menolak source qa dengan brief payload (dan sebaliknya)", () => {
    const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
    const qa = { severity: "major" as const, steps: "s", expected: "e", actual: "a", env: "x" };
    expect(zCreateSpec.safeParse({ project: "arta", source: "qa", title: "T", priority: "sedang", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ project: "arta", source: "brief", title: "T", priority: "sedang", payload: qa }).success).toBe(false);
    expect(zCreateSpec.safeParse({ project: "arta", source: "qa", title: "T", priority: "sedang", payload: qa }).success).toBe(true);
  });
  // SPEC-143: branch sumber worktree adalah properti backlog item.
  it("spec carries a nullable branchFrom", () => {
    const base = { id: "SPEC-1", projectId: "p1", title: "t", source: "brief" as const,
      stage: "brainstorming" as const, priority: "sedang" as const, author: "a", objective: "o",
      payload: null, baseSha: null }; // baseSha wajib (nullable) sejak SPEC-186 — test lama terlewat
    expect(zSpec.parse({ ...base, branchFrom: null }).branchFrom).toBeNull();
    expect(zSpec.parse({ ...base, branchFrom: "release/v2" }).branchFrom).toBe("release/v2");
  });
  it("create-spec takes an optional branchFrom", () => {
    const b = { project: "arta", source: "brief" as const, title: "T", priority: "sedang" as const,
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" as const } };
    expect(zCreateSpec.parse(b).branchFrom).toBeUndefined();
    expect(zCreateSpec.parse({ ...b, branchFrom: "dev" }).branchFrom).toBe("dev");
  });
  // branchFrom: null = "kosongkan", undefined = "jangan sentuh". Sejak SPEC-167 branchFrom
  // opsional (patch bisa hanya menyentuh stage), jadi `{}` sah sebagai no-op.
  it("patch-spec: null clears the branch, empty string invalid, absent key is a no-op patch", () => {
    expect(zPatchSpec.parse({ branchFrom: null }).branchFrom).toBeNull();
    expect(zPatchSpec.safeParse({ branchFrom: "" }).success).toBe(false);
    expect(zPatchSpec.safeParse({}).success).toBe(true);
  });
  // SPEC-167 · stage revert: hanya nilai zStage yang valid; confirmDelete opsional.
  it("patch-spec: stage terbatas ke enum zStage; confirmDelete opsional", () => {
    expect(zPatchSpec.parse({ stage: "objective" }).stage).toBe("objective");
    expect(zPatchSpec.parse({ stage: "planned", confirmDelete: true }).confirmDelete).toBe(true);
    expect(zPatchSpec.safeParse({ stage: "hantu" }).success).toBe(false);
  });
  it("project view adds derived fields", () => {
    const v = zProjectView.parse({ id: "a", name: "a", desc: "", kind: "existing", docStatus: "ok",
      coverage: 94, createdAt: new Date().toISOString(), stack: "Go", backlog: 6, topStage: "execute",
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" });
    expect(v.backlog).toBe(6);
  });
  // SPEC-184 · notifikasi human decision
  it("zNotification decision: specId null, sessionId terisi, type decision", () => {
    const r = zNotification.safeParse({ id: "1", type: "decision", specId: null, sessionId: "s1",
      title: "x", projectId: "p1", createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.success).toBe(true);
  });
  it("zNotification: type default done bila tak diberikan", () => {
    const r = zNotification.parse({ id: "1", specId: "SPEC-1", sessionId: null,
      title: "x", projectId: null, createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.type).toBe("done");
  });
  it("zSetting mengisi default notifyDecision + notifyDecisionSound", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.notifyDecision).toBe(true);
    expect(s.notifyDecisionSound).toBe("alert");
  });
});
