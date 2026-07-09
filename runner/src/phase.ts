import type { QueryFn, RunEvent, SdkUserMessage } from "./types";
const DENY = ["Bash(rm -rf *)", "Bash(git push * main*)", "Bash(git push origin main*)"];
export interface RunPhaseArgs {
  queryFn: QueryFn; cwd: string; model: string; effort?: string;
  prompt: string | AsyncIterable<SdkUserMessage>; abortController: AbortController;
  onEvent: (e: RunEvent) => void;
}
export async function runPhase(a: RunPhaseArgs) {
  let sessionId: string | undefined, costUsd = 0, tokensIn = 0, tokensOut = 0, subtype = "success";
  const it = a.queryFn({ prompt: a.prompt, options: {
    cwd: a.cwd, model: a.model, effort: a.effort,
    abortController: a.abortController, settingSources: ["user", "project", "local"],
    disallowedTools: DENY,
  } });
  for await (const m of it) {
    if (m.type === "assistant") {
      sessionId = m.session_id ?? sessionId;
      for (const b of m.message.content) {
        if (b.type === "text" && b.text) a.onEvent({ kind: "log", line: { t: "›", s: b.text } });
        else if (b.type === "tool_use" && b.name) a.onEvent({ kind: "log", line: { t: "$", s: `tool ${b.name}` } });
      }
    } else if (m.type === "result") {
      sessionId = m.session_id; subtype = m.subtype;
      // Steering streams many user messages and claude emits one `result` per turn:
      // total_cost_usd is cumulative over the session, usage.*_tokens is per turn.
      costUsd = m.total_cost_usd; tokensIn += m.usage.input_tokens; tokensOut += m.usage.output_tokens;
      a.onEvent({ kind: "cost", tokensIn, tokensOut, costUsd });
    } else if (m.type === "system") sessionId = m.session_id ?? sessionId;
  }
  return { sessionId, costUsd, tokensIn, tokensOut, subtype };
}
