import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeSpec, makeRun } from "./factory";
import { toProjectView } from "../src/services/project-view";
describe("project view", () => {
  beforeEach(async () => {
    await resetDb();
    // p1: two non-done specs + a running run.
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "planned" });
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "spec-ready" });
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    // p2: no runs → idle.
    await makeProject({ id: "p2" });
  });
  it("backlog count reflects its non-done specs", async () => {
    const v = await toProjectView("p1"); expect(v.backlog).toBe(2); }); // SPEC-1, SPEC-2
  it("run summary comes from newest run", async () => {
    const v = await toProjectView("p1"); expect(v.run.status).toBe("running"); });
  it("idle project has an idle run summary", async () => {
    const v = await toProjectView("p2"); expect(v.run).toEqual({status:"idle",phase:null,kind:null}); });
});
