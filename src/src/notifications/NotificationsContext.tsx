import React from "react";
import type { Notification, Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds/kit";
import { api } from "../api/client";
import { playNotifySound, unlockNotifySound, type NotifySound } from "./sound";

export function maxAt(items: Notification[]): string {
  return items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
}
export function newSince(items: Notification[], baseline: string): Notification[] {
  return items.filter((n) => n.createdAt > baseline);
}

export type NotifyPrefs = Pick<Setting, "notifyDone" | "notifySound" | "notifyDecision" | "notifyDecisionSound">;
export type ToastPlan = { msg: string; tone: "ok" | "warn"; icon: string; sound: NotifySound; enabled: boolean };

// SPEC-184 · satu tempat memutuskan bunyi/tampilan toast per tipe notifikasi.
export function toastFor(n: Notification, p: NotifyPrefs): ToastPlan {
  if (n.type === "decision")
    return { msg: `${n.specId ?? n.sessionId} · butuh keputusan`, tone: "warn", icon: "git-merge",
             sound: p.notifyDecisionSound as NotifySound, enabled: p.notifyDecision };
  return { msg: `${n.specId} · "${n.title}" selesai`, tone: "ok", icon: "check-circle-2",
           sound: p.notifySound as NotifySound, enabled: p.notifyDone };
}

type Ctx = { items: Notification[]; unread: number; markAllRead: () => void; clear: () => void; onOpen?: (n: Notification) => void };
// Nilai default aman: komponen yang merender <Shell> tanpa provider (mis. test) tak error.
// Di-export agar test bell bisa membungkus dengan value palsu (Task 6).
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, markAllRead: () => { }, clear: () => { } });
export const useNotifications = () => React.useContext(NotificationsContext);

const POLL_MS = 10_000;

export function NotificationsProvider({ showToast, onOpen, children }: { showToast: ShowToast; onOpen?: (n: Notification) => void; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  // baseline = createdAt terbesar yang sudah "dilihat". undefined = belum di-seed (mount pertama
  // TIDAK men-toast riwayat lama). Ref, bukan state: tak perlu memicu render.
  const baseline = React.useRef<string | undefined>(undefined);
  const prefs = React.useRef<NotifyPrefs>({ notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" });

  const tick = React.useCallback(async () => {
    let s: Setting | null = null;
    try { s = await api.getSettings(); } catch { /* biarkan nilai lama */ }
    if (s) prefs.current = { notifyDone: s.notifyDone, notifySound: s.notifySound, notifyDecision: s.notifyDecision, notifyDecisionSound: s.notifyDecisionSound };
    let data: { items: Notification[]; unread: number };
    try { data = await api.listNotifications(); } catch { return; }
    setItems(data.items); setUnread(data.unread);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; } // seed, no toast
    const fresh = newSince(data.items, baseline.current);
    const top = maxAt(data.items);
    if (top > baseline.current) baseline.current = top;
    const latest = fresh[0]; // items terbaru dulu (server orderBy desc)
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); }
    }
  }, [showToast]);

  React.useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    // SPEC-192 · autoplay diblokir sampai user berinteraksi; unlock audio pada gestur pertama.
    const unlock = () => { unlockNotifySound(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { clearInterval(t); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [tick]);

  const markAllRead = React.useCallback(() => {
    setUnread(0);
    api.markNotificationsRead().catch(() => { });
  }, []);
  const clear = React.useCallback(() => {
    setItems([]); setUnread(0);
    api.clearNotifications().catch(() => { });
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unread, markAllRead, clear, onOpen }}>
      {children}
    </NotificationsContext.Provider>
  );
}
