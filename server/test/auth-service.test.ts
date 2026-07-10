import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, sessionId, newSessionToken } from "../src/services/auth";

describe("auth service", () => {
  it("hash round-trips and rejects wrong password", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("verify rejects malformed stored hash", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("sessionId is deterministic sha256 hex of token", () => {
    const t = newSessionToken();
    expect(sessionId(t)).toHaveLength(64);
    expect(sessionId(t)).toBe(sessionId(t));
    expect(sessionId(newSessionToken())).not.toBe(sessionId(t));
  });
});
