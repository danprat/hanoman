import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
export async function makeRepo(opts: {
  files?: Record<string, string>; docs?: Record<string, string>; index?: string; git?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hanoman-"));
  const write = (rel: string, content: string) => {
    const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
  };
  write("internal/docs/README.md", opts.index ?? "# index\n");
  for (const [p, c] of Object.entries(opts.docs ?? {})) write(join("internal/docs", p), c);
  for (const [p, c] of Object.entries(opts.files ?? {})) write(p, c);
  if (opts.git !== false) {
    spawnSync("git", ["init", "-q"], { cwd: root });
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
    spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  }
  return { root };
}
