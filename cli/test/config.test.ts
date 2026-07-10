import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";
import { makeRepo } from "./_fixture";
describe("config", () => {
  it("returns the default docsDir when no config file", async () => {
    const { root } = await makeRepo({});
    expect(loadConfig(root).docsDir).toBe("internal/docs");
  });
  it("reads docsDir from hanoman.config.json", async () => {
    const { root } = await makeRepo({ files: { "hanoman.config.json": JSON.stringify({ docsDir: "docs" }) } });
    expect(loadConfig(root).docsDir).toBe("docs");
  });
});
