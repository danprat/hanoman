import { describe, it, expect } from "vitest";
import { symbolicateFrames } from "./symbolicate";

// Source-map minimal buatan tangan. Satu segmen di generated (line 1, col 10) → source[0]
// "src/app.ts" (line 0-based 1 = line 2), col 0, name[0] "handleClick".
// VLQ segmen [genCol=10, srcIdx=0, srcLine=1, srcCol=0, nameIdx=0] = "UACAA".
const rawMap = JSON.stringify({
  version: 3,
  sources: ["src/app.ts"],
  sourcesContent: ["const a = 1;\nfunction handleClick() { throw new Error('x'); }\nconst b = 2;\n"],
  names: ["handleClick"],
  mappings: "UACAA",
});

describe("symbolicateFrames", () => {
  it("maps generated position to source + context lines (col-1 adjust)", async () => {
    // colno 11 (1-based V8) → column 10 (0-based) → cocok segmen.
    const out = await symbolicateFrames(
      [{ function: "t", filename: "index-4f3a2b.js", lineno: 1, colno: 11 }],
      () => rawMap,
    );
    expect(out[0]?.symbolicated).toBe(true);
    expect(out[0]?.source).toBe("src/app.ts");
    expect(out[0]?.sourceLine).toBe(2);
    expect(out[0]?.contextLine).toContain("handleClick");
    expect(out[0]?.function).toBe("handleClick");
    expect(out[0]?.in_app).toBe(true);
  });
  it("no map → raw frame, symbolicated false", async () => {
    const out = await symbolicateFrames([{ filename: "a.js", lineno: 1, colno: 1 }], () => null);
    expect(out[0]?.symbolicated).toBe(false);
    expect(out[0]?.filename).toBe("a.js");
  });
  it("bad map → symbolicated false, never throws", async () => {
    const out = await symbolicateFrames([{ filename: "a.js", lineno: 1, colno: 1 }], () => "not json");
    expect(out[0]?.symbolicated).toBe(false);
  });
  it("frame without filename/lineno → passthrough", async () => {
    const out = await symbolicateFrames([{ function: "native" }], () => rawMap);
    expect(out[0]?.symbolicated).toBe(false);
    expect(out[0]?.function).toBe("native");
  });
});
