// gen-catalog.mjs — SPEC-220. Generate katalog kepatuhan VPS dari checklist rujukan.
// Sumber: bzn_catalog.json (232 item, ditarik dari https://bzn2026.lovable.app/, lihat
// scratchpad/extract_catalog.mjs). Jalankan sekali; keluarannya (catalog.data.ts) di-commit.
//   node server/scripts/gen-catalog.mjs <path-to-bzn_catalog.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? "/tmp/bzn_catalog.json";
const out = resolve(here, "../src/vps/catalog/catalog.data.ts");

const data = JSON.parse(readFileSync(src, "utf8"));
const sections = data.map((s) => ({
  id: s.id, title: s.title, icon: s.icon,
  count: s.subsections.reduce((a, ss) => a + ss.items.length, 0),
}));
const items = data.flatMap((s) =>
  s.subsections.flatMap((ss) =>
    ss.items.map((it) => ({
      id: it.id, section: s.id, sectionTitle: s.title, level: ss.level, title: it.text,
      ...(it.code ? { code: it.code } : {}),
    }))));

const banner =
  "// GENERATED oleh server/scripts/gen-catalog.mjs dari checklist rujukan (SPEC-220).\n" +
  "// Jangan edit tangan — metadata hanoman (mode/severity/probe) ada di overrides.ts.\n";
writeFileSync(out,
  banner +
  "export const RAW_SECTIONS = " + JSON.stringify(sections) + " as const;\n" +
  "export const RAW_ITEMS = " + JSON.stringify(items) + " as const;\n");
console.log("wrote", items.length, "items", sections.length, "sections ->", out);
