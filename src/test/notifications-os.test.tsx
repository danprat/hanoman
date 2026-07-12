import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSettings = vi.fn();
vi.mock("../src/api/client", () => ({
  api: {
    getSettings: (...a: unknown[]) => getSettings(...a),
    markNotificationsRead: vi.fn(),
    clearNotifications: vi.fn(),
  },
}));
vi.mock("../src/notifications/sound", () => ({ playNotifySound: vi.fn(), unlockNotifySound: vi.fn() }));
// SPEC-199 · notif kini didorong lewat WS siar; tangkap handler subscribe untuk mempush frame.
const ev = vi.hoisted(() => ({ handler: undefined as ((m: unknown) => void) | undefined }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: unknown) => void) => { ev.handler = fn; return () => { ev.handler = undefined; }; },
}));

import { NotificationsProvider } from "../src/notifications/NotificationsContext";

const settings = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" };
const done = { id: "n1", type: "done", specId: "SPEC-196", sessionId: "spec_196", title: "Judul",
  projectId: "p", createdAt: "2026-07-12T00:00:00.000Z", readAt: null };

let ctor: ReturnType<typeof vi.fn>;
function setHidden(v: boolean) { Object.defineProperty(document, "hidden", { configurable: true, get: () => v }); }

beforeEach(() => {
  getSettings.mockResolvedValue(settings);
  ctor = vi.fn();
  class FakeNotification {
    static permission = "granted";
    static requestPermission = vi.fn();
    onclick: unknown = null;
    close = vi.fn();
    constructor(title: string, opts?: unknown) { ctor(title, opts); }
  }
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => { vi.unstubAllGlobals(); setHidden(false); vi.clearAllMocks(); });

// Render, tunggu loadPrefs, lalu push dua frame: kosong (seed baseline, tanpa toast) → [done] (fresh).
async function boot() {
  render(<NotificationsProvider showToast={vi.fn()}>{null}</NotificationsProvider>);
  await act(async () => { await Promise.resolve(); });                                    // loadPrefs microtask
  await act(async () => { ev.handler?.({ t: "notifications", items: [], unread: 0 }); });  // seed
  await act(async () => { ev.handler?.({ t: "notifications", items: [done], unread: 1 }); }); // fresh
}

describe("NotificationsProvider · notifikasi OS lintas tab (SPEC-196)", () => {
  it("tab tersembunyi + izin granted → new Notification saat notif fresh", async () => {
    setHidden(true);
    await boot();
    expect(ctor).toHaveBeenCalledWith('SPEC-196 · "Judul" selesai', { tag: "n1" });
  });

  it("tab terlihat → tak menembak OS (toast in-app cukup)", async () => {
    setHidden(false);
    await boot();
    expect(ctor).not.toHaveBeenCalled();
  });
});
