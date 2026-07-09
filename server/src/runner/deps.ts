import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeClaudeCliSession, realGit, type RunDeps } from "@hanoman/runner";

// The docs-verify CLI lives in a sibling workspace package, so its path must NOT be
// derived from process.cwd(): the dev worker runs from `server/` (`pnpm --filter ./server
// worker`), where `cwd/cli/dist/hanoman.js` does not exist — that was RUN-8801's real crash.
// Anchor on the committed workspace marker instead (robust to cwd and to src-vs-dist).
function repoRootFrom(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir; // not found: verifyViaCli then fails loud with a legible module-not-found
}
export function resolveCliEntry(startDir: string = process.cwd()): string {
  return join(repoRootFrom(startDir), "cli", "dist", "hanoman.js");
}
export type VerifyResult = { blocked: boolean; reason?: string; error?: string };

// docs-verify.ts ALWAYS writes JSON to stdout before returning its exit code, so a
// non-zero exit whose stdout is not JSON can only mean the tool crashed — never a
// legitimate stale-docs report. Keep the three cases apart.
export function classifyVerify(r: { status: number | null; stdout: string; stderr: string }): VerifyResult {
  if (r.status === 0) return { blocked: false };
  try {
    const j = JSON.parse(r.stdout);
    return { blocked: true, reason: (j.violations ?? []).map((v: any) => v.reason).join("; ") };
  } catch {
    return { blocked: true, error: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 500) };
  }
}

// A crashed guardrail tool can be transient (a doc read racing a write, a flaky spawn), so
// re-run the verify subprocess exactly once on a crash. Tool-level retry, NOT a BullMQ
// attempts bump (ADR-0005 stands). RUN-8801's crash was deterministic (the cwd-relative CLI
// path — see resolveCliEntry); this retry is defense-in-depth for genuinely transient ones.
export function retryOnCrash(run: () => VerifyResult): VerifyResult {
  const first = run();
  return first.error !== undefined ? run() : first;
}

export function verifyViaCli(cwd: string): VerifyResult {
  const cli = resolveCliEntry();
  const run = () => classifyVerify(
    spawnSync("node", [cli, "docs", "verify", "--block-if-stale", "--json"], { cwd, encoding: "utf8" }),
  );
  return retryOnCrash(run);
}
// Quoted: resolveCliEntry can sit under a path with spaces, and hook commands are shell-run.
export const guardCommand = () => `node "${resolveCliEntry()}" hook pretooluse`;
export const prodDeps: RunDeps = {
  openSession: makeClaudeCliSession({ guardCommand: guardCommand() }),
  git: realGit, verify: verifyViaCli,
};
