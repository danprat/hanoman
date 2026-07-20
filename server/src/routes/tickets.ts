// SPEC-253 · ADR-0061 · antrean triase (di belakang gate cookie). Query selalu ber-scope projectId
// (isolasi antar-project). Accept = jembatan ke Spec (source help) — cermin errors/escalate.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
import { enqueueOutbox } from "../services/outbox";
import { readUpload } from "../services/uploads";
import type { Ticket } from "@prisma/client";

const view = (t: Ticket & { _count?: { attachments: number } }) => ({
  id: t.id, projectId: t.projectId, number: t.number, category: t.category, title: t.title,
  reporterEmail: t.reporterEmail, status: t.status, specId: t.specId,
  attachmentCount: t._count?.attachments ?? 0, createdAt: t.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/tickets", async (req) => {
    const { project, status, q, page, limit } = req.query as Record<string, string | undefined>;
    const where: { projectId?: string; status?: string } = {};
    if (project) where.projectId = project;
    if (status) where.status = status;
    let rows = await prisma.ticket.findMany({
      where, orderBy: { createdAt: "desc" }, include: { _count: { select: { attachments: true } } },
    });
    if (q) {
      const n = q.toLowerCase();
      rows = rows.filter((t) => `${t.title} ${t.reporterEmail}`.toLowerCase().includes(n));
    }
    const unreviewed = rows.filter((t) => t.status === "new").length;
    return { ...paginate(rows.map(view), page, limit), unreviewed };
  });

  app.get("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({
      where: { id }, include: { attachments: true, _count: { select: { attachments: true } } },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    const spec = t.specId ? await prisma.spec.findUnique({ where: { id: t.specId } }) : null;
    return {
      ...view(t), detail: t.detail,
      attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec,
    };
  });

  // Sajikan berkas lampiran (ber-auth, di belakang gate). 404 bila att bukan milik tiket.
  app.get("/tickets/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const a = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
    if (!a || a.ticketId !== id) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    return reply.send(buf);
  });

  // Terima → Spec (source help, payload brief-shaped) + tautan dua arah. Idempoten (cermin escalate).
  app.post("/tickets/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({
      where: { id }, include: { _count: { select: { attachments: true } } },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    if (t.specId) {
      const spec = await prisma.spec.findUnique({ where: { id: t.specId } });
      return reply.code(200).send({ alreadyPromoted: true, spec });
    }
    const priority = (req.body as { priority?: string } | undefined)?.priority ?? "sedang";
    const author = req.user?.email ?? "system";
    const backlink = `Dari tiket Help Center #${t.number} (projek ${t.projectId}).`;
    const nAtt = t._count?.attachments ?? 0;
    const payload = {
      context: `${t.detail}\n\nKategori: ${t.category}\nPelapor: ${t.reporterEmail}\nLampiran: ${nAtt} berkas (lihat tiket di triase).\n${backlink}`,
      outcome: "",
      constraints: "",
    };
    const repoDir = await resolveRepoDir(t.projectId);
    // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs & errors/escalate.
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const sid = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id: sid, projectId: t.projectId, title: t.title, source: "help",
            stage: "brainstorming", priority, author: `Help · ${author}`,
            objective: `${t.category}: ${t.title}. ${backlink}`, payload,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }
    await prisma.ticket.update({ where: { id }, data: { status: "accepted", specId: spec!.id } });
    await enqueueOutbox("spec", spec!.id); // SPEC-213 · antre push sync
    return reply.code(201).send({ spec });
  });

  // Tolak → tutup tiket tanpa Spec, tanpa memengaruhi backlog.
  app.post("/tickets/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "rejected" } });
    return { id: updated.id, status: updated.status };
  });
}
