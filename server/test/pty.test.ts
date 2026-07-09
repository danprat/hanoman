import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createSession, getSession, listSessions, killSession, killAll, attach, writeTo } from "../src/services/pty";

// createSession SELALU menambahkan --dangerously-skip-permissions, jadi binary pengganti
// harus menoleransi flag itu. /bin/cat tidak: ia mati seketika dengan "illegal option".
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

// Klien palsu yang merekam frame — cukup untuk menguji kontrak broadcast.
function fakeClient() {
  const frames: { t: string; d?: string; code?: number }[] = [];
  let closed = false;
  return {
    frames, wasClosed: () => closed,
    send: (m: string) => { frames.push(JSON.parse(m)); },
    close: () => { closed = true; },
  };
}
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const lastFrame = (c: ReturnType<typeof fakeClient>) => c.frames[c.frames.length - 1];
const allData = (c: ReturnType<typeof fakeClient>) =>
  c.frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");

afterEach(() => { killAll(); });

describe("pty service", () => {
  it("spawns the claude binary with --dangerously-skip-permissions and reports its exit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    expect(allData(c)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(c)).toEqual({ t: "exit", code: 0 });
    expect(c.wasClosed()).toBe(true);
  });

  it("replays scrollback to a client that attaches after the process already exited", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => s.exited);
    const late = fakeClient();
    attach(s, late);
    expect(allData(late)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(late)).toEqual({ t: "exit", code: 0 });
  });

  it("forwards stdin to a live process and keeps it listed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p2", process.cwd());
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => allData(c).includes("args: --dangerously-skip-permissions"));
    writeTo(s, "halo\n");
    await waitFor(() => allData(c).includes("halo"));
    expect(listSessions()[0]).toMatchObject({ id: s.id, projectId: "p2", cwd: process.cwd(), exited: false });
    expect(getSession(s.id)).toBe(s);
  });

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa
  // `--settings` sesi PTY berjalan tanpa gerbang sama sekali (ADR-0010).
  it("always registers the PreToolUse guard hook (ADR-0010)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    expect(allData(c)).toContain("--settings");
    expect(allData(c)).toContain("hook pretooluse");
  });

  it("resumes a run's own claude session in the run worktree", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd(), { runId: "RUN-7", resume: "sess-abc" });
    const c = fakeClient();
    attach(s, c);
    await waitFor(() => lastFrame(c)?.t === "exit");
    expect(allData(c)).toContain("--resume sess-abc");
    expect(allData(c)).toContain("--settings");
    expect(listSessions()[0]).toMatchObject({ runId: "RUN-7" });
  });

  it("killSession stops the process and forgets the session; a second kill is false", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p3", process.cwd());
    expect(killSession(s.id)).toBe(true);
    expect(listSessions()).toEqual([]);
    expect(getSession(s.id)).toBeUndefined();
    expect(killSession(s.id)).toBe(false);
  });
});
