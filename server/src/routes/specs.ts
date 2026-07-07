import type { FastifyInstance } from "fastify";
import { zCreateSpec } from "@hanoman/shared";
import { prisma } from "../db";
import { nextSpecId } from "../services/id";
import { advance } from "../services/stage-machine";

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source } = req.query as { project?: string; source?: string };
    return prisma.spec.findMany({ where: { projectId: project, source }, orderBy: { id: "desc" } });
  });
  app.post("/specs", async (req, reply) => {
    const parsed = zCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = await nextSpecId();
    const isQa = b.source === "qa";
    const priority = isQa && "severity" in b.payload
      ? (b.payload.severity === "minor" ? "sedang" : "tinggi") : b.priority;
    const objective = isQa && "actual" in b.payload
      ? (b.payload.actual || b.payload.steps || "— audit untuk menelusuri akar masalah.")
      : ("outcome" in b.payload ? (b.payload.outcome || b.payload.context || "— brainstorm untuk memperjelas objective.") : "");
    const spec = await prisma.spec.create({ data: {
      id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
      priority, author: isQa ? "QA · Rangga" : "Rangga", objective, payload: b.payload } });
    return reply.code(201).send(spec);
  });
  app.post("/specs/:id/advance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const step = advance(spec.stage as any);
    if (!step) return reply.code(409).send({ error: "terminal stage" });
    await prisma.spec.update({ where: { id }, data: { stage: step.stage } });
    return { id, stage: step.stage };
  });
  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.spec.delete({ where: { id } }).catch(() => {});
    return reply.code(204).send();
  });
}
