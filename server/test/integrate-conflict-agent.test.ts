import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { killAll } from "../src/services/pty";
import { resetDb, makeProject, makeSpec, makeSetting, makeRepoWithSpecBranch } from "./factory";

// SPEC-377 · sesi penyelesai konflik rebase/merge harus lahir dengan AGEN + model + effort dari
// Setting — bukan default claude. Buktinya diambil dari argv pane tmux (pola session-launch.test),
// karena di situlah pilihan agen benar-benar mewujud: `claude --model …` vs `codex -m …`.
const app = buildApp({ requireAuth: false });

const argvOf = async (id: string): Promise<string> => {
  const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
    "-f", "/dev/null", "capture-pane", "-p", "-J", "-S", "-2000", "-t", `hanoman-${id}`],
    { encoding: "utf8" }).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
  return read();
};

// Repo yang PASTI konflik: base → branch spec mengubah f.txt, main ikut mengubahnya.
const conflictRepo = (specId: string) => makeRepoWithSpecBranch(specId, {
  base: { "f.txt": "base\n" }, work: { "f.txt": "branch\n" }, mainAdvance: { "f.txt": "main\n" },
}).repoDir;

let codexHome: string;
beforeAll(async () => { await resetDb(); });
beforeEach(() => {
  killAll();
  // Kedua binari di-echo: apa pun agen yang dipilih route, argv-nya tercetak di pane.
  process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
  process.env.HANOMAN_CODEX_BIN = "/bin/echo";
  codexHome = mkdtempSync(join(tmpdir(), "hanoman-codexhome-"));
  process.env.CODEX_HOME = codexHome;
});
afterAll(async () => { killAll(); await resetDb(); delete process.env.CODEX_HOME; });

describe("SPEC-377 · agen/model/effort sesi konflik integrasi", () => {
  it("POST /specs/:id/integrate konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    const repoDir = conflictRepo("SPEC-C1");
    await makeProject({ id: "pc1", repoDir });
    await makeSpec({ id: "SPEC-C1", projectId: "pc1", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C1/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");

    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    // Gerbang trust codex dibuka untuk ROOT REPO — tanpa ini sesi mentok di layar trust.
    expect(readFileSync(`${codexHome}/config.toml`, "utf8")).toContain("trust_level");
  });

  it("POST /specs/:id/integrate konflik → model/effort claude dari Setting, bukan hardcode", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
    const repoDir = conflictRepo("SPEC-C2");
    await makeProject({ id: "pc2", repoDir });
    await makeSpec({ id: "SPEC-C2", projectId: "pc2", stage: "done" });

    const res = await app.inject({ method: "POST", url: "/api/specs/SPEC-C2/integrate",
      payload: { op: "merge", target: "origin:main" } });
    expect(res.json().status).toBe("conflict");
    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("--model claude-sonnet-5");
    expect(argv).toContain("--effort medium");
    expect(argv).toContain("--dangerously-skip-permissions");
  });

  it("POST /projects/:id/git/merge konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    await makeProject({ id: "pc3", repoDir: conflictRepo("SPEC-C3") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc3/git/merge",
      payload: { source: "hanoman/spec-c3" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");

    const argv = await argvOf(res.json().sessionId as string);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(readFileSync(`${codexHome}/config.toml`, "utf8")).toContain("trust_level");
  });

  it("POST /projects/:id/git/rebase konflik → sesi codex saat Setting.agent codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    await makeProject({ id: "pc4", repoDir: conflictRepo("SPEC-C4") });

    const res = await app.inject({ method: "POST", url: "/api/projects/pc4/git/rebase",
      payload: { onto: "hanoman/spec-c4" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("conflict");
    expect(await argvOf(res.json().sessionId as string)).toContain("-m gpt-5.6-terra");
  });
});
