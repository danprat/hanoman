import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { persistEvent } from "../src/runner/events-io";
import { resetDb, makeProject, makeRun } from "./factory";

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
