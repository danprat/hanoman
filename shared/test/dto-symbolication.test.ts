import { describe, it, expect } from "vitest";
import { zIngestPayload, zSourceMapUpload, zErrorGroupView, zSymbolicatedFrame } from "../src/dto";

// SPEC-276 · ADR-0070 · frame terstruktur + symbolicated + upload source-map + release.
describe("dto SPEC-276", () => {
  it("ingest payload accepts optional frames", () => {
    const r = zIngestPayload.safeParse({
      type: "TypeError", message: "x",
      frames: [{ function: "f", filename: "a.js", lineno: 1, colno: 2, in_app: true }],
    });
    expect(r.success).toBe(true);
  });
  it("ingest payload valid without frames (backward compat)", () => {
    expect(zIngestPayload.safeParse({ type: "E", message: "x" }).success).toBe(true);
  });
  it("group view requires release (nullable)", () => {
    const r = zErrorGroupView.safeParse({
      id: "1", projectId: "p", type: "E", message: "m", environment: "production",
      status: "new", count: 1, firstSeenAt: "t", lastSeenAt: "t", specId: null, release: null,
    });
    expect(r.success).toBe(true);
  });
  it("group view rejects when release field missing", () => {
    const r = zErrorGroupView.safeParse({
      id: "1", projectId: "p", type: "E", message: "m", environment: "production",
      status: "new", count: 1, firstSeenAt: "t", lastSeenAt: "t", specId: null,
    });
    expect(r.success).toBe(false);
  });
  it("sourcemap upload requires release + non-empty artifacts", () => {
    expect(zSourceMapUpload.safeParse({ release: "1.0.0", artifacts: [{ filename: "index-abc.js", map: "{}" }] }).success).toBe(true);
    expect(zSourceMapUpload.safeParse({ release: "1.0.0", artifacts: [] }).success).toBe(false);
    expect(zSourceMapUpload.safeParse({ artifacts: [{ filename: "a.js", map: "{}" }] }).success).toBe(false);
  });
  it("symbolicated frame requires symbolicated flag", () => {
    expect(zSymbolicatedFrame.safeParse({ symbolicated: true, source: "src/a.ts", sourceLine: 3 }).success).toBe(true);
    expect(zSymbolicatedFrame.safeParse({ source: "src/a.ts" }).success).toBe(false);
  });
});
