import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, makeProject, makeRun, makeSetting } from "./factory";
import { prisma } from "../src/db";
import { runProcessor } from "../src/worker";
import type { RunDeps } from "@hanoman/runner";

const fakeDeps: RunDeps = {
  queryFn: () => (async function* () {
    yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } };
  })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  verify: () => ({ blocked: false }),
};

describe("worker processor", () => {
  beforeAll(async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await makeSetting();
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
  });
  it("runs a job and persists final status", async () => {
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-1", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, fakeDeps);
    expect((await prisma.run.findUnique({ where: { id: "RUN-1" } }))?.status).toBe("done");
  });
});
