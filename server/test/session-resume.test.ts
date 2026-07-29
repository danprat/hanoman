import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { startSpecSession } from "../src/services/session-launch";
import { killAll, killSession, getSession, promptFilePath } from "../src/services/pty";
import { realGit } from "@hanoman/runner";

// SPEC-394 · ADR-0084 — "Lanjutkan" harus MELANJUTKAN. Alat ukur test ini adalah perbedaan dua
// binary palsu: fake-claude.sh TETAP HIDUP (`exec cat`), /bin/echo langsung keluar sehingga
// pane-nya `dead` (tmux `remain-on-exit on`). Pane mati tak bisa berubah jadi hidup tanpa spawn
// baru — itulah bukti yang tak bisa dipalsukan oleh bentuk respons.
const ALIVE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const DIES = "/bin/echo";

const clean = async () => {
  killAll();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: GIT_ENV });

/** Repo ber-origin bare + satu commit di `main`, ter-bind ke project `p`. */
async function seed(specId: string, stage = "planned") {
  const remote = mkdtempSync(join(tmpdir(), "hanoman394-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = mkdtempSync(join(tmpdir(), "hanoman394-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  g(dir, "commit", "-q", "--allow-empty", "-m", "root");
  g(dir, "branch", "-M", "main");
  g(dir, "remote", "add", "origin", remote);
  g(dir, "push", "-q", "origin", "main");
  await prisma.project.upsert({
    where: { id: "p" }, update: { repoDir: dir },
    create: { id: "p", name: "P", desc: "", kind: "existing", repoDir: dir },
  });
  const spec = await prisma.spec.create({ data: {
    id: specId, projectId: "p", title: "t", source: "qa", stage,
    author: "a", priority: "tinggi", objective: "o",
  } });
  return { dir, spec };
}

const waitExited = async (id: string) => {
  for (let i = 0; i < 200 && !getSession(id)?.exited; i++) await new Promise((r) => setTimeout(r, 20));
  return getSession(id)?.exited === true;
};

describe("SPEC-394 · pane mati bukan sesi hidup", () => {
  it("pane HIDUP tetap re-attach (ADR-0015), tanpa menyentuh apa pun", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { spec } = await seed("SPEC-L1");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const r2 = await startSpecSession(spec, { flow: "qa" });
    expect(r2).toEqual({ id: r1.id, reused: true });
    killSession(r1.id);
  });

  it("pane MATI dilahirkan ulang, bukan dikembalikan sebagai sesi", async () => {
    process.env.HANOMAN_CLAUDE_BIN = DIES;
    const { spec } = await seed("SPEC-L2");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    expect(await waitExited(r1.id)).toBe(true);

    process.env.HANOMAN_CLAUDE_BIN = ALIVE;   // sesi kedua hidup — pane mati tak bisa jadi hidup
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L2" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.reused).toBeFalsy();
    expect(getSession(r2.id)?.exited).toBe(false);
    killSession(r2.id);
  });
});

describe("SPEC-394 · resume dengan worktree utuh", () => {
  it("tak menghapus worktree, tak menulis ulang baseSha, dan mengirim prompt lanjutan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L3");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const wt = join(dir, ".worktrees", r1.id);
    const baseAwal = (await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } })).baseSha;

    // kerja setengah jalan: plan berkotak + berkas belum di-commit + fase tercatat
    mkdirSync(join(wt, "docs", "superpowers", "plans"), { recursive: true });
    writeFileSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"), "- [x] satu\n- [ ] dua\n");
    writeFileSync(join(wt, "belum-commit.txt"), "jangan hilang");
    writeFileSync(join(dir, ".worktrees", ".phases", r1.id), "Audit done\nSpec skipped\n");
    killSession(r1.id);   // pane hilang, worktree tetap (mis. mesin restart)

    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(r2.resumed).toBe(true);
    expect(existsSync(join(wt, "belum-commit.txt"))).toBe(true);
    expect(existsSync(join(wt, "docs", "superpowers", "plans", "spec-l3-plan.md"))).toBe(true);

    const after = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L3" } });
    expect(after.baseSha).toBe(baseAwal);

    const prompt = readFileSync(promptFilePath(r2.id), "utf8");
    expect(prompt).toContain("MELANJUTKAN");
    expect(prompt).toContain("Audit done");
    expect(prompt).toContain("Spec skipped");
    expect(prompt).toContain("Lanjutkan dari fase: Plan.");
    expect(prompt).toContain("belum di-commit");
    killSession(r2.id);
  });

  it("berkas fase tidak pernah ditulis server", async () => {
    process.env.HANOMAN_CLAUDE_BIN = ALIVE;
    const { dir, spec } = await seed("SPEC-L4");
    const r1 = await startSpecSession(spec, { flow: "qa" });
    const phaseFile = join(dir, ".worktrees", ".phases", r1.id);
    writeFileSync(phaseFile, "Audit done\n");
    killSession(r1.id);
    const fresh = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-L4" } });
    const r2 = await startSpecSession(fresh, { flow: "qa" });
    expect(readFileSync(phaseFile, "utf8")).toBe("Audit done\n");
    killSession(r2.id);
  });
});
