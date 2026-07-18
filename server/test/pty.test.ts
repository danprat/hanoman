import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, getSession, listSessions, killSession, killAll, detachAll, attach, writeTo,
  sessionPhases, markerFilled, promptFilePath,
} from "../src/services/pty";
import { phaseFilePath, type Phase } from "../src/services/session-phases";

// createSession SELALU menambahkan --dangerously-skip-permissions, jadi binary pengganti
// harus menoleransi flag itu. /bin/cat tidak: ia mati seketika dengan "illegal option".
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

// Klien palsu yang merekam frame — cukup untuk menguji kontrak broadcast.
function fakeClient() {
  const frames: { t: string; d?: string; code?: number; phases?: Phase[] }[] = [];
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
const phaseFrames = (c: ReturnType<typeof fakeClient>) => c.frames.filter((f) => f.t === "phase");

let repoDir = "";
beforeEach(() => { repoDir = mkdtempSync(join(tmpdir(), "hanoman-pty-")); });
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

  // SPEC-211 · Open Console memasok argv sendiri (mis. `ssh -t …`) — shell mentah, bukan claude.
  it("command opt menjalankan perintah non-claude, tanpa flag claude", async () => {
    const s = createSession("con1", process.cwd(), { command: ["/bin/echo", "halo-console"] });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("halo-console");
    expect(allData(c)).not.toContain("--dangerously-skip-permissions");
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

  // Sesi sebuah backlog item itu tunggal: menekan Start lagi harus menyambung, bukan
  // menyalakan `claude` kedua di atas worktree yang sama (ADR-0015).
  it("reuses a backlog item's existing session instead of spawning a second claude", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = createSession("p1", process.cwd(), { specId: "SPEC-7", flow: "feature", prompt: "x" });
    const b = createSession("p1", process.cwd(), { specId: "SPEC-7", flow: "feature", prompt: "x" });
    expect(b.id).toBe(a.id);
    expect(listSessions()).toHaveLength(1);
  });

  // Guardrail deny PreToolUse dicabut (SPEC-197, ADR-0037): sesi tetap membawa `--settings`
  // (untuk marker keputusan SPEC-184) tapi TAK ada lagi hook deny `hook pretooluse`.
  it("tidak lagi mendaftarkan guard hook PreToolUse (ADR-0037)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--settings");
    expect(allData(c)).not.toContain("hook pretooluse");
    expect(allData(c)).not.toContain("PreToolUse");
  });

  it("sesi backlog membawa specId + flow, dan id-nya diturunkan dari spec", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", repoDir, { specId: "SPEC-162", flow: "feature", prompt: "halo" });
    expect(s.id).toBe("spec-162");
    expect(listSessions().find((x) => x.id === "spec-162")).toMatchObject({
      specId: "SPEC-162", flow: "feature",
    });
  });

  it("prompt awal + model + effort sampai ke argv claude", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", repoDir, {
      specId: "SPEC-A", flow: "feature", prompt: "kerjakan ini", model: "claude-opus-4-8", effort: "xhigh",
    });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("kerjakan ini");
    expect(allData(c)).toContain("--model claude-opus-4-8");
    expect(allData(c)).toContain("--effort xhigh");
  });

  // SPEC-223 · prompt scaffold/reverse (STANDAR DOCS) + ide panjang bisa >16KB; menaruhnya inline
  // di command tmux memicu "tmux set-option gagal: command too long". Prompt harus lewat file yang
  // dibaca `$(cat …)` saat sesi lahir — command tmux tetap pendek, claude tetap terima prompt penuh.
  it("prompt sangat besar tak melebihi batas command tmux — ditulis ke file (SPEC-223)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const big = "MULAI " + "x".repeat(60_000) + " SELESAI";
    let s!: ReturnType<typeof createSession>;
    expect(() => { s = createSession("p1", repoDir, { specId: "SPEC-BIG", flow: "feature", prompt: big }); })
      .not.toThrow();
    expect(getSession(s.id)).toBeTruthy();
    // Prompt penuh diserahkan lewat file (dibaca $(cat) saat sesi lahir), bukan argv tmux.
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe(big);
  });

  it("menyiarkan frame phase saat berkas fase berubah, sekali per perubahan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-b");
    const s = createSession("p1", repoDir, { specId: "SPEC-B", flow: "feature", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    // Klien yang baru menempel langsung melihat fase, tanpa menunggu perubahan.
    await waitFor(() => phaseFrames(c).length > 0);
    expect(phaseFrames(c)[0]!.phases![0]).toEqual({ name: "Brainstorm", state: "active" });

    appendFileSync(phaseFile, "Brainstorm done\n");
    await waitFor(() => phaseFrames(c).some((f) => f.phases![0]!.state === "done"));

    const count = phaseFrames(c).length;
    await new Promise((r) => setTimeout(r, 1200)); // dua tick poll tanpa perubahan berkas
    expect(phaseFrames(c).length).toBe(count);
  });

  // SPEC-209 · riwayat claude hidup di scrollback pane tmux, tapi klien hanya menerima layar
  // yang terlihat (ADR-0016) — tak ada jalan scroll ke atas. `mouse on` membuat tmux mengabari
  // klien mengaktifkan mouse-reporting (DECSET 1000/1006); xterm.js lalu meneruskan wheel ke
  // tmux → copy-mode → scroll riwayat. Bukti fix sampai ke klien: urutan enable itu ada di aliran.
  it("mengaktifkan mouse tmux agar browser bisa scroll riwayat pane (SPEC-209)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("\x1b[?1000h"));
  });

  it("sesi project (tanpa spec) tak punya fase", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", repoDir);
    expect(sessionPhases(s.id)).toBe(null);
  });

  it("killSession stops the process and forgets the session; a second kill is false", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p3", process.cwd());
    expect(killSession(s.id)).toBe(true);
    expect(listSessions()).toEqual([]);
    expect(getSession(s.id)).toBeUndefined();
    expect(killSession(s.id)).toBe(false);
  });

  it("markerFilled: absent/empty → false, non-empty → true (SPEC-196)", () => {
    const f = join(repoDir, "marker");
    expect(markerFilled(f)).toBe(false);        // berkas belum ada
    appendFileSync(f, "menunggu");
    expect(markerFilled(f)).toBe(true);
  });

  it("listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-d");
    const s = createSession("p1", repoDir, { specId: "SPEC-D", flow: "feature", prompt: "x", decisionFile });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    expect(find().decision).toBe(false);        // sesi hidup, marker belum ditulis
    appendFileSync(decisionFile, "menunggu\n");  // hook Notification menulis marker
    expect(find().decision).toBe(true);
  });
});
