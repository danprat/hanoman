// SPEC-220 · katalog kepatuhan VPS — sumber kebenaran di git (AC-1/AC-2).
// Menggabung item mentah (catalog.data.ts, di-generate) dengan metadata hanoman (overrides.ts).
import { RAW_ITEMS, RAW_SECTIONS } from "./catalog.data";
import { OVERRIDES, APP_LAYER_SECTIONS } from "./overrides";

export type Mode = "AUTO" | "AUDIT" | "INFO";
export type Severity = "critical" | "high" | "medium" | "low";

export type CatalogItem = {
  id: string;
  section: string;
  sectionTitle: string;
  level: string;
  title: string;
  code?: string;
  mode: Mode;          // default INFO
  severity: Severity;  // default dari level
  probe: boolean;      // true → audit.sh mengemit CHECK <id>
  remediable: boolean; // true (⇒ AUTO) → remediate.sh bisa apply
  appLayer: boolean;   // hint UI "kemungkinan N/A"
};

export type SectionMeta = { id: string; title: string; icon: string; count: number };

// Basic paling fundamental → high; Intermediate → medium; sisanya (Advanced & level kustom) → low.
const sevFromLevel = (lvl: string): Severity =>
  lvl === "Basic" ? "high" : lvl === "Intermediate" ? "medium" : "low";

export const CATALOG: CatalogItem[] = RAW_ITEMS.map((r) => {
  const ov = OVERRIDES[r.id] ?? {};
  const item: CatalogItem = {
    id: r.id,
    section: r.section,
    sectionTitle: r.sectionTitle,
    level: r.level,
    title: r.title,
    mode: ov.mode ?? "INFO",
    severity: ov.severity ?? sevFromLevel(r.level),
    probe: ov.probe ?? false,
    remediable: ov.remediable ?? false,
    appLayer: APP_LAYER_SECTIONS.has(r.section),
  };
  if ("code" in r && (r as { code?: string }).code) item.code = (r as { code?: string }).code;
  return item;
});

export const SECTIONS: SectionMeta[] = RAW_SECTIONS.map((s) => ({
  id: s.id, title: s.title, icon: s.icon, count: s.count,
}));

const _map = new Map(CATALOG.map((c) => [c.id, c]));
export const byId = (id: string): CatalogItem | undefined => _map.get(id);
