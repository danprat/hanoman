import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { persistEvent, mirrorStage, computeProgress } from "../src/runner/events-io";
import { resetDb, makeProject, makeRun, makeSpec } from "./factory";

describe("computeProgress (SPEC-010, pure)", () => {
  const P = (states: string[]) => states.map((state, i) => ({ name: `P${i}`, state }));
  it("is 0 for an empty array", () => expect(computeProgress([])).toBe(0));
  it("counts only done phases", () =>
    expect(computeProgress(P(["done", "done", "done", "done", "active"]))).toBe(80));
  it("is 100 when every phase is done", () =>
    expect(computeProgress(P(["done", "done"]))).toBe(100));
  it("does not count a failed phase as done", () =>
    expect(computeProgress(P(["done", "done", "done", "done", "failed"]))).toBe(80));
  // SPEC-145: fase yang dipangkas keputusan audit keluar dari PENYEBUT. Tanpa ini, run
  // jalur cepat yang sukses (Audit + Execute done, Spec + Plan skipped) melapor 50%.
  it("excludes skipped phases from the denominator", () =>
    expect(computeProgress(P(["done", "skipped", "skipped", "done"]))).toBe(100));
  it("does not count a skipped phase as done", () =>
    expect(computeProgress(P(["done", "skipped", "skipped", "active"]))).toBe(50));
  it("is 0 when every phase is skipped", () =>
    expect(computeProgress(P(["skipped", "skipped"]))).toBe(0));
});

describe("persistEvent finishedAt (SPEC-008)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1", status: "running" }); });

  it("sets finishedAt on a terminal status", async () => {
    await persistEvent("RUN-1", { kind: "status", status: "done" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.status).toBe("done");
    expect(run.finishedAt).not.toBeNull();
  });

  // SPEC-145: `skipped` bertahan di kolom Json dan progress-nya jujur (2 done, 2 skipped → 100%).
  it("persists a skipped phase and reports 100% when the rest are done", async () => {
    await prisma.run.update({ where: { id: "RUN-1" }, data: { phases: [
      { name: "Audit", state: "done" }, { name: "Spec", state: "pending" },
      { name: "Plan", state: "pending" }, { name: "Execute", state: "done" },
    ] as any } });
    await persistEvent("RUN-1", { kind: "phase", name: "Spec", state: "skipped" });
    await persistEvent("RUN-1", { kind: "phase", name: "Plan", state: "skipped" });

    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect((run.phases as any[]).map((p) => p.state)).toEqual(["done", "skipped", "skipped", "done"]);
    expect(run.progress).toBe(100);
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

describe("persistEvent progress (SPEC-010, db)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); });

  it("sets progress to 100 when the final phase completes", async () => {
    await makeRun({ id: "RUN-P1", projectId: "p1", status: "running" });
    await persistEvent("RUN-P1", { kind: "phase", name: "Execute", state: "done" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-P1" } });
    expect(run.progress).toBe(100);
  });

  it("leaves progress at the done-fraction when a phase fails (RUN-8801 shape)", async () => {
    await makeRun({ id: "RUN-P2", projectId: "p1", status: "running" });
    await persistEvent("RUN-P2", { kind: "phase", name: "Execute", state: "failed" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-P2" } });
    expect(run.progress).toBe(80); // 4 of 5 phases done
  });
});

// SPEC-013: satu sesi per run, jadi sessionId adalah fakta tingkat-run — bukan tingkat-fase.
describe("persistEvent sessionId (SPEC-013)", () => {
  beforeEach(async () => { await resetDb(); await makeProject(); await makeRun({ id: "RUN-1", projectId: "p1", status: "running" }); });

  it("stores the claude session id so the terminal can resume the run", async () => {
    await persistEvent("RUN-1", { kind: "session", sessionId: "abc-123" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: "RUN-1" } });
    expect(run.sessionId).toBe("abc-123");
  });
});
