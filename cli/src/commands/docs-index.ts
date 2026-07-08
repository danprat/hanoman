import { parseArgs } from "node:util";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { parseIndex, walkDocs } from "../docs-model";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { check: { type: "boolean" }, fix: { type: "boolean" } }, allowPositionals: true });
  const { root, docsDir, indexPath } = resolveRepo(ctx.cwd);
  const files = walkDocs(join(root, docsDir));
  const linked = parseIndex(indexPath);
  const unlinked = files.filter((f) => !linked.has(f));
  const dangling = [...linked].filter((p) => !existsSync(join(root, docsDir, p)));
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
