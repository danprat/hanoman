import { describe, it, expect } from "vitest";
import { generateIngestKey, hashKey, verifyKey, dsnUrl } from "./ingest-key";

describe("ingest-key", () => {
  it("generates a prefixed key + matching hash + prefix hint", () => {
    const { key, hash, prefix } = generateIngestKey();
    expect(key).toMatch(/^hnm_ing_[a-f0-9]{32,}$/);
    expect(hashKey(key)).toBe(hash);
    expect(prefix.length).toBeLessThanOrEqual(16);
    expect(key.startsWith(prefix)).toBe(true);
  });

  it("verifies correct key and rejects wrong/empty/null", () => {
    const { key, hash } = generateIngestKey();
    expect(verifyKey(key, hash)).toBe(true);
    expect(verifyKey("hnm_ing_wrong", hash)).toBe(false);
    expect(verifyKey("", hash)).toBe(false);
    expect(verifyKey(key, null)).toBe(false);
  });

  it("builds a Sentry-style DSN url with the key in the query", () => {
    const url = dsnUrl("my-project", "hnm_ing_abc", "https://hanoman.example/");
    expect(url).toBe("https://hanoman.example/api/ingest/my-project?key=hnm_ing_abc");
  });
});
