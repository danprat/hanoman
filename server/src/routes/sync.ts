import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireDeviceToken } from "../services/device-auth";
import { verifyDeviceToken } from "../services/device-token";
import { attachSync, detachSync } from "../services/sync-hub";
import type { Client } from "../services/pty";
import { applyPush, pull, isEntity, type Entity } from "../services/sync";

// SPEC-213 · ADR-0045/0046 · surface sync mesin-ke-mesin (device-token). Isi file dokumen
// TIDAK lewat sini — hanya record (project/spec/vps/sessionResult).
const zPush = z.object({
  records: z.array(z.object({
    entity: z.string(), id: z.string(), baseVersion: z.number().int().nonnegative(),
    data: z.record(z.unknown()),
  })),
});

// Entitas ber-`author`: bila klien tak mengirim author, atribusikan ke user pemilik token (AC-4).
const AUTHORED: Entity[] = ["spec", "sessionResult"];

export default async function (app: FastifyInstance) {
  app.get("/sync/pull", { preHandler: requireDeviceToken }, async (req) => {
    const since = (req.query as { since?: string }).since ?? "0";
    return pull(since);
  });

  app.post("/sync/push", { preHandler: requireDeviceToken }, async (req, reply) => {
    const p = zPush.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const user = await prisma.user.findUnique({ where: { id: req.device!.userId } });
    const results = [];
    for (const rec of p.data.records) {
      if (!isEntity(rec.entity)) { results.push({ id: rec.id, ok: false, error: "unknown entity" }); continue; }
      const data = { ...rec.data };
      if (AUTHORED.includes(rec.entity) && !data.author && user) data.author = user.email;
      const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id);
      results.push({ id: rec.id, ...r });
    }
    return { results };
  });

  // SPEC-213 · ADR-0046 · kanal siar changefeed. Auth via ?token= pada upgrade (cookie tak ada
  // di server-to-server). Token invalid → tutup socket. Read-only: frame masuk diabaikan.
  app.get("/sync/ws", { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const dev = token ? await verifyDeviceToken(token) : null;
    if (!dev) { socket.close(); return; }
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attachSync(client);
    socket.on("close", () => detachSync(client));
  });
}
