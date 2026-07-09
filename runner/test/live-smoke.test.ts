import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { makeClaudeCliQuery } from "../src/claude-cli";
import { runPhase } from "../src/phase";
// Spends real tokens against the real `claude` binary — off by default.
//   HANOMAN_LIVE=1 pnpm --filter @hanoman/runner test
const LIVE = process.env.HANOMAN_LIVE === "1";
describe.runIf(LIVE)("live smoke", () => {
  it("drives a real phase through the spawned claude CLI", async () => {
    const guardCommand = `node "${join(process.cwd(), "..", "cli", "dist", "hanoman.js")}" hook pretooluse`;
    const r = await runPhase({
      queryFn: makeClaudeCliQuery({ guardCommand }),
      cwd: process.cwd(), model: "haiku", effort: "low",
      prompt: "Reply with exactly: OK", abortController: new AbortController(), onEvent: () => {},
    });
    expect(r.subtype).toBe("success");
    expect(r.sessionId).toBeTruthy();
    expect(r.tokensOut).toBeGreaterThan(0);
  }, 180000);

  it("fails loud when the binary is missing instead of killing the worker", async () => {
    const q = makeClaudeCliQuery({ bin: "claude-does-not-exist-xyz", guardCommand: "true" });
    await expect(async () => {
      for await (const _ of q({ prompt: "hi", options: { cwd: process.cwd(), model: "haiku" } })) { /* drain */ }
    }).rejects.toThrow(/gagal menjalankan/);
  }, 30000);
});
