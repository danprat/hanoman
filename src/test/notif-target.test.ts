import { describe, it, expect } from "vitest";
import { notifTarget } from "../src/notifications/target";

const n = (over: any) => ({ id: "1", specId: null, sessionId: "s1", title: "x", projectId: "p1", createdAt: "", readAt: null, ...over });

describe("notifTarget (SPEC-184)", () => {
  it("decision → terminal, fokus sesi", () => {
    expect(notifTarget(n({ type: "decision" }), [])).toEqual({ section: "terminal", projectFilter: "p1", focus: "s1" });
  });
  it("done sesi hidup → terminal", () => {
    const sessions = [{ id: "s1", projectId: "p1", cwd: "", exited: false }] as any;
    expect(notifTarget(n({ type: "done" }), sessions).section).toBe("terminal");
  });
  it("done sesi mati/absen → backlog", () => {
    expect(notifTarget(n({ type: "done" }), []).section).toBe("backlog");
  });
});
