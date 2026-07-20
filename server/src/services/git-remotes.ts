import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24, encoding: "utf8" as const };

// SPEC-233 · integrasi git graph: kelola remote, turunkan URL "Create Pull Request" dari remote URL.
export type Remote = { name: string; fetch: string; push: string };
export type OpResult = { ok: boolean; error?: string };

// Ekstrak host/owner/repo dari URL remote (ssh `git@host:owner/repo.git` atau https).
function parseRemote(url: string): { host: string; slug: string } | null {
  let m = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(url);
  if (!m) m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (!m || !m[2]) return null;
  return { host: m[1]!, slug: m[2] };
}

// URL halaman "buat pull/merge request" untuk github/gitlab/bitbucket; provider tak dikenal → null.
export function prUrl(remoteUrl: string, branch: string, base = "main"): string | null {
  const p = parseRemote(remoteUrl);
  if (!p) return null;
  const b = encodeURIComponent(branch), base2 = encodeURIComponent(base);
  if (p.host.includes("github.")) return `https://${p.host}/${p.slug}/compare/${base}...${branch}?expand=1`;
  if (p.host.includes("gitlab.")) return `https://${p.host}/${p.slug}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}`;
  if (p.host.includes("bitbucket.")) return `https://${p.host}/${p.slug}/pull-requests/new?source=${b}&dest=${base2}`;
  return null;
}

export async function listRemotes(repoDir: string | null): Promise<Remote[]> {
  if (!repoDir || !existsSync(repoDir)) return [];
  try {
    const { stdout } = await exec("git", ["remote", "-v"], { cwd: repoDir, ...GIT });
    const map = new Map<string, Remote>();
    for (const line of stdout.split("\n").filter(Boolean)) {
      const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
      if (!m) continue;
      const r = map.get(m[1]!) ?? { name: m[1]!, fetch: "", push: "" };
      r[m[3] as "fetch" | "push"] = m[2]!;
      map.set(m[1]!, r);
    }
    return [...map.values()];
  } catch { return []; }
}

const runRemote = async (repoDir: string, args: string[]): Promise<OpResult> => {
  try { await exec("git", args, { cwd: repoDir, ...GIT }); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as { stderr?: string }).stderr ?? String(e) }; }
};

export const addRemote = (repoDir: string, name: string, url: string) =>
  runRemote(repoDir, ["remote", "add", "--end-of-options", name, url]);
export const setRemoteUrl = (repoDir: string, name: string, url: string) =>
  runRemote(repoDir, ["remote", "set-url", "--end-of-options", name, url]);
export const removeRemote = (repoDir: string, name: string) =>
  runRemote(repoDir, ["remote", "remove", "--end-of-options", name]);
