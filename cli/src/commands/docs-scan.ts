import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { collectViolations } from "../verify";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, allowPositionals: true });
  const r = collectViolations(ctx.cwd);
  const categories = r.cats.map((c) => ({ category: c.category, linked: c.linked, unlinked: c.unlinkedFiles }));
  if (values.json) ctx.stdout(JSON.stringify({ coverage: r.coverage, categories }) + "\n");
  else ctx.stdout(`coverage ${r.coverage}%\n` + categories.map((c) => `  ${c.linked ? "✓" : "✗"} ${c.category}${c.unlinked.length ? ` (${c.unlinked.join(", ")})` : ""}`).join("\n") + "\n");
  return 0;
}
