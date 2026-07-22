// SPEC-253 · ADR-0062 · antrean triase (di belakang gate cookie). Query selalu ber-scope projectId
// (isolasi antar-project). Accept = jembatan ke Spec (source help) — cermin errors/escalate.
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { nextSpecId } from "../services/id";
import { resolveRepoDir } from "../services/local-binding";
import { notifySynced } from "../services/sync-notify";
import { readUploadOrFetch, deleteUpload, uploadDir } from "../services/uploads";
import { generateShareToken } from "../services/ticket";
import { zTicketEditInput } from "@hanoman/shared";
import type { Ticket, TicketAttachment } from "@prisma/client";

// SPEC-286 · saat eskalasi triase → backlog, ubah lampiran dari catatan pasif ("N berkas")
// jadi DIREKTIF aktif: agen wajib memeriksa isinya (biasanya screenshot bug) sebelum bekerja,
// dengan nama asli + jalur akses konkret. Tanpa ini konteks keluhan pelapor tak pernah dibaca
// agen (payload ini mengalir apa adanya ke prompt sesi via runner startPrompt → `Detail:`).
const attachmentInstruction = (t: Ticket, atts: TicketAttachment[]): string => {
  if (atts.length === 0) return "Tanpa lampiran.";
  const list = atts
    .map((a) => `- ${a.filename} (${a.mimeType}) → ${join(uploadDir(), a.storageKey)}`)
    .join("\n");
  return `LAMPIRAN (${atts.length}) dari pelapor — biasanya screenshot yang menunjukkan masalah. `
    + `PERIKSA setiap lampiran untuk memahami konteks keluhan sebelum bekerja; jangan berasumsi `
    + `dari teks saja. Berkas ada di direktori upload server (baca langsung dengan tool Read):\n${list}\n`
    + `Bila berkas tak ada di path itu (sesi jalan di mesin lain), buka lampiran lewat triase `
    + `tiket #${t.number} atau API GET /api/tickets/${t.id}/attachments/<id>.`;
};

// SPEC-291 · kategori tiket → source Spec (menentukan flow via flowForSource & tampilan
// backlog via SOURCE_META). bug=finding QA, fitur=feature brief, pertanyaan=audit-only.
// Kategori tak dikenal (mis. `lainnya`) jatuh ke `brief` (feature brief) sebagai default.
const SOURCE_BY_CATEGORY: Record<string, "qa" | "brief" | "audit"> = {
  bug: "qa", fitur: "brief", pertanyaan: "audit", lainnya: "brief",
};

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
    // SPEC-293 · backfill shareToken untuk tiket lama (idempoten, tanpa notifySynced → tak
    // menambah noise feed sync). Tiket baru sudah punya token sejak createTicket.
    let shareToken = t.shareToken;
    if (!shareToken) {
      shareToken = generateShareToken();
      await prisma.ticket.update({ where: { id }, data: { shareToken } });
    }
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    const publicStatusUrl = `${base}/help/${encodeURIComponent(t.projectId)}/status/${shareToken}`;
    return {
      ...view(t), detail: t.detail,
      attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec, publicStatusUrl,
    };
  });

  // Sajikan berkas lampiran (ber-auth, di belakang gate). 404 bila att bukan milik tiket.
  app.get("/tickets/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const a = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
    if (!a || a.ticketId !== id) return reply.code(404).send({ error: "not found" });
    const buf = await readUploadOrFetch(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    return reply.send(buf);
  });

  // Terima → Spec (source help, payload brief-shaped) + tautan dua arah. Idempoten (cermin escalate).
  app.post("/tickets/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({
      where: { id }, include: { attachments: true },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    if (t.specId) {
      const spec = await prisma.spec.findUnique({ where: { id: t.specId } });
      return reply.code(200).send({ alreadyPromoted: true, spec });
    }
    const priority = (req.body as { priority?: string } | undefined)?.priority ?? "sedang";
    const author = req.user?.email ?? "system";
    const backlink = `Dari tiket Help Center #${t.number} (projek ${t.projectId}).`;
    // SPEC-291 · eskalasi mengikuti kategori keluhan, bukan selalu feature. bug → finding QA
    // (source qa, flow qa: audit→perbaikan), fitur → feature brief, pertanyaan → audit-only
    // (dokumen), lainnya → feature brief (default). flowForSource memetakan source→pipeline.
    const source = SOURCE_BY_CATEGORY[t.category] ?? "brief";
    const detail = `${t.detail}\n\nKategori: ${t.category}\nPelapor: ${t.reporterEmail}\n${backlink}\n\n`
      + attachmentInstruction(t, t.attachments);
    // Bentuk payload harus cocok dengan source (dto superRefine: qa ⇒ QaPayload). Untuk qa
    // keluhan pelapor + direktif lampiran masuk ke `actual`; selebihnya ke `context` brief.
    const payload = source === "qa"
      ? { severity: "major" as const, steps: "Reproduksi dari keluhan pelapor & lampiran.",
          expected: "Perilaku yang diharapkan pelapor.", actual: detail, env: "" }
      : { context: detail, outcome: "", constraints: "" };
    const repoDir = await resolveRepoDir(t.projectId);
    // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs & errors/escalate.
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const sid = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id: sid, projectId: t.projectId, title: t.title, source,
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
    await notifySynced("spec", spec!.id);  // SPEC-213/268 · spec ke feed (hub publish / client push)
    await notifySynced("ticket", id);       // SPEC-268 · status tiket ke feed
    return reply.code(201).send({ spec });
  });

  // SPEC-271 · lepas tautan tiket dari backlog (kebalikan accept). Non-destruktif: Spec
  // dibiarkan (bisa dihapus manual). Reset status→"new" agar tiket bisa diterima lagi. Idempoten.
  app.post("/tickets/:id/unlink", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "new", specId: null } });
    await notifySynced("ticket", id); // SPEC-268 · perubahan status tiket ke feed
    return { id: updated.id, status: updated.status, specId: updated.specId };
  });

  // Tolak → tutup tiket tanpa Spec, tanpa memengaruhi backlog.
  app.post("/tickets/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "rejected" } });
    await notifySynced("ticket", id); // SPEC-268 · perubahan status tiket ke feed
    return { id: updated.id, status: updated.status };
  });

  // SPEC-269 · edit isi tiket (triase). Field opsional; minimal satu (divalidasi zod).
  app.patch("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zTicketEditInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({
      where: { id }, data: parsed.data,
      include: { attachments: true, _count: { select: { attachments: true } } },
    });
    const spec = updated.specId ? await prisma.spec.findUnique({ where: { id: updated.specId } }) : null;
    return {
      ...view(updated), detail: updated.detail,
      attachments: updated.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec,
    };
  });

  // SPEC-269 · hapus tiket + lampiran (rows cascade; file fisik dibersihkan best-effort).
  app.delete("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true } });
    if (!t) return reply.code(404).send({ error: "not found" });
    for (const a of t.attachments) await deleteUpload(a.storageKey);
    await prisma.ticket.delete({ where: { id } });
    return { ok: true };
  });
}
