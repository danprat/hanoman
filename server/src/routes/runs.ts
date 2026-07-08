import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { runManager } from "../runner/manager";
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
}
