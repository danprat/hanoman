import { describe, it, expect } from "vitest";
import { compareSemver } from "../src/semver";

describe("compareSemver", () => {
  it("major/minor/patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);   // numerik, bukan leksikal
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  it("prefix v ditoleransi", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });
  it("rilis stabil > prerelease", () => {
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
  });
  it("versi tak terbaca → 0 (fail-safe: jangan pernah mengaku ada update)", () => {
    expect(compareSemver("latest", "1.0.0")).toBe(0);
    expect(compareSemver("", "")).toBe(0);
  });
});
