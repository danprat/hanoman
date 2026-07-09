import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeRun } from "./factory";

const app = buildApp();
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

describe("GET /runs/:id/changes (SPEC-144)", () => {
  let repo: string, base: string;
  beforeEach(async () => {
    await resetDb();
    ({ repo, base } = seedRepoWithWorktree());
    await makeProject({ id: "p1", repoDir: repo });
  });

  it("mengembalikan file dan commit milik run", async () => {
    await makeRun({ id: "RUN-1", projectId: "p1", worktree: ".worktrees/run-1", baseSha: base });
    const res = await app.inject({ url: "/api/runs/RUN-1/changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toContainEqual({ path: "baru.md", add: 2, del: 0, status: "A", binary: false });
  });

  it("run tak dikenal → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-999/changes" });
    expect(res.statusCode).toBe(404);
  });

  it("baseSha null → 200 kosong", async () => {
    await makeRun({ id: "RUN-2", projectId: "p1", worktree: ".worktrees/run-1", baseSha: null });
    const res = await app.inject({ url: "/api/runs/RUN-2/changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ base: null, head: null, commits: [], files: [] });
  });

  it("worktree hilang tanpa headSha → 409", async () => {
    await makeRun({ id: "RUN-3", projectId: "p1", worktree: ".worktrees/hantu", baseSha: base });
    const res = await app.inject({ url: "/api/runs/RUN-3/changes" });
    expect(res.statusCode).toBe(409);
  });

  it("headSha tak terjangkau → 409 yang menyebut sha-nya", async () => {
    await makeRun({ id: "RUN-4", projectId: "p1", worktree: ".worktrees/hantu",
      baseSha: base, headSha: "0".repeat(40) });
    const res = await app.inject({ url: "/api/runs/RUN-4/changes" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("0000000");
  });
});

describe("GET /runs/:id/changes/* (SPEC-144)", () => {
  let repo: string, base: string;
  beforeEach(async () => {
    await resetDb();
    ({ repo, base } = seedRepoWithWorktree());
    await makeProject({ id: "p1", repoDir: repo });
    await makeRun({ id: "RUN-1", projectId: "p1", worktree: ".worktrees/run-1", baseSha: base });
  });

  it("mengembalikan diff dan content", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/baru.md" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("satu\ndua\n");
    expect(res.json().diff).toContain("+satu");
  });

  it("file di luar daftar changes → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/keep.txt" });
    expect(res.statusCode).toBe(404);
  });

  it("path traversal → 404", async () => {
    const res = await app.inject({ url: "/api/runs/RUN-1/changes/../../etc/passwd" });
    expect([404, 400]).toContain(res.statusCode);
  });
});
