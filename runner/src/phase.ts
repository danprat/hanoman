import { takeTurn, type TurnResult } from "./turns";
import type { ClaudeSession, RunEvent } from "./types";

export const DENY = ["Bash(rm -rf *)", "Bash(git push * main*)", "Bash(git push origin main*)"];

/** State sesi yang sedang berjalan. Di-mutate lintas fase agar slash command tak dikirim ulang. */
export type StepState = { model: string; effort?: string };

export interface RunPhaseArgs {
  session: ClaudeSession;
  step: { model: string; effort?: string };
  current: StepState;
  prompt: string;
  onEvent: (e: RunEvent) => void;
}

// `/model` dan `/effort` menggeser sesi di tengah jalan (diverifikasi terhadap claude
// v2.1.205), jadi ADR-0003 tidak menuntut satu proses per fase. Tiap giliran slash-command
// memancarkan `result` sintetisnya sendiri; ia dibuang. Membacanya sebagai hasil fase akan
// menandai fase selesai sebelum ia sempat bekerja.
export async function runPhase(a: RunPhaseArgs): Promise<TurnResult> {
  if (a.step.model !== a.current.model) {
    await takeTurn(a.session, `/model ${a.step.model}`);
    a.current.model = a.step.model;
  }
  if (a.step.effort && a.step.effort !== a.current.effort) {
    await takeTurn(a.session, `/effort ${a.step.effort}`);
    a.current.effort = a.step.effort;
  }
  const r = await takeTurn(a.session, a.prompt, (m) => {
    if (m.type !== "assistant") return;
    for (const b of m.message.content) {
      if (b.type === "text" && b.text) a.onEvent({ kind: "log", line: { t: "›", s: b.text } });
      else if (b.type === "tool_use" && b.name) a.onEvent({ kind: "log", line: { t: "$", s: `tool ${b.name}` } });
    }
  });
  a.onEvent({ kind: "cost", tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd });
  return r;
}
