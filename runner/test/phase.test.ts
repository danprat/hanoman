import { describe, it, expect } from "vitest";
import { runPhase } from "../src/phase";
import type { ClaudeSession, CliMessage } from "../src/types";

const result = (over: Partial<Extract<CliMessage, { type: "result" }>> = {}): CliMessage => ({
  type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});
// Giliran slash-command memancarkan `result` sintetisnya sendiri (claude v2.1.205).
const synthetic = (): CliMessage =>
  result({ total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 1 } });

function fakeSession(scripts: CliMessage[][]): ClaudeSession & { sent: string[] } {
  const sent: string[] = [];
  let queue: CliMessage[] = [];
  return {
    sent,
    send(t) { sent.push(t); queue = queue.concat(scripts.shift() ?? [result()]); },
    async next() { return queue.shift() ?? null; },
    close() { /* empty */ }, kill() { /* empty */ },
  };
}

describe("runPhase", () => {
  it("sends no slash command when the step matches the current session state", async () => {
    const s = fakeSession([[result()]]);
    await runPhase({ session: s, step: { model: "m1", effort: "low" }, current: { model: "m1", effort: "low" },
      prompt: "do it", onEvent: () => {} });
    expect(s.sent).toEqual(["do it"]);
  });

  it("switches model and effort, discarding one synthetic result each", async () => {
    const s = fakeSession([[synthetic()], [synthetic()], [result({ total_cost_usd: 9 })]]);
    const cur = { model: "m1", effort: "low" };
    const r = await runPhase({ session: s, step: { model: "m2", effort: "xhigh" }, current: cur,
      prompt: "do it", onEvent: () => {} });
    expect(s.sent).toEqual(["/model m2", "/effort xhigh", "do it"]);
    // Hasil fase adalah result prompt, BUKAN result sintetis slash-command.
    expect(r.costUsd).toBe(9);
    // current di-mutate agar fase berikutnya tak mengirim ulang slash command yang sama.
    expect(cur).toEqual({ model: "m2", effort: "xhigh" });
  });

  it("switches only the model when effort is unchanged", async () => {
    const s = fakeSession([[synthetic()], [result()]]);
    await runPhase({ session: s, step: { model: "m2", effort: "low" }, current: { model: "m1", effort: "low" },
      prompt: "p", onEvent: () => {} });
    expect(s.sent).toEqual(["/model m2", "p"]);
  });

  it("emits log events for assistant text and tool_use of the phase turn only", async () => {
    const s = fakeSession([[synthetic()], [
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }, { type: "tool_use", name: "Bash" }] } },
      result(),
    ]]);
    const events: { kind: string; line?: { s: string } }[] = [];
    await runPhase({ session: s, step: { model: "m2" }, current: { model: "m1" },
      prompt: "p", onEvent: (e) => events.push(e as never) });
    const logs = events.filter((e) => e.kind === "log").map((e) => e.line!.s);
    expect(logs).toEqual(["hello", "tool Bash"]);
  });

  it("emits one cost event carrying the phase turn's usage", async () => {
    const s = fakeSession([[result({ total_cost_usd: 1.5, usage: { input_tokens: 7, output_tokens: 3 } })]]);
    const events: { kind: string }[] = [];
    await runPhase({ session: s, step: { model: "m1" }, current: { model: "m1" },
      prompt: "p", onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.kind === "cost")).toEqual([
      { kind: "cost", tokensIn: 7, tokensOut: 3, costUsd: 1.5 },
    ]);
  });
});
