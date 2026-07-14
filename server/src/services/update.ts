import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { UpdateStatus, UpdateReason, UpdateRemoteStatus, UpdateCommit } from "@hanoman/shared";

export type UpdateInputs = {
  runningBuildSha: string | null;
  checkoutSha: string;
  branch: string | null;
  remoteStatus: UpdateRemoteStatus;
  behind: number;
  fetchedAt: string | null;
  newCommits: UpdateCommit[];
};

const PULL_CMD = "git pull --ff-only && pnpm build && pnpm prod";
const BUILD_CMD = "pnpm build && pnpm prod";

// Murni & deterministik: seluruh keputusan "update tersedia?" ada di sini, terpisah dari git
// (di-uji unit tanpa proses). runningBuildSha null (dev/belum stamp) → tak pernah stale.
export function composeUpdate(x: UpdateInputs): UpdateStatus {
  const currentSha = x.runningBuildSha ?? x.checkoutSha;
  const localStale = x.runningBuildSha != null && x.runningBuildSha !== x.checkoutSha;
  const behind = x.remoteStatus === "ok" ? Math.max(0, x.behind) : 0;
  const remoteBehind = behind > 0;
  const updateAvailable = localStale || remoteBehind;
  const reason: UpdateReason = !updateAvailable ? null
    : localStale && remoteBehind ? "both" : localStale ? "local" : "remote";
  const command = !updateAvailable ? "" : reason === "local" ? BUILD_CMD : PULL_CMD;
  return {
    currentSha, checkoutSha: x.checkoutSha, branch: x.branch,
    local: { stale: localStale },
    remote: { status: x.remoteStatus, behind, fetchedAt: x.fetchedAt },
    updateAvailable, reason, command,
    newCommits: remoteBehind ? x.newCommits : [],
  };
}

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const RESULT_TTL_MS = 15_000;
const FETCH_TTL_MS = 5 * 60_000;
const COMMIT_CAP = 20;

let cached: { at: number; value: UpdateStatus } | null = null;
let lastFetchAt = 0;

// Seam test: HANOMAN_REPO_ROOT menunjuk repo lain (atau non-repo → fail-safe).
function repoRoot(): string { return process.env.HANOMAN_REPO_ROOT ?? process.cwd(); }

// SHA build yang sedang jalan: server/dist/build-info.json (ditanam scripts/stamp-build.mjs).
// Server di-bundle esbuild → import.meta.url = server/dist/server.js, jadi file bersebelahan.
// Absen (dev / belum di-build) → null → composeUpdate menganggap tak stale.
function runningBuildSha(): string | null {
  try {
    const p = resolve(dirname(fileURLToPath(import.meta.url)), "build-info.json");
    return JSON.parse(readFileSync(p, "utf8"))?.sha ?? null;
  } catch { return null; }
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: root, ...GIT });
  return stdout.trim();
}

// Jaringan HANYA di sini, dan hanya bila opt-in (server.ts menyalakan di boot nyata; test tak pernah).
async function maybeFetch(root: string, branch: string): Promise<void> {
  if (process.env.HANOMAN_UPDATE_FETCH !== "1") return;
  if (Date.now() - lastFetchAt < FETCH_TTL_MS) return;
  lastFetchAt = Date.now();
  try { await exec("git", ["fetch", "origin", branch, "--quiet"], { cwd: root, timeout: 15_000, ...GIT }); }
  catch { /* offline / auth — biarkan; remote pakai ref origin yang ada */ }
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.value;
  const value = await compute();
  cached = { at: Date.now(), value };
  return value;
}

async function compute(): Promise<UpdateStatus> {
  const root = repoRoot();
  let checkoutSha = "", branch: string | null = null;
  try {
    checkoutSha = await git(root, ["rev-parse", "--short", "HEAD"]);
    const b = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    branch = b && b !== "HEAD" ? b : null;
  } catch {
    // bukan repo git / git absen → fail-safe: tak ada update yang bisa dipastikan
    return composeUpdate({ runningBuildSha: null, checkoutSha: "", branch: null,
      remoteStatus: "unavailable", behind: 0, fetchedAt: null, newCommits: [] });
  }
  let remoteStatus: UpdateRemoteStatus = "unavailable";
  let behind = 0; let newCommits: UpdateCommit[] = []; let fetchedAt: string | null = null;
  if (branch) {
    await maybeFetch(root, branch);
    try {
      const ref = `origin/${branch}`;
      await git(root, ["rev-parse", "--verify", "--quiet", ref]);   // throw bila ref tak ada
      remoteStatus = "ok";
      fetchedAt = lastFetchAt ? new Date(lastFetchAt).toISOString() : null;
      behind = Number(await git(root, ["rev-list", "--count", `HEAD..${ref}`])) || 0;
      if (behind > 0) {
        const log = await git(root, ["log", "--format=%h%x09%s", "-n", String(COMMIT_CAP), `HEAD..${ref}`]);
        newCommits = log ? log.split("\n").map((l) => {
          const [sha = "", ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") };
        }) : [];
      }
    } catch { remoteStatus = "unavailable"; behind = 0; newCommits = []; fetchedAt = null; }
  }
  return composeUpdate({ runningBuildSha: runningBuildSha(), checkoutSha, branch, remoteStatus, behind, fetchedAt, newCommits });
}

export function _resetUpdateCache(): void { cached = null; lastFetchAt = 0; }
