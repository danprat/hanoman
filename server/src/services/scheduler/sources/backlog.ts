import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";

// SPEC-295 · daun #1 scheduler otonom (di atas fondasi SPEC-294/ADR-0072). Checker "backlog":
// enqueue semua Spec belum-mulai (baseSha=null) dari project schedulerOptIn, urut prioritas
// tinggi→sedang→rendah. Idempotensi ditanggung enqueue (upsert specId @unique) — checker tetap
// thin, tak perlu dedup manual. PRD §Source — Backlog + User Story #1.
const RANK: Record<string, number> = { tinggi: 0, sedang: 1, rendah: 2 };

export async function checkBacklog(): Promise<void> {
  // Relasi-filter schedulerOptIn:true → project non-opt-in tak pernah ikut ter-query (tak tersentuh).
  // baseSha:null = "belum-mulai" (kondisi turunan; startSpecSession menulis baseSha saat launch).
  const specs = await prisma.spec.findMany({
    where: { baseSha: null, project: { schedulerOptIn: true } },
  });
  // Urut prioritas sebelum enqueue (AC); tiebreak id agar deterministik. Himpunan kecil → sort di memori.
  specs.sort((a, b) =>
    (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of specs) {
    await enqueue({ specId: s.id, projectId: s.projectId, source: "backlog", priority: s.priority });
  }
}

export function registerBacklogSource(): void {
  registerSchedulerSource({ id: "backlog", check: checkBacklog });
}
