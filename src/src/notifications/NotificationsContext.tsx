import React from "react";
import type { Notification, Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds/kit";
import { api } from "../api/client";
import { playNotifySound, type NotifySound } from "./sound";

export function maxAt(items: Notification[]): string {
  return items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
}
export function newSince(items: Notification[], baseline: string): Notification[] {
  return items.filter((n) => n.createdAt > baseline);
}

type Ctx = { items: Notification[]; unread: number; markAllRead: () => void; clear: () => void };
// Nilai default aman: komponen yang merender <Shell> tanpa provider (mis. test) tak error.
// Di-export agar test bell bisa membungkus dengan value palsu (Task 6).
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, markAllRead: () => { }, clear: () => { } });
export const useNotifications = () => React.useContext(NotificationsContext);

const POLL_MS = 10_000;

export function NotificationsProvider({ showToast, children }: { showToast: ShowToast; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  // baseline = createdAt terbesar yang sudah "dilihat". undefined = belum di-seed (mount pertama
  // TIDAK men-toast riwayat lama). Ref, bukan state: tak perlu memicu render.
  const baseline = React.useRef<string | undefined>(undefined);
  const soundRef = React.useRef<NotifySound>("short");
  const enabledRef = React.useRef(true);

  const tick = React.useCallback(async () => {
    let s: Setting | null = null;
    try { s = await api.getSettings(); } catch { /* biarkan nilai lama */ }
    if (s) { enabledRef.current = s.notifyDone; soundRef.current = (s.notifySound as NotifySound); }
    let data: { items: Notification[]; unread: number };
    try { data = await api.listNotifications(); } catch { return; }
    setItems(data.items); setUnread(data.unread);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; } // seed, no toast
    const fresh = newSince(data.items, baseline.current);
    const top = maxAt(data.items);
    if (top > baseline.current) baseline.current = top;
    const latest = fresh[0]; // items terbaru dulu (server orderBy desc)
    if (latest && enabledRef.current) {
      showToast(`${latest.specId} · "${latest.title}" selesai`, "ok", "check-circle-2");
      playNotifySound(soundRef.current);
    }
  }, [showToast]);

  React.useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
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
    <NotificationsContext.Provider value={{ items, unread, markAllRead, clear }}>
      {children}
    </NotificationsContext.Provider>
  );
}
