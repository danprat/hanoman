import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { _resetLimitsCache } from "../src/services/limits";

const here = dirname(fileURLToPath(import.meta.url));
const usage200 = JSON.parse(readFileSync(join(here, "fixtures/usage-200.json"), "utf8"));

// CLAUDE_CONFIG_DIR di-set → service pakai jalur berkas (bukan Keychain), deterministik lintas OS.
let dir: string;
function seedCreds(token: string | null) {
  dir = mkdtempSync(join(tmpdir(), "hanoman-creds-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  if (token !== null)
    writeFileSync(join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: token } }));
}
const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => usage200 });

beforeEach(() => { _resetLimitsCache(); });
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  vi.unstubAllGlobals();
});

describe("GET /api/limits", () => {
  it("maps limits[] on 200 → status ok", async () => {
    seedCreds("tok-fresh");
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.windows).toHaveLength(3);
    const byKey = Object.fromEntries(body.windows.map((w: any) => [w.key, w]));
    expect(byKey["session"].usedPct).toBe(19);
    expect(byKey["weekly_all"].usedPct).toBe(40);
    expect(byKey["weekly_all"].isActive).toBe(true);
    expect(byKey["weekly_scoped:Opus"].usedPct).toBe(23);
    expect(byKey["weekly_scoped:Opus"].label).toContain("Opus");
    expect(byKey["session"].severity).toBe("normal");
  });

  it("no credentials file → status unavailable, empty windows", async () => {
    seedCreds(null);
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    const body = res.json();
    expect(body.status).toBe("unavailable");
    expect(body.windows).toEqual([]);
    expect(body.fetchedAt).toBeNull();
  });

  it("TTL cache: two calls within 30s hit fetch once", async () => {
    seedCreds("tok");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildApp({ requireAuth: false });
    await app.inject({ method: "GET", url: "/api/limits" });
    await app.inject({ method: "GET", url: "/api/limits" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requireAuth: 401 without cookie", async () => {
    seedCreds("tok");
    vi.stubGlobal("fetch", okFetch());
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/limits" });
    expect(res.statusCode).toBe(401);
  });
});
