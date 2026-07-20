import { describe, it, expect } from "vitest";
import { normalizeMessage, topFrame, fingerprint } from "./error-fingerprint";

describe("error-fingerprint", () => {
  it("normalizes volatile tokens so numeric/hex variants collapse", () => {
    const a = normalizeMessage("User 12345 not found at 0xABCDEF");
    const b = normalizeMessage("User 99 not found at 0x001122");
    expect(a).toBe(b);
  });

  it("collapses quoted strings and uuids", () => {
    expect(normalizeMessage(`Cannot read "abc"`)).toBe(normalizeMessage(`Cannot read "xyz"`));
    expect(normalizeMessage("id 550e8400-e29b-41d4-a716-446655440000"))
      .toBe(normalizeMessage("id 6ba7b810-9dad-11d1-80b4-00c04fd430c8"));
  });

  it("takes the top frame ignoring line/col and absolute path", () => {
    const stack = "Error: boom\n    at foo (/Users/x/app/a.js:10:5)\n    at bar (/Users/x/app/b.js:2:1)";
    const stack2 = "Error: boom\n    at foo (/srv/app/a.js:99:9)\n    at bar (/srv/app/b.js:1:1)";
    expect(topFrame(stack)).toBe(topFrame(stack2));
    expect(topFrame(undefined)).toBe("");
  });

  it("same shape → same fingerprint; different type → different; length 32", () => {
    const s1 = "Error: x\n    at foo (/a/a.js:1:1)";
    const s2 = "Error: x\n    at foo (/b/a.js:9:9)";
    expect(fingerprint("TypeError", "User 1 gone", s1)).toBe(fingerprint("TypeError", "User 2 gone", s2));
    expect(fingerprint("RangeError", "User 1 gone", s1)).not.toBe(fingerprint("TypeError", "User 1 gone", s1));
    expect(fingerprint("TypeError", "x")).toHaveLength(32);
  });
});
