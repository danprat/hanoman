import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/db";
import { startSpecSession, LaunchError, sessionIdForSpec } from "../src/services/session-launch";
import { killAll, killSession } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";
import { resolveGoalCondition } from "@hanoman/runner";

const clean = async () => {
  killAll();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("session-launch", () => {
  it("sessionIdForSpec sanitizes to tmux-safe id", () => {
    expect(sessionIdForSpec("SPEC-12")).toBe("spec-12");
  });
  it("throws LaunchError needs-bind when the project has no local checkout", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); // repoDir null
    const spec = await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "" } });
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "needs-bind" });
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.baseSha).toBeNull(); // tak menyentuh baseSha
  });

  // SPEC-332 · ADR-0073 · resolusi mode goal: override per sesi → template global → default bawaan.
  // Bukti diambil dari argv pane tmux — di situlah `--settings` (berisi hook Stop) benar-benar ada.
  async function seedRepo(id: string) {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-goal-"));
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "root"], { env });
    await prisma.project.upsert({
      where: { id: "pg" },
      update: { repoDir: dir },
      create: { id: "pg", name: "PG", desc: "", kind: "existing", repoDir: dir },
    });
    return prisma.spec.create({ data: { id, projectId: "pg", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "o" } });
  }
  // `#{pane_start_command}` DIPOTONG tmux ("…") untuk argv panjang — kondisi goal bawaan jauh
  // melewatinya. Baca layar pane-nya saja: HANOMAN_CLAUDE_BIN=/bin/echo mencetak argv utuh, dan
  // `remain-on-exit` menahan pane mati tetap terbaca (pola yang sama dipakai pty.attach).
  const argvOf = async (id: string): Promise<string> => {
    const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
      "-f", "/dev/null", "capture-pane", "-p", "-J", "-S", "-2000", "-t", "hanoman-" + id],
      { encoding: "utf8" }).replace(/\s+/g, " ").trim();
    for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
    return read();
  };
  // Baris Setting harus LENGKAP: `zSetting` mewajibkan autoDefault/autoScaffold/notifyFail (tanpa
  // .default()), jadi objek parsial gagal parse dan getSetting diam-diam jatuh ke DEFAULT_SETTING.
  const setGoal = (goal: { enabled: boolean; condition: string }) => {
    const data = { ...DEFAULT_SETTING, goal } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  it("Setting.goal mati & tanpa override → sesi lahir tanpa hook Stop", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-G1");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).not.toContain('"type":"prompt"');
    killSession(r.id);
  });

  it("goal:true memakai template global; goalCondition per sesi menang atasnya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: false, condition: "TEMPLATE-GLOBAL" });
    const spec = await seedRepo("SPEC-G2");
    const r = await startSpecSession(spec, { flow: "feature", goal: true });
    expect(await argvOf(r.id)).toContain("TEMPLATE-GLOBAL");
    killSession(r.id);

    const spec2 = await seedRepo("SPEC-G3");
    const r2 = await startSpecSession(spec2, { flow: "feature", goal: true, goalCondition: "KONDISI-SESI" });
    const argv = await argvOf(r2.id);
    expect(argv).toContain("KONDISI-SESI");
    expect(argv).not.toContain("TEMPLATE-GLOBAL");
    killSession(r2.id);
  });

  it("Setting.goal menyala → sesi tanpa override tetap membawa hook Stop (jalur scheduler)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: true, condition: "" });
    const spec = await seedRepo("SPEC-G5");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    const argv = await argvOf(r.id);
    expect(argv).toContain('"type":"prompt"');
    expect(argv).toContain("Sesi backlog hanoman SPEC-G5");         // kondisi DoD bawaan
    killSession(r.id);
  });

  it("goal:false mengalahkan Setting global yang menyala", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: true, condition: "" });
    const spec = await seedRepo("SPEC-G4");
    const r = await startSpecSession(spec, { flow: "feature", goal: false });
    expect(await argvOf(r.id)).not.toContain('"type":"prompt"');
    killSession(r.id);
  });

  it("kondisi default menyebut branch sesi", () => {
    expect(resolveGoalCondition({ flow: "feature", specId: "SPEC-G6", branchTo: "hanoman/spec-g6" }))
      .toContain("hanoman/spec-g6");
  });

  // SPEC-338 · ADR-0074 · agen per sesi & default global. Bukti dari argv pane, sama seperti
  // mode goal di atas — di situlah pilihan agen benar-benar mewujud.
  const setSetting = (patch: object) => {
    const data = { ...DEFAULT_SETTING, ...patch } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  it("opts.agent codex melahirkan sesi codex dengan flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    // SPEC-339 · slug dari katalog yang masih hidup: `gpt-5.4` kini diremap ke gpt-5.5 saat dibaca.
    await setSetting({ codex: { model: "gpt-5.6-terra", effort: "high" } });
    const spec = await seedRepo("SPEC-A1");
    const r = await startSpecSession(spec, { flow: "feature", agent: "codex" });
    const argv = await argvOf(r.id);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    killSession(r.id);
  });

  it("tanpa opts.agent memakai Setting.agent (jalur scheduler)", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A2");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    expect(await argvOf(r.id)).toContain("--dangerously-bypass-approvals-and-sandbox");
    killSession(r.id);
  });

  it("override model per sesi menang atas default agen", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A3");
    const r = await startSpecSession(spec, { flow: "feature", model: "gpt-5.4-mini" });
    expect(await argvOf(r.id)).toContain("-m gpt-5.4-mini");
    killSession(r.id);
  });

  // SPEC-376 · ADR-0080 · scope verifikasi. Env sesi dipasang sebagai PREFIX shell di depan argv
  // (`K=V … claude …`), jadi ia TIDAK ikut tercetak oleh /bin/echo yang hanya melihat argv-nya
  // sendiri. Satu-satunya bukti jujur adalah membacanya dari DALAM proses — itulah gunanya
  // fixtures/fake-agent-env.sh (pola SPEC-337 untuk kunci audit lintas).
  it("sesi lahir membawa env HANOMAN_BASE_SHA & HANOMAN_VERIFY_SCOPE, default changed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = resolve(import.meta.dirname, "fixtures/fake-agent-env.sh");
    const spec = await seedRepo("SPEC-V1");
    const r = await startSpecSession(spec, { flow: "feature" });
    const pane = await argvOf(r.id);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-V1" } });
    expect(row!.baseSha).toBeTruthy();
    expect(pane).toContain("Scope verifikasi");                     // klausa masuk ke prompt
    expect(pane).toContain(`HANOMAN_BASE_SHA=${row!.baseSha}`);     // = commit lahirnya worktree
    expect(pane).toContain("HANOMAN_VERIFY_SCOPE=changed");         // default global
    killSession(r.id);
  });

  it("Setting.verifyScope full → sesi tanpa override tak membawa klausa (jalur scheduler)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V2");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    expect(await argvOf(r.id)).not.toContain("Scope verifikasi");
    killSession(r.id);
  });

  it("override per sesi menang atas Setting global", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V3");
    const r = await startSpecSession(spec, { flow: "feature", verifyScope: "changed" });
    expect(await argvOf(r.id)).toContain("Scope verifikasi");
    killSession(r.id);
  });

  it("Setting.agent codex tak menyeret sesi claude eksplisit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A4");
    const r = await startSpecSession(spec, { flow: "feature", agent: "claude" });
    const argv = await argvOf(r.id);
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).toContain("--model claude-opus-5");   // kembali ke blok model claude
    killSession(r.id);
  });
});
