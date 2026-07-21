import { describe, it, expect } from "vitest";
import { zProjectId, zRenameProject } from "../src/dto";

describe("zProjectId / zRenameProject (SPEC-255)", () => {
  it("menerima slug sah", () => {
    expect(zProjectId.safeParse("my-proj-2").success).toBe(true);
    expect(zProjectId.safeParse("a").success).toBe(true);
    expect(zProjectId.safeParse("a1").success).toBe(true);
  });
  it("menolak slug tak sah", () => {
    for (const bad of ["", "-lead", "Upper", "spasi ada", "under_score", "trail-"])
      expect(zProjectId.safeParse(bad).success).toBe(false);
  });
  it("zRenameProject butuh newId slug sah", () => {
    expect(zRenameProject.safeParse({ newId: "ok-1" }).success).toBe(true);
    expect(zRenameProject.safeParse({ newId: "Bad" }).success).toBe(false);
    expect(zRenameProject.safeParse({}).success).toBe(false);
  });
});
