import type { Scheduler } from "@hanoman/shared";
import type { SchedulerQueueItem } from "@prisma/client";
import { queued, markLaunched, markFailed } from "./queue";

// SPEC-294 · ADR-0072 · governor concurrency. Deps di-inject agar teruji tanpa tmux/claude nyata;
// produksi mengikatnya ke pty + startSpecSession (engine.ts).
export type GovernorDeps = {
  liveCount: () => number;                                  // sesi hidup gabungan manual+scheduler (pty.listSessions)
  isLive: (specId: string) => string | null;               // sessionId hidup untuk spec, atau null
  launch: (item: SchedulerQueueItem) => Promise<string>;   // spawn sesi → sessionId; throw = gagal
};

// Reentrancy guard: satu drain jalan pada satu waktu (tick tak balapan dengan tick berikutnya).
let draining = false;

export async function drain(cfg: Scheduler, deps: GovernorDeps): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let slots = cfg.maxConcurrent - deps.liveCount();
    if (slots <= 0) return;
    for (const item of await queued()) {
      if (slots <= 0) break;
      // Idempoten satu-sesi-per-spec: sesi spec sudah hidup (mis. di-Start manual) → tandai launched
      // tanpa makan slot (sudah terhitung di liveCount) & tanpa spawn kedua.
      const liveId = deps.isLive(item.specId);
      if (liveId) { await markLaunched(item.id, liveId); continue; }
      try {
        const sessionId = await deps.launch(item);
        await markLaunched(item.id, sessionId);
        slots--;
      } catch (e) {
        // Gagal (mis. project belum di-bind) → tandai, TANPA retry (PRD non-goal). Slot tak terpakai.
        await markFailed(item.id, (e as Error).message);
      }
    }
  } finally { draining = false; }
}
