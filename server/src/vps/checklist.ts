// SPEC-220 · hidrasi checklist kepatuhan untuk satu VPS: katalog 232 item + status dari snapshot
// audit terakhir + keputusan human (N/A, attest). Skor DIHITUNG ULANG saat dibaca supaya penandaan
// N/A/attest sesudah audit langsung tercermin (AC-9/10/11), tak bergantung skor tersimpan yang basi.
import { prisma } from "../db";
import { CATALOG, SECTIONS } from "./catalog/catalog";
import { scoreCompliance, type ProbeStatus } from "./scoring";
import { computeDrift } from "./drift";
import type { ChecklistView, ChecklistItem, ChecklistSection, VpsItemStatus } from "@hanoman/shared";

export async function buildChecklist(vpsId: string): Promise<ChecklistView> {
  // SPEC-221 · dua snapshot terbaru: [0]=terkini, [1]=sebelumnya (untuk diff drift derived).
  const snaps = await prisma.vpsAuditSnapshot.findMany({
    where: { vpsId }, orderBy: { createdAt: "desc" }, take: 2 });
  const snap = snaps[0] ?? null;
  const results = (snap?.results ?? {}) as Record<string, { status: string; detail?: string }>;

  // SPEC-221 · item yang regresi sejak snapshot sebelumnya → penanda drift di UI (AC-19).
  const prevResults = (snaps[1]?.results ?? {}) as Record<string, { status: string }>;
  const driftedIds = new Set(computeDrift(prevResults, results as Record<string, { status: string }>).map((d) => d.itemId));

  // SPEC-221 · deteksi stack app-layer (advisory) dari snapshot terkini.
  const detected = (snap?.detected ?? {}) as Record<string, { present: boolean; detail: string }>;

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
      drifted: driftedIds.has(c.id),
      actorEmail: st?.actorEmail ?? null, naReason: st?.naReason ?? null, attestNote: st?.attestNote ?? null,
    };
    const arr = itemsBySection.get(c.section) ?? [];
    arr.push(item);
    itemsBySection.set(c.section, arr);
  }

  // SPEC-221 · seksi app-layer dengan stack tak terdeteksi → saran N/A (advisory; tak ubah skor).
  const APP_LAYER = new Set(["aapanel", "webserver", "database", "ssl"]);
  const sections: ChecklistSection[] = SECTIONS.map((s) => {
    const det = detected[s.id];
    const suggestion = (APP_LAYER.has(s.id) && det)
      ? { applicable: det.present, detail: det.detail }
      : undefined;
    return {
      id: s.id, title: s.title, icon: s.icon,
      score: scored.bySection[s.id] ?? 100,
      ...(suggestion ? { suggestion } : {}),
      items: itemsBySection.get(s.id) ?? [],
    };
  });

  return {
    vpsId,
    scoreTotal: scored.total,
    scoreBySection: scored.bySection,
    lastAuditAt: snap?.createdAt.toISOString() ?? null,
    sections,
  };
}
