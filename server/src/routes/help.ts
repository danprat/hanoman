// SPEC-253 · ADR-0062 · endpoint PUBLIK Help Center — pengecualian sah gate /api (bypass cookie di
// app.ts; otorisasi helpEnabled + kunci opaque tiket, bukan sesi login). Same-origin (hanoman
// menyajikan SPA + API) → tanpa CORS. Submit = multipart/form-data (field + lampiran gambar).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zTicketCategory } from "@hanoman/shared";
import { prisma } from "../db";
import { createTicket, hashAccessKey, publicStatus, pruneOldTickets } from "../services/ticket";
import { recordNewTicket } from "../services/notifications";
import { notifySynced } from "../services/sync-notify";
import { saveUpload } from "../services/uploads";
import { helpRateOk } from "../services/help-ratelimit";

const CATEGORIES = ["bug", "fitur", "pertanyaan", "lainnya"];
const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

const zField = z.object({
  category: zTicketCategory,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(10_000),
  email: z.string().min(3).max(200),
});

type ParsedPart = { buf: Buffer; mime: string; name: string };

export default async function (app: FastifyInstance) {
  // Info halaman publik. 404 generik bila project tak ada / helpEnabled=false (tak membocorkan project).
  app.get("/help/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    return { projectName: p.name, categories: CATEGORIES };
  });

  // Submit keluhan (multipart). Honeypot `hp` terisi → sukses palsu tanpa membuat tiket.
  app.post("/help/:slug/tickets", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    if (!helpRateOk(slug, req.ip)) return reply.code(429).send({ error: "terlalu banyak permintaan" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const fields: Record<string, string> = {};
    const files: ParsedPart[] = [];
    try {
      for await (const part of (req as any).parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer(); // menguras stream file
          // truncated (fileSize terlampaui, throwFileSizeLimit:false) / mime salah / kelebihan → skip,
          // submit yang sisanya tetap jadi (AC PRD).
          if (part.file?.truncated || !OK_MIME.has(part.mimetype) || files.length >= MAX_FILES) continue;
          files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "gambar") });
        } else {
          fields[part.fieldname] = String(part.value ?? "");
        }
      }
    } catch {
      return reply.code(400).send({ error: "unggahan tak valid" });
    }

    if (fields.hp) return reply.code(200).send({ ok: true }); // honeypot: bot → sukses palsu, tak buat tiket

    const parsed = zField.safeParse({
      category: fields.category, title: fields.title, detail: fields.detail, email: fields.email,
    });
    if (!parsed.success) return reply.code(400).send({ error: "field wajib tak lengkap / tak valid" });

    const { ticket, key } = await createTicket({
      projectId: slug, category: parsed.data.category, title: parsed.data.title,
      detail: parsed.data.detail, reporterEmail: parsed.data.email,
    });
    for (const f of files) {
      const { storageKey, size } = await saveUpload(f.buf, f.mime);
      const att = await prisma.ticketAttachment.create({
        data: { ticketId: ticket.id, projectId: slug, filename: f.name.slice(0, 200), mimeType: f.mime, size, storageKey },
      });
      await notifySynced("ticketAttachment", att.id); // SPEC-272 · metadata lampiran → feed
    }
    await recordNewTicket(ticket.id, slug, p.name, parsed.data.category, parsed.data.title);
    await notifySynced("ticket", ticket.id); // SPEC-268 · tiket baru → feed (metadata; SPEC-272 · lampiran metadata disync terpisah, byte lazy-fetch)
    void pruneOldTickets(); // retensi opportunistic-on-write (tanpa scheduler global)

    const statusPath = `/help/${encodeURIComponent(slug)}/status/${encodeURIComponent(key)}`;
    return reply.code(201).send({ number: ticket.number, key, statusPath });
  });

  // Cek status publik by kunci opaque. Scoped ke slug (isolasi). 404 tanpa membocorkan keberadaan.
  // SPEC-293 · `key` boleh kunci pelapor (accessKeyHash) ATAU shareToken bagikan operator.
  app.get("/help/:slug/tickets/:key", async (req, reply) => {
    const { slug, key } = req.params as { slug: string; key: string };
    const t = await prisma.ticket.findFirst({
      where: { projectId: slug, OR: [{ accessKeyHash: hashAccessKey(key) }, { shareToken: key }] },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    let stage: string | null = null;
    if (t.specId) stage = (await prisma.spec.findUnique({ where: { id: t.specId } }))?.stage ?? null;
    return {
      number: t.number, category: t.category, title: t.title,
      status: publicStatus(t.status, stage), createdAt: t.createdAt.toISOString(),
    };
  });
}
