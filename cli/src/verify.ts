import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { coverageOf, linkedSetFrom } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { loadConfig } from "./config";
import { INDEX_NAME, walkDocs, catStatus } from "./docs-model";
import { changedPaths, freshnessViolation } from "./git";
export type Violation = { kind: "unlinked" | "freshness" | "coverage"; reason: string };
export function collectViolations(cwd: string) {
  // Caller-nya (hook stop, docs verify/scan) mengoper cwd, bukan repo root — dan cwd
  // bisa berpindah ke subdir mana pun. Pakai root hasil git rev-parse dari resolveRepo
  // untuk SEMUA akses filesystem, bukan cuma indexPath.
  const { root, docsDir, indexPath } = resolveRepo(cwd);
  const cfg = loadConfig(root);
  // Index hilang = guardrail tak bisa menilai apa pun. Fail loud, jangan diam-diam
  // melaporkan semua doc unlinked (ADR-0009).
  if (!existsSync(indexPath)) throw new Error(`index Source of Truth tidak ada: ${indexPath}`);
  const docsRoot = join(root, docsDir);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const files = corpus.filter((f) => f !== INDEX_NAME); // index bukan doc yang dinilai
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
