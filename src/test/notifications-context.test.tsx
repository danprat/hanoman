import { describe, it, expect } from "vitest";
import { newSince, maxAt } from "../src/notifications/NotificationsContext";

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
