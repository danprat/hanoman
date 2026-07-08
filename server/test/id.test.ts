import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeSpec } from "./factory";
import { nextSpecId } from "../src/services/id";
describe("id", () => {
  beforeEach(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-142", projectId: "p1" });
  });
  it("next spec id is one past the max", async () => expect(await nextSpecId()).toBe("SPEC-143"));
});
