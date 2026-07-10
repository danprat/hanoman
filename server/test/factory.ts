import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { DEFAULT_SETTING } from "../src/services/settings";
import type { Setting } from "@hanoman/shared";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Fresh git repo seeded with { relPath: content }. Files are untracked-but-not-ignored,
// which `git ls-files --others --exclude-standard` lists — no commit needed.
export function makeTempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-doc-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

// Git repo dengan satu commit + branch tambahan (SPEC-143). `for-each-ref refs/heads` butuh
// commit: repo yang baru di-init belum punya branch apa pun, jadi makeTempRepo tak cukup.
export function makeRepoWithBranches(...branches: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-branch-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x"); g("add", "-A"); g("commit", "-qm", "init");
  g("branch", "-M", "main");
  for (const b of branches) g("branch", b);
  return dir;
}

// Repo dengan satu commit `main` (base) + worktree `.worktrees/<id>` detached di main,
// lalu `changes` diterapkan di worktree TANPA commit (persis keadaan sesi yang bekerja).
// value null = hapus file yang ada di base. Mengembalikan repoDir. (SPEC-171)
export function makeRepoWithWorktree(specId: string, base: Record<string, string>, changes: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
  const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
  g(dir, "init", "-q"); g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  for (const [rel, content] of Object.entries(base)) {
    const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "base"); g(dir, "branch", "-M", "main");
  const id = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const wt = join(dir, ".worktrees", id);
  g(dir, "worktree", "add", "--detach", "-q", wt, "main");
  for (const [rel, content] of Object.entries(changes)) {
    const abs = join(wt, rel);
    if (content === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  return dir;
}

// Truncate every table in FK-safe order (mirrors the deleted seed()).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
    prisma.vps.deleteMany(),
  ]);
}

export function makeVps(over: Partial<Prisma.VpsCreateInput> = {}) {
  return prisma.vps.create({ data: {
    name: "vps1", host: "203.0.113.10", user: "deploy", ...over } });
}

export function makeProject(over: Partial<Prisma.ProjectCreateManyInput> = {}) {
  return prisma.project.create({ data: {
    id: "p1", name: "p1", desc: "test project", kind: "existing",
    stack: "", ...over } });
}

export function makeSpec(over: Partial<Prisma.SpecCreateManyInput> = {}) {
  return prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "test spec", source: "brief",
    stage: "planned", author: "Rangga", priority: "sedang", objective: "", ...over } });
}

export function makeSetting(over: Partial<Setting> = {}) {
  const data = { ...DEFAULT_SETTING, ...over } as unknown as Prisma.InputJsonValue;
  return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}
