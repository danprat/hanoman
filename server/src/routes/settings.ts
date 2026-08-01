import type { FastifyInstance } from "fastify";
import { zSetting } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "../services/settings";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
export default async function (app: FastifyInstance) {
  app.get("/settings", async () => getSetting());
  app.put("/settings", async (req, reply) => {
    const parsed = zSetting.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    const row = await prisma.setting.upsert({ where: { id: 1 },
      update: { data: parsed.data }, create: { id: 1, data: parsed.data } });
    // SPEC-477 · ADR-0097 · toggle gateway berlaku LANGSUNG, tanpa restart. Dibandingkan dulu
    // supaya PUT settings yang tak menyentuh Telegram tak memutus long-poll yang sedang jalan.
    if (JSON.stringify(before.telegram) !== JSON.stringify(parsed.data.telegram)) {
      await reloadTelegramGateway();
    }
    return row.data;
  });
}
