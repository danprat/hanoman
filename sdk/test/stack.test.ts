import { describe, it, expect } from "vitest";
import { parseStack, inApp, framesFromStack, collectStack } from "../src/stack";

describe("parseStack", () => {
  it("parses V8 parenthesized + anonymous frames", () => {
    const s = [
      "Error: boom",
      "    at foo (/Users/x/app/src/a.ts:10:5)",
      "    at https://cdn.example.com/assets/index-4f3a2b.js:1:88421",
    ].join("\n");
    const f = parseStack(s);
    expect(f[0]).toEqual({ function: "foo", filename: "/Users/x/app/src/a.ts", lineno: 10, colno: 5 });
    expect(f[1]).toEqual({ function: undefined, filename: "https://cdn.example.com/assets/index-4f3a2b.js", lineno: 1, colno: 88421 });
  });
  it("parses Firefox/Safari frames (fn@url:line:col)", () => {
    const s = "foo@https://h/app.js:3:9\n@https://h/app.js:1:1";
    const f = parseStack(s);
    expect(f[0]).toEqual({ function: "foo", filename: "https://h/app.js", lineno: 3, colno: 9 });
    expect(f[1]?.function).toBeUndefined();
  });
});

describe("inApp", () => {
  it("marks own code in_app, vendor not", () => {
    expect(inApp("/Users/x/app/src/a.ts")).toBe(true);
    expect(inApp("/Users/x/app/node_modules/react/index.js")).toBe(false);
    expect(inApp("node:internal/process/task_queues")).toBe(false);
    expect(inApp(undefined)).toBe(false);
  });
});

describe("framesFromStack", () => {
  it("sets in_app per frame", () => {
    const s = "Error\n    at a (/app/src/a.ts:1:1)\n    at b (/app/node_modules/x/i.js:2:2)";
    const f = framesFromStack(s);
    expect(f[0]?.in_app).toBe(true);
    expect(f[1]?.in_app).toBe(false);
  });
});

describe("collectStack", () => {
  it("appends cause chain", () => {
    const cause = { stack: "Error: root\n    at r (/app/src/r.ts:9:1)" };
    const err = { stack: "Error: top\n    at t (/app/src/t.ts:1:1)", cause };
    const out = collectStack(err);
    expect(out).toContain("at t (/app/src/t.ts:1:1)");
    expect(out).toContain("Caused by:");
    expect(out).toContain("at r (/app/src/r.ts:9:1)");
  });
  it("undefined stack → undefined", () => {
    expect(collectStack({})).toBeUndefined();
  });
});
