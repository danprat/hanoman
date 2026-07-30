import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app";
import { _resetUpdateCache } from "../src/services/update";

// SPEC-398 · ADR-0087 · tak ada lagi repo git palsu yang perlu disiapkan: statusnya semver +
// registry npm, dan vitest.config memaksa HANOMAN_UPDATE_FETCH=0 → nol jaringan.
beforeEach(() => _resetUpdateCache());
afterEach(() => _resetUpdateCache());

describe("GET /api/update", () => {
  it("balas 200 + shape valid; fail-safe tanpa jaringan", async () => {
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ updateAvailable: false, command: "", latestVersion: null });
    expect(b.registry.status).toBe("unavailable");
    expect(b.currentVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("401 tanpa cookie saat requireAuth", async () => {
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(401);
  });
});
