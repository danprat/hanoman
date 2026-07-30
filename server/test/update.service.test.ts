import { describe, it, expect, beforeEach } from "vitest";
import { getUpdateStatus, runningVersion, _resetUpdateCache } from "../src/services/update";

describe("getUpdateStatus", () => {
  beforeEach(() => _resetUpdateCache());

  it("HANOMAN_UPDATE_FETCH=0 → nol jaringan, fail-safe tanpa melempar", async () => {
    const u = await getUpdateStatus();
    expect(u.updateAvailable).toBe(false);
    expect(u.registry.status).toBe("unavailable");
    expect(u.latestVersion).toBeNull();
    expect(u.registry.checkedAt).toBeNull();
  });
  it("currentVersion selalu terisi semver", async () => {
    expect((await getUpdateStatus()).currentVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("hasil di-cache dalam TTL (identitas objek sama)", async () => {
    expect(await getUpdateStatus()).toBe(await getUpdateStatus());
  });
  it("runningVersion fallback aman", () => {
    expect(runningVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
