import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import {
  createSession, getSession, listSessions, killSession, killAll, detachAll, attach, writeTo,
} from "../src/services/pty";

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
const exited = (id: string) => getSession(id)?.exited === true;

afterEach(() => { killAll(); });

describe("pty service", () => {
  it("spawns the claude binary with --dangerously-skip-permissions and reports its exit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(c)).toEqual({ t: "exit", code: 0 });
    expect(c.wasClosed()).toBe(true);
  });

  // `remain-on-exit` menahan pane yang sudah mati: output terakhir sesi yang gagal masih
  // terbaca setelah refresh, dan kode keluarnya yang asli — bukan kode klien tmux.
  it("keeps a dead session listed, carrying its real exit code", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/usr/bin/false";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    expect(listSessions()).toMatchObject([{ id: s.id, exited: true }]);
    const c = fakeClient();
    attach(s.id, c);
    expect(lastFrame(c)).toEqual({ t: "exit", code: 1 });
  });

  it("replays the dead pane's screen to a client that attaches after the process exited", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const late = fakeClient();
    attach(s.id, late);
    expect(allData(late)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(late)).toEqual({ t: "exit", code: 0 });
  });

  it("forwards stdin to a live process and keeps it listed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p2", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("args: --dangerously-skip-permissions"));
    writeTo(s.id, "halo\n");
    await waitFor(() => allData(c).includes("halo"));
    expect(listSessions()[0]).toMatchObject({ id: s.id, projectId: "p2", cwd: process.cwd(), exited: false });
    expect(getSession(s.id)).toMatchObject({ id: s.id, projectId: "p2" });
  });

  // Inti ADR-0016: sesi hidup di tmux server, bukan di proses API. Menutup server — atau
  // me-restartnya lewat `pnpm dev` — hanya melepas klien, tidak membunuh claude.
  it("survives the API letting go: detachAll leaves the session running and re-attachable", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p4", process.cwd());
    const first = fakeClient();
    attach(s.id, first);
    await waitFor(() => allData(first).includes("args:"));

    detachAll();
    expect(listSessions()).toMatchObject([{ id: s.id, exited: false }]);

    const second = fakeClient();
    attach(s.id, second); // klien tmux baru; tmux menggambar ulang layar yang sama
    await waitFor(() => allData(second).includes("args:"));
    expect(lastFrame(second)?.t).not.toBe("exit");
  });

  // Sesi sebuah run itu tunggal: membuka tabnya lagi harus menyambung, bukan menyalakan
  // `claude --resume` kedua di atas file sesi yang sama (ADR-0015).
  it("reuses a run's existing session instead of spawning a second --resume", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = createSession("p1", process.cwd(), { runId: "RUN-7", resume: "sess-abc" });
    const b = createSession("p1", process.cwd(), { runId: "RUN-7", resume: "sess-abc" });
    expect(b.id).toBe(a.id);
    expect(listSessions()).toHaveLength(1);
  });

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Tanpa
  // `--settings` sesi PTY berjalan tanpa gerbang sama sekali (ADR-0010).
  it("always registers the PreToolUse guard hook (ADR-0010)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--settings");
    expect(allData(c)).toContain("hook pretooluse");
  });

  it("resumes a run's own claude session in the run worktree", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd(), { runId: "RUN-7", resume: "sess-abc" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
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
