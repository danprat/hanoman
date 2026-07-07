import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
export default async function (app: FastifyInstance) {
  app.get("/runs", async (req) => {
    const { project } = req.query as { project?: string };
    return prisma.run.findMany({ where: { projectId: project }, orderBy: { id: "desc" } });
  });
  app.get("/runs/:id", async (req, reply) => {
    const run = await prisma.run.findUnique({ where: { id: (req.params as { id: string }).id } });
    return run ?? reply.code(404).send({ error: "not found" });
  });
}
