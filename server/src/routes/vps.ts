import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zCreateVps, zPatchVps } from "@hanoman/shared";
import { runAudit } from "../services/vps-audit";

// Audit (dan nanti harden/session) = eksekusi remote via SSH dengan key milik mesin ini.
// Tanpa auth — pagarnya bind 127.0.0.1 di server.ts, sama seperti /api/terminal
// (lihat komentar routes/terminal.ts). Bila HOST dibuka, gembok route ini bersamanya.
export default async function (app: FastifyInstance) {
  app.get("/vps", async () => prisma.vps.findMany({ orderBy: { createdAt: "asc" } }));

  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    return reply.code(201).send(await prisma.vps.create({ data: p.data }));
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return await prisma.vps.update({ where: { id: (req.params as { id: string }).id }, data: p.data }); }
    catch { return reply.code(404).send({ error: "not found" }); }
  });

  app.delete("/vps/:id", async (req, reply) => {
    try {
      await prisma.vps.delete({ where: { id: (req.params as { id: string }).id } });
      return reply.code(204).send();
    } catch { return reply.code(404).send({ error: "not found" }); }
  });

  app.post("/vps/:id/audit", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const r = await runAudit(v);
    if (!r.ok) return reply.code(502).send({ error: "audit gagal lewat ssh", out: r.out });
    return { audit: r.audit, hardened: r.hardened };
  });
}
