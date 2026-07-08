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
});
