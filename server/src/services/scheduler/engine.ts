import { prisma } from "../../db";
import { flowForSource } from "@hanoman/shared";
import type { Autonomy } from "@hanoman/runner";
import { getScheduler } from "./config";
import { listSources, isDue, setLastRun } from "./registry";
import { drain, type GovernorDeps } from "./governor";
import { listSessions, getSession, sessionIdForSpec } from "../pty";
import { startSpecSession } from "../session-launch";

// SPEC-294 · ADR-0072 · satu tick: jalankan checker source yang enabled & jatuh-tempo, lalu drain
// antrean (kecuali Pause). `now` di-parameter agar cadence teruji deterministik.
export async function tick(now: number, deps: GovernorDeps): Promise<void> {
  const cfg = await getScheduler();
  if (!cfg.enabled) return;                       // master off → idle penuh
  for (const src of listSources()) {
    const sc = (cfg.sources as Record<string, { enabled: boolean; everyMin: number }>)[src.id];
    if (sc?.enabled && isDue(src.id, sc.everyMin, now)) {
      setLastRun(src.id, now);
      try { await src.check(); } catch { /* satu source gagal tak menghentikan sisanya */ }
    }
  }
  if (cfg.paused) return;                          // rem darurat: tak ada drain → tak ada peluncuran baru
  await drain(cfg, deps);
}

// Deps produksi: cap dihitung dari sesi tmux hidup; launch lewat jalur bersama startSpecSession.
export const prodDeps: GovernorDeps = {
  liveCount: () => listSessions().filter((s) => !s.exited).length,
  isLive: (specId) => { const s = getSession(sessionIdForSpec(specId)); return s && !s.exited ? s.id : null; },
  launch: async (item, autonomy) => {
    const spec = await prisma.spec.findUnique({ where: { id: item.specId } });
    if (!spec) throw new Error(`spec ${item.specId} tak ada`);
    // SPEC-298 · autonomy per mode dari cfg.scheduler.autonomy → klausa prompt full-control / butuh-keputusan.
    const r = await startSpecSession(spec, { flow: flowForSource(spec.source), autonomy: autonomy as Autonomy | undefined });
    return r.id;
  },
};

const TICK_MS = 10_000;   // governor tick: cukup halus untuk "drain ≤1 tick" saat slot kosong
let timer: NodeJS.Timeout | undefined;

// Dipanggil server.ts SAJA (app.ts bebas-timer). unref → tak menahan proses; boot-pass segera.
export function startScheduler(deps: GovernorDeps = prodDeps): void {
  if (timer) return;
  timer = setInterval(() => void tick(Date.now(), deps), TICK_MS);
  timer.unref();
  void tick(Date.now(), deps);
}
export function stopScheduler(): void { if (timer) clearInterval(timer); timer = undefined; }
