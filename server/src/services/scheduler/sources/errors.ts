import { prisma } from "../../../db";
import { registerSchedulerSource } from "../registry";
import { enqueue } from "../queue";
import { getScheduler } from "../config";
import { escalateErrorGroup } from "../../error-escalate";

// SPEC-296 · daun #2 scheduler otonom (di atas fondasi SPEC-294/ADR-0072, cermin SPEC-295).
// Checker "errors": tiap ErrorGroup eligible (new, produksi, count>=ambang, project opt-in,
// belum ber-specId) → escalate (jalur bersama services/error-escalate.ts) → enqueue peluncuran.
// Idempotensi gratis: filter query menyaring grup escalated/resolved/ber-specId; enqueue upsert
// specId @unique. "Banyak grup satu window" — checker tak punya limit; cap ditegakkan governor.
// PRD §Source — Errors + User Story #2.
export async function checkErrors(): Promise<void> {
  const minCount = (await getScheduler()).sources.errors.minCount;
  const groups = await prisma.errorGroup.findMany({
    where: {
      status: "new",              // escalated/resolved tersaring di query
      environment: "production",  // literal, cermin services/error-ingest.ts
      specId: null,               // grup ber-specId tersaring di query
      count: { gte: minCount },   // ambang dari setelan
      project: { schedulerOptIn: true },  // non-opt-in tak pernah ter-query
    },
  });
  for (const g of groups) {
    try {
      // Jalur escalate yang sama dengan route: Spec qa prioritas tinggi + tautan dua arah.
      const { spec } = await escalateErrorGroup(g, { author: "scheduler" });
      await enqueue({ specId: spec.id, projectId: spec.projectId, source: "errors", priority: spec.priority });
    } catch { /* satu grup gagal (mis. project tak ter-bind) tak menghentikan sisanya */ }
  }
}

export function registerErrorsSource(): void {
  registerSchedulerSource({ id: "errors", check: checkErrors });
}
