import { describe, it, expect, beforeAll } from "vitest";
import { seed } from "../prisma/seed";
import { prisma } from "../src/db";
import { RunManager } from "../src/runner/manager";
import type { RunDeps } from "@hanoman/runner";
const fakeDeps: RunDeps = {
  queryFn: () => (async function* () { yield { type: "result", subtype: "success", session_id: "s", total_cost_usd: 0.2, usage: { input_tokens: 9, output_tokens: 3 } }; })(),
  git: { addWorktree() {}, removeWorktree() {}, commitAndPush() {}, switchBase() {} },
  verify: () => ({ blocked: false }), effortToThinking: () => undefined };
describe("RunManager", () => {
  beforeAll(async () => { await seed(); });
  it("persists log + final status for a run", async () => {
    const mgr = new RunManager();
    const events: string[] = [];
    const unsub = mgr.subscribe("RUN-8842", (e) => events.push(e.kind));
    await mgr.start({ runId: "RUN-8842", repoDir: "/tmp/x", branchFrom: "main", branchTo: "feat/x",
      flow: "feature", steps: await (await import("../src/services/settings")).stepModels() }, fakeDeps);
    unsub();
    const run = await prisma.run.findUnique({ where: { id: "RUN-8842" } });
    expect(run?.status).toBe("done");
    expect((run?.log as any[]).length).toBeGreaterThan(0);
    expect(events).toContain("status");
  });
});
