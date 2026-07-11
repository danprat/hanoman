import { describe, it, expect } from "vitest";
import { computeLanes, rowEdges } from "../src/screens/git-graph";
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

describe("rowEdges", () => {
  it("linear: edge lurus fromLane==toLane", () => {
    const rows = computeLanes([c("C", ["B"]), c("B", ["A"]), c("A", [])]);
    const edges = rowEdges(rows);
    // C→B: outgoing lane0→lane0
    expect(edges[0]).toEqual([{ fromLane: 0, toLane: 0, half: "bottom", colorLane: 0 }]);
    // A: tak ada parent → tak ada outgoing; ada incoming lurus dari atas
    expect(edges[2]).toEqual([{ fromLane: 0, toLane: 0, half: "top", colorLane: 0 }]);
  });
  it("merge: commit merge punya outgoing diagonal ke lane parent-2", () => {
    const rows = computeLanes([c("m", ["a", "b"]), c("a", ["r"]), c("b", ["r"]), c("r", [])]);
    const mEdges = rowEdges(rows)[0]!;
    // m di lane0; parent a→lane0 (lurus), parent b→lane1 (diagonal)
    expect(mEdges).toContainEqual({ fromLane: 0, toLane: 0, half: "bottom", colorLane: 0 });
    expect(mEdges).toContainEqual({ fromLane: 0, toLane: 1, half: "bottom", colorLane: 1 });
  });
});
