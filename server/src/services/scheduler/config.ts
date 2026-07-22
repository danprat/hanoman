import { prisma } from "../../db";
import type { Prisma } from "@prisma/client";
import type { Scheduler } from "@hanoman/shared";
import { getSetting } from "../settings";

// SPEC-294 · ADR-0072 · blok scheduler hidup di dalam Setting singleton (id=1). getSetting sudah
// mengisi default (zSetting.scheduler = SCHEDULER_DEFAULTS) untuk baris lama tanpa blok ini.
export async function getScheduler(): Promise<Scheduler> {
  return (await getSetting()).scheduler;
}

// Ganti seluruh blok scheduler; pertahankan field Setting lain (merge di atas getSetting).
export async function setScheduler(next: Scheduler): Promise<Scheduler> {
  const cur = await getSetting();
  const data = { ...cur, scheduler: next } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  return next;
}
