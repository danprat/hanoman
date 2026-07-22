import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";
import { acceptTicket } from "../../ticket-accept";

// SPEC-297 · daun #3 scheduler otonom (di atas fondasi SPEC-294/ADR-0072, cermin SPEC-296).
// Checker "triase": tiap Ticket eligible (status new, kategori bug/fitur, project opt-in, belum
// ber-specId) → accept (jalur bersama services/ticket-accept.ts, pemetaan kategori→source SPEC-291)
// → enqueue peluncuran. Idempotensi gratis: filter query menyaring tiket accepted/rejected/ber-specId;
// enqueue upsert specId @unique. Kategori pertanyaan/lainnya tak pernah ter-query → tak pernah
// auto-accept (tetap manual). "Banyak tiket satu window" — checker tak punya limit; cap = governor.
// PRD §Source — Triase + User Story #3.
export async function checkTriase(): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: "new",                       // accepted/rejected tersaring di query
      category: { in: ["bug", "fitur"] },  // pertanyaan/lainnya tak pernah auto-accept
      specId: null,                        // tiket ber-specId tersaring di query
      project: { schedulerOptIn: true },   // non-opt-in tak pernah ter-query
    },
    include: { attachments: true },
  });
  for (const t of tickets) {
    try {
      // Jalur accept yang sama dengan route: Spec (source per kategori) + tautan dua arah tiket.
      const { spec } = await acceptTicket(t, { author: "scheduler", priority: "sedang" });
      await enqueue({ specId: spec.id, projectId: spec.projectId, source: "triase", priority: spec.priority });
    } catch { /* satu tiket gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }
  }
}

export function registerTriaseSource(): void {
  registerSchedulerSource({ id: "triase", check: checkTriase });
}
