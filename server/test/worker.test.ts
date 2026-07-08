import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { runProcessor } from "../src/worker";
import type { RunDeps } from "@hanoman/runner";

const fakeDeps: RunDeps = {
  queryFn: () => (async function* () {
    yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } };
  })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  verify: () => ({ blocked: false }),
  effortToThinking: () => undefined,
};

describe("worker processor", () => {
  beforeAll(async () => { await seed(); });
  it("runs a job and persists final status", async () => {
    const steps = await (await import("../src/services/settings")).stepModels();
    await runProcessor({ data: { runId: "RUN-8842", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x", flow: "feature", steps } } as any, fakeDeps);
    expect((await prisma.run.findUnique({ where: { id: "RUN-8842" } }))?.status).toBe("done");
  });
});
