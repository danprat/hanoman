import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { persistEvent, mirrorStage } from "../src/runner/events-io";
import { resetDb, makeProject, makeRun, makeSpec } from "./factory";

describe("persistEvent finishedAt (SPEC-008)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1", status: "running" }); });

  it("sets finishedAt on a terminal status", async () => {
    await persistEvent("RUN-1", { kind: "status", status: "done" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.status).toBe("done");
    expect(run.finishedAt).not.toBeNull();
  });

  it("leaves finishedAt null on a non-terminal status", async () => {
    await persistEvent("RUN-1", { kind: "status", status: "running" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.finishedAt).toBeNull();
  });
});

describe("mirrorStage (SPEC-009, pure)", () => {
  it("maps Objective done -> objective", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Objective", state: "done" })).toBe("objective"));
  it("maps Audit done -> objective (qa)", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Audit", state: "done" })).toBe("objective"));
  it("maps Spec done -> spec-ready", () =>
    expect(mirrorStage("objective", { kind: "phase", name: "Spec", state: "done" })).toBe("spec-ready"));
  it("maps Plan done -> planned", () =>
    expect(mirrorStage("spec-ready", { kind: "phase", name: "Plan", state: "done" })).toBe("planned"));
  it("maps Execute active -> executing", () =>
    expect(mirrorStage("planned", { kind: "phase", name: "Execute", state: "active" })).toBe("executing"));
  it("maps status done -> done", () =>
    expect(mirrorStage("executing", { kind: "status", status: "done" })).toBe("done"));
  it("does not move on Brainstorm done", () =>
    expect(mirrorStage("brainstorming", { kind: "phase", name: "Brainstorm", state: "done" })).toBeNull());
  it("never moves backward", () =>
    expect(mirrorStage("planned", { kind: "phase", name: "Objective", state: "done" })).toBeNull());
  it("ignores non-terminal status", () =>
    expect(mirrorStage("planned", { kind: "status", status: "running" })).toBeNull());
});

describe("persistEvent stage mirror (SPEC-009, db)", () => {
  beforeEach(async () => {
    await resetDb(); await makeProject();
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "brainstorming" });
  });

  it("advances the linked spec on a phase-done event", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", specId: "SPEC-1", status: "running" });
    await persistEvent("RUN-1", { kind: "phase", name: "Objective", state: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } });
    expect(spec.stage).toBe("objective");
  });

  it("marks the spec done on a terminal status", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "executing" });
    await makeRun({ id: "RUN-2", projectId: "p1", specId: "SPEC-2", status: "running" });
    await persistEvent("RUN-2", { kind: "status", status: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-2" } });
    expect(spec.stage).toBe("done");
  });

  it("leaves specs untouched for a run with no specId", async () => {
    await makeRun({ id: "RUN-3", projectId: "p1", specId: null, status: "running" });
    await persistEvent("RUN-3", { kind: "phase", name: "Objective", state: "done" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-1" } });
    expect(spec.stage).toBe("brainstorming");
  });
});
