import { describe, it, expect, vi, afterAll } from "vitest";
import { startStatusReporter } from "../src/github/status";
import { prisma } from "../src/db";
import { publisher } from "../src/redis";

// Drive the reporter end-to-end against real Redis + Postgres with a fake
// octokit: a github-backed run's status event → a commit status is posted.
describe("startStatusReporter", () => {
  const pub = publisher();
  afterAll(async () => { await pub.quit(); });

  it("posts a commit status when a github-backed run's status changes", async () => {
    const runId = "RUN-STATUS-RPT";
    await prisma.project.upsert({
      where: { id: "rpt-proj" },
      update: { installationId: 77 },
      create: { id: "rpt-proj", name: "rpt", desc: "", kind: "app", docStatus: "ok", coverage: 0, installationId: 77 },
    });
    await prisma.run.upsert({
      where: { id: runId },
      update: { status: "queued", commitSha: "deadbee", reportRepo: "nafanesia/arta" },
      create: {
        id: runId, projectId: "rpt-proj", kind: "feature", status: "queued", trigger: "commit", triggerDetail: "",
        commitSha: "deadbee", reportRepo: "nafanesia/arta",
        phases: [], plan: [], files: [], log: [], worktree: "", branchFrom: "main", branchTo: "hanoman/x",
        model: "", tokensIn: "—", tokensOut: "—", cost: "$0.00", progress: 0,
      },
    });

    const createCommitStatus = vi.fn(async () => ({}));
    const getOcto = async (_id: number) => ({ rest: { repos: { createCommitStatus } } });
    const reporter = startStatusReporter({ getOcto });
    await reporter.ready;

    await pub.publish(`run:${runId}:events`, JSON.stringify({ kind: "status", status: "done" }));

    // pub/sub is async; poll until the reporter processes the message.
    for (let i = 0; i < 60 && createCommitStatus.mock.calls.length === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    await reporter.stop();

    expect(createCommitStatus).toHaveBeenCalledTimes(1);
    expect(createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "nafanesia", repo: "arta", sha: "deadbee", state: "success", context: "hanoman" }),
    );

    await prisma.run.delete({ where: { id: runId } }).catch(() => {});
    await prisma.project.delete({ where: { id: "rpt-proj" } }).catch(() => {});
  });
});
