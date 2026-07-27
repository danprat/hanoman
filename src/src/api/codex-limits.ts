import { useSyncExternalStore } from "react";
import type { CodexLimitsDTO } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// SPEC-338 · ADR-0074 · store limit codex — cermin api/limits.ts (singleton ref-count di atas satu
// koneksi WS siar), tapi berlangganan grup `codexLimits` yang TERPISAH. Sengaja tidak digabung ke
// store `limits`: sumbernya beda (snapshot rollout vs API live), jadi satu frame tak boleh menimpa
// atau menyegarkan yang lain.
let state: CodexLimitsDTO = { status: "unavailable", windows: [], fetchedAt: null, plan: null };
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "codexLimits") { state = m.limits; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

export function useCodexLimits(): CodexLimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// Untuk test: kembalikan store ke keadaan awal antar kasus.
export function _resetCodexLimitsStore(): void {
  state = { status: "unavailable", windows: [], fetchedAt: null, plan: null };
}
