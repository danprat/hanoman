import { fmtEstCost } from "@hanoman/shared";
import type { RunLiveEvent } from "../api/client";
import type { RunVM } from "./types";

// Merge one live SSE event into a run view-model (pure; unit-tested).
export function reduceRunEvent(run: RunVM, e: RunLiveEvent): RunVM {
  switch (e.kind) {
    case "log":   return { ...run, log: [...(run.log as any[]), e.line] };
    case "status":return { ...run, status: e.status as RunVM["status"] };
    case "phase": return { ...run, phases: (run.phases as any[]).map((p) => p.name === e.name ? { ...p, state: e.state } : p) };
    case "cost":  return { ...run, tokensIn: String(e.tokensIn), tokensOut: String(e.tokensOut), cost: fmtEstCost(e.costUsd) };
    // SPEC-157 · tanpa cabang ini `default` menelannya, dan tombol keputusan baru muncul di
    // poll berikutnya — bukan saat agen bertanya.
    case "ask":   return { ...run, pendingAsk: e.ask };
    default:      return run;
  }
}

export function runDurationMs(run: { createdAt: string; finishedAt: string | null }, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, end - Date.parse(run.createdAt));
}

// j=jam, m=menit, d=detik
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h}j ${m % 60}m` : m ? `${m}m ${s % 60}d` : `${s}d`;
}
