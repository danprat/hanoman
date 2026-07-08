import { Worker, type Job } from "bullmq";
import type { Trigger } from "@hanoman/shared";
import { runOne, SteerQueue, type RunDeps, type RunEvent, type RunInput } from "@hanoman/runner";
import { prodDeps } from "./runner/deps";
import { bullConnection, publisher, subscriber } from "./redis";
import { RUNS_QUEUE, runsQueue } from "./queue";
import { SCHEDULES_QUEUE, reconcile } from "./schedules";
import { fireTrigger } from "./fire-trigger";
import { maxConcurrent } from "./services/settings";
import { persistEvent, publishEvent } from "./runner/events-io";
import { checkRunnerCredentials } from "./runner/credentials";
import { ensureClone } from "./github/clone";
import { installationToken } from "./github/app";
import { startStatusReporter } from "./github/status";
import { prisma } from "./db";

// A stalled/failed job leaves the run mid-flight; mark it failed so the UI and
// budget see a terminal state. Best-effort: the row may already be gone.
export async function markFailed(runId: string): Promise<void> {
  await prisma.run.update({ where: { id: runId }, data: { status: "failed" } }).catch(() => {});
}

// Process one run job: subscribe to its control channel, drive runOne, and
// persist+publish every event. Persists are chained so read-modify-write events
// (log/phase/file) can't race; awaited before returning so the final status lands.
export async function runProcessor(job: Job<RunInput>, deps: RunDeps = prodDeps): Promise<void> {
  let input = job.data;
  const id = input.runId;
  // github-backed run: clone the private repo on demand and push over a remote
  // carrying a freshly-minted installation token (never persisted). Local runs
  // (no installationId) skip this and behave exactly as before.
  if (input.installationId != null && input.reportRepo) {
    await ensureClone({ repoDir: input.repoDir, repoUrl: input.reportRepo, installationId: input.installationId });
    const token = await installationToken(input.installationId);
    input = { ...input, remoteUrl: `https://x-access-token:${token}@github.com/${input.reportRepo}.git` };
  }
  const abortController = new AbortController();
  const steer = new SteerQueue("mulai");
  const pub = publisher();
  const sub = subscriber();
  await sub.subscribe(`run:${id}:control`);
  sub.on("message", (_ch, raw) => {
    try {
      const msg = JSON.parse(raw) as { type: string; message?: string };
      if (msg.type === "steer" && msg.message) steer.push(msg.message);
      else if (msg.type === "pause" || msg.type === "stop") abortController.abort();
    } catch { /* ignore malformed control */ }
  });
  let pending = Promise.resolve();
  const onEvent = (e: RunEvent) => {
    pending = pending.then(() => persistEvent(id, e)).catch((err) => console.error(`persist ${id}`, err));
    publishEvent(pub, id, e);
  };
  try {
    await runOne(input, deps, onEvent, { abortController, steer });
  } finally {
    await pending;
    steer.close();
    await sub.quit();
    await pub.quit();
  }
}

// Bootstrap the Worker only when this file is the process entrypoint
// (`node dist/worker.js` / `tsx worker.ts`), not when imported by tests.
const entry = process.argv[1] ?? "";
if (entry.endsWith("worker.js") || entry.endsWith("worker.ts")) {
  // Fail fast on a misconfigured deployment: a headless worker with no Claude
  // credential in env would otherwise fail silently at the first run (the SDK
  // stream ends without a result). See SPEC-007.
  const cred = checkRunnerCredentials();
  if (!cred.ok) {
    console.error(`[worker] refusing to boot — ${cred.reason}.`);
    console.error("[worker] set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token` for a subscription), or ANTHROPIC_API_KEY, or a cloud-provider flag — see .env.example. Bypass with HANOMAN_SKIP_CRED_CHECK=1.");
    process.exit(1);
  }
  if (cred.hasEnvCred) console.log(`[worker] Claude credential: ${cred.found.join(", ")}`);
  else console.warn(`[worker] ${cred.reason}. Prefer CLAUDE_CODE_OAUTH_TOKEN for headless runs.`);
  (async () => {
    const worker = new Worker(RUNS_QUEUE, (job) => runProcessor(job), {
      connection: bullConnection, concurrency: await maxConcurrent(), maxStalledCount: 1,
    });
    // failed carries the Job; stalled carries only the jobId → look up its runId.
    worker.on("failed", (job) => { if (job) void markFailed(job.data.runId); });
    worker.on("stalled", (jobId) => { void runsQueue.getJob(jobId).then((j) => j && markFailed(j.data.runId)); });
    console.log(`worker up · queue ${RUNS_QUEUE} · concurrency ${worker.opts.concurrency}`);

    // A scheduled "fire" job re-reads the trigger (it may have been disabled
    // between scheduling and firing) and fans it out to run(s) via fireTrigger.
    const scheduler = new Worker<{ triggerId: string }>(SCHEDULES_QUEUE, async (job) => {
      const t = await prisma.trigger.findUnique({ where: { id: job.data.triggerId } });
      if (t?.enabled) await fireTrigger(t as Trigger);
    }, { connection: bullConnection });
    scheduler.on("failed", (job, err) => console.error(`schedule fire ${job?.data.triggerId} failed`, err));
    await reconcile(); // DB → schedulers on boot
    console.log(`scheduler up · queue ${SCHEDULES_QUEUE}`);

    // Report github-backed run outcomes as commit statuses (SPEC-006).
    startStatusReporter();
    console.log("status reporter up · run:*:events");
  })();
}
