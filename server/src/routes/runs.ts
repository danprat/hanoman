import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zSteer, zControl, zWorktreePatch, zCommand, zStartRun } from "@hanoman/shared";
import { realGit, type Flow } from "@hanoman/runner";
import { subscriber, publisher } from "../redis";
import { enqueueRun } from "../queue";
import { stepModels } from "../services/settings";
import { nextRunId } from "../services/id";

type Line = { t: string; s: string };

// Cross-process control plane: publish to run:<id>:control (worker subscribes).
// Short-lived connection per call — control actions are rare, so open→publish→quit
// keeps no lingering sockets (a subscribed connection can't be shared for publish).
async function publishControl(runId: string, msg: unknown): Promise<void> {
  const p = publisher();
  try { await p.publish(`run:${runId}:control`, JSON.stringify(msg)); }
  finally { await p.quit(); }
}
const TERM_HELP = "perintah: help · status · plan · files · steer <pesan> · pause · resume · stop · docs <path> · clear";
// Terminal interpreter, mirrors .prototype/app/RunsScreen.jsx runCommand, reading
// plan/files/phases from the persisted Run.
function runCommand(run: { id: string; status: string; kind: string; progress: number; phases: unknown; plan: unknown; files: unknown }, text: string): Line[] {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const arg = parts.slice(1).join(" ");
  if (cmd === "clear") return [];
  switch (cmd) {
    case "help": return [{ t: " ", s: TERM_HELP }];
    case "status": {
      const ph = ((run.phases as { name: string; state: string }[]).find((p) => p.state === "active") ?? {}).name ?? "—";
      return [{ t: "›", s: `${run.id} · ${run.status} · ${run.kind} · fase ${ph} · ${run.progress || 0}%` }];
    }
    case "plan": {
      const plan = run.plan as { label: string; state: string }[];
      return plan.length ? plan.map((s) => ({ t: s.state === "done" ? "✓" : s.state === "active" ? "›" : " ", s: s.label })) : [{ t: " ", s: "belum ada plan untuk run ini" }];
    }
    case "files": case "diff": {
      const files = run.files as { path: string; add: number; del: number; status: string }[];
      return files.length ? files.map((f) => ({ t: f.status === "added" ? "✓" : "›", s: `${f.path}  +${f.add} −${f.del}` })) : [{ t: " ", s: "belum ada file berubah" }];
    }
    case "steer": return arg ? [{ t: "»", s: "steer · " + arg }, { t: "›", s: "diterima — arahan disisipkan ke langkah berikutnya" }] : [{ t: " ", s: "pakai: steer <pesan>" }];
    case "pause": return [{ t: " ", s: "— dijeda oleh manusia —" }];
    case "resume": return [{ t: "›", s: "dilanjutkan oleh manusia" }];
    case "stop": return [{ t: "✗", s: "dihentikan oleh manusia" }];
    case "docs": return arg ? [{ t: "›", s: "membuka internal/docs/" + arg }] : [{ t: " ", s: "pakai: docs <path>" }];
    default: return [{ t: "›", s: `claude: “${text}” diterima — memproses dalam konteks run` }];
  }
}
export default async function (app: FastifyInstance) {
  app.get("/runs", async (req) => {
    const { project } = req.query as { project?: string };
    return prisma.run.findMany({ where: { projectId: project }, orderBy: { id: "desc" } });
  });
  app.get("/runs/:id", async (req, reply) => {
    const run = await prisma.run.findUnique({ where: { id: (req.params as { id: string }).id } });
    return run ?? reply.code(404).send({ error: "not found" });
  });

  // Start a run: enqueue it (budget-gated). 409 when today's spend hit dailyBudget.
  app.post("/runs", async (req, reply) => {
    const parsed = zStartRun.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });
    const runId = await nextRunId();
    const r = await enqueueRun({ runId, projectId: b.project, repoDir: project.repoDir ?? process.cwd(),
      branchFrom: b.branchFrom, branchTo: b.branchTo ?? `hanoman/${runId.toLowerCase()}`,
      flow: b.flow, specId: b.specId, steps: await stepModels() });
    if (!r.enqueued) return reply.code(409).send({ reason: r.reason });
    return reply.code(202).send({ runId });
  });

  // SSE: replay the persisted log snapshot, then relay live events from Redis
  // (the worker publishes to run:<id>:events). A per-request subscriber, quit on
  // client close. In test, end after the first live event or a short fallback so
  // app.inject — which collects the whole response — doesn't hang open.
  app.get("/runs/:id/log", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    for (const line of run.log as Line[]) reply.raw.write(`data: ${JSON.stringify({ kind: "log", line })}\n\n`); // snapshot
    const sub = subscriber();
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { if (closed) return; closed = true; if (timer) clearTimeout(timer); void sub.quit(); reply.raw.end(); };
    await sub.subscribe(`run:${id}:events`);
    sub.on("message", (_c, m) => {
      reply.raw.write(`data: ${m}\n\n`);
      if (process.env.NODE_ENV === "test") cleanup();
    });
    if (process.env.NODE_ENV === "test") timer = setTimeout(cleanup, 150);
    req.raw.on("close", cleanup);
  });

  // Inject a steer message as the run's next turn (worker applies it).
  app.post("/runs/:id/steer", async (req, reply) => {
    const parsed = zSteer.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid message" });
    await publishControl((req.params as { id: string }).id, { type: "steer", message: parsed.data.message });
    return reply.code(202).send({ accepted: true });
  });

  // pause/stop abort the live turn (via control channel); resume/retry re-enqueue.
  app.post("/runs/:id/control", async (req, reply) => {
    const parsed = zControl.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid action" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const { action } = parsed.data;
    if (action === "pause" || action === "stop") {
      await publishControl(id, { type: action });
      await prisma.run.update({ where: { id }, data: { status: action === "pause" ? "paused" : "stopped" } });
      return reply.code(202).send({ accepted: true });
    }
    // resume/retry: re-enqueue the same run; 409 if budget-rejected.
    const project = await prisma.project.findUnique({ where: { id: run.projectId } });
    const r = await enqueueRun({ runId: run.id, projectId: run.projectId, repoDir: project?.repoDir ?? process.cwd(),
      branchFrom: run.branchFrom, branchTo: run.branchTo, flow: run.kind as Flow, specId: run.specId ?? undefined, steps: await stepModels() });
    if (!r.enqueued) return reply.code(409).send({ reason: r.reason });
    return reply.code(202).send({ accepted: true });
  });

  // Switch the base/target branch on the run (and the live worktree if running).
  app.post("/runs/:id/worktree", async (req, reply) => {
    const parsed = zWorktreePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const data: { branchFrom?: string; branchTo?: string } = {};
    if (parsed.data.branchFrom) data.branchFrom = parsed.data.branchFrom;
    if (parsed.data.branchTo) data.branchTo = parsed.data.branchTo;
    const updated = await prisma.run.update({ where: { id }, data });
    // Best-effort rebase of the on-disk worktree if the run is executing; the
    // worktree may not exist (queued/finished), so swallow errors.
    if (parsed.data.branchFrom) {
      const project = await prisma.project.findUnique({ where: { id: run.projectId } });
      const repoDir = project?.repoDir ?? process.cwd();
      try { realGit.switchBase(`${repoDir}/${run.worktree}`, parsed.data.branchFrom); } catch { /* worktree may be gone */ }
    }
    return updated;
  });

  // Terminal: parse a verb, apply its side effect, return the rendered lines.
  app.post("/runs/:id/command", async (req, reply) => {
    const parsed = zCommand.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid command" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const parts = parsed.data.text.trim().split(/\s+/);
    const cmd = (parts[0] ?? "").toLowerCase();
    const arg = parts.slice(1).join(" ");
    if (cmd === "steer" && arg) await publishControl(id, { type: "steer", message: arg });
    else if (cmd === "pause" || cmd === "stop") await publishControl(id, { type: cmd });
    return { lines: runCommand(run, parsed.data.text) };
  });
}
