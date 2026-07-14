import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { _resetUpdateCache } from "../src/services/update";

let dir = "";
beforeEach(() => { _resetUpdateCache(); dir = mkdtempSync(join(tmpdir(), "hanoman-upd-")); process.env.HANOMAN_REPO_ROOT = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HANOMAN_REPO_ROOT; _resetUpdateCache(); });

describe("GET /api/update", () => {
  it("balas 200 + shape valid; fail-safe saat root bukan repo", async () => {
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ updateAvailable: false, reason: null });
    expect(b.remote.status).toBe("unavailable");
    expect(Array.isArray(b.newCommits)).toBe(true);
  });
  it("401 tanpa cookie saat requireAuth", async () => {
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(401);
  });
});
