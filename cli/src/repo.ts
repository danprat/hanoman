import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "./config";
export function resolveRepo(cwd: string) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = r.status === 0 ? r.stdout.trim() : cwd;
  const { docsDir } = loadConfig(root);
  return { root, docsDir, indexPath: join(root, docsDir, "README.md") };
}
