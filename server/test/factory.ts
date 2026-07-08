import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { DEFAULT_SETTING } from "../src/services/settings";
import type { Setting } from "@hanoman/shared";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
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

// Truncate every table in FK-safe order (mirrors the deleted seed()).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.docFile.deleteMany(), prisma.trigger.deleteMany(), prisma.run.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
  ]);
}

export function makeProject(over: Partial<Prisma.ProjectCreateManyInput> = {}) {
  return prisma.project.create({ data: {
    id: "p1", name: "p1", desc: "test project", kind: "existing",
    stack: "", docStatus: "ok", coverage: 100, ...over } });
}

export function makeSpec(over: Partial<Prisma.SpecCreateManyInput> = {}) {
  return prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "test spec", source: "brief",
    stage: "planned", author: "Rangga", priority: "sedang", objective: "", ...over } });
}

export function makeRun(over: Partial<Prisma.RunCreateManyInput> = {}) {
  return prisma.run.create({ data: {
    id: "RUN-1", projectId: "p1", specId: null, kind: "feature", status: "running",
    trigger: "commit", triggerDetail: "push → main",
    phases: [
      { name: "Brainstorm", state: "done" }, { name: "Objective", state: "done" },
      { name: "Spec", state: "done" }, { name: "Plan", state: "done" },
      { name: "Execute", state: "active" },
    ] as unknown as Prisma.InputJsonValue,
    plan: [] as unknown as Prisma.InputJsonValue,
    files: [] as unknown as Prisma.InputJsonValue,
    log: [] as unknown as Prisma.InputJsonValue,
    worktree: ".worktrees/run-1", branchFrom: "main", branchTo: "hanoman/run-1",
    model: "claude-opus-4-8", tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
    ...over } });
}

export function makeTrigger(over: Partial<Prisma.TriggerCreateManyInput> = {}) {
  return prisma.trigger.create({ data: {
    id: "t1", projectId: "p1", type: "commit", detail: "push → main",
    target: "plan + execute", enabled: true, ...over } });
}

export function makeDocFile(over: Partial<Prisma.DocFileCreateManyInput> = {}) {
  return prisma.docFile.create({ data: {
    projectId: "p1", path: "product/prd.md", category: "product",
    content: "# prd", linked: true, root: false, ...over } });
}

export function makeSetting(over: Partial<Setting> = {}) {
  const data = { ...DEFAULT_SETTING, ...over } as unknown as Prisma.InputJsonValue;
  return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}
