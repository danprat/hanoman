import { describe, it, expect } from "vitest";
import { normalizeMessage, topFrame, fingerprint, normalizeBundleName } from "./error-fingerprint";

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

  // SPEC-276 · Temuan B audit SPEC-275 · content-hash bundle tak boleh memecah grup tiap deploy.
  it("normalizeBundleName strips content-hash but keeps plain names", () => {
    expect(normalizeBundleName("index-4f3a2b.js")).toBe("index.js");
    expect(normalizeBundleName("index-9z8y7w.js")).toBe("index.js");
    expect(normalizeBundleName("app.a1b2c3d4.js")).toBe("app.js");
    expect(normalizeBundleName("d3-scale.js")).toBe("d3-scale.js");   // no digit → keep
    expect(normalizeBundleName("chart-v2.js")).toBe("chart-v2.js");   // too short → keep
    expect(normalizeBundleName("index.js")).toBe("index.js");
  });
  it("Temuan B: hashed bundle groups stably across deploys (parenthesized)", () => {
    const a = "Error: x\n    at t (https://h/assets/index-4f3a2b.js:1:5)";
    const b = "Error: x\n    at t (https://h/assets/index-9z8y7w.js:9:9)";
    expect(fingerprint("Error", "x", a)).toBe(fingerprint("Error", "x", b));
  });
  it("Temuan B: hashed bundle groups stably across deploys (anonymous)", () => {
    const a = "Error: x\n    at https://h/assets/index-4f3a2b.js:1:5";
    const b = "Error: x\n    at https://h/assets/index-9z8y7w.js:9:9";
    expect(fingerprint("Error", "x", a)).toBe(fingerprint("Error", "x", b));
  });
  it("fingerprint prefers in_app frame when frames present, stable across deploys", () => {
    const frames = [{ function: "handleClick", filename: "index-4f3a2b.js", in_app: true }];
    const frames2 = [{ function: "handleClick", filename: "index-9z8y7w.js", in_app: true }];
    expect(fingerprint("Error", "x", undefined, frames)).toBe(fingerprint("Error", "x", undefined, frames2));
  });
});
