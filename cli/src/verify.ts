import { join } from "node:path";
import { coverageOf } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { loadConfig } from "./config";
import { parseIndex, walkDocs, catStatus } from "./docs-model";
import { changedPaths, freshnessViolation } from "./git";
export type Violation = { kind: "unlinked" | "freshness" | "coverage"; reason: string };
export function collectViolations(root: string) {
  const { docsDir, indexPath } = resolveRepo(root);
  const cfg = loadConfig(root);
  const files = walkDocs(join(root, docsDir));
  const linked = parseIndex(indexPath);
  const cats = catStatus(files, linked);
  const coverage = coverageOf(files.map((f) => ({ category: f.split("/")[0]!, linked: linked.has(f) })));
  const violations: Violation[] = [];
  if (cfg.requireLinks) {
    const unlinked = cats.flatMap((c) => c.unlinkedFiles);
    if (unlinked.length) violations.push({ kind: "unlinked", reason: `Doc belum ter-link di index: ${unlinked.join(", ")}` });
  }
  if (cfg.blockStale && freshnessViolation(changedPaths(root)))
    violations.push({ kind: "freshness", reason: "Ada perubahan di src/ tanpa perubahan dokumentasi. Update doc terkait di internal/docs/**." });
  if (cfg.coverageThreshold > 0 && coverage < cfg.coverageThreshold)
    violations.push({ kind: "coverage", reason: `Coverage ${coverage}% di bawah ambang ${cfg.coverageThreshold}%.` });
  return { coverage, cats, violations };
}
export function formatText(r: ReturnType<typeof collectViolations>): string {
  if (!r.violations.length) return `Source of Truth clean · coverage ${r.coverage}%`;
  return `Plan blocked — Source of Truth:\n` + r.violations.map((v) => `  ✗ ${v.reason}`).join("\n");
}
export function formatJson(r: ReturnType<typeof collectViolations>): string {
  return JSON.stringify({ ok: r.violations.length === 0, coverage: r.coverage, violations: r.violations });
}
