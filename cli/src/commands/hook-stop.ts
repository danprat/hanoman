import type { Ctx } from "../router";
import { collectViolations, formatText } from "../verify";
export default async function (_args: string[], ctx: Ctx): Promise<number> {
  let payload: { stop_hook_active?: boolean; cwd?: string } = {};
  try { payload = JSON.parse((await ctx.readStdin?.()) ?? "{}"); } catch { /* empty */ }
  if (payload.stop_hook_active === true) return 0;
  // CLAUDE_PROJECT_DIR dulu: payload.cwd ikut `cd` di sesi dan bisa keluar dari repo.
  const root = ctx.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? ctx.cwd;
  const result = collectViolations(root);
  if (result.violations.length) ctx.stdout(JSON.stringify({ decision: "block", reason: formatText(result) }));
  return 0;
}
