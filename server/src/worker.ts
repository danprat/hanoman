import { Worker, type Job } from "bullmq";
import type { Trigger } from "@hanoman/shared";
import { runOne, SteerQueue, type Ask, type RunDeps, type RunEvent, type RunInput } from "@hanoman/runner";
import { depsWithGuard } from "./runner/deps";
import { bullConnection, publisher, subscriber } from "./redis";
import { RUNS_QUEUE, runsQueue } from "./queue";
import { SCHEDULES_QUEUE, reconcile } from "./schedules";
import { fireTrigger } from "./fire-trigger";
import { getSetting, maxConcurrent } from "./services/settings";
import { persistEvent, publishEvent } from "./runner/events-io";
import { checkRunnerCredentials } from "./runner/credentials";
import { ensureClone } from "./github/clone";
import { installationToken } from "./github/app";
import { startStatusReporter } from "./github/status";
import { prisma } from "./db";

// A stalled/failed job leaves the run mid-flight; mark it failed so the UI and
// budget see a terminal state. Best-effort: the row may already be gone.
// `finishedAt` ikut ditulis — tanpanya run yang mati lewat jalur ini terlihat terminal tapi
// tak pernah selesai, tidak seperti setiap penulis status terminal yang lain.
export async function markFailed(runId: string): Promise<void> {
  await prisma.run.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date() } }).catch(() => {});
}

// Status terminal hanya pernah ditulis oleh worker yang hidup — lewat `worker.on("failed")`
// / `on("stalled")` di bawah. Worker mati (atau Redis di-restart) di tengah run: job-nya
// lenyap dan barisnya tersangkut `running` selamanya, tak ada lagi yang bisa
// menggerakkannya. Saat boot, run non-terminal yang tak punya job adalah run yatim.
// jobId = runId (lihat enqueueRun), jadi satu getJob per baris sudah cukup. Job yang masih
// dipegang worker lain tetap ditemukan → tidak ikut ditandai.
export async function reconcileRuns(
  queue: { getJob(id: string): Promise<unknown> } = runsQueue,
): Promise<string[]> {
  // `awaiting` ikut (SPEC-157): prosesnya hidup dan terblokir menunggu jawaban, jadi worker
  // yang mati meninggalkannya yatim persis seperti `running`. `paused` TIDAK: prosesnya memang
  // sudah mati dan job-nya memang sudah tak ada — memasukkannya menandai `failed` setiap run
  // yang di-pause dengan sengaja.
  const live = await prisma.run.findMany({
    where: { status: { in: ["queued", "running", "awaiting"] } }, select: { id: true },
  });
  const orphans: string[] = [];
  for (const { id } of live) if (!(await queue.getJob(id))) orphans.push(id);
  if (orphans.length) {
    await prisma.run.updateMany({ where: { id: { in: orphans } }, data: { status: "failed", finishedAt: new Date() } });
  }
  return orphans;
}

// Process one run job: subscribe to its control channel, drive runOne, and
// persist+publish every event. Persists are chained so read-modify-write events
// (log/phase/file) can't race; awaited before returning so the final status lands.
export async function runProcessor(job: Job<RunInput>, deps?: RunDeps): Promise<void> {
  // Guardrail Source of Truth dijalankan sebagai subprocess di worktree run, jadi switch-nya
  // harus dibaca di sini — satu-satunya titik yang punya DB — lalu dititipkan ke deps.verify.
  const setting = await getSetting();
  const d = deps ?? depsWithGuard(setting);
  let input = job.data;
  const id = input.runId;
  // Load the backlog item this run was queued for, fresh from the DB (the job
  // payload carries only its id). Throws when the spec is gone → the job fails
  // rather than running an unscoped agent that matches no backlog item.
  if (input.specId) {
    const s = await prisma.spec.findUniqueOrThrow({ where: { id: input.specId } });
    input = { ...input, spec: { id: s.id, title: s.title, source: s.source, priority: s.priority, objective: s.objective, payload: s.payload ?? undefined } };
  }
  // Run yang di-`resume`/`retry` memakai runId yang sama, dan barisnya menyimpan sesi claude
  // milik run itu plus fase mana yang sudah selesai. Keduanya dibaca di sini, bukan dititipkan
  // ke payload job: payload-nya dibuat saat enqueue, sebelum fase terakhir sempat rampung.
  // Run baru belum punya sessionId → runner membuka sesi baru, persis seperti sebelumnya.
  const row = await prisma.run.findUnique({ where: { id }, select: { sessionId: true, phases: true, pendingAsk: true } });
  // Pertanyaan yang belum terjawab dari percobaan sebelumnya (SPEC-157). Dibawa masuk supaya
  // runner menanyakannya ULANG sebelum giliran fase apa pun. Tanpa ini, sesi yang di-resume
  // membawa pertanyaan agen di konteksnya, prompt fase berikutnya terbaca seperti izin lanjut,
  // dan agen memakai default-nya lalu melaporkannya sebagai keputusan yang sah.
  if (row?.pendingAsk) input = { ...input, pendingAsk: row.pendingAsk as unknown as Ask };
  if (row?.sessionId) {
    // "Jangan jalankan lagi" = selesai ATAU dipangkas keputusan audit (SPEC-145). Melewatkan
    // `skipped` di sini membuat run qa jalur cepat yang di-resume mengingkari keputusannya
    // sendiri dan menjalankan Spec + Plan yang sudah ditandai dilewati.
    const done = (row.phases as { name: string; state: string }[])
      .filter((p) => p.state === "done" || p.state === "skipped").map((p) => p.name);
    input = { ...input, resume: row.sessionId, donePhases: done };
  }
  // github-backed run: clone the private repo on demand and push over a remote
  // carrying a freshly-minted installation token (never persisted). Local runs
  // (no installationId) skip this and behave exactly as before.
  if (input.installationId != null && input.reportRepo) {
    await ensureClone({ repoDir: input.repoDir, repoUrl: input.reportRepo, installationId: input.installationId });
    const token = await installationToken(input.installationId);
    input = { ...input, remoteUrl: `https://x-access-token:${token}@github.com/${input.reportRepo}.git` };
  }
  const abortController = new AbortController();
  const steer = new SteerQueue();
  // Antrian terpisah (SPEC-157): sebuah pesan `steer` tidak boleh tak sengaja menjawab
  // pertanyaan desain. Steer menjadi giliran ekstra setelah fase; jawaban membuka blokir fase.
  const answers = new SteerQueue();
  const pub = publisher();
  const sub = subscriber();
  await sub.subscribe(`run:${id}:control`);
  sub.on("message", (_ch, raw) => {
    try {
      const msg = JSON.parse(raw) as { type: string; message?: string; value?: string };
      if (msg.type === "steer" && msg.message) steer.push(msg.message);
      else if (msg.type === "answer" && msg.value) answers.push(msg.value);
      else if (msg.type === "pause" || msg.type === "stop") abortController.abort();
    } catch { /* ignore malformed control */ }
  });
  let pending = Promise.resolve();
  const onEvent = (e: RunEvent) => {
    pending = pending.then(() => persistEvent(id, e)).catch((err) => console.error(`persist ${id}`, err));
    publishEvent(pub, id, e);
  };
  try {
    await runOne(input, d, onEvent, { abortController, steer, answers, askTimeoutMs: (setting.askTimeoutMin ?? 30) * 60_000 });
  } finally {
    await pending;
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
    const orphans = await reconcileRuns();
    if (orphans.length) console.log(`[worker] ${orphans.length} run yatim ditandai failed: ${orphans.join(", ")}`);
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
