import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// SPEC-214 · status auto-update didorong lewat WS siar (grup "update"), pola api/limits.ts.
// Store singleton ref-count: badge topbar berlangganan satu feed. Default = up-to-date sampai
// frame pertama tiba (server kirim snapshot penuh saat connect).
const UP_TO_DATE: UpdateStatus = {
  currentSha: "", checkoutSha: "", branch: null,
  local: { stale: false }, remote: { status: "unavailable", behind: 0, fetchedAt: null },
  updateAvailable: false, reason: null, command: "", newCommits: [],
};
let state: UpdateStatus = UP_TO_DATE;
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => { if (m.t === "update") { state = m.update; for (const s of subs) s(); } });
  }
  return () => { subs.delete(cb); if (subs.size === 0 && unsub) { unsub(); unsub = undefined; } };
}

export function useUpdate(): UpdateStatus { return useSyncExternalStore(subscribe, () => state, () => state); }

// Helper murni (di-uji unit): heading popover + label pill, per reason.
export function updateHeadline(u: UpdateStatus): string {
  if (!u.updateAvailable) return "Versi terpasang sudah terbaru";
  if (u.reason === "both") return `Kode baru di disk + ${u.remote.behind} commit di origin`;
  if (u.reason === "local") return "Kode baru di disk — rebuild & restart untuk menerapkan";
  return `${u.remote.behind} commit baru di origin — pull untuk update`;
}
export function updateBadgeLabel(u: UpdateStatus): string {
  return u.remote.behind > 0 ? `Update · ${u.remote.behind}` : "Update";
}
