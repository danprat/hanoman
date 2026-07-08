import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/api/client";
beforeEach(() => { globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify([{ id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
    docStatus: "ok", coverage: 94, createdAt: new Date().toISOString(), backlog: 2, topStage: "execute",
    run: { status: "running", phase: "Execute", kind: "feature" }, activity: "x", commit: "y" }]),
    { status: 200, headers: { "content-type": "application/json" } })) as any; });
describe("api client", () => {
  it("listProjects hits /api/projects and returns views", async () => {
    const ps = await api.listProjects();
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects");
    expect(ps[0]!.backlog).toBe(2);
  });
});
