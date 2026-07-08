import { describe, it, expect } from "vitest";
import { reduceRunEvent, fmtDuration, runDurationMs } from "../src/screens/run-reduce";
import type { RunVM } from "../src/screens/types";

const base = {
  id: "RUN-1", projectId: "p1", specId: null, kind: "feature", status: "running",
  trigger: "commit", triggerDetail: "push → main",
  phases: [{ name: "Execute", state: "active" }], plan: [], files: [], log: [],
  worktree: "w", branchFrom: "main", branchTo: "b", model: "m",
  tokensIn: "0", tokensOut: "0", cost: "$0.00", progress: 0,
  createdAt: "2026-07-08T00:00:00.000Z", finishedAt: null,
  project: "p1", spec: null, title: "t", phase: "Execute",
} as unknown as RunVM;

describe("reduceRunEvent (SPEC-008)", () => {
  it("appends a log line", () => {
    const r = reduceRunEvent(base, { kind: "log", line: { t: "›", s: "hi" } });
    expect((r.log as any[]).at(-1)).toEqual({ t: "›", s: "hi" });
  });
  it("updates a phase state", () => {
    const r = reduceRunEvent(base, { kind: "phase", name: "Execute", state: "done" });
    expect((r.phases as any[]).find((p) => p.name === "Execute").state).toBe("done");
  });
  it("sets status", () => {
    expect(reduceRunEvent(base, { kind: "status", status: "done" }).status).toBe("done");
  });
  it("maps cost to display strings", () => {
    const r = reduceRunEvent(base, { kind: "cost", tokensIn: 10, tokensOut: 20, costUsd: 1.5 });
    expect(r.tokensIn).toBe("10"); expect(r.tokensOut).toBe("20"); expect(r.cost).toBe("$1.50");
  });
});

describe("duration (SPEC-008)", () => {
  it("uses finishedAt when present", () => {
    const ms = runDurationMs({ createdAt: "2026-07-08T00:00:00.000Z", finishedAt: "2026-07-08T00:01:30.000Z" }, Date.parse("2026-07-08T05:00:00Z"));
    expect(fmtDuration(ms)).toBe("1m 30d");
  });
  it("uses now while running", () => {
    const ms = runDurationMs({ createdAt: "2026-07-08T00:00:00.000Z", finishedAt: null }, Date.parse("2026-07-08T00:00:05Z"));
    expect(fmtDuration(ms)).toBe("5d");
  });
});
