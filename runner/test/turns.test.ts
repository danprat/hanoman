import { describe, it, expect, vi } from "vitest";
import { takeTurn } from "../src/turns";
import type { ClaudeSession, CliMessage } from "../src/types";

const result = (over: Partial<Extract<CliMessage, { type: "result" }>> = {}): CliMessage => ({
  type: "result", subtype: "success", session_id: "s1", total_cost_usd: 0.42,
  usage: { input_tokens: 100, output_tokens: 20 }, ...over,
});

// Sesi palsu: tiap `send` mengantre satu skrip pesan yang berakhir dengan `result`.
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

describe("takeTurn", () => {
  it("sends one message and consumes exactly one result", async () => {
    const s = fakeSession([[result()]]);
    const r = await takeTurn(s, "do it");
    expect(s.sent).toEqual(["do it"]);
    expect(r).toEqual({ sessionId: "s1", subtype: "success", isError: false, tokensIn: 100, tokensOut: 20, costUsd: 0.42 });
  });

  // claude v2.1.205 melaporkan 502/401 di tengah giliran sebagai `success` + `is_error`.
  // Kalau takeTurn menelan kedua field itu, pemanggilnya tak punya cara membedakannya dari sukses.
  it("surfaces an API error hiding behind a success subtype", async () => {
    const s = fakeSession([[result({ is_error: true, api_error_status: 502 })]]);
    const r = await takeTurn(s, "x");
    expect(r.subtype).toBe("success");
    expect(r.isError).toBe(true);
    expect(r.apiErrorStatus).toBe(502);
  });

  it("streams messages to onMessage but stops at the result", async () => {
    const s = fakeSession([[
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      result(),
      result({ subtype: "leftover" }),
    ]]);
    const seen: CliMessage[] = [];
    const r = await takeTurn(s, "x", (m) => seen.push(m));
    expect(seen).toHaveLength(2);
    expect(r.subtype).toBe("success");
    // Sisa itu milik giliran BERIKUTNYA; takeTurn tidak boleh menelannya.
    expect(await s.next()).toMatchObject({ subtype: "leftover" });
  });

  it("pairs N sends with N results in order", async () => {
    const s = fakeSession([[result({ total_cost_usd: 0.01 })], [result({ total_cost_usd: 0.05 })]]);
    expect((await takeTurn(s, "a")).costUsd).toBe(0.01);
    expect((await takeTurn(s, "b")).costUsd).toBe(0.05);
    expect(s.sent).toEqual(["a", "b"]);
  });

  it("throws when the session ends before a result arrives", async () => {
    const s: ClaudeSession = { send: vi.fn(), next: async () => null, close: vi.fn(), kill: vi.fn() };
    await expect(takeTurn(s, "x")).rejects.toThrow(/berakhir sebelum `result`/);
  });
});
