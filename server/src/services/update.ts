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
