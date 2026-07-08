import type Redis from "ioredis";
import { subscriber } from "../redis";
import { prisma } from "../db";
import { getInstallationOctokit } from "./app";

// Run status → GitHub commit-status state. Unmapped statuses (e.g. "paused")
// return undefined and post nothing.
const STATE: Record<string, "pending" | "success" | "failure"> = {
  running: "pending", done: "success", failed: "failure", stopped: "failure",
};

export async function postStatus(
  octo: { rest: { repos: { createCommitStatus: (a: unknown) => Promise<unknown> } } },
  at: { owner: string; repo: string; sha: string },
  runStatus: string,
): Promise<void> {
  const state = STATE[runStatus];
  if (!state) return;
  await octo.rest.repos.createCommitStatus({ ...at, state, context: "hanoman" });
}

// Subscribe to every run's event channel; when a github-backed run (has
// commitSha + reportRepo, and its project has an installationId) changes status,
// post the corresponding commit status. octokit-getter/subscriber are injectable
// for tests.
export function startStatusReporter(opts: {
  sub?: Redis;
  getOcto?: (installationId: number) => Promise<any>;
} = {}): { stop: () => Promise<void>; ready: Promise<unknown> } {
  const sub = opts.sub ?? subscriber();
  const getOcto = opts.getOcto ?? getInstallationOctokit;
  const ready = sub.psubscribe("run:*:events");
  sub.on("pmessage", (_pattern, channel, raw) => {
    void (async () => {
      try {
        const e = JSON.parse(raw) as { kind?: string; status?: string };
        if (e.kind !== "status" || !e.status || !STATE[e.status]) return;
        const runId = channel.split(":")[1]; // run:<id>:events
        const run = await prisma.run.findUnique({ where: { id: runId } });
        if (!run?.commitSha || !run.reportRepo) return;
        const project = await prisma.project.findUnique({ where: { id: run.projectId } });
        if (project?.installationId == null) return;
        const [owner, repo] = run.reportRepo.split("/");
        if (!owner || !repo) return;
        const octo = await getOcto(project.installationId);
        await postStatus(octo, { owner, repo, sha: run.commitSha }, e.status);
      } catch (err) {
        console.error("statusReporter", err);
      }
    })();
  });
  return { stop: async () => { await sub.quit(); }, ready };
}
