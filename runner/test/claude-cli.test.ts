import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { buildArgs, guardSettings, makeClaudeCliSession } from "../src/claude-cli";
import { deniesDangerous } from "../src/safety";
const GUARD = 'node "/x/hanoman.js" hook pretooluse';
const at = (a: string[], flag: string) => a[a.indexOf(flag) + 1];
// Mengabaikan argv dan membalas satu `result` per baris stdin — kontrak yang
// diverifikasi terhadap binary asli claude v2.1.205.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
describe("buildArgs", () => {
  it("streams json both ways and registers the guardrail hook", () => {
    const a = buildArgs({ cwd: "/w", model: "claude-opus-4-8" }, GUARD);
    expect(at(a, "--input-format")).toBe("stream-json");
    expect(at(a, "--output-format")).toBe("stream-json");
    expect(at(a, "--model")).toBe("claude-opus-4-8");
    // Unattended: nobody can answer a prompt. The hook, not the permission mode, is the gate.
    expect(a).toContain("--dangerously-skip-permissions");
    expect(a).not.toContain("--permission-mode");
    // A daily terminal session loads all three; a run must match it.
    expect(at(a, "--setting-sources")).toBe("user,project,local");
    expect(JSON.parse(at(a, "--settings")!)).toEqual(guardSettings(GUARD));
  });

  // Run yang terputus menyambung percakapannya sendiri (ADR-0017). Tanpa --fork-session,
  // sehingga session_id-nya tidak berubah dan `Run.sessionId` tetap menunjuk ke sesi itu.
  it("resumes an existing conversation only when asked, and never forks it", () => {
    expect(buildArgs({ cwd: "/w", model: "m" }, GUARD)).not.toContain("--resume");
    const a = buildArgs({ cwd: "/w", model: "m", resume: "sess-abc" }, GUARD);
    expect(at(a, "--resume")).toBe("sess-abc");
    expect(a).not.toContain("--fork-session");
  });
  it("omits effort when unset, includes it when set", () => {
    expect(buildArgs({ cwd: "/w", model: "m" }, GUARD)).not.toContain("--effort");
    expect(at(buildArgs({ cwd: "/w", model: "m", effort: "xhigh" }, GUARD), "--effort")).toBe("xhigh");
  });
  it("never passes a spend cap — cost is an estimate, not a brake (ADR-0012)", () => {
    expect(buildArgs({ cwd: "/w", model: "m", effort: "low" }, GUARD)).not.toContain("--max-budget-usd");
  });
  it("keeps the variadic --disallowed-tools last so it swallows nothing", () => {
    const a = buildArgs({ cwd: "/w", model: "m", disallowedTools: ["Bash(rm -rf *)", "Edit"], effort: "low" }, GUARD);
    expect(a.slice(a.indexOf("--disallowed-tools"))).toEqual(["--disallowed-tools", "Bash(rm -rf *)", "Edit"]);
  });
});
describe("makeClaudeCliSession", () => {
  it("keeps one process alive across many turns and pairs each send with one result", async () => {
    const s = makeClaudeCliSession({ bin: FAKE_CLAUDE, guardCommand: GUARD })({ cwd: process.cwd(), model: "m" });
    s.send("turn one");
    expect(await s.next()).toMatchObject({ type: "result", session_id: "sess-1", usage: { output_tokens: 1 } });
    // Proses masih hidup: giliran kedua dilayani proses yang sama, sesi yang sama.
    s.send("turn two");
    expect(await s.next()).toMatchObject({ type: "result", session_id: "sess-1", usage: { output_tokens: 2 } });
    // Menutup stdin adalah satu-satunya cara claude keluar.
    s.close();
    expect(await s.next()).toBeNull();
  }, 15000);

  it("fails loud when the binary is missing instead of killing the worker", async () => {
    const s = makeClaudeCliSession({ bin: "claude-does-not-exist-xyz", guardCommand: GUARD })({ cwd: process.cwd(), model: "m" });
    await expect(s.next()).rejects.toThrow(/gagal menjalankan/);
  }, 15000);
});

describe("deniesDangerous", () => {
  it("denies what the coarse globs would let through, allows the rest", () => {
    expect(deniesDangerous("Bash", { command: "rm  -rf  /tmp/x" })).toBe(true);
    expect(deniesDangerous("Bash", { command: "git push --force upstream main" })).toBe(true);
    expect(deniesDangerous("Bash", { command: "git push origin feature/main-menu" })).toBe(true); // known over-block
    expect(deniesDangerous("Bash", { command: "rm -r build" })).toBe(false);
    expect(deniesDangerous("Edit", { command: "rm -rf /" })).toBe(false);
  });
});
