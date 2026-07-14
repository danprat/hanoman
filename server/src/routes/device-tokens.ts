import type { FastifyInstance } from "fastify";
import { zIssueDeviceToken, type DeviceTokenView } from "@hanoman/shared";
import { prisma } from "../db";
import { issueDeviceToken, revokeDeviceToken } from "../services/device-token";

// SPEC-213 · ADR-0044 · kelola device token dari dashboard (cookie-authed, warisan gate /api).
// Plaintext token hanya balik di POST (sekali). List & revoke tak pernah membuka rahasia.
const view = (t: {
  id: string; name: string; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null;
}): DeviceTokenView => ({
  id: t.id, name: t.name, createdAt: t.createdAt.toISOString(),
  lastSeenAt: t.lastSeenAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null,
});

export default async function (app: FastifyInstance) {
  app.get("/device-tokens", async (req) =>
    (await prisma.deviceToken.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } })).map(view));

  app.post("/device-tokens", async (req, reply) => {
    const p = zIssueDeviceToken.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    return reply.code(201).send(await issueDeviceToken(req.user!.id, p.data.name));
  });

  app.delete("/device-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return (await revokeDeviceToken(id)) ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
