import { spawnSync } from "node:child_process";
const DOC_PREFIXES = ["internal/docs/", "internal/skills/", "AGENTS.md", "CLAUDE.md", "README.md"];
const IMPL_PREFIXES = ["src/"];
export function changedPaths(root: string): string[] {
  const r = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return [];
  // Porcelain v1: fixed 3-col prefix "XY " then path. Slice the RAW line's prefix
  // first, THEN trim — the python hook trimmed first, which ate the leading space of
  // a worktree-modified status (" M path") and corrupted the path. See git.test.ts.
  return r.stdout.split("\n").map((l) => l.replace(/\s+$/, "")).filter(Boolean).map((line) => {
    let p = line.length > 3 ? line.slice(3) : line;
    if (p.includes(" -> ")) p = p.split(" -> ")[1]!;
    return p;
  });
}
export function freshnessViolation(paths: string[]): boolean {
  const impl = paths.some((p) => IMPL_PREFIXES.some((x) => p.startsWith(x)));
  const docs = paths.some((p) => DOC_PREFIXES.some((x) => p.startsWith(x)));
  return impl && !docs;
}
