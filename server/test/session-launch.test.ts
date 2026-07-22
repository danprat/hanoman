import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { startSpecSession, LaunchError, sessionIdForSpec } from "../src/services/session-launch";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("session-launch", () => {
  it("sessionIdForSpec sanitizes to tmux-safe id", () => {
    expect(sessionIdForSpec("SPEC-12")).toBe("spec-12");
  });
  it("throws LaunchError needs-bind when the project has no local checkout", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); // repoDir null
    const spec = await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "" } });
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "needs-bind" });
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.baseSha).toBeNull(); // tak menyentuh baseSha
  });
});
