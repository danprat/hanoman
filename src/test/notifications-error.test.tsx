import { describe, it, expect } from "vitest";
import { toastFor } from "../src/notifications/NotificationsContext";
import { notifTarget } from "../src/notifications/target";
import type { Notification } from "@hanoman/shared";

const prefs = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" } as const;

const errNotif = {
  id: "n1", type: "error", specId: null, sessionId: null,
  title: 'Error baru di "Alpha": TypeError: x is undefined', projectId: "a",
  createdAt: "2026-07-20T00:00:00.000Z", readAt: null,
} as unknown as Notification;

describe("error notifications (SPEC-249)", () => {
  it("toastFor maps an error notification to an err-toned, enabled toast using the title", () => {
    const plan = toastFor(errNotif, prefs);
    expect(plan.tone).toBe("err");
    expect(plan.icon).toBe("triangle-alert");
    expect(plan.enabled).toBe(true);
    expect(plan.msg).toBe(errNotif.title);
  });

  it("notifTarget routes an error notification to the Errors area of its project", () => {
    expect(notifTarget(errNotif, [])).toEqual({ section: "errors", projectFilter: "a" });
  });
});
