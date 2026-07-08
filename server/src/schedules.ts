import { Queue } from "bullmq";
import { bullConnection } from "./redis";
import { prisma } from "./db";
import { scheduleSpecFor } from "./schedule-parse";

// BullMQ 5 forbids ":" in queue names (Redis key separator) — see queue.ts.
export const SCHEDULES_QUEUE = "hanoman-schedules";
export const schedulesQueue = new Queue(SCHEDULES_QUEUE, { connection: bullConnection });

type SyncTrigger = { id: string; type: string; detail: string; enabled: boolean };

// Enabled + valid cron/duration → upsert a repeatable "fire" job keyed by the
// trigger id; otherwise remove any scheduler for it (disabled or invalid detail).
export async function syncTrigger(trigger: SyncTrigger): Promise<void> {
  const spec = trigger.enabled ? scheduleSpecFor(trigger.type, trigger.detail) : null;
  if (spec) await schedulesQueue.upsertJobScheduler(trigger.id, spec, { name: "fire", data: { triggerId: trigger.id } });
  else await removeSchedule(trigger.id);
}

export async function removeSchedule(triggerId: string): Promise<void> {
  await schedulesQueue.removeJobScheduler(triggerId).catch(() => {});
}

// DB → schedulers: upsert/remove each schedule/interval trigger, then drop any
// leftover scheduler whose trigger was deleted from the DB.
export async function reconcile(): Promise<void> {
  const triggers = await prisma.trigger.findMany({ where: { type: { in: ["schedule", "interval"] } } });
  for (const t of triggers) await syncTrigger(t);
  const wanted = new Set(triggers.filter((t) => t.enabled && scheduleSpecFor(t.type, t.detail)).map((t) => t.id));
  for (const js of await schedulesQueue.getJobSchedulers()) {
    if (!wanted.has(js.key)) await removeSchedule(js.key);
  }
}
