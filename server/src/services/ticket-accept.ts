import { join } from "node:path";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";
import { uploadDir } from "./uploads";
import type { Spec, Ticket, TicketAttachment } from "@prisma/client";

// SPEC-286 · saat accept tiket → backlog, ubah lampiran dari catatan pasif jadi DIREKTIF aktif: agen
// wajib memeriksa isinya (biasanya screenshot bug) sebelum bekerja, dengan nama asli + jalur konkret.
// Dipindah dari routes/tickets.ts agar dipakai ulang scheduler source-checker triase (JALUR sama).
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

// SPEC-291 · kategori tiket → source Spec (menentukan flow via flowForSource & tampilan backlog via
// SOURCE_META). bug=finding QA, fitur=feature brief, pertanyaan=audit-only. Kategori tak dikenal
// (mis. `lainnya`) jatuh ke `brief` (feature brief) sebagai default.
const SOURCE_BY_CATEGORY: Record<string, "qa" | "brief" | "audit"> = {
  bug: "qa", fitur: "brief", pertanyaan: "audit", lainnya: "brief",
};

// SPEC-297 · inti accept tiket → Spec, dipisah dari routes/tickets.ts agar dipakai ulang oleh scheduler
// source-checker triase (JALUR yang sama, bukan duplikat). Kontrak HTTP route tak berubah. Idempoten
// via ticket.specId (tiket sudah tertaut → kembalikan Spec tanpa membuat kedua).
export async function acceptTicket(
  t: Ticket & { attachments: TicketAttachment[] }, opts: { author: string; priority: string },
): Promise<{ spec: Spec; created: boolean }> {
  if (t.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: t.specId } });
    return { spec: spec!, created: false };
  }
  const backlink = `Dari tiket Help Center #${t.number} (projek ${t.projectId}).`;
  // SPEC-291 · eskalasi mengikuti kategori keluhan, bukan selalu feature.
  const source = SOURCE_BY_CATEGORY[t.category] ?? "brief";
  const detail = `${t.detail}\n\nKategori: ${t.category}\nPelapor: ${t.reporterEmail}\n${backlink}\n\n`
    + attachmentInstruction(t, t.attachments);
  // Bentuk payload harus cocok dengan source (dto superRefine: qa ⇒ QaPayload). Untuk qa keluhan
  // pelapor + direktif lampiran masuk ke `actual`; selebihnya ke `context` brief.
  const payload = source === "qa"
    ? { severity: "major" as const, steps: "Reproduksi dari keluhan pelapor & lampiran.",
        expected: "Perilaku yang diharapkan pelapor.", actual: detail, env: "" }
    : { context: detail, outcome: "", constraints: "" };
  const repoDir = await resolveRepoDir(t.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin routes/specs & error-escalate.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: t.projectId, title: t.title, source,
          stage: "brainstorming", priority: opts.priority, author: `Help · ${opts.author}`,
          objective: `${t.category}: ${t.title}. ${backlink}`, payload,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  await prisma.ticket.update({ where: { id: t.id }, data: { status: "accepted", specId: spec!.id } });
  await notifySynced("spec", spec!.id);  // SPEC-213/268 · spec ke feed
  await notifySynced("ticket", t.id);     // SPEC-268 · status tiket ke feed
  return { spec: spec!, created: true };
}
