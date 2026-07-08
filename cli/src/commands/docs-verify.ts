import { parseArgs } from "node:util";
import type { Ctx } from "../router";
import { collectViolations, formatText, formatJson } from "../verify";
export default async function (args: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({ args, options: {
    "block-if-stale": { type: "boolean" }, json: { type: "boolean" } }, allowPositionals: true });
  const result = collectViolations(ctx.cwd);
  ctx.stdout((values.json ? formatJson(result) : formatText(result)) + "\n");
  return values["block-if-stale"] && result.violations.length ? 1 : 0;
}
