import type { FastifyInstance } from "fastify";
import { zCreateTrigger } from "@hanoman/shared";
import { prisma } from "../db";
import { scheduleSpecFor } from "../schedule-parse";
import { syncTrigger, removeSchedule } from "../schedules";
export default async function (app: FastifyInstance) {
  app.get("/triggers", async (req) => {
    const { project } = req.query as { project?: string };
    return prisma.trigger.findMany({ where: { projectId: project }, orderBy: { id: "desc" } });
  });
  app.post("/triggers", async (req, reply) => {
    const parsed = zCreateTrigger.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    // schedule/interval need a valid cron/duration; commit/manual carry no schedule.
    if ((b.type === "schedule" || b.type === "interval") && scheduleSpecFor(b.type, b.detail) === null)
      return reply.code(400).send({ error: `invalid ${b.type} detail: ${b.detail}` });
    const id = "t" + Math.floor(Math.random() * 100000);
    const t = await prisma.trigger.create({ data: {
      id, projectId: b.project, type: b.type, detail: b.detail, target: b.target, enabled: true } });
    await syncTrigger(t);
    return reply.code(201).send(t);
  });
  app.post("/triggers/:id/toggle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.trigger.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.trigger.update({ where: { id }, data: { enabled: !t.enabled } });
    await syncTrigger(updated);
    return updated;
  });
  app.delete("/triggers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.trigger.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    await prisma.trigger.delete({ where: { id } });
    await removeSchedule(id);
    return reply.code(204).send();
  });
}
