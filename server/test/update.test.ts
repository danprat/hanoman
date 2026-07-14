import { describe, it, expect } from "vitest";
import { composeUpdate } from "../src/services/update";

const base = {
  runningBuildSha: "aaaaaaa", checkoutSha: "aaaaaaa", branch: "main",
  remoteStatus: "ok" as const, behind: 0, fetchedAt: "2026-07-14T00:00:00Z", newCommits: [],
};
describe("composeUpdate", () => {
  it("up-to-date → updateAvailable false, reason null, tanpa command", () => {
    const u = composeUpdate(base);
    expect(u.updateAvailable).toBe(false); expect(u.reason).toBeNull(); expect(u.command).toBe("");
  });
  it("build lama dari checkout → local, command build+prod", () => {
    const u = composeUpdate({ ...base, runningBuildSha: "old1234", checkoutSha: "new5678" });
    expect(u.reason).toBe("local"); expect(u.local.stale).toBe(true);
    expect(u.command).toBe("pnpm build && pnpm prod");
  });
  it("origin di depan → remote, command pull, newCommits diteruskan", () => {
    const u = composeUpdate({ ...base, behind: 3, newCommits: [{ sha: "c1", subject: "x" }] });
    expect(u.reason).toBe("remote"); expect(u.remote.behind).toBe(3); expect(u.newCommits).toHaveLength(1);
    expect(u.command).toBe("git pull --ff-only && pnpm build && pnpm prod");
  });
  it("lokal stale + origin ahead → both", () => {
    const u = composeUpdate({ ...base, runningBuildSha: "old", checkoutSha: "new", behind: 2 });
    expect(u.reason).toBe("both");
    expect(u.command).toBe("git pull --ff-only && pnpm build && pnpm prod");
  });
  it("remote unavailable → behind diabaikan, newCommits dibuang", () => {
    const u = composeUpdate({ ...base, remoteStatus: "unavailable", behind: 5, newCommits: [{ sha: "c", subject: "s" }] });
    expect(u.remote.behind).toBe(0); expect(u.updateAvailable).toBe(false); expect(u.newCommits).toEqual([]);
  });
  it("dev tanpa build-info (runningBuildSha null) → tak pernah stale, currentSha = checkout", () => {
    const u = composeUpdate({ ...base, runningBuildSha: null, checkoutSha: "zzz" });
    expect(u.local.stale).toBe(false); expect(u.currentSha).toBe("zzz");
  });
});
