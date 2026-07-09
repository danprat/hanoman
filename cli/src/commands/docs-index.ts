import { parseArgs } from "node:util";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { linkedSetFrom } from "@hanoman/shared";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { INDEX_NAME, parseIndex, walkDocs } from "../docs-model";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { check: { type: "boolean" }, fix: { type: "boolean" } }, allowPositionals: true });
  const { root, docsDir, indexPath } = resolveRepo(ctx.cwd);
  const docsRoot = join(root, docsDir);
  const corpus = walkDocs(docsRoot);
  const read = (rel: string): string | null => {
    try { return readFileSync(join(docsRoot, rel), "utf8"); } catch { return null; }
  };
  // `unlinked` transitif: doc yang reachable lewat sub-index tak perlu dilink ulang.
  const linked = linkedSetFrom(INDEX_NAME, corpus, read);
  const unlinked = corpus.filter((f) => f !== INDEX_NAME && !linked.has(f));
  // `dangling` butuh link LANGSUNG dari index root — himpunan transitif tak bisa
  // memberi tahu target mana yang ditulis di file itu. Karena itu parseIndex tetap.
  const dangling = [...parseIndex(indexPath)].filter((p) => !existsSync(join(docsRoot, p)));
  if (values.fix) {
    for (const f of unlinked) addLink(indexPath, f, f.split("/")[0]!);
    ctx.stdout(`linked ${unlinked.length} doc(s)\n`); return 0;
  }
  if (unlinked.length || dangling.length) {
    ctx.stderr(`index issues — unlinked: ${unlinked.join(", ") || "none"}; dangling: ${dangling.join(", ") || "none"}\n`);
    return 1;
  }
  ctx.stdout("index ok\n"); return 0;
}
