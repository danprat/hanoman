import { describe, it, expect } from "vitest";
import { zProject, zSpec, zStage, zCreateSpec, zProjectView } from "../src/index";

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
  it("project view adds derived fields", () => {
    const v = zProjectView.parse({ id: "a", name: "a", desc: "", kind: "existing", docStatus: "ok",
      coverage: 94, createdAt: new Date().toISOString(), stack: "Go", backlog: 6, topStage: "execute",
      run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" });
    expect(v.backlog).toBe(6);
  });
});
