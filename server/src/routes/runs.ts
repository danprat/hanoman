import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zSteer, zControl, zWorktreePatch, zCommand } from "@hanoman/shared";
import { realGit, type Flow } from "@hanoman/runner";
import { runManager } from "../runner/manager";
import { stepModels } from "../services/settings";

type Line = { t: string; s: string };
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

  // SSE: replay the persisted log snapshot, then stream live events. For a run
  // the manager isn't actively driving, end after the replay (no live bus to
  // wait on) so plain clients — and app.inject — don't hang open.
  app.get("/runs/:id/log", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    for (const line of run.log as { t: string; s: string }[]) send({ kind: "log", line }); // persisted snapshot
    for (const line of runManager.logSnapshot(id)) send({ kind: "log", line });            // live backlog
    if (!runManager.isLive(id)) { reply.raw.end(); return; }
    const unsub = runManager.subscribe(id, (e) => send(e));
    req.raw.on("close", () => { unsub(); reply.raw.end(); });
  });

  // Inject a steer message as the run's next turn.
  app.post("/runs/:id/steer", async (req, reply) => {
    const parsed = zSteer.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid message" });
    runManager.steer((req.params as { id: string }).id, parsed.data.message);
    return reply.code(202).send({ accepted: true });
  });

  // pause/stop abort the live turn; resume/retry re-enqueue a fresh run.
  app.post("/runs/:id/control", async (req, reply) => {
    const parsed = zControl.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid action" });
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: "not found" });
    const { action } = parsed.data;
    if (action === "pause" || action === "stop") {
      runManager.control(id, action);
      await prisma.run.update({ where: { id }, data: { status: action === "pause" ? "paused" : "stopped" } });
    } else {
      const project = await prisma.project.findUnique({ where: { id: run.projectId } });
      void runManager.start({ runId: run.id, repoDir: project?.repoDir ?? process.cwd(), branchFrom: run.branchFrom,
        branchTo: run.branchTo, flow: run.kind as Flow, specId: run.specId ?? undefined, steps: await stepModels() });
    }
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
    if (runManager.isLive(id) && parsed.data.branchFrom) {
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
    if (cmd === "steer" && arg) runManager.steer(id, arg);
    else if (cmd === "pause" || cmd === "stop") runManager.control(id, cmd);
    return { lines: runCommand(run, parsed.data.text) };
  });
}
