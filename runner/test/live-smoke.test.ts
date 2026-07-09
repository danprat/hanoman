import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { makeClaudeCliSession } from "../src/claude-cli";
import { takeTurn } from "../src/turns";
// Spends real tokens against the real `claude` binary — off by default.
//   HANOMAN_LIVE=1 pnpm --filter @hanoman/runner test
const LIVE = process.env.HANOMAN_LIVE === "1";
describe.runIf(LIVE)("live smoke", () => {
  // Mengunci kontrak yang jadi dasar SPEC-013 terhadap binary, bukan terhadap dokumen:
  // satu proses melayani banyak giliran, `/model` menggeser sesi, konteks terbawa.
  it("keeps one session across turns, switches model, and carries context", async () => {
    const guardCommand = `node "${join(process.cwd(), "..", "cli", "dist", "hanoman.js")}" hook pretooluse`;
    const s = makeClaudeCliSession({ guardCommand })({ cwd: process.cwd(), model: "haiku", effort: "low" });

    const a = await takeTurn(s, "Remember the word ZEBRA. Reply with exactly: OK");
    expect(a.subtype).toBe("success");
    expect(a.sessionId).toBeTruthy();
    expect(a.tokensOut).toBeGreaterThan(0);

    await takeTurn(s, "/model sonnet"); // giliran sintetis — hasilnya dibuang

    let text = "";
    const b = await takeTurn(s, "Which word did I ask you to remember? One word.", (m) => {
      if (m.type === "assistant") for (const c of m.message.content) if (c.type === "text") text += c.text ?? "";
    });
    expect(b.sessionId).toBe(a.sessionId);         // satu sesi sepanjang run
    expect(text.toUpperCase()).toContain("ZEBRA"); // konteks terbawa lintas fase

    s.close();
    expect(await s.next()).toBeNull();
  }, 240000);

  it("fails loud when the binary is missing instead of killing the worker", async () => {
    const s = makeClaudeCliSession({ bin: "claude-does-not-exist-xyz", guardCommand: "true" })(
      { cwd: process.cwd(), model: "haiku" });
    await expect(s.next()).rejects.toThrow(/gagal menjalankan/);
  }, 30000);
});
