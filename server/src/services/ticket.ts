// SPEC-253 · ADR-0062 · logika inti tiket Help Center: kunci akses opaque, nomor per-project,
// status publik terpetakan otomatis, dan retensi opportunistic.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { deleteUpload } from "./uploads";

export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
// Kunci opaque gaya DSN (SPEC-249): disimpan hash-at-rest; plaintext hanya ditampilkan sekali di layar.
export function generateAccessKey(): { key: string; hash: string } {
  const key = "hnm_tkt_" + randomBytes(24).toString("hex");
  return { key, hash: hashAccessKey(key) };
}

// SPEC-293 · token bagikan link status publik. Terpisah dari kunci pelapor (accessKeyHash tetap
// hash-at-rest); token ini disimpan plaintext karena memang dibagikan operator ke pelapor.
export function generateShareToken(): string {
  return "hnm_shr_" + randomBytes(24).toString("hex");
}

// SPEC-293 · status publik kini SATU sumber di shared (dipakai server + klien). Re-export agar
// pemanggil lama (`routes/help.ts`) tetap `import { publicStatus } from "../services/ticket"`.
export { publicStatus } from "@hanoman/shared";

// Buat tiket + nomor per-project (max+1) + kunci. Retry P2002 (bentrok nomor / hash) — cermin nextSpecId.
export async function createTicket(input: {
  projectId: string; category: string; title: string; detail: string; reporterEmail: string;
}): Promise<{ ticket: Awaited<ReturnType<typeof prisma.ticket.create>>; key: string }> {
  const { key, hash } = generateAccessKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await prisma.ticket.aggregate({ where: { projectId: input.projectId }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    try {
      const ticket = await prisma.ticket.create({
        data: { ...input, number, accessKeyHash: hash, shareToken: generateShareToken(), status: "new" },
      });
      return { ticket, key };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("gagal membuat tiket (nomor bentrok)");
}

// Retensi opportunistic-on-write (cermin retensi ErrorEvent, tanpa scheduler global baru): pangkas
// tiket ditolak yang lebih tua dari retensi + hapus berkas lampirannya. Tiket ber-specId dikecualikan.
export async function pruneOldTickets(now = Date.now()): Promise<void> {
  const days = Number(process.env.HANOMAN_TICKET_RETENTION_DAYS ?? 90);
  const cutoff = new Date(now - days * 86_400_000);
  const stale = await prisma.ticket.findMany({
    where: { status: "rejected", specId: null, createdAt: { lt: cutoff } },
    include: { attachments: true }, take: 50,
  });
  for (const t of stale) {
    for (const a of t.attachments) await deleteUpload(a.storageKey);
    await prisma.ticket.delete({ where: { id: t.id } }); // cascade menghapus baris attachment
  }
}
