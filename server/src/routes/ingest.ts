// SPEC-249 · ADR-0060 · endpoint ingest publik ber-DSN. Bypass gate cookie (app.ts prefix
// /api/ingest); otentikasi DSN sendiri. CORS lebar untuk snippet browser.
import type { FastifyInstance, FastifyReply } from "fastify";
import { zIngestPayload } from "@hanoman/shared";
import { prisma } from "../db";
import { verifyKey } from "../services/ingest-key";
import { ingestError, rateLimitOk } from "../services/error-ingest";

const BODY_CAP = 64_000;

function cors(reply: FastifyReply): void {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-hanoman-dsn");
}

export default async function (app: FastifyInstance) {
  app.options("/ingest/:slug", async (_req, reply) => { cors(reply); return reply.code(204).send(); });

  app.post("/ingest/:slug", async (req, reply) => {
    cors(reply);
    const { slug } = req.params as { slug: string };
    const key = (req.query as { key?: string }).key
      ?? (req.headers["x-hanoman-dsn"] as string | undefined)
      ?? "";
    const raw = JSON.stringify(req.body ?? {});
    if (raw.length > BODY_CAP) return reply.code(413).send({ error: "payload too large" });
    const project = await prisma.project.findUnique({ where: { id: slug } });
    // Generik: project tak ada / DSN salah sama-sama 401 (jangan enumerasi project mana pun).
    if (!project || !verifyKey(key, project.ingestKeyHash)) return reply.code(401).send({ error: "unauthorized" });
    if (!rateLimitOk(project.id)) return reply.code(429).send({ error: "rate limited" });
    const parsed = zIngestPayload.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid payload" });
    const r = await ingestError(project.id, project.name, parsed.data);
    return reply.code(202).send({ ok: true, groupId: r.groupId, new: r.new });
  });
}
