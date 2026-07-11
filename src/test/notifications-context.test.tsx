import { describe, it, expect } from "vitest";
import { newSince, maxAt, toastFor } from "../src/notifications/NotificationsContext";

const n = (specId: string, createdAt: string) =>
  ({ id: specId, type: "done" as const, specId, sessionId: null, title: specId, projectId: null, createdAt, readAt: null });

describe("newSince / maxAt", () => {
  it("maxAt: createdAt terbesar; kosong → ''", () => {
    expect(maxAt([])).toBe("");
    expect(maxAt([n("a", "2026-07-11T01:00:00.000Z"), n("b", "2026-07-11T03:00:00.000Z")]))
      .toBe("2026-07-11T03:00:00.000Z");
  });
  it("newSince: hanya yang lebih baru dari baseline", () => {
    const items = [n("a", "2026-07-11T01:00:00.000Z"), n("b", "2026-07-11T03:00:00.000Z")];
    expect(newSince(items, "2026-07-11T02:00:00.000Z").map((x) => x.specId)).toEqual(["b"]);
    expect(newSince(items, "2026-07-11T03:00:00.000Z")).toEqual([]);
  });
});

const prefs = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" } as const;
const mk = (over: any) => ({ id: "1", specId: null, sessionId: "s", title: "x", projectId: "p", createdAt: "", readAt: null, ...over });

describe("toastFor (SPEC-184)", () => {
  it("done → tone ok + notifySound", () => {
    const t = toastFor(mk({ type: "done", specId: "SPEC-1", title: "judul" }), prefs);
    expect(t.tone).toBe("ok"); expect(t.sound).toBe("short"); expect(t.enabled).toBe(true);
  });
  it("decision → tone warn + notifyDecisionSound", () => {
    const t = toastFor(mk({ type: "decision", specId: "SPEC-1" }), prefs);
    expect(t.tone).toBe("warn"); expect(t.sound).toBe("alert");
  });
  it("toggle decision mati → enabled false", () => {
    const t = toastFor(mk({ type: "decision" }), { ...prefs, notifyDecision: false });
    expect(t.enabled).toBe(false);
  });
});
