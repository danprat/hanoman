import type { FastifyInstance } from "fastify";
import { prisma } from "../db";

// SPEC-180 · daftar notifikasi backlog selesai. Read-state global (satu readAt per baris),
// bukan per-user: workspace single-team. Rute di belakang gate auth (app.ts).
export default async function (app: FastifyInstance) {
  app.get("/notifications", async () => {
    const items = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const unread = await prisma.notification.count({ where: { readAt: null } });
    return { items, unread };
  });
  app.post("/notifications/read", async (_req, reply) => {
    await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
  app.delete("/notifications", async (_req, reply) => {
    await prisma.notification.deleteMany({});
    return reply.code(204).send();
  });
}
