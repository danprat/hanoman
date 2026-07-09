import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun, makeTempRepo, makeSetting } from "./factory";
import { prisma } from "../src/db";

const app = buildApp();
const cmd = (id: string, text: string) =>
  app.inject({ method: "POST", url: `/api/runs/${id}/command`, payload: { text } });

const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepoWithWorktree(): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "changes-route-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "keep.txt"), "a\n");
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base"); g(repo, "branch", "-M", "main");
  const base = g(repo, "rev-parse", "HEAD").stdout.trim();
  const wt = join(repo, ".worktrees", "run-1");
  g(repo, "worktree", "add", "--detach", wt, base);       // dari kode, bukan Bash tool
  writeFileSync(join(wt, "baru.md"), "satu\ndua\n");
  return { repo, base };
}

describe("run terminal command routing (SPEC-008)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeSetting();                                  // steps/maxConcurrent for enqueue
    await makeProject({ id: "p1", repoDir: process.cwd() });
  });

  it("resume re-enqueues (no fabricated line)", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "paused" });
    const res = await cmd("RUN-1", "resume");
    const lines = res.json().lines as { t: string; s: string }[];
    // truthful: re-enqueued, not the old canned "dilanjutkan oleh manusia"
    expect(lines.some((l) => /enqueue/i.test(l.s))).toBe(true);
    expect(lines.some((l) => l.s === "dilanjutkan oleh manusia")).toBe(false);
  });

  it("free text on an active run is steered, not answered by a fake Claude", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    const res = await cmd("RUN-1", "tolong pakai queue yang ada");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /diteruskan ke run/i.test(l.s))).toBe(true);
    expect(lines.some((l) => /^claude: /.test(l.s))).toBe(false);   // no fabricated reply
  });

  it("free text on an inactive run says the run is not active", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "done" });
    const res = await cmd("RUN-1", "apa kabar");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => /tidak aktif/i.test(l.s))).toBe(true);
  });

  it("docs <path> reflects a real file", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", status: "running" });
    const repo = makeTempRepo({ "product/prd.md": "a\nb\nc" });
    await prisma.project.update({ where: { id: "p1" }, data: { repoDir: repo } });
    const hit = (await cmd("RUN-1", "docs product/prd.md")).json().lines as { t: string; s: string }[];
    expect(hit.some((l) => l.t === "✓" && /product\/prd\.md/.test(l.s))).toBe(true);
    const miss = (await cmd("RUN-1", "docs nope/x.md")).json().lines as { t: string; s: string }[];
    expect(miss.some((l) => l.t === "✗")).toBe(true);
  });

  it("verb diff merender file yang benar-benar berubah", async () => {
    const { repo, base } = seedRepoWithWorktree();
    await makeProject({ id: "p2", repoDir: repo });
    await makeRun({ id: "RUN-2", projectId: "p2", worktree: ".worktrees/run-1", baseSha: base });
    const res = await cmd("RUN-2", "diff");
    const lines = res.json().lines as { t: string; s: string }[];
    expect(lines.some((l) => l.s.includes("baru.md"))).toBe(true);
    expect(lines.some((l) => l.s === "belum ada file berubah")).toBe(false);
  });
});
