import { useSyncExternalStore } from "react";
import type { LimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

const RANK: Record<LimitSeverity, number> = { normal: 0, warning: 1, critical: 2 };

// Window paling kritis = severity terburuk, tie-break usedPct tertinggi. Menentukan warna badge.
export function worstWindow(windows: LimitWindow[]): LimitWindow | null {
  if (!windows.length) return null;
  return windows.reduce((a, b) => {
    if (RANK[b.severity] !== RANK[a.severity]) return RANK[b.severity] > RANK[a.severity] ? b : a;
    return b.usedPct > a.usedPct ? b : a;
  });
}

// Warna kustom (badge button + teks): pakai token status DS.
export function severityToken(s: LimitSeverity): { fg: string; bg: string } {
  if (s === "critical") return { fg: "var(--status-err)", bg: "var(--status-err-tint)" };
  if (s === "warning") return { fg: "var(--status-warn)", bg: "var(--status-warn-tint)" };
  return { fg: "var(--status-ok)", bg: "var(--status-ok-tint)" };
}

// Untuk <ProgressBar tone=…> — prop `tone` DS ("ok"|"warn"|"err"), bukan warna mentah.
export function severityTone(s: LimitSeverity): "ok" | "warn" | "err" {
  return s === "critical" ? "err" : s === "warning" ? "warn" : "ok";
}

// SPEC-199 · nilai limits didorong lewat WS siar (grup "limits"), bukan poll 60s. Store
// singleton ref-count tetap: badge (Shell) + kartu (Overview) berbagi satu langganan.
// useLimits() tak berubah.
let state: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "limits") { state = m.limits; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

export function useLimits(): LimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
