import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";
import { makeRepo } from "./_fixture";
describe("config", () => {
  it("returns defaults when no config file", async () => {
    const { root } = await makeRepo({});
    expect(loadConfig(root)).toEqual({ docsDir: "internal/docs", requireLinks: true, blockStale: true, coverageThreshold: 100 });
  });
  it("merges overrides from hanoman.config.json", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ coverageThreshold: 80 }) } });
    expect(loadConfig(root).coverageThreshold).toBe(80);
  });
  // Switch guardrail dashboard sampai ke sini lewat env (worker → subprocess verify).
  it("env overrides the repo config", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ requireLinks: true }) } });
    const c = loadConfig(root, { HANOMAN_REQUIRE_LINKS: "false", HANOMAN_BLOCK_STALE: "false", HANOMAN_COVERAGE_THRESHOLD: "0" });
    expect(c).toMatchObject({ requireLinks: false, blockStale: false, coverageThreshold: 0 });
  });
  // Env yang tak diset tidak boleh menimpa file jadi `undefined` (zod lalu memulihkan default `true`).
  it("an unset env var leaves a false from the config file alone", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ requireLinks: false }) } });
    expect(loadConfig(root, {}).requireLinks).toBe(false);
  });
});
