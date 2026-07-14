import { prisma } from "../db";

// SPEC-213 · ADR-0043 · antre write lokal (LOCAL-only) untuk di-push saat online. Unique
// (entity,recordId): banyak edit satu record hanya menyisakan satu entri "perlu push".
// Best-effort: kegagalan enqueue TIDAK menggagalkan write utama (misal saat berjalan sebagai
// hub tanpa peran client, atau tabel belum ada di lingkungan lama).
export async function enqueueOutbox(entity: string, recordId: string): Promise<void> {
  try {
    await prisma.syncOutbox.upsert({
      where: { entity_recordId: { entity, recordId } },
      create: { entity, recordId },
      update: {},
    });
  } catch { /* jangan blok write utama */ }
}

export async function listOutbox() {
  return prisma.syncOutbox.findMany({ orderBy: { createdAt: "asc" } });
}

export async function clearOutbox(entity: string, recordId: string): Promise<void> {
  await prisma.syncOutbox.deleteMany({ where: { entity, recordId } });
}
