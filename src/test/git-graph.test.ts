import { describe, it, expect } from "vitest";
import { computeLanes } from "../src/screens/git-graph";
import type { GraphCommit } from "../src/api/client";

const c = (sha: string, parents: string[]): GraphCommit =>
  ({ sha, parents, author: "t", at: "", subject: sha, refs: [] });

describe("computeLanes", () => {
  it("riwayat linear semuanya di lane 0", () => {
    const rows = computeLanes([c("C", ["B"]), c("B", ["A"]), c("A", [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });
  it("cabang + merge menaruh sibling di lane berbeda", () => {
    // m = merge(a, b); a & b dari root r. Urut newest→oldest: m, a, b, r.
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
  });
  it("width ≥ lane+1 dan ≥ jumlah lane aktif", () => {
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    expect(rows[0]!.width).toBeGreaterThanOrEqual(2);
  });
});
