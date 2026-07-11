import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getLimits, _resetLimitsCache } from "../src/services/limits";

const here = dirname(fileURLToPath(import.meta.url));
const usage200 = JSON.parse(readFileSync(join(here, "fixtures/usage-200.json"), "utf8"));
let dir: string;

beforeEach(() => {
  _resetLimitsCache();
  dir = mkdtempSync(join(tmpdir(), "hanoman-creds-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  writeFileSync(join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "tok" } }));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getLimits", () => {
  it("after a success, a later 401 (past TTL) yields stale with last windows", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => usage200 })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    expect((await getLimits()).status).toBe("ok");
    vi.advanceTimersByTime(31_000);                 // lewati TTL 30s → fetch ulang
    const dto = await getLimits();
    expect(dto.status).toBe("stale");
    expect(dto.windows).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
