import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { installationToken } from "./app";

type CloneProject = { repoDir?: string | null; repoUrl?: string | null; installationId?: number | null };

// Clone a github-backed repo into `repoDir` if it's not already there, using a
// short-lived installation token in the remote URL. The token is minted per
// call and redacted from any error output so it never reaches logs.
export async function ensureClone(
  project: CloneProject,
  tokenFn: (installationId: number) => Promise<string> = installationToken,
): Promise<void> {
  const { repoDir, repoUrl, installationId } = project;
  if (!repoDir || existsSync(repoDir)) return; // local run or already cloned
  if (!repoUrl || installationId == null) throw new Error("ensureClone needs repoUrl + installationId");
  const token = await tokenFn(installationId);
  const url = `https://x-access-token:${token}@github.com/${repoUrl}.git`;
  const r = spawnSync("git", ["clone", url, repoDir], { encoding: "utf8" });
  if (r.status !== 0) {
    const safe = (s: string) => (s || "").split(token).join("***");
    throw new Error(`git clone ${repoUrl} failed: ${safe(r.stderr || r.stdout)}`);
  }
}
