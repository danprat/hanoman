import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";

// resolveCliEntry MASIH dipakai — menyusun perintah hook PreToolUse (deny perintah berbahaya,
// ADR-0010), BUKAN guardrail Source of Truth (dicabut, SPEC-160). Path CLI tak boleh diturunkan
// dari process.cwd() (dev worker jalan dari server/); jangkar ke marker workspace.
function repoRootFrom(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
export function resolveCliEntry(startDir: string = process.cwd()): string {
  return join(repoRootFrom(startDir), "cli", "dist", "hanoman.js");
}
// Quoted: resolveCliEntry can sit under a path with spaces, and hook commands are shell-run.
export const guardCommand = () => `node "${resolveCliEntry()}" hook pretooluse`;
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: guardCommand() }),
  git: realGit,
};
