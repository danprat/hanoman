import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Jangkar ke marker workspace: path tak boleh diturunkan dari process.cwd() (dev worker
// jalan dari server/). Dipakai repoRoot untuk menemukan script VPS (SPEC-164).
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
// SPEC-164: script vps dibaca dari <root>/server/scripts/vps — jangkar yang sama.
export const repoRoot = (startDir: string = process.cwd()): string => repoRootFrom(startDir);
