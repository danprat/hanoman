import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { resolveRepo } from "../repo";
import { addLink } from "../index-edit";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { category: { type: "string" } }, allowPositionals: true });
  const rel = positionals[0];
  if (!rel) { ctx.stderr("usage: hanoman docs link <path> [--category c]\n"); return 1; }
  const { indexPath } = resolveRepo(ctx.cwd);
  addLink(indexPath, rel, values.category ?? rel.split("/")[0]!);
  ctx.stdout(`linked ${rel}\n`); return 0;
}
