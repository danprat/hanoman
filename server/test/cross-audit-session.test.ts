import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { buildCrossAuditCtx } from "../src/services/cross-audit";
import { killAll, getSession, listSessions, auditSessionScope } from "../src/services/pty";
import { makeRepoWithBranches } from "./factory";
import { DEFAULT_SETTING } from "../src/services/settings";
import { existsSync, readFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// Sesi men-spawn `claude` sungguhan bila tak distub. fixtures/fake-claude.sh mencetak argv lalu
// `exec cat` (tetap hidup) — pola yang sama dipakai terminal.route.test.ts.
process.env.HANOMAN_CLAUDE_BIN = resolve(import.meta.dirname, "fixtures/fake-claude.sh");

const app = buildApp({ requireAuth: false });
// SPEC-338 · arahkan config codex ke temp dir: ensureCodexTrust menulis sungguhan, dan
// ~/.codex/config.toml milik operator TAK BOLEH tersentuh test.
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "hanoman-codexhome-"));

const clean = async () => {
  await prisma.setting.deleteMany();
  await prisma.projectLink.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.localBinding.deleteMany();
  await prisma.project.deleteMany();
};

// Baca tmux option sesi langsung — kunci sengaja tak pernah keluar lewat API.
const tmuxOpt = (session: string, opt: string): string => {
  const socket = process.env.HANOMAN_TMUX_SOCKET ?? "hanoman";
  return execFileSync("tmux", ["-L", socket, "-f", "/dev/null", "show-options", "-v", "-t", session, opt],
    { encoding: "utf8" }).trim();
};

let webDir = "", apiDir = "";

beforeEach(async () => {
  killAll();
  await clean();
  webDir = makeRepoWithBranches();
  apiDir = makeRepoWithBranches();
  await prisma.project.createMany({ data: [
    { id: "web", name: "Web", desc: "", kind: "existing", repoDir: webDir, stack: "React" },
    { id: "api", name: "API", desc: "", kind: "existing", repoDir: apiDir, stack: "Fastify" },
    { id: "sdk", name: "SDK", desc: "", kind: "existing", repoDir: null, stack: "TS" },
  ] });
  await prisma.projectLink.create({ data: { fromProjectId: "web", toProjectId: "api", kind: "api", note: "web memanggil /api/orders" } });
  await prisma.projectLink.create({ data: { fromProjectId: "sdk", toProjectId: "web", kind: "sdk", note: "" } });
});
afterAll(async () => { killAll(); await clean(); });

describe("buildCrossAuditCtx", () => {
  it("menyusun scope + path checkout tetangga kedua arah", async () => {
    const built = (await buildCrossAuditCtx("web"))!;
    expect(built.scope[0]).toBe("web");
    expect(built.scope.slice(1).sort()).toEqual(["api", "sdk"]);
    expect(built.ctx.primary.repoDir).toBe(webDir);
    const api = built.ctx.neighbors.find((n) => n.id === "api")!;
    expect(api.repoDir).toBe(apiDir);
    expect(api.relation).toContain("bergantung pada");
    expect(api.note).toBe("web memanggil /api/orders");
    expect(built.ctx.neighbors.find((n) => n.id === "sdk")!.repoDir).toBeNull();
  });

  it("null untuk project yang tak ada", async () => {
    expect(await buildCrossAuditCtx("hantu")).toBeNull();
  });
});

describe("POST /terminal/sessions {project, flow:'cross-audit'}", () => {
  it("melahirkan sesi lepas ber-worktree, tanpa flow/spec", async () => {
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect(id).toBe("xaudit-web");
    const s = getSession(id)!;
    expect(s.cwd).toContain("/.worktrees/xaudit-web");
    expect(existsSync(s.cwd)).toBe(true);
    expect(s.specId).toBeUndefined();
    expect(s.flow).toBeUndefined();       // sesi lepas tak menggerakkan stage apa pun
  });

  it("id deterministik: Start kedua menyambung, bukan melahirkan sesi baru", async () => {
    const a = (await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } })).json();
    expect(b.id).toBe(a.id);
    expect(listSessions().filter((s) => s.id === a.id)).toHaveLength(1);
  });

  it("kunci sesi memberi scope = project utama + tetangganya, dan tak bocor ke API", async () => {
    await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    const sessions = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
    expect(sessions.body).not.toContain("hnm_xa_");
    const key = tmuxOpt("hanoman-xaudit-web", "@hanoman_audit_key");
    expect(key).toMatch(/^hnm_xa_[0-9a-f]{32}$/);
    expect(auditSessionScope(key)!.sort()).toEqual(["api", "sdk", "web"]);
  });

  it("404 untuk project yang tak ada", async () => {
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "hantu", flow: "cross-audit" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("sesi backlog cross-audit", () => {
  it("lahir di worktree spec dengan kunci audit ber-scope tetangga", async () => {
    await prisma.spec.create({ data: {
      id: "SPEC-900", projectId: "web", title: "Audit integrasi web api", source: "cross-audit",
      stage: "brainstorming", priority: "tinggi", author: "Audit lintas · t@t", objective: "cek integrasi",
    } });
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-900", flow: "cross-audit" } });
    expect(r.statusCode).toBe(201);
    const s = getSession(r.json().id)!;
    expect(s.specId).toBe("SPEC-900");
    expect(s.flow).toBe("cross-audit");
    const projects = tmuxOpt(`hanoman-${s.id}`, "@hanoman_audit_projects");
    expect(projects.split(",").sort()).toEqual(["api", "sdk", "web"]);
  });
});

// SPEC-337 × SPEC-338 · kedua pintu cross-audit harus jalan di codex sama seperti di claude:
// agen ditentukan Setting.agent (sesi lepas, tanpa picker) atau override per sesi (backlog),
// dan kunci audit tetap sampai ke prosesnya — mekanisme env yang sama, agen berbeda.
describe("cross-audit di codex", () => {
  const setSetting = (patch: object) => {
    const data = { ...DEFAULT_SETTING, ...patch } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };
  // Layar pane = bukti argv + env: fixture mencetak keduanya lalu tetap hidup (`exec cat`).
  const paneOf = async (id: string): Promise<string> => {
    const socket = process.env.HANOMAN_TMUX_SOCKET ?? "hanoman";
    const read = () => execFileSync("tmux", ["-L", socket, "-f", "/dev/null",
      "capture-pane", "-p", "-J", "-S", "-2000", "-t", `hanoman-${id}`], { encoding: "utf8" })
      .replace(/\s+/g, " ").trim();
    for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
    return read();
  };

  it("sesi lepas mengikuti Setting.agent codex, lengkap dengan kunci audit ber-scope", async () => {
    process.env.HANOMAN_CODEX_BIN = resolve(import.meta.dirname, "fixtures/fake-agent-env.sh");
    await setSetting({ agent: "codex", codex: { model: "gpt-5.4", effort: "high" } });
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    expect(r.statusCode).toBe(201);

    const pane = await paneOf("xaudit-web");
    expect(pane).toContain("--dangerously-bypass-approvals-and-sandbox");   // jalur codex
    expect(pane).not.toContain("--dangerously-skip-permissions");
    expect(pane).toContain("-m gpt-5.4");
    // Kunci audit BENAR-BENAR sampai ke proses codex (env, bukan sekadar tmux option).
    expect(pane).toMatch(/HANOMAN_AUDIT_KEY=hnm_xa_[0-9a-f]{32}/);
    expect(pane).toContain("HANOMAN_AUDIT_URL=http://127.0.0.1:");
    expect(tmuxOpt("hanoman-xaudit-web", "@hanoman_agent")).toBe("codex");
    const key = tmuxOpt("hanoman-xaudit-web", "@hanoman_audit_key");
    expect(auditSessionScope(key)!.sort()).toEqual(["api", "sdk", "web"]);
  });

  it("sesi backlog cross-audit menerima override agen per sesi", async () => {
    process.env.HANOMAN_CODEX_BIN = resolve(import.meta.dirname, "fixtures/fake-agent-env.sh");
    await setSetting({ agent: "claude" });   // global claude — override sesi yang harus menang
    await prisma.spec.create({ data: {
      id: "SPEC-901", projectId: "web", title: "Audit integrasi web api", source: "cross-audit",
      stage: "brainstorming", priority: "tinggi", author: "Audit lintas · t@t", objective: "cek integrasi",
    } });
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-901", flow: "cross-audit", agent: "codex" } });
    expect(r.statusCode).toBe(201);

    const id = r.json().id;
    const pane = await paneOf(id);
    expect(pane).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(pane).toMatch(/HANOMAN_AUDIT_KEY=hnm_xa_[0-9a-f]{32}/);
    expect(tmuxOpt(`hanoman-${id}`, "@hanoman_agent")).toBe("codex");
    expect(tmuxOpt(`hanoman-${id}`, "@hanoman_audit_projects").split(",").sort()).toEqual(["api", "sdk", "web"]);
  });

  it("membuka gerbang trust codex untuk repo project utama", async () => {
    process.env.HANOMAN_CODEX_BIN = resolve(import.meta.dirname, "fixtures/fake-agent-env.sh");
    await setSetting({ agent: "codex" });
    await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "web", flow: "cross-audit" } });
    // CODEX_HOME diarahkan ke temp dir di beforeEach — config codex asli tak tersentuh.
    const cfg = readFileSync(`${process.env.CODEX_HOME}/config.toml`, "utf8");
    // Entri memakai REALPATH — itulah yang dicocokkan gerbang trust codex (lihat codex-trust.ts).
    expect(cfg).toContain(`[projects."${realpathSync(webDir)}"]`);
    expect(cfg).toContain('trust_level = "trusted"');
  });
});
