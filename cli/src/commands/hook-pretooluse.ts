import type { Ctx } from "../router";
import { deniesDangerous, GUARD_DENY_REASON } from "@hanoman/runner";
// PreToolUse deny outranks --permission-mode, so this holds even under acceptEdits.
// Silence (exit 0, no stdout) means "no opinion" — the normal permission flow continues.
export default async function (_args: string[], ctx: Ctx): Promise<number> {
  let payload: { tool_name?: string; tool_input?: Record<string, unknown> } = {};
  try { payload = JSON.parse((await ctx.readStdin?.()) ?? "{}"); } catch { /* empty */ }
  if (payload.tool_name && deniesDangerous(payload.tool_name, payload.tool_input ?? {})) {
    ctx.stdout(JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: GUARD_DENY_REASON,
    } }));
  }
  return 0;
}
