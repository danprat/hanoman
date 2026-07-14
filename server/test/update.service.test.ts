import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUpdateStatus, _resetUpdateCache } from "../src/services/update";

let dir = "";
beforeEach(() => { _resetUpdateCache(); delete process.env.HANOMAN_UPDATE_FETCH; });
afterEach(() => {
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ""; }
  delete process.env.HANOMAN_REPO_ROOT; _resetUpdateCache();
});

describe("getUpdateStatus", () => {
  it("root bukan repo git → fail-safe: updateAvailable false, tak melempar", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-norepo-"));
    process.env.HANOMAN_REPO_ROOT = dir;
    const u = await getUpdateStatus();
    expect(u.updateAvailable).toBe(false);
    expect(u.remote.status).toBe("unavailable");
  });
  it("repo git tanpa origin → checkoutSha terisi, remote unavailable, tanpa jaringan", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
    process.env.HANOMAN_REPO_ROOT = dir;
    const u = await getUpdateStatus();
    expect(u.checkoutSha).toMatch(/^[0-9a-f]{7,}$/);
    expect(u.remote.status).toBe("unavailable");
    expect(u.updateAvailable).toBe(false);
  });
  it("cache 15s: dua panggilan berturut pakai hasil sama", async () => {
    dir = mkdtempSync(join(tmpdir(), "hanoman-cache-"));
    process.env.HANOMAN_REPO_ROOT = dir;
    const a = await getUpdateStatus();
    const b = await getUpdateStatus();
    expect(b).toBe(a);   // referensi identik = cache hit
  });
});
