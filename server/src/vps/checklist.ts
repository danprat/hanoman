// SPEC-220 · hidrasi checklist kepatuhan untuk satu VPS: katalog 232 item + status dari snapshot
// audit terakhir + keputusan human (N/A, attest). Skor DIHITUNG ULANG saat dibaca supaya penandaan
// N/A/attest sesudah audit langsung tercermin (AC-9/10/11), tak bergantung skor tersimpan yang basi.
import { prisma } from "../db";
import { CATALOG, SECTIONS } from "./catalog/catalog";
import { scoreCompliance, type ProbeStatus } from "./scoring";
import type { ChecklistView, ChecklistItem, VpsItemStatus } from "@hanoman/shared";

export async function buildChecklist(vpsId: string): Promise<ChecklistView> {
  const snap = await prisma.vpsAuditSnapshot.findFirst({
    where: { vpsId }, orderBy: { createdAt: "desc" } });
  const results = (snap?.results ?? {}) as Record<string, { status: string; detail?: string }>;

  const probe: Record<string, ProbeStatus> = {};
  for (const [id, r] of Object.entries(results)) {
    if (r.status === "pass" || r.status === "fail" || r.status === "warn") probe[id] = r.status;
    else if (r.status === "na") probe[id] = "unknown";
  }

  const stateRows = await prisma.vpsItemState.findMany({ where: { vpsId } });
  const stateMap = new Map(stateRows.map((s) => [s.itemId, s]));
  const states = Object.fromEntries(stateRows.map((s) => [s.itemId, { na: s.na, attested: s.attested }]));
  const scored = scoreCompliance(probe, states);

  const itemsBySection = new Map<string, ChecklistItem[]>();
  for (const c of CATALOG) {
    const st = stateMap.get(c.id);
    const item: ChecklistItem = {
      id: c.id, section: c.section, sectionTitle: c.sectionTitle, level: c.level, title: c.title,
      ...(c.code ? { code: c.code } : {}),
      mode: c.mode, severity: c.severity, probe: c.probe, remediable: c.remediable, appLayer: c.appLayer,
      status: (scored.status[c.id] ?? "unknown") as VpsItemStatus,
      na: st?.na ?? false, attested: st?.attested ?? false,
      actorEmail: st?.actorEmail ?? null, naReason: st?.naReason ?? null, attestNote: st?.attestNote ?? null,
    };
    const arr = itemsBySection.get(c.section) ?? [];
    arr.push(item);
    itemsBySection.set(c.section, arr);
  }

  const sections = SECTIONS.map((s) => ({
    id: s.id, title: s.title, icon: s.icon,
    score: scored.bySection[s.id] ?? 100,
    items: itemsBySection.get(s.id) ?? [],
  }));

  return {
    vpsId,
    scoreTotal: scored.total,
    scoreBySection: scored.bySection,
    lastAuditAt: snap?.createdAt.toISOString() ?? null,
    sections,
  };
}
