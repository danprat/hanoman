import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyDeviceToken } from "./device-token";

// SPEC-213 · ADR-0044 · gerbang mesin-ke-mesin untuk surface sync. Cermin req.user (auth.ts),
// tapi via Bearer device token alih-alih cookie sesi.
declare module "fastify" { interface FastifyRequest { device?: { id: string; userId: string } } }

export function bearerToken(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export async function requireDeviceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearerToken(req);
  const dev = token ? await verifyDeviceToken(token) : null;
  if (!dev) { reply.code(401).send({ error: "device token required" }); return; }
  req.device = dev;
}
