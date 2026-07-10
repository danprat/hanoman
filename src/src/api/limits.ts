import { useSyncExternalStore } from "react";
import type { LimitsDTO, LimitWindow, LimitSeverity } from "@hanoman/shared";
import { api } from "./client";

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

// Poller singleton: satu interval 60s + satu nilai ter-cache di module scope, dibagi semua
// pemakai (ref-count). Selamat dari navigasi; badge (Shell) + kartu (Overview) memakai satu poll.
const POLL_MS = 60_000;
let state: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();

async function pull() {
  try { state = await api.getLimits(); }
  catch { /* biarkan nilai terakhir; badge tampil apa adanya */ }
  for (const s of subs) s();
}
function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) { void pull(); timer = setInterval(() => void pull(), POLL_MS); }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && timer) { clearInterval(timer); timer = undefined; }
  };
}

export function useLimits(): LimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
