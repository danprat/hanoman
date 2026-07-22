import type { FastifyInstance } from "fastify";
import { zScheduler } from "@hanoman/shared";
import { getScheduler, setScheduler } from "../services/scheduler/config";
import { listQueue } from "../services/scheduler/queue";
import { getLastRun } from "../services/scheduler/registry";
import { listSessions } from "../services/pty";

// SPEC-294 · ADR-0072 · config (knob) + state (antrean/sesi/cadence) scheduler. Di belakang gate cookie.
export default async function (app: FastifyInstance) {
  app.get("/scheduler/config", async () => getScheduler());

  app.put("/scheduler/config", async (req, reply) => {
    const parsed = zScheduler.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setScheduler(parsed.data);   // ganti blok penuh (pola PUT /settings). Pause = { paused:true }.
  });

  app.get("/scheduler/state", async () => {
    const cfg = await getScheduler();
    const live = listSessions().filter((s) => !s.exited);
    const queue = await listQueue();
    // Akses kunci source tetap (backlog/errors/triase) langsung — bukan index dinamis — agar
    // tetap tertype di bawah noUncheckedIndexedAccess. minCount hanya milik errors.
    const srcView = (id: string, sc: { enabled: boolean; everyMin: number }, minCount?: number) => {
      const last = getLastRun(id);
      return {
        id, enabled: sc.enabled, everyMin: sc.everyMin, minCount,
        lastRunAt: last ? new Date(last).toISOString() : null,
        nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
      };
    };
    const sources = [
      srcView("backlog", cfg.sources.backlog),
      srcView("errors", cfg.sources.errors, cfg.sources.errors.minCount),
      srcView("triase", cfg.sources.triase),
    ];
    // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
    const launchedSpecs = new Set(queue.filter((q) => q.status === "launched").map((q) => q.specId));
    const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
    return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queue, sessions };
  });
}
