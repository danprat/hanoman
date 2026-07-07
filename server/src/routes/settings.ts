import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => (await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).data);
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data: parsed.data }, create: { id: 1, data: parsed.data } });
    return row.data;
  });
}
