import { prisma } from "../../db";
import type { SchedulerQueueItem } from "@prisma/client";

const RANK: Record<string, number> = { tinggi: 0, sedang: 1, rendah: 2 };

export type EnqueueInput = { specId: string; projectId: string; source: string; priority: string };

// Idempoten via specId @unique: bila item sudah ada (queued/launched/done/failed) → no-op (update {}),
// jangan resurrect item yang sudah diproses. Backlog checker menyaring baseSha≠null; errors/triase
// membuat Spec baru tiap kali, jadi re-enqueue hanya kena dalam jendela queued/launched.
export async function enqueue(i: EnqueueInput): Promise<void> {
  await prisma.schedulerQueueItem.upsert({
    where: { specId: i.specId },
    update: {},
    create: { specId: i.specId, projectId: i.projectId, source: i.source, priority: i.priority },
  });
}

export function listQueue(status?: string): Promise<SchedulerQueueItem[]> {
  return prisma.schedulerQueueItem.findMany({ where: status ? { status } : undefined });
}

// Item siap-drain, urut prioritas lalu FIFO (enqueuedAt). Sort di memori: himpunan kecil.
export async function queued(): Promise<SchedulerQueueItem[]> {
  const items = await prisma.schedulerQueueItem.findMany({ where: { status: "queued" } });
  return items.sort((a, b) =>
    (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
    || a.enqueuedAt.getTime() - b.enqueuedAt.getTime());
}

export async function markLaunched(id: string, sessionId: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "launched", sessionId, launchedAt: new Date() } });
}
export async function markFailed(id: string, note?: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "failed", note: note ?? null } });
}
export async function markDone(id: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "done" } });
}
export function queueItemForSpec(specId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findUnique({ where: { specId } });
}
export function schedulerItemForSession(sessionId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findFirst({ where: { sessionId } });
}
