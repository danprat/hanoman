import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { coverageOf, linkedSetFrom } from "@hanoman/shared";
import { resolveRepo } from "./repo";
import { INDEX_NAME, walkDocs, catStatus } from "./docs-model";
// Coverage read-only untuk `docs scan` dan tampilan. BUKAN guardrail: tak memblokir apa pun.
// Gate Source of Truth (array `violations`) dicabut, SPEC-160.
export function scanCoverage(cwd: string) {
  const { root, docsDir, indexPath } = resolveRepo(cwd);
  const docsRoot = join(root, docsDir);
  // Repo target boleh tak punya docs SoT sama sekali (mis. kirimchat-multi) → coverage 100.
  if (!existsSync(docsRoot)) return { coverage: 100, cats: [] };
  // Docs ADA tapi index hilang = setup docs rusak. Fail loud, bukan diam-diam "semua unlinked".
  if (!existsSync(indexPath)) throw new Error(`index Source of Truth tidak ada: ${indexPath}`);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const files = corpus.filter((f) => f !== INDEX_NAME);
  const cats = catStatus(files, linked);
  const coverage = coverageOf(files.map((f) => ({ category: f.split("/")[0]!, linked: linked.has(f) })));
  return { coverage, cats };
}
