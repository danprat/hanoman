import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { toProjectView } from "../src/services/project-view";
describe("project view", () => {
  beforeAll(async () => { await seed(); });
  it("arta backlog count reflects its specs", async () => {
    const v = await toProjectView("arta"); expect(v.backlog).toBe(2); }); // SPEC-142, SPEC-138
  it("arta run summary comes from newest run", async () => {
    const v = await toProjectView("arta"); expect(v.run.status).toBe("running"); });
  it("idle project has an idle run summary", async () => {
    const v = await toProjectView("wanara"); expect(v.run).toEqual({status:"idle",phase:null,kind:null}); });
});
