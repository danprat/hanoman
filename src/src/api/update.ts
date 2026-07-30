import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// SPEC-214 · status auto-update didorong lewat WS siar (grup "update"), pola api/limits.ts.
// SPEC-398 · ADR-0087 · isinya kini semver paket npm, bukan SHA git.
// Store singleton ref-count: badge topbar berlangganan satu feed. Default = up-to-date sampai
// frame pertama tiba (server kirim snapshot penuh saat connect).
const UP_TO_DATE: UpdateStatus = {
  currentVersion: "", latestVersion: null,
  registry: { status: "unavailable", checkedAt: null },
  updateAvailable: false, command: "",
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

// Helper murni (di-uji unit): heading popover + label pill.
export function updateHeadline(u: UpdateStatus): string {
  if (!u.updateAvailable) return "Versi terpasang sudah terbaru";
  return `hanoman ${u.latestVersion} tersedia — pasang lalu restart instance ini`;
}
export function updateBadgeLabel(u: UpdateStatus): string {
  return u.latestVersion ? `Update · ${u.latestVersion}` : "Update";
}
// Baris kaki popover: versi jalan → versi terbaru. Versi kosong (dev/belum ter-stamp) → "?".
export function updateVersionLine(u: UpdateStatus): string {
  return `terpasang ${u.currentVersion || "?"} · tersedia ${u.latestVersion ?? "?"}`;
}
