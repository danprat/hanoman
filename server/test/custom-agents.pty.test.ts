import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, killSession, registerCustomAgentSource, agentsFilePath, promptFilePath,
} from "../src/services/pty";
import type { AgentDef } from "@hanoman/runner";

// SPEC-450 · ADR-0094 keputusan 7 · kontrak ARGV. Diperiksa lewat argv pane tmux + isi berkas,
// BUKAN lewat bentuk respons — assert bentuk respons LULUS PALSU (pelajaran `sessionModel()`).

const defs: AgentDef[] = [
  { name: "rev", description: "tinjau", instructions: "kamu peninjau", tools: null, model: null, mentions: ["tes"] },
  { name: "tes", description: "uji", instructions: "kamu penguji", tools: null, model: null, mentions: [] },
];

let cwd: string;
const ids: string[] = [];
const born = (id: string): string => { ids.push(id); return id; };

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "hnm-ca-")); });
afterEach(() => {
  for (const id of ids.splice(0)) { try { killSession(id); } catch { /* sudah mati */ } }
  registerCustomAgentSource(() => []);
});
afterAll(() => { registerCustomAgentSource(() => []); });

/** argv pane tmux — satu-satunya bukti yang tak bisa lulus palsu. */
const paneCmd = (id: string): string =>
  execFileSync("tmux", [
    "-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman", "-f", "/dev/null",
    "list-panes", "-t", `hanoman-${id}`, "-F", "#{pane_start_command}",
  ], { encoding: "utf8" });

describe("createSession · claude", () => {
  it("memasang --agents dari BERKAS, bukan JSON inline (tmux membatasi satu command ~16 KB)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-1"), agent: "claude", prompt: "halo" });
    const cmd = paneCmd(s.id);
    expect(cmd).toContain("--agents");
    // Command substitution harus UTUH: `sh -c` yang melahirkan sesi yang meng-expand-nya.
    // (tmux meng-escape `"` di `#{pane_start_command}`, jadi yang dibandingkan bagian dalamnya.)
    expect(cmd).toContain(`$(cat '${agentsFilePath(s.id)}')`);
    expect(cmd).not.toContain('"description"'); // JSON tak pernah inline di command tmux
  });

  it("GOTCHA ADR-0094 #4 · --agents TIDAK boleh ikut ter-`sq` seperti flag lain", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-sq"), agent: "claude", prompt: "halo" });
    const cmd = paneCmd(s.id);
    // Di-`sq` sekali saja, claude menerima literal `$(cat /tmp/…)` sebagai definisi agen — dan
    // JSON tak sah DIABAIKAN tanpa pesan, exit 0, NOL agen (kegagalan-senyap M3).
    expect(cmd).not.toContain("'--agents'");
    expect(cmd).not.toContain(`'--agents "$(cat`);
  });

  it("berkasnya berisi JSON yang benar, dan agen daun TIDAK punya Task", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-2"), agent: "claude", prompt: "halo" });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(Object.keys(j).sort()).toEqual(["rev", "tes"]);
    expect(j.rev.tools).toContain("Task");
    expect(j.tes.tools).not.toContain("Task");
  });

  it("tanpa custom agent, argv TIDAK memuat --agents dan berkasnya tak dibuat", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-claude-3"), agent: "claude", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });

  it("prompt claude TIDAK ditempeli roster (claude memakai jalur native)", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-claude-4"), agent: "claude", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });
});

describe("createSession · codex", () => {
  it("TIDAK memasang --agents, tapi menempelkan roster ke prompt", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-codex-1"), agent: "codex", prompt: "halo" });
    expect(paneCmd(s.id)).not.toContain("--agents");
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt.startsWith("halo")).toBe(true);
    expect(prompt).toContain("@rev");
    expect(prompt).toContain("kamu peninjau");
  });

  it("tanpa custom agent, prompt codex byte-identik dengan sebelumnya", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-codex-2"), agent: "codex", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });
});

describe("sesi shell mentah (opts.command)", () => {
  it("tak menerima apa pun — tak ada agen di sana", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-shell-1"), command: ["/bin/sh", "-c", "sleep 30"] });
    expect(paneCmd(s.id)).not.toContain("--agents");
    expect(existsSync(agentsFilePath(s.id))).toBe(false);
  });
});

describe("sumber yang melempar", () => {
  it("tak menggagalkan kelahiran sesi (katalog agen opsional)", () => {
    registerCustomAgentSource(() => { throw new Error("DB mati"); });
    const s = createSession("p1", cwd, { id: born("ca-throw-1"), agent: "claude", prompt: "halo" });
    expect(s.id).toBe("ca-throw-1");
    expect(paneCmd(s.id)).not.toContain("--agents");
  });
});
