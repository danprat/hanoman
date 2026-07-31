import type { Scheduler } from "@hanoman/shared";
import type { SchedulerQueueItem } from "@prisma/client";
import { queued, markLaunched, markFailed, markDone, noteQueued } from "./queue";
import { blockedNote, type SpecBlocker } from "../spec-deps";

// SPEC-294 · ADR-0072 · governor concurrency. Deps di-inject agar teruji tanpa tmux/claude nyata;
// produksi mengikatnya ke pty + startSpecSession (engine.ts).
export type GovernorDeps = {
  liveCount: () => number;                                  // sesi hidup gabungan manual+scheduler (pty.listSessions)
  isLive: (specId: string) => string | null;               // sessionId hidup untuk spec, atau null
  isDone: (specId: string) => Promise<boolean>;            // SPEC-431 · spec sudah selesai → jangan pernah diluncurkan
  // SPEC-447 · ADR-0093 · dependency yang belum selesai/ter-merge. WAJIB (bukan opsional): satu-
  // satunya pembangun produksi adalah `prodDeps`, jadi tipe wajib = jaminan kompilasi bahwa
  // gerbangnya tak pernah lupa dipasang. Otomasi tak punya `force`.
  blockers: (specId: string) => Promise<SpecBlocker[]>;
  launch: (item: SchedulerQueueItem, autonomy?: string) => Promise<string>;   // spawn sesi → sessionId; throw = gagal. SPEC-298 · autonomy per mode (klausa prompt)
};

// SPEC-431 · alasan penutupan yang dibaca operator di panel scheduler (baris tanpa `launchedAt`).
export const ALREADY_DONE_NOTE = "spec sudah selesai — tak diluncurkan";

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
      // SPEC-431 · gerbang terakhir sebelum sebuah baris antrean jadi sesi tmux sungguhan. Checker
      // yang benar (`UNSTARTED_SPEC_WHERE`) tak cukup sendirian: baris `queued` yang telanjur ada
      // dari predikat lama tetap akan meluncur, dan sebuah item bisa saja diselesaikan operator
      // SELAGI ia mengantre. Ditutup `done` — bukan dihapus — supaya `enqueue` (upsert `update:{}`)
      // tak pernah menghidupkannya lagi. Sengaja BUKAN di `startSpecSession`: reopen manual item
      // `done` (SPEC-172) memang fitur; yang dilarang cuma otomasi memasukinya sendiri.
      if (await deps.isDone(item.specId)) { await markDone(item.id, ALREADY_DONE_NOTE); continue; }
      // SPEC-447 · ADR-0093 · item yang dependency-nya belum selesai & ter-merge DILEWATI —
      // barisnya tetap `queued` (pemblokirnya akan selesai, dan `enqueue` yang `upsert(update:{})`
      // tak bisa menghidupkan kembali baris yang sudah ditutup), slot TIDAK terpakai, dan drain
      // lanjut ke item berikutnya sehingga satu item terblokir tak menyumbat antrean.
      const blocked = await deps.blockers(item.specId);
      if (blocked.length) { await noteQueued(item.id, blockedNote(blocked)); continue; }
      // Idempoten satu-sesi-per-spec: sesi spec sudah hidup (mis. di-Start manual) → tandai launched
      // tanpa makan slot (sudah terhitung di liveCount) & tanpa spawn kedua.
      const liveId = deps.isLive(item.specId);
      if (liveId) { await markLaunched(item.id, liveId); continue; }
      try {
        const sessionId = await deps.launch(item, cfg.autonomy);
        await markLaunched(item.id, sessionId);
        slots--;
      } catch (e) {
        // Gagal (mis. project belum di-bind) → tandai, TANPA retry (PRD non-goal). Slot tak terpakai.
        await markFailed(item.id, (e as Error).message);
      }
    }
  } finally { draining = false; }
}
