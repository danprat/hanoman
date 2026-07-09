import { describe, it, expect, vi } from "vitest";
import { runPhase } from "../src/phase";
import type { SdkMessage, QueryFn } from "../src/types";
const fake = (msgs: SdkMessage[]): QueryFn => () => (async function* () { for (const m of msgs) yield m; })();
const result = (over: Partial<Extract<SdkMessage, { type: "result" }>> = {}) => ({
  type: "result" as const, subtype: "success", session_id: "s1", total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});
describe("runPhase", () => {
  it("emits log events for assistant text and returns cost from result", async () => {
    const events: any[] = [];
    const q = fake([
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      result(),
    ]);
    const r = await runPhase({ queryFn: q, cwd: "/x", model: "claude-opus-4-8",
      prompt: "do it", abortController: new AbortController(), onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.kind === "log" && e.line.s === "hello")).toBe(true);
    expect(r).toMatchObject({ sessionId: "s1", costUsd: 0.42, tokensIn: 100, tokensOut: 20, subtype: "success" });
  });
  // Steering emits one result per turn: usage is per-turn, total_cost_usd is cumulative.
  it("sums tokens across turns but takes the last cumulative cost", async () => {
    const q = fake([
      result({ total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 222 } }),
      result({ total_cost_usd: 0.03, usage: { input_tokens: 10, output_tokens: 64 } }),
    ]);
    const r = await runPhase({ queryFn: q, cwd: "/x", model: "m",
      prompt: "x", abortController: new AbortController(), onEvent: () => {} });
    expect(r).toMatchObject({ costUsd: 0.03, tokensIn: 20, tokensOut: 286 });
  });
  it("passes cwd + model + effort through to the query options", async () => {
    const spy = vi.fn(fake([result({ total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } })]));
    await runPhase({ queryFn: spy as any, cwd: "/work", model: "claude-sonnet-5", effort: "xhigh",
      prompt: "x", abortController: new AbortController(), onEvent: () => {} });
    expect(spy.mock.calls[0]![0].options).toMatchObject({
      cwd: "/work", model: "claude-sonnet-5", effort: "xhigh",
      settingSources: ["user", "project", "local"],
    });
  });
});
